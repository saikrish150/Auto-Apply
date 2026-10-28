/**
 * Canonical Job & Application State Machine
 * Defines valid lifecycle states, legal transitions, and transition auditing.
 */

const ApplicationStates = Object.freeze({
  DISCOVERED: 'DISCOVERED',
  EVALUATED: 'EVALUATED',
  SKIPPED_LOW_MATCH: 'SKIPPED_LOW_MATCH',
  INELIGIBLE: 'INELIGIBLE',
  READY_FOR_AUTO_APPLY: 'READY_FOR_AUTO_APPLY',
  AUTO_APPLY_IN_PROGRESS: 'AUTO_APPLY_IN_PROGRESS',
  MANUAL_ACTION_REQUIRED: 'MANUAL_ACTION_REQUIRED',
  READY_TO_SUBMIT: 'READY_TO_SUBMIT',
  SUBMITTED_UNVERIFIED: 'SUBMITTED_UNVERIFIED',
  APPLIED_CONFIRMED: 'APPLIED_CONFIRMED',
  ALREADY_APPLIED: 'ALREADY_APPLIED',
  CLOSED_OR_EXPIRED: 'CLOSED_OR_EXPIRED',
  FAILED_RETRYABLE: 'FAILED_RETRYABLE',
  FAILED_FINAL: 'FAILED_FINAL'
});

// Legal state transitions mapping
const LegalTransitions = {
  [ApplicationStates.DISCOVERED]: [
    ApplicationStates.EVALUATED,
    ApplicationStates.ALREADY_APPLIED,
    ApplicationStates.CLOSED_OR_EXPIRED,
    ApplicationStates.MANUAL_ACTION_REQUIRED
  ],
  [ApplicationStates.EVALUATED]: [
    ApplicationStates.SKIPPED_LOW_MATCH,
    ApplicationStates.INELIGIBLE,
    ApplicationStates.READY_FOR_AUTO_APPLY,
    ApplicationStates.MANUAL_ACTION_REQUIRED,
    ApplicationStates.ALREADY_APPLIED,
    ApplicationStates.CLOSED_OR_EXPIRED
  ],
  [ApplicationStates.SKIPPED_LOW_MATCH]: [
    ApplicationStates.MANUAL_ACTION_REQUIRED, // User can manually promote if interested
    ApplicationStates.CLOSED_OR_EXPIRED
  ],
  [ApplicationStates.INELIGIBLE]: [
    ApplicationStates.CLOSED_OR_EXPIRED
  ],
  [ApplicationStates.READY_FOR_AUTO_APPLY]: [
    ApplicationStates.AUTO_APPLY_IN_PROGRESS,
    ApplicationStates.MANUAL_ACTION_REQUIRED,
    ApplicationStates.ALREADY_APPLIED,
    ApplicationStates.CLOSED_OR_EXPIRED
  ],
  [ApplicationStates.AUTO_APPLY_IN_PROGRESS]: [
    ApplicationStates.READY_TO_SUBMIT,
    ApplicationStates.SUBMITTED_UNVERIFIED,
    ApplicationStates.APPLIED_CONFIRMED,
    ApplicationStates.MANUAL_ACTION_REQUIRED, // If CAPTCHA, complex form, or login wall encountered
    ApplicationStates.FAILED_RETRYABLE,
    ApplicationStates.FAILED_FINAL,
    ApplicationStates.ALREADY_APPLIED,
    ApplicationStates.CLOSED_OR_EXPIRED
  ],
  [ApplicationStates.READY_TO_SUBMIT]: [
    ApplicationStates.SUBMITTED_UNVERIFIED,
    ApplicationStates.APPLIED_CONFIRMED,
    ApplicationStates.MANUAL_ACTION_REQUIRED,
    ApplicationStates.FAILED_RETRYABLE,
    ApplicationStates.FAILED_FINAL
  ],
  [ApplicationStates.MANUAL_ACTION_REQUIRED]: [
    ApplicationStates.APPLIED_CONFIRMED,
    ApplicationStates.SUBMITTED_UNVERIFIED,
    ApplicationStates.CLOSED_OR_EXPIRED,
    ApplicationStates.ALREADY_APPLIED
  ],
  [ApplicationStates.SUBMITTED_UNVERIFIED]: [
    ApplicationStates.APPLIED_CONFIRMED,
    ApplicationStates.FAILED_FINAL,
    ApplicationStates.MANUAL_ACTION_REQUIRED
  ],
  [ApplicationStates.FAILED_RETRYABLE]: [
    ApplicationStates.AUTO_APPLY_IN_PROGRESS,
    ApplicationStates.MANUAL_ACTION_REQUIRED,
    ApplicationStates.FAILED_FINAL
  ],
  [ApplicationStates.APPLIED_CONFIRMED]: [],
  [ApplicationStates.ALREADY_APPLIED]: [],
  [ApplicationStates.CLOSED_OR_EXPIRED]: [],
  [ApplicationStates.FAILED_FINAL]: [
    ApplicationStates.MANUAL_ACTION_REQUIRED // User override allowed
  ]
};

// Legacy status adapter mapping for backwards compatibility with historical data
const LegacyStatusMap = {
  'applied': ApplicationStates.APPLIED_CONFIRMED,
  'applied (simulated)': ApplicationStates.APPLIED_CONFIRMED,
  'applied (career website)': ApplicationStates.SUBMITTED_UNVERIFIED,
  'applied (company portal)': ApplicationStates.SUBMITTED_UNVERIFIED,
  'needs_manual_review': ApplicationStates.MANUAL_ACTION_REQUIRED,
  'ready_for_review': ApplicationStates.MANUAL_ACTION_REQUIRED,
  'already_applied_or_closed': ApplicationStates.ALREADY_APPLIED,
  'already_applied_or_external': ApplicationStates.MANUAL_ACTION_REQUIRED,
  'already_applied': ApplicationStates.ALREADY_APPLIED,
  'failed_captcha': ApplicationStates.MANUAL_ACTION_REQUIRED,
  'failed_external_form': ApplicationStates.MANUAL_ACTION_REQUIRED,
  'failed (captcha)': ApplicationStates.MANUAL_ACTION_REQUIRED,
  'failed (external site)': ApplicationStates.MANUAL_ACTION_REQUIRED,
  'skipped': ApplicationStates.SKIPPED_LOW_MATCH,
  'failed': ApplicationStates.FAILED_FINAL,
  'failed (employer site error)': ApplicationStates.FAILED_RETRYABLE,
  'error': ApplicationStates.FAILED_RETRYABLE
};

class StateMachine {
  static get states() {
    return ApplicationStates;
  }

  static normalizeStatus(status) {
    if (!status) return ApplicationStates.DISCOVERED;
    const upper = String(status).trim().toUpperCase();
    if (ApplicationStates[upper]) return ApplicationStates[upper];

    const lower = String(status).trim().toLowerCase();
    if (LegacyStatusMap[lower]) return LegacyStatusMap[lower];

    if (lower.includes('already') || lower.includes('applied_or_closed')) {
      return ApplicationStates.ALREADY_APPLIED;
    }
    if (lower.includes('captcha') || lower.includes('manual') || lower.includes('review') || lower.includes('external')) {
      return ApplicationStates.MANUAL_ACTION_REQUIRED;
    }
    if (lower.includes('applied')) {
      return ApplicationStates.APPLIED_CONFIRMED;
    }
    if (lower.includes('skip')) {
      return ApplicationStates.SKIPPED_LOW_MATCH;
    }
    if (lower.includes('close') || lower.includes('expire')) {
      return ApplicationStates.CLOSED_OR_EXPIRED;
    }
    if (lower.includes('fail') || lower.includes('error')) {
      return ApplicationStates.FAILED_FINAL;
    }

    return ApplicationStates.DISCOVERED;
  }

  static canTransition(fromState, toState) {
    const normFrom = this.normalizeStatus(fromState);
    const normTo = this.normalizeStatus(toState);
    if (normFrom === normTo) return true;

    const allowed = LegalTransitions[normFrom] || [];
    return allowed.includes(normTo);
  }

  static createTransitionRecord({ fromState, toState, actor = 'system', reason = '', evidence = null }) {
    const normFrom = this.normalizeStatus(fromState);
    const normTo = this.normalizeStatus(toState);
    const isLegal = this.canTransition(normFrom, normTo);

    return {
      transitionId: `tr-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString(),
      fromState: normFrom,
      from: normFrom,
      toState: normTo,
      to: normTo,
      isLegal,
      actor, // 'bot' | 'user' | 'system'
      reason: reason || `Transitioned from ${normFrom} to ${normTo}`,
      evidence: evidence || null
    };
  }

  /**
   * Performs an in-place state transition on an application record, appending to auditTrail
   */
  static transition(record = {}, toState, { fromState = null, actor = 'system', reason = '', evidence = null } = {}) {
    const currentStatus = fromState || record.status || ApplicationStates.DISCOVERED;
    const normTo = this.normalizeStatus(toState);
    const recordEntry = this.createTransitionRecord({
      fromState: currentStatus,
      toState: normTo,
      actor,
      reason,
      evidence
    });

    record.status = normTo;
    record.auditTrail = record.auditTrail || [];
    record.auditTrail.push(recordEntry);

    return {
      success: true,
      fromState: recordEntry.fromState,
      toState: normTo,
      isLegal: recordEntry.isLegal,
      transition: recordEntry
    };
  }

  /**
   * Helper to determine whether an application status represents an actual completed application.
   * Prevents already_applied, closed, skipped, or external portal referrals from inflating applied count.
   */
  static isConfirmedApplied(status) {
    const norm = this.normalizeStatus(status);
    return norm === ApplicationStates.APPLIED_CONFIRMED;
  }

  static isManualQueueItem(status) {
    const norm = this.normalizeStatus(status);
    return norm === ApplicationStates.MANUAL_ACTION_REQUIRED;
  }
}

module.exports = {
  ApplicationStates,
  LegalTransitions,
  LegacyStatusMap,
  StateMachine
};
