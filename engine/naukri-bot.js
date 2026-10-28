const CareerSiteBot = require('./career-site-bot');

class NaukriBot {
  constructor(chromeManager, aiAgent, settings, logger) {
    this.chrome = chromeManager;
    this.ai = aiAgent;
    this.settings = settings;
    this.logger = logger;
    this.shouldStop = false;
    this.careerSiteBot = new CareerSiteBot(chromeManager, aiAgent, settings, logger);
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

  // Get freshness query parameter for Naukri (1 = 24h, 2 = 48h, 7 = 7 days)
  getDateFilterParam(datePosted) {
    switch (datePosted) {
      case 'past_24h':
        return 'freshness=1';
      case 'past_48h':
        return 'freshness=2';
      case 'past_week':
        return 'freshness=7';
      case 'all':
        return '';
      default:
        return 'freshness=1';
    }
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

    try {
      const scenarios = this.getScenarios();
      const locationRaw = (this.settings.search?.locations || 'Hyderabad').split(',')[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const locSlug = locationRaw === 'hyderabad' ? 'hyderabad-secunderabad' : locationRaw;
      const dateParam = this.getDateFilterParam(this.settings.search?.datePosted);
      const freshnessQuery = dateParam ? `?${dateParam}` : '';
      const maxApps = this.settings.automation?.maxApplicationsPerSession || 25;
      const maxPages = this.settings.automation?.maxPagesPerScenario || 2;
      let totalProcessedCount = 0;

      this.logger('info', 'Naukri', `Naukri bot initialized with ${scenarios.length} scenarios in ${locSlug}. Freshness: ${this.settings.search?.datePosted || 'past_24h'}.`);

      for (let sIdx = 0; sIdx < scenarios.length; sIdx++) {
        if (this.shouldStop || totalProcessedCount >= maxApps) break;

        const currentScenario = scenarios[sIdx];
        const scenarioSlug = currentScenario.toLowerCase().replace(/[^a-z0-9]+/g, '-');

        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
          if (this.shouldStop || totalProcessedCount >= maxApps) break;

          const pageSlug = pageNum > 1 ? `-${pageNum}` : '';
          const searchUrl = `https://www.naukri.com/${scenarioSlug}-jobs-in-${locSlug}${pageSlug}${freshnessQuery}`;

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

                return {
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

              const jobRecord = {
                id: `nk-${Date.now()}-${sIdx}-${i}`,
                platform: 'Naukri',
                scenario: currentScenario,
                title: jobMeta.title,
                company: jobMeta.company,
                location: jobMeta.location,
                url: jobMeta.url,
                status: 'evaluating',
                timestamp: new Date().toISOString()
              };

              if (jobMeta.alreadyApplied) {
                this.logger('info', 'Naukri', `Skipping "${jobMeta.title}" - already applied.`);
                jobRecord.status = 'already_applied';
                if (onJobProcessed) onJobProcessed(jobRecord);
                continue;
              }

              // Evaluate with AI Agent
              const descCombined = `${jobMeta.title} Skills: ${jobMeta.tags.join(', ')} Experience: ${jobMeta.experience}`;
              const evaluation = this.ai.evaluateJobMatch(jobMeta.title, descCombined, jobMeta.company);
              jobRecord.matchScore = evaluation.score;
              jobRecord.evaluation = evaluation;

              if (!evaluation.isRecommended) {
                this.logger('warning', 'Naukri', `Skipping "${jobMeta.title}" (${evaluation.score}% < threshold ${this.settings.automation?.minMatchScore}%).`);
                jobRecord.status = 'skipped';
                jobRecord.skipReason = `ATS score ${evaluation.score}% < threshold`;
                if (onJobProcessed) onJobProcessed(jobRecord);
                continue;
              }

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
                  // Keep running in background with CDP focus emulation without stealing user's active window/tab

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
                    this.logger('action', 'Naukri', `Submitting ${isExternal ? 'Company Site Application' : '1-Click Fast Apply'} for "${jobMeta.title}"...`);

                    const pagesBefore = await this.chrome.browser.pages();
                    await applyResult.button.evaluate(b => b.click());
                    await this.randomDelay(2200, 3500);

                    // Check if an external company careers tab opened
                    const pagesAfter = await this.chrome.browser.pages();
                    const newExternalTab = pagesAfter.find(p => !pagesBefore.includes(p));

                    if (newExternalTab) {
                      const extUrl = newExternalTab.url();
                      this.logger('success', 'Naukri', `Company careers portal opened: ${extUrl}`);
                      jobRecord.externalUrl = extUrl;

                      // Full autonomous career site application (handles resume upload & screening Q&A)
                      const careerRes = await this.careerSiteBot.applyToCareerPage(newExternalTab, jobMeta);
                      jobRecord.status = careerRes.status || 'MANUAL_ACTION_REQUIRED';
                      jobRecord.directApplicationUrl = extUrl;
                      jobRecord.applicationMethod = careerRes.applicationMethod || 'external_portal';
                      jobRecord.questionsAnswered = careerRes.questionsAnswered || [];
                      totalProcessedCount++;

                      // Only close tab if submission is explicitly confirmed
                      const isConfirmed = careerRes.status === 'APPLIED_CONFIRMED' || careerRes.status === 'applied';
                      if (isConfirmed && this.settings.automation?.closeCareerTabAfterSubmit !== false) {
                        try {
                          await this.randomDelay(2500, 3500);
                          if (!newExternalTab.isClosed()) await newExternalTab.close();
                        } catch (e) {}
                      } else {
                        this.logger('info', 'Naukri', `Tab retained for your inspection and manual completion: ${extUrl}`);
                      }
                    } else {
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
                        jobRecord.status = 'login_required';
                      } else {
                        // Check if questionnaire chatbot or modal appeared
                        const answeredQuestions = await this.handleNaukriChatbot(jobTab, jobMeta);
                        jobRecord.questionsAnswered = answeredQuestions || [];

                        jobRecord.status = 'applied';
                        totalProcessedCount++;
                        this.logger('success', 'Naukri', `Successfully applied to "${jobMeta.title}" at ${jobMeta.company}! (${jobRecord.questionsAnswered.length} screening questions answered)`);
                      }
                    }
                  } else {
                    this.logger('info', 'Naukri', `No 1-Click apply button found for "${jobMeta.title}".`);
                    jobRecord.status = 'already_applied_or_closed';
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
          const isExternal = text.includes('company site') || text.includes('external') || id.includes('company-site') || cls.includes('company-site');
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
          const isExternal = text.includes('company site') || text.includes('external') || id.includes('company-site') || cls.includes('company-site');
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

  // Answer Naukri questionnaire drawer (conversational chatbot OR standard form drawer)
  async handleNaukriChatbot(page, jobMeta = {}) {
    const questionsAnswered = [];
    try {
      // 1. Wait for Naukri drawer or chatbot to animate in (up to 4.5 seconds)
      let drawer = null;
      const drawerSelectors = [
        '.drawer-wrapper',
        '.apply-drawer',
        '.chatbot_Drawer',
        '.chat-container',
        '.apply-message',
        '.layerWrap',
        '[class*="chatbot"]',
        '[class*="drawer"]',
        '[class*="Drawer"]',
        '[class*="applyDrawer"]',
        '[role="dialog"]',
        '.styles_drawer-wrapper__j2b_u'
      ];

      for (let attempt = 0; attempt < 9; attempt++) {
        drawer = await page.$(drawerSelectors.join(', '));
        if (drawer) {
          const isVisible = await drawer.evaluate(el => el.offsetParent !== null && window.getComputedStyle(el).display !== 'none');
          if (isVisible) break;
        }
        await new Promise(r => setTimeout(r, 500));
      }

      if (!drawer) {
        this.logger('info', 'Naukri', 'No screening questionnaire drawer detected. Application submitted directly.');
        return questionsAnswered;
      }

      this.logger('action', 'Naukri', '🤖 Naukri screening drawer detected! Processing questions with Candidate Profile + Gemini AI...');
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

      // A. Check for standard form fields in drawer (Form Mode)
      const formFields = await page.$$([
        '.drawer-wrapper .form-group',
        '.drawer-wrapper .field',
        '.drawer-wrapper .form-row',
        '.drawer-wrapper [class*="group"]',
        '.apply-drawer .form-group',
        '.apply-drawer .field',
        '[role="dialog"] .form-group',
        '[role="dialog"] .field',
        '[class*="drawer"] [class*="field"]',
        '[class*="drawer"] [class*="question"]'
      ].join(', '));

      if (formFields.length > 0) {
        this.logger('action', 'Naukri', `Found ${formFields.length} screening form fields in drawer. Filling...`);
        for (const field of formFields) {
          try {
            const labelText = await field.evaluate(el => {
              const lbl = el.querySelector('label, .label, .field-label, span[class*="label"], .title, [class*="title"], p');
              return lbl ? lbl.innerText.trim() : '';
            });
            if (!labelText) continue;

            // 1. Radio / chips in field
            const radioChips = await field.$$('.radio-btn, input[type="radio"], .chip-btn, .option-chip, [class*="radio"], [class*="chip"]');
            if (radioChips.length > 0) {
              const opts = await field.evaluate(el => {
                return Array.from(el.querySelectorAll('label, .chip-btn, .option-chip, span, [class*="chip"]'))
                  .map(s => s.innerText.trim())
                  .filter(Boolean);
              });
              const ans = await this.ai.answerScreeningQuestionAI(labelText, opts, 'radio', qaContext);
              const clicked = await field.evaluate((el, targetAns) => {
                const clickables = Array.from(el.querySelectorAll('label, .chip-btn, .option-chip, input[type="radio"], [class*="chip"]'));
                const tLower = targetAns.toLowerCase();
                let match = clickables.find(c => {
                  const txt = (c.innerText || c.value || '').trim().toLowerCase();
                  return txt === tLower || txt.includes(tLower) || tLower.includes(txt);
                });
                if (!match && /yes/i.test(tLower)) match = clickables.find(c => /yes/i.test(c.innerText || c.value));
                if (!match && /no/i.test(tLower)) match = clickables.find(c => /no/i.test(c.innerText || c.value));
                if (match) {
                  match.click();
                  return true;
                }
                return false;
              }, ans.answer);

              if (clicked) {
                questionsAnswered.push({ question: labelText, answer: ans.answer, inputType: 'radio', source: ans.source });
                this.logger('action', 'Naukri', `Option chosen: "${ans.answer}" for "${labelText.slice(0, 35)}..." (${ans.source})`);
              }
              continue;
            }

            // 2. Select dropdown (Native or custom Naukri dropdown)
            const select = await field.$('select');
            if (select) {
              const opts = await select.evaluate(s => Array.from(s.options).map(o => o.text.trim()).filter(Boolean));
              const ans = await this.ai.answerScreeningQuestionAI(labelText, opts, 'select', qaContext);
              await select.evaluate((s, targetAns) => {
                const opt = Array.from(s.options).find(o => o.text.toLowerCase().includes(targetAns.toLowerCase()) || targetAns.toLowerCase().includes(o.text.toLowerCase()));
                if (opt) s.value = opt.value;
                s.dispatchEvent(new Event('change', { bubbles: true }));
              }, ans.answer);
              questionsAnswered.push({ question: labelText, answer: ans.answer, inputType: 'select', source: ans.source });
              continue;
            }

            // Custom dropdown container
            const customDropdown = await field.$('.custom-select, .typeahead, .dropdown-container, [class*="custom-select"], [class*="dropdown"]');
            if (customDropdown) {
              await customDropdown.click();
              await this.randomDelay(400, 800);
              const dropOptions = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll('.dropdown-item, .select-options li, .option-item, ul[class*="dropdown"] li'));
                return items.map(i => i.innerText.trim()).filter(Boolean);
              });
              if (dropOptions.length > 0) {
                const ans = await this.ai.answerScreeningQuestionAI(labelText, dropOptions, 'select', qaContext);
                await page.evaluate((targetAns) => {
                  const items = Array.from(document.querySelectorAll('.dropdown-item, .select-options li, .option-item, ul[class*="dropdown"] li'));
                  const tLower = targetAns.toLowerCase();
                  const match = items.find(i => i.innerText.trim().toLowerCase().includes(tLower) || tLower.includes(i.innerText.trim().toLowerCase()));
                  if (match) match.click();
                }, ans.answer);
                questionsAnswered.push({ question: labelText, answer: ans.answer, inputType: 'select', source: ans.source });
                continue;
              }
            }

            // 3. Text / numeric input
            const input = await field.$('input[type="text"], input[type="number"], textarea, input:not([type="hidden"])');
            if (input) {
              const isNum = await input.evaluate(el => el.type === 'number' || el.inputMode === 'numeric');
              const inputType = isNum || /years|experience|notice|days|ctc|salary|lakhs/i.test(labelText) ? 'number' : 'text';
              const ans = await this.ai.answerScreeningQuestionAI(labelText, [], inputType, qaContext);
              await setInputReactValue(input, ans.answer);
              questionsAnswered.push({ question: labelText, answer: ans.answer, inputType, source: ans.source });
              this.logger('action', 'Naukri', `Filled [${inputType}]: "${ans.answer}" for "${labelText.slice(0, 35)}..." (${ans.source})`);
            }
          } catch (e) {}
        }
      }

      // B. Also handle conversational chat messages (Naukri Fast Forward Chatbot)
      let chatTurns = 12;
      let lastAnsweredQuestion = '';

      while (chatTurns > 0) {
        chatTurns--;
        await this.randomDelay(1400, 2200);

        // Detect latest unanswered bot question
        const questionText = await page.evaluate(() => {
          const msgs = document.querySelectorAll('.bot-msg, .botText, .question-text, .msg-text, li[class*="bot"], div[class*="bot-message"], [class*="bot_msg"], [class*="chat-msg"]');
          if (msgs.length === 0) return '';
          return (msgs[msgs.length - 1].innerText || msgs[msgs.length - 1].textContent || '').trim();
        });

        // Check for submission completion keywords
        const isDone = await page.evaluate(() => {
          const text = (document.body ? document.body.innerText : '').toLowerCase();
          return text.includes('application submitted') || text.includes('successfully applied') || text.includes('thank you for applying');
        });
        if (isDone) {
          this.logger('success', 'Naukri', 'Chatbot confirmed application submitted successfully!');
          break;
        }

        if (!questionText || questionText === lastAnsweredQuestion) {
          // Check if drawer is already closing or submit button is ready
          break;
        }

        lastAnsweredQuestion = questionText;

        // Multiple-choice options / chips
        const optionButtons = await page.$$('.option-chip, .chat-option, .chip-btn, .choice-btn, .bot-chip, .chips-container button, .chips-container span, [class*="chip"]');
        if (optionButtons.length > 0) {
          const chatOptions = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('.option-chip, .chat-option, .chip-btn, .choice-btn, .bot-chip, .chips-container button, .chips-container span, [class*="chip"]'));
            return btns.map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean);
          });

          const answer = await this.ai.answerScreeningQuestionAI(questionText, chatOptions, 'radio', qaContext);
          await page.evaluate((targetAns) => {
            const btns = Array.from(document.querySelectorAll('.option-chip, .chat-option, .chip-btn, .choice-btn, .bot-chip, .chips-container button, .chips-container span, [class*="chip"]'));
            const tLower = targetAns.toLowerCase();
            let match = btns.find(b => {
              const text = (b.innerText || '').trim().toLowerCase();
              return text === tLower || text.includes(tLower) || tLower.includes(text);
            });
            if (!match && /yes/i.test(tLower)) match = btns.find(b => /yes/i.test(b.innerText));
            if (!match && /no/i.test(tLower)) match = btns.find(b => /no/i.test(b.innerText));
            if (match) match.click();
            else if (btns[0]) btns[0].click();
          }, answer.answer);

          questionsAnswered.push({ question: questionText, answer: answer.answer, inputType: 'radio', source: answer.source });
          this.logger('action', 'Naukri', `Chat chip selected: "${answer.answer}" for "${questionText.slice(0, 35)}..." (${answer.source})`);
          await this.randomDelay(1500, 2500);
          continue;
        }

        // Chat text / number input
        const chatInput = await page.$('.chat-input, input.chat-input, input[type="text"], input[type="number"], textarea');
        if (chatInput) {
          const isInputNumber = await chatInput.evaluate(el => el.type === 'number' || el.inputMode === 'numeric');
          const isNumericQuestion = isInputNumber || /how many years|years of experience|notice period|days to join|current ctc|expected ctc|annual salary|in lakhs|in days/i.test(questionText);
          const inputType = isNumericQuestion ? 'number' : 'text';
          const answer = await this.ai.answerScreeningQuestionAI(questionText, [], inputType, qaContext);

          await setInputReactValue(chatInput, answer.answer);
          await page.keyboard.press('Enter');

          const sendBtn = await page.$('.send-btn, button[type="submit"], .send-icon, button[class*="send"], [class*="send-btn"]');
          if (sendBtn) await sendBtn.click().catch(() => {});

          questionsAnswered.push({ question: questionText, answer: answer.answer, inputType, source: answer.source });
          this.logger('action', 'Naukri', `Chat typed [${inputType}]: "${answer.answer}" for "${questionText.slice(0, 35)}..." (${answer.source})`);
          await this.randomDelay(1800, 2800);
          continue;
        }

        break;
      }

      // C. Click any final Save / Submit / Continue button in the drawer if present
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll([
          '.drawer-wrapper button',
          '.apply-drawer button',
          'button[type="submit"]',
          '.save-btn',
          '.submit-btn',
          '.apply-button',
          'button[class*="submit"]',
          'button[class*="save"]',
          'button[class*="apply"]'
        ].join(', ')));

        const subBtn = btns.find(b => {
          const txt = (b.innerText || '').toLowerCase().trim();
          return (txt.includes('submit') || txt.includes('save') || txt.includes('apply') || txt.includes('continue') || txt.includes('done')) &&
                 !txt.includes('cancel') && b.offsetParent !== null;
        });
        if (subBtn) subBtn.click();
      });
      await this.randomDelay(1500, 2500);

    } catch (chatErr) {
      this.logger('warning', 'Naukri', `Naukri questionnaire error: ${chatErr.message}`);
    }

    return questionsAnswered;
  }

  // Autofill external career portal applications (Workday, Greenhouse, Lever, Ashby, custom portals)
  async autofillExternalCareerPortal(page, jobMeta = {}) {
    try {
      this.logger('action', 'Naukri', `Scanning external career portal for application form fields...`);
      await this.randomDelay(1500, 2500);

      const personal = this.profile.personal || {};
      const career = this.profile.career || {};

      const filledFields = await page.evaluate((p, c) => {
        const filled = [];

        function setInputVal(input, val) {
          if (!input || !val) return false;
          input.focus();
          input.value = val;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
          return true;
        }

        const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea'));
        for (const input of inputs) {
          if (input.value && input.value.trim().length > 0) continue;
          const name = (input.name || '').toLowerCase();
          const id = (input.id || '').toLowerCase();
          const placeholder = (input.placeholder || '').toLowerCase();
          const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
          const key = `${name} ${id} ${placeholder} ${ariaLabel}`;

          // First Name
          if (/\b(first\s*name|fname|given\s*name)\b/.test(key) && !key.includes('last')) {
            if (setInputVal(input, p.firstName || 'Sai Krishna')) filled.push('First Name');
          }
          // Last Name
          else if (/\b(last\s*name|lname|family\s*name|surname)\b/.test(key)) {
            if (setInputVal(input, p.lastName || 'G')) filled.push('Last Name');
          }
          // Full Name
          else if (/\b(full\s*name|your\s*name|candidate\s*name)\b/.test(key) || (key.includes('name') && !key.includes('user') && !key.includes('comp') && !key.includes('first') && !key.includes('last'))) {
            if (setInputVal(input, p.fullName || 'Sai Krishna G')) filled.push('Full Name');
          }
          // Email
          else if (input.type === 'email' || /\b(email|e-mail)\b/.test(key)) {
            if (setInputVal(input, p.email || 'gsaikrishna150@gmail.com')) filled.push('Email');
          }
          // Phone
          else if (input.type === 'tel' || /\b(phone|mobile|contact\s*no|contact\s*number)\b/.test(key)) {
            if (setInputVal(input, p.phoneDigits || '8688373517')) filled.push('Phone');
          }
          // City / Location
          else if (/\b(city|current\s*city|current\s*location)\b/.test(key)) {
            if (setInputVal(input, p.city || 'Hyderabad')) filled.push('City');
          }
          // LinkedIn
          else if (/\b(linkedin)\b/.test(key)) {
            if (setInputVal(input, p.linkedInUrl || 'https://linkedin.com')) filled.push('LinkedIn');
          }
          // GitHub
          else if (/\b(github)\b/.test(key)) {
            if (setInputVal(input, p.githubUrl || 'https://github.com')) filled.push('GitHub');
          }
          // Portfolio / Website
          else if (/\b(portfolio|website)\b/.test(key)) {
            if (setInputVal(input, p.portfolioUrl || 'https://indianmetroguide.in')) filled.push('Portfolio');
          }
          // Total Experience
          else if (/\b(total\s*experience|years\s*of\s*experience|exp)\b/.test(key)) {
            if (setInputVal(input, String(c.totalYearsExperience || 3))) filled.push('Experience');
          }
          // Notice Period
          else if (/\b(notice\s*period|days\s*to\s*join)\b/.test(key)) {
            if (setInputVal(input, String(c.noticePeriodDays || 30))) filled.push('Notice Period');
          }
          // Current CTC
          else if (/\b(current\s*ctc|current\s*salary)\b/.test(key)) {
            if (setInputVal(input, '4.10')) filled.push('Current CTC');
          }
          // Expected CTC
          else if (/\b(expected\s*ctc|expected\s*salary)\b/.test(key)) {
            if (setInputVal(input, '10')) filled.push('Expected CTC');
          }
        }

        return filled;
      }, personal, career);

      // Handle resume file upload if input[type="file"] exists
      const resumePath = personal.resumePath || 'D:\\Downloads\\Sai_Krishna_G_Resume.pdf';
      const fileInput = await page.$('input[type="file"]');
      if (fileInput && resumePath) {
        try {
          const fs = require('fs');
          if (fs.existsSync(resumePath)) {
            await fileInput.uploadFile(resumePath);
            filledFields.push('Resume File Upload');
          }
        } catch (fErr) {}
      }

      if (filledFields.length > 0) {
        this.logger('success', 'Naukri', `External portal autofilled fields: ${filledFields.join(', ')}`);
      }
    } catch (e) {
      this.logger('info', 'Naukri', `External portal scan complete.`);
    }
  }
}

module.exports = NaukriBot;
