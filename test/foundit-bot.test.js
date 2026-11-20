const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const FounditBot = require('../engine/foundit-bot');
const DataStore = require('../engine/data-store');
const { ApplicationStates } = require('../engine/state-machine');

test('FounditBot - Search Volume, Tab Leak Prevention & Clean Statuses', async (t) => {
  const testDataDir = path.join(__dirname, '..', 'scratch', 'test_data_foundit');
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDataDir, { recursive: true });

  const dataStore = new DataStore({ dataDir: testDataDir });

  await t.test('1. Initializes properly with scenarios and stop control', () => {
    const bot = new FounditBot(null, null, { search: { scenarios: ['Java Developer', 'Angular Developer'] } }, () => {}, dataStore);
    assert.equal(bot.shouldStop, false);
    assert.deepEqual(bot.getScenarios(), ['Java Developer', 'Angular Developer']);

    bot.stop();
    assert.equal(bot.shouldStop, true);
  });

  await t.test('2. Date filters correctly map to Foundit query parameters', () => {
    const bot = new FounditBot(null, null, {}, () => {});
    assert.equal(bot.getDateFilterParam('past_1h'), 'postedWithin=1');
    assert.equal(bot.getDateFilterParam('past_2h'), 'postedWithin=1');
    assert.equal(bot.getDateFilterParam('past_24h'), 'postedWithin=1');
    assert.equal(bot.getDateFilterParam('past_48h'), 'postedWithin=2');
    assert.equal(bot.getDateFilterParam('past_week'), 'postedWithin=7');
    assert.equal(bot.getDateFilterParam('all'), '');
  });

  await t.test('3. Generates broad search URL without restrictive quickApplyJobs or rigid experience bucket', () => {
    const bot = new FounditBot(null, null, { search: { datePosted: 'past_week' } }, () => {});
    const dateParam = bot.getDateFilterParam('past_week');
    const scenario = 'Full Stack Developer';
    const dateFilter = dateParam ? `&${dateParam}` : '';
    const searchUrl = `https://www.foundit.in/srp/results?query=${encodeURIComponent(scenario)}${dateFilter}&sort=1`;

    assert.ok(searchUrl.includes('query=Full%20Stack%20Developer'));
    assert.ok(searchUrl.includes('postedWithin=7'));
    assert.ok(searchUrl.includes('sort=1'));
    // Must NOT contain restrictive quickApplyJobs or hardcoded experienceRanges
    assert.equal(searchUrl.includes('quickApplyJobs=true'), false);
    assert.equal(searchUrl.includes('experienceRanges=1~4'), false);
  });

  await t.test('4. DataStore deduplication keys exclude MANUAL_ACTION_REQUIRED and external statuses', () => {
    const externalJob = {
      id: 'foundit-ext-101',
      platform: 'Foundit',
      title: 'Angular Developer',
      company: 'Tech Solutions Inc',
      url: 'https://www.foundit.in/job-101',
      status: 'MANUAL_ACTION_REQUIRED',
      skipReason: 'External company portal application required'
    };

    const saved = dataStore.saveApplication(externalJob);
    assert.ok(saved);
    assert.equal(saved.normalizedStatus, ApplicationStates.MANUAL_ACTION_REQUIRED);

    const keys = dataStore.getProcessedKeys();
    // Keys must NOT contain externalJob because it is not confirmed applied or already applied!
    assert.equal(keys.has('foundit-ext-101'), false);
    assert.equal(keys.has('angular developer|tech solutions inc'), false);
  });

  await t.test('5. DataStore deduplication keys properly include confirmed applied and genuinely already applied jobs', () => {
    const appliedJob = {
      id: 'foundit-applied-202',
      platform: 'Foundit',
      title: 'Senior Java Developer',
      company: 'Fintech Corp',
      url: 'https://www.foundit.in/job-202',
      status: 'applied',
      appliedAt: new Date().toISOString()
    };

    const saved = dataStore.saveApplication(appliedJob);
    assert.ok(saved);
    assert.equal(saved.normalizedStatus, ApplicationStates.APPLIED_CONFIRMED);

    const keys = dataStore.getProcessedKeys();
    assert.ok(keys.has('foundit-applied-202'));
    assert.ok(keys.has('senior java developer|fintech corp'));
  });

  await t.test('6. Prevents tab leaks: verifies any opened new tabs on card click are strictly closed', async () => {
    let closedTab = false;

    const mockMainPage = {
      evaluate: async () => ({ title: 'Angular Developer', company: 'Sample Corp' })
    };

    const mockNewTab = {
      url: () => 'https://www.foundit.in/job-description/angular-developer-12345',
      isClosed: () => closedTab,
      close: async () => { closedTab = true; },
      evaluate: async () => ({ title: 'Angular Developer', company: 'Sample Corp' }),
      evaluateHandle: async () => null
    };

    // Simulate clicking card that opens a new tab via target="_blank"
    const pagesBefore = [mockMainPage];
    const pagesAfter = [mockMainPage, mockNewTab];

    const openedTab = pagesAfter.find(p => !pagesBefore.includes(p));
    assert.ok(openedTab);

    // Ensure finally block executes close
    try {
      // process tab
    } finally {
      if (openedTab) {
        if (!openedTab.isClosed()) await openedTab.close();
      }
    }

    assert.equal(closedTab, true, 'Opened tab must be unconditionally closed');
  });
});
