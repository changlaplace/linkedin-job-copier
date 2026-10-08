(function () {
  'use strict';

  if (window.__ljcInjected) return;
  window.__ljcInjected = true;

  const BUTTON_ID = 'ljc-copy-btn';
  const BATCH_CONTROL_ID = 'ljc-batch-controls';
  const BATCH_BUTTON_ID = 'ljc-save-page-btn';
  const PAGE_COUNT_ID = 'ljc-page-count';
  const TOAST_ID  = 'ljc-toast';
  const JOB_CARD_SELECTOR = '[role="button"][componentkey^="job-card-component-ref-"]';
  let batchRunning = false;
  let batchCancelled = false;
  let batchProgress = '';
  let batchPageLimit = '1';

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

  async function cacheCurrentJob(expectedJobId = null) {
    const jobId = getCurrentJobId();
    const description = extractDescription() || '';
    if (expectedJobId && jobId !== expectedJobId) {
      throw new Error(`Expected job ${expectedJobId}, got ${jobId || 'none'}`);
    }
    if (!jobId || description.trim().length < 80) {
      throw new Error('Full job description is not ready');
    }
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
    return job;
  }

  function findDescriptionEl() {
    const jobId = getCurrentJobId();
    if (jobId && /^\d+$/.test(jobId)) {
      const currentDescription = findDescriptionElForJob(jobId);
      if (currentDescription) return currentDescription;
    }
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

  function findDescriptionElForJob(jobId) {
    return document.querySelector(
      `[componentkey="JobDetails_AboutTheJob_${jobId}"], #JobDetails_AboutTheJob_${jobId}`
    );
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

  function getJobIdFromCard(card) {
    return card?.getAttribute('componentkey')?.match(/job-card-component-ref-(\d+)$/)?.[1]
      || card?.dataset?.occludableJobId
      || card?.dataset?.jobId
      || null;
  }

  function getJobCards() {
    const cards = document.querySelectorAll(
      `${JOB_CARD_SELECTOR}, [data-occludable-job-id], [data-job-id]`
    );
    const seen = new Set();
    return [...cards].filter(card => {
      const jobId = getJobIdFromCard(card);
      if (!jobId || seen.has(jobId)) return false;
      seen.add(jobId);
      return true;
    });
  }

  function findJobCard(jobId) {
    return getJobCards().find(card => getJobIdFromCard(card) === jobId) || null;
  }

  function markJobCard(jobId, saved = true) {
    const card = findJobCard(jobId);
    if (!card) return;
    card.classList.toggle('ljc-job-card--saved', saved);
    let mark = card.querySelector(':scope > .ljc-job-saved-mark');
    if (saved && !mark) {
      mark = document.createElement('span');
      mark.className = 'ljc-job-saved-mark';
      mark.textContent = '\u2713';
      mark.title = 'Full job description saved';
      mark.setAttribute('aria-label', 'Full job description saved');
      card.prepend(mark);
    } else if (!saved && mark) {
      mark.remove();
    }
  }

  async function refreshSavedMarkers() {
    const { savedJobs = [] } = await chrome.storage.local.get({ savedJobs: [] });
    const savedIds = new Set(savedJobs
      .filter(job => job.jobId && (job.description || '').trim().length >= 80)
      .map(job => String(job.jobId)));
    getJobCards().forEach(card => {
      const jobId = getJobIdFromCard(card);
      markJobCard(jobId, savedIds.has(jobId));
    });
  }

  function waitForJobDescription(jobId, timeoutMs = 12000) {
    return new Promise(resolve => {
      const startedAt = Date.now();
      const check = () => {
        const usesNewJobCards = Boolean(document.querySelector(JOB_CARD_SELECTOR));
        const expectedDescription = findDescriptionElForJob(jobId);
        const description = getCurrentJobId() === jobId
          ? (usesNewJobCards ? expectedDescription?.innerText : extractDescription())
          : '';
        if (description && description.trim().length >= 80) return resolve(true);
        if (Date.now() - startedAt >= timeoutMs) return resolve(false);
        setTimeout(check, 200);
      };
      check();
    });
  }

  function updateBatchControls() {
    const button = document.getElementById(BATCH_BUTTON_ID);
    const input = document.getElementById(PAGE_COUNT_ID);
    if (button) button.textContent = batchRunning ? `Stop \u2014 ${batchProgress}` : 'Save jobs';
    if (input) input.disabled = batchRunning;
  }

  function getPageSignature() {
    return getJobCards().map(getJobIdFromCard).join(',');
  }

  function findNextPageButton() {
    const list = document.querySelector('[componentkey="SearchResultsMainContent"]');
    return [...(list?.querySelectorAll('button') || [])].find(button =>
      button.innerText?.trim().toLowerCase() === 'next'
      && !button.disabled
      && button.getAttribute('aria-disabled') !== 'true'
    ) || null;
  }

  function waitForNextPage(previousSignature, previousStart, timeoutMs = 15000) {
    return new Promise(resolve => {
      const startedAt = Date.now();
      let candidateSignature = '';
      let stableSince = 0;
      const check = () => {
        if (batchCancelled) return resolve(false);
        const signature = getPageSignature();
        const start = new URL(window.location.href).searchParams.get('start') || '0';
        if (signature && signature !== previousSignature && start !== previousStart) {
          if (signature !== candidateSignature) {
            candidateSignature = signature;
            stableSince = Date.now();
          } else if (Date.now() - stableSince >= 800) {
            return resolve(true);
          }
        }
        if (Date.now() - startedAt >= timeoutMs) return resolve(false);
        setTimeout(check, 250);
      };
      check();
    });
  }

  async function goToNextPage() {
    const next = findNextPageButton();
    if (!next) return false;
    const previousSignature = getPageSignature();
    const previousStart = new URL(window.location.href).searchParams.get('start') || '0';
    next.click();
    return waitForNextPage(previousSignature, previousStart);
  }

  async function saveJobsOnPage(btn) {
    if (batchRunning) {
      batchCancelled = true;
      batchProgress = 'Stopping after this job\u2026';
      updateBatchControls();
      return;
    }

    const input = document.getElementById(PAGE_COUNT_ID);
    const parsedPages = Number.parseInt(input?.value || '1', 10);
    const requestedPages = Number.isFinite(parsedPages) && parsedPages >= 0 ? parsedPages : 1;
    batchPageLimit = String(requestedPages);
    const unlimited = requestedPages === 0;
    if (!getJobCards().length) {
      showToast('No jobs found on this page', 'error');
      return;
    }

    batchRunning = true;
    batchCancelled = false;
    let saved = 0;
    let failed = 0;
    let pagesProcessed = 0;
    const seenPages = new Set();

    while (!batchCancelled && (unlimited || pagesProcessed < requestedPages)) {
      const pageSignature = getPageSignature();
      if (!pageSignature || seenPages.has(pageSignature)) break;
      seenPages.add(pageSignature);
      pagesProcessed++;

      const jobIds = getJobCards().map(getJobIdFromCard);
      for (let i = 0; i < jobIds.length && !batchCancelled; i++) {
        const jobId = jobIds[i];
        batchProgress = `Page ${pagesProcessed}, job ${i + 1}/${jobIds.length}`;
        updateBatchControls();
        const card = findJobCard(jobId);
        if (!card) {
          failed++;
          continue;
        }

        try {
          card.click();
          const ready = await waitForJobDescription(jobId);
          if (!ready) throw new Error('Description did not load');
          await cacheCurrentJob(jobId);
          markJobCard(jobId, true);
          saved++;
        } catch (_) {
          failed++;
        }
      }

      if (batchCancelled || (!unlimited && pagesProcessed >= requestedPages)) break;
      batchProgress = `Opening page ${pagesProcessed + 1}\u2026`;
      updateBatchControls();
      if (!await goToNextPage()) break;
      await refreshSavedMarkers();
    }

    const wasCancelled = batchCancelled;
    batchRunning = false;
    batchCancelled = false;
    batchProgress = '';
    updateBatchControls();
    await refreshSavedMarkers();
    showToast(
      wasCancelled
        ? `Stopped: ${saved} jobs saved across ${pagesProcessed} page(s)`
        : `${saved} jobs saved across ${pagesProcessed} page(s)${failed ? `, ${failed} failed` : ''}`,
      failed ? 'error' : 'success'
    );
  }

  function injectBatchButton() {
    if (document.getElementById(BATCH_CONTROL_ID)) return;
    const list = document.querySelector('[componentkey="SearchResultsMainContent"]');
    if (!list || !getJobCards().length) return;

    const controls = document.createElement('div');
    controls.id = BATCH_CONTROL_ID;
    controls.className = 'ljc-batch-controls';

    const label = document.createElement('label');
    label.htmlFor = PAGE_COUNT_ID;
    label.textContent = 'Pages (0 = all)';

    const input = document.createElement('input');
    input.id = PAGE_COUNT_ID;
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.value = batchPageLimit;
    input.title = 'Number of pages to save; use 0 to continue until the last page';

    const btn = document.createElement('button');
    btn.id = BATCH_BUTTON_ID;
    btn.className = 'ljc-batch-btn';
    btn.title = 'Open each job, cache its full description, then continue to the next page';
    btn.addEventListener('click', () => saveJobsOnPage(btn));

    controls.append(label, input, btn);
    list.prepend(controls);
    updateBatchControls();
  }

  function refreshPageControls() {
    injectButton();
    injectBatchButton();
    refreshSavedMarkers().catch(() => {});
  }

  // ─── SPA navigation ────────────────────────────────────────────────────────
  let lastUrl = location.href;
  function onUrlChange() {
    const current = location.href;
    if (current !== lastUrl) {
      lastUrl = current;
      const old = document.getElementById(BUTTON_ID);
      if (old) old.remove();
      [800, 1500, 2500, 4000].forEach(d => setTimeout(refreshPageControls, d));
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
    debounceTimer = setTimeout(refreshPageControls, 600);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  [1000, 2000, 3500].forEach(d => setTimeout(refreshPageControls, d));

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.savedJobs) refreshSavedMarkers().catch(() => {});
  });

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
    const cards = getJobCards();
    const seen = new Set();
    const results = [];

    cards.forEach(card => {
      const jobId = getJobIdFromCard(card);
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
