const path = require('path');
const fs = require('fs');
const MatchingEngine = require('./matching-engine');
const { StateMachine, ApplicationStates } = require('./state-machine');

class InstahyreBot {
  constructor(chromeManager, aiAgent, settings, logger, dataStore = null) {
    this.chrome = chromeManager;
    this.ai = aiAgent;
    this.settings = settings;
    this.logger = logger;
    this.dataStore = dataStore;
    this.shouldStop = false;
    this.platform = 'Instahyre';
  }

  stop() {
    this.shouldStop = true;
  }

  async randomDelay(min = 1500, max = 3000) {
    if (this.settings?.disableDelays || this.settings?.automation?.disableDelaysForTesting) return;
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(r => setTimeout(r, delay));
  }

  getScenarios() {
    if (this.settings.search?.scenarios && Array.isArray(this.settings.search.scenarios) && this.settings.search.scenarios.length > 0) {
      return this.settings.search.scenarios;
    }
    const raw = this.settings.search?.keywords || 'Full Stack Developer, Java Developer, Angular Developer';
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }

  getScenarioUrl(scenario) {
    const s = String(scenario || '').toLowerCase();
    if (s.includes('angular')) {
      return 'https://www.instahyre.com/angular-developer-jobs/';
    }
    if (s.includes('full stack') || s.includes('fullstack')) {
      return 'https://www.instahyre.com/full-stack-developer-jobs/';
    }
    if (s.includes('backend')) {
      return 'https://www.instahyre.com/backend-developer-jobs/';
    }
    if (s.includes('java')) {
      return 'https://www.instahyre.com/java-developer-jobs/';
    }
    if (s.includes('software') || s.includes('engineer')) {
      return 'https://www.instahyre.com/software-engineer-jobs/';
    }
    return 'https://www.instahyre.com/search-jobs/';
  }

  async checkCandidateSession(page) {
    try {
      const cookies = await page.cookies();
      const hasAuthCookie = cookies.some(c => /sessionid|ih_token|token|user_id|csrftoken/i.test(c.name) && c.value?.length > 8);

      const domSession = await page.evaluate(() => {
        const profileEl = document.querySelector(
          '#nav-user-profile, .user-dropdown, a[href*="/candidate/profile"], a[href*="/logout"], .nav-profile, [ng-controller="candidateProfileCtrl"], [href*="/candidate/"]'
        );
        const loginBtn = document.querySelector(
          '#nav-user-login, a[href*="/login/"], #nav-user-signup, a[href*="/candidates/register/"]'
        );
        const userNameEl = document.querySelector('.user-name, .profile-name, .nav-username');
        const bodyText = document.body.innerText || '';
        const hasCandidateMenu = bodyText.includes('OPPORTUNITIES') && (bodyText.includes('SIGN OUT') || bodyText.includes('PROFILE'));

        return {
          hasProfileDOM: !!profileEl || hasCandidateMenu,
          hasLoginBtn: !!loginBtn,
          userName: userNameEl ? userNameEl.textContent.trim() : null
        };
      });

      const isLoggedIn = (hasAuthCookie && domSession.hasProfileDOM) || domSession.hasProfileDOM;
      return {
        isLoggedIn,
        candidateName: domSession.userName
      };
    } catch (err) {
      return { isLoggedIn: false, error: err.message };
    }
  }

  async extractJobCards(page) {
    return await page.$$(
      '.opp-list-container .employer-block, .employer-block, [ng-repeat*="opp in opportunities"], .cursor-pointer .employer-row'
    );
  }

  async extractCardData(page, cardEl) {
    return await page.evaluate((el) => {
      // 1. Company and Title
      let company = '';
      let title = '';
      const companyRoleHeader = el.querySelector('.company-name, .employer-job-name, h2');
      if (companyRoleHeader) {
        const fullText = companyRoleHeader.textContent.trim();
        if (fullText.includes(' - ')) {
          const parts = fullText.split(' - ');
          company = parts[0].trim();
          title = parts.slice(1).join(' - ').trim();
        } else {
          company = fullText;
          title = fullText;
        }
      }

      const compEl = el.querySelector('.employer-name, [title*="company"], .company-title');
      if (compEl && !company) company = compEl.textContent.trim();

      const titleEl = el.querySelector('.job-title, .candidate-title, [title*="Software"], [title*="Developer"]');
      if (titleEl && (!title || title === company)) title = titleEl.textContent.trim();

      // 2. Locations
      const locationEls = el.querySelectorAll('.chip-location, .employer-chips-location, [class*="location"]');
      const locations = Array.from(locationEls).map(l => l.textContent.trim()).filter(Boolean);
      const location = locations.join(', ') || 'India';

      // 3. Skills / Keywords
      const skillEls = el.querySelectorAll('.job-skills .tags li, .tags li, .chip-skill, .keyword-chip');
      const skills = Array.from(skillEls)
        .map(s => s.textContent.trim())
        .filter(s => s && !s.startsWith('+') && isNaN(Number(s)));

      // 4. Tagline & Employer Note
      const taglineEl = el.querySelector('.employer-tagline, .info');
      const tagline = taglineEl ? taglineEl.textContent.trim() : '';

      const noteEl = el.querySelector('.employer-notes, .instahyre-note');
      const note = noteEl ? noteEl.textContent.trim() : '';

      // 5. URL & ID
      const linkEl = el.querySelector('a#employer-profile-opportunity, a.text-link, a[ng-href], a[href*="/job-"]');
      let publicUrl = linkEl ? (linkEl.getAttribute('href') || linkEl.getAttribute('ng-href') || '') : '';
      
      let jobId = '';
      if (publicUrl) {
        const idMatch = publicUrl.match(/job-(\d+)/i) || publicUrl.match(/\/(\d+)\/?$/);
        if (idMatch) jobId = `instahyre-${idMatch[1]}`;
      }

      // Check job-skills-{id} attribute if publicUrl didn't have ID
      if (!jobId) {
        const skillsUl = el.querySelector('[id*="job-skills-"]');
        if (skillsUl && skillsUl.id) {
          const m = skillsUl.id.match(/job-skills-(\d+)/);
          if (m) jobId = `instahyre-${m[1]}`;
        }
      }

      if (!jobId) {
        const compClean = (company || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');
        const titleClean = (title || 'job').toLowerCase().replace(/[^a-z0-9]/g, '');
        jobId = `instahyre-${compClean}-${titleClean}`;
      }

      // 6. Already Applied / Declined status
      const statusBox = el.querySelector('.application-status-box, .status-label, [class*="status-box"]');
      const statusText = statusBox ? statusBox.textContent.toLowerCase().trim() : '';
      const isApplied = statusText.includes('applied');
      const isDeclined = statusText.includes('declined') || statusText.includes('not interested');

      return {
        company: company || 'Tech Company',
        title: title || 'Software Engineer',
        location,
        skills,
        description: [tagline, note, skills.join(', ')].filter(Boolean).join(' | '),
        publicUrl: publicUrl || window.location.href,
        jobId,
        isApplied,
        isDeclined,
        rawText: el.innerText || ''
      };
    }, cardEl);
  }

  async applyToCard(page, cardEl, jobMeta) {
    try {
      // Step 1: Open the opportunity apply modal by clicking "View job »" or card anchor
      const openResult = await page.evaluate((el) => {
        const viewJobBtn = el.querySelector('button.btn-interested, .opp-row-btn-wrapper button, a#employer-profile-opportunity, a.text-link');
        if (viewJobBtn) {
          viewJobBtn.click();
          return { clicked: true, text: viewJobBtn.textContent.trim() };
        }
        return { clicked: false };
      }, cardEl);

      if (!openResult.clicked) {
        return { success: false, reason: 'Could not find "View job »" button or card link on Instahyre opportunity card.' };
      }

      // Step 2: Wait for .candidate-apply-modal to render
      await this.randomDelay(1500, 2500);

      const modalApplyResult = await page.evaluate(async (candidatePitch) => {
        // Find open apply modal
        const modal = document.querySelector('.candidate-apply-modal, [class*="candidate-apply-modal"]');
        if (!modal) {
          // Check fallback modals
          const anyModal = document.querySelector('.application-modal-block, .app-modal, #employer-profile');
          if (!anyModal) return { success: false, reason: 'Apply modal did not appear' };
        }

        const modalContainer = modal || document;

        // Check if external company apply
        const externalBtn = modalContainer.querySelector(
          '.apply-cancel-bar button, button[ng-click*="trackExternalApplication"], a[href*="external_url"]'
        );
        if (externalBtn && !modalContainer.querySelector('.apply button, [ng-click*="submitChoice(opp, true)"] button')) {
          return {
            isExternal: true,
            reason: 'Requires application on external company website'
          };
        }

        // Look for native Instahyre 1-Click Apply button
        const applyBtn = modalContainer.querySelector(
          '.apply button, [ng-click*="submitChoice(opp, true)"] button, div.apply, button.btn-primary.new-btn'
        );

        if (!applyBtn) {
          return { success: false, reason: 'Could not find Apply button inside modal' };
        }

        // Click the Apply button
        applyBtn.click();
        return { success: true, text: applyBtn.textContent.trim() };
      }, jobMeta.candidatePitch || '');

      if (modalApplyResult.isExternal) {
        // Close modal and return external note
        await page.evaluate(() => {
          const closeBtn = document.querySelector('.candidate-apply-modal .application-modal-close, .back-button-modal-close');
          if (closeBtn) closeBtn.click();
        });
        return { success: false, reason: modalApplyResult.reason, isExternal: true };
      }

      if (!modalApplyResult.success) {
        // Close modal and return error
        await page.evaluate(() => {
          const closeBtn = document.querySelector('.candidate-apply-modal .application-modal-close, .back-button-modal-close');
          if (closeBtn) closeBtn.click();
        });
        return { success: false, reason: modalApplyResult.reason };
      }

      await this.randomDelay(1500, 2500);

      // Step 3: Handle secondary popup dialogs (Active status check modal, Bulk apply modal)
      await page.evaluate(() => {
        // 1. Active Check Modal: "Are you looking for a job actively?" -> Click Save
        const activeCheck = document.querySelector('.active-check-modal');
        if (activeCheck && window.getComputedStyle(activeCheck).display !== 'none') {
          const saveBtn = activeCheck.querySelector('button.btn-filled, button[ng-click*="changeStatus"]');
          if (saveBtn) saveBtn.click();
        }

        // 2. Bulk apply modal: "Want to apply to other similar jobs?" -> Click Cancel/Dismiss
        const applyAll = document.querySelector('.apply-all-modal');
        if (applyAll && window.getComputedStyle(applyAll).display !== 'none') {
          const cancelBtn = applyAll.querySelector('button[ng-click*="applyBulkCancel"], .btn-outline');
          if (cancelBtn) cancelBtn.click();
        }

        // 3. Recruiter pitch note if present
        const noteInput = document.querySelector('textarea[name="note"], [name="pitch"], textarea.form-control');
        if (noteInput && !noteInput.value) {
          noteInput.value = 'Interested in this role. I bring 3 years of hands-on experience in Java, Spring Boot, and Angular.';
          noteInput.dispatchEvent(new Event('input', { bubbles: true }));
          noteInput.dispatchEvent(new Event('change', { bubbles: true }));
          const submitPitch = document.querySelector('.btn-filled[type="submit"], button.btn-success');
          if (submitPitch) submitPitch.click();
        }
      });

      await this.randomDelay(1200, 2000);

      // Step 4: Close the apply modal to return to opportunity list
      await page.evaluate(() => {
        const closeBtn = document.querySelector('.candidate-apply-modal .application-modal-close, .back-button-modal-close, .application-modal-backdrop');
        if (closeBtn) closeBtn.click();
      });

      await this.randomDelay(800, 1500);

      // Step 5: Verification
      return {
        success: true,
        appliedConfirmed: true,
        message: 'Successfully submitted 1-Click Application on Instahyre'
      };
    } catch (err) {
      // Attempt to close any lingering modal
      try {
        await page.evaluate(() => {
          const closeBtn = document.querySelector('.candidate-apply-modal .application-modal-close, .back-button-modal-close');
          if (closeBtn) closeBtn.click();
        });
      } catch (e) {}
      return { success: false, reason: err.message };
    }
  }

  async run(onJobProcessed) {
    this.shouldStop = false;
    this.logger('info', 'Instahyre', 'Initializing Instahyre curated tech automation session in Chrome...');

    const page = await this.chrome.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
      const scenarios = this.getScenarios();
      const maxApps = this.settings.automation?.maxApplicationsPerSession || 25;
      const minScore = this.settings.automation?.minMatchScore || 65;
      const reviewBeforeSubmit = !!this.settings.automation?.reviewBeforeSubmit;
      let totalProcessedCount = 0;

      // 1. Navigate to candidate opportunities hub
      const candidateOppUrl = 'https://www.instahyre.com/candidate/opportunities/?matching=true';
      this.logger('action', 'Instahyre', `Navigating to candidate opportunities portal: ${candidateOppUrl}...`);
      await page.goto(candidateOppUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await this.randomDelay(3000, 4500);

      // 2. Session verification
      const session = await this.checkCandidateSession(page);
      if (!session.isLoggedIn) {
        this.logger(
          'warning',
          'Instahyre',
          'Instahyre session detected as Guest. Please sign in to Instahyre in your Chrome browser for automatic 1-Click Apply.'
        );
      } else {
        const candidateName = session.candidateName ? ` (${session.candidateName})` : '';
        this.logger('success', 'Instahyre', `Active Instahyre candidate session verified${candidateName}!`);
      }

      // Check processed deduplication keys
      const processedKeys = this.dataStore ? this.dataStore.getProcessedKeys() : new Set();

      // Helper function to process an opportunities page
      const processCurrentOpportunitiesPage = async (sourceTag = 'Curated Feed') => {
        // Human-like smooth scroll down the list to trigger Angular lazy loading
        await page.evaluate(async () => {
          for (let s = 0; s < 3; s++) {
            window.scrollBy({ top: 400, behavior: 'smooth' });
            await new Promise(r => setTimeout(r, 350));
          }
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        await this.randomDelay(1500, 2500);

        const cardHandles = await this.extractJobCards(page);
        this.logger('info', 'Instahyre', `Discovered ${cardHandles.length} opportunity cards in [${sourceTag}].`);

        for (let i = 0; i < cardHandles.length; i++) {
          if (this.shouldStop || totalProcessedCount >= maxApps) break;

          const card = cardHandles[i];
          const rawData = await this.extractCardData(page, card);

          const comboKey = `${rawData.title.toLowerCase().trim()}|${rawData.company.toLowerCase().trim()}`;
          const isDup = processedKeys.has(comboKey) || (rawData.jobId && processedKeys.has(rawData.jobId));

          if (rawData.isApplied || isDup) {
            this.logger('info', 'Instahyre', `[Job ${i + 1}/${cardHandles.length}] Already applied to "${rawData.title}" at ${rawData.company}. Skipping.`);
            if (!isDup && this.dataStore) {
              const record = {
                id: rawData.jobId,
                platform: 'Instahyre',
                title: rawData.title,
                company: rawData.company,
                location: rawData.location,
                url: rawData.publicUrl || 'https://www.instahyre.com/candidate/opportunities/',
                status: ApplicationStates.ALREADY_APPLIED,
                appliedDate: new Date().toISOString()
              };
              if (onJobProcessed) onJobProcessed(record);
            }
            continue;
          }

          if (rawData.isDeclined) {
            continue;
          }

          this.logger('action', 'Instahyre', `[Job ${i + 1}/${cardHandles.length}] Evaluating: "${rawData.title}" at ${rawData.company} (${rawData.location})...`);

          // Match Evaluation via Multi-Dimensional Matching Engine
          const profile = this.ai?.profile || {};
          const evaluation = MatchingEngine.evaluate({
            title: rawData.title,
            description: rawData.description,
            company: rawData.company,
            location: rawData.location,
            profile,
            minMatchScore: minScore
          });

          this.logger(
            'info',
            'Instahyre',
            `ATS Match: ${evaluation.score}% (Tech: ${evaluation.technicalScore}%, Seniority: ${evaluation.seniorityScore}%) - ${evaluation.reasoning}`
          );

          // Discovered Recruiter Emails
          if (this.dataStore && this.dataStore.recruiterEmails && rawData.description) {
            const extracted = this.dataStore.recruiterEmails.extractFromText(
              rawData.description,
              rawData.company,
              rawData.title,
              'Instahyre'
            );
            if (extracted.length > 0) {
              this.logger('success', 'Instahyre', `Found recruiter email in listing: ${extracted.map(e => e.email).join(', ')}`);
            }
          }

          if (evaluation.score < minScore) {
            this.logger('warning', 'Instahyre', `Match score ${evaluation.score}% below threshold (${minScore}%). Skipping application.`);
            const skipRecord = {
              id: rawData.jobId,
              platform: 'Instahyre',
              title: rawData.title,
              company: rawData.company,
              location: rawData.location,
              url: rawData.publicUrl || 'https://www.instahyre.com/candidate/opportunities/',
              matchScore: evaluation.score,
              status: ApplicationStates.SKIPPED_LOW_MATCH,
              evaluation
            };
            if (onJobProcessed) onJobProcessed(skipRecord);
            continue;
          }

          // Check Semi-Auto Review Mode
          if (reviewBeforeSubmit) {
            this.logger('warning', 'Instahyre', `[Semi-Auto] Job "${rawData.title}" at ${rawData.company} held for candidate review.`);
            const reviewRecord = {
              id: rawData.jobId,
              platform: 'Instahyre',
              title: rawData.title,
              company: rawData.company,
              location: rawData.location,
              url: rawData.publicUrl || 'https://www.instahyre.com/candidate/opportunities/',
              matchScore: evaluation.score,
              status: ApplicationStates.MANUAL_ACTION_REQUIRED,
              actionRequired: true,
              evaluation
            };
            if (onJobProcessed) onJobProcessed(reviewRecord);
            totalProcessedCount++;
            continue;
          }

          // Proceed to 1-Click Apply
          this.logger('action', 'Instahyre', `Applying to "${rawData.title}" at ${rawData.company}...`);
          const applyResult = await this.applyToCard(page, card, {
            company: rawData.company,
            title: rawData.title,
            candidatePitch: profile.summary || ''
          });

          if (applyResult.success) {
            this.logger('success', 'Instahyre', `Successfully applied to "${rawData.title}" at ${rawData.company}! (1-Click Instahyre Match)`);
            totalProcessedCount++;
            processedKeys.add(comboKey);
            if (rawData.jobId) processedKeys.add(rawData.jobId);

            const successRecord = {
              id: rawData.jobId,
              platform: 'Instahyre',
              title: rawData.title,
              company: rawData.company,
              location: rawData.location,
              url: rawData.publicUrl || 'https://www.instahyre.com/candidate/opportunities/',
              matchScore: evaluation.score,
              status: ApplicationStates.APPLIED_CONFIRMED,
              appliedDate: new Date().toISOString(),
              evaluation,
              notes: '1-Click Apply via Instahyre Curated Tech Flow'
            };

            if (onJobProcessed) onJobProcessed(successRecord);
          } else if (applyResult.isExternal) {
            this.logger('info', 'Instahyre', `Job "${rawData.title}" at ${rawData.company} requires external company apply.`);
            if (this.settings.automation?.shortlistNonEasyApplyJobs !== false) {
              const mqRecord = {
                id: rawData.jobId,
                platform: 'Instahyre',
                title: rawData.title,
                company: rawData.company,
                location: rawData.location,
                url: rawData.publicUrl || 'https://www.instahyre.com/candidate/opportunities/',
                matchScore: evaluation.score,
                status: ApplicationStates.MANUAL_ACTION_REQUIRED,
                actionRequired: true,
                evaluation
              };
              if (onJobProcessed) onJobProcessed(mqRecord);
            }
          } else {
            this.logger('error', 'Instahyre', `Failed applying to "${rawData.title}" at ${rawData.company}: ${applyResult.reason}`);
            const failRecord = {
              id: rawData.jobId,
              platform: 'Instahyre',
              title: rawData.title,
              company: rawData.company,
              location: rawData.location,
              url: rawData.publicUrl || 'https://www.instahyre.com/candidate/opportunities/',
              matchScore: evaluation.score,
              status: ApplicationStates.FAILED_RETRYABLE,
              evaluation,
              error: applyResult.reason
            };
            if (onJobProcessed) onJobProcessed(failRecord);
          }

          await this.randomDelay(2500, 4000);
        }
      };

      // 3. Process candidate opportunities feed (all recommended roles)
      await processCurrentOpportunitiesPage('Candidate Opportunities Feed');

      // 4. Also search specific scenarios if applications remain under session limit
      for (let sIdx = 0; sIdx < scenarios.length; sIdx++) {
        if (this.shouldStop || totalProcessedCount >= maxApps) break;

        const currentScenario = scenarios[sIdx];
        const scenarioUrl = this.getScenarioUrl(currentScenario);
        this.logger('action', 'Instahyre', `[Scenario ${sIdx + 1}/${scenarios.length}] Navigating to: ${scenarioUrl} ("${currentScenario}")...`);

        try {
          await page.goto(scenarioUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await this.randomDelay(3000, 4500);
          await processCurrentOpportunitiesPage(`Category: ${currentScenario}`);
        } catch (searchErr) {
          this.logger('warning', 'Instahyre', `Could not complete search for "${currentScenario}": ${searchErr.message}`);
        }
      }

      this.logger('success', 'Instahyre', `Instahyre automation run finished. Processed ${totalProcessedCount} job applications.`);
    } catch (err) {
      this.logger('error', 'Instahyre', `Instahyre automation error: ${err.message}`);
    } finally {
      try {
        await page.close();
      } catch (closeErr) {}
    }
  }
}

module.exports = InstahyreBot;
