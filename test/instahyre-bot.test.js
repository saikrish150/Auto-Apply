const test = require('node:test');
const assert = require('node:assert/strict');
const InstahyreBot = require('../engine/instahyre-bot');
const { ApplicationStates } = require('../engine/state-machine');
const DataStore = require('../engine/data-store');
const fs = require('fs');
const path = require('path');

test('InstahyreBot - Curated Tech Platform 1-Click Apply Automation', async (t) => {
  const testDataDir = path.join(__dirname, '..', 'scratch', 'test_data_instahyre');
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDataDir, { recursive: true });

  const dataStore = new DataStore({ dataDir: testDataDir });

  await t.test('1. Initializes with proper defaults, platform name, and stop control', () => {
    const bot = new InstahyreBot(null, null, { search: { scenarios: ['Java Developer', 'Angular Developer'] } }, () => {}, dataStore);
    assert.equal(bot.platform, 'Instahyre');
    assert.equal(bot.shouldStop, false);
    assert.deepEqual(bot.getScenarios(), ['Java Developer', 'Angular Developer']);

    bot.stop();
    assert.equal(bot.shouldStop, true);
  });

  await t.test('2. Fallback to keywords when scenarios array is absent', () => {
    const bot = new InstahyreBot(null, null, { search: { keywords: 'Spring Boot Developer, Full Stack Developer' } }, () => {});
    const scenarios = bot.getScenarios();
    assert.deepEqual(scenarios, ['Spring Boot Developer', 'Full Stack Developer']);
  });

  await t.test('3. Detects Guest vs Logged-In Candidate Session accurately', async () => {
    const bot = new InstahyreBot(null, null, {}, () => {});

    // Mock guest page
    const guestPage = {
      cookies: async () => [],
      evaluate: async () => ({
        hasProfileDOM: false,
        hasLoginBtn: true,
        userName: null
      })
    };

    const guestSession = await bot.checkCandidateSession(guestPage);
    assert.equal(guestSession.isLoggedIn, false);

    // Mock logged-in candidate page
    const authPage = {
      cookies: async () => [{ name: 'ih_token', value: 'secret_candidate_jwt_token_12345' }],
      evaluate: async () => ({
        hasProfileDOM: true,
        hasLoginBtn: false,
        userName: 'Sai Krishna G'
      })
    };

    const authSession = await bot.checkCandidateSession(authPage);
    assert.equal(authSession.isLoggedIn, true);
    assert.equal(authSession.candidateName, 'Sai Krishna G');
  });

  await t.test('4. Correctly parses opportunity card DOM metadata', async () => {
    const bot = new InstahyreBot(null, null, {}, () => {});

    const mockCard = {};
    const mockPage = {
      evaluate: async (fn, el) => {
        return {
          company: 'PhonePe',
          title: 'Full Stack Engineer (Java & Angular)',
          location: 'Bengaluru, Hyderabad',
          skills: ['Java', 'Spring Boot', 'Angular', 'PostgreSQL', 'Microservices'],
          description: 'High scale fintech platform | 1-4 years experience | Java, Spring Boot, Angular',
          publicUrl: 'https://www.instahyre.com/job-289412-full-stack-engineer-at-phonepe-bengaluru/',
          jobId: 'instahyre-289412',
          isApplied: false,
          isDeclined: false
        };
      }
    };

    const data = await bot.extractCardData(mockPage, mockCard);
    assert.equal(data.company, 'PhonePe');
    assert.equal(data.title, 'Full Stack Engineer (Java & Angular)');
    assert.equal(data.jobId, 'instahyre-289412');
    assert.equal(data.isApplied, false);
    assert.ok(data.skills.includes('Java'));
    assert.ok(data.skills.includes('Angular'));
  });

  await t.test('5. Detects already-applied card status to prevent redundant applications', async () => {
    const bot = new InstahyreBot(null, null, {}, () => {});

    const mockAppliedCard = {};
    const mockPage = {
      evaluate: async (fn, el) => {
        return {
          company: 'Swiggy',
          title: 'Software Development Engineer',
          location: 'Bengaluru',
          skills: ['Java', 'Spring Boot'],
          description: '',
          publicUrl: 'https://www.instahyre.com/job-112233-sde-at-swiggy/',
          jobId: 'instahyre-112233',
          isApplied: true,
          isDeclined: false
        };
      }
    };

    const data = await bot.extractCardData(mockPage, mockAppliedCard);
    assert.equal(data.isApplied, true);
  });

  await t.test('6. Executes 1-Click apply on opportunity card and confirms submission', async () => {
    const bot = new InstahyreBot(null, null, { disableDelays: true }, () => {});

    let cardClicked = false;
    let modalApplyClicked = false;

    const mockPage = {
      evaluate: async (fn, arg) => {
        const fnStr = fn.toString();
        if (fnStr.includes('btn-interested') || fnStr.includes('viewJobBtn')) {
          cardClicked = true;
          return { clicked: true, text: 'View job »' };
        }
        if (fnStr.includes('candidate-apply-modal') && fnStr.includes('applyBtn')) {
          modalApplyClicked = true;
          return { success: true, text: 'Apply' };
        }
        return {};
      }
    };

    const result = await bot.applyToCard(mockPage, {}, {
      company: 'Razorpay',
      title: 'Full Stack Developer',
      candidatePitch: '3 years in Java, Spring Boot, and Angular.'
    });

    assert.equal(result.success, true);
    assert.equal(result.appliedConfirmed, true);
    assert.equal(cardClicked, true);
    assert.equal(modalApplyClicked, true);
  });

  await t.test('7. Integrates with DataStore and persists confirmed Instahyre applications', () => {
    const instahyreJob = {
      id: 'instahyre-987654',
      platform: 'Instahyre',
      title: 'Senior Software Engineer (Java, Angular)',
      company: 'BrowserStack',
      location: 'Bengaluru / Remote',
      url: 'https://www.instahyre.com/job-987654-senior-software-engineer-at-browserstack/',
      matchScore: 92,
      status: ApplicationStates.APPLIED_CONFIRMED,
      appliedDate: new Date().toISOString(),
      notes: '1-Click Apply via Instahyre Curated Tech Flow'
    };

    const saved = dataStore.saveApplication(instahyreJob);
    assert.ok(saved);
    assert.equal(saved.platform, 'Instahyre');
    assert.equal(saved.normalizedStatus, ApplicationStates.APPLIED_CONFIRMED);

    const keys = dataStore.getProcessedKeys();
    assert.ok(keys.has('instahyre-987654'));
    assert.ok(keys.has('senior software engineer (java, angular)|browserstack'));

    const stats = dataStore.getTimeStats();
    assert.ok(stats.byPlatform.Instahyre >= 1);
  });
});
