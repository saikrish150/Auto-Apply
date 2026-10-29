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
    this.careerSiteBot = new CareerSiteBot(chromeManager, aiAgent, settings, logger);
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
      const rawLocations = this.settings.search?.locations || 'Hyderabad';
      const activeLocation = rawLocations.split(',')[0].trim() || 'India';
      const dateFilter = this.getDateFilterParam(this.settings.search?.datePosted);
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

      this.logger('info', 'LinkedIn', `LinkedIn bot initialized with ${scenarios.length} scenarios in ${activeLocation}. Freshness: ${this.settings.search?.datePosted || 'past_24h'}. Dual-Phase: ${shortlistNonEasyApply ? 'Easy Apply + Normal Shortlisting' : 'Easy Apply Only'}.`);

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
            const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(currentScenario)}&location=${encodeURIComponent(activeLocation)}&${easyApplyParam}${dateFilter}${startParam}`;

            this.logger('info', 'LinkedIn', `[${phase.name} | Page ${pageNum + 1}] Searching: "${currentScenario}" in ${activeLocation} (Freshness: ${this.settings.search?.datePosted || 'past_24h'})...`);
            
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
                  const isApplied = /applied/i.test(text) || !!el.querySelector('.job-card-container__footer-item, [class*="status-badge"], [class*="applied"]');
                  const hasEasyApply = /easy\s*apply/i.test(text);

                  const jobIdAttr = el.getAttribute('data-occludable-job-id') || el.getAttribute('data-job-id');
                  const link = el.querySelector('a[href*="/jobs/view/"], a.job-card-list__title, a.job-card-container__link');
                  const href = link ? link.href : '';
                  const idMatch = href.match(/\/jobs\/view\/(\d+)/);
                  const jobId = jobIdAttr || (idMatch ? idMatch[1] : '');

                  const titleEl = el.querySelector('.job-card-list__title, .job-card-container__link, a[class*="job-title"], strong');
                  const compEl = el.querySelector('.job-card-container__primary-description, .artdeco-entity-lockup__subtitle, [class*="company-name"]');
                  const locEl = el.querySelector('.job-card-container__metadata-item, [class*="metadata-item"], [class*="job-card-container__bullet"]');

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

                const titleKey = `${(cardPre.title || '').toLowerCase().trim()}|${(cardPre.company || '').toLowerCase().trim()}`;

                // 1. Skip if already applied
                if (cardPre.isApplied) {
                  this.logger('info', 'LinkedIn', `[Pre-check] Skipping "${cardPre.title || 'Job'}" at ${cardPre.company} - card shows already applied.`);
                  if (cardPre.jobId) this.seenJobKeys.add(cardPre.jobId);
                  if (titleKey) this.seenJobKeys.add(titleKey);
                  continue;
                }

                // 2. Skip if already seen in current session or historical applications
                if ((cardPre.jobId && this.seenJobKeys.has(cardPre.jobId)) || (titleKey && this.seenJobKeys.has(titleKey))) {
                  this.logger('info', 'LinkedIn', `[Pre-check] Skipping "${cardPre.title || 'Job'}" at ${cardPre.company} - already processed.`);
                  continue;
                }

                // 3. In Easy Apply phase: skip if card doesn't have Easy Apply
                if (phase.easyApplyOnly && !cardPre.hasEasyApply) {
                  this.logger('info', 'LinkedIn', `[Pre-check] Skipping "${cardPre.title || 'Job'}" - no Easy Apply indicator.`);
                  if (cardPre.jobId) this.seenJobKeys.add(cardPre.jobId);
                  continue;
                }

                // Record in seenJobKeys before opening so we don't repeat
                if (cardPre.jobId) this.seenJobKeys.add(cardPre.jobId);
                if (titleKey) this.seenJobKeys.add(titleKey);

                // Click card to load job details in the right pane
                await card.evaluate(el => {
                  el.scrollIntoView({ block: 'center', inline: 'nearest' });
                  el.click();
                });
                await this.randomDelay(1800, 2800);

                // Extract job details from right-hand details pane
                const jobDetails = await page.evaluate(() => {
                  const pane = document.querySelector('.jobs-details__main-content, .scaffold-layout__detail, .job-view-layout, .jobs-search__job-details') || document;
                  const titleEl = pane.querySelector(
                    '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1, .top-card-layout__title, [class*="job-title"]'
                  );
                  const companyEl = pane.querySelector(
                    '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, [class*="company-name"], a[href*="/company/"], .topcard__flavor'
                  );
                  const locationEl = pane.querySelector(
                    '.job-details-jobs-unified-top-card__bullet, .jobs-unified-top-card__bullet, [class*="bullet"], .topcard__flavor--bullet'
                  );
                  const descEl = pane.querySelector(
                    '.jobs-description__content, #job-details, .show-more-less-html__markup, [class*="description"]'
                  );

                  return {
                    title: titleEl ? titleEl.innerText.trim() : 'Software Developer',
                    company: companyEl ? companyEl.innerText.trim() : 'Company',
                    location: locationEl ? locationEl.innerText.trim() : 'India',
                    description: descEl ? descEl.innerText.trim() : ''
                  };
                });

                this.logger('info', 'LinkedIn', `[${phase.name}] Evaluating: "${jobDetails.title}" at ${jobDetails.company}...`);

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

                // PHASE 2: NORMAL JOBS DISCOVERY (WITHOUT EASY APPLY) -> SHORTLIST INTO MANUAL APPLY QUEUE
                if (!phase.easyApplyOnly) {
                  this.logger('success', 'LinkedIn', `[Manual Shortlist] High-fit normal job matched: "${jobDetails.title}" at ${jobDetails.company} (Score: ${evaluation.score}%). Adding to Manual Apply Queue...`);
                  jobRecord.status = 'MANUAL_ACTION_REQUIRED';
                  jobRecord.actionRequired = true;
                  jobRecord.directApplicationUrl = page.url();
                  jobRecord.applicationMethod = 'manual_shortlist';
                  jobRecord.reason = `High match (${evaluation.score}%) - Shortlisted normal job application for manual submission`;
                  totalProcessedCount++;

                  if (onJobProcessed) onJobProcessed(jobRecord);
                  await this.randomDelay(1500, 2500);
                  continue;
                }

                // PHASE 1: EASY APPLY AUTO-APPLICATION
                if (this.settings.automation?.simulationMode) {
                  this.logger('simulation', 'LinkedIn', `[Simulation Mode] Simulating Easy Apply flow for "${jobDetails.title}"`);
                  await this.randomDelay(1500, 2500);
                  jobRecord.status = 'applied (simulated)';
                  totalProcessedCount++;
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

                // Look for Easy Apply button
                const easyApplyBtn = await page.$(
                  'button[aria-label*="Easy Apply"], .jobs-apply-button--top-card button, button.jobs-apply-button, button[data-control-name="jobdetails_topcard_inapply"]'
                );
                if (!easyApplyBtn) {
                  // Check if an external "Apply on company website" button exists
                  const externalApplyBtn = await page.$(
                    'a[href*="/jobs/view/externalApply/"], a[aria-label*="Apply to"], button[aria-label*="Apply to"], a.jobs-apply-button'
                  );

                  if (externalApplyBtn && this.settings.automation?.applyOnCompanySite !== false) {
                    this.logger('action', 'LinkedIn', `External company apply available for "${jobDetails.title}". Opening career website...`);
                    const pagesBefore = await this.chrome.browser.pages();
                    await externalApplyBtn.evaluate(b => b.click());
                    await this.randomDelay(2500, 4000);

                    const pagesAfter = await this.chrome.browser.pages();
                    const externalTab = pagesAfter.find(p => !pagesBefore.includes(p));

                    if (externalTab) {
                      const extUrl = externalTab.url();
                      this.logger('info', 'LinkedIn', `Company career site opened: ${extUrl}`);
                      jobRecord.externalUrl = extUrl;

                      const careerRes = await this.careerSiteBot.applyToCareerPage(externalTab, jobDetails);
                      jobRecord.status = careerRes.status || 'MANUAL_ACTION_REQUIRED';
                      jobRecord.directApplicationUrl = extUrl;
                      jobRecord.applicationMethod = careerRes.applicationMethod || 'external_portal';
                      jobRecord.questionsAnswered = careerRes.questionsAnswered || [];
                      if (jobRecord.status === 'MANUAL_ACTION_REQUIRED') {
                        jobRecord.actionRequired = true;
                        jobRecord.reason = careerRes.reason || 'External career portal requires manual application';
                      }
                      totalProcessedCount++;

                      // Only close tab if submission is explicitly confirmed
                      const isConfirmed = careerRes.status === 'APPLIED_CONFIRMED' || careerRes.status === 'applied';
                      if (isConfirmed && this.settings.automation?.closeCareerTabAfterSubmit !== false) {
                        try {
                          await this.randomDelay(2500, 3500);
                          if (!externalTab.isClosed()) await externalTab.close();
                        } catch (e) {}
                      } else {
                        this.logger('info', 'LinkedIn', `Tab retained for your inspection and manual completion: ${extUrl}`);
                      }

                      if (onJobProcessed) onJobProcessed(jobRecord);
                      continue;
                    }
                  }

                  this.logger('info', 'LinkedIn', `Easy Apply button not present for "${jobDetails.title}".`);
                  const isHighMatch = jobRecord.matchScore >= (this.settings.automation?.minMatchScore || 65);
                  if (isHighMatch) {
                    jobRecord.status = 'MANUAL_ACTION_REQUIRED';
                    jobRecord.actionRequired = true;
                    jobRecord.directApplicationUrl = page.url();
                    jobRecord.applicationMethod = 'manual_shortlist';
                    jobRecord.reason = `High match (${jobRecord.matchScore}%) - Easy Apply not present, preserved in Manual Apply Queue`;
                  } else {
                    jobRecord.status = 'ALREADY_APPLIED';
                  }
                  if (onJobProcessed) onJobProcessed(jobRecord);
                  continue;
                }

                this.logger('action', 'LinkedIn', `Initiating Easy Apply for "${jobDetails.title}" (Score: ${evaluation.score}%)...`);
                await easyApplyBtn.evaluate(b => b.click());
                await this.randomDelay(1800, 2800);

                // Handle multi-step modal and collect all answered screening questions
                const answeredQuestions = [];
                const applicationSuccess = await this.handleModalFlow(page, jobDetails, answeredQuestions);
                jobRecord.questionsAnswered = answeredQuestions;
                
                if (applicationSuccess) {
                  jobRecord.status = 'applied';
                  totalProcessedCount++;
                  this.logger('success', 'LinkedIn', `Successfully applied to "${jobDetails.title}" at ${jobDetails.company}!`);
                } else {
                  jobRecord.status = 'MANUAL_ACTION_REQUIRED';
                  jobRecord.actionRequired = true;
                  jobRecord.directApplicationUrl = page.url();
                  jobRecord.reason = `Application for "${jobDetails.title}" requires manual verification or custom input`;
                  this.logger('warning', 'LinkedIn', `Application for "${jobDetails.title}" requires manual verification. Enqueued into Manual Apply Queue.`);
                }

                if (onJobProcessed) onJobProcessed(jobRecord);
                await this.randomDelay(2000, 4000);

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
    let maxSteps = 10;
    while (maxSteps > 0) {
      maxSteps--;
      await this.randomDelay(1000, 1800);

      // 1. Auto-fill form fields on the current step first
      await this.fillFormFields(page, jobDetails, answeredQuestions);
      await this.randomDelay(600, 1000);

      // 2. Check if Submit button is visible and active
      const isSubmitStep = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('dialog footer button, [role="dialog"] footer button, footer button'));
        const sub = buttons.find(b => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          return aria.includes('submit application') || txt === 'submit application' || txt === 'submit';
        });
        if (sub && !sub.disabled && sub.getAttribute('aria-disabled') !== 'true') {
          sub.click();
          return true;
        }
        return false;
      });

      if (isSubmitStep) {
        if (this.settings.automation?.mode === 'semi-auto') {
          this.logger('action', 'LinkedIn', 'Semi-Auto Mode: Application submitted!');
        }
        await this.randomDelay(2000, 3500);

        // Dismiss done / confirmation dialog if any
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const done = buttons.find(b => {
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            const txt = (b.innerText || '').toLowerCase();
            return aria.includes('dismiss') || txt === 'done' || b.getAttribute('data-control-name') === 'overlay.close_padding';
          });
          if (done) done.click();
        });
        return true;
      }

      // 3. Advance to the next step via Next or Review button
      const stepAdvanced = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('dialog footer button, [role="dialog"] footer button, footer button'));
        
        // Priority 1: Next button
        const next = buttons.find(b => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          return aria.includes('continue to next step') || txt === 'next' || aria.includes('next');
        });
        if (next && !next.disabled && next.getAttribute('aria-disabled') !== 'true') {
          next.click();
          return 'next';
        }

        // Priority 2: Review button
        const review = buttons.find(b => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          return aria.includes('review your application') || txt === 'review' || aria.includes('review');
        });
        if (review && !review.disabled && review.getAttribute('aria-disabled') !== 'true') {
          review.click();
          return 'review';
        }

        return false;
      });

      if (!stepAdvanced) {
        // Check if there are form validation errors holding the step back
        const hasErrors = await page.evaluate(() => {
          const errs = document.querySelectorAll('.artdeco-inline-feedback--error, [aria-invalid="true"], .fb-dash-form-element__error-field');
          return Array.from(errs).map(e => e.innerText.trim()).filter(Boolean);
        });
        if (hasErrors.length > 0) {
          this.logger('warning', 'LinkedIn', `Form validation error on step: ${hasErrors.slice(0, 2).join('; ')}`);
        }
        // Capture any unfilled or blocking fields so user can input them in dashboard
        await this.scanAndRecordUnfilledFields(page, jobDetails);
        this.logger('warning', 'LinkedIn', `Application blocked by unfilled fields. Added to Dashboard "Missing Fields" for manual input.`);
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
          return /^(invalid input|this field is required|please enter|please select|please specify|field is required|required field)/i.test(t.trim());
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
          const hasVisibleError = (errText.length > 0 && !errText.toLowerCase().includes('optional') && errEl.offsetParent !== null) || isAriaInvalid;
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
                const l = r.id ? dialog.querySelector(`label[for="${r.id}"]`) : null;
                return (l?.innerText || r.value || '').trim();
              }).filter(Boolean);
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
      window.__cleanText = function(t) {
        if (!t) return '';
        return t.replace(/[\*\:]/g, '').replace(/\b(?:\d+\/\d+|\d+\s*of\s*\d+\s*characters?)\b/gi, '').trim();
      };

      window.__isErrorText = function(t) {
        if (!t) return false;
        return /^(invalid input|this field is required|please enter|please select|please specify|field is required|required field)/i.test(t.trim());
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

        if (el.id) {
          const l = document.querySelector(`label[for="${el.id}"]`);
          if (l && l.innerText.trim() && !window.__isErrorText(window.__cleanText(l.innerText))) return window.__cleanText(l.innerText);
        }
        const parentLabel = el.closest('label');
        if (parentLabel && parentLabel.innerText.trim() && !window.__isErrorText(window.__cleanText(parentLabel.innerText))) return window.__cleanText(parentLabel.innerText);
        const fieldset = el.closest('fieldset');
        if (fieldset) {
          const legend = fieldset.querySelector('legend');
          if (legend && legend.innerText.trim()) return window.__cleanText(legend.innerText);
        }
        let curr = el.parentElement;
        for (let depth = 0; depth < 5 && curr; depth++) {
          const headerEl = curr.querySelector('label:not([class*="error"]), legend, h3, h4, span[class*="label"]:not([class*="error"]), span[class*="title"], p:not([class*="error"]):not([class*="feedback"])');
          if (headerEl && headerEl !== el && headerEl.innerText.trim()) {
            const t = window.__cleanText(headerEl.innerText);
            if (t.length > 3 && !/^\d+\/\d+/.test(t) && !/of \d+ characters/i.test(t) && !window.__isErrorText(t)) {
              return t;
            }
          }
          const lines = (curr.innerText || '').split('\n').map(s => window.__cleanText(s)).filter(s => s.length > 2 && !/^\d+\/\d+/.test(s) && !/of \d+ characters/i.test(s) && !window.__isErrorText(s));
          if (lines.length > 0) {
            return lines[0];
          }
          curr = curr.parentElement;
        }
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
            const opts = Array.from(document.querySelectorAll(
              '[role="listbox"] [role="option"], .artdeco-dropdown__item, .artdeco-dropdown__content li, ul[role="listbox"] li'
            )).filter(o => o.offsetParent !== null && (o.innerText || o.textContent || '').trim().length > 0);
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
              const opts = Array.from(document.querySelectorAll(
                '[role="listbox"] [role="option"], .artdeco-dropdown__item, .artdeco-dropdown__content li, ul[role="listbox"] li'
              )).filter(o => o.offsetParent !== null && (o.innerText || o.textContent || '').trim().length > 0);
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
            const l = r.id ? document.querySelector(`label[for="${r.id}"]`) : null;
            const parentL = r.closest('label');
            const aria = r.getAttribute('aria-label');
            const nearby = r.parentElement?.innerText;
            // Never use the native default value "on" as an option label.
            return (l?.innerText || parentL?.innerText || aria || nearby || '').trim();
          }).filter(Boolean);
          const checked = groupEls.some(r => r.checked);
          return { qText, options, checked };
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
            const l = r.id ? document.querySelector(`label[for="${r.id}"]`) : null;
            const parentL = r.closest('label');
            const txt = (l?.innerText || parentL?.innerText || r.getAttribute('aria-label') || r.parentElement?.innerText || '').trim().toLowerCase();
            if (txt === tLower || txt.includes(tLower) || tLower.includes(txt)) {
              chosen = r;
              break;
            }
          }
          if (!chosen && /yes/i.test(tLower)) chosen = radios.find(r => /yes/i.test(r.getAttribute('aria-label') || r.parentElement?.innerText || ''));
          if (!chosen && /no/i.test(tLower)) chosen = radios.find(r => /no/i.test(r.getAttribute('aria-label') || r.parentElement?.innerText || ''));
          if (chosen) {
            chosen.click();
            chosen.checked = true;
            const l = chosen.id ? document.querySelector(`label[for="${chosen.id}"]`) : null;
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
          return { checked: el.checked, required: el.required || el.getAttribute('aria-required') === 'true' };
        });
        if (cbInfo && !cbInfo.checked && cbInfo.required) {
          await cb.evaluate(el => {
            el.click();
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });
          this.logger('action', 'LinkedIn', 'Checked required checkbox.');
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
          const isInvalid = el.getAttribute('aria-invalid') === 'true' || (Boolean(errEl) && errEl.offsetParent !== null);

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
            const opts = Array.from(document.querySelectorAll(optionSelectors.join(', ')))
              .filter(o => o.offsetParent !== null && (o.innerText || o.textContent || '').trim().length > 0);
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
          return {
            qText: q,
            val: el.value?.trim() || '',
            tag: el.tagName.toLowerCase(),
            type: el.type?.toLowerCase() || 'text'
          };
        });

        if (!fieldInfo || !fieldInfo.qText) continue;
        const qText = fieldInfo.qText;
        if (qText === 'Search' || qText.includes('Premium') || qText.includes('language')) continue;

        const isWholeNumber = /whole number|integer/i.test(qText);
        const isNoticePeriod = /notice period|days to join/i.test(qText);
        const isCompensation = /compensation|salary|ctc|package/i.test(qText);
        const isNumeric = isWholeNumber || isNoticePeriod || isCompensation || /how many years|years of experience|work experience|gpa|percentage/i.test(qText) || fieldInfo.type === 'number';
        const inferredType = isNumeric ? 'number' : 'text';

        // Check if we need to refill or fill
        const isSkillQuestion = /angular|java|spring|javascript|typescript|front[\s-]*end|developer|c#|dot net|\.net|python|react|node|sql|gen ai|ai/i.test(qText);
        const isExperienceQuestion = /years of experience|work experience|how many years|experience with/i.test(qText);
        const shouldFill = !fieldInfo.val || ((fieldInfo.val === '0' || fieldInfo.val === '') && (isSkillQuestion || isExperienceQuestion)) || /select|choose|--/i.test(fieldInfo.val);

        if (shouldFill) {
          const answerObj = await this.ai.answerScreeningQuestionAI(qText, [], inferredType, qaContext);
          let finalVal = answerObj.answer;

          if (isNoticePeriod && (/\(in days\)|days/i.test(qText) || isNumeric)) {
            const d = finalVal.match(/\d+/);
            finalVal = d ? d[0] : '30';
          } else if (isCompensation && (/\(in lpa\)|\(in lakhs\)|lpa/i.test(qText) || isNumeric)) {
            const num = finalVal.match(/\d+(?:\.\d+)?/);
            finalVal = num ? num[0] : '11';
          } else if (isNumeric) {
            const num = finalVal.match(/-?\d+(?:\.\d+)?/);
            finalVal = num ? num[0] : '0';
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
