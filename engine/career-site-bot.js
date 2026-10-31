const path = require('path');
const fs = require('fs');
const ProfileManager = require('./profile-manager');
const ScreeningClassifier = require('./screening-classifier');
const { ApplicationStates } = require('./state-machine');

class CareerSiteBot {
  constructor(chromeManager, aiAgent, settings, logger, dataStore) {
    this.chrome = chromeManager;
    this.ai = aiAgent;
    this.settings = settings;
    this.logger = logger || console.log;
    this.dataStore = dataStore || (aiAgent?.dataStore) || null;
    this.shouldStop = false;

    // Locate candidate resume PDF
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

  /**
   * Waits for redirect chains to settle and target page DOM to become active
   */
  async waitForPageReady(page, timeoutMs = 15000) {
    try {
      const startTime = Date.now();

      // Check if page is currently on a known redirect bridge
      while (Date.now() - startTime < timeoutMs) {
        const u = page.url().toLowerCase();
        const isRedirect =
          u.includes('/jobs/view/externalapply') ||
          u.includes('gateway/v1/apply') ||
          u.includes('redirect') ||
          u.includes('clk.tradedoubler') ||
          u.includes('doubleclick') ||
          u === 'about:blank';

        if (!isRedirect) break;
        await new Promise(r => setTimeout(r, 600));
      }

      // Wait for domcontentloaded
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 3500 }).catch(() => {});
      await this.randomDelay(1500, 2500);

      // Verify page is alive
      await page.evaluate(() => document.readyState);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if the site is Workday or a complex login-walled ATS
   */
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

  /**
   * Detect and open / scroll to the application form on the career page
   */
  async detectAndOpenForm(page) {
    try {
      // 1. Check if form or application inputs are already visible
      const isAlreadyVisible = await page.evaluate(() => {
        const formSelectors = [
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
        for (const s of formSelectors) {
          try {
            const el = document.querySelector(s);
            if (el && el.offsetParent !== null) return true;
          } catch (e) {}
        }
        const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea'));
        const visibleInputs = inputs.filter(el => el.offsetParent !== null && !el.closest('header') && !el.closest('footer'));
        return visibleInputs.length >= 3;
      });

      if (isAlreadyVisible) return true;

      // 2. Look for "Apply Now" button that reveals or scrolls to form (e.g. Lever, WordPress, Ashby)
      const clickedApplyBtn = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="button"]'));
        const applyBtn = buttons.find(b => {
          const txt = (b.innerText || b.textContent || b.value || '').trim().toLowerCase();
          const href = (b.getAttribute('href') || '').toLowerCase();
          const id = (b.id || '').toLowerCase();
          const cls = (b.className || '').toLowerCase();

          return (
            txt === 'apply for this job' ||
            txt === 'apply now' ||
            txt === 'apply online' ||
            txt === 'apply' ||
            txt === 'submit application' ||
            txt === 'i\'m interested' ||
            href.includes('#apply') ||
            href.includes('#application') ||
            id.includes('apply') ||
            cls.includes('apply-btn') ||
            cls.includes('postings-btn')
          ) && b.offsetParent !== null;
        });

        if (applyBtn) {
          applyBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          applyBtn.click();
          return true;
        }
        return false;
      });

      if (clickedApplyBtn) {
        await this.randomDelay(1800, 3000);
      }

      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Scans career page content and mailto links for recruiter/HR emails
   */
  async scanPageForRecruiterEmails(page, jobDetails = {}) {
    try {
      if (!this.dataStore || !this.dataStore.recruiterEmails) return [];

      const pageData = await page.evaluate(() => {
        const bodyText = document.body ? document.body.innerText : '';
        const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'))
          .map(a => a.getAttribute('href').replace('mailto:', '').split('?')[0].trim())
          .filter(Boolean);

        return { bodyText: bodyText.slice(0, 15000), mailtoLinks };
      });

      const combinedText = `${pageData.mailtoLinks.join(' ')}\n${pageData.bodyText}`;
      const extracted = this.dataStore.recruiterEmails.extractEmailsFromText(combinedText, {
        title: jobDetails.title,
        company: jobDetails.company,
        url: page.url(),
        platform: 'Career Website'
      });

      if (extracted.length > 0) {
        this.logger('success', 'CareerSite', `Discovered ${extracted.length} recruiter/HR email(s) on ${jobDetails.company} career page! Saved to Recruiter Outreach.`);
      }

      return extracted;
    } catch (e) {
      return [];
    }
  }

  /**
   * Universal Form Filler for Standalone Career Portals & ATS Forms
   */
  async applyToCareerPage(page, jobDetails = {}) {
    const jobTitle = jobDetails.title || 'Software Developer';
    const company = jobDetails.company || 'Direct Employer';
    const questionsAnswered = [];

    this.logger('info', 'CareerSite', `Analyzing career portal for "${jobTitle}" at ${company}...`);

    try {
      // Step 0: Ensure redirect chains settle
      await this.waitForPageReady(page);
      const currentUrl = page.url();

      // Check if URL is just a job search list page (not a job apply form)
      if (
        currentUrl.includes('naukri.com/jobs-in') ||
        currentUrl.includes('naukri.com/all-jobs') ||
        currentUrl.includes('linkedin.com/jobs/search')
      ) {
        this.logger('warning', 'CareerSite', `URL is a job search list page, not an application form: ${currentUrl}`);
        return {
          success: false,
          status: ApplicationStates.SKIPPED_LOW_MATCH,
          reason: 'Search index URL, not a direct job post',
          directApplicationUrl: currentUrl,
          questionsAnswered: []
        };
      }

      // Harvest any recruiter/HR emails from the career page text & mailto links
      await this.scanPageForRecruiterEmails(page, jobDetails);

      // Step 1: Check for Workday or account registration wall
      const wallCheck = await this.isLoginWalled(page);
      if (wallCheck.isWalled) {
        this.logger('warning', 'CareerSite', `Enterprise login wall detected: ${wallCheck.reason} (${currentUrl})`);
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

      // Step 2: Ensure form is present / click Apply Now button if required
      await this.detectAndOpenForm(page);
      await this.randomDelay(1000, 1800);

      // Get canonical profile values
      const canonicalProfile = ProfileManager.normalizeProfile(this.ai?.profile || {});
      const personal = canonicalProfile.personal || {};
      const career = canonicalProfile.career || {};
      const education = canonicalProfile.education || {};

      // Prepare comprehensive candidate profile payload
      const candidateData = {
        fullName: personal.fullName || 'Sai Krishna G',
        firstName: personal.firstName || 'Sai Krishna',
        lastName: personal.lastName || 'G',
        email: personal.email || 'gsaikrishna150@gmail.com',
        phone: personal.phone || '+91 8688373517',
        phoneDigits: personal.phoneDigits || '8688373517',
        phoneCountryCode: personal.phoneCountryCode || '+91',
        city: personal.city || 'Hyderabad',
        state: personal.state || 'Telangana',
        country: personal.country || 'India',
        postalCode: personal.postalCode || '500032',
        address: personal.address || 'Anjaiah nagar, Gachibowli, Hyderabad, Telangana - 500032',
        linkedinUrl: personal.linkedInUrl || 'https://www.linkedin.com/in/saikrishnag150',
        githubUrl: personal.githubUrl || 'https://github.com/saikrish150',
        portfolioUrl: personal.portfolioUrl || 'https://gsaikrishna-portfolio.netlify.app/',
        currentCompany: career.currentCompany || 'Tech Mahindra',
        currentTitle: career.currentDesignation || 'Full Stack Developer',
        totalExp: String(career.totalYearsExperience || 3),
        totalExpInt: 3,
        noticePeriod: String(career.officialNoticePeriodDays || 30),
        noticePeriodText: '30 days (Currently serving notice period)',
        cctc: String(career.currentSalaryLPA || 4.1),
        cctcAnnual: '410000',
        ectc: String(career.expectedSalaryLPA || 10.0),
        ectcAnnual: '1000000',
        degree: education.degree || 'B.Tech in Electronics and Communication Engineering',
        degreeShort: 'B.Tech',
        college: education.institution || 'SRM Institute of Science and Technology',
        graduationYear: String(education.graduationYear || 2023),
        cgpa: education.cgpa || '8.9',
        gender: personal.gender || 'Male',
        workAuth: 'Authorized to work without restriction in India',
        needsSponsorship: 'No',
        willingToRelocate: 'Yes',
        skills: 'Angular, TypeScript, Java, Spring Boot, Microservices, RESTful APIs, PostgreSQL, AWS Lambda, Docker',
        coverLetter: `Passionate Full Stack Developer with 3 years of hands-on experience building enterprise web applications using Angular, TypeScript, Java, Spring Boot, and PostgreSQL at Tech Mahindra (GE Aerospace client). Currently serving a 30-day notice period and available for immediate transition.`
      };

      // Step 3: Universal DOM Autofill (Text inputs, Textareas, Select Dropdowns, Radios, and Checkboxes)
      const fillResult = await page.evaluate((cand) => {
        const filled = [];

        function clean(s) {
          return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
        }

        // Native value setter supporting React, Vue, Angular, and vanilla DOM
        function setInputValue(el, val) {
          if (!el || val === undefined || val === null) return false;
          el.focus();
          el.value = val;
          const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) {
            try { setter.call(el, val); } catch (e) {}
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          return true;
        }

        // Fuzzy select matcher for native <select> elements
        function setSelectValue(selectEl, targetValue) {
          if (!selectEl || !selectEl.options || selectEl.options.length === 0) return false;
          const targetClean = clean(String(targetValue));
          let bestIdx = -1;

          // 1. Exact value match
          for (let i = 0; i < selectEl.options.length; i++) {
            const opt = selectEl.options[i];
            if (clean(opt.value) === targetClean || clean(opt.text) === targetClean) {
              bestIdx = i;
              break;
            }
          }

          // 2. Contains match
          if (bestIdx === -1) {
            for (let i = 0; i < selectEl.options.length; i++) {
              const opt = selectEl.options[i];
              const optTxt = clean(opt.text);
              const optVal = clean(opt.value);
              if (optTxt.includes(targetClean) || targetClean.includes(optTxt) || optVal.includes(targetClean)) {
                bestIdx = i;
                break;
              }
            }
          }

          // 3. Fallback for notice period (e.g. 30 -> 1 month / immediate / serving notice)
          if (bestIdx === -1 && (targetClean.includes('30') || targetClean.includes('notice'))) {
            for (let i = 0; i < selectEl.options.length; i++) {
              const t = clean(selectEl.options[i].text);
              if (t.includes('30') || t.includes('1 month') || t.includes('serving') || t.includes('immediate')) {
                bestIdx = i;
                break;
              }
            }
          }

          // 4. Fallback for experience (e.g. 3 -> 2-4 / 3-5 years)
          if (bestIdx === -1 && (targetClean === '3' || targetClean.includes('3 year'))) {
            for (let i = 0; i < selectEl.options.length; i++) {
              const t = clean(selectEl.options[i].text);
              if (t.includes('3') || t.includes('2 4') || t.includes('2 5') || t.includes('3 5')) {
                bestIdx = i;
                break;
              }
            }
          }

          if (bestIdx >= 0) {
            selectEl.selectedIndex = bestIdx;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
            if (setter) {
              try { setter.call(selectEl, selectEl.options[bestIdx].value); } catch (e) {}
            }
            selectEl.dispatchEvent(new Event('input', { bubbles: true }));
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            selectEl.dispatchEvent(new Event('blur', { bubbles: true }));
            return selectEl.options[bestIdx].text.trim();
          }

          return false;
        }

        // Helper to extract full context around any form input
        function getContext(el) {
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
          if (!labelText) {
            // Check preceding sibling or parent container
            const parent = el.closest('.form-group, .field, .form-row, .input-container, div, p');
            if (parent) {
              const lbl = parent.querySelector('label, .label, span, strong');
              if (lbl && lbl !== el) labelText = clean(lbl.innerText);
            }
          }

          return `${id} ${name} ${placeholder} ${aria} ${labelText}`.toLowerCase();
        }

        // Recursive form element discovery across standard DOM and Shadow DOM roots
        function findAllFormElements(root = document) {
          let results = [];
          const els = Array.from(root.querySelectorAll('*'));
          for (const el of els) {
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
              results.push(el);
            }
            if (el.shadowRoot) {
              results = results.concat(findAllFormElements(el.shadowRoot));
            }
          }
          return results;
        }

        const elements = findAllFormElements(document);

        for (const el of elements) {
          if (el.closest('header') || el.closest('footer')) continue;
          if (el.type === 'file') continue;

          const context = getContext(el);

          // Handle Checkboxes (Consent / Terms / Privacy Policy)
          if (el.type === 'checkbox') {
            if (
              context.includes('term') ||
              context.includes('privacy') ||
              context.includes('agree') ||
              context.includes('consent') ||
              context.includes('certify') ||
              context.includes('declare') ||
              context.includes('accurate') ||
              el.required
            ) {
              el.checked = true;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              filled.push({ field: 'Terms & Privacy Consent', val: 'Checked (Agreed)' });
            }
            continue;
          }

          // Handle Radio Buttons
          if (el.type === 'radio') {
            const isWorkAuth = context.includes('authorized') || context.includes('legal') || context.includes('eligible');
            const isSponsorship = context.includes('sponsor') || context.includes('visa');
            const isRelocate = context.includes('relocat');
            const isGender = context.includes('gender') || context.includes('sex');

            const radioLabel = el.parentElement ? clean(el.parentElement.innerText) : '';
            const radioVal = clean(el.value);
            const radioDesc = `${radioLabel} ${radioVal}`;

            if (isWorkAuth && (radioDesc.includes('yes') || radioDesc.includes('true'))) {
              el.checked = true;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              filled.push({ field: 'Work Authorization', val: 'Yes' });
            } else if (isSponsorship && (radioDesc.includes('no') || radioDesc.includes('false'))) {
              el.checked = true;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              filled.push({ field: 'Visa Sponsorship', val: 'No' });
            } else if (isRelocate && (radioDesc.includes('yes') || radioDesc.includes('true'))) {
              el.checked = true;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              filled.push({ field: 'Willing to Relocate', val: 'Yes' });
            } else if (isGender && radioDesc.includes('male') && !radioDesc.includes('female')) {
              el.checked = true;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              filled.push({ field: 'Gender', val: 'Male' });
            }
            continue;
          }

          // Handle <select> Dropdowns
          if (el.tagName === 'SELECT') {
            let matched = false;
            if (context.includes('notice') || context.includes('join') || context.includes('np')) {
              const res = setSelectValue(el, cand.noticePeriod);
              if (res) { filled.push({ field: 'Notice Period', val: res }); matched = true; }
            } else if (context.includes('experience') || context.includes('exp') || context.includes('years')) {
              const res = setSelectValue(el, cand.totalExp);
              if (res) { filled.push({ field: 'Experience Years', val: res }); matched = true; }
            } else if (context.includes('gender') || context.includes('sex')) {
              const res = setSelectValue(el, cand.gender);
              if (res) { filled.push({ field: 'Gender', val: res }); matched = true; }
            } else if (context.includes('country')) {
              const res = setSelectValue(el, cand.country);
              if (res) { filled.push({ field: 'Country', val: res }); matched = true; }
            } else if (context.includes('state')) {
              const res = setSelectValue(el, cand.state);
              if (res) { filled.push({ field: 'State', val: res }); matched = true; }
            } else if (context.includes('city') || context.includes('location')) {
              const res = setSelectValue(el, cand.city);
              if (res) { filled.push({ field: 'City', val: res }); matched = true; }
            } else if (context.includes('degree') || context.includes('education') || context.includes('qualification')) {
              const res = setSelectValue(el, cand.degreeShort);
              if (res) { filled.push({ field: 'Degree / Education', val: res }); matched = true; }
            } else if (context.includes('sponsor') || context.includes('visa')) {
              const res = setSelectValue(el, 'No');
              if (res) { filled.push({ field: 'Visa Sponsorship', val: 'No' }); matched = true; }
            } else if (context.includes('authoriz') || context.includes('eligib')) {
              const res = setSelectValue(el, 'Yes');
              if (res) { filled.push({ field: 'Work Authorization', val: 'Yes' }); matched = true; }
            }
            continue;
          }

          // Handle Text / Tel / Email / Textarea Inputs
          // 1. Email & Confirm Email (FIRST to prevent address confusion)
          if (el.type === 'email' || /\b(email|e\s*mail)\b/.test(context)) {
            const fieldName = context.includes('confirm') ? 'Confirm Email' : 'Email';
            if (setInputValue(el, cand.email)) filled.push({ field: fieldName, val: cand.email });
          }
          // 2. Full Name vs First/Last Name
          else if (/\b(full\s*name|your\s*name|^name$|candidate\s*name|applicant\s*name)\b/.test(context) && !/\b(company|user|user_name|file)\b/.test(context)) {
            if (setInputValue(el, cand.fullName)) filled.push({ field: 'Full Name', val: cand.fullName });
          } else if (/\b(first\s*name|fname|given\s*name)\b/.test(context)) {
            if (setInputValue(el, cand.firstName)) filled.push({ field: 'First Name', val: cand.firstName });
          } else if (/\b(last\s*name|lname|surname|family\s*name)\b/.test(context)) {
            if (setInputValue(el, cand.lastName)) filled.push({ field: 'Last Name', val: cand.lastName });
          }
          // 3. Mobile / Phone
          else if (el.type === 'tel' || /\b(phone|mobile|contact\s*no|contact\s*num|cell|telephone)\b/.test(context)) {
            const val = context.includes('country') ? cand.phone : cand.phoneDigits;
            if (setInputValue(el, val)) filled.push({ field: 'Mobile Phone', val });
          }
          // 3b. Country Search / Code dropdown input (e.g. SmartRecruiters country code search)
          else if (context.includes('country') && (context.includes('search') || context.includes('code') || context.includes('region'))) {
            if (setInputValue(el, 'India (+91)')) filled.push({ field: 'Phone Country Code', val: 'India (+91)' });
          }
          // 4. Postal Code / Pin Code
          else if (/\b(postal\s*code|pin\s*code|zip\s*code|pincode|zip)\b/.test(context)) {
            if (setInputValue(el, cand.postalCode)) filled.push({ field: 'Postal Code', val: cand.postalCode });
          }
          // 5. City / Location
          else if (/\b(city|current\s*city|location|residence)\b/.test(context) && !/\b(phone|code|email|address)\b/.test(context)) {
            if (setInputValue(el, cand.city)) filled.push({ field: 'City / Location', val: cand.city });
          }
          // 6. State
          else if (/\b(state|province)\b/.test(context) && !/\b(statement|united)\b/.test(context)) {
            if (setInputValue(el, cand.state)) filled.push({ field: 'State', val: cand.state });
          }
          // 7. Full Address
          else if (/\b(address|street\s*address)\b/.test(context) && !context.includes('email')) {
            if (setInputValue(el, cand.address)) filled.push({ field: 'Address', val: cand.address });
          }
          // 8. LinkedIn URL
          else if (context.includes('linkedin')) {
            if (setInputValue(el, cand.linkedinUrl)) filled.push({ field: 'LinkedIn URL', val: cand.linkedinUrl });
          }
          // 9. GitHub URL
          else if (context.includes('github')) {
            if (setInputValue(el, cand.githubUrl)) filled.push({ field: 'GitHub URL', val: cand.githubUrl });
          }
          // 10. Portfolio / Personal Website
          else if (/\b(portfolio|website|web\s*site|personal\s*url|link)\b/.test(context) && !context.includes('linkedin') && !context.includes('github')) {
            if (setInputValue(el, cand.portfolioUrl)) filled.push({ field: 'Portfolio', val: cand.portfolioUrl });
          }
          // 11. Current Company
          else if (/\b(current\s*company|present\s*company|current\s*employer|organization)\b/.test(context)) {
            if (setInputValue(el, cand.currentCompany)) filled.push({ field: 'Current Company', val: cand.currentCompany });
          }
          // 12. Current Designation / Title
          else if (/\b(current\s*title|designation|current\s*role|job\s*title)\b/.test(context)) {
            if (setInputValue(el, cand.currentTitle)) filled.push({ field: 'Current Title', val: cand.currentTitle });
          }
          // 13. Total Experience
          else if (/\b(total\s*experience|years\s*of\s*experience|work\s*experience|experience\s*in\s*years|overall\s*exp)\b/.test(context)) {
            if (setInputValue(el, cand.totalExp)) filled.push({ field: 'Total Experience', val: cand.totalExp });
          }
          // 14. Notice Period
          else if (/\b(notice\s*period|days\s*to\s*join|joining\s*time|np)\b/.test(context)) {
            const val = context.includes('month') ? '1 Month' : cand.noticePeriod;
            if (setInputValue(el, val)) filled.push({ field: 'Notice Period', val });
          }
          // 15. Current CTC / Salary
          else if (/\b(current\s*ctc|current\s*salary|cctc|present\s*ctc)\b/.test(context)) {
            const val = context.includes('lakh') || context.includes('lpa') ? cand.cctc : cand.cctcAnnual;
            if (setInputValue(el, val)) filled.push({ field: 'Current CTC', val });
          }
          // 16. Expected CTC / Salary
          else if (/\b(expected\s*ctc|expected\s*salary|ectc)\b/.test(context)) {
            const val = context.includes('lakh') || context.includes('lpa') ? cand.ectc : cand.ectcAnnual;
            if (setInputValue(el, val)) filled.push({ field: 'Expected CTC', val });
          }
          // 17. College / University
          else if (/\b(college|university|institution|school)\b/.test(context)) {
            if (setInputValue(el, cand.college)) filled.push({ field: 'College / University', val: cand.college });
          }
          // 18. Degree / Qualification
          else if (/\b(degree|qualification|highest\s*education|major)\b/.test(context)) {
            if (setInputValue(el, cand.degree)) filled.push({ field: 'Degree / Qualification', val: cand.degree });
          }
          // 19. Graduation Year
          else if (/\b(graduation\s*year|passing\s*year|year\s*of\s*passing|year\s*of\s*completion)\b/.test(context)) {
            if (setInputValue(el, cand.graduationYear)) filled.push({ field: 'Graduation Year', val: cand.graduationYear });
          }
          // 20. Cover Letter / Summary / Note to Recruiter
          else if (/\b(cover\s*letter|summary|about\s*you|message|note|introduction)\b/.test(context) || el.tagName === 'TEXTAREA') {
            if (setInputValue(el, cand.coverLetter)) filled.push({ field: 'Cover Letter / Summary', val: cand.coverLetter });
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

      // Step 4: AI & ScreeningClassifier Fallback for remaining unfilled inputs
      const unfilledQuestions = await page.evaluate(() => {
        function clean(s) {
          return (s || '').replace(/[\*\:]/g, '').trim();
        }

        const missing = [];
        const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]), textarea, select'));

        for (const el of inputs) {
          if (el.closest('header') || el.closest('footer')) continue;
          if (el.value && el.value.trim().length > 0) continue;
          if (el.type === 'checkbox' && el.checked) continue;

          // Find question label
          let q = '';
          if (el.id) {
            const l = document.querySelector(`label[for="${el.id}"]`);
            if (l) q = clean(l.innerText);
          }
          if (!q && el.closest('label')) {
            q = clean(el.closest('label').innerText);
          }
          if (!q) {
            const parent = el.closest('.form-group, .field, div');
            if (parent) {
              const lbl = parent.querySelector('label, .label, span, strong');
              if (lbl && lbl !== el) q = clean(lbl.innerText);
            }
          }
          if (!q && el.placeholder) {
            q = clean(el.placeholder);
          }

          if (q && q.length > 2) {
            missing.push({
              id: el.id,
              name: el.name,
              question: q,
              tagName: el.tagName,
              type: el.type,
              required: el.required || el.getAttribute('aria-required') === 'true'
            });
          }
        }
        return missing;
      });

      if (unfilledQuestions.length > 0) {
        this.logger('info', 'CareerSite', `Evaluating ${unfilledQuestions.length} remaining custom fields with AI Screening Classifier...`);
        for (const uq of unfilledQuestions) {
          try {
            const answerRes = await this.ai.answerScreeningQuestionAI(
              uq.question,
              [],
              uq.type || 'text',
              { platform: 'Career Website', jobTitle, company }
            );

            if (answerRes && answerRes.answer !== undefined) {
              await page.evaluate((uqObj, ans) => {
                const el = (uqObj.id ? document.getElementById(uqObj.id) : null) ||
                           (uqObj.name ? document.querySelector(`[name="${uqObj.name}"]`) : null);
                if (el) {
                  el.focus();
                  el.value = ans;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  el.dispatchEvent(new Event('blur', { bubbles: true }));
                }
              }, uq, String(answerRes.answer));

              this.logger('action', 'CareerSite', `AI Answered custom field: "${uq.question}" → [${answerRes.answer}]`);
              questionsAnswered.push({
                question: uq.question,
                answer: String(answerRes.answer),
                inputType: uq.type || 'text',
                source: answerRes.source || 'AI Screening Classifier',
                timestamp: new Date().toISOString()
              });
            }
          } catch (aiErr) {
            this.logger('warning', 'CareerSite', `AI answering note for "${uq.question}": ${aiErr.message}`);
          }
        }
      }

      // Step 5: Resume PDF File Upload (Prioritizing resume dropzone over avatar)
      if (this.resumePath && fs.existsSync(this.resumePath)) {
        try {
          const fileInputs = await page.$$('input[type="file"]');
          let targetFileInput = null;

          for (const fi of fileInputs) {
            const fiMeta = await fi.evaluate(el => {
              const label = (el.getAttribute('aria-label') || '').toLowerCase();
              const id = (el.id || '').toLowerCase();
              const name = (el.name || '').toLowerCase();
              const parentText = (el.closest('div, section, fieldset')?.innerText || '').toLowerCase();
              return { label, id, name, parentText };
            });

            // Avoid avatar / profile picture uploaders
            if (fiMeta.label.includes('profile image') || fiMeta.label.includes('avatar') || fiMeta.label.includes('photo')) {
              continue;
            }

            if (
              fiMeta.id.includes('resume') ||
              fiMeta.name.includes('resume') ||
              fiMeta.label.includes('resume') ||
              fiMeta.id.includes('dropzone') ||
              fiMeta.parentText.includes('resume') ||
              fiMeta.parentText.includes('cv') ||
              fiMeta.parentText.includes('choose a file')
            ) {
              targetFileInput = fi;
              break;
            }
          }

          if (!targetFileInput && fileInputs.length > 0) {
            targetFileInput = fileInputs[fileInputs.length - 1]; // Fallback to last file input
          }

          if (targetFileInput) {
            await targetFileInput.uploadFile(this.resumePath);
            await targetFileInput.evaluate(el => {
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new Event('input', { bubbles: true }));
            });
            this.logger('success', 'CareerSite', `Uploaded candidate resume PDF (${path.basename(this.resumePath)}).`);
            await this.randomDelay(1000, 2000);
          }
        } catch (uploadErr) {
          this.logger('warning', 'CareerSite', `Resume upload note: ${uploadErr.message}`);
        }
      }

      // Step 6: Verify required fields before submitting
      const missingRequired = await page.evaluate(() => {
        const requiredInputs = Array.from(document.querySelectorAll('input[required], select[required], textarea[required], [aria-required="true"]'));
        const empty = [];
        for (const el of requiredInputs) {
          if (el.offsetParent === null) continue; // Skip hidden elements
          if (el.type === 'file' && el.files && el.files.length > 0) continue;
          if (el.type === 'checkbox' && el.checked) continue;
          if (el.value && el.value.trim().length > 0) continue;
          empty.push(el.id || el.name || el.placeholder || el.tagName);
        }
        return empty;
      });

      if (missingRequired.length > 0) {
        this.logger('warning', 'CareerSite', `Form has ${missingRequired.length} unpopulated required fields: [${missingRequired.join(', ')}]. Retaining in Manual Queue.`);
        return {
          success: true,
          status: ApplicationStates.MANUAL_ACTION_REQUIRED,
          applicationMethod: 'career_site_form',
          reason: `Required fields need human input: ${missingRequired.slice(0, 3).join(', ')}`,
          directApplicationUrl: currentUrl,
          filledFields: fillResult.map(f => f.field),
          questionsAnswered
        };
      }

      // Step 7: Check if reviewBeforeSubmit is requested or user wants manual check
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

      // Step 8: Live Mode Submission
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
        directApplicationUrl: page.url(),
        questionsAnswered
      };
    }
  }
}

module.exports = CareerSiteBot;
