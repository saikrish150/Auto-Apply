const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const DataStore = require('../engine/data-store');
const ManualQueueService = require('../engine/manual-queue');
const LinkedInBot = require('../engine/linkedin-bot');
const NaukriBot = require('../engine/naukri-bot');
const FounditBot = require('../engine/foundit-bot');
const { ApplicationStates } = require('../engine/state-machine');

test('Manual Shortlisting, Deduplication & Ultra-Fresh Time Filters', async (t) => {
  const testDataDir = path.join(__dirname, '..', 'scratch', 'test_data_shortlist');
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDataDir, { recursive: true });

  const manualQueue = new ManualQueueService({ dataDir: testDataDir });
  const dataStore = new DataStore({ dataDir: testDataDir, manualQueueService: manualQueue });

  await t.test('LinkedInBot supports ultra-fresh past_1h and past_2h filters with DD sort', () => {
    const bot = new LinkedInBot(null, null, {}, () => {});
    assert.equal(bot.getDateFilterParam('past_1h'), 'f_TPR=r3600&sortBy=DD');
    assert.equal(bot.getDateFilterParam('past_2h'), 'f_TPR=r7200&sortBy=DD');
    assert.equal(bot.getDateFilterParam('past_24h'), 'f_TPR=r86400&sortBy=DD');
    assert.equal(bot.getDateFilterParam('past_48h'), 'f_TPR=r172800&sortBy=DD');
    assert.equal(bot.getDateFilterParam('past_week'), 'f_TPR=r604800&sortBy=DD');
    assert.equal(bot.getDateFilterParam('all'), 'sortBy=DD');

    // Experience filters
    assert.equal(bot.getExperienceFilterParam('entry'), 'f_E=2');
    assert.equal(bot.getExperienceFilterParam('associate'), 'f_E=3');
    assert.equal(bot.getExperienceFilterParam('Mid-Senior level (1-4 years)'), 'f_E=2,3');
    assert.equal(bot.getExperienceFilterParam('all'), '');
  });

  await t.test('NaukriBot supports ultra-fresh past_1h and past_2h with freshness and date sort', () => {
    const bot = new NaukriBot(null, null, {}, () => {});
    assert.equal(bot.getDateFilterParam('past_1h'), 'freshness=1&sortBy=date');
    assert.equal(bot.getDateFilterParam('past_2h'), 'freshness=1&sortBy=date');
    assert.equal(bot.getDateFilterParam('past_24h'), 'freshness=1&sortBy=date');
    assert.equal(bot.getDateFilterParam('past_48h'), 'freshness=2&sortBy=date');
    assert.equal(bot.getDateFilterParam('all'), 'sortBy=date');

    // Experience filters
    assert.equal(bot.getExperienceParam('1-4 years'), 'experience=1');
    assert.equal(bot.getExperienceParam('2-4 years'), 'experience=2');
    assert.equal(bot.getExperienceParam(''), 'experience=2');
    assert.equal(bot.getExperienceParam('all'), '');
  });

  await t.test('FounditBot supports ultra-fresh past_1h and past_2h filters', () => {
    const bot = new FounditBot(null, null, {}, () => {});
    assert.equal(bot.getDateFilterParam('past_1h'), 'postedWithin=1');
    assert.equal(bot.getDateFilterParam('past_2h'), 'postedWithin=1');
    assert.equal(bot.getDateFilterParam('past_24h'), 'postedWithin=1');
    assert.equal(bot.getDateFilterParam('past_48h'), 'postedWithin=2');
  });

  await t.test('DataStore auto-enqueues shortlisted normal jobs into Manual Apply Queue', () => {
    const shortlistedJob = {
      id: 'li-shortlist-12345',
      platform: 'LinkedIn',
      title: 'Full Stack Java & Angular Engineer',
      company: 'Cognizant Technology Solutions',
      location: 'Hyderabad, India',
      url: 'https://www.linkedin.com/jobs/view/41987654321',
      directApplicationUrl: 'https://careers.cognizant.com/global/en/job/12345',
      matchScore: 88,
      status: 'MANUAL_ACTION_REQUIRED',
      actionRequired: true,
      applicationMethod: 'manual_shortlist',
      reason: 'High match (88%) - Shortlisted normal job application for manual submission'
    };

    const saved = dataStore.saveApplication(shortlistedJob);
    assert.ok(saved);
    assert.equal(saved.normalizedStatus, ApplicationStates.MANUAL_ACTION_REQUIRED);

    // Verify automatically enqueued into ManualQueueService
    assert.equal(manualQueue.items.length, 1);
    const mqItem = manualQueue.items[0];
    assert.equal(mqItem.title, 'Full Stack Java & Angular Engineer');
    assert.equal(mqItem.company, 'Cognizant Technology Solutions');
    assert.equal(mqItem.overallFitScore, 88);
    assert.equal(mqItem.directApplyUrl, 'https://careers.cognizant.com/global/en/job/12345');
    assert.equal(mqItem.applicationMethod, 'manual_shortlist');
  });

  await t.test('DataStore generates processed keys for $O(1)$ pre-click deduplication', () => {
    const keys = dataStore.getProcessedKeys();
    assert.ok(keys instanceof Set);
    assert.ok(keys.has('full stack java & angular engineer|cognizant technology solutions'));
    assert.ok(keys.has('41987654321'));
    assert.ok(keys.has('https://www.linkedin.com/jobs/view/41987654321'));
  });

  await t.test('Strict Manual Queue isolation: Naukri external jobs excluded, LinkedIn jobs admitted', () => {
    const naukriJob = {
      id: 'nk-manual-998877',
      platform: 'Naukri',
      title: 'Lead Full Stack Developer',
      company: 'Infosys Limited',
      location: 'Hyderabad',
      url: 'https://www.naukri.com/job-listings-lead-full-stack-developer-infosys-998877',
      directApplicationUrl: 'https://www.naukri.com/job-listings-lead-full-stack-developer-infosys-998877',
      matchScore: 82,
      status: 'MANUAL_ACTION_REQUIRED',
      actionRequired: true,
      applicationMethod: 'naukri_manual_detail',
      reason: 'High match (82%) on Naukri'
    };

    dataStore.saveApplication(naukriJob);
    // When linkedinOnlyManualQueue is active, Naukri job must NOT be enqueued into manual queue
    assert.equal(manualQueue.items.length, 1, 'Manual queue should still have only 1 item (LinkedIn job from previous test)');
    const nkItem = manualQueue.items.find(i => i.company === 'Infosys Limited');
    assert.equal(nkItem, undefined, 'Naukri job must NOT exist in manual queue');

    // But a high-match LinkedIn external job MUST enter the manual queue
    const linkedInExternalJob = {
      id: 'li-manual-554433',
      platform: 'LinkedIn',
      title: 'Full Stack Engineer (Java & Angular)',
      company: 'Atlassian',
      location: 'Bengaluru / Remote',
      url: 'https://www.linkedin.com/jobs/view/5544332211',
      directApplicationUrl: 'https://careers.atlassian.com/jobs/554433',
      matchScore: 94,
      status: 'MANUAL_ACTION_REQUIRED',
      actionRequired: true,
      applicationMethod: 'manual_shortlist',
      reason: 'High match (94%) on LinkedIn external apply'
    };
    dataStore.saveApplication(linkedInExternalJob);
    assert.equal(manualQueue.items.length, 2, 'LinkedIn external job must be added to manual queue');
    const liItem = manualQueue.items.find(i => i.company === 'Atlassian');
    assert.ok(liItem, 'LinkedIn external job must exist in manual queue');
    assert.equal(liItem.overallFitScore, 94);
  });
});
