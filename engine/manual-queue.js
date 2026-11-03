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
    this.linkedinOnlyManualQueue = options.linkedinOnlyManualQueue !== false;

    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      if (fs.existsSync(this.filePath)) {
        let raw = fs.readFileSync(this.filePath, 'utf-8');
        if (raw && raw.charCodeAt(0) === 0xFEFF) {
          raw = raw.slice(1);
        }
        const parsed = JSON.parse(raw.trim());
        if (Array.isArray(parsed)) {
          this.items = parsed;
        } else if (parsed && Array.isArray(parsed.items)) {
          this.items = parsed.items;
        }

        // Prune legacy records exceeding 0-4 years or with fewer than 2 matched skills
        const initialCount = this.items.length;
        this.items = this.items.filter(item => {
          const req = String(item.requiredExperience || '').trim();
          const m = req.match(/(\d+(?:\.\d+)?)/);
          const minYears = m ? parseFloat(m[1]) : null;
          const isSenior = /\b(?:senior|lead|sr\.?|architect|principal|staff|director|vp|head)\b/i.test(item.title);
          if (minYears !== null && minYears > 4.0) return false;
          if (isSenior && minYears !== null && minYears > 3.0) return false;
          if (isSenior && minYears === null) return false;
          if (!Array.isArray(item.matchedSkills) || item.matchedSkills.length < 2) return false;
          return true;
        });
        if (this.items.length !== initialCount) {
          this.persist();
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
   * Robust timestamp resolution from multiple candidate fields and IDs
   */
  static getItemTimestamp(item) {
    if (!item) return 0;
    const parse = (v) => {
      if (!v) return 0;
      if (typeof v === 'number') return v;
      const t = new Date(v).getTime();
      return isNaN(t) ? 0 : t;
    };

    let ts = parse(item.discoveryTimestamp);
    if (ts > 0) return ts;

    ts = parse(item.timestamp);
    if (ts > 0) return ts;

    ts = parse(item.addedAt);
    if (ts > 0) return ts;

    ts = parse(item.lastVerifiedTimestamp);
    if (ts > 0) return ts;

    if (Array.isArray(item.auditTrail) && item.auditTrail.length > 0) {
      for (const a of item.auditTrail) {
        ts = parse(a.timestamp);
        if (ts > 0) return ts;
      }
    }

    if (item.id) {
      const m = String(item.id).match(/(\d{13})/);
      if (m) {
        const num = parseInt(m[1], 10);
        if (num > 1500000000000) return num;
      }
    }

    return 0;
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
    const isLinkedIn = Boolean(
      platform.toLowerCase().includes('linkedin') ||
      (jobData.url && String(jobData.url).includes('linkedin.com')) ||
      (jobData.jobListingUrl && String(jobData.jobListingUrl).includes('linkedin.com'))
    );
    const existingIndex = this.items.findIndex(item => {
      if (jobData.id && item.id === jobData.id) return true;
      if (normUrl && item.normalizedListingUrl && normUrl === item.normalizedListingUrl) return true;
      return (
        item.title.toLowerCase() === title.toLowerCase() &&
        item.company.toLowerCase() === company.toLowerCase() &&
        (item.sourcePlatform.toLowerCase() === platform.toLowerCase() || (item.sourcePlatform && platform === 'Direct'))
      );
    });

    const isExistingLinkedIn = existingIndex >= 0 && (this.items[existingIndex].sourcePlatform || '').toLowerCase().includes('linkedin');

    if (this.linkedinOnlyManualQueue && !isLinkedIn && !isExistingLinkedIn && !jobData.isUserManualEntry) {
      return null;
    }

    // Reject junk scraping artifact titles
    const isJunkTitle = /^(people you can reach out to|take the next step.*|about the job|\d+\s*notifications|notifications|unnamed job)$/i.test(title) || title.length < 3;
    if (isJunkTitle && !jobData.isUserManualEntry) {
      return null;
    }

    // Filter experience: strictly enforce 0-3 or 0-4 years maximum
    const reqExp = String(jobData.requiredExperience || jobData.experienceRequiredRange || jobData.experience || jobData.experienceRange || '').trim();
    let minExp = null;
    const expRangeMatch = reqExp.match(/(\d+(?:\.\d+)?)\s*(?:-|to|\+)\s*(\d+(?:\.\d+)?)?/);
    if (expRangeMatch) {
      minExp = parseFloat(expRangeMatch[1]);
    } else {
      const expMatch = reqExp.match(/(\d+(?:\.\d+)?)/);
      if (expMatch) minExp = parseFloat(expMatch[1]);
    }

    const isExecOrArch = /\b(?:architect|principal|staff|director|vp|head)\b/i.test(title);
    const expComp = String(jobData.experienceCompatibility || (jobData.evaluation?.experienceCompatibility) || '').toLowerCase();

    // Reject if minimum experience exceeds 4.0 years, or if executive/architect, or below_mandatory
    const isMismatchedExp = expComp === 'below_mandatory' ||
                            isExecOrArch ||
                            (minExp !== null && minExp > 4.0);

    if (existingIndex < 0 && isMismatchedExp && !jobData.isUserManualEntry) {
      return null;
    }

    // Match skills against candidate core competencies (require at least 2 matching skills)
    let matchedSkills = Array.isArray(jobData.matchedSkills) ? jobData.matchedSkills.filter(Boolean) : (jobData.evaluation?.matchedSkills || []);

    if (matchedSkills.length === 0) {
      const textToSearch = `${title} ${jobData.description || ''} ${(jobData.tags || []).join(' ')} ${(jobData.skills || []).join(' ')}`.toLowerCase();
      const coreSkillsMap = [
        { name: 'Angular', pattern: /\bangular\b/i },
        { name: 'Java', pattern: /\bjava\b/i },
        { name: 'Spring Boot', pattern: /\bspring\s*boot\b/i },
        { name: 'Spring MVC', pattern: /\bspring\s*mvc\b/i },
        { name: 'Microservices', pattern: /\bmicroservices?\b/i },
        { name: 'REST APIs', pattern: /\b(?:rest|restful|api|apis)\b/i },
        { name: 'PostgreSQL', pattern: /\b(?:postgresql|postgres|sql)\b/i },
        { name: 'TypeScript', pattern: /\b(?:typescript|ts)\b/i },
        { name: 'JavaScript', pattern: /\b(?:javascript|js)\b/i },
        { name: 'Frontend', pattern: /\b(?:frontend|front\s*end|ui|web)\b/i },
        { name: 'Docker', pattern: /\bdocker\b/i }
      ];
      for (const cs of coreSkillsMap) {
        if (cs.pattern.test(textToSearch)) {
          matchedSkills.push(cs.name);
        }
      }
    }

    // If updating an existing item that already has matched skills, retain them
    if (existingIndex >= 0 && matchedSkills.length < 2 && this.items[existingIndex].matchedSkills) {
      matchedSkills = this.items[existingIndex].matchedSkills;
    }

    // Strictly enforce minimum 2 matching candidate skills for new entries
    if (existingIndex < 0 && matchedSkills.length < 2 && !jobData.isUserManualEntry) {
      return null;
    }

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
      matchedSkills: matchedSkills.length > 0 ? matchedSkills : (jobData.matchedSkills || ['Angular', 'Java']),
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
      experience = 'all',
      search = ''
    } = filters;

    let filtered = this.items.filter(item => {
      const itemFit = item.overallFitScore || item.overallScore || item.matchScore || 0;
      const itemTech = item.technicalScore || itemFit;

      if (itemFit < minFitScore) return false;
      if (itemTech < minTechScore) return false;

      if (platform !== 'all') {
        const itemPlatform = (item.sourcePlatform || item.platform || '').toLowerCase();
        if (itemPlatform !== platform.toLowerCase()) return false;
      }

      if (status !== 'all') {
        const itemStatus = (item.status || '').toUpperCase();
        if (status === 'pending' && itemStatus !== ApplicationStates.MANUAL_ACTION_REQUIRED) return false;
        if (status === 'applied' && itemStatus !== ApplicationStates.APPLIED_CONFIRMED && itemStatus !== 'APPLIED') return false;
        if (status === 'not_interested' && itemStatus !== 'NOT_INTERESTED') return false;
        if (status === 'expired' && itemStatus !== ApplicationStates.CLOSED_OR_EXPIRED) return false;
      }

      if (method !== 'all') {
        const itemMethod = (item.applicationMethod || '').toLowerCase();
        if (itemMethod !== method.toLowerCase()) return false;
      }

      if (experience && experience !== 'all') {
        const itemExpComp = (item.experienceCompatibility || '').toLowerCase();
        const itemReqExp = (item.requiredExperience || '').toLowerCase();
        let minYears = null;
        const m = itemReqExp.match(/(\d+(?:\.\d+)?)/);
        if (m) minYears = parseFloat(m[1]);

        if (experience === 'compatible' || experience === 'matches_experience') {
          // Strictly match candidate experience (0-3 or 0-4 years maximum)
          if (itemExpComp === 'below_mandatory') return false;
          if (minYears !== null && minYears > 4.0) return false;
          const isItemSenior = /\b(?:senior|lead|sr\.?|architect|principal|staff|director|vp|head)\b/i.test(item.title);
          if (isItemSenior && minYears !== null && minYears > 3.0) return false;
          if (isItemSenior && minYears === null) return false;
        } else if (experience === 'meets_required') {
          if (itemExpComp !== 'meets_required') return false;
        } else if (experience === 'compatible_adjacent') {
          if (itemExpComp !== 'compatible_adjacent') return false;
        } else if (experience === 'senior') {
          if (itemExpComp !== 'below_mandatory' && (minYears === null || minYears <= 4.0)) return false;
        }
      }

      // Ensure minimum 2 matched skills
      if (Array.isArray(item.matchedSkills) && item.matchedSkills.length < 2) {
        return false;
      }

      if (search) {
        const q = search.toLowerCase();
        const inTitle = (item.title || '').toLowerCase().includes(q);
        const inCompany = (item.company || '').toLowerCase().includes(q);
        const inSkills = Array.isArray(item.matchedSkills) && item.matchedSkills.some(s => s && String(s).toLowerCase().includes(q));
        const inLocation = (item.location || '').toLowerCase().includes(q);
        if (!inTitle && !inCompany && !inSkills && !inLocation) return false;
      }

      return true;
    });

    // Sorting
    filtered.sort((a, b) => {
      const fitA = a.overallFitScore || a.overallScore || a.matchScore || 0;
      const fitB = b.overallFitScore || b.overallScore || b.matchScore || 0;
      const techA = a.technicalScore || fitA;
      const techB = b.technicalScore || fitB;
      const timeA = ManualQueueService.getItemTimestamp(a);
      const timeB = ManualQueueService.getItemTimestamp(b);

      if (sort === 'newest' || sort === 'recently_added' || sort === 'date_desc' || sort === 'date') {
        if (timeA !== timeB) return timeB - timeA;
        return fitB - fitA;
      }
      if (sort === 'oldest' || sort === 'oldest_pending' || sort === 'date_asc') {
        if (timeA !== timeB) return timeA - timeB;
        return fitB - fitA;
      }
      if (sort === 'highest_fit') {
        if (fitA !== fitB) return fitB - fitA;
        return timeB - timeA;
      }
      if (sort === 'lowest_fit') {
        return fitA - fitB;
      }
      if (sort === 'highest_priority') {
        const pOrder = { HIGH: 3, high: 3, MEDIUM: 2, medium: 2, NORMAL: 1, normal: 1 };
        const pA = pOrder[a.priority] || 1;
        const pB = pOrder[b.priority] || 1;
        if (pA !== pB) return pB - pA;
        if (fitA !== fitB) return fitB - fitA;
        return timeB - timeA;
      }
      if (sort === 'highest_tech') {
        if (techA !== techB) return techB - techA;
        return fitB - fitA;
      }
      if (sort === 'company_asc') {
        return (a.company || '').localeCompare(b.company || '');
      }
      return (timeB - timeA) || (fitB - fitA);
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
