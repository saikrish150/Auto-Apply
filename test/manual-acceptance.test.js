const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ManualQueueService = require('../engine/manual-queue');
const MatchingEngine = require('../engine/matching-engine');
const ProfileManager = require('../engine/profile-manager');
const { StateMachine, ApplicationStates } = require('../engine/state-machine');

test('Phase 15: Manual Application Acceptance Scenario Verification', async (t) => {
  const scenarioDataDir = path.join(__dirname, '..', 'scratch', 'test_phase15_acceptance');
  if (fs.existsSync(scenarioDataDir)) {
    fs.rmSync(scenarioDataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(scenarioDataDir, { recursive: true });

  let queueService = new ManualQueueService({ dataDir: scenarioDataDir });
  const candidateProfile = ProfileManager.normalizeProfile({
    skills: [
      { name: 'Angular', years: 2.7, proficiency: 'Expert' },
      { name: 'Java', years: 2.7, proficiency: 'Advanced' },
      { name: 'Spring Boot', years: 2.5, proficiency: 'Advanced' },
      { name: 'TypeScript', years: 2.7, proficiency: 'Advanced' }
    ]
  });

  // 1 & 2: Discovered job & Match calculation
  const discoveredJob = {
    title: 'Senior Angular & Java Engineer',
    company: 'Enterprise Cloud Technologies',
    location: 'Hyderabad, India',
    description: 'Looking for a skilled Angular & Java developer with 2-4 years experience to join our core cloud platform team.',
    jobListingUrl: 'https://careers.enterprisecloud.com/jobs/dev-8821?ref=linkedin_feed',
    directApplyUrl: 'https://careers.enterprisecloud.com/jobs/dev-8821/apply',
    sourcePlatform: 'linkedin'
  };

  const matchEvaluation = MatchingEngine.evaluate({
    title: discoveredJob.title,
    description: discoveredJob.description,
    company: discoveredJob.company,
    location: discoveredJob.location,
    profile: candidateProfile
  });

  await t.test('Step 1 & 2: Match is calculated correctly and exceeds threshold', () => {
    assert.ok(matchEvaluation.overallScore >= 75, `Expected score >= 75, got ${matchEvaluation.overallScore}`);
    assert.equal(matchEvaluation.experienceCompatibility, MatchingEngine.EXPERIENCE_CATEGORIES.MEETS_REQUIRED);
    assert.ok(matchEvaluation.matchedSkills.includes('Angular'));
    assert.ok(matchEvaluation.matchedSkills.includes('Java'));
  });

  // 3, 4, 5: Persisted, external application method detected, enters Manual Apply Queue
  let enqueuedItem = null;
  await t.test('Step 3, 4, 5: External application detected, persisted in Manual Queue', () => {
    enqueuedItem = queueService.enqueue({
      title: discoveredJob.title,
      company: discoveredJob.company,
      location: discoveredJob.location,
      jobListingUrl: discoveredJob.jobListingUrl,
      directApplicationUrl: discoveredJob.directApplyUrl,
      sourcePlatform: discoveredJob.sourcePlatform,
      overallFitScore: matchEvaluation.overallScore,
      technicalScore: matchEvaluation.technicalScore,
      requiredExperience: matchEvaluation.experienceRequiredRange,
      experienceCompatibility: matchEvaluation.experienceCompatibility,
      matchedSkills: matchEvaluation.matchedSkills,
      missingRequiredSkills: matchEvaluation.missingRequiredSkills,
      applicationMethod: 'external_portal',
      reason: 'Requires external submission on Enterprise Cloud career portal (Workday/custom)'
    });

    assert.ok(enqueuedItem);
    assert.equal(enqueuedItem.status, ApplicationStates.MANUAL_ACTION_REQUIRED);
    assert.ok(enqueuedItem.priority === 'HIGH' || enqueuedItem.priority === 'MEDIUM');
    assert.equal(enqueuedItem.directApplicationUrl, 'https://careers.enterprisecloud.com/jobs/dev-8821/apply');
    assert.equal(queueService.items.length, 1);
  });

  // 6 & 7: Dashboard metadata & correct URLs
  await t.test('Step 6 & 7: Correct metadata, score, and verified direct URLs', () => {
    const queue = queueService.getQueue({ status: ApplicationStates.MANUAL_ACTION_REQUIRED });
    assert.equal(queue.length, 1);
    const item = queue[0];
    assert.equal(item.company, 'Enterprise Cloud Technologies');
    assert.ok(item.overallFitScore >= 75);
    assert.ok(item.reason.includes('Enterprise Cloud career portal'));
    assert.equal(item.directApplicationUrl, 'https://careers.enterprisecloud.com/jobs/dev-8821/apply');
  });

  // 8: User marks application as completed
  await t.test('Step 8: User marks application as completed with confirmation ID and notes', () => {
    const markResult = queueService.markApplied(enqueuedItem.id, {
      confirmationId: 'REQ-2026-CLOUD-991',
      notes: 'Applied directly via company career website, uploaded resume and filled work history.',
      appliedDate: '2026-10-28T22:30:00Z',
      isSelfReported: true
    });

    assert.equal(markResult.success, true);
    assert.equal(markResult.status, ApplicationStates.APPLIED_CONFIRMED);
    assert.equal(markResult.confirmationId, 'REQ-2026-CLOUD-991');
  });

  // 9: Persistence across simulated server restart
  await t.test('Step 9: State persists accurately across restart', () => {
    const reloadedService = new ManualQueueService({ dataDir: scenarioDataDir });
    assert.equal(reloadedService.items.length, 1);
    const reloadedItem = reloadedService.items[0];
    assert.equal(reloadedItem.status, ApplicationStates.APPLIED_CONFIRMED);
    assert.equal(reloadedItem.confirmationId, 'REQ-2026-CLOUD-991');
    assert.ok(reloadedItem.notes.includes('REQ-2026-CLOUD-991') || reloadedItem.notes.includes('Applied directly'));
  });

  // 10: Not counted as an automatically submitted application
  await t.test('Step 10: Manual application is distinguished from auto-applied bots', () => {
    const item = queueService.items[0];
    assert.equal(item.isSelfReported, true);
    assert.equal(item.applicationMethod, 'external_portal');
    assert.notEqual(item.applicationMethod, 'auto_easy_apply');
  });

  // 11: Rediscovery does not create duplicate
  await t.test('Step 11: Rediscovery does not duplicate the job record', () => {
    queueService.enqueue({
      title: discoveredJob.title,
      company: discoveredJob.company,
      jobListingUrl: 'https://careers.enterprisecloud.com/jobs/dev-8821?ref=email_digest',
      overallFitScore: matchEvaluation.overallScore
    });

    assert.equal(queueService.items.length, 1);
    assert.equal(queueService.items[0].confirmationId, 'REQ-2026-CLOUD-991');
  });

  // 12: Audit history records state transitions
  await t.test('Step 12: Audit trail records complete state transition history', () => {
    const item = queueService.items[0];
    assert.ok(Array.isArray(item.auditTrail));
    assert.ok(item.auditTrail.length >= 2);
    
    // First: DISCOVERED -> MANUAL_ACTION_REQUIRED
    assert.equal(item.auditTrail[0].toState, ApplicationStates.MANUAL_ACTION_REQUIRED);
    
    // Second: MANUAL_ACTION_REQUIRED -> APPLIED_CONFIRMED
    assert.equal(item.auditTrail[1].toState, ApplicationStates.APPLIED_CONFIRMED);
    assert.equal(item.auditTrail[1].actor, 'user');
    assert.equal(item.auditTrail[1].evidence.confirmationId, 'REQ-2026-CLOUD-991');
  });

  // Cleanup
  if (fs.existsSync(scenarioDataDir)) {
    fs.rmSync(scenarioDataDir, { recursive: true, force: true });
  }
});
