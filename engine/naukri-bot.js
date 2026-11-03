const path = require('path');
const fs = require('fs');
const CareerSiteBot = require('./career-site-bot');

class NaukriBot {
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

  stop() {
    this.shouldStop = true;
  }

  async randomDelay(min = 1800, max = 3200) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(r => setTimeout(r, delay));
  }

  // Close any orphan job detail tabs left over from prior runs
  async cleanupOrphanTabs(keepPage) {
    try {
      if (!this.chrome.browser) return;
      const pages = await this.chrome.browser.pages();
      for (const p of pages) {
        if (p !== keepPage && p.url().includes('job-listings-')) {
          await p.close().catch(() => {});
        }
      }
    } catch (e) {
      // Ignore cleanup error
    }
  }

  // Get freshness query parameter for Naukri (freshness=1: 24h, freshness=2: 48h, freshness=7: 7 days) + sort by date
  getDateFilterParam(datePosted) {
    switch (datePosted) {
      case 'past_1h':
      case 'past_2h':
      case 'past_24h':
        return 'freshness=1&sortBy=date';
      case 'past_48h':
        return 'freshness=2&sortBy=date';
      case 'past_week':
        return 'freshness=7&sortBy=date';
      case 'all':
        return 'sortBy=date';
      default:
        return 'freshness=1&sortBy=date';
    }
  }

  // Get experience filter for Naukri query string (e.g. experience=2)
  getExperienceParam(expSetting) {
    const raw = String(expSetting || '').toLowerCase();
    if (raw === 'all') return '';
    const match = raw.match(/(\d+)/);
    if (match) {
      const expVal = Math.min(parseInt(match[1], 10), 3);
      return `experience=${expVal}`;
    }
    // Default 2 years for 1-4 years candidate profile
    return 'experience=2';
  }

  // Get active scenarios list from settings
  getScenarios() {
    if (this.settings.search?.scenarios && Array.isArray(this.settings.search.scenarios) && this.settings.search.scenarios.length > 0) {
      return this.settings.search.scenarios;
    }
    const raw = this.settings.search?.keywords || 'Full Stack Developer';
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }

  async run(onJobProcessed) {
    this.shouldStop = false;
    this.logger('info', 'Naukri', 'Initializing Naukri Fast Apply automation in Chrome...');

    const page = await this.chrome.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await this.cleanupOrphanTabs(page);

    // Intercept real-time Naukri Search API to map each jobId to its application type (native Easy Apply vs company external apply)
    const jobMetadataMap = new Map();
    page.on('response', async res => {
      try {
        const u = res.url();
        if (u.includes('/jobapi/v3/search') || u.includes('/jobapi/v2/search')) {
          const data = await res.json();
          if (data && Array.isArray(data.jobDetails)) {
            for (const job of data.jobDetails) {
              if (job && job.jobId) {
                jobMetadataMap.set(String(job.jobId), {
                  companyApplyJob: job.companyApplyJob === true,
                  applyRedirectUrl: job.applyRedirectUrl || '',
                  companyApplyUrl: job.companyApplyUrl || '',
                  title: job.title || '',
                  companyName: job.companyName || ''
                });
              }
            }
          }
        }
      } catch (e) {}
    });

    try {
      const scenarios = this.getScenarios();
      const dateParam = this.getDateFilterParam(this.settings.search?.datePosted);
      const expParam = this.getExperienceParam(this.settings.search?.experienceLevel);
      const queryParts = [expParam, dateParam].filter(Boolean);
      const searchQueryParams = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
      const maxApps = this.settings.automation?.maxApplicationsPerSession || 25;
      const maxPages = this.settings.automation?.maxPagesPerScenario || 2;
      let totalProcessedCount = 0;

      this.logger('info', 'Naukri', `Naukri bot initialized with ${scenarios.length} scenarios (All Locations | Deduplication Filter Disabled). Freshness: ${this.settings.search?.datePosted || 'past_24h'}. Exp Filter: ${expParam || 'None'}.`);

      for (let sIdx = 0; sIdx < scenarios.length; sIdx++) {
        if (this.shouldStop || totalProcessedCount >= maxApps) break;

        const currentScenario = scenarios[sIdx];
        const scenarioSlug = currentScenario.toLowerCase().replace(/[^a-z0-9]+/g, '-');

        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
          if (this.shouldStop || totalProcessedCount >= maxApps) break;

          const pageSlug = pageNum > 1 ? `-${pageNum}` : '';
          const searchUrl = `https://www.naukri.com/${scenarioSlug}-jobs${pageSlug}${searchQueryParams}`;

          this.logger('action', 'Naukri', `[Scenario ${sIdx + 1}/${scenarios.length} | Page ${pageNum}] Navigating to: ${searchUrl}...`);
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await this.randomDelay(3000, 4500);

          // Check if user is logged into Naukri
          const isLoggedIn = await page.evaluate(() => {
            const userIndicators = document.querySelectorAll('.nI-gNb-drawer, .view-profile-wrapper, .user-name, img[alt*="profile"], .nI-gNb-header__user, a[href*="my-profile"], a[href*="mynaukri"], .user-details');
            const loginButtons = document.querySelectorAll('a#login_Layer, a[href*="/nlogin/login"], .nI-gNb-header__login');
            return userIndicators.length > 0 || loginButtons.length === 0;
          });

          if (!isLoggedIn) {
            this.logger('warning', 'Naukri', 'Naukri session detected as Guest. Please sign into your Naukri account in the Chrome window for automated 1-Click Fast Apply.');
          } else if (sIdx === 0 && pageNum === 1) {
            this.logger('success', 'Naukri', 'Active Naukri session confirmed.');
          }

          // Human-like smooth scroll down the results list
          await page.evaluate(async () => {
            for (let s = 0; s < 4; s++) {
              window.scrollBy({ top: 400, behavior: 'smooth' });
              await new Promise(r => setTimeout(r, 400));
            }
          });
          await this.randomDelay(1200, 2200);

          // Collect job card tuples
          const jobTuples = await page.$$('.srp-jobtuple-wrapper, .cust-job-tuple, .jobTuple, [data-job-id]');
          this.logger('info', 'Naukri', `Found ${jobTuples.length} matching jobs on page ${pageNum} for "${currentScenario}".`);

          if (jobTuples.length === 0) {
            this.logger('info', 'Naukri', `No more jobs found for scenario "${currentScenario}". Proceeding to next scenario.`);
            break;
          }

          for (let i = 0; i < jobTuples.length; i++) {
            if (this.shouldStop || totalProcessedCount >= maxApps) break;

            let jobTab = null;

            try {
              const card = jobTuples[i];
              await card.scrollIntoView();
              await this.randomDelay(800, 1500);

              // Extract basic info from the tuple card
              const jobMeta = await card.evaluate(el => {
                const titleEl = el.querySelector('a.title, .job-title');
                const compEl = el.querySelector('a.comp-name, .comp-name');
                const expEl = el.querySelector('.expwdth, .exp-wrap, .exp');
                const salEl = el.querySelector('.sal-wrap, .salary');
                const locEl = el.querySelector('.locwdth, .loc-wrap, .loc');
                const tagEls = Array.from(el.querySelectorAll('.tag-li, .tags-gt, .dot-gt'));
                const appliedBadge = el.querySelector('.applied-text, .already-applied');
                const cardJobId = el.getAttribute('data-job-id') || (titleEl && titleEl.href ? (titleEl.href.match(/-(\d+)(?:\?|$)/)?.[1] || '') : '');

                return {
                  jobId: cardJobId,
                  title: titleEl ? titleEl.innerText.trim() : 'Software Engineer',
                  company: compEl ? compEl.innerText.trim() : 'Company',
                  url: titleEl ? titleEl.href : window.location.href,
                  experience: expEl ? expEl.innerText.trim() : '',
                  salary: salEl ? salEl.innerText.trim() : 'Not disclosed',
                  location: locEl ? locEl.innerText.trim() : 'India',
                  tags: tagEls.map(t => t.innerText.trim()).filter(Boolean),
                  alreadyApplied: !!appliedBadge
                };
              });

              const titleKey = `${(jobMeta.title || '').toLowerCase().trim()}|${(jobMeta.company || '').toLowerCase().trim()}`;
              const normUrl = jobMeta.url ? jobMeta.url.split('?')[0].trim() : '';

              const jobRecord = {
                id: `nk-${Date.now()}-${sIdx}-${i}`,
                platform: 'Naukri',
                scenario: currentScenario,
                title: jobMeta.title,
                company: jobMeta.company,
                location: jobMeta.location,
                url: jobMeta.url,
                directApplicationUrl: jobMeta.url,
                status: 'evaluating',
                timestamp: new Date().toISOString()
              };

              // 1. Skip if card marked as applied
              if (jobMeta.alreadyApplied) {
                this.logger('info', 'Naukri', `[Pre-check] Skipping "${jobMeta.title}" at ${jobMeta.company} - already marked as applied.`);
                if (titleKey) this.seenJobKeys.add(titleKey);
                if (normUrl) this.seenJobKeys.add(normUrl);
                jobRecord.status = 'already_applied';
                if (onJobProcessed) onJobProcessed(jobRecord);
                continue;
              }

              // 2. Pre-filter external company applies via intercepted Naukri Search API
              // Exclusively process native 1-Click Fast Apply / Easy Apply jobs
              const apiMeta = jobMeta.jobId ? jobMetadataMap.get(String(jobMeta.jobId)) : null;
              if (apiMeta && apiMeta.companyApplyJob === true) {
                this.logger('info', 'Naukri', `[Pre-check] Skipping "${jobMeta.title}" at ${jobMeta.company} - External company site link (Naukri external applies disabled; exclusively processing native Easy / Fast Apply).`);
                if (titleKey) this.seenJobKeys.add(titleKey);
                if (normUrl) this.seenJobKeys.add(normUrl);
                jobRecord.status = 'skipped';
                jobRecord.skipReason = 'External company apply link (Naukri external applies disabled)';
                if (onJobProcessed) onJobProcessed(jobRecord);
                continue;
              }

              // Guard 0: Skip if card URL itself is an external company portal (not on naukri.com)
              if (jobMeta.url && !jobMeta.url.includes('naukri.com')) {
                this.logger('info', 'Naukri', `Skipping "${jobMeta.title}" at ${jobMeta.company} - External company link on card (${jobMeta.url}). Naukri external applies are disabled.`);
                if (titleKey) this.seenJobKeys.add(titleKey);
                if (normUrl) this.seenJobKeys.add(normUrl);
                jobRecord.status = 'skipped';
                jobRecord.skipReason = 'External company link on card (Naukri external applies disabled)';
                if (onJobProcessed) onJobProcessed(jobRecord);
                continue;
              }

              // Guard 0b: Strictly skip jobs requiring >4 years of experience (0-3 or 0-4 years maximum)
              const cardExpMatch = String(jobMeta.experience || '').match(/(\d+(?:\.\d+)?)/);
              const cardMinExp = cardExpMatch ? parseFloat(cardExpMatch[1]) : null;
              const isCardSenior = /senior|sr\.|lead|architect|principal|staff|director|vp|head/i.test(jobMeta.title);
              if ((cardMinExp !== null && cardMinExp > 4.0) || (isCardSenior && cardMinExp !== null && cardMinExp > 3.0)) {
                this.logger('info', 'Naukri', `Skipping "${jobMeta.title}" at ${jobMeta.company} - Experience requirement (${jobMeta.experience}) exceeds 0-4 years maximum.`);
                if (titleKey) this.seenJobKeys.add(titleKey);
                if (normUrl) this.seenJobKeys.add(normUrl);
                jobRecord.status = 'skipped';
                jobRecord.skipReason = `Experience requirement (${jobMeta.experience}) exceeds 0-4 years maximum`;
                if (onJobProcessed) onJobProcessed(jobRecord);
                continue;
              }

              // Evaluate with AI Agent before opening new tab
              const descCombined = `${jobMeta.title} Skills: ${jobMeta.tags.join(', ')} Experience: ${jobMeta.experience}`;
              const evaluation = this.ai.evaluateJobMatch(jobMeta.title, descCombined, jobMeta.company);
              jobRecord.matchScore = evaluation.score;
              jobRecord.overallFitScore = evaluation.score;
              jobRecord.technicalScore = evaluation.score;
              jobRecord.evaluation = evaluation;

              if (!evaluation.isRecommended) {
                this.logger('warning', 'Naukri', `Skipping "${jobMeta.title}" (${evaluation.score}% < threshold ${this.settings.automation?.minMatchScore || 65}%).`);
                jobRecord.status = 'skipped';
                jobRecord.skipReason = `ATS score ${evaluation.score}% < threshold`;
                if (titleKey) this.seenJobKeys.add(titleKey);
                if (normUrl) this.seenJobKeys.add(normUrl);
                if (onJobProcessed) onJobProcessed(jobRecord);
                continue;
              }

              // Record in seenJobKeys before opening so we don't repeat
              if (titleKey) this.seenJobKeys.add(titleKey);
              if (normUrl) this.seenJobKeys.add(normUrl);

              this.logger('action', 'Naukri', `[${currentScenario}] Selected "${jobMeta.title}" at ${jobMeta.company} (Score: ${evaluation.score}%)...`);

              if (this.settings.automation?.simulationMode) {
                this.logger('simulation', 'Naukri', `[Simulation Mode] Simulating Naukri Fast Apply for "${jobMeta.title}"`);
                await this.randomDelay(1400, 2400);
                jobRecord.status = 'applied (simulated)';
                totalProcessedCount++;
                if (onJobProcessed) onJobProcessed(jobRecord);
                continue;
              }

              // Open job page in new tab or click
              const titleLink = await card.$('a.title');
              if (titleLink) {
                const pagesBefore = await this.chrome.browser.pages();
                await titleLink.evaluate(a => a.click());
                await this.randomDelay(2000, 3500);

                const pagesAfter = await this.chrome.browser.pages();
                jobTab = pagesAfter.find(p => !pagesBefore.includes(p)) || pagesAfter[pagesAfter.length - 1];
                
                if (jobTab && jobTab !== page) {
                  // Guard 1: Verify the opened tab is strictly a naukri.com domain page
                  const initialUrl = (jobTab.url() || '').toLowerCase();
                  if (!initialUrl.includes('naukri.com')) {
                    this.logger('info', 'Naukri', `Skipping "${jobMeta.title}" at ${jobMeta.company} - Opened external employer site (${jobTab.url()}). Naukri external applies are disabled.`);
                    try {
                      if (!jobTab.isClosed()) await jobTab.close();
                    } catch (e) {}
                    jobRecord.status = 'skipped';
                    jobRecord.skipReason = 'Opened external employer site (Naukri external applies disabled)';
                    if (onJobProcessed) onJobProcessed(jobRecord);
                    continue;
                  }

                  // Scan job details & recruiter contacts for recruiter emails
                  if (this.dataStore && this.dataStore.recruiterEmails) {
                    try {
                      const descText = await jobTab.evaluate(() => {
                        const d = document.querySelector('.styles_JDC__dang-inner-html__fq021, .dang-inner-html, .job-desc-container, [class*="recruiter"]');
                        return d ? d.innerText : (document.body ? document.body.innerText.slice(0, 10000) : '');
                      });
                      if (descText) {
                        const extracted = this.dataStore.recruiterEmails.extractEmailsFromText(descText, {
                          title: jobMeta.title,
                          company: jobMeta.company,
                          url: jobMeta.url,
                          platform: 'Naukri'
                        });
                        if (extracted.length > 0) {
                          this.logger('success', 'Naukri', `Found recruiter email (${extracted.map(e => e.email).join(', ')}) on Naukri for "${jobMeta.title}"! Saved to Recruiter Outreach.`);
                        }
                      }
                    } catch (e) {}
                  }

                  // Look for Apply button on Naukri detail page
                  const applyResult = await this.findNaukriApplyButton(jobTab);

                  if (applyResult && applyResult.button) {
                    if (applyResult.isAlreadyApplied) {
                      this.logger('info', 'Naukri', `"${jobMeta.title}" has already been applied.`);
                      jobRecord.status = 'already_applied';
                      if (onJobProcessed) onJobProcessed(jobRecord);
                      continue;
                    }

                    const isExternal = applyResult.isExternal;
                    if (isExternal) {
                      this.logger('info', 'Naukri', `Skipping "${jobMeta.title}" at ${jobMeta.company} - External company site apply link (Naukri external links are disabled; only 1-Click Fast Apply is allowed).`);
                      try {
                        if (!jobTab.isClosed()) await jobTab.close();
                      } catch (e) {}
                      jobRecord.status = 'skipped';
                      jobRecord.skipReason = 'External company site apply link (Naukri external links disabled)';
                      if (onJobProcessed) onJobProcessed(jobRecord);
                      continue;
                    }

                    this.logger('action', 'Naukri', `Submitting 1-Click Fast Apply for "${jobMeta.title}"...`);

                    const pagesBefore = await this.chrome.browser.pages();
                    await applyResult.button.evaluate(b => b.click());
                    await this.randomDelay(2200, 3500);

                    // Guard 2: Check if an external company careers tab or dedicated Naukri tab opened
                    const pagesAfter = await this.chrome.browser.pages();
                    const newTab = pagesAfter.find(p => !pagesBefore.includes(p));

                    if (newTab) {
                      const newUrl = (newTab.url() || '').toLowerCase();
                      if (newUrl.includes('naukri.com')) {
                        this.logger('info', 'Naukri', `Naukri apply opened dedicated page: ${newUrl}. Processing application on this tab...`);
                        jobTab = newTab;
                      } else {
                        try {
                          if (!newTab.isClosed()) await newTab.close();
                        } catch (e) {}
                        this.logger('info', 'Naukri', `Closed external tab: ${newUrl} (Naukri external apply links disabled).`);
                        jobRecord.status = 'skipped';
                        jobRecord.skipReason = 'External company site link (Naukri external applies disabled)';
                        if (onJobProcessed) onJobProcessed(jobRecord);
                        continue;
                      }
                    }

                    // Guard 3: Check if the current jobTab redirected to an external domain
                    const currentTabUrl = (jobTab.url() || '').toLowerCase();
                    if (!currentTabUrl.includes('naukri.com')) {
                      this.logger('info', 'Naukri', `Closed redirected external tab: ${jobTab.url()} (Naukri external apply links disabled).`);
                      try {
                        if (!jobTab.isClosed()) await jobTab.close();
                      } catch (e) {}
                      jobRecord.status = 'skipped';
                      jobRecord.skipReason = 'Redirected to external company site (Naukri external applies disabled)';
                      if (onJobProcessed) onJobProcessed(jobRecord);
                      continue;
                    }

                    // Check for real visible login modal
                    const isRealLoginPrompt = await jobTab.evaluate(() => {
                      const loginEl = document.querySelector('#login_Layer, .login-layer, form[name*="login"], .nI-gNb-login');
                      if (!loginEl) return false;
                      const isVisible = loginEl.offsetParent !== null && window.getComputedStyle(loginEl).display !== 'none' && window.getComputedStyle(loginEl).visibility !== 'hidden';
                      if (!isVisible) return false;
                      const hasPwd = !!loginEl.querySelector('input[type="password"]');
                      const txt = (loginEl.innerText || '').toLowerCase();
                      return hasPwd || (txt.includes('login') && (txt.includes('password') || txt.includes('sign in')));
                    });

                    const isTabLoggedIn = await jobTab.evaluate(() => {
                      const userIndicators = document.querySelectorAll('.nI-gNb-drawer, .view-profile-wrapper, .user-name, img[alt*="profile"], .nI-gNb-header__user, a[href*="my-profile"], a[href*="mynaukri"], .user-details');
                      return userIndicators.length > 0;
                    });

                    if (isRealLoginPrompt && !isLoggedIn && !isTabLoggedIn) {
                      this.logger('warning', 'Naukri', `Naukri requires login to complete application for "${jobMeta.title}".`);
                      jobRecord.status = 'skipped';
                      jobRecord.skipReason = 'Naukri account login required';
                    } else {
                      // Check if questionnaire chatbot or modal appeared
                      const applyOutcome = await this.handleNaukriChatbot(jobTab, jobMeta);
                      jobRecord.questionsAnswered = applyOutcome.questionsAnswered || [];

                      if (applyOutcome.success) {
                        jobRecord.status = 'applied';
                        totalProcessedCount++;
                        this.logger('success', 'Naukri', `Successfully applied to "${jobMeta.title}" at ${jobMeta.company}! (${jobRecord.questionsAnswered.length} screening questions answered)`);
                      } else {
                        jobRecord.status = 'skipped';
                        jobRecord.skipReason = applyOutcome.reason || 'Screening questions incomplete or application not accepted';
                        this.logger('warning', 'Naukri', `Naukri application not accepted for "${jobMeta.title}": ${jobRecord.skipReason}`);
                      }
                    }
                  } else {
                    // Guard 4: No 1-Click apply button found on Naukri detail page
                    this.logger('info', 'Naukri', `Skipping "${jobMeta.title}" - No 1-Click Fast Apply button found on Naukri (Naukri external applies are disabled).`);
                    try {
                      if (!jobTab.isClosed()) await jobTab.close();
                    } catch (e) {}
                    jobRecord.status = 'skipped';
                    jobRecord.skipReason = 'No 1-Click Fast Apply button (Naukri external applies disabled)';
                  }
                }
              }

              if (onJobProcessed) onJobProcessed(jobRecord);
              await this.randomDelay(1800, 3200);

            } catch (err) {
              this.logger('error', 'Naukri', `Error processing Naukri job: ${err.message}`);
            } finally {
              if (jobTab && !jobTab.isClosed() && jobTab !== page) {
                try {
                  await jobTab.close();
                } catch (closeErr) {}
              }
            }
          }
        }
      }

      return { success: true, totalProcessedCount };
    } catch (err) {
      this.logger('error', 'Naukri', `Naukri Bot encountered an error: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      if (page && !page.isClosed()) {
        try {
          await page.close();
        } catch (e) {}
      }
    }
  }

  // Find Apply button safely on Naukri detail page (only matches actual BUTTON or A elements)
  async findNaukriApplyButton(tab) {
    try {
      // 1. Prioritize explicit interactive buttons
      const directBtn = await tab.$('button#apply-button, button.apply-button, #apply-button, button[id*="apply"], button[class*="apply-button"], a[class*="apply-button"], button#company-site-button, button.company-site-button');
      if (directBtn) {
        const info = await directBtn.evaluate(el => {
          const text = (el.innerText || el.textContent || '').trim().toLowerCase();
          const id = (el.id || '').toLowerCase();
          const cls = (el.className || '').toLowerCase();
          const href = (el.getAttribute('href') || '').toLowerCase();
          const isExternal = text.includes('company site') || text.includes('external') || id.includes('company-site') || cls.includes('company-site') || (href.length > 0 && !href.includes('naukri.com') && !href.startsWith('#') && !href.startsWith('javascript'));
          const isAlreadyApplied = text.includes('already applied') || text.includes('applied');
          return { isExternal, isAlreadyApplied, text, tagName: el.tagName };
        });
        if (info.tagName === 'BUTTON' || info.tagName === 'A' || info.tagName === 'INPUT') {
          return { button: directBtn, ...info };
        }
      }

      // 2. Fallback text evaluation for visible interactive buttons
      const handle = await tab.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button, a.apply-button, .apply-button, a[class*="apply"], button[class*="apply"]'));
        for (const b of buttons) {
          if (b.tagName !== 'BUTTON' && b.tagName !== 'A' && b.tagName !== 'INPUT') continue;
          const t = (b.innerText || b.textContent || '').trim().toLowerCase();
          if (t.includes('apply') && b.offsetParent !== null) {
            return b;
          }
        }
        return null;
      });

      const el = handle.asElement();
      if (el) {
        const info = await el.evaluate(e => {
          const text = (e.innerText || e.textContent || '').trim().toLowerCase();
          const id = (e.id || '').toLowerCase();
          const cls = (e.className || '').toLowerCase();
          const href = (e.getAttribute('href') || '').toLowerCase();
          const isExternal = text.includes('company site') || text.includes('external') || id.includes('company-site') || cls.includes('company-site') || (href.length > 0 && !href.includes('naukri.com') && !href.startsWith('#') && !href.startsWith('javascript'));
          const isAlreadyApplied = text.includes('already applied') || text.includes('applied');
          return { isExternal, isAlreadyApplied, text, tagName: e.tagName };
        });
        return { button: el, ...info };
      }
    } catch (e) {
      // Return null on failure
    }
    return null;
  }

  // Handle dedicated full-page saveApply flow (e.g. https://www.naukri.com/myapply/saveApply)
  async handleNaukriSaveApplyPage(page, jobMeta = {}) {
    const questionsAnswered = [];
    try {
      const url = page.url() || '';
      this.logger('action', 'Naukri', `Evaluating Naukri full-page apply: ${url.slice(0, 85)}...`);

      // Check URL multiApplyResp parameter
      if (url.includes('multiApplyResp')) {
        const respMatch = url.match(/multiApplyResp=(?:%7B|\{)(.*?)(?:%7D|\})/i);
        if (respMatch) {
          const decoded = decodeURIComponent(respMatch[0]);
          if (decoded.includes(':200')) {
            this.logger('success', 'Naukri', 'Naukri full-page confirmation verified (HTTP 200 Success).');
            return { success: true, questionsAnswered };
          }
          if (decoded.includes(':406')) {
            this.logger('warning', 'Naukri', 'Naukri full-page returned 406 (Incomplete mandatory questions).');
          }
        }
      }

      // Check if page contains the incomplete error message
      const is406Error = await page.evaluate(() => {
        const txt = (document.body ? document.body.innerText : '').toLowerCase();
        return txt.includes('incomplete information') || txt.includes('please answer all mandatory questions');
      });

      if (is406Error) {
        // Check if there are questionnaire fields on this page
        const fields = await page.$$('.form-group, .field, [class*="question"], .question-wrap, .radio-wrap');
        if (fields.length === 0) {
          return {
            success: false,
            questionsAnswered,
            reason: 'Naukri application was not accepted due to incomplete information (HTTP 406)'
          };
        }
      }

      // Check for success banners or keywords on page
      const isSuccess = await page.evaluate(() => {
        const txt = (document.body ? document.body.innerText : '').toLowerCase();
        return txt.includes('application submitted') || txt.includes('successfully applied') || txt.includes('thank you for applying');
      });

      if (isSuccess) {
        return { success: true, questionsAnswered };
      }

      return {
        success: !is406Error,
        questionsAnswered,
        reason: is406Error ? 'Naukri application rejected (HTTP 406)' : undefined
      };
    } catch (err) {
      this.logger('warning', 'Naukri', `Error checking saveApply page: ${err.message}`);
      return { success: false, questionsAnswered, reason: err.message };
    }
  }

  // Answer Naukri questionnaire drawer (conversational chatbot OR standard form drawer)
  async handleNaukriChatbot(page, jobMeta = {}) {
    const questionsAnswered = [];
    try {
      // If already on saveApply full page, handle directly
      if ((page.url() || '').includes('myapply/saveApply')) {
        return await this.handleNaukriSaveApplyPage(page, jobMeta);
      }

      // 1. Wait for Naukri drawer or chatbot container to animate in (polling up to 6 seconds)
      // CRITICAL: Exclude .nI-gNb* to prevent matching the global header navbar drawer
      let drawer = null;
      const drawerSelectors = [
        '._chatBotContainer',
        '.chatbot_Drawer',
        '[id$="ChatbotContainer"]',
        '[id$="Drawer"]:not([class*="nI-gNb"])',
        '.chatbot_MessageContainer',
        '.chatbot_DrawerContentWrapper',
        '.styles_drawer-wrapper__j2b_u',
        '.layerWrap:not([class*="nI-gNb"])'
      ];

      for (let attempt = 0; attempt < 12; attempt++) {
        const elements = await page.$$(drawerSelectors.join(', '));
        for (const el of elements) {
          const isValidDrawer = await el.evaluate(node => {
            const cls = (node.className || '').toString();
            if (node.closest && node.closest('.nI-gNb-header, .nI-gNb-drawer')) return false;
            const style = typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(node) : {};
            const isVisible = (node.offsetParent !== null || style.display !== 'none') && style.visibility !== 'hidden';
            return isVisible && (node.offsetWidth || 300) > 100 && (node.offsetHeight || 300) > 100;
          });
          if (isValidDrawer) {
            drawer = el;
            break;
          }
        }
        if (drawer) break;
        await new Promise(r => setTimeout(r, 500));
      }

      // If no drawer detected, check if application succeeded directly (no questions required)
      if (!drawer) {
        // Check if page redirected to saveApply
        if ((page.url() || '').includes('myapply/saveApply')) {
          return await this.handleNaukriSaveApplyPage(page, jobMeta);
        }

        const directSuccess = await page.evaluate(() => {
          const bodyTxt = (document.body ? document.body.innerText : '').toLowerCase();
          const btn = document.querySelector('#apply-button, .apply-button, [class*="apply-button"]');
          const btnTxt = (btn ? btn.innerText : '').toLowerCase();
          return btnTxt.includes('applied') || bodyTxt.includes('application submitted') || bodyTxt.includes('successfully applied');
        });

        if (directSuccess) {
          this.logger('success', 'Naukri', 'No questionnaire required. Application submitted directly!');
          return { success: true, questionsAnswered };
        }

        this.logger('info', 'Naukri', 'No screening questionnaire drawer detected. Application submitted directly.');
        return { success: true, questionsAnswered };
      }

      this.logger('action', 'Naukri', '🤖 Naukri screening chatbot drawer detected! Processing questions with Candidate Profile + AI...');
      const qaContext = {
        platform: 'Naukri',
        jobTitle: jobMeta?.title || 'Unknown Title',
        company: jobMeta?.company || 'Naukri Job'
      };

      // Helper function to dispatch standard React/Vue synthetic events
      const setInputReactValue = async (inputHandle, val) => {
        try {
          await inputHandle.click({ clickCount: 3 });
          await page.keyboard.press('Backspace');
          await inputHandle.type(String(val), { delay: 20 });
          await inputHandle.evaluate((el, v) => {
            const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(el, v);
            else el.value = v;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          }, val);
        } catch (e) {
          await inputHandle.evaluate((el, v) => {
            el.value = v;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, val);
        }
      };

      // Conversational Q&A Loop
      let chatTurns = 15;
      let lastAnsweredQuestion = '';
      let repeatCount = 0;

      while (chatTurns > 0) {
        chatTurns--;
        await this.randomDelay(1200, 2000);

        // A. Check for completion or success keywords
        const isDone = await page.evaluate(() => {
          const bodyTxt = (document.body ? document.body.innerText : '').toLowerCase();
          const drawerTxt = Array.from(document.querySelectorAll('._chatBotContainer, .chatbot_Drawer, .botMsg, .botItem'))
            .map(el => el.innerText.toLowerCase())
            .join(' ');
          const combined = bodyTxt + ' ' + drawerTxt;
          return combined.includes('application submitted') ||
                 combined.includes('successfully applied') ||
                 combined.includes('thank you for applying') ||
                 combined.includes('your application has been sent');
        });

        if (isDone) {
          this.logger('success', 'Naukri', 'Chatbot confirmed application submitted successfully!');
          return { success: true, questionsAnswered };
        }

        // B. Check for chatbot error
        const hasError = await page.evaluate(() => {
          const drawerEl = document.querySelector('._chatBotContainer, .chatbot_Drawer');
          if (!drawerEl) return false;
          const txt = (drawerEl.innerText || '').toLowerCase();
          return txt.includes('something went wrong');
        });

        if (hasError) {
          this.logger('warning', 'Naukri', 'Naukri chatbot reported "Something went wrong".');
          return { success: false, questionsAnswered, reason: 'Chatbot reported "Something went wrong"' };
        }

        // C. Detect latest unanswered bot question inside chatbot container
        const questionText = await page.evaluate(() => {
          const botMsgs = Array.from(document.querySelectorAll('._chatBotContainer li.botItem .botMsg, ._chatBotContainer li.botItem, ._chatBotContainer .botMsg, .chatbot_Drawer li.botItem .botMsg, .chatbot_Drawer li.botItem, .chatbot_Drawer .botMsg, [class*="botMsg"], [class*="question-text"]'))
            .filter(b => !b.closest('.nI-gNb-header, .nI-gNb-drawer'))
            .map(el => (el.innerText || el.textContent || '').trim())
            .filter(t => t.length > 5 && !t.includes('naukriLogo'));
          return botMsgs.length > 0 ? botMsgs[botMsgs.length - 1] : '';
        });

        if (!questionText) {
          // If no question text is found, check if drawer closed or if Save button is ready
          const drawerStillVisible = await page.evaluate(() => {
            const d = document.querySelector('._chatBotContainer, .chatbot_Drawer');
            const style = d && typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(d) : {};
            return d && (d.offsetParent !== null || style.display !== 'none');
          });
          if (!drawerStillVisible) {
            break;
          }
          await this.randomDelay(1000, 1500);
          continue;
        }

        if (questionText === lastAnsweredQuestion) {
          repeatCount++;
          if (repeatCount >= 3) {
            this.logger('info', 'Naukri', 'Question already answered 3 times without advancing. Exiting chat loop.');
            break;
          }
          await this.randomDelay(1000, 1500);
        } else {
          repeatCount = 0;
        }
        lastAnsweredQuestion = questionText;

        // D. Check for Multiple-Choice / Radio / Chips Options INSIDE Chatbot Container
        const chatOptions = await page.evaluate(() => {
          const drawer = document.querySelector('._chatBotContainer, .chatbot_Drawer');
          if (!drawer) return [];

          const options = [];

          // 1. Radio buttons & labels (e.g. .singleselect-radiobutton, .ssrc__radio, label.ssrc__label)
          const radioInputs = Array.from(drawer.querySelectorAll('input[type="radio"], [role="radio"]'))
            .filter(r => !r.closest('.nI-gNb-header, .nI-gNb-drawer, .chatbot_Nav'));

          for (const r of radioInputs) {
            const label = (r.id ? drawer.querySelector(`label[for="${r.id}"]`) : null) || r.closest('label') || r.parentElement?.querySelector('label');
            const txt = (label ? (label.innerText || label.textContent) : '') || r.value || (r.parentElement ? r.parentElement.innerText : '');
            const clean = String(txt || '').trim();
            if (clean && clean.length > 0 && clean.length < 60) {
              options.push(clean);
            }
          }

          // 2. Interactive chips, choices, and option containers
          const chips = Array.from(drawer.querySelectorAll('[class*="chip"]:not(.botLogo), [class*="choice"], [class*="option"], .bot-chip, ul.list li.chipMsg, .singleselect-radiobutton-container label, .ssrc__radio-btn-container label, .singleselect-radiobutton label'))
            .filter(c => !c.closest('.nI-gNb-header, .nI-gNb-drawer, .chatbot_Nav') && (c.offsetParent !== null || c.offsetHeight > 0))
            .map(c => (c.innerText || c.textContent || '').trim())
            .filter(t => t.length > 0 && t.length < 60 && !/^(save|submit|send|close|cancel)$/i.test(t));

          options.push(...chips);
          return [...new Set(options)];
        });

        if (chatOptions && chatOptions.length > 0) {
          this.logger('action', 'Naukri', `Chatbot question: "${questionText.slice(0, 45)}..." with options: [${chatOptions.join(', ')}]`);
          const answer = await this.ai.answerScreeningQuestionAI(questionText, chatOptions, 'radio', qaContext);

          const clickResult = await page.evaluate((targetAns) => {
            const drawer = document.querySelector('._chatBotContainer, .chatbot_Drawer');
            if (!drawer) return { clicked: false };

            const tLower = String(targetAns || '').toLowerCase().trim();

            // 1. First check radio buttons and associated labels
            const radios = Array.from(drawer.querySelectorAll('input[type="radio"], [role="radio"]'))
              .filter(r => !r.closest('.nI-gNb-header, .nI-gNb-drawer, .chatbot_Nav'));

            for (const r of radios) {
              const label = (r.id ? drawer.querySelector(`label[for="${r.id}"]`) : null) || r.closest('label') || r.parentElement?.querySelector('label');
              const labelText = ((label ? (label.innerText || label.textContent) : '') || r.value || (r.parentElement ? r.parentElement.innerText : '')).toLowerCase().trim();

              const isMatch = labelText === tLower ||
                              labelText.includes(tLower) ||
                              tLower.includes(labelText) ||
                              (/yes/i.test(tLower) && /yes/i.test(labelText)) ||
                              (/no/i.test(tLower) && /no/i.test(labelText));

              if (isMatch) {
                if (label && typeof label.click === 'function') {
                  label.click();
                } else {
                  r.click();
                }
                r.checked = true;
                r.dispatchEvent(new Event('change', { bubbles: true }));
                r.dispatchEvent(new Event('click', { bubbles: true }));
                return { clicked: true, isRadio: true, text: labelText };
              }
            }

            // 2. Next check chips, buttons, and clickable labels
            const chips = Array.from(drawer.querySelectorAll('[class*="chip"]:not(.botLogo), [class*="choice"], [class*="option"], .bot-chip, ul.list li.chipMsg, .singleselect-radiobutton-container label, .ssrc__radio-btn-container label, label'))
              .filter(c => !c.closest('.nI-gNb-header, .nI-gNb-drawer, .chatbot_Nav') && (c.offsetParent !== null || c.offsetHeight > 0));

            let match = chips.find(b => {
              const text = (b.innerText || b.textContent || '').trim().toLowerCase();
              return text === tLower || text.includes(tLower) || tLower.includes(text);
            });
            if (!match && /yes/i.test(tLower)) match = chips.find(b => /yes/i.test((b.innerText || b.textContent || '')));
            if (!match && /no/i.test(tLower)) match = chips.find(b => /no/i.test((b.innerText || b.textContent || '')));

            if (match) {
              match.click();
              return { clicked: true, isRadio: false, text: match.innerText };
            }

            if (chips.length > 0) {
              chips[0].click();
              return { clicked: true, isRadio: false, text: chips[0].innerText, fallback: true };
            }

            return { clicked: false };
          }, answer.answer);

          if (clickResult.clicked) {
            await this.randomDelay(600, 1000);

            // After selecting option, click the Save / Submit button in the drawer footer if present
            const saveResult = await page.evaluate(() => {
              const drawer = document.querySelector('._chatBotContainer, .chatbot_Drawer');
              if (!drawer) return { saveClicked: false };

              const candidates = Array.from(drawer.querySelectorAll('button, .save-btn, [class*="save"], .ssrc__save, .footerInputBoxWrapper button, .footerWrapper button, [id*="save"], [id*="sendMsg"], .sendMsg'))
                .filter(b => !b.closest('.nI-gNb-header, .nI-gNb-drawer, .chatbot_Nav') && (b.offsetParent !== null || b.offsetHeight > 0));

              const saveBtn = candidates.find(b => {
                const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
                const cls = (b.className || '').toLowerCase();
                const id = (b.id || '').toLowerCase();
                return txt === 'save' || txt.includes('save') || txt === 'submit' || cls.includes('save') || id.includes('save');
              });

              if (saveBtn) {
                if (typeof saveBtn.click === 'function') saveBtn.click();
                return { saveClicked: true, text: (saveBtn.innerText || 'Save').trim() };
              }
              return { saveClicked: false };
            });

            questionsAnswered.push({ question: questionText, answer: answer.answer, inputType: 'radio', source: answer.source });
            this.logger('action', 'Naukri', `Option chosen: "${answer.answer}" for "${questionText.slice(0, 35)}..." (${answer.source})${saveResult.saveClicked ? ' [Clicked Save]' : ''}`);
            await this.randomDelay(1800, 2800);
            continue;
          }
        }

        // E. Check for Text / Numeric Input INSIDE Chatbot Container
        // Modern Naukri uses: div.textArea[contenteditable="true"]
        const inputDiv = await page.$('._chatBotContainer div.textArea[contenteditable="true"], ._chatBotContainer [contenteditable="true"], ._chatBotContainer input.chat-input, ._chatBotContainer input[type="text"], ._chatBotContainer input[type="number"], ._chatBotContainer textarea, ._chatBotContainer [id*="userInput"], .chatbot_Drawer div.textArea[contenteditable="true"], .chatbot_Drawer [contenteditable="true"], .chatbot_Drawer input[type="text"], .chatbot_Drawer input[type="number"], .chatbot_Drawer textarea');

        if (inputDiv) {
          const isContentEditable = await inputDiv.evaluate(el => el.contentEditable === 'true' || el.getAttribute('contenteditable') === 'true');
          const isNumericQuestion = /how many years|years of experience|notice period|days to join|current ctc|expected ctc|annual salary|in lakhs|in days|ctc|experience/i.test(questionText);
          const inputType = isNumericQuestion ? 'number' : 'text';

          const answer = await this.ai.answerScreeningQuestionAI(questionText, [], inputType, qaContext);
          this.logger('action', 'Naukri', `Chat answering [${inputType}]: "${answer.answer}" for "${questionText.slice(0, 45)}..." (${answer.source})`);

          if (isContentEditable) {
            // Type into contenteditable div
            await inputDiv.evaluate(el => {
              if (el && typeof el.focus === 'function') el.focus();
              if (el) el.innerText = '';
            });
            await page.keyboard.type(String(answer.answer), { delay: 30 });
            await inputDiv.evaluate((el, val) => {
              if (el && typeof el.dispatchEvent === 'function' && typeof Event !== 'undefined') {
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }, answer.answer);
          } else {
            await setInputReactValue(inputDiv, answer.answer);
          }

          await this.randomDelay(300, 600);

          // Click the Save / Send button inside the drawer
          const sendClicked = await page.evaluate(() => {
            const drawer = document.querySelector('._chatBotContainer, .chatbot_Drawer') || document;
            const sendBtn = drawer.querySelector('[id*="sendMsg"], .sendMsg, .send:not(.disabled), button[type="submit"], button.save-btn, [class*="save"]');
            if (sendBtn) {
              sendBtn.click();
              const inner = sendBtn.querySelector('.sendMsg');
              if (inner) inner.click();
              return true;
            }
            const allBtns = Array.from(drawer.querySelectorAll('button'));
            const saveBtn = allBtns.find(b => /^(save|submit|send)$/i.test((b.innerText || '').trim()));
            if (saveBtn) {
              saveBtn.click();
              return true;
            }
            return false;
          });

          if (!sendClicked) {
            // Fallback: Press Enter key
            await page.keyboard.press('Enter');
          }

          questionsAnswered.push({ question: questionText, answer: answer.answer, inputType, source: answer.source });
          await this.randomDelay(2000, 3000);
          continue;
        }

        // F. Check for Resume Upload field
        const fileInput = await page.$('._chatBotContainer input[type="file"], .chatbot_Drawer input[type="file"], input.chatbot_Uploader');
        if (fileInput) {
          try {
            const resumePath = this.resolveResumePath ? this.resolveResumePath() : path.join(__dirname, '..', 'config', 'resume.pdf');
            if (fs.existsSync(resumePath)) {
              await fileInput.uploadFile(resumePath);
              questionsAnswered.push({ question: 'Resume Upload', answer: 'resume.pdf', inputType: 'file', source: 'candidate.resume' });
              this.logger('action', 'Naukri', 'Uploaded candidate resume PDF to chatbot.');
              await this.randomDelay(1800, 2800);
              continue;
            }
          } catch (uploadErr) {
            this.logger('warning', 'Naukri', `Resume upload failed: ${uploadErr.message}`);
          }
        }

        break;
      }

      // 4. Final Verification: Check application status after drawer interactions
      await this.randomDelay(2000, 3200);

      if ((page.url() || '').includes('myapply/saveApply')) {
        return await this.handleNaukriSaveApplyPage(page, jobMeta);
      }

      const finalOutcome = await page.evaluate(() => {
        const bodyTxt = (document.body ? document.body.innerText : '').toLowerCase();
        const btn = document.querySelector('#apply-button, .apply-button, [class*="apply-button"]');
        const btnTxt = (btn ? btn.innerText : '').toLowerCase();
        const isSuccess = btnTxt.includes('applied') ||
                          bodyTxt.includes('application submitted') ||
                          bodyTxt.includes('successfully applied') ||
                          bodyTxt.includes('thank you for applying');
        const is406 = bodyTxt.includes('incomplete information') || bodyTxt.includes('please answer all mandatory questions');
        return { isSuccess, is406 };
      });

      if (finalOutcome.is406) {
        return {
          success: false,
          questionsAnswered,
          reason: 'Application rejected by Naukri with HTTP 406 (incomplete mandatory questions)'
        };
      }

      return {
        success: true,
        questionsAnswered
      };

    } catch (chatErr) {
      this.logger('warning', 'Naukri', `Naukri questionnaire error: ${chatErr.message}`);
      return { success: false, questionsAnswered, reason: chatErr.message };
    }
  }

  // External career portal filling is strictly disabled on Naukri
  async autofillExternalCareerPortal(page, jobMeta = {}) {
    this.logger('info', 'Naukri', 'External career portal autofill is strictly disabled for Naukri.');
    return [];
  }
}

module.exports = NaukriBot;
