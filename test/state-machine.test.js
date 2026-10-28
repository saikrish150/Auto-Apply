const test = require('node:test');
const assert = require('node:assert/strict');
const { StateMachine, ApplicationStates } = require('../engine/state-machine');

test('StateMachine - Canonical Job & Application Lifecycle', async (t) => {
  await t.test('Enumerates all required canonical application states', () => {
    assert.equal(ApplicationStates.DISCOVERED, 'DISCOVERED');
    assert.equal(ApplicationStates.EVALUATED, 'EVALUATED');
    assert.equal(ApplicationStates.READY_FOR_AUTO_APPLY, 'READY_FOR_AUTO_APPLY');
    assert.equal(ApplicationStates.AUTO_APPLY_IN_PROGRESS, 'AUTO_APPLY_IN_PROGRESS');
    assert.equal(ApplicationStates.MANUAL_ACTION_REQUIRED, 'MANUAL_ACTION_REQUIRED');
    assert.equal(ApplicationStates.READY_TO_SUBMIT, 'READY_TO_SUBMIT');
    assert.equal(ApplicationStates.SUBMITTED_UNVERIFIED, 'SUBMITTED_UNVERIFIED');
    assert.equal(ApplicationStates.APPLIED_CONFIRMED, 'APPLIED_CONFIRMED');
    assert.equal(ApplicationStates.ALREADY_APPLIED, 'ALREADY_APPLIED');
    assert.equal(ApplicationStates.CLOSED_OR_EXPIRED, 'CLOSED_OR_EXPIRED');
    assert.equal(ApplicationStates.FAILED_RETRYABLE, 'FAILED_RETRYABLE');
    assert.equal(ApplicationStates.FAILED_FINAL, 'FAILED_FINAL');
  });

  await t.test('Allows legal sequential transitions', () => {
    // DISCOVERED -> EVALUATED
    assert.equal(StateMachine.canTransition(ApplicationStates.DISCOVERED, ApplicationStates.EVALUATED), true);
    
    // EVALUATED -> READY_FOR_AUTO_APPLY
    assert.equal(StateMachine.canTransition(ApplicationStates.EVALUATED, ApplicationStates.READY_FOR_AUTO_APPLY), true);

    // READY_FOR_AUTO_APPLY -> AUTO_APPLY_IN_PROGRESS
    assert.equal(StateMachine.canTransition(ApplicationStates.READY_FOR_AUTO_APPLY, ApplicationStates.AUTO_APPLY_IN_PROGRESS), true);

    // AUTO_APPLY_IN_PROGRESS -> APPLIED_CONFIRMED
    assert.equal(StateMachine.canTransition(ApplicationStates.AUTO_APPLY_IN_PROGRESS, ApplicationStates.APPLIED_CONFIRMED), true);

    // AUTO_APPLY_IN_PROGRESS -> MANUAL_ACTION_REQUIRED (e.g. login wall or external portal)
    assert.equal(StateMachine.canTransition(ApplicationStates.AUTO_APPLY_IN_PROGRESS, ApplicationStates.MANUAL_ACTION_REQUIRED), true);

    // MANUAL_ACTION_REQUIRED -> APPLIED_CONFIRMED (when user applies on website and confirms)
    assert.equal(StateMachine.canTransition(ApplicationStates.MANUAL_ACTION_REQUIRED, ApplicationStates.APPLIED_CONFIRMED), true);
  });

  await t.test('Rejects illegal transitions', () => {
    // DISCOVERED cannot jump directly to APPLIED_CONFIRMED without evaluation or processing
    assert.equal(StateMachine.canTransition(ApplicationStates.DISCOVERED, ApplicationStates.APPLIED_CONFIRMED), false);

    // CLOSED_OR_EXPIRED cannot jump to READY_FOR_AUTO_APPLY
    assert.equal(StateMachine.canTransition(ApplicationStates.CLOSED_OR_EXPIRED, ApplicationStates.READY_FOR_AUTO_APPLY), false);
  });

  await t.test('Normalizes legacy statuses accurately', () => {
    assert.equal(StateMachine.normalizeStatus('applied'), ApplicationStates.APPLIED_CONFIRMED);
    assert.equal(StateMachine.normalizeStatus('already_applied_or_closed'), ApplicationStates.ALREADY_APPLIED);
    assert.equal(StateMachine.normalizeStatus('already_applied_or_external'), ApplicationStates.MANUAL_ACTION_REQUIRED);
    assert.equal(StateMachine.normalizeStatus('failed_external_form'), ApplicationStates.MANUAL_ACTION_REQUIRED);
    assert.equal(StateMachine.normalizeStatus('failed_captcha'), ApplicationStates.MANUAL_ACTION_REQUIRED);
    assert.equal(StateMachine.normalizeStatus('skipped_low_match'), ApplicationStates.SKIPPED_LOW_MATCH);
    assert.equal(StateMachine.normalizeStatus('closed'), ApplicationStates.CLOSED_OR_EXPIRED);
  });

  await t.test('Correctly identifies confirmed applications and excludes non-applied states', () => {
    // CRITICAL: Fixing false 102 applied metric!
    assert.equal(StateMachine.isConfirmedApplied(ApplicationStates.APPLIED_CONFIRMED), true);
    assert.equal(StateMachine.isConfirmedApplied('applied'), true);

    assert.equal(StateMachine.isConfirmedApplied(ApplicationStates.ALREADY_APPLIED), false);
    assert.equal(StateMachine.isConfirmedApplied('already_applied_or_closed'), false);
    assert.equal(StateMachine.isConfirmedApplied(ApplicationStates.SUBMITTED_UNVERIFIED), false);
    assert.equal(StateMachine.isConfirmedApplied(ApplicationStates.MANUAL_ACTION_REQUIRED), false);
    assert.equal(StateMachine.isConfirmedApplied(ApplicationStates.FAILED_FINAL), false);
  });

  await t.test('Maintains transition audit record with metadata', () => {
    const record = {};
    const transition = StateMachine.transition(record, ApplicationStates.EVALUATED, {
      fromState: ApplicationStates.DISCOVERED,
      reason: 'Automated evaluation completed with score 88%',
      actor: 'system'
    });

    assert.equal(transition.success, true);
    assert.equal(record.status, ApplicationStates.EVALUATED);
    assert.ok(Array.isArray(record.auditTrail));
    assert.equal(record.auditTrail.length, 1);
    assert.equal(record.auditTrail[0].to, ApplicationStates.EVALUATED);
    assert.equal(record.auditTrail[0].actor, 'system');
  });
});
