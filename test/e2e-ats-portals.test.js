/**
 * End-to-End Test Suite: External ATS Automated Login & Submission Flows
 * Tests 4 realistic, production-like scenarios:
 * 1. Workday (Login wall bypass -> Auto-login with credentials -> Multi-step application -> Submit -> Confirmed)
 * 2. Greenhouse (Direct ATS form -> Resume upload -> Candidate info -> Screening Q&A -> Submit -> Confirmed)
 * 3. Lever (Apply Now button -> Autofill links & experience -> Resume upload -> Submit -> Confirmed)
 * 4. Enterprise iCIMS / Taleo (Account wall -> Universal credential auto-login -> Questionnaire -> Confirmed)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const CareerSiteBot = require('../engine/career-site-bot');
const AIAgent = require('../engine/ai-agent');
const ProfileManager = require('../engine/profile-manager');
const { ApplicationStates } = require('../engine/state-machine');

describe('E2E ATS Portals - Automated Login & Submission Verification', () => {
  const profile = require('../config/profile.json');
  const settings = require('../config/settings.json');
  const ai = new AIAgent(profile, settings);

  const testSettings = {
    automation: {
      reviewBeforeSubmit: false,
      autoSubmitCareerSites: true,
      closeCareerTabAfterSubmit: false,
      speedMode: 'turbo',
      humanDelayMinMs: 30,
      humanDelayMaxMs: 60
    }
  };

  const logs = [];
  const mockLogger = (level, tag, msg) => {
    logs.push({ level, tag, msg, time: new Date().toISOString() });
  };

  test('Scenario 1: Workday ATS — Detects login wall, auto-logs in with Saikrishna1@, fills form, uploads resume & submits', async () => {
    const bot = new CareerSiteBot(null, ai, testSettings, mockLogger);

    let loginAttempted = false;
    let loginSubmitted = false;
    let postLoginLanded = false;
    let resumeUploaded = false;
    let formSubmitted = false;

    const candidateCreds = bot.getCredentialsForUrl('https://ge.myworkdayjobs.com/en-US/GE_Careers/job/Full-Stack-Java-Developer_R10293');
    assert.ok(candidateCreds, 'Should resolve credentials for Workday');
    assert.strictEqual(candidateCreds.email, 'gsaikrishna150@gmail.com');
    assert.strictEqual(candidateCreds.password, 'Saikrishna1@');

    const mockWorkdayPage = {
      _currentUrl: 'https://ge.myworkdayjobs.com/en-US/GE_Careers/job/Full-Stack-Java-Developer_R10293',
      url() { return this._currentUrl; },
      async waitForNavigation() {},
      async $$() {
        return [{
          uploadFile: async (filePath) => {
            assert.ok(fs.existsSync(filePath), 'Resume PDF must exist on disk');
            resumeUploaded = true;
          },
          evaluate: async () => ({ label: 'resume', id: 'resume', name: 'resume', parentText: 'resume' })
        }];
      },
      async evaluate(fn, ...args) {
        const fnStr = fn.toString();

        // A. Form fill for login (2 string args: candEmail, candPassword)
        if (args.length === 2 && typeof args[0] === 'string' && typeof args[1] === 'string') {
          assert.strictEqual(args[0], 'gsaikrishna150@gmail.com');
          assert.strictEqual(args[1], 'Saikrishna1@');
          loginAttempted = true;
          return { found: true, filledEmail: true, filledPassword: true };
        }

        // B. Form autofill for candidate details (1 object arg: cand)
        if (args.length === 1 && typeof args[0] === 'object' && args[0].fullName) {
          return [
            { field: 'Full Name', val: 'Sai Krishna G' },
            { field: 'Email', val: 'gsaikrishna150@gmail.com' },
            { field: 'Mobile Phone', val: '8688373517' },
            { field: 'Current Company', val: 'Tech Mahindra' },
            { field: 'Total Experience', val: '3' },
            { field: 'Notice Period', val: '30' },
            { field: 'Work Authorization', val: 'Yes' },
            { field: 'Visa Sponsorship', val: 'No' },
            { field: 'Willing to Relocate', val: 'Yes' }
          ];
        }

        // C. readyState check
        if (fnStr.includes('readyState')) return 'complete';

        // D. scanPageForRecruiterEmails
        if (fnStr.includes('mailtoLinks')) {
          return { bodyText: 'HR Contact: careers@ge.com', mailtoLinks: ['careers@ge.com'] };
        }

        // E. Workday pre-click ("adventureButton")
        if (fnStr.includes('adventureButton')) {
          return true;
        }

        // F. Click Sign In submit button in attemptATSLogin
        if (fnStr.includes('prioritySelectors') || fnStr.includes('signInSubmitButton')) {
          loginSubmitted = true;
          postLoginLanded = true;
          this._currentUrl = 'https://ge.myworkdayjobs.com/en-US/GE_Careers/apply/step1';
          return { clicked: true, text: 'Sign In' };
        }

        // G. Stuck check in attemptATSLogin
        if (fnStr.includes('password') && fnStr.includes('stuck')) {
          return { stuck: false };
        }

        // H. detectAndOpenForm
        if (fnStr.includes('visibleInputs') || fnStr.includes('apply for this job')) {
          return true;
        }

        // I. Missing questions check
        if (fnStr.includes('missing.push') || fnStr.includes('missing = []')) {
          return [];
        }

        // J. Required inputs validation
        if (fnStr.includes('requiredInputs')) {
          return [];
        }

        // K. Submit application button click
        if (fnStr.includes('selectors') && fnStr.includes('app-submit')) {
          formSubmitted = true;
          return { clicked: true, text: 'Submit Application' };
        }

        // L. Confirmation verification
        if (fnStr.includes('application submitted') || fnStr.includes('alert-success')) {
          return {
            isSuccess: true,
            isError: false,
            msg: 'Thank you! Your application has been successfully submitted to GE Aerospace.'
          };
        }

        return null;
      }
    };

    const result = await bot.applyToCareerPage(mockWorkdayPage, {
      title: 'Full Stack Java Developer',
      company: 'GE Aerospace'
    });

    assert.strictEqual(loginAttempted, true, 'Workday automated login should be triggered');
    assert.strictEqual(loginSubmitted, true, 'Workday login credentials should be submitted');
    assert.strictEqual(postLoginLanded, true, 'Should successfully navigate past login wall');
    assert.strictEqual(resumeUploaded, true, 'Candidate resume PDF must be uploaded');
    assert.strictEqual(formSubmitted, true, 'Application submit button must be clicked');
    assert.strictEqual(result.success, true, 'Overall application must succeed');
    assert.strictEqual(result.status, ApplicationStates.APPLIED_CONFIRMED, 'Status must be APPLIED_CONFIRMED');
    assert.ok(result.filledFields.length >= 5, 'Should have filled candidate fields');
  });

  test('Scenario 2: Greenhouse ATS — Direct form filling, custom screening Q&A with AI, resume upload & submit', async () => {
    const bot = new CareerSiteBot(null, ai, testSettings, mockLogger);

    let resumeUploaded = false;
    let submitted = false;
    let customQuestionAnswered = false;

    const mockGreenhousePage = {
      _url: 'https://boards.greenhouse.io/stripe/jobs/7483920',
      url() { return this._url; },
      async waitForNavigation() {},
      async $$() {
        return [{
          uploadFile: async () => { resumeUploaded = true; },
          evaluate: async () => ({ label: 'resume', id: 'resume', name: 'resume', parentText: 'Attach resume' })
        }];
      },
      async evaluate(fn, ...args) {
        const fnStr = fn.toString();

        if (fnStr.includes('readyState')) return 'complete';
        if (fnStr.includes('mailtoLinks')) return { bodyText: '', mailtoLinks: [] };
        if (fnStr.includes('form[action*="login"]') || fnStr.includes('pwdInput')) return false; // Greenhouse is public form
        if (fnStr.includes('visibleInputs') || fnStr.includes('apply for this job')) return true;

        // Autofill standard candidate inputs
        if (args.length === 1 && typeof args[0] === 'object' && args[0].fullName) {
          return [
            { field: 'First Name', val: 'Sai Krishna' },
            { field: 'Last Name', val: 'G' },
            { field: 'Email', val: 'gsaikrishna150@gmail.com' },
            { field: 'Mobile Phone', val: '8688373517' },
            { field: 'LinkedIn URL', val: 'https://www.linkedin.com/in/saikrishnag150' },
            { field: 'GitHub URL', val: 'https://github.com/saikrish150' },
            { field: 'Portfolio', val: 'https://gsaikrishna-portfolio.netlify.app/' },
            { field: 'Terms & Privacy Consent', val: 'Checked (Agreed)' }
          ];
        }

        // Custom question: "How many years of experience do you have with Angular and TypeScript?"
        if (fnStr.includes('missing.push') || fnStr.includes('missing = []')) {
          return [{
            id: 'custom_question_angular_exp',
            name: 'question_102',
            question: 'How many years of experience do you have with Angular?',
            tagName: 'INPUT',
            type: 'text',
            required: true
          }];
        }

        // Answering the custom question
        if (args.length >= 2 && typeof args[1] === 'string') {
          customQuestionAnswered = true;
          assert.strictEqual(args[1], '3', 'AI should answer 3 years experience for Angular');
          return true;
        }

        if (fnStr.includes('requiredInputs')) return [];

        // Submit form
        if (fnStr.includes('selectors') && fnStr.includes('app-submit')) {
          submitted = true;
          return { clicked: true, text: 'Submit Application' };
        }

        // Greenhouse submission confirmation
        if (fnStr.includes('application submitted') || fnStr.includes('alert-success')) {
          return {
            isSuccess: true,
            isError: false,
            msg: 'Thank you for applying to Stripe! Your application has been received.'
          };
        }

        return null;
      }
    };

    const result = await bot.applyToCareerPage(mockGreenhousePage, {
      title: 'Senior Frontend Engineer - Angular',
      company: 'Stripe'
    });

    assert.strictEqual(resumeUploaded, true, 'Resume must be attached on Greenhouse');
    assert.strictEqual(customQuestionAnswered, true, 'Custom screening question must be answered');
    assert.strictEqual(submitted, true, 'Greenhouse submit button must be clicked');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, ApplicationStates.APPLIED_CONFIRMED);
  });

  test('Scenario 3: Lever ATS — Handles "Apply for this job" trigger, link fields, notice period & submission', async () => {
    const bot = new CareerSiteBot(null, ai, testSettings, mockLogger);

    let applyBtnClicked = false;
    let resumeUploaded = false;
    let formSubmitted = false;

    const mockLeverPage = {
      _url: 'https://jobs.lever.co/netflix/backend-engineer-4920',
      url() { return this._url; },
      async waitForNavigation() {},
      async $$() {
        return [{
          uploadFile: async () => { resumeUploaded = true; },
          evaluate: async () => ({ label: 'cv', id: 'resume-upload', name: 'resume', parentText: 'Attach resume file' })
        }];
      },
      async evaluate(fn, ...args) {
        const fnStr = fn.toString();

        if (fnStr.includes('readyState')) return 'complete';
        if (fnStr.includes('mailtoLinks')) return { bodyText: '', mailtoLinks: [] };
        if (fnStr.includes('form[action*="login"]') || fnStr.includes('pwdInput')) return false;

        // Lever initial view: clicks "Apply for this job" button to open inputs
        if (fnStr.includes('apply for this job') || fnStr.includes('postings-btn')) {
          applyBtnClicked = true;
          return true;
        }

        // Fill candidate details
        if (args.length === 1 && typeof args[0] === 'object' && args[0].fullName) {
          return [
            { field: 'Full Name', val: 'Sai Krishna G' },
            { field: 'Email', val: 'gsaikrishna150@gmail.com' },
            { field: 'Mobile Phone', val: '8688373517' },
            { field: 'Current Company', val: 'Tech Mahindra' },
            { field: 'LinkedIn URL', val: 'https://www.linkedin.com/in/saikrishnag150' },
            { field: 'GitHub URL', val: 'https://github.com/saikrish150' },
            { field: 'Total Experience', val: '3' },
            { field: 'Notice Period', val: '30' }
          ];
        }

        if (fnStr.includes('missing.push') || fnStr.includes('missing = []')) return [];
        if (fnStr.includes('requiredInputs')) return [];

        if (fnStr.includes('selectors') && fnStr.includes('app-submit')) {
          formSubmitted = true;
          return { clicked: true, text: 'Submit application' };
        }

        if (fnStr.includes('application submitted') || fnStr.includes('received your application')) {
          return {
            isSuccess: true,
            isError: false,
            msg: 'Application submitted! Thank you for your interest in Netflix.'
          };
        }

        return null;
      }
    };

    const result = await bot.applyToCareerPage(mockLeverPage, {
      title: 'Backend Engineer - Java / Spring Boot',
      company: 'Netflix'
    });

    assert.strictEqual(applyBtnClicked, true, 'Must click Apply button to reveal Lever form');
    assert.strictEqual(resumeUploaded, true, 'Resume must be attached');
    assert.strictEqual(formSubmitted, true, 'Must submit Lever application');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, ApplicationStates.APPLIED_CONFIRMED);
  });

  test('Scenario 4: Enterprise iCIMS / Taleo Account Wall — Auto-authenticates with Saikrishna1@ & confirms application', async () => {
    const bot = new CareerSiteBot(null, ai, testSettings, mockLogger);

    let loginFilled = false;
    let loginSubmitted = false;
    let submitted = false;

    const candidateCreds = bot.getCredentialsForUrl('https://careers-cognizant.icims.com/jobs/92819/login');
    assert.ok(candidateCreds, 'Should resolve credentials for iCIMS');
    assert.strictEqual(candidateCreds.email, 'gsaikrishna150@gmail.com');
    assert.strictEqual(candidateCreds.password, 'Saikrishna1@');

    const mockIcimsPage = {
      _url: 'https://careers-cognizant.icims.com/jobs/92819/login',
      url() { return this._url; },
      async waitForNavigation() {},
      async $$() {
        return [{
          uploadFile: async () => {},
          evaluate: async () => ({ label: 'resume', id: 'cv', name: 'cv', parentText: 'resume' })
        }];
      },
      async evaluate(fn, ...args) {
        const fnStr = fn.toString();

        // 1. Form fill for login (2 string args: candEmail, candPassword)
        if (args.length === 2 && typeof args[0] === 'string' && typeof args[1] === 'string') {
          assert.strictEqual(args[0], 'gsaikrishna150@gmail.com');
          assert.strictEqual(args[1], 'Saikrishna1@');
          loginFilled = true;
          return { found: true, filledEmail: true, filledPassword: true };
        }

        // 2. Candidate form fill (1 object arg: cand)
        if (args.length === 1 && typeof args[0] === 'object' && args[0].fullName) {
          return [
            { field: 'Full Name', val: 'Sai Krishna G' },
            { field: 'Email', val: 'gsaikrishna150@gmail.com' },
            { field: 'Mobile Phone', val: '8688373517' },
            { field: 'Notice Period', val: '30' }
          ];
        }

        if (fnStr.includes('readyState')) return 'complete';
        if (fnStr.includes('mailtoLinks')) return { bodyText: '', mailtoLinks: [] };

        // 3. Login submit click
        if (fnStr.includes('prioritySelectors') || fnStr.includes('signInSubmitButton')) {
          loginSubmitted = true;
          this._url = 'https://careers-cognizant.icims.com/jobs/92819/profile';
          return { clicked: true, text: 'Log In' };
        }

        // 4. Stuck check in attemptATSLogin
        if (fnStr.includes('password') && fnStr.includes('stuck')) {
          return { stuck: false };
        }

        // 5. detectAndOpenForm
        if (fnStr.includes('visibleInputs') || fnStr.includes('apply for this job')) return true;

        // 6. Missing questions
        if (fnStr.includes('missing.push') || fnStr.includes('missing = []')) return [];
        if (fnStr.includes('requiredInputs')) return [];

        // 7. Submit application profile
        if (fnStr.includes('selectors') && fnStr.includes('app-submit')) {
          submitted = true;
          return { clicked: true, text: 'Submit Profile' };
        }

        // 8. Confirmation
        if (fnStr.includes('application submitted') || fnStr.includes('alert-success')) {
          return {
            isSuccess: true,
            isError: false,
            msg: 'Profile submitted successfully to Cognizant.'
          };
        }

        return null;
      }
    };

    const result = await bot.applyToCareerPage(mockIcimsPage, {
      title: 'Full Stack Developer',
      company: 'Cognizant'
    });

    assert.strictEqual(loginFilled, true, 'Must fill candidate credentials');
    assert.strictEqual(loginSubmitted, true, 'Must submit login credentials');
    assert.strictEqual(submitted, true, 'Must submit application profile');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, ApplicationStates.APPLIED_CONFIRMED);
  });
});
