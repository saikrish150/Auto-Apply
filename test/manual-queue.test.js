const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ManualQueueService = require('../engine/manual-queue');
const { ApplicationStates } = require('../engine/state-machine');

test('ManualQueueService - High-Match Manual Application Queue', async (t) => {
  const testDataDir = path.join(__dirname, '..', 'scratch', 'test_data_mq');
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDataDir, { recursive: true });

  const queueService = new ManualQueueService({ dataDir: testDataDir });

  await t.test('Normalizes tracking URLs for robust deduplication', () => {
    const rawUrl1 = 'https://jobs.example.com/view/12345?utm_source=linkedin&utm_medium=jobsearch&refId=abc987#apply';
    const rawUrl2 = 'https://jobs.example.com/view/12345?session=xyz';
    
    const norm1 = ManualQueueService.normalizeJobUrl(rawUrl1);
    const norm2 = ManualQueueService.normalizeJobUrl(rawUrl2);

    assert.equal(norm1, 'https://jobs.example.com/view/12345');
    assert.equal(norm2, 'https://jobs.example.com/view/12345');
  });

  await t.test('Enqueues high-match external portal job with full metadata', () => {
    const item = queueService.enqueue({
      title: 'Senior Angular Developer',
      company: 'Acme Global Corp',
      location: 'Hyderabad, India',
      url: 'https://careers.acme.com/jobs/9981?utm_source=feed',
      directApplyUrl: 'https://careers.acme.com/jobs/9981/apply',
      platform: 'linkedin',
      overallScore: 88,
      technicalScore: 92,
      requiredExperience: '2-4 years',
      experienceCompatibility: 'meets_required',
      matchedSkills: ['Angular', 'TypeScript', 'HTML/CSS'],
      missingSkills: ['Jest'],
      reason: 'Requires submission on external Workday career portal'
    });

    assert.ok(item.id.startsWith('mq_'));
    assert.equal(item.company, 'Acme Global Corp');
    assert.equal(item.status, ApplicationStates.MANUAL_ACTION_REQUIRED);
    assert.equal(item.priority, 'HIGH');
    assert.equal(item.directApplyUrl, 'https://careers.acme.com/jobs/9981/apply');
    assert.equal(queueService.items.length, 1);
  });

  await t.test('Prevents duplicate entries and updates existing job record', () => {
    // Add identical URL with slightly different metadata
    const duplicate = queueService.enqueue({
      title: 'Senior Angular Developer - Updated',
      company: 'Acme Global Corp',
      url: 'https://careers.acme.com/jobs/9981?utm_medium=email',
      overallScore: 90
    });

    // Should NOT create second item in queue
    assert.equal(queueService.items.length, 1);
    assert.equal(queueService.items[0].overallScore, 90);
  });

  await t.test('Marks job as applied with confirmation ID, date, and audit trail', () => {
    const item = queueService.items[0];
    const updated = queueService.markApplied(item.id, {
      confirmationId: 'CONF-883921',
      notes: 'Submitted via Acme Workday portal successfully',
      appliedDate: '2026-10-28'
    });

    assert.ok(updated);
    assert.equal(updated.status, ApplicationStates.APPLIED_CONFIRMED);
    assert.equal(updated.confirmationId, 'CONF-883921');
    assert.ok(updated.history.some(h => h.action === 'marked_applied'));
  });

  await t.test('Computes accurate queue metrics', () => {
    const stats = queueService.getStats();
    assert.equal(stats.total, 1);
    assert.equal(stats.applied, 1);
    assert.equal(stats.pending, 0);
  });

  await t.test('Recovers data completely after restart (persistence check)', () => {
    // Instantiate new service pointing to same directory
    const reloadedService = new ManualQueueService({ dataDir: testDataDir });
    assert.equal(reloadedService.items.length, 1);
    assert.equal(reloadedService.items[0].company, 'Acme Global Corp');
    assert.equal(reloadedService.items[0].confirmationId, 'CONF-883921');
  });

  // Cleanup test data directory
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
});
