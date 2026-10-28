class FounditBot {
  constructor(chromeManager, aiAgent, settings, logger) {
    this.chrome = chromeManager;
    this.ai = aiAgent;
    this.settings = settings;
    this.logger = logger;
    this.shouldStop = false;
  }

  stop() {
    this.shouldStop = true;
  }

  async randomDelay(min = 1500, max = 3000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(r => setTimeout(r, delay));
  }

  // Freshness query parameter for Foundit (1 day = 24h, 2 days = 48h, 7 days = 1 week)
  getDateFilterParam(datePosted) {
    switch (datePosted) {
      case 'past_24h':
        return 'postedWithin=1';
      case 'past_48h':
        return 'postedWithin=2';
      case 'past_week':
        return 'postedWithin=7';
      case 'all':
        return '';
      default:
        return 'postedWithin=1';
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
    this.logger('info', 'Foundit', 'Initializing Foundit (Monster India) automation session in Chrome...');

    const page = await this.chrome.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
      const scenarios = this.getScenarios();
      const locationRaw = (this.settings.search?.locations || 'Hyderabad').split(',')[0].trim();
      const dateParam = this.getDateFilterParam(this.settings.search?.datePosted);
      const maxApps = this.settings.automation?.maxApplicationsPerSession || 25;
      let totalProcessedCount = 0;

      this.logger('info', 'Foundit', `Foundit bot loaded with ${scenarios.length} search scenarios across ${locationRaw}. Filter: ${this.settings.search?.datePosted || 'past_24h'}.`);

      for (let sIdx = 0; sIdx < scenarios.length; sIdx++) {
        if (this.shouldStop || totalProcessedCount >= maxApps) break;

        const currentScenario = scenarios[sIdx];
        const dateFilter = dateParam ? `&${dateParam}` : '';
        const searchUrl = `https://www.foundit.in/srp/results?query=${encodeURIComponent(currentScenario)}&locations=${encodeURIComponent(locationRaw)}${dateFilter}`;

        this.logger('action', 'Foundit', `[Scenario ${sIdx + 1}/${scenarios.length}] Searching: "${currentScenario}" in ${locationRaw} (Fresh jobs: ${this.settings.search?.datePosted || '24h'})...`);
        
        try {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await this.randomDelay(3000, 4500);

          // Accept cookie banner if present
          await page.evaluate(() => {
            const btn = document.querySelector('#acceptAll, .accept-btn');
            if (btn) btn.click();
          });

          // Check if user is logged into Foundit
          const cookies = await page.cookies();
          const hasAuthCookie = cookies.some(c => /auth|token|user|session|profile/i.test(c.name) && c.value?.length > 10);
          const isLoggedInDOM = await page.evaluate(() => {
            const userProfile = document.querySelector('.userProfile, .user-name, [class*="profile-header"], .logged-in, #userProfile');
            const signInBtn = document.querySelector('.signinBtn, .login-btn, a[href*="/login"]');
            return !!userProfile || !signInBtn;
          });

          const isLoggedIn = hasAuthCookie || isLoggedInDOM;
          if (!isLoggedIn) {
            this.logger('warning', 'Foundit', 'Foundit session detected as Guest. Please sign into Foundit in your Chrome browser for automated 1-Click Apply.');
          } else if (sIdx === 0) {
            this.logger('success', 'Foundit', 'Active Foundit candidate session verified.');
          }

          // Human-like smooth scroll down the list to trigger lazy loaded cards
          await page.evaluate(async () => {
            for (let s = 0; s < 3; s++) {
              window.scrollBy({ top: 500, behavior: 'smooth' });
              await new Promise(r => setTimeout(r, 400));
            }
          });
          await this.randomDelay(1500, 2500);

          // Find job cards using robust selectors
          const jobCards = await page.$$(
            '.cardContainer, .srpResultCard, [data-job-id], .card-body, .job-tuple, .card'
          );
          this.logger('info', 'Foundit', `Found ${jobCards.length} matching jobs for scenario "${currentScenario}".`);

          if (jobCards.length === 0) {
            this.logger('info', 'Foundit', `No fresh jobs found for "${currentScenario}". Advancing to next scenario.`);
            continue;
          }

          for (let i = 0; i < jobCards.length; i++) {
            if (this.shouldStop || totalProcessedCount >= maxApps) break;

            try {
              const card = jobCards[i];
              
              // Click card via DOM evaluate for background compatibility
              await card.evaluate(c => {
                c.scrollIntoView({ block: 'center', inline: 'nearest' });
                c.click();
              });
              await this.randomDelay(1500, 2500);

              // Extract job details from card and details section
              const jobDetails = await page.evaluate((cardEl) => {
                const cardTitle = cardEl?.querySelector('#jobCardTitle, .jobTitle, .title');
                const rightH1 = document.querySelector('h1, .jdContent h1, [class*="jobTitle"]');
                const title = (cardTitle?.innerText || rightH1?.innerText || '').trim() || 'Software Developer';

                const cardComp = cardEl?.querySelector('.companyName p, .companyName, .company');
                const rightComp = document.querySelector('.companyName p, .companyName, .company-name');
                const company = (cardComp?.innerText || rightComp?.innerText || '').trim() || 'Company';

                const cardLoc = cardEl?.querySelector('.details.location, .location');
                const location = (cardLoc?.innerText || '').trim() || 'India';

                const cardExp = cardEl?.querySelector('.experienceSalary .details, .experience');
                const experience = (cardExp?.innerText || '').trim();

                const desc = document.querySelector('.jdContent, .job-description, .jobDescription, #job-details, body');
                const description = (desc?.innerText || '').slice(0, 1500).trim();

                return { title, company, location, experience, description };
              }, card);

              this.logger('info', 'Foundit', `[${currentScenario}] Evaluating: "${jobDetails.title}" at ${jobDetails.company}...`);

              const fullDescription = `${jobDetails.title} ${jobDetails.description}`;
              const evaluation = this.ai.evaluateJobMatch(jobDetails.title, fullDescription, jobDetails.company);

              const jobRecord = {
                id: `foundit-${Date.now()}-${i}`,
                platform: 'Foundit',
                scenario: currentScenario,
                title: jobDetails.title,
                company: jobDetails.company,
                location: jobDetails.location,
                url: page.url(),
                matchScore: evaluation.score,
                evaluation,
                status: 'evaluating',
                timestamp: new Date().toISOString()
              };

              if (!evaluation.isRecommended) {
                this.logger('warning', 'Foundit', `Skipping "${jobDetails.title}" (${evaluation.score}% < threshold ${this.settings.automation?.minMatchScore}%).`);
                jobRecord.status = 'skipped';
                jobRecord.skipReason = `ATS Score ${evaluation.score}% < threshold`;
                if (onJobProcessed) onJobProcessed(jobRecord);
                continue;
              }

              if (this.settings.automation?.simulationMode) {
                this.logger('simulation', 'Foundit', `[Simulation Mode] Simulating Quick Apply for "${jobDetails.title}"`);
                await this.randomDelay(1500, 2500);
                jobRecord.status = 'applied (simulated)';
                totalProcessedCount++;
                if (onJobProcessed) onJobProcessed(jobRecord);
                continue;
              }

              // Check for Apply Now / Quick Apply button on Foundit
              const applyBtn = await page.$(
                '#applyNowBtn, button[id*="apply"], button.applyBtn, .btn-apply, button[class*="apply"]:not([disabled])'
              );

              if (applyBtn) {
                this.logger('action', 'Foundit', `Clicking Apply Now for "${jobDetails.title}"...`);
                await applyBtn.evaluate(b => b.click());
                await this.randomDelay(2200, 3200);

                // Check if redirected to login page
                const currentUrl = page.url();
                const isLoginRedirect = currentUrl.includes('/login') || currentUrl.includes('/rio/login');

                if (isLoginRedirect) {
                  this.logger('warning', 'Foundit', `Foundit requires candidate login for "${jobDetails.title}". Please sign into Foundit in Chrome.`);
                  jobRecord.status = 'login_required';
                  if (onJobProcessed) onJobProcessed(jobRecord);
                  await page.goBack().catch(() => {});
                  await this.randomDelay(2000, 3000);
                  continue;
                }

                // Handle any screening modal / questionnaire if present
                await this.handleFounditQuestionnaire(page, jobDetails);

                jobRecord.status = 'applied';
                totalProcessedCount++;
                this.logger('success', 'Foundit', `Successfully applied to "${jobDetails.title}" at ${jobDetails.company}!`);
              } else {
                this.logger('info', 'Foundit', `No 1-Click apply found for "${jobDetails.title}".`);
                jobRecord.status = 'already_applied_or_external';
              }

              if (onJobProcessed) onJobProcessed(jobRecord);
              await this.randomDelay(2000, 3500);

            } catch (cardErr) {
              this.logger('error', 'Foundit', `Error processing Foundit card: ${cardErr.message}`);
            }
          }

        } catch (scenarioErr) {
          this.logger('error', 'Foundit', `Error in Foundit scenario "${currentScenario}": ${scenarioErr.message}`);
        }
      }

      return { success: true, totalProcessedCount };
    } catch (err) {
      this.logger('error', 'Foundit', `Foundit Bot encountered an error: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      if (page && !page.isClosed()) {
        try {
          await page.close();
        } catch (e) {}
      }
    }
  }

  // Handle any screening modal or questionnaire on Foundit
  async handleFounditQuestionnaire(page, jobDetails = {}) {
    try {
      const modal = await page.$('.modal-body, .modal, .questionnaire-popup, [role="dialog"], [class*="modal"]');
      if (!modal) return;

      const qaContext = {
        platform: 'Foundit',
        jobTitle: jobDetails?.title || 'Unknown Title',
        company: jobDetails?.company || 'Foundit Job'
      };

      // 1. Handle Select Dropdowns
      const selects = await modal.$$('select');
      for (const sel of selects) {
        const qLabel = await sel.evaluate(el => {
          const l = el.closest('.form-group, .field, div')?.querySelector('label');
          return l ? l.innerText.trim() : (el.name || '');
        });
        if (qLabel) {
          const options = await sel.evaluate(s => Array.from(s.options).map(o => (o.text || '').trim()).filter(t => t && !/select/i.test(t)));
          const res = await this.ai.answerScreeningQuestionAI(qLabel, options, 'select', qaContext);
          await sel.evaluate((s, ans) => {
            const opts = Array.from(s.options);
            const m = opts.find(o => o.text.toLowerCase().includes(ans.toLowerCase()) || ans.toLowerCase().includes(o.text.toLowerCase()));
            if (m) {
              s.value = m.value;
              s.dispatchEvent(new Event('change', { bubbles: true }));
              s.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }, res.answer);
          await this.randomDelay(300, 600);
        }
      }

      // 2. Handle Radio Buttons
      const radios = await modal.$$('input[type="radio"]');
      const handledRadioNames = new Set();
      for (const r of radios) {
        const rName = await r.evaluate(el => el.name);
        if (!rName || handledRadioNames.has(rName)) continue;
        handledRadioNames.add(rName);

        const groupInfo = await r.evaluate(el => {
          const group = Array.from(document.querySelectorAll(`input[type="radio"][name="${el.name}"]`));
          const l = el.closest('.form-group, fieldset, div')?.querySelector('label, legend');
          const qText = l ? l.innerText.trim() : el.name;
          const options = group.map(radio => {
            const rLabel = radio.id ? document.querySelector(`label[for="${radio.id}"]`) : null;
            return (rLabel?.innerText || radio.value || '').trim();
          }).filter(Boolean);
          return { qText, options };
        });

        if (groupInfo && groupInfo.qText) {
          const res = await this.ai.answerScreeningQuestionAI(groupInfo.qText, groupInfo.options, 'radio', qaContext);
          await modal.evaluate((name, ans) => {
            const group = Array.from(document.querySelectorAll(`input[type="radio"][name="${name}"]`));
            const target = group.find(radio => {
              const rLabel = radio.id ? document.querySelector(`label[for="${radio.id}"]`) : null;
              const txt = (rLabel?.innerText || radio.value || '').trim().toLowerCase();
              return txt.includes(ans.toLowerCase()) || ans.toLowerCase().includes(txt);
            }) || group[0];
            if (target) {
              target.click();
              target.checked = true;
              target.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, rName, res.answer);
        }
      }

      // 3. Handle Checkboxes
      const checkboxes = await modal.$$('input[type="checkbox"]');
      for (const cb of checkboxes) {
        const isRequired = await cb.evaluate(el => el.required || el.getAttribute('aria-required') === 'true' || !!el.closest('.required'));
        if (isRequired) {
          await cb.evaluate(el => {
            if (!el.checked) {
              el.click();
              el.checked = true;
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        }
      }

      // 4. Handle Text and Number inputs
      const textInputs = await modal.$$('input[type="text"], input[type="number"], textarea');
      for (const input of textInputs) {
        const label = await input.evaluate(el => {
          const l = el.closest('.form-group, .field, div')?.querySelector('label');
          return l ? l.innerText.trim() : (el.placeholder || el.name || '');
        });

        if (label) {
          const isNum = await input.evaluate(el => el.type === 'number' || el.inputMode === 'numeric');
          const isNumQ = isNum || /how many years|experience|notice period|salary|ctc/i.test(label);
          const inputType = isNumQ ? 'number' : 'text';

          const res = await this.ai.answerScreeningQuestionAI(label, [], inputType, qaContext);
          let finalVal = String(res.answer || '0');
          if (isNumQ) {
            const numMatch = finalVal.match(/\d+(?:\.\d+)?/);
            finalVal = numMatch ? numMatch[0] : '0';
          }

          await input.evaluate((el, v) => {
            el.focus();
            el.value = v;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          }, finalVal);
          await this.randomDelay(300, 600);
        }
      }

      // 5. Scan for any unfilled fields in modal
      const unfilled = await modal.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input:required, select:required, textarea:required'));
        return inputs.filter(i => !i.value).map(i => {
          const l = i.closest('.form-group, .field, div')?.querySelector('label');
          return {
            label: l ? l.innerText.trim() : (i.placeholder || i.name || 'Unknown Question'),
            type: i.type || 'text'
          };
        });
      });
      for (const item of unfilled) {
        this.ai.recordUnfilledQuestion({
          question: item.label,
          label: item.label,
          inputType: item.type,
          platform: 'Foundit',
          jobTitle: jobDetails?.title || 'Unknown Title',
          company: jobDetails?.company || 'Foundit Job',
          reason: 'Required field left blank in Foundit modal'
        });
      }

      // 6. Click submit / continue inside modal
      const submitted = await modal.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
        const sub = buttons.find(b => {
          const txt = (b.innerText || b.value || '').trim().toLowerCase();
          return /submit|apply|continue|save/i.test(txt);
        });
        if (sub && !sub.disabled) {
          sub.click();
          return true;
        }
        return false;
      });
      if (submitted) {
        await this.randomDelay(1500, 2500);
      }
    } catch (e) {
      // Best effort
    }
  }
}

module.exports = FounditBot;
