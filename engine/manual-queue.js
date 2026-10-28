/**
 * High-Match Manual Application Queue Service
 * Preserves high-fit opportunities that require human intervention or external portal application.
 */

const fs = require('fs');
const path = require('path');
const { StateMachine, ApplicationStates } = require('./state-machine');

class ManualQueueService {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(__dirname, '..', 'data');
    this.filePath = path.join(this.dataDir, 'manual_queue.json');
    this.backupPath = path.join(this.dataDir, 'manual_queue.backup.json');
    this.items = [];
    this.onQueueChanged = null;

    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.items = parsed;
        } else if (parsed && Array.isArray(parsed.items)) {
          this.items = parsed.items;
        }
      }
    } catch (err) {
      console.error('[ManualQueueService] Init error:', err.message);
      this.items = [];
    }
  }

  persist() {
    try {
      const payload = {
        lastUpdated: new Date().toISOString(),
        totalItems: this.items.length,
        items: this.items
      };
      const jsonStr = JSON.stringify(payload, null, 2);
      fs.writeFileSync(this.filePath, jsonStr, 'utf-8');
    } catch (err) {
      console.error('[ManualQueueService] Persist error:', err.message);
    }
  }

  /**
   * Normalizes a URL for deduplication by stripping tracking parameters
   */
  static normalizeJobUrl(url = '') {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      parsed.hash = ''; // Remove fragment identifiers like #apply
      const trackingParams = [
        'trackingid', 'refid', 'utmsource', 'utmmedium', 'utmcampaign',
        'mid', 'sid', 'src', 'sp', 'session', 'sessionid', 'ref', 'gclid', 'fbclid'
      ];
      const cleanParams = new URLSearchParams();
      for (const [k, v] of parsed.searchParams.entries()) {
        const lowerK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!trackingParams.includes(lowerK)) {
          cleanParams.append(k, v);
        }
      }
      parsed.search = cleanParams.toString();
      let res = parsed.toString();
      if (res.endsWith('?')) res = res.slice(0, -1);
      return res;
    } catch (e) {
      return String(url).trim();
    }
  }

  /**
   * Adds or updates a job in the manual application queue
   */
  enqueue(jobData = {}) {
    if (!jobData) return null;

    const normUrl = ManualQueueService.normalizeJobUrl(jobData.url || jobData.jobListingUrl);
    const title = String(jobData.title || 'Software Developer').trim();
    const company = String(jobData.company || 'Direct Employer').trim();
    const platform = String(jobData.platform || jobData.sourcePlatform || 'Direct').trim();

    // Check for existing record
    const existingIndex = this.items.findIndex(item => {
      if (jobData.id && item.id === jobData.id) return true;
      if (normUrl && item.normalizedListingUrl && normUrl === item.normalizedListingUrl) return true;
      return (
        item.title.toLowerCase() === title.toLowerCase() &&
        item.company.toLowerCase() === company.toLowerCase() &&
        item.sourcePlatform.toLowerCase() === platform.toLowerCase()
      );
    });

    const now = new Date().toISOString();
    const overallFit = jobData.overallScore || jobData.overallFitScore || jobData.matchScore || jobData.score || 85;
    const techScore = jobData.technicalScore || Math.round(overallFit * 0.95);

    let priority = 'NORMAL';
    if (overallFit >= 85) priority = 'HIGH';
    else if (overallFit >= 70) priority = 'MEDIUM';

    const directUrl = jobData.directApplyUrl || jobData.directApplicationUrl || '';

    const queueItem = {
      id: jobData.id || `mq_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      priority,
      overallFitScore: overallFit,
      overallScore: overallFit,
      technicalScore: techScore,
      matchScore: overallFit, // legacy backwards compatibility
      title,
      company,
      location: jobData.location || 'India',
      workMode: jobData.workMode || 'Hybrid / Office',
      requiredExperience: jobData.requiredExperience || jobData.experienceRange || '1-4 years',
      experienceCompatibility: jobData.experienceCompatibility || 'meets_required',
      matchedSkills: Array.isArray(jobData.matchedSkills) ? jobData.matchedSkills : (jobData.evaluation?.matchedSkills || ['Angular', 'Java']),
      missingRequiredSkills: Array.isArray(jobData.missingRequiredSkills) ? jobData.missingRequiredSkills : (jobData.evaluation?.missingSkills || []),
      missingPreferredSkills: Array.isArray(jobData.missingPreferredSkills) ? jobData.missingPreferredSkills : [],
      sourcePlatform: platform,
      jobListingUrl: jobData.jobListingUrl || jobData.url || '',
      normalizedListingUrl: normUrl,
      directApplicationUrl: directUrl,
      directApplyUrl: directUrl,
      hasDirectApplicationUrl: !!directUrl,
      applicationMethod: jobData.applicationMethod || 'external_portal',
      reason: jobData.reason || 'External employer career site / complex application form requires manual action',
      status: ApplicationStates.MANUAL_ACTION_REQUIRED,
      discoveryTimestamp: jobData.discoveryTimestamp || now,
      lastVerifiedTimestamp: now,
      reminderTimestamp: jobData.reminderTimestamp || null,
      notes: jobData.notes || '',
      auditTrail: [
        StateMachine.createTransitionRecord({
          fromState: ApplicationStates.DISCOVERED,
          toState: ApplicationStates.MANUAL_ACTION_REQUIRED,
          actor: 'bot',
          reason: jobData.reason || 'Enqueued in Manual Apply Queue'
        })
      ]
    };

    if (existingIndex >= 0) {
      // Preserve user notes and prior transitions
      const existing = this.items[existingIndex];
      queueItem.notes = existing.notes || queueItem.notes;
      queueItem.auditTrail = [...(existing.auditTrail || []), ...queueItem.auditTrail];
      queueItem.discoveryTimestamp = existing.discoveryTimestamp;
      this.items[existingIndex] = { ...existing, ...queueItem, overallScore: overallFit, overallFitScore: overallFit };
      this.persist();
      return this.items[existingIndex];
    } else {
      this.items.unshift(queueItem);
    }

    this.persist();
    if (typeof this.onQueueChanged === 'function') {
      this.onQueueChanged(this.getStats());
    }

    return queueItem;
  }

  /**
   * Filters and sorts manual queue items
   */
  getQueue(filters = {}, sort = 'highest_fit', limit = 100) {
    const {
      minFitScore = 0,
      minTechScore = 0,
      platform = 'all',
      status = 'all',
      method = 'all',
      search = ''
    } = filters;

    let filtered = this.items.filter(item => {
      if (item.overallFitScore < minFitScore) return false;
      if (item.technicalScore < minTechScore) return false;

      if (platform !== 'all' && item.sourcePlatform.toLowerCase() !== platform.toLowerCase()) {
        return false;
      }

      if (status !== 'all') {
        if (status === 'pending' && item.status !== ApplicationStates.MANUAL_ACTION_REQUIRED) return false;
        if (status === 'applied' && item.status !== ApplicationStates.APPLIED_CONFIRMED) return false;
        if (status === 'not_interested' && item.status !== 'NOT_INTERESTED') return false;
        if (status === 'expired' && item.status !== ApplicationStates.CLOSED_OR_EXPIRED) return false;
      }

      if (method !== 'all' && item.applicationMethod.toLowerCase() !== method.toLowerCase()) {
        return false;
      }

      if (search) {
        const q = search.toLowerCase();
        const inTitle = item.title.toLowerCase().includes(q);
        const inCompany = item.company.toLowerCase().includes(q);
        const inSkills = item.matchedSkills.some(s => s.toLowerCase().includes(q));
        if (!inTitle && !inCompany && !inSkills) return false;
      }

      return true;
    });

    // Sorting
    filtered.sort((a, b) => {
      if (sort === 'highest_fit') {
        return b.overallFitScore - a.overallFitScore;
      }
      if (sort === 'highest_tech') {
        return b.technicalScore - a.technicalScore;
      }
      if (sort === 'newest') {
        return new Date(b.discoveryTimestamp) - new Date(a.discoveryTimestamp);
      }
      if (sort === 'oldest_pending') {
        return new Date(a.discoveryTimestamp) - new Date(b.discoveryTimestamp);
      }
      return 0;
    });

    return filtered.slice(0, limit);
  }

  /**
   * Marks a manual queue item as applied by the candidate
   */
  markApplied(jobId, { confirmationId = '', notes = '', appliedDate = null, isSelfReported = true } = {}) {
    const item = this.items.find(i => i.id === jobId);
    if (!item) return { success: false, error: 'Job not found in Manual Apply Queue' };

    const fromState = item.status;
    const toState = ApplicationStates.APPLIED_CONFIRMED;

    item.status = toState;
    item.appliedAt = appliedDate || new Date().toISOString();
    item.confirmationId = confirmationId || null;
    item.isSelfReported = isSelfReported;
    if (notes) {
      item.notes = item.notes ? `${item.notes}\n[Applied Note]: ${notes}` : notes;
    }

    item.auditTrail = item.auditTrail || [];
    const tr = StateMachine.createTransitionRecord({
      fromState,
      toState,
      actor: 'user',
      reason: isSelfReported ? 'Manually completed and marked by user' : 'Verified application submission',
      evidence: { confirmationId, appliedDate }
    });
    tr.action = 'marked_applied';
    item.auditTrail.push(tr);

    this.persist();
    if (typeof this.onQueueChanged === 'function') {
      this.onQueueChanged(this.getStats());
    }

    return {
      success: true,
      item,
      id: item.id,
      status: item.status,
      confirmationId: item.confirmationId,
      appliedAt: item.appliedAt,
      history: item.auditTrail,
      auditTrail: item.auditTrail
    };
  }

  /**
   * Updates status (e.g. NOT_INTERESTED, CLOSED_OR_EXPIRED, REMIND_LATER)
   */
  updateStatus(jobId, newStatus, reason = '') {
    const item = this.items.find(i => i.id === jobId);
    if (!item) return { success: false, error: 'Job not found' };

    const fromState = item.status;
    item.status = newStatus;
    item.auditTrail = item.auditTrail || [];
    item.auditTrail.push(
      StateMachine.createTransitionRecord({
        fromState,
        toState: newStatus,
        actor: 'user',
        reason: reason || `User updated status to ${newStatus}`
      })
    );

    this.persist();
    if (typeof this.onQueueChanged === 'function') {
      this.onQueueChanged(this.getStats());
    }

    return { success: true, item };
  }

  /**
   * Updates user notes on a queue item
   */
  updateNotes(jobId, notes = '') {
    const item = this.items.find(i => i.id === jobId);
    if (!item) return { success: false, error: 'Job not found' };

    item.notes = notes;
    this.persist();
    return { success: true, item };
  }

  getStats() {
    let pendingCount = 0;
    let highPriorityCount = 0;
    let appliedCount = 0;
    let notInterestedCount = 0;

    for (const item of this.items) {
      if (item.status === ApplicationStates.MANUAL_ACTION_REQUIRED) {
        pendingCount++;
        if (item.priority === 'HIGH' || item.priority === 'high' || item.overallFitScore >= 85) {
          highPriorityCount++;
        }
      } else if (item.status === ApplicationStates.APPLIED_CONFIRMED) {
        appliedCount++;
      } else if (item.status === 'NOT_INTERESTED') {
        notInterestedCount++;
      }
    }

    return {
      total: this.items.length,
      pending: pendingCount,
      pendingCount,
      highPriorityCount,
      applied: appliedCount,
      appliedCount,
      notInterestedCount
    };
  }
}

module.exports = ManualQueueService;
