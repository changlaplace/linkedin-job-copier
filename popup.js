// LinkedIn Job Copier — Popup Logic
document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);

  const statusDot      = $('statusDot');
  const notLinkedIn    = $('notLinkedIn');
  const mainContent    = $('mainContent');
  const currentCard    = $('currentJobCard');
  const copyCurrentBtn = $('copyCurrentBtn');
  const copyMinimalBtn = $('copyMinimalBtn');
  const clearSavedBtn  = $('clearSavedBtn');
  const savedJobsLabel = $('savedJobsLabel');
  const currentSection = $('currentJobSection');
  const currentDivider = $('currentJobDivider');
  const jobList        = $('jobList');
  const jobListState   = $('jobListState');
  const listActions    = $('listActions');
  const copyAllBtn     = $('copyAllBtn');
  const exportCsvBtn   = $('exportCsvBtn');

  let currentJob   = null;
  let savedJobs    = [];

  // ─── Get active tab ────────────────────────────────────────────────────────
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isLinkedIn = tab?.url?.includes('linkedin.com/jobs');
  await loadSavedJobs();

  if (!isLinkedIn) {
    statusDot.textContent = 'not on LinkedIn Jobs';
    statusDot.className   = 'status-dot status-dot--not-job';
    notLinkedIn.hidden    = false;
    mainContent.hidden    = false;
    currentSection.hidden = true;
    currentDivider.hidden = true;
  } else {

    mainContent.hidden = false;

  // ─── Inject content script if needed ──────────────────────────────────────
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    } catch (_) {}

    await sleep(400);

    loadCurrentJob();
  }

  // ─── Load current job ──────────────────────────────────────────────────────
  async function loadCurrentJob() {
    try {
      const resp = await sendMessage(tab.id, { action: 'scrapeCurrentJob' });
      if (resp && resp.title && resp.title !== 'N/A') {
        currentJob = resp;
        renderCurrentJob(resp);
        statusDot.textContent   = 'ready';
        statusDot.className     = 'status-dot status-dot--ready';
        copyCurrentBtn.disabled = false;
        copyMinimalBtn.disabled = false;
      } else {
        currentCard.innerHTML   = `<p class="job-card__loading" style="color:#8b949e">No job selected — click a job listing first.</p>`;
        statusDot.textContent   = 'no job selected';
        statusDot.className     = 'status-dot status-dot--not-job';
      }
    } catch (e) {
      currentCard.innerHTML = `<p class="job-card__loading" style="color:#f87171">Could not read page. Try refreshing.</p>`;
    }
  }

  // ─── Saved jobs ────────────────────────────────────────────────────────────
  async function loadSavedJobs() {
    const data = await chrome.storage.local.get({ savedJobs: [] });
    savedJobs = data.savedJobs;
    savedJobsLabel.textContent = `Saved Jobs (${savedJobs.length})`;
    clearSavedBtn.hidden = savedJobs.length === 0;
    jobListState.hidden = savedJobs.length > 0;
    jobList.hidden = savedJobs.length === 0;
    listActions.hidden = savedJobs.length === 0;
    if (savedJobs.length) renderJobList(savedJobs);
  }

  async function saveCurrentJob() {
    if (!currentJob) return;
    const job = {
      jobId: currentJob.jobId || null,
      title: currentJob.title,
      company: currentJob.company,
      location: currentJob.location === 'N/A' ? '' : currentJob.location,
      url: currentJob.url,
      description: currentJob.description || '',
      fullText: currentJob.fullText || '',
      copiedAt: Date.now()
    };
    const key = job.jobId || job.url;
    await chrome.storage.local.set({
      savedJobs: [job, ...savedJobs.filter(saved => (saved.jobId || saved.url) !== key)]
    });
    await loadSavedJobs();
  }

  // ─── Render current job card ───────────────────────────────────────────────
  function renderCurrentJob(job) {
    const preview = job.description
      ? job.description.slice(0, 200) + (job.description.length > 200 ? '…' : '')
      : 'No description found';
    currentCard.innerHTML = `
      <div class="job-card__title">${escHtml(job.title)}</div>
      <div class="job-card__company">${escHtml(job.company)}</div>
      ${job.location ? `<div class="job-card__location">${escHtml(job.location)}</div>` : ''}
      <div class="job-card__desc-preview">${escHtml(preview)}</div>
    `;
  }

  // ─── Copy current job ──────────────────────────────────────────────────────
  copyCurrentBtn.addEventListener('click', async () => {
    if (!currentJob) return;
    await clipboardWrite(currentJob.fullText);
    await saveCurrentJob();
    flashBtn(copyCurrentBtn, '✓ Copied!');
  });

  copyMinimalBtn.addEventListener('click', async () => {
    if (!currentJob) return;
    const summary = [
      `Title: ${currentJob.title}`,
      `Company: ${currentJob.company}`,
      currentJob.location && currentJob.location !== 'N/A' ? `Location: ${currentJob.location}` : '',
      `URL: ${currentJob.url}`
    ].filter(Boolean).join('\n');
    await clipboardWrite(summary);
    await saveCurrentJob();
    flashBtn(copyMinimalBtn, '✓ Copied!');
  });

  // ─── Clear saved jobs ──────────────────────────────────────────────────────
  clearSavedBtn.addEventListener('click', async () => {
    if (!confirm('Clear all saved jobs?')) return;
    await chrome.storage.local.set({ savedJobs: [] });
    await loadSavedJobs();
  });

  // ─── Render job list ───────────────────────────────────────────────────────
  function renderJobList(jobs) {
    jobList.innerHTML = '';   // ✅ always clear first

    jobs.forEach((job, i) => {
      const item = document.createElement('div');
      item.className = 'job-list-item';
      item.innerHTML = `
        <span class="job-list-item__num">${i + 1}</span>
        <div class="job-list-item__info">
          <div class="job-list-item__title">${escHtml(job.title || 'Untitled')}</div>
          <div class="job-list-item__meta">${escHtml(job.company + (job.location ? ' · ' + job.location : ''))}</div>
        </div>
        <button class="job-list-item__copy" data-idx="${i}">Copy</button>
      `;

      item.querySelector('.job-list-item__copy').addEventListener('click', async e => {
        e.stopPropagation();
        const j    = savedJobs[i];
        const text = `Title: ${j.title}\nCompany: ${j.company}${j.location ? '\nLocation: ' + j.location : ''}\nURL: ${j.url}`;
        await clipboardWrite(text);
        const btn = e.target;
        btn.textContent = '✓';
        setTimeout(() => btn.textContent = 'Copy', 1500);
      });

      item.addEventListener('click', () => {
        if (job.url) chrome.tabs.update(tab.id, { url: job.url });
      });

      jobList.appendChild(item);
    });
  }

  // ─── Copy all ──────────────────────────────────────────────────────────────
  copyAllBtn.addEventListener('click', async () => {
    if (!savedJobs.length) return;
    const text = savedJobs.map((j, i) =>
      `${i + 1}. ${j.fullText || `${j.title}\nCompany: ${j.company}${j.location ? '\nLocation: ' + j.location : ''}\nURL: ${j.url}`}`
    ).join('\n\n');
    const full = `LinkedIn Jobs Export — ${new Date().toLocaleDateString()}\n${'─'.repeat(50)}\n\n${text}`;
    await clipboardWrite(full);
    flashBtn(copyAllBtn, '✓ Copied All!');
  });

  // ─── Export CSV ────────────────────────────────────────────────────────────
  exportCsvBtn.addEventListener('click', () => {
    if (!savedJobs.length) return;
    const headers = ['#', 'Title', 'Company', 'Location', 'URL', 'Description'];
    const rows    = savedJobs.map((j, i) => [
      i + 1, csvEscape(j.title), csvEscape(j.company), csvEscape(j.location), csvEscape(j.url),
      csvEscape(j.description || j.fullText || '')
    ]);
    const csv  = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `linkedin-jobs-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function sendMessage(tabId, msg) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, msg, resp => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(resp);
      });
    });
  }

  async function clipboardWrite(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  function flashBtn(btn, msg) {
    const orig = btn.textContent;
    btn.textContent = msg;
    btn.classList.add('btn--flashed');
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove('btn--flashed');
    }, 1800);
  }

  function escHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function csvEscape(str) {
    if (!str) return '';
    return `"${str.replace(/"/g, '""')}"`;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
});
