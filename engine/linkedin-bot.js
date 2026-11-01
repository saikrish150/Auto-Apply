const path = require('path');
const fs = require('fs');
const CareerSiteBot = require('./career-site-bot');

class LinkedInBot {
  constructor(chromeManager, aiAgent, settings, logger, dataStore = null) {
    this.chrome = chromeManager;
    this.ai = aiAgent;
    this.settings = settings;
    this.logger = logger;
    this.dataStore = dataStore;
    this.shouldStop = false;
    this.seenJobKeys = new Set();
    this.careerSiteBot = new CareerSiteBot(chromeManager, aiAgent, settings, logger, dataStore);
    this.resumePath = this.resolveResumePath();
  }

  resolveResumePath() {
    const candidates = [
      path.join(__dirname, '..', 'config', 'resume.pdf'),
      path.join(__dirname, '..', 'config', 'Sai_Krishna_Resume.pdf'),
      this.ai?.profile?.personal?.resumePath,
      'D:\\Downloads\\Sai_Krishna_G_Resume.pdf'
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c;
    }
    return null;
  }

  // Ensure candidate resume is selected or uploaded in Easy Apply modal
  async handleResumeStep(page) {
    try {
      const dialogHandle = (await page.$('dialog, [role="dialog"], .jobs-easy-apply-modal, .artdeco-modal')) || page;
      const resumeInfo = await dialogHandle.evaluate(el => {
        const radios = Array.from(el.querySelectorAll('input[type="radio"][id*="resume"], .jobs-document-upload input[type="radio"]'));
        const anyChecked = radios.some(r => r.checked);
        const fileInput = el.querySelector('input[type="file"]');
        return { hasRadios: radios.length > 0, anyChecked, hasFileInput: !!fileInput };
      });

      if (resumeInfo.hasRadios && !resumeInfo.anyChecked) {
        await dialogHandle.evaluate(el => {
          const radios = Array.from(el.querySelectorAll('input[type="radio"][id*="resume"], .jobs-document-upload input[type="radio"]'));
          if (radios.length > 0) {
            const r = radios[0];
            r.click();
            r.checked = true;
            const l = r.id ? el.querySelector(`label[for="${r.id}"]`) : r.closest('label');
            if (l) l.click();
            r.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
        this.logger('action', 'LinkedIn', 'Selected candidate resume in Easy Apply modal.');
        await this.randomDelay(400, 800);
      } else if (resumeInfo.hasFileInput && (!resumeInfo.hasRadios || !resumeInfo.anyChecked)) {
        const fileInputHandle = await dialogHandle.$('input[type="file"]');
        if (fileInputHandle && this.resumePath && fs.existsSync(this.resumePath)) {
          await fileInputHandle.uploadFile(this.resumePath);
          this.logger('success', 'LinkedIn', `Uploaded candidate resume PDF (${path.basename(this.resumePath)}) in Easy Apply modal.`);
          await this.randomDelay(1200, 2000);
        }
      }
    } catch (e) {
      // Resume step best effort
    }
  }

  // Dismiss and discard modal cleanly so background cards aren't occluded
  async dismissAndDiscardModal(page) {
    try {
      await page.evaluate(() => {
        const modal = document.querySelector('dialog, [role="dialog"], .jobs-easy-apply-modal, .artdeco-modal') || document;
        const dismissBtn = modal.querySelector('button[aria-label*="Dismiss"], button.artdeco-modal__dismiss, [data-control-name="overlay.close_padding"]');
        if (dismissBtn) dismissBtn.click();
      });
      await this.randomDelay(600, 1000);

      await page.evaluate(() => {
        const confirmDialog = document.querySelector('[data-test-modal-container], .artdeco-modal, [role="dialog"]') || document;
        const buttons = Array.from(confirmDialog.querySelectorAll('button'));
        const discard = buttons.find(b => {
          const txt = (b.innerText || '').toLowerCase();
          const ctrl = (b.getAttribute('data-control-name') || '').toLowerCase();
          return txt.includes('discard') || ctrl.includes('discard');
        });
        if (discard) discard.click();
      });
      await page.keyboard.press('Escape').catch(() => {});
      await this.randomDelay(400, 800);
    } catch (e) {
      // Best-effort cleanup
    }
  }

  stop() {
    this.shouldStop = true;
  }

  // Helper for human-like delay
  async randomDelay(min = 1500, max = 3000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(r => setTimeout(r, delay));
  }

  // Get freshness filter for LinkedIn (1h = r3600, 2h = r7200, 24h = r86400, 48h = r172800, week = r604800) + Sort by most recent
  getDateFilterParam(datePosted) {
    switch (datePosted) {
      case 'past_1h':
        return 'f_TPR=r3600&sortBy=DD';
      case 'past_2h':
        return 'f_TPR=r7200&sortBy=DD';
      case 'past_24h':
        return 'f_TPR=r86400&sortBy=DD';
      case 'past_48h':
        return 'f_TPR=r172800&sortBy=DD';
      case 'past_week':
        return 'f_TPR=r604800&sortBy=DD';
      case 'all':
        return 'sortBy=DD';
      default:
        return 'f_TPR=r86400&sortBy=DD';
    }
  }

  // Get experience level filter for LinkedIn (1: Internship, 2: Entry level, 3: Associate, 4: Mid-Senior)
  getExperienceFilterParam(expSetting) {
    const raw = String(expSetting || '').toLowerCase();
    if (raw === 'all' || !raw) return '';
    if (raw.includes('1-4') || raw.includes('1 to 4') || (raw.includes('entry') && raw.includes('associate'))) {
      return 'f_E=2,3';
    }
    if (raw.includes('entry') && !raw.includes('mid')) {
      return 'f_E=2';
    }
    if (raw.includes('associate')) {
      return 'f_E=3';
    }
    if (raw.includes('mid') && !raw.includes('entry')) {
      return 'f_E=4';
    }
    // Default optimal for 1-4 years candidate profile: Entry level (2) & Associate (3)
    return 'f_E=2,3';
  }

  // Get active scenario list from settings
  getScenarios() {
    if (this.settings.search?.scenarios && Array.isArray(this.settings.search.scenarios) && this.settings.search.scenarios.length > 0) {
      return this.settings.search.scenarios;
    }
    const raw = this.settings.search?.keywords || 'Full Stack Developer';
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }

  async run(onJobProcessed) {
    this.shouldStop = false;
    this.logger('info', 'LinkedIn', 'Connecting to Chrome session for LinkedIn automation...');

    const page = await this.chrome.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
      const scenarios = this.getScenarios();
      const dateFilter = this.getDateFilterParam(this.settings.search?.datePosted);
      const expFilter = this.getExperienceFilterParam(this.settings.search?.experienceLevel);
      const expParam = expFilter ? `${expFilter}&` : '';
      const maxApps = this.settings.automation?.maxApplicationsPerSession || 25;
      const maxPages = this.settings.automation?.maxPagesPerScenario || 2;
      let totalProcessedCount = 0;

      // Load historical seen keys to avoid re-processing or re-checking duplicates
      if (this.dataStore && typeof this.dataStore.getProcessedKeys === 'function') {
        const historicalKeys = this.dataStore.getProcessedKeys();
        historicalKeys.forEach(k => this.seenJobKeys.add(k));
        this.logger('info', 'LinkedIn', `Loaded ${historicalKeys.size} historical job records to prevent duplicate applications.`);
      }

      const shortlistNonEasyApply = this.settings.automation?.shortlistNonEasyApplyJobs !== false;
      const phases = [
        { name: 'Easy Apply', easyApplyOnly: true }
      ];
      if (shortlistNonEasyApply) {
        phases.push({ name: 'Normal Jobs Discovery', easyApplyOnly: false });
      }

      this.logger('info', 'LinkedIn', `LinkedIn bot initialized with ${scenarios.length} scenarios (All Locations / Worldwide). Freshness: ${this.settings.search?.datePosted || 'past_24h'}. Exp Filter: ${expFilter || 'All'}. Dual-Phase: ${shortlistNonEasyApply ? 'Easy Apply + Normal Shortlisting' : 'Easy Apply Only'}.`);

      for (let sIdx = 0; sIdx < scenarios.length; sIdx++) {
        if (this.shouldStop || totalProcessedCount >= maxApps) break;

        const currentScenario = scenarios[sIdx];

        for (const phase of phases) {
          if (this.shouldStop || totalProcessedCount >= maxApps) break;

          const phaseLabel = phase.easyApplyOnly ? '⚡ Easy Apply' : '⭐ Normal Jobs Discovery';
          this.logger('action', 'LinkedIn', `[Scenario ${sIdx + 1}/${scenarios.length}] Commencing ${phaseLabel} for "${currentScenario}"...`);

          for (let pageNum = 0; pageNum < maxPages; pageNum++) {
            if (this.shouldStop || totalProcessedCount >= maxApps) break;

            const startParam = pageNum > 0 ? `&start=${pageNum * 25}` : '';
            const easyApplyParam = phase.easyApplyOnly ? 'f_AL=true&' : '';
            const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(currentScenario)}&${easyApplyParam}${expParam}${dateFilter}${startParam}`;

            this.logger('info', 'LinkedIn', `[${phase.name} | Page ${pageNum + 1}] Searching: "${currentScenario}" (All Locations | Freshness: ${this.settings.search?.datePosted || 'past_24h'})...`);
            
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
            await this.randomDelay(3000, 4500);

            // Verify login state
            const cookies = await page.cookies();
            const hasLiAt = cookies.some(c => c.name === 'li_at' && c.value && c.value.length > 5);

            const authState = await page.evaluate(() => {
              const url = window.location.href;
              const isAuthwall = url.includes('authwall') || url.includes('/login') || url.includes('checkpoint');
              const hasSignInBtn = !!document.querySelector('a.nav__button-secondary, .nav__button-tertiary, .sign-in-modal__outlet-btn');
              const hasLoggedInNav = !!document.querySelector('.global-nav__me, .profile-nav-item, #global-nav, .global-nav__user, button[aria-label*="Me"], img[alt*="Sai Krishna"], .nav-item--me');
              return {
                isLoggedInDOM: hasLoggedInNav && !hasSignInBtn,
                isAuthwall
              };
            });

            const isLoggedIn = hasLiAt || authState.isLoggedInDOM || !authState.isAuthwall;

            if (!isLoggedIn) {
              this.logger('warning', 'LinkedIn', 'LinkedIn session detected as Guest. Please make sure you are signed into LinkedIn in Chrome for Easy Apply.');
            } else if (sIdx === 0 && pageNum === 0 && phase.easyApplyOnly) {
              this.logger('success', 'LinkedIn', 'Active LinkedIn session confirmed.');
            }

            // Human-like smooth scroll down the left job list to trigger lazy-loaded cards
            await page.evaluate(async () => {
              const listEl = document.querySelector('.jobs-search-results-list, .scaffold-layout__list-detail, body');
              if (listEl) {
                for (let s = 0; s < 4; s++) {
                  listEl.scrollBy({ top: 450, behavior: 'smooth' });
                  await new Promise(r => setTimeout(r, 400));
                }
              }
            });
            await this.randomDelay(1000, 2000);

            // Find job cards
            let jobCards = await page.$$(
              '.jobs-search-results__list-item, .job-card-container, .jobs-search__results-list li, .base-card, .job-search-card, .scaffold-layout__list-item, [data-occludable-job-id]'
            );
            if (!jobCards || jobCards.length === 0) {
              jobCards = await page.$$('a[href*="/jobs/view/"]');
            }

            this.logger('info', 'LinkedIn', `[${phase.name}] Found ${jobCards.length} matching job cards on page ${pageNum + 1} for "${currentScenario}".`);

            if (jobCards.length === 0) {
              this.logger('info', 'LinkedIn', `No more jobs found for scenario "${currentScenario}" in ${phase.name}.`);
              break;
            }

            for (let i = 0; i < jobCards.length; i++) {
              if (this.shouldStop || totalProcessedCount >= maxApps) break;

              try {
                const card = jobCards[i];

                // Fast pre-click DOM inspection: check applied status, job ID, and title/company
                const cardPre = await card.evaluate(el => {
                  const text = el.innerText || '';
                  const appliedBadge = el.querySelector('.job-card-container__footer-item, [class*="status-badge"], [class*="job-state"], .artdeco-inline-feedback--success');
                  let isApplied = false;
                  if (appliedBadge) {
                    const bText = (appliedBadge.innerText || '').trim().toLowerCase();
                    isApplied = bText.includes('applied');
                  } else {
                    isApplied = /\bapplied(\s+\d+[a-z]+ ago|\s+on\s+.*)?$/im.test(text) && !/applied\s+(materials|intuition|ai|science|data)/i.test(text);
                  }
                  const hasEasyApply = /easy\s*apply/i.test(text);

                  const jobIdAttr = el.getAttribute('data-occludable-job-id') || el.getAttribute('data-job-id');
                  const link = el.querySelector('a[href*="/jobs/view/"], a.job-card-list__title, a.job-card-list__title--link, a.job-card-container__link');
                  const href = link ? link.href : '';
                  const idMatch = href.match(/\/jobs\/view\/(\d+)/);
                  const jobId = jobIdAttr || (idMatch ? idMatch[1] : '');

                  const titleEl = el.querySelector(
                    '.job-card-list__title--link, .job-card-list__title, .job-card-container__link, .artdeco-entity-lockup__title a, [data-view-name="job-card"] a, a[class*="job-title"], a[href*="/jobs/view/"], strong'
                  );
                  const compEl = el.querySelector(
                    '.job-card-container__primary-description, .artdeco-entity-lockup__subtitle, [class*="company-name"], [class*="subtitle"], a[href*="/company/"]'
                  );
                  const locEl = el.querySelector(
                    '.job-card-container__metadata-item, [class*="metadata-item"], [class*="job-card-container__bullet"], [class*="caption"]'
                  );

                  return {
                    jobId,
                    title: titleEl ? titleEl.innerText.trim() : '',
                    company: compEl ? compEl.innerText.trim() : '',
                    location: locEl ? locEl.innerText.trim() : '',
                    href,
                    isApplied,
                    hasEasyApply
                  };
                });

                const rawTitle = (cardPre.title || '').trim();
                const rawComp = (cardPre.company || '').trim();
                const titleKey = (rawTitle && rawComp) ? `${rawTitle.toLowerCase()}|${rawComp.toLowerCase()}` : '';
                const isGenericKey = !titleKey || titleKey.startsWith('software developer|company') || titleKey === '|';

                // 1. Skip if already applied
                if (cardPre.isApplied) {
                  this.logger('info', 'LinkedIn', `[Pre-check] Skipping "${rawTitle || 'Job'}" at ${rawComp} - card shows already applied.`);
                  if (cardPre.jobId) this.seenJobKeys.add(cardPre.jobId);
                  if (titleKey && !isGenericKey) this.seenJobKeys.add(titleKey);
                  continue;
                }

                // 2. Skip if already seen in historical confirmed applications
                if ((cardPre.jobId && this.seenJobKeys.has(cardPre.jobId)) || (titleKey && !isGenericKey && this.seenJobKeys.has(titleKey))) {
                  this.logger('info', 'LinkedIn', `[Pre-check] Skipping "${rawTitle || 'Job'}" at ${rawComp} - already processed.`);
                  continue;
                }

                // Click card to load job details in the right pane
                await card.evaluate(el => {
                  el.scrollIntoView({ block: 'center', inline: 'nearest' });
                  el.click();
                });

                // Wait for the detail pane content to render (up to 3.5 seconds)
                await page.waitForFunction(() => {
                  const detailPane = document.querySelector('.scaffold-layout__detail, .jobs-search__job-details, .job-view-layout, main') || document;
                  const descEl = detailPane.querySelector('.jobs-description__content, #job-details, .show-more-less-html__markup, [class*="description"]');
                  const titleEl = detailPane.querySelector('.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1, h2, [class*="job-title"]');
                  const hasDesc = descEl && (descEl.innerText || '').trim().length > 30;
                  const hasTitle = titleEl && (titleEl.innerText || '').trim().length > 3;
                  return hasDesc || hasTitle;
                }, { timeout: 3500 }).catch(() => {});
                await this.randomDelay(800, 1500);

                // Extract job details from right-hand details pane with robust fallback to cardPre
                const jobDetails = await page.evaluate((fallbackMeta, scenarioName) => {
                  const detailPane = document.querySelector('.scaffold-layout__detail, .jobs-search__job-details, .job-view-layout, main') || document;
                  const topCard = detailPane.querySelector('.job-details-jobs-unified-top-card, .jobs-unified-top-card, [class*="top-card"]') || detailPane;

                  const titleEl = topCard.querySelector(
                    '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1.t-24, h1, h2, .top-card-layout__title, [class*="job-title"]'
                  ) || document.querySelector('.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1');

                  const companyEl = topCard.querySelector(
                    '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, [class*="company-name"], a[href*="/company/"], .topcard__flavor'
                  ) || document.querySelector('.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name');

                  const locationEl = topCard.querySelector(
                    '.job-details-jobs-unified-top-card__bullet, .jobs-unified-top-card__bullet, [class*="bullet"], .topcard__flavor--bullet'
                  );

                  const descEl = detailPane.querySelector(
                    '#job-details, .jobs-description__content, .jobs-description-content__text, .show-more-less-html__markup, [class*="description"]'
                  ) || document.querySelector('#job-details, .jobs-description__content');

                  const isJunkScrape = (t) => /^(people you can reach out to|take the next step.*|about the job|\d+\s*notifications|notifications|more jobs|jobs you may be interested in)$/i.test((t || '').trim());
                  let title = (titleEl && titleEl.innerText.trim().length > 2 && !isJunkScrape(titleEl.innerText)) ? titleEl.innerText.trim() : '';
                  if (!title && fallbackMeta.title && fallbackMeta.title.length > 2 && !isJunkScrape(fallbackMeta.title)) {
                    title = fallbackMeta.title;
                  }
                  if (!title) {
                    title = scenarioName || 'Full Stack Developer';
                  }

                  let company = (companyEl && companyEl.innerText.trim().length > 1) ? companyEl.innerText.trim() : '';
                  if (!company && fallbackMeta.company && fallbackMeta.company.length > 1) {
                    company = fallbackMeta.company;
                  }
                  if (!company) {
                    company = 'Direct Employer';
                  }

                  const location = (locationEl && locationEl.innerText.trim().length > 1) ? locationEl.innerText.trim() : (fallbackMeta.location || 'India');
                  let description = descEl ? descEl.innerText.trim() : '';

                  if (!description || description.length < 25) {
                    description = `${title} role at ${company} in ${location}. Involves ${scenarioName}, Angular, Java Spring Boot, REST APIs, Microservices development.`;
                  }

                  return { title, company, location, description };
                }, { title: rawTitle, company: rawComp, location: cardPre.location }, currentScenario);

                this.logger('info', 'LinkedIn', `[${phase.name}] Evaluating: "${jobDetails.title}" at ${jobDetails.company}...`);

                // Auto-harvest any recruiter emails mentioned in job description
                if (this.dataStore && this.dataStore.recruiterEmails && jobDetails.description) {
                  const extracted = this.dataStore.recruiterEmails.extractEmailsFromText(jobDetails.description, {
                    title: jobDetails.title,
                    company: jobDetails.company,
                    url: page.url(),
                    platform: 'LinkedIn'
                  });
                  if (extracted.length > 0) {
                    this.logger('success', 'LinkedIn', `Found recruiter email (${extracted.map(e => e.email).join(', ')}) for "${jobDetails.title}"! Saved to Recruiter Outreach.`);
                  }
                }

                // AI match evaluation
                const evaluation = this.ai.evaluateJobMatch(jobDetails.title, jobDetails.description, jobDetails.company);

                const jobRecord = {
                  id: `li-${Date.now()}-${sIdx}-${i}`,
                  platform: 'LinkedIn',
                  scenario: currentScenario,
                  title: jobDetails.title,
                  company: jobDetails.company,
                  location: jobDetails.location,
                  url: page.url(),
                  matchScore: evaluation.score,
                  overallFitScore: evaluation.score,
                  technicalScore: evaluation.score,
                  evaluation,
                  status: 'evaluating',
                  timestamp: new Date().toISOString(),
                  questionsAnswered: []
                };

                if (!evaluation.isRecommended) {
                  this.logger('warning', 'LinkedIn', `Skipping "${jobDetails.title}" - ATS score ${evaluation.score}% below threshold ${this.settings.automation?.minMatchScore || 65}%.`);
                  jobRecord.status = 'skipped';
                  jobRecord.skipReason = `ATS score ${evaluation.score}% < threshold`;
                  if (onJobProcessed) onJobProcessed(jobRecord);
                  continue;
                }

                // Check Apply buttons in details pane
                const applyBtnInfo = await page.evaluate(() => {
                  function isVisible(el) {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                    const rect = el.getBoundingClientRect();
                    return (rect.width > 0 && rect.height > 0) || el.getClientRects().length > 0;
                  }

                  const detailPane = document.querySelector('.scaffold-layout__detail, .jobs-search__job-details, .job-view-layout, main') || document;
                  const listEl = document.querySelector('.jobs-search-results-list, .scaffold-layout__list');

                  // 1. Check if already applied
                  const appliedBadge = detailPane.querySelector('.jobs-s-apply__applied-badge, [class*="applied-badge"], .artdeco-inline-feedback--success');
                  if (appliedBadge && isVisible(appliedBadge) && /applied/i.test(appliedBadge.innerText)) {
                    return { status: 'already_applied' };
                  }

                  const buttons = Array.from(detailPane.querySelectorAll('button, a.jobs-apply-button, a[href*="/jobs/view/externalApply/"], a[aria-label*="Apply to"]'));
                  let hasEasy = false;
                  let hasExt = false;
                  let extHref = '';

                  for (const b of buttons) {
                    if (listEl && listEl.contains(b)) continue;
                    if (!isVisible(b)) continue;

                    const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                    const cls = (b.className || '').toLowerCase();
                    const href = (b.getAttribute('href') || '').toLowerCase();

                    if (txt.includes('already applied') || aria.includes('already applied')) {
                      return { status: 'already_applied' };
                    }
                    const isEasy = txt.includes('easy apply') || aria.includes('easy apply') || (cls.includes('jobs-apply-button') && !href.includes('external') && !txt.includes('company') && !aria.includes('company'));
                    if (isEasy) {
                      hasEasy = true;
                    }
                    const isExt = href.includes('externalapply') || aria.includes('company website') || txt.includes('company website') || txt.includes('apply on') || (b.tagName.toLowerCase() === 'a' && href.startsWith('http') && !isEasy);
                    if (isExt && !isEasy) {
                      hasExt = true;
                      extHref = b.href || href;
                    }
                  }

                  if (hasEasy) return { status: 'easy_apply' };
                  if (hasExt) return { status: 'external_apply', extHref };
                  return { status: 'none' };
                });

                if (applyBtnInfo.status === 'already_applied') {
                  this.logger('info', 'LinkedIn', `"${jobDetails.title}" is already applied.`);
                  jobRecord.status = 'already_applied';
                  if (cardPre.jobId) this.seenJobKeys.add(cardPre.jobId);
                  if (titleKey && !isGenericKey) this.seenJobKeys.add(titleKey);
                  if (onJobProcessed) onJobProcessed(jobRecord);
                  continue;
                }

                // PHASE 2: NORMAL JOBS DISCOVERY (WITHOUT EASY APPLY) -> SHORTLIST INTO MANUAL APPLY QUEUE
                if (!phase.easyApplyOnly) {
                  this.logger('success', 'LinkedIn', `[Manual Shortlist] High-fit normal job matched: "${jobDetails.title}" at ${jobDetails.company} (Score: ${evaluation.score}%). Adding to Manual Apply Queue...`);
                  
                  // If external apply button exists, click it to capture direct URL for manual queue
                  let directApplyUrl = page.url();
                  if (applyBtnInfo.status === 'external_apply') {
                    const extBtn = await page.evaluateHandle(() => {
                      function isVisible(el) {
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                        const rect = el.getBoundingClientRect();
                        return (rect.width > 0 && rect.height > 0) || el.getClientRects().length > 0;
                      }
                      const detailPane = document.querySelector('.scaffold-layout__detail, .jobs-search__job-details, .job-view-layout, main') || document;
                      const listEl = document.querySelector('.jobs-search-results-list, .scaffold-layout__list');
                      const links = Array.from(detailPane.querySelectorAll('a[href*="/jobs/view/externalApply/"], a[aria-label*="company website"], button[aria-label*="company website"], a[href*="http"], a.jobs-apply-button'));
                      return links.find(el => {
                        if (listEl && listEl.contains(el)) return false;
                        if (!isVisible(el)) return false;
                        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                        const href = (el.getAttribute('href') || '').toLowerCase();
                        if (txt.includes('easy apply') || aria.includes('easy apply')) return false;
                        return href.includes('externalapply') || aria.includes('company website') || txt.includes('company website') || (el.tagName.toLowerCase() === 'a' && href.startsWith('http'));
                      }) || null;
                    });
                    const extEl = extBtn.asElement();
                    if (extEl) {
                      const pagesBefore = await this.chrome.browser.pages();
                      await extEl.evaluate(b => b.click());
                      await this.randomDelay(2200, 3500);
                      const pagesAfter = await this.chrome.browser.pages();
                      const extTab = pagesAfter.find(p => !pagesBefore.includes(p));
                      if (extTab) {
                        directApplyUrl = extTab.url();
                        if (this.settings.automation?.closeCareerTabAfterSubmit !== false) {
                          await extTab.close().catch(() => {});
                        }
                      }
                    }
                  }

                  jobRecord.status = 'MANUAL_ACTION_REQUIRED';
                  jobRecord.actionRequired = true;
                  jobRecord.directApplicationUrl = directApplyUrl;
                  jobRecord.applicationMethod = 'manual_shortlist';
                  jobRecord.reason = `High match (${evaluation.score}%) - Shortlisted normal job application for manual submission`;
                  totalProcessedCount++;

                  if (cardPre.jobId) this.seenJobKeys.add(cardPre.jobId);
                  if (titleKey && !isGenericKey) this.seenJobKeys.add(titleKey);

                  if (onJobProcessed) onJobProcessed(jobRecord);
                  await this.randomDelay(1500, 2500);
                  continue;
                }

                // PHASE 1: EASY APPLY AUTO-APPLICATION OR EXTERNAL MANUAL SHORTLISTING
                if (this.settings.automation?.simulationMode) {
                  this.logger('simulation', 'LinkedIn', `[Simulation Mode] Simulating Easy Apply flow for "${jobDetails.title}"`);
                  await this.randomDelay(1500, 2500);
                  jobRecord.status = 'applied (simulated)';
                  totalProcessedCount++;
                  if (cardPre.jobId) this.seenJobKeys.add(cardPre.jobId);
                  if (titleKey && !isGenericKey) this.seenJobKeys.add(titleKey);
                  if (onJobProcessed) onJobProcessed(jobRecord);
                  continue;
                }

                if (!isLoggedIn) {
                  this.logger('warning', 'LinkedIn', `Cannot submit Easy Apply for "${jobDetails.title}" without active LinkedIn login.`);
                  jobRecord.status = 'MANUAL_ACTION_REQUIRED';
                  jobRecord.actionRequired = true;
                  jobRecord.directApplicationUrl = page.url();
                  jobRecord.reason = 'Active LinkedIn login required to complete Easy Apply';
                  if (onJobProcessed) onJobProcessed(jobRecord);
                  continue;
                }

                // If Easy Apply is NOT available, handle External Apply (User requested: only LinkedIn external links to be considered for manual data)
                if (applyBtnInfo.status !== 'easy_apply') {
                  const externalApplyBtn = await page.evaluateHandle(() => {
                    function isVisible(el) {
                      if (!el) return false;
                      const style = window.getComputedStyle(el);
                      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                      const rect = el.getBoundingClientRect();
                      return (rect.width > 0 && rect.height > 0) || el.getClientRects().length > 0;
                    }
                    const detailPane = document.querySelector('.scaffold-layout__detail, .jobs-search__job-details, .job-view-layout, main') || document;
                    const listEl = document.querySelector('.jobs-search-results-list, .scaffold-layout__list');
                    const links = Array.from(detailPane.querySelectorAll('a[href*="/jobs/view/externalApply/"], a[aria-label*="company website"], button[aria-label*="company website"], a[href*="http"], a.jobs-apply-button'));
                    return links.find(el => {
                      if (listEl && listEl.contains(el)) return false;
                      if (!isVisible(el)) return false;
                      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                      const href = (el.getAttribute('href') || '').toLowerCase();
                      if (txt.includes('easy apply') || aria.includes('easy apply')) return false;
                      return href.includes('externalapply') || aria.includes('company website') || txt.includes('company website') || (el.tagName.toLowerCase() === 'a' && href.startsWith('http'));
                    }) || null;
                  });

                  const extEl = externalApplyBtn.asElement();
                  if (extEl) {
                    this.logger('action', 'LinkedIn', `[LinkedIn External Link] Opening company apply link for "${jobDetails.title}"...`);
                    const pagesBefore = await this.chrome.browser.pages();
                    await extEl.evaluate(b => b.click());
                    await this.randomDelay(2500, 4000);

                    const pagesAfter = await this.chrome.browser.pages();
                    const externalTab = pagesAfter.find(p => !pagesBefore.includes(p));
                    let extUrl = page.url();

                    if (externalTab) {
                      extUrl = externalTab.url();
                      this.logger('success', 'LinkedIn', `Company career portal opened: ${extUrl}`);
                      jobRecord.externalUrl = extUrl;
                      jobRecord.directApplicationUrl = extUrl;

                      if (this.settings.automation?.closeCareerTabAfterSubmit !== false) {
                        try {
                          await this.randomDelay(2000, 3000);
                          if (!externalTab.isClosed()) await externalTab.close();
                        } catch (e) {}
                      } else {
                        this.logger('info', 'LinkedIn', `Tab retained for manual inspection: ${extUrl}`);
                      }
                    }

                    jobRecord.status = 'MANUAL_ACTION_REQUIRED';
                    jobRecord.actionRequired = true;
                    jobRecord.directApplicationUrl = extUrl;
                    jobRecord.applicationMethod = 'manual_shortlist';
                    jobRecord.reason = `High match (${evaluation.score}%) - LinkedIn external employer application preserved in Manual Apply Queue`;
                    totalProcessedCount++;

                    if (cardPre.jobId) this.seenJobKeys.add(cardPre.jobId);
                    if (titleKey && !isGenericKey) this.seenJobKeys.add(titleKey);

                    if (onJobProcessed) onJobProcessed(jobRecord);
                    this.logger('success', 'LinkedIn', `Preserved "${jobDetails.title}" at ${jobDetails.company} in Manual Apply Queue.`);
                    await this.randomDelay(1500, 2500);
                    continue;
                  }

                  this.logger('info', 'LinkedIn', `Neither Easy Apply nor External Apply button found for "${jobDetails.title}".`);
                  jobRecord.status = 'skipped';
                  jobRecord.skipReason = 'No applicable apply button';
                  if (onJobProcessed) onJobProcessed(jobRecord);
                  continue;
                }

                // Find Easy Apply button Handle
                const easyApplyBtnHandle = await page.evaluateHandle(() => {
                  function isVisible(el) {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                    const rect = el.getBoundingClientRect();
                    return (rect.width > 0 && rect.height > 0) || el.getClientRects().length > 0;
                  }
                  const detailPane = document.querySelector('.scaffold-layout__detail, .jobs-search__job-details, .job-view-layout, main') || document;
                  const listEl = document.querySelector('.jobs-search-results-list, .scaffold-layout__list');
                  const buttons = Array.from(detailPane.querySelectorAll('button, a.jobs-apply-button, [role="button"]'));
                  return buttons.find(b => {
                    if (listEl && listEl.contains(b)) return false;
                    if (!isVisible(b)) return false;
                    const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                    const cls = (b.className || '').toLowerCase();
                    const href = (b.getAttribute('href') || '').toLowerCase();
                    if (txt.includes('already applied') || aria.includes('already applied')) return false;
                    const isEasy = txt.includes('easy apply') || aria.includes('easy apply') || (cls.includes('jobs-apply-button') && !href.includes('external') && !txt.includes('company') && !aria.includes('company'));
                    return isEasy;
                  }) || null;
                });

                const easyApplyEl = easyApplyBtnHandle.asElement();
                if (!easyApplyEl) {
                  this.logger('info', 'LinkedIn', `Could not click Easy Apply button for "${jobDetails.title}".`);
                  continue;
                }

                this.logger('action', 'LinkedIn', `Initiating Easy Apply for "${jobDetails.title}" (Score: ${evaluation.score}%)...`);
                await easyApplyEl.click().catch(async () => {
                  await easyApplyEl.evaluate(b => b.click());
                });

                // Wait for Easy Apply dialog to become visible (viewport visibility, works with position: fixed)
                await page.waitForFunction(() => {
                  const modal = document.querySelector('dialog, [role="dialog"], .jobs-easy-apply-modal, .artdeco-modal');
                  if (!modal) return false;
                  const style = window.getComputedStyle(modal);
                  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                  const rect = modal.getBoundingClientRect();
                  return (rect.width > 0 && rect.height > 0) || modal.getClientRects().length > 0;
                }, { timeout: 7000 }).catch(() => {});
                await this.randomDelay(1500, 2500);

                // Handle multi-step modal and collect all answered screening questions
                const answeredQuestions = [];
                const applicationSuccess = await this.handleModalFlow(page, jobDetails, answeredQuestions);
                jobRecord.questionsAnswered = answeredQuestions;
                
                if (applicationSuccess) {
                  jobRecord.status = 'applied';
                  totalProcessedCount++;
                  this.logger('success', 'LinkedIn', `Successfully applied to "${jobDetails.title}" at ${jobDetails.company}!`);
                } else {
                  // Cleanly dismiss and discard the modal to unblock page
                  await this.dismissAndDiscardModal(page);

                  jobRecord.status = 'MANUAL_ACTION_REQUIRED';
                  jobRecord.actionRequired = true;
                  jobRecord.directApplicationUrl = page.url();
                  jobRecord.reason = `Application for "${jobDetails.title}" requires manual verification or custom input`;
                  this.logger('warning', 'LinkedIn', `Application for "${jobDetails.title}" requires manual verification. Enqueued into Manual Apply Queue.`);
                }

                if (onJobProcessed) onJobProcessed(jobRecord);
                await this.randomDelay(2000, 3500);

              } catch (jobErr) {
                this.logger('error', 'LinkedIn', `Error processing LinkedIn job: ${jobErr.message}`);
              }
            }
          }
        }
      }

      return { success: true, totalProcessedCount };
    } catch (err) {
      this.logger('error', 'LinkedIn', `LinkedIn Bot Error: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      if (page && !page.isClosed()) {
        try {
          await page.close();
        } catch (e) {}
      }
    }
  }

  // Handle multi-step Easy Apply dialog using valid standard DOM selectors
  async handleModalFlow(page, jobDetails, answeredQuestions = []) {
    let maxSteps = 12;
    let consecutiveUnchangedSteps = 0;

    while (maxSteps > 0) {
      maxSteps--;
      await this.randomDelay(1000, 1800);

      // 1. Ensure candidate resume is selected or uploaded
      await this.handleResumeStep(page);

      // 2. Auto-fill form fields on the current step
      await this.fillFormFields(page, jobDetails, answeredQuestions);
      await this.randomDelay(700, 1200);

      // 3. Inspect and interact with modal buttons
      const stepAction = await page.evaluate(() => {
        function isVisible(el) {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = el.getBoundingClientRect();
          return (rect.width > 0 && rect.height > 0) || el.getClientRects().length > 0;
        }

        const modal = document.querySelector('dialog, [role="dialog"], .jobs-easy-apply-modal, .artdeco-modal') || document;
        const buttons = Array.from(modal.querySelectorAll(
          '.artdeco-modal__actionbar button, .jobs-easy-apply-footer button, footer button, [data-easy-apply-next-button], button.artdeco-button--primary, button'
        )).filter(b => isVisible(b));

        function triggerClick(el) {
          ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'].forEach(evt => {
            el.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
          });
          el.click();
        }

        // A. Check for Submit Application button
        const submitBtn = buttons.find(b => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          return aria.includes('submit application') || txt === 'submit application' || txt === 'submit' || b.getAttribute('data-control-name') === 'submit_unformatted';
        });

        if (submitBtn) {
          const disabled = submitBtn.disabled || submitBtn.getAttribute('aria-disabled') === 'true' || submitBtn.classList.contains('artdeco-button--disabled');
          if (!disabled) {
            triggerClick(submitBtn);
            return { action: 'submit_clicked' };
          }
          return { action: 'submit_disabled' };
        }

        // B. Check for Review application button
        const reviewBtn = buttons.find(b => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          return aria.includes('review your application') || txt === 'review' || aria.includes('review');
        });

        if (reviewBtn) {
          const disabled = reviewBtn.disabled || reviewBtn.getAttribute('aria-disabled') === 'true' || reviewBtn.classList.contains('artdeco-button--disabled');
          if (!disabled) {
            triggerClick(reviewBtn);
            return { action: 'review_clicked' };
          }
          return { action: 'review_disabled' };
        }

        // C. Check for Next button
        const nextBtn = buttons.find(b => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          return aria.includes('continue to next step') || txt === 'next' || aria.includes('next') || txt === 'continue' || b.hasAttribute('data-easy-apply-next-button');
        });

        if (nextBtn) {
          const disabled = nextBtn.disabled || nextBtn.getAttribute('aria-disabled') === 'true' || nextBtn.classList.contains('artdeco-button--disabled');
          if (!disabled) {
            triggerClick(nextBtn);
            return { action: 'next_clicked' };
          }
          return { action: 'next_disabled' };
        }

        return { action: 'none' };
      });

      if (stepAction.action === 'submit_clicked') {
        this.logger('success', 'LinkedIn', 'Submit button clicked!');
        await this.randomDelay(2500, 4000);

        // Dismiss done / confirmation dialog if any
        await page.evaluate(() => {
          const modal = document.querySelector('dialog, [role="dialog"], .jobs-easy-apply-modal, .artdeco-modal') || document;
          const buttons = Array.from(modal.querySelectorAll('button'));
          const done = buttons.find(b => {
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            const txt = (b.innerText || '').toLowerCase();
            return aria.includes('dismiss') || txt === 'done' || b.getAttribute('data-control-name') === 'overlay.close_padding';
          });
          if (done) done.click();
        });
        await this.randomDelay(800, 1500);
        return true;
      }

      if (stepAction.action === 'review_clicked' || stepAction.action === 'next_clicked') {
        consecutiveUnchangedSteps = 0;
        await this.randomDelay(1000, 1800);
        continue;
      }

      // If action button was disabled or not found, try to resolve errors
      consecutiveUnchangedSteps++;
      const hasErrors = await page.evaluate(() => {
        const errs = document.querySelectorAll('.artdeco-inline-feedback--error, [aria-invalid="true"], .fb-dash-form-element__error-field');
        return Array.from(errs).map(e => e.innerText.trim()).filter(Boolean);
      });

      if (hasErrors.length > 0) {
        this.logger('warning', 'LinkedIn', `Form validation on step: ${hasErrors.slice(0, 2).join('; ')}`);
      }

      if (consecutiveUnchangedSteps >= 2) {
        await this.scanAndRecordUnfilledFields(page, jobDetails);
        this.logger('warning', 'LinkedIn', `Application blocked by incomplete fields. Enqueued for manual completion.`);
        break;
      }
    }
    return false;
  }

  // Scan current modal dialog for any unfilled, skipped, or invalid form fields
  async scanAndRecordUnfilledFields(page, jobDetails = {}) {
    try {
      const unfilled = await page.evaluate(() => {
        function clean(t) {
          if (!t) return '';
          return t.replace(/[\*\:]/g, '').replace(/\b(?:\d+\/\d+|\d+\s*of\s*\d+\s*characters?)\b/gi, '').trim();
        }

        function isErrorText(t) {
          if (!t) return false;
          const s = t.trim();
          if (/^(invalid input|this field is required|field is required|required field|please enter a valid|please enter a whole number|please enter a number|please enter a decimal|please select a valid|please choose a valid|please make a selection)/i.test(s)) {
            return true;
          }
          if (/^\d+\s*of\s*\d+\s*characters?/i.test(s) || /^\d+\/\d+$/i.test(s)) {
            return true;
          }
          return false;
        }

        function extractQuestion(el) {
          // For radio buttons, the question is the group legend or container header, not the individual option label
          if (el.type === 'radio') {
            const fieldset = el.closest('fieldset');
            if (fieldset) {
              const legend = fieldset.querySelector('legend');
              if (legend && legend.innerText.trim()) return clean(legend.innerText);
            }
            let curr = el.parentElement;
            for (let depth = 0; depth < 5 && curr; depth++) {
              const headerEl = curr.querySelector('legend, h3, h4, span[class*="label"], span[class*="title"], p:not([class*="error"]):not([class*="feedback"])');
              if (headerEl && !headerEl.contains(el) && headerEl.innerText.trim()) {
                const t = clean(headerEl.innerText);
                if (t.length > 3 && !/^\d+\/\d+/.test(t) && !/of \d+ characters/i.test(t) && !isErrorText(t)) {
                  return t;
                }
              }
              curr = curr.parentElement;
            }
          }

          if (el.id) {
            const l = document.querySelector(`label[for="${el.id}"]`);
            if (l && l.innerText.trim() && !isErrorText(clean(l.innerText))) return clean(l.innerText);
          }
          const parentLabel = el.closest('label');
          if (parentLabel && parentLabel.innerText.trim() && !isErrorText(clean(parentLabel.innerText))) return clean(parentLabel.innerText);
          const fieldset = el.closest('fieldset');
          if (fieldset) {
            const legend = fieldset.querySelector('legend');
            if (legend && legend.innerText.trim()) return clean(legend.innerText);
          }
          let curr = el.parentElement;
          for (let depth = 0; depth < 5 && curr; depth++) {
            const headerEl = curr.querySelector('label:not([class*="error"]), legend, h3, h4, span[class*="label"]:not([class*="error"]), span[class*="title"], p:not([class*="error"]):not([class*="feedback"])');
            if (headerEl && headerEl !== el && headerEl.innerText.trim()) {
              const t = clean(headerEl.innerText);
              if (t.length > 3 && !/^\d+\/\d+/.test(t) && !/of \d+ characters/i.test(t) && !isErrorText(t)) {
                return t;
              }
            }
            const lines = (curr.innerText || '').split('\n').map(s => clean(s)).filter(s => s.length > 2 && !/^\d+\/\d+/.test(s) && !/of \d+ characters/i.test(s) && !isErrorText(s));
            if (lines.length > 0) {
              return lines[0];
            }
            curr = curr.parentElement;
          }
          const fallback = clean(el.getAttribute('aria-label') || el.placeholder || el.name || '');
          return isErrorText(fallback) ? '' : fallback;
        }

        const dialog = document.querySelector('dialog, [role="dialog"], .jobs-easy-apply-modal') || document;
        const inputs = Array.from(dialog.querySelectorAll('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'));
        const results = [];
        const seenQuestions = new Set();

        for (const el of inputs) {
          if (el.closest('header') || el.closest('footer')) continue;
          let labelText = extractQuestion(el);
          if (!labelText || seenQuestions.has(labelText.toLowerCase())) continue;
          if (/^_r_|^ember|^\d+$/i.test(labelText) || (labelText.length < 3 && !/\s/.test(labelText))) continue;
          if (labelText === 'Search' || labelText.includes('Premium') || labelText.includes('language')) continue;

          const val = (el.value || '').trim();
          const isRadio = el.type === 'radio';
          const isCheckbox = el.type === 'checkbox';
          const isAriaInvalid = el.getAttribute('aria-invalid') === 'true';
          const container = el.parentElement;
          const errEl = container ? container.closest('div')?.querySelector('.artdeco-inline-feedback--error, [aria-invalid="true"]') : null;
          const errText = errEl ? (errEl.innerText || errEl.textContent || '').trim() : '';
          const isErrVisible = errEl ? ((errEl.getBoundingClientRect().width > 0 && errEl.getBoundingClientRect().height > 0) || errEl.getClientRects().length > 0) : false;
          const hasVisibleError = (errText.length > 0 && !errText.toLowerCase().includes('optional') && isErrVisible) || isAriaInvalid;
          const isRequired = el.required || el.getAttribute('aria-required') === 'true';

          let missing = false;
          let reason = '';
          if (isRadio) {
            const name = el.name;
            const checked = name ? dialog.querySelector(`input[type="radio"][name="${name}"]:checked`) : null;
            if (!checked && (isRequired || hasVisibleError)) {
              missing = true;
              reason = 'Radio button choice required';
            }
          } else if (isCheckbox) {
            if (isRequired && !el.checked) {
              missing = true;
              reason = 'Required confirmation checkbox not checked';
            }
          } else if (!val && (isRequired || hasVisibleError)) {
            missing = true;
            reason = hasVisibleError ? (errText || 'Field validation failed') : 'Required field left blank';
          } else if (hasVisibleError && isAriaInvalid) {
            missing = true;
            reason = errText || 'Input value rejected by form validation';
          }

          if (missing) {
            seenQuestions.add(labelText.toLowerCase());
            let inputType = 'text';
            let options = [];

            if (el.tagName.toLowerCase() === 'select') {
              inputType = 'select';
              options = Array.from(el.options).map(o => (o.text || '').trim()).filter(t => t && !/^(select|choose|--)/i.test(t));
            } else if (isRadio) {
              inputType = 'radio';
              const rGroup = Array.from(dialog.querySelectorAll(`input[type="radio"][name="${el.name}"]`));
              options = rGroup.map(r => {
                let lText = '';
                if (r.labels && r.labels[0]) lText = r.labels[0].innerText || '';
                if (!lText && r.id) {
                  try {
                    const esc = (window.CSS && CSS.escape) ? CSS.escape(r.id) : r.id.replace(/([:.\(\)\[\],])/g, '\\$1');
                    const l = dialog.querySelector(`label[for="${esc}"]`);
                    if (l) lText = l.innerText || '';
                  } catch (e) {}
                }
                if (!lText) {
                  const pL = r.closest('label');
                  if (pL) lText = pL.innerText || '';
                }
                if (!lText && r.value && r.value.toLowerCase() !== 'on') lText = r.value;
                if (labelText && (lText.toLowerCase() === labelText.toLowerCase() || lText.toLowerCase().includes(labelText.toLowerCase()))) {
                  lText = (r.value && r.value.toLowerCase() !== 'on') ? r.value : '';
                }
                return (lText || '').trim();
              }).filter(Boolean);
              if (options.length === 0 && rGroup.length === 2) options = ['Yes', 'No'];
            } else if (el.type === 'number' || el.inputMode === 'numeric') {
              inputType = 'number';
            } else if (el.getAttribute('role') === 'combobox') {
              inputType = 'combobox';
            }

            results.push({
              question: labelText,
              label: labelText,
              inputType,
              options,
              reason,
              currentVal: val
            });
          }
        }
        return results;
      });

      for (const item of unfilled) {
        this.ai.recordUnfilledQuestion({
          question: item.question,
          label: item.label,
          inputType: item.inputType,
          options: item.options,
          platform: 'LinkedIn',
          jobTitle: jobDetails?.title || 'Unknown Title',
          company: jobDetails?.company || 'LinkedIn Job',
          reason: item.reason
        });
      }
    } catch (e) {
      // Best-effort inspection
    }
  }

  // Fill inputs, radios, custom/native selects, numbers, checkboxes on current modal step with exact typing & event dispatching
  async fillFormFields(page, jobDetails = {}, answeredQuestions = []) {
    const recordAnswer = (q, a, type, src) => {
      if (!q || !Array.isArray(answeredQuestions)) return;
      const cleanQ = q.trim();
      const existing = answeredQuestions.find(item => item.question.toLowerCase() === cleanQ.toLowerCase());
      if (existing) {
        existing.answer = String(a);
        existing.inputType = type;
        existing.source = src || 'AI Engine';
      } else {
        answeredQuestions.push({
          question: cleanQ,
          answer: String(a),
          inputType: type,
          source: src || 'AI Engine',
          timestamp: new Date().toISOString()
        });
      }
    };

    const qaContext = {
      platform: 'LinkedIn',
      jobTitle: jobDetails?.title || 'Unknown Title',
      company: jobDetails?.company || 'LinkedIn Job'
    };

    const dialogHandle = (await page.$('dialog, [role="dialog"], .jobs-easy-apply-modal')) || page;

    // Inject helper into page context so all element evaluations can access it synchronously
    await page.evaluate(() => {
      window.__isVisible = function(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return (rect.width > 0 && rect.height > 0) || el.getClientRects().length > 0;
      };

      window.__cleanText = function(t) {
        if (!t) return '';
        return t.replace(/[\*\:]/g, '').replace(/\b(?:\d+\/\d+|\d+\s*of\s*\d+\s*characters?)\b/gi, '').trim();
      };

      window.__isErrorText = function(t) {
        if (!t) return false;
        const s = t.trim();
        if (/^(invalid input|this field is required|field is required|required field|please enter a valid|please enter a whole number|please enter a number|please enter a decimal|please select a valid|please choose a valid|please make a selection)/i.test(s)) {
          return true;
        }
        if (/^\d+\s*of\s*\d+\s*characters?/i.test(s) || /^\d+\/\d+$/i.test(s)) {
          return true;
        }
        return false;
      };

      window.__extractHelperText = function(el) {
        if (!el) return '';
        let helper = '';
        const describedBy = el.getAttribute('aria-describedby');
        if (describedBy) {
          const ids = describedBy.split(/\s+/);
          for (const id of ids) {
            const hEl = document.getElementById(id);
            if (hEl && !window.__isErrorText(hEl.innerText)) {
              helper += ' ' + window.__cleanText(hEl.innerText);
            }
          }
        }
        const container = el.closest('.fb-dash-form-element, .jobs-easy-apply-form-section__grouping, div[data-test-form-builder-component]');
        if (container) {
          const subEl = container.querySelector('.artdeco-text-input--sub-label, [class*="sub-label"], [class*="helper"], p.t-12');
          if (subEl && !window.__isErrorText(subEl.innerText)) {
            helper += ' ' + window.__cleanText(subEl.innerText);
          }
        }
        return helper.trim();
      };

      window.__extractQuestion = function(el) {
        if (!el) return '';
        // For radio buttons, the question is the group legend or container header, not the individual option label
        if (el.type === 'radio') {
          const fieldset = el.closest('fieldset');
          if (fieldset) {
            const legend = fieldset.querySelector('legend');
            if (legend && legend.innerText.trim()) return window.__cleanText(legend.innerText);
          }
          let curr = el.parentElement;
          for (let depth = 0; depth < 5 && curr; depth++) {
            const headerEl = curr.querySelector('legend, h3, h4, span[class*="label"], span[class*="title"], p:not([class*="error"]):not([class*="feedback"])');
            if (headerEl && !headerEl.contains(el) && headerEl.innerText.trim()) {
              const t = window.__cleanText(headerEl.innerText);
              if (t.length > 3 && !/^\d+\/\d+/.test(t) && !/of \d+ characters/i.test(t) && !window.__isErrorText(t)) {
                return t;
              }
            }
            curr = curr.parentElement;
          }
        }

        // 1. Native HTMLInputElement labels collection
        if (el.labels && el.labels.length > 0) {
          for (let i = 0; i < el.labels.length; i++) {
            const lt = window.__cleanText(el.labels[i].innerText);
            if (lt && !window.__isErrorText(lt)) return lt;
          }
        }

        // 2. aria-labelledby
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const ids = labelledBy.split(/\s+/);
          for (const id of ids) {
            const lEl = document.getElementById(id);
            if (lEl) {
              const lt = window.__cleanText(lEl.innerText);
              if (lt && !window.__isErrorText(lt)) return lt;
            }
          }
        }

        // 3. label[for=id] with CSS.escape for colons and special characters in URNs
        if (el.id) {
          try {
            const escapedId = (window.CSS && CSS.escape) ? CSS.escape(el.id) : el.id.replace(/([:.\(\)\[\],])/g, '\\$1');
            const l = document.querySelector(`label[for="${escapedId}"]`);
            if (l && l.innerText.trim() && !window.__isErrorText(window.__cleanText(l.innerText))) {
              return window.__cleanText(l.innerText);
            }
          } catch (e) {}
        }

        // 4. Closest label parent
        const parentLabel = el.closest('label');
        if (parentLabel && parentLabel.innerText.trim() && !window.__isErrorText(window.__cleanText(parentLabel.innerText))) {
          return window.__cleanText(parentLabel.innerText);
        }

        // 5. Container grouping (LinkedIn form builder element)
        const container = el.closest('.fb-dash-form-element, .jobs-easy-apply-form-section__grouping, div[data-test-form-builder-component]');
        if (container) {
          const l = container.querySelector('label:not([class*="error"]), span.t-14, .artdeco-text-input--label');
          if (l && l !== el && l.innerText.trim() && !window.__isErrorText(window.__cleanText(l.innerText))) {
            return window.__cleanText(l.innerText);
          }
        }

        // 6. Closest fieldset legend
        const fieldset = el.closest('fieldset');
        if (fieldset) {
          const legend = fieldset.querySelector('legend');
          if (legend && legend.innerText.trim()) return window.__cleanText(legend.innerText);
        }

        // 7. Direct aria-label or placeholder
        const fallback = window.__cleanText(el.getAttribute('aria-label') || el.placeholder || el.name || '');
        return window.__isErrorText(fallback) ? '' : fallback;
      };
    });

    // 1. NATIVE DROPDOWNS (<select>)
    const selects = await dialogHandle.$$('select');
    for (const selectEl of selects) {
      try {
        const selInfo = await selectEl.evaluate(el => {
          if (el.closest('footer') || el.closest('header')) return null;
          return {
            qText: window.__extractQuestion ? window.__extractQuestion(el) : '',
            options: Array.from(el.options).map(o => (o.text || '').trim()).filter(t => t && !/^(select|choose|--)/i.test(t)),
            val: el.value
          };
        });
        if (!selInfo || !selInfo.qText) continue;
        const isCountryCode = /country.*code|dialing.*code|phone.*code/i.test(selInfo.qText);
        const answerObj = await this.ai.answerScreeningQuestionAI(selInfo.qText, selInfo.options, 'select', qaContext);
        const optionValue = await selectEl.evaluate((s, ans, isCc) => {
          const opts = Array.from(s.options);
          if (isCc) {
            const inOpt = opts.find(o => o.text.includes('+91') || o.text.toLowerCase().includes('india'));
            if (inOpt) return inOpt.value;
          }
          const exact = opts.find(o => o.text.trim().toLowerCase() === ans.toLowerCase());
          if (exact) return exact.value;
          const sub = opts.find(o => o.text.toLowerCase().includes(ans.toLowerCase()) || ans.toLowerCase().includes(o.text.toLowerCase()));
          if (sub) return sub.value;
          const num = ans.match(/\d+/);
          if (num) {
            const numOpt = opts.find(o => o.text.includes(num[0]));
            if (numOpt) return numOpt.value;
          }
          return null;
        }, answerObj.answer, isCountryCode);

        if (optionValue) {
          await selectEl.select(optionValue);
          await selectEl.evaluate((s, val) => {
            s.value = val;
            s.dispatchEvent(new Event('change', { bubbles: true }));
            s.dispatchEvent(new Event('input', { bubbles: true }));
          }, optionValue);
          const aiTag = answerObj.aiPowered ? ' 🤖' : ' ⚡';
          this.logger('action', 'LinkedIn', `${aiTag} Selected dropdown: "${answerObj.answer}" for "${selInfo.qText.slice(0, 35)}..."`);
          recordAnswer(selInfo.qText, answerObj.answer, 'select', answerObj.source);
        }
      } catch (err) {
        this.logger('warning', 'LinkedIn', `Error selecting dropdown: ${err.message}`);
      }
    }

    // 2. CUSTOM DROPDOWNS (button[aria-haspopup="listbox"], button[id*="dropdown"])
    const customDropdowns = await dialogHandle.$$('button[aria-haspopup="listbox"], button[id*="dropdown"], [data-test-form-builder-component="dropdown"] button');
    for (const cBtn of customDropdowns) {
      try {
        const btnInfo = await cBtn.evaluate(el => {
          if (el.closest('footer') || el.closest('header')) return null;
          return {
            qText: window.__extractQuestion ? window.__extractQuestion(el) : '',
            btnText: (el.innerText || '').trim()
          };
        });
        if (!btnInfo || !btnInfo.qText) continue;
        if (!btnInfo.btnText || /select|choose|--/i.test(btnInfo.btnText)) {
          await cBtn.click();
          await this.randomDelay(400, 700);

          const dropdownOptions = await page.evaluate(() => {
            const isVis = window.__isVisible || (el => {
              const r = el.getBoundingClientRect();
              return (r.width > 0 && r.height > 0) || el.getClientRects().length > 0;
            });
            const opts = Array.from(document.querySelectorAll(
              '[role="listbox"] [role="option"], .artdeco-dropdown__item, .artdeco-dropdown__content li, ul[role="listbox"] li'
            )).filter(o => isVis(o) && (o.innerText || o.textContent || '').trim().length > 0);
            return opts.map(o => (o.innerText || o.textContent || '').trim()).filter(Boolean);
          });

          const answerObj = await this.ai.answerScreeningQuestionAI(btnInfo.qText, dropdownOptions, 'select', qaContext);

          if (!answerObj.answer) {
            await page.keyboard.press('Escape');
            this.logger('warning', 'LinkedIn', `Skipped ambiguous dropdown: "${btnInfo.qText.slice(0, 60)}"`);
            continue;
          }

          // If the custom dropdown has an internal filter search box, type the chosen answer to filter
          const searchInput = await page.$('.artdeco-dropdown__search-input, [role="listbox"] input, .artdeco-dropdown__content input, input[placeholder*="Search"]');
          if (searchInput && answerObj.answer) {
            await searchInput.type(answerObj.answer, { delay: 30 });
            await this.randomDelay(300, 600);
          }

          if (dropdownOptions.length > 0 || searchInput) {
            await page.evaluate((targetAns) => {
              const isVis = window.__isVisible || (el => {
                const r = el.getBoundingClientRect();
                return (r.width > 0 && r.height > 0) || el.getClientRects().length > 0;
              });
              const opts = Array.from(document.querySelectorAll(
                '[role="listbox"] [role="option"], .artdeco-dropdown__item, .artdeco-dropdown__content li, ul[role="listbox"] li'
              )).filter(o => isVis(o) && (o.innerText || o.textContent || '').trim().length > 0);
              const tLower = targetAns.toLowerCase();
              let match = opts.find(o => {
                const t = (o.innerText || o.textContent || '').trim().toLowerCase();
                return t === tLower || t.includes(tLower) || tLower.includes(t);
              });
              if (!match) {
                const num = targetAns.match(/\d+/);
                if (num) match = opts.find(o => o.innerText.includes(num[0]));
              }
              if (!match && /yes/i.test(tLower)) match = opts.find(o => /yes/i.test(o.innerText));
              if (!match && /no/i.test(tLower)) match = opts.find(o => /no/i.test(o.innerText));
              if (!match && opts.length > 0) match = opts[0];
              if (match) {
                match.scrollIntoView({ block: 'nearest' });
                ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'].forEach(evt => {
                  match.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
                });
              }
            }, answerObj.answer);
            const aiTag = answerObj.aiPowered ? ' 🤖' : ' ⚡';
            this.logger('action', 'LinkedIn', `${aiTag} Custom dropdown selected: "${answerObj.answer}" for "${btnInfo.qText.slice(0, 35)}..."`);
            recordAnswer(btnInfo.qText, answerObj.answer, 'select', answerObj.source);
          } else {
            await page.keyboard.press('Escape');
          }
        }
      } catch (err) {
        this.logger('warning', 'LinkedIn', `Error with custom dropdown: ${err.message}`);
      }
    }

    // 3. RADIO BUTTON GROUPS
    const handledRadioNames = new Set();
    const radioInputs = await dialogHandle.$$('input[type="radio"]');
    for (const rInput of radioInputs) {
      try {
        const rName = await rInput.evaluate(el => el.name);
        if (!rName || handledRadioNames.has(rName)) continue;
        handledRadioNames.add(rName);

        const groupInfo = await rInput.evaluate(el => {
          if (el.closest('footer') || el.closest('header')) return null;
          const qText = window.__extractQuestion ? window.__extractQuestion(el) : '';
          const groupEls = Array.from(document.querySelectorAll(`input[type="radio"][name="${el.name}"]`));
          const options = groupEls.map(r => {
            let labelText = '';
            if (r.labels && r.labels.length > 0) {
              labelText = (r.labels[0].innerText || '').trim();
            }
            if (!labelText && r.id) {
              try {
                const esc = (window.CSS && CSS.escape) ? CSS.escape(r.id) : r.id.replace(/([:.\(\)\[\],])/g, '\\$1');
                const l = document.querySelector(`label[for="${esc}"]`);
                if (l) labelText = (l.innerText || '').trim();
              } catch (e) {}
            }
            if (!labelText) {
              const parentL = r.closest('label');
              if (parentL) labelText = (parentL.innerText || '').trim();
            }
            if (!labelText && r.parentElement) {
              const sib = r.parentElement.querySelector('label, span[class*="label"], .fb-radio-label');
              if (sib) labelText = (sib.innerText || '').trim();
            }
            // CRITICAL: If the extracted label matches or contains the whole question text, it accidentally captured the fieldset legend!
            if (qText && labelText && (labelText.toLowerCase() === qText.toLowerCase() || labelText.toLowerCase().includes(qText.toLowerCase()))) {
              labelText = '';
            }
            if (!labelText && r.value && r.value.toLowerCase() !== 'on' && r.value.length < 50) {
              labelText = r.value.trim();
            }
            if (!labelText) {
              const aria = r.getAttribute('aria-label');
              if (aria && aria.toLowerCase() !== qText.toLowerCase()) labelText = aria.trim();
            }
            return labelText;
          }).filter(Boolean);

          let finalOptions = options;
          if (finalOptions.length === 0 || finalOptions.every(o => o.toLowerCase() === qText.toLowerCase())) {
            const vals = groupEls.map(r => (r.value || '').trim()).filter(v => v && v.toLowerCase() !== 'on');
            if (vals.length === groupEls.length) {
              finalOptions = vals;
            } else if (groupEls.length === 2) {
              finalOptions = ['Yes', 'No'];
            }
          }
          const checked = groupEls.some(r => r.checked);
          return { qText, options: finalOptions, checked };
        });

        if (!groupInfo || !groupInfo.qText || groupInfo.checked) continue;
        const answerObj = await this.ai.answerScreeningQuestionAI(groupInfo.qText, groupInfo.options, 'radio', qaContext);
        if (!answerObj.answer) {
          this.logger('warning', 'LinkedIn', `Skipped ambiguous radio question: "${groupInfo.qText.slice(0, 60)}"`);
          continue;
        }
        await page.evaluate((rName, targetAns) => {
          const tLower = targetAns.toLowerCase();
          const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${rName}"]`));
          let chosen = null;
          for (const r of radios) {
            let txt = '';
            if (r.labels && r.labels[0]) txt = r.labels[0].innerText || '';
            if (!txt && r.id) {
              try {
                const esc = (window.CSS && CSS.escape) ? CSS.escape(r.id) : r.id.replace(/([:.\(\)\[\],])/g, '\\$1');
                const l = document.querySelector(`label[for="${esc}"]`);
                if (l) txt = l.innerText || '';
              } catch (e) {}
            }
            if (!txt) txt = r.closest('label')?.innerText || r.getAttribute('aria-label') || r.value || '';
            txt = txt.trim().toLowerCase();
            if (txt === tLower || txt.includes(tLower) || tLower.includes(txt) || (r.value && r.value.toLowerCase() === tLower)) {
              chosen = r;
              break;
            }
          }
          if (!chosen && /yes/i.test(tLower)) {
            chosen = radios.find(r => /yes/i.test(r.value || r.getAttribute('aria-label') || r.closest('label')?.innerText || r.parentElement?.innerText || ''));
            if (!chosen && radios.length === 2) chosen = radios[0];
          }
          if (!chosen && /no/i.test(tLower)) {
            chosen = radios.find(r => /no/i.test(r.value || r.getAttribute('aria-label') || r.closest('label')?.innerText || r.parentElement?.innerText || ''));
            if (!chosen && radios.length === 2) chosen = radios[1];
          }
          if (chosen) {
            chosen.click();
            chosen.checked = true;
            let l = null;
            if (chosen.labels && chosen.labels[0]) l = chosen.labels[0];
            if (!l && chosen.id) {
              try {
                const esc = (window.CSS && CSS.escape) ? CSS.escape(chosen.id) : chosen.id.replace(/([:.\(\)\[\],])/g, '\\$1');
                l = document.querySelector(`label[for="${esc}"]`);
              } catch (e) {}
            }
            if (l) l.click();
            chosen.dispatchEvent(new Event('change', { bubbles: true }));
            chosen.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, rName, answerObj.answer);
        const aiTag = answerObj.aiPowered ? ' 🤖' : ' ⚡';
        this.logger('action', 'LinkedIn', `${aiTag} Radio selected: "${answerObj.answer}" for "${groupInfo.qText.slice(0, 35)}..."`);
        recordAnswer(groupInfo.qText, answerObj.answer, 'radio', answerObj.source);
      } catch (err) {
        this.logger('warning', 'LinkedIn', `Error selecting radio: ${err.message}`);
      }
    }

    // 4. CHECKBOXES
    const checkboxes = await dialogHandle.$$('input[type="checkbox"]');
    for (const cb of checkboxes) {
      try {
        const cbInfo = await cb.evaluate(el => {
          if (el.closest('footer') || el.closest('header')) return null;
          const parentL = el.closest('label');
          const idL = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
          const labelText = (idL?.innerText || parentL?.innerText || el.getAttribute('aria-label') || el.name || '').trim();
          const isRequired = el.required || el.getAttribute('aria-required') === 'true';
          const isConsent = /agree|certify|consent|terms|acknowledge|confirm|understand/i.test(labelText);
          return {
            checked: el.checked,
            required: isRequired || isConsent,
            labelText
          };
        });
        if (cbInfo && !cbInfo.checked && cbInfo.required) {
          await cb.evaluate(el => {
            el.click();
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });
          this.logger('action', 'LinkedIn', `Checked required confirmation checkbox: "${(cbInfo.labelText || 'Terms/Consent').slice(0, 35)}..."`);
        }
      } catch (err) {
        this.logger('warning', 'LinkedIn', `Error with checkbox: ${err.message}`);
      }
    }

    // 5. SEARCHABLE DROPDOWNS & COMBOBOX / TYPEAHEAD
    const comboboxes = await dialogHandle.$$(
      'input[role="combobox"], .artdeco-typeahead__input, input[aria-autocomplete="list"], input[aria-autocomplete="both"], .fb-dash-typeahead input, [data-test-form-builder-component="typeahead"] input, input[id*="typeahead"], input[id*="city"], input[name*="city"], input[id*="location"]'
    );
    const handledComboboxIds = new Set();
    for (const cbox of comboboxes) {
      try {
        const info = await cbox.evaluate(el => {
          if (el.closest('footer') || el.closest('header')) return null;
          let q = window.__extractQuestion ? window.__extractQuestion(el) : '';
          const id = (el.id || '').toLowerCase();
          const name = (el.name || '').toLowerCase();
          const placeholder = (el.placeholder || '').toLowerCase();
          const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();

          // Resolve generic "Search" or empty question from element attributes or container
          if (!q || q.toLowerCase() === 'search' || q.length < 3) {
            const container = el.closest('.fb-dash-form-element, .fb-dash-typeahead, div[data-test-form-builder-component]');
            const labelEl = container ? container.querySelector('label, h3, h4, span[class*="label"], span[class*="title"]') : null;
            if (labelEl && labelEl.innerText.trim() && labelEl.innerText.trim().toLowerCase() !== 'search') {
              q = window.__cleanText(labelEl.innerText);
            } else if (id.includes('city') || name.includes('city') || placeholder.includes('city') || ariaLabel.includes('city')) {
              q = 'City';
            } else if (id.includes('country') || name.includes('country') || placeholder.includes('country') || ariaLabel.includes('country')) {
              q = 'Phone Country Code';
            } else if (id.includes('location') || name.includes('location') || placeholder.includes('location') || ariaLabel.includes('location')) {
              q = 'Location';
            } else if (id.includes('state') || name.includes('state')) {
              q = 'State';
            } else if (id.includes('degree') || name.includes('degree')) {
              q = 'Degree';
            }
          }

          const container = el.closest('.fb-dash-form-element, div');
          const errEl = container ? container.querySelector('.artdeco-inline-feedback--error, [aria-invalid="true"]') : null;
          const isErrVisible = errEl ? ((errEl.getBoundingClientRect().width > 0 && errEl.getBoundingClientRect().height > 0) || errEl.getClientRects().length > 0) : false;
          const isInvalid = el.getAttribute('aria-invalid') === 'true' || isErrVisible;

          return {
            qText: q,
            val: (el.value || '').trim(),
            id: el.id || el.name || q,
            isInvalid
          };
        });

        if (!info || !info.qText || handledComboboxIds.has(info.id)) continue;
        handledComboboxIds.add(info.id);

        const qText = info.qText;
        const isCityQuestion = /city|location/i.test(qText);
        const isCountryQuestion = /country.*code|dialing.*code|phone.*code/i.test(qText);
        const shouldFill = !info.val ||
                           info.isInvalid ||
                           /select|choose|search|--/i.test(info.val) ||
                           (isCityQuestion && !info.val.toLowerCase().includes('hyderabad')) ||
                           (isCountryQuestion && !info.val.toLowerCase().includes('india') && !info.val.includes('+91'));

        if (shouldFill) {
          const answerObj = await this.ai.answerScreeningQuestionAI(qText, [], 'text', qaContext);
          let fullAnswer = answerObj.answer;

          // For city/country typeaheads, the search prefix gets the most targeted suggestions
          let searchTerm = fullAnswer;
          if (isCityQuestion && fullAnswer.includes(',')) {
            searchTerm = fullAnswer.split(',')[0].trim();
          } else if (isCountryQuestion) {
            searchTerm = fullAnswer.includes('(') ? fullAnswer.split('(')[0].trim() : 'India';
          }

          // 1. Scroll and focus
          await cbox.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' })).catch(() => {});
          await cbox.click({ clickCount: 3 });
          await page.keyboard.press('Backspace');
          await cbox.evaluate(el => {
            el.focus();
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await this.randomDelay(200, 350);

          // 2. Type search term
          await cbox.type(searchTerm, { delay: 40 });
          // Wait for dropdown list to render suggestions
          await this.randomDelay(800, 1300);

          // 3. Select matching option from dropdown list (Strategy A: Mouse events)
          const selectedOptionText = await page.evaluate((term, full) => {
            const optionSelectors = [
              '.artdeco-typeahead__result',
              '[role="listbox"] [role="option"]',
              '.basic-typeahead__selectable',
              '.artdeco-typeahead__result-list li',
              '.artdeco-typeahead__results-container li',
              '.search-typeahead-v2__hit',
              'div[role="option"]',
              'li[role="option"]',
              '.fb-dash-typeahead__result'
            ];
            const isVis = window.__isVisible || (el => {
              const r = el.getBoundingClientRect();
              return (r.width > 0 && r.height > 0) || el.getClientRects().length > 0;
            });
            const opts = Array.from(document.querySelectorAll(optionSelectors.join(', ')))
              .filter(o => isVis(o) && (o.innerText || o.textContent || '').trim().length > 0);
            if (opts.length === 0) return null;

            const tLower = term.toLowerCase();
            const fLower = (full || '').toLowerCase();

            let match = opts.find(o => {
              const txt = (o.innerText || o.textContent || '').trim().toLowerCase();
              return txt === tLower || txt === fLower || txt.includes(tLower) || tLower.includes(txt);
            });

            if (!match && /india/i.test(tLower)) {
              match = opts.find(o => o.innerText.toLowerCase().includes('india') || o.innerText.includes('+91'));
            }
            if (!match && /hyderabad/i.test(tLower)) {
              match = opts.find(o => o.innerText.toLowerCase().includes('hyderabad'));
            }
            if (!match) {
              match = opts[0];
            }

            if (match) {
              match.scrollIntoView({ block: 'nearest' });
              ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'].forEach(evt => {
                match.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
              });
              return (match.innerText || match.textContent || '').trim();
            }
            return null;
          }, searchTerm, fullAnswer);

          // Strategy B: Accessibility Keyboard commit if DOM click wasn't matched
          if (!selectedOptionText) {
            await page.keyboard.press('ArrowDown');
            await this.randomDelay(200, 350);
            await page.keyboard.press('Enter');
            await this.randomDelay(300, 500);
          }

          // Trigger blur so LinkedIn registers complete selection without re-triggering query
          await cbox.evaluate(el => el.dispatchEvent(new Event('blur', { bubbles: true }))).catch(() => {});
          await this.randomDelay(250, 450);

          const aiTag = answerObj.aiPowered ? ' 🤖' : ' ⚡';
          const displayAns = selectedOptionText || fullAnswer;
          this.logger('action', 'LinkedIn', `${aiTag} Searchable dropdown selected: "${displayAns}" for "${qText.slice(0, 35)}..."`);
          recordAnswer(qText, displayAns, 'typeahead', answerObj.source);
        }
      } catch (err) {
        this.logger('warning', 'LinkedIn', `Error filling searchable dropdown: ${err.message}`);
      }
    }

    // 6. TEXT / NUMBER / TEL / TEXTAREA INPUT FIELDS
    const textAndNumInputs = await dialogHandle.$$(
      'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([role="combobox"]):not([aria-autocomplete="list"]):not([aria-autocomplete="both"]):not(.artdeco-typeahead__input), textarea'
    );
    for (const input of textAndNumInputs) {
      try {
        const fieldInfo = await input.evaluate(el => {
          if (el.closest('footer') || el.closest('header')) return null;
          const q = window.__extractQuestion ? window.__extractQuestion(el) : '';
          const helper = window.__extractHelperText ? window.__extractHelperText(el) : '';

          const container = el.closest('.fb-dash-form-element, .jobs-easy-apply-form-section__grouping, div[data-test-form-builder-component], div');
          const errEl = container ? container.querySelector('.artdeco-inline-feedback--error, [class*="error"], [aria-invalid="true"]') : null;
          const isErrVisible = errEl ? ((errEl.getBoundingClientRect().width > 0 && errEl.getBoundingClientRect().height > 0) || errEl.getClientRects().length > 0) : false;
          const isInvalid = el.getAttribute('aria-invalid') === 'true' || isErrVisible;

          return {
            qText: q,
            helperText: helper,
            val: el.value?.trim() || '',
            tag: el.tagName.toLowerCase(),
            type: el.type?.toLowerCase() || 'text',
            inputMode: el.inputMode || el.getAttribute('inputmode') || '',
            pattern: el.pattern || el.getAttribute('pattern') || '',
            placeholder: el.placeholder || '',
            isInvalid
          };
        });

        if (!fieldInfo || !fieldInfo.qText) continue;
        const qText = fieldInfo.qText;
        if (qText === 'Search' || qText.includes('Premium') || qText.includes('language')) continue;

        const fullQ = (qText + ' ' + (fieldInfo.helperText || '') + ' ' + (fieldInfo.placeholder || '')).trim();
        const isWholeNumber = /whole number|integer/i.test(fullQ);
        const isNoticePeriod = /notice period|days to join|joining time/i.test(fullQ);
        const isCompensation = /compensation|salary|ctc|package|gross/i.test(fullQ);
        const isNumeric = isWholeNumber ||
                          isNoticePeriod ||
                          isCompensation ||
                          /how many years|years of experience|work experience|gpa|percentage/i.test(fullQ) ||
                          fieldInfo.type === 'number' ||
                          fieldInfo.inputMode === 'numeric' ||
                          fieldInfo.pattern === '[0-9]*' ||
                          /^\s*e\.?g\.?\s*\d+/i.test(fieldInfo.placeholder);
        const inferredType = isNumeric ? 'number' : 'text';

        // Check if we need to refill or fill
        const isSkillQuestion = /angular|java|spring|javascript|typescript|front[\s-]*end|developer|c#|dot net|\.net|python|react|node|sql|gen ai|ai/i.test(fullQ);
        const isExperienceQuestion = /years of experience|work experience|how many years|experience with/i.test(fullQ);
        
        // Strict refill check:
        // 1. empty value
        // 2. field has an active error (e.g. "Invalid input")
        // 3. field is numeric, but currently contains non-digits (e.g. "Yes", "No", "Invalid input", "true", "false")
        // 4. field contains placeholder-like strings ("select", "choose", "--")
        // 5. skill/experience field contains "0"
        const hasInvalidNumericVal = isNumeric && (fieldInfo.val.length > 0 && (!/^-?\d+(?:\.\d+)?$/.test(fieldInfo.val) || /^(yes|no|invalid|true|false)$/i.test(fieldInfo.val)));
        const shouldFill = !fieldInfo.val ||
                           fieldInfo.isInvalid ||
                           hasInvalidNumericVal ||
                           ((fieldInfo.val === '0' || fieldInfo.val === '') && (isSkillQuestion || isExperienceQuestion)) ||
                           /select|choose|--/i.test(fieldInfo.val);

        if (shouldFill) {
          const answerObj = await this.ai.answerScreeningQuestionAI(qText, [], inferredType, qaContext);
          let finalVal = answerObj.answer;

          if (isNoticePeriod) {
            const d = String(finalVal).match(/\d+/);
            finalVal = d ? d[0] : String(this.ai?.profile?.career?.noticePeriodDays || 30);
          } else if (isCompensation) {
            const isINR = /in\s*inr|in\s*rupees|rupees|annual.*compensation|\bexample\s*:\s*\d{5,}/i.test(fullQ);
            const isLPA = /in\s*lpa|in\s*lakhs|\blpa\b/i.test(fullQ);
            const isExpected = /expected|desired/i.test(fullQ);
            if (isINR && !isLPA) {
              const num = String(finalVal).match(/\d+/);
              if (num && parseInt(num[0], 10) >= 10000) {
                finalVal = num[0];
              } else {
                const lpaVal = parseFloat(finalVal) || (isExpected ? 10.0 : 4.1);
                finalVal = String(Math.round(lpaVal * 100000));
              }
            } else if (isLPA || isNumeric) {
              const num = String(finalVal).match(/\d+(?:\.\d+)?/);
              finalVal = num ? num[0] : (isExpected ? '10' : '4.1');
            }
          } else if (isNumeric) {
            // STRICT NUMERIC GUARD: NEVER allow Yes or No in numeric fields!
            const num = String(finalVal).match(/-?\d+(?:\.\d+)?/);
            if (num) {
              finalVal = num[0];
            } else if (isExperienceQuestion || isSkillQuestion) {
              finalVal = '3';
            } else {
              finalVal = '0';
            }
          } else if (/portfolio|website/i.test(qText)) {
            if (/^(yes|no|true|false)$/i.test(String(finalVal).trim())) {
              finalVal = this.ai?.profile?.personal?.portfolioUrl || 'https://gsaikrishna-portfolio.netlify.app/';
            }
          } else if (/linkedin/i.test(qText)) {
            if (/^(yes|no|true|false)$/i.test(String(finalVal).trim())) {
              finalVal = this.ai?.profile?.personal?.linkedInUrl || 'https://www.linkedin.com/in/saikrishnag150';
            }
          }

          // Clean input clearing and typing (handles React, Ember, and native HTML)
          await input.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' })).catch(() => {});
          await input.click({ clickCount: 3 });
          await page.keyboard.press('Backspace');
          await input.evaluate(el => {
            el.focus();
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });

          await input.type(String(finalVal), { delay: 25 });
          await input.evaluate((el, val) => {
            // Also call prototype setter in case React controlled state wasn't updated by typing
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (setter) {
              try { setter.call(el, val); } catch (e) {}
            } else {
              el.value = val;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          }, String(finalVal));

          const aiTag = answerObj.aiPowered ? ' 🤖' : ' ⚡';
          this.logger('action', 'LinkedIn', `${aiTag} Filled: [${finalVal}] for "${qText.slice(0, 35)}..."`);
          recordAnswer(qText, String(finalVal), inferredType, answerObj.source);
          await this.randomDelay(250, 450);
        }
      } catch (fErr) {
        this.logger('warning', 'LinkedIn', `Field fill error: ${fErr.message}`);
      }
    }

    // Inspect if any fields remained unfilled on this step
    await this.scanAndRecordUnfilledFields(page, jobDetails);
  }

}

module.exports = LinkedInBot;
