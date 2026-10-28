const path = require('path');
const fs = require('fs');
const ProfileManager = require('./profile-manager');
const ScreeningClassifier = require('./screening-classifier');
const { ApplicationStates } = require('./state-machine');

class CareerSiteBot {
  constructor(chromeManager, aiAgent, settings, logger) {
    this.chrome = chromeManager;
    this.ai = aiAgent;
    this.settings = settings;
    this.logger = logger || console.log;
    this.shouldStop = false;

    // Locate resume PDF
    this.resumePath = this.resolveResumePath();
  }

  stop() {
    this.shouldStop = true;
  }

  resolveResumePath() {
    const candidates = [
      path.join(__dirname, '..', 'config', 'resume.pdf'),
      path.join(__dirname, '..', 'config', 'Sai_Krishna_Resume.pdf'),
      this.ai?.profile?.personal?.resumePath,
      'D:\\Downloads\\Sai_Krishna_G_Resume.pdf'
    ];
    for (const p of candidates) {
      if (p && fs.existsSync(p)) return p;
    }
    return null;
  }

  async randomDelay(min = 1200, max = 2500) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(r => setTimeout(r, delay));
  }

  // Check if the site is Workday or a complex login-walled ATS
  async isLoginWalled(page) {
    try {
      const url = page.url().toLowerCase();
      // Workday, Taleo, SuccessFactors, Accenture B2C, iCIMS, Oracle Cloud, BrassRing account walls
      if (
        url.includes('myworkdayjobs.com') ||
        url.includes('taleo.net') ||
        url.includes('successfactors.com') ||
        url.includes('b2clogin.com') ||
        url.includes('icims.com') ||
        url.includes('brassring.com') ||
        url.includes('oraclecloud.com') ||
        url.includes('auth0.com')
      ) {
        return { isWalled: true, reason: 'Enterprise ATS account login wall (Workday/Taleo/iCIMS/SuccessFactors)' };
      }

      const hasPasswordOrLogin = await page.evaluate(() => {
        const pwdInput = document.querySelector('input[type="password"]');
        const loginForm = document.querySelector('form[action*="login"], form[id*="login"], .login-container');
        if (pwdInput && pwdInput.offsetParent !== null) return true;
        if (loginForm && !document.querySelector('form[id*="apply"], form[class*="apply"], input[type="file"]')) {
          return true;
        }
        return false;
      });

      if (hasPasswordOrLogin) {
        return { isWalled: true, reason: 'Login / Account registration wall required' };
      }

      return { isWalled: false };
    } catch (e) {
      return { isWalled: false };
    }
  }

  // Detect and scroll to the application form on the career page
  async detectAndOpenForm(page) {
    try {
      // 1. Check if form is already visible
      const formSelector = await page.evaluate(() => {
        const selectors = [
          '#sjb-application-form',
          '.jobpost-form',
          'form#application_form',
          'form[action*="apply"]',
          'form[id*="apply"]',
          'form[class*="apply"]',
          'form[id*="job"]',
          'form[class*="job"]',
          'form:has(input[type="file"])',
          'form:has(input[type="email"])'
        ];
        for (const s of selectors) {
          try {
            const el = document.querySelector(s);
            if (el && el.offsetParent !== null) return s;
          } catch (e) {}
        }
        // Fallback: any form with at least 3 inputs
        const allForms = Array.from(document.querySelectorAll('form'));
        for (const f of allForms) {
          const inputs = f.querySelectorAll('input:not([type="hidden"]), select, textarea');
          if (inputs.length >= 3 && f.offsetParent !== null) {
            return f.id ? `#${f.id}` : 'form';
          }
        }
        return null;
      });

      if (formSelector) return formSelector;

      // 2. Look for "Apply Now" button that reveals or scrolls to form (e.g. Lever, WordPress)
      const clickedApplyBtn = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('a, button, [role="button"]'));
        const applyBtn = buttons.find(b => {
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          const href = (b.getAttribute('href') || '').toLowerCase();
          return (
            txt === 'apply for this job' ||
            txt === 'apply now' ||
            txt === 'apply online' ||
            txt === 'apply' ||
            href.includes('#apply') ||
            href.includes('#application')
          );
        });
        if (applyBtn) {
          applyBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          applyBtn.click();
          return true;
        }
        return false;
      });

      if (clickedApplyBtn) {
        await this.randomDelay(1500, 2500);
      }

      return 'form';
    } catch (e) {
      return 'form';
    }
  }

  // Universal Form Filler for Standalone Career Portals
  async applyToCareerPage(page, jobDetails = {}) {
    const jobTitle = jobDetails.title || 'Software Developer';
    const company = jobDetails.company || 'Direct Employer';
    const questionsAnswered = [];
    const currentUrl = page.url();

    this.logger('info', 'CareerSite', `Analyzing career portal for "${jobTitle}" at ${company}...`);

    try {
      // Step 1: Check for Workday or account registration wall
      const wallCheck = await this.isLoginWalled(page);
      if (wallCheck.isWalled) {
        this.logger('warning', 'CareerSite', `Enterprise login wall detected: ${wallCheck.reason} (${currentUrl})`);
        // Do NOT close page; route to Manual Apply Queue so candidate can login/apply
        return {
          success: false,
          status: ApplicationStates.MANUAL_ACTION_REQUIRED,
          applicationMethod: 'login_walled_portal',
          skipReason: wallCheck.reason,
          reason: wallCheck.reason,
          directApplicationUrl: currentUrl,
          questionsAnswered: []
        };
      }

      // Step 2: Ensure form is present
      await this.detectAndOpenForm(page);
      await this.randomDelay(800, 1500);

      // Get canonical profile values
      const canonicalProfile = ProfileManager.normalizeProfile(this.ai?.profile || {});
      const personal = canonicalProfile.personal || {};
      const career = canonicalProfile.career || {};

      // Prepare candidate profile payload with verified baseline
      const candidateData = {
        fullName: personal.fullName || 'Sai Krishna G',
        firstName: personal.firstName || 'Sai Krishna',
        lastName: personal.lastName || 'G',
        email: personal.email || 'gsaikrishna150@gmail.com',
        phone: personal.phone || '+91 8688373517',
        phoneDigits: personal.phoneDigits || '8688373517',
        city: personal.city || 'Hyderabad',
        linkedinUrl: personal.linkedInUrl || 'https://www.linkedin.com/in/saikrishnag150',
        githubUrl: personal.githubUrl || 'https://github.com',
        portfolioUrl: personal.portfolioUrl || 'https://indianmetroguide.in',
        currentCompany: career.currentCompany || 'Tech Mahindra',
        currentTitle: career.currentDesignation || 'Full Stack Developer',
        totalExp: String(career.totalYearsExperience || 2.7),
        noticePeriod: String(career.officialNoticePeriodDays || 90),
        cctc: String(career.currentSalaryLPA || 3.8),
        ectc: String(career.expectedSalaryLPA || 10.0),
        workAuth: career.workAuthorization || 'Authorized to work without restriction in India'
      };

      // Step 3: Universal Field Filling
      const fillResult = await page.evaluate((cand) => {
        const filled = [];

        function clean(s) {
          return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
        }

        function setInputVal(el, val) {
          if (!el || val === undefined || val === null) return false;
          el.focus();
          el.value = val;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
                         Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) {
            try { setter.call(el, val); } catch (e) {}
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          return true;
        }

        const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="file"]), textarea, select'));

        for (const el of inputs) {
          if (el.closest('header') || el.closest('footer')) continue;

          // Identify field context
          const id = clean(el.id);
          const name = clean(el.name);
          const placeholder = clean(el.placeholder);
          const aria = clean(el.getAttribute('aria-label'));
          let labelText = '';
          if (el.id) {
            const l = document.querySelector(`label[for="${el.id}"]`);
            if (l) labelText = clean(l.innerText);
          }
          if (!labelText && el.closest('label')) {
            labelText = clean(el.closest('label').innerText);
          }
          const context = `${id} ${name} ${placeholder} ${aria} ${labelText}`.toLowerCase();

          // 1. Email (FIRST to prevent address confusion)
          if (el.type === 'email' || /\b(email|e\s*mail)\b/.test(context)) {
            if (setInputVal(el, cand.email)) filled.push({ field: 'Email', val: cand.email });
          }
          // 2. Full Name vs First/Last
          else if (/\b(full\s*name|your\s*name|^name$)\b/.test(context) && !/\b(company|user|user_name|file)\b/.test(context)) {
            if (setInputVal(el, cand.fullName)) filled.push({ field: 'Full Name', val: cand.fullName });
          } else if (/\b(first\s*name|fname)\b/.test(context)) {
            if (setInputVal(el, cand.firstName)) filled.push({ field: 'First Name', val: cand.firstName });
          } else if (/\b(last\s*name|lname|surname)\b/.test(context)) {
            if (setInputVal(el, cand.lastName)) filled.push({ field: 'Last Name', val: cand.lastName });
          }
          // 3. Mobile / Phone
          else if (el.type === 'tel' || /\b(phone|mobile|contact\s*no|contact\s*num|cell)\b/.test(context)) {
            const val = context.includes('country') ? cand.phone : cand.phoneDigits;
            if (setInputVal(el, val)) filled.push({ field: 'Mobile Phone', val });
          }
          // 4. City / Location
          else if (/\b(city|current\s*city|location|residence)\b/.test(context) && !/\b(phone|code|email)\b/.test(context)) {
            if (setInputVal(el, cand.city)) filled.push({ field: 'City / Location', val: cand.city });
          }
          // 5. LinkedIn
          else if (context.includes('linkedin')) {
            if (setInputVal(el, cand.linkedinUrl)) filled.push({ field: 'LinkedIn URL', val: cand.linkedinUrl });
          }
          // 6. GitHub
          else if (context.includes('github')) {
            if (setInputVal(el, cand.githubUrl)) filled.push({ field: 'GitHub URL', val: cand.githubUrl });
          }
          // 7. Portfolio / Website
          else if (/\b(portfolio|website|web\s*site|url)\b/.test(context) && !context.includes('linkedin')) {
            if (setInputVal(el, cand.portfolioUrl)) filled.push({ field: 'Portfolio', val: cand.portfolioUrl });
          }
          // 8. Current Company
          else if (/\b(current\s*company|employer|organization)\b/.test(context)) {
            if (setInputVal(el, cand.currentCompany)) filled.push({ field: 'Current Company', val: cand.currentCompany });
          }
          // 9. Current Designation
          else if (/\b(current\s*title|designation|current\s*role)\b/.test(context)) {
            if (setInputVal(el, cand.currentTitle)) filled.push({ field: 'Current Title', val: cand.currentTitle });
          }
          // 10. Total Experience
          else if (/\b(total\s*experience|years\s*of\s*experience|work\s*experience|experience\s*in\s*years)\b/.test(context)) {
            if (setInputVal(el, cand.totalExp)) filled.push({ field: 'Total Experience', val: cand.totalExp });
          }
          // 11. Notice Period
          else if (/\b(notice\s*period|days\s*to\s*join|joining\s*time|np)\b/.test(context)) {
            if (setInputVal(el, cand.noticePeriod)) filled.push({ field: 'Notice Period', val: cand.noticePeriod });
          }
          // 12. Current CTC
          else if (/\b(current\s*ctc|current\s*salary|cctc)\b/.test(context)) {
            if (setInputVal(el, cand.cctc)) filled.push({ field: 'Current CTC', val: cand.cctc });
          }
          // 13. Expected CTC
          else if (/\b(expected\s*ctc|expected\s*salary|ectc)\b/.test(context)) {
            if (setInputVal(el, cand.ectc)) filled.push({ field: 'Expected CTC', val: cand.ectc });
          }
        }

        return filled;
      }, candidateData);

      this.logger('action', 'CareerSite', `Autofilled ${fillResult.length} candidate fields on career form.`);
      for (const item of fillResult) {
        questionsAnswered.push({
          question: item.field,
          answer: item.val,
          inputType: 'text',
          source: 'Canonical Candidate Profile',
          timestamp: new Date().toISOString()
        });
      }

      // Step 4: Resume PDF File Upload
      if (this.resumePath && fs.existsSync(this.resumePath)) {
        try {
          const fileInput = await page.$('input[type="file"]');
          if (fileInput) {
            await fileInput.uploadFile(this.resumePath);
            this.logger('success', 'CareerSite', `Uploaded candidate resume PDF (${path.basename(this.resumePath)}).`);
            await this.randomDelay(1000, 2000);
          }
        } catch (uploadErr) {
          this.logger('warning', 'CareerSite', `Resume upload note: ${uploadErr.message}`);
        }
      }

      // Step 5: Check if reviewBeforeSubmit is requested or user wants manual check
      const reviewBeforeSubmit = this.settings.automation?.reviewBeforeSubmit === true ||
                                this.settings.automation?.autoSubmitCareerSites === false;

      if (reviewBeforeSubmit) {
        this.logger('info', 'CareerSite', `Form filled and prepared. Manual review requested before submission.`);
        return {
          success: true,
          status: ApplicationStates.MANUAL_ACTION_REQUIRED,
          applicationMethod: 'career_site_form',
          reason: 'Form filled successfully; awaiting candidate review and manual submit',
          directApplicationUrl: currentUrl,
          filledFields: fillResult.map(f => f.field),
          questionsAnswered
        };
      }

      // Step 6: Live Mode Submission
      this.logger('action', 'CareerSite', `Submitting application on career website for "${jobTitle}" at ${company}...`);

      const submitResult = await page.evaluate(() => {
        const selectors = [
          'button.app-submit',
          '.app-submit',
          'button[type="submit"]',
          'input[type="submit"]',
          '#sjb-application-form button',
          '.jobpost-form button',
          'button[id*="submit"]',
          'button[class*="submit"]',
          'input[id*="submit"]',
          'input[class*="submit"]',
          'button.submit-button',
          'a.submit-button'
        ];

        let btn = null;
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null && !el.disabled) {
            btn = el;
            break;
          }
        }

        if (!btn) {
          const allBtns = Array.from(document.querySelectorAll('button, input[type="button"], a[role="button"]'));
          btn = allBtns.find(b => {
            const txt = (b.innerText || b.value || b.textContent || '').trim().toLowerCase();
            return (
              txt === 'submit' ||
              txt === 'submit application' ||
              txt === 'send application' ||
              txt === 'apply now' ||
              txt === 'apply'
            ) && b.offsetParent !== null && !b.disabled;
          });
        }

        if (btn) {
          btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          btn.click();
          return { clicked: true, text: btn.innerText || btn.value || 'Submit' };
        }

        const form = document.querySelector('#sjb-application-form, .jobpost-form, form[action*="apply"], form');
        if (form) {
          const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
          const notCancelled = form.dispatchEvent(submitEvent);
          if (notCancelled && typeof form.submit === 'function') {
            form.submit();
            return { clicked: true, text: 'Form Submit Event' };
          }
        }

        return { clicked: false };
      });

      if (submitResult.clicked) {
        this.logger('action', 'CareerSite', `Clicked "${submitResult.text}" button. Verifying submission response...`);
        await this.randomDelay(3000, 4500);

        const confirmation = await page.evaluate(() => {
          const bodyText = (document.body ? document.body.innerText : '').toLowerCase();

          // 1. Check for explicit error messages from employer's server
          const errorEl = document.querySelector(
            '.alert-danger, .alert-warning, .error, .sjb-message.alert-danger, .error-message, .wp-block-group.error, [class*="alert-danger"]'
          );
          const hasErrorText = 
            bodyText.includes('unable to write to directory') ||
            bodyText.includes('could not be processed') ||
            bodyText.includes('please fill in required') ||
            bodyText.includes('captcha verification failed') ||
            bodyText.includes('an error occurred');

          if (errorEl || hasErrorText) {
            const errTxt = errorEl ? errorEl.innerText.trim() : 'Employer server returned an application processing error.';
            return {
              isSuccess: false,
              isError: true,
              msg: errTxt
            };
          }

          // 2. Check for explicit success confirmation
          const successMsg = document.querySelector(
            '.alert-success, .sjb-message.alert-success, .success-message, [class*="alert-success"], .wp-block-group.success'
          );
          const hasSuccessText = 
            bodyText.includes('application submitted') ||
            bodyText.includes('successfully submitted') ||
            bodyText.includes('thank you for applying') ||
            bodyText.includes('application has been received') ||
            bodyText.includes('received your application') ||
            bodyText.includes('your application was sent');

          return {
            isSuccess: !!successMsg || hasSuccessText,
            isError: false,
            msg: successMsg ? successMsg.innerText.trim() : ''
          };
        });

        if (confirmation.isError) {
          this.logger('error', 'CareerSite', `Employer website error: "${confirmation.msg}"`);
          return {
            success: false,
            status: ApplicationStates.FAILED_RETRYABLE,
            error: confirmation.msg,
            directApplicationUrl: currentUrl,
            filledFields: fillResult.map(f => f.field),
            questionsAnswered
          };
        }

        if (confirmation.isSuccess) {
          this.logger('success', 'CareerSite', `Application submitted and confirmed for "${jobTitle}" at ${company}! ${confirmation.msg || ''}`);
          return {
            success: true,
            status: ApplicationStates.APPLIED_CONFIRMED,
            directApplicationUrl: currentUrl,
            filledFields: fillResult.map(f => f.field),
            questionsAnswered
          };
        }

        // UNVERIFIED OUTCOME: Never report as confirmed without explicit proof!
        this.logger('warning', 'CareerSite', `Application was submitted, but outcome could not be independently confirmed on the page.`);
        return {
          success: true,
          status: ApplicationStates.SUBMITTED_UNVERIFIED,
          reason: 'Application submitted; employer confirmation pending manual review',
          directApplicationUrl: currentUrl,
          filledFields: fillResult.map(f => f.field),
          questionsAnswered
        };
      } else {
        this.logger('warning', 'CareerSite', `Submit button not found; form filled and preserved in Manual Apply Queue.`);
        return {
          success: true,
          status: ApplicationStates.MANUAL_ACTION_REQUIRED,
          applicationMethod: 'career_site_form',
          reason: 'Submit button not found; form filled and awaiting manual submit',
          directApplicationUrl: currentUrl,
          filledFields: fillResult.map(f => f.field),
          questionsAnswered
        };
      }

    } catch (err) {
      this.logger('error', 'CareerSite', `Career site automation error: ${err.message}`);
      return {
        success: false,
        status: ApplicationStates.FAILED_RETRYABLE,
        error: err.message,
        directApplicationUrl: currentUrl,
        questionsAnswered
      };
    }
  }
}

module.exports = CareerSiteBot;
