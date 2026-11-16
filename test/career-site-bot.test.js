const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const CareerSiteBot = require('../engine/career-site-bot');
const ProfileManager = require('../engine/profile-manager');

describe('CareerSiteBot - Autonomous Career Portal Form Automation', () => {
  const mockSettings = {
    automation: {
      reviewBeforeSubmit: false,
      autoSubmitCareerSites: true,
      minMatchScore: 65
    }
  };

  const mockAi = {
    profile: ProfileManager.normalizeProfile({
      personal: {
        fullName: 'Sai Krishna G',
        email: 'gsaikrishna150@gmail.com',
        phone: '+91 8688373517',
        phoneDigits: '8688373517',
        city: 'Hyderabad',
        state: 'Telangana',
        country: 'India',
        address: 'Anjaiah nagar, Gachibowli, Hyderabad, Telangana - 500032',
        postalCode: '500032',
        linkedInUrl: 'https://www.linkedin.com/in/saikrishnag150',
        portfolioUrl: 'https://gsaikrishna-portfolio.netlify.app/'
      },
      career: {
        currentCompany: 'Tech Mahindra',
        currentDesignation: 'Full Stack Developer',
        totalYearsExperience: 3,
        officialNoticePeriodDays: 30,
        currentSalaryLPA: 4.1,
        expectedSalaryLPA: 10.0
      },
      education: {
        degree: 'B.Tech in Electronics and Communication Engineering',
        institution: 'SRM Institute of Science and Technology',
        graduationYear: 2023,
        cgpa: '8.9 / 10'
      }
    }),
    answerScreeningQuestionAI: async (q) => ({ answer: 'Yes', source: 'Mock AI' })
  };

  test('Resolves candidate resume PDF path correctly from config or system', () => {
    const bot = new CareerSiteBot(null, mockAi, mockSettings, () => {});
    const resolvedPath = bot.resolveResumePath();
    assert.ok(resolvedPath, 'Resume path must be resolved');
    assert.ok(fs.existsSync(resolvedPath), 'Resolved resume PDF file must exist on disk');
  });

  test('Detects login-walled enterprise ATS systems (Workday, Taleo, iCIMS)', async () => {
    const bot = new CareerSiteBot(null, mockAi, mockSettings, () => {});

    // Mock page with Workday URL
    const workdayPage = {
      url: () => 'https://mycompany.myworkdayjobs.com/en-US/careers/job/1234'
    };
    const check1 = await bot.isLoginWalled(workdayPage);
    assert.strictEqual(check1.isWalled, true);
    assert.ok(check1.reason.includes('Enterprise ATS'));

    // Mock page with standard company careers URL
    const standardPage = {
      url: () => 'https://laddusystems.com/jobs/angular-developer/',
      evaluate: async () => false
    };
    const check2 = await bot.isLoginWalled(standardPage);
    assert.strictEqual(check2.isWalled, false);
  });

  test('Rejects non-job search result index pages without fake applying', async () => {
    const bot = new CareerSiteBot(null, mockAi, mockSettings, () => {});
    const searchResultPage = {
      url: () => 'https://www.naukri.com/jobs-in-hyderabad?keyword=angular',
      waitForNavigation: async () => {},
      evaluate: async () => {}
    };

    const result = await bot.applyToCareerPage(searchResultPage, { title: 'Angular Dev', company: 'Naukri' });
    assert.strictEqual(result.success, false);
    assert.ok(result.reason.includes('Search index URL'));
  });

  test('Verifies canonical profile baseline payload has all required candidate fields', () => {
    const canonical = ProfileManager.normalizeProfile(mockAi.profile);
    assert.strictEqual(canonical.personal.fullName, 'Sai Krishna G');
    assert.strictEqual(canonical.personal.email, 'gsaikrishna150@gmail.com');
    assert.strictEqual(canonical.personal.phoneDigits, '8688373517');
    assert.strictEqual(canonical.career.currentCompany, 'Tech Mahindra');
    assert.strictEqual(canonical.career.officialNoticePeriodDays, 30);
    assert.strictEqual(canonical.career.totalYearsExperience, 3);
    assert.strictEqual(canonical.education.graduationYear, 2023);
  });

  test('Resolves ATS portal credentials accurately from configuration', () => {
    const bot = new CareerSiteBot(null, mockAi, mockSettings, () => {});
    
    // Test Workday URL mapping
    const workdayCreds = bot.getCredentialsForUrl('https://ge.myworkdayjobs.com/en-US/GE_Careers/job/Engineer_123');
    assert.ok(workdayCreds, 'Workday credentials object should be returned');
    assert.strictEqual(workdayCreds.email, 'gsaikrishna150@gmail.com');
    assert.ok(workdayCreds.portalName.includes('Workday'));

    // Test Greenhouse URL mapping
    const ghCreds = bot.getCredentialsForUrl('https://boards.greenhouse.io/stripe/jobs/45678');
    assert.ok(ghCreds, 'Greenhouse credentials object should be returned');
    assert.strictEqual(ghCreds.email, 'gsaikrishna150@gmail.com');

    // Test Lever URL mapping
    const leverCreds = bot.getCredentialsForUrl('https://jobs.lever.co/netflix/98765');
    assert.ok(leverCreds, 'Lever credentials object should be returned');
    assert.strictEqual(leverCreds.email, 'gsaikrishna150@gmail.com');
  });

  test('Speed optimization: randomDelay scales down delays when speedMode is active', async () => {
    const fastSettings = {
      automation: {
        speedMode: 'turbo',
        humanDelayMinMs: 100,
        humanDelayMaxMs: 200
      }
    };
    const bot = new CareerSiteBot(null, mockAi, fastSettings, () => {});
    
    const start = Date.now();
    await bot.randomDelay(150, 300);
    const elapsed = Date.now() - start;

    // In turbo mode with factor 0.35, delay of 150-300ms should execute in ~100-250ms
    assert.ok(elapsed < 400, `Delay (${elapsed}ms) should be fast and under 400ms`);
  });

  test('ATS automated login: fills email and password and returns success status', async () => {
    const bot = new CareerSiteBot(null, mockAi, mockSettings, () => {});
    
    let filledForm = false;
    let clickedSubmit = false;

    const mockPage = {
      url: () => 'https://example.icims.com/login',
      evaluate: async (fn, ...args) => {
        if (args.length >= 2) {
          filledForm = true;
          return { found: true, filledEmail: true, filledPassword: true };
        }
        if (!clickedSubmit) {
          clickedSubmit = true;
          return { clicked: true, text: 'Sign In' };
        }
        return { stuck: false };
      }
    };

    const loginRes = await bot.attemptATSLogin(mockPage, {
      email: 'test@example.com',
      password: 'SamplePassword123!',
      portalName: 'iCIMS'
    });

    assert.strictEqual(loginRes.success, true);
    assert.strictEqual(filledForm, true);
    assert.strictEqual(clickedSubmit, true);
  });
});
