(function () {
  'use strict';

  if (window.__ljcInjected) return;
  window.__ljcInjected = true;

  const BUTTON_ID = 'ljc-copy-btn';
  const TOAST_ID  = 'ljc-toast';

  const JOB_TITLE_SELECTORS = [
    '.job-details-jobs-unified-top-card__job-title h1',
    '.job-details-jobs-unified-top-card__job-title',
    '.jobs-unified-top-card__job-title h1',
    '.jobs-unified-top-card__job-title',
    'h1.t-24',
    'h1[class*="job-title"]',
    'div[class*="job-title"]'
  ];

  const COMPANY_SELECTORS = [
    '.job-details-jobs-unified-top-card__company-name a',
    '.job-details-jobs-unified-top-card__company-name',
    '.jobs-unified-top-card__company-name a',
    '.jobs-unified-top-card__company-name',
    'a[class*="company-name"]',
    'div[class*="company-name"]'
  ];

  const LOCATION_SELECTORS = [
    '.job-details-jobs-unified-top-card__primary-description-container',
    '.job-details-jobs-unified-top-card__bullet',
    '.jobs-unified-top-card__bullet',
    'span[class*="workplace-type"]',
    'span[class*="bullet"]'
  ];

  const DESCRIPTION_SELECTORS = [
    '.jobs-description__content .jobs-box__html-content',
    '#job-details',
    '.jobs-description__container',
    '[class*="jobs-description"]'
  ];

  const INJECT_ANCHOR_SELECTORS = [
    '.jobs-apply-button--top-card',
    '.jobs-s-apply',
    '[class*="apply-button"]',
    '[class*="jobs-apply"]'
  ];

  function queryFirst(selectors, root = document) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function getCurrentJobId() {
    return new URL(window.location.href).searchParams.get('currentJobId')
      || window.location.pathname.match(/\/jobs\/view\/(\d+)/)?.[1]
      || null;
  }

  // ─── Find anchor to inject button next to ─────────────────────────────────
  // On /jobs/collections/ pages: uses class-based selectors (Apply button area)
  // On /jobs/view/ pages: LinkedIn uses hashed classes, so we find Save button by text
  function findAnchorEl() {
    // Try class-based first (works on list/collection pages)
    const byClass = queryFirst(INJECT_ANCHOR_SELECTORS);
    if (byClass) return { el: byClass, mode: 'after' };

    // Fallback: find Save/Saved button by visible text for /jobs/view/ pages
    for (const btn of document.querySelectorAll('button')) {
      const txt = btn.innerText?.trim().toLowerCase();
      if (txt === 'save' || txt === 'saved') {
        // Return the button's parent so we insert after it at the same level
        return { el: btn.parentElement || btn, mode: 'after' };
      }
    }
    return null;
  }

  function findJobTitleEl() {
    const jobId = getCurrentJobId();
    if (jobId && /^\d+$/.test(jobId)) {
      const currentJobLink = document.querySelector(`a[href*="/jobs/view/${jobId}/"]`);
      if (currentJobLink) return currentJobLink;
    }
    return queryFirst(JOB_TITLE_SELECTORS) || document.querySelector('h1');
  }

  function findCompanyEl() {
    const bySelector = queryFirst(COMPANY_SELECTORS);
    if (bySelector) return bySelector;
    let parent = findJobTitleEl()?.parentElement;
    for (let i = 0; parent && i < 8; i++, parent = parent.parentElement) {
      const anchor = parent.querySelector('a[href*="/company/"]');
      if (anchor?.innerText?.trim()) return anchor;
    }
    return null;
  }

  async function cacheCurrentJob() {
    const jobId = getCurrentJobId();
    const description = extractDescription() || '';
    const job = {
      jobId,
      title: findJobTitleEl()?.innerText?.trim() || 'N/A',
      company: findCompanyEl()?.innerText?.trim() || 'N/A',
      location: queryFirst(LOCATION_SELECTORS)?.innerText?.trim() || '',
      url: jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : window.location.href,
      description,
      fullText: buildClipboardText(),
      copiedAt: Date.now()
    };
    const { savedJobs = [] } = await chrome.storage.local.get({ savedJobs: [] });
    const key = job.jobId || job.url;
    await chrome.storage.local.set({
      savedJobs: [job, ...savedJobs.filter(saved => (saved.jobId || saved.url) !== key)]
    });
  }

  function findDescriptionEl() {
    const bySelector = queryFirst(DESCRIPTION_SELECTORS);
    if (bySelector) return bySelector;
    let best = null, bestLen = 0;
    for (const el of document.querySelectorAll('article, section, div')) {
      if (['NAV','HEADER','FOOTER'].includes(el.tagName)) continue;
      if (el.querySelector('nav, header')) continue;
      const len = (el.innerText || '').trim().length;
      const childBlocks = el.querySelectorAll('article, section').length;
      if (len > bestLen && len < 50000 && childBlocks === 0) {
        bestLen = len;
        best = el;
      }
    }
    return best;
  }

  function extractDescription() {
    const descEl = findDescriptionEl();
    if (!descEl) return null;
    const clone = descEl.cloneNode(true);
    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    clone.querySelectorAll('li').forEach(li => { li.prepend('• '); li.append('\n'); });
    clone.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div').forEach(el => el.append('\n'));
    return (clone.innerText || clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  function buildClipboardText() {
    const title       = findJobTitleEl()?.innerText?.trim()                || 'Job Title Not Found';
    const company     = findCompanyEl()?.innerText?.trim()                 || 'Company Not Found';
    const location    = queryFirst(LOCATION_SELECTORS)?.innerText?.trim() || '';
    const description = extractDescription();
    let text = `JOB TITLE: ${title}\n`;
    text += `COMPANY: ${company}\n`;
    if (location) text += `LOCATION: ${location}\n`;
    text += `URL: ${window.location.href}\n`;
    text += `\n${'─'.repeat(60)}\n\n`;
    text += description || 'Description not found.';
    return text;
  }

  function showToast(message, type = 'success') {
    let toast = document.getElementById(TOAST_ID);
    if (toast) toast.remove();
    toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.className = `ljc-toast ljc-toast--${type}`;
    toast.innerHTML = `<span>${type === 'success' ? '✓' : '✕'}</span> ${message}`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('ljc-toast--visible')));
    setTimeout(() => {
      toast.classList.remove('ljc-toast--visible');
      setTimeout(() => toast.remove(), 400);
    }, 2500);
  }

  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        return true;
      } catch { return false; }
    }
  }

  async function handleCopyClick(btn) {
    btn.disabled = true;
    btn.textContent = 'Copying…';
    const success = await copyToClipboard(buildClipboardText());
    if (success) {
      try { await cacheCurrentJob(); } catch (_) {}
      btn.textContent = '✓ Copied!';
      btn.classList.add('ljc-btn--success');
      showToast('Job description copied to clipboard!');
    } else {
      btn.textContent = '✕ Failed';
      btn.classList.add('ljc-btn--error');
      showToast('Copy failed — try again', 'error');
    }
    setTimeout(() => {
      btn.textContent = '📋 Copy Job Description';
      btn.disabled = false;
      btn.classList.remove('ljc-btn--success', 'ljc-btn--error');
    }, 2000);
  }

  function injectButton() {
    const existing = document.getElementById(BUTTON_ID);
    const anchor   = findAnchorEl();

    if (existing) {
      if (!anchor || !document.body.contains(existing)) existing.remove();
      else return;
    }
    if (!anchor) return;

    const btn = document.createElement('button');
    btn.id        = BUTTON_ID;
    btn.className = 'ljc-btn';
    btn.textContent = '📋 Copy Job Description';
    btn.title = 'Copy full job description to clipboard';
    btn.addEventListener('click', () => handleCopyClick(btn));

    anchor.el.insertAdjacentElement('afterend', btn);
  }

  // ─── SPA navigation ────────────────────────────────────────────────────────
  let lastUrl = location.href;
  function onUrlChange() {
    const current = location.href;
    if (current !== lastUrl) {
      lastUrl = current;
      const old = document.getElementById(BUTTON_ID);
      if (old) old.remove();
      [800, 1500, 2500, 4000].forEach(d => setTimeout(injectButton, d));
    }
  }
  const _push = history.pushState.bind(history);
  history.pushState = function (...a) { _push(...a); onUrlChange(); };
  const _replace = history.replaceState.bind(history);
  history.replaceState = function (...a) { _replace(...a); onUrlChange(); };
  window.addEventListener('popstate', onUrlChange);

  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(injectButton, 600);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  [1000, 2000, 3500].forEach(d => setTimeout(injectButton, d));

  // ─── Message listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'scrapeCurrentJob') {
      const jobId = getCurrentJobId();
      sendResponse({
        jobId,
        title:       findJobTitleEl()?.innerText?.trim()                || 'N/A',
        company:     findCompanyEl()?.innerText?.trim()                 || 'N/A',
        location:    queryFirst(LOCATION_SELECTORS)?.innerText?.trim() || 'N/A',
        url:         jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : window.location.href,
        description: extractDescription() || '',
        fullText:    buildClipboardText()
      });
    }
    if (msg.action === 'scrapeJobList') {
      sendResponse({ jobs: scrapeJobList() });
    }
    return true;
  });

  // ─── Scrape job list ───────────────────────────────────────────────────────
  function scrapeJobList() {
    const cards = document.querySelectorAll('[data-occludable-job-id], [data-job-id]');
    const seen = new Set();
    const results = [];

    cards.forEach(card => {
      const jobId = card.dataset.occludableJobId || card.dataset.jobId;
      if (!jobId || seen.has(jobId)) return;
      seen.add(jobId);

      const title = card.querySelector([
        '.job-card-list__title--link',
        '.job-card-list__title',
        '.job-card-container__link strong',
        'a[class*="job-card"] strong',
        '[class*="job-title"]'
      ].join(', '))?.innerText?.trim()
        || card.getAttribute('aria-label')?.trim()
        || '';

      const company = card.querySelector([
        '.job-card-container__company-name',
        '.job-card-container__primary-description',
        '.artdeco-entity-lockup__subtitle',
        '[class*="company-name"]',
        '[class*="subtitle"]'
      ].join(', '))?.innerText?.trim() || '';

      const location = card.querySelector([
        '.job-card-container__metadata-item',
        '[class*="metadata-item"]',
        '[class*="location"]'
      ].join(', '))?.innerText?.trim() || '';

      const url = `https://www.linkedin.com/jobs/view/${jobId}/`;

      results.push({
        title:   title   || `Job #${jobId}`,
        company: company || '—',
        location,
        url,
        jobId
      });
    });

    return results;
  }

})();
