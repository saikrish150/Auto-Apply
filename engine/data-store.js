const fs = require('fs');
const path = require('path');
const { StateMachine, ApplicationStates } = require('./state-machine');
const ManualQueueService = require('./manual-queue');
const RecruiterEmailsService = require('./recruiter-emails-service');

class DataStore {
  constructor(options = {}) {
    this.options = options;
    this.dataDir = options.dataDir || path.join(__dirname, '..', 'data');
    this.primaryFilePath = path.join(this.dataDir, 'applications.json');
    this.aliasFilePath = path.join(this.dataDir, 'data.json');
    this.rootDataFilePath = options.rootDataFilePath || (options.dataDir ? path.join(this.dataDir, 'root_data.json') : path.join(__dirname, '..', 'data.json'));

    this.manualQueue = options.manualQueueService || new ManualQueueService({ dataDir: this.dataDir });
    this.recruiterEmails = options.recruiterEmailsService || new RecruiterEmailsService({ dataDir: this.dataDir });
    this.linkedinOnlyManualQueue = options.linkedinOnlyManualQueue !== false;

    this.applications = [];
    this.summary = {
      totalApplications: 0,
      totalApplied: 0,
      today: 0,
      yesterday: 0,
      thisMonth: 0,
      previousMonth: 0,
      allTime: 0,
      manualQueuePending: 0,
      unverifiedSubmissions: 0,
      byPlatform: {
        LinkedIn: 0,
        Naukri: 0,
        Foundit: 0,
        'Career Website': 0
      },
      byStatus: {},
      lastUpdated: new Date().toISOString()
    };

    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      if (fs.existsSync(this.primaryFilePath)) {
        const raw = fs.readFileSync(this.primaryFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.applications = parsed;
        } else if (parsed && Array.isArray(parsed.applications)) {
          this.applications = parsed.applications;
        }
      } else if (fs.existsSync(this.aliasFilePath)) {
        const raw = fs.readFileSync(this.aliasFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.applications = parsed;
        } else if (parsed && Array.isArray(parsed.applications)) {
          this.applications = parsed.applications;
        }
      }

      this.recalculateSummary();
      this.persist();

      if (this.applications.length > 0 && this.recruiterEmails) {
        this.recruiterEmails.scanHistoricalApplications(this.applications);
      }
    } catch (err) {
      console.error('[DataStore] Initialization error:', err.message);
    }
  }

  getDateBoundaries() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
    const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    return {
      now,
      startOfToday,
      endOfToday,
      startOfYesterday,
      endOfYesterday,
      startOfThisMonth,
      startOfPrevMonth,
      endOfPrevMonth
    };
  }

  // Recalculate summary metrics with verified application state machine
  recalculateSummary() {
    const {
      startOfToday,
      endOfToday,
      startOfYesterday,
      endOfYesterday,
      startOfThisMonth,
      startOfPrevMonth,
      endOfPrevMonth
    } = this.getDateBoundaries();

    let appliedCount = 0;
    let todayCount = 0;
    let yesterdayCount = 0;
    let thisMonthCount = 0;
    let prevMonthCount = 0;
    let manualQueuePending = 0;
    let unverifiedSubmissions = 0;

    const byPlatform = { LinkedIn: 0, Naukri: 0, Foundit: 0, 'Career Website': 0 };
    const byStatus = {};

    for (const app of this.applications) {
      const appDate = new Date(app.appliedAt || app.timestamp || Date.now());
      const normalizedStatus = StateMachine.normalizeStatus(app.status);
      const isApplied = StateMachine.isConfirmedApplied(app.status);

      // Track status counts
      const statusKey = app.status || normalizedStatus;
      byStatus[statusKey] = (byStatus[statusKey] || 0) + 1;

      // Track platform
      const plat = app.platform || 'Other';
      byPlatform[plat] = (byPlatform[plat] || 0) + 1;

      if (normalizedStatus === ApplicationStates.MANUAL_ACTION_REQUIRED) {
        manualQueuePending++;
      } else if (normalizedStatus === ApplicationStates.SUBMITTED_UNVERIFIED) {
        unverifiedSubmissions++;
      }

      if (isApplied) {
        appliedCount++;

        if (appDate >= startOfToday && appDate <= endOfToday) {
          todayCount++;
        }
        if (appDate >= startOfYesterday && appDate <= endOfYesterday) {
          yesterdayCount++;
        }
        if (appDate >= startOfThisMonth) {
          thisMonthCount++;
        }
        if (appDate >= startOfPrevMonth && appDate <= endOfPrevMonth) {
          prevMonthCount++;
        }
      }
    }

    // Include queue metrics from manual queue service
    const mqStats = this.manualQueue ? this.manualQueue.getStats() : { pendingCount: 0 };
    const effectiveManualPending = Math.max(manualQueuePending, mqStats.pendingCount);

    this.summary = {
      totalApplications: this.applications.length,
      totalApplied: appliedCount,
      today: todayCount,
      yesterday: yesterdayCount,
      thisMonth: thisMonthCount,
      previousMonth: prevMonthCount,
      allTime: appliedCount,
      manualQueuePending: effectiveManualPending,
      unverifiedSubmissions,
      byPlatform,
      byStatus,
      recruiterEmails: this.recruiterEmails ? this.recruiterEmails.getStats() : { totalEmails: 0, newCount: 0 },
      lastUpdated: new Date().toISOString()
    };
  }

  persist() {
    try {
      const payload = {
        summary: this.summary,
        applications: this.applications
      };
      const jsonStr = JSON.stringify(payload, null, 2);

      fs.writeFileSync(this.primaryFilePath, jsonStr, 'utf-8');
      fs.writeFileSync(this.aliasFilePath, jsonStr, 'utf-8');
      fs.writeFileSync(this.rootDataFilePath, jsonStr, 'utf-8');
    } catch (err) {
      console.error('[DataStore] Error writing to data files:', err.message);
    }
  }

  saveApplication(jobRecord) {
    if (!jobRecord) return null;

    const timestamp = jobRecord.appliedAt || jobRecord.timestamp || new Date().toISOString();
    const id = jobRecord.id || `app-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const normalizedStatus = StateMachine.normalizeStatus(jobRecord.status);
    const normalizedUrl = ManualQueueService.normalizeJobUrl(jobRecord.url || jobRecord.jobListingUrl);

    let questionsAnswered = [];
    if (Array.isArray(jobRecord.questionsAnswered)) {
      questionsAnswered = jobRecord.questionsAnswered.map(qa => ({
        question: qa.question || qa.q || '',
        answer: qa.answer !== undefined ? String(qa.answer) : '',
        inputType: qa.inputType || qa.type || 'text',
        source: qa.source || qa.engine || 'AI Engine',
        timestamp: qa.timestamp || timestamp
      }));
    }

    const normalizedRecord = {
      id,
      platform: jobRecord.platform || 'LinkedIn',
      title: jobRecord.title || 'Software Developer',
      company: jobRecord.company || 'Direct Employer',
      location: jobRecord.location || 'India',
      url: jobRecord.url || '',
      normalizedUrl,
      matchScore: jobRecord.overallFitScore || jobRecord.matchScore || 0,
      overallFitScore: jobRecord.overallFitScore || jobRecord.matchScore || 0,
      technicalScore: jobRecord.technicalScore || jobRecord.matchScore || 0,
      experienceCompatibility: jobRecord.experienceCompatibility || 'meets_required',
      status: jobRecord.status || normalizedStatus,
      normalizedStatus,
      skipReason: jobRecord.skipReason || null,
      appliedAt: timestamp,
      timestamp,
      directApplicationUrl: jobRecord.directApplicationUrl || '',
      applicationMethod: jobRecord.applicationMethod || (jobRecord.platform === 'Career Website' ? 'external_portal' : 'platform_auto'),
      questionsAnswered,
      evaluation: jobRecord.evaluation || null,
      scenario: jobRecord.scenario || null
    };

    // Robust deduplication based on ID or normalized URL or (title + company + platform)
    const existingIndex = this.applications.findIndex(a => {
      if (a.id && a.id === id) return true;
      if (normalizedUrl && a.normalizedUrl && a.normalizedUrl === normalizedUrl) return true;
      if (
        (a.title || '').toLowerCase() === normalizedRecord.title.toLowerCase() &&
        (a.company || '').toLowerCase() === normalizedRecord.company.toLowerCase() &&
        (a.platform || '').toLowerCase() === normalizedRecord.platform.toLowerCase()
      ) {
        return true;
      }
      return false;
    });

    if (existingIndex >= 0) {
      if (questionsAnswered.length > 0) {
        const mergedMap = new Map();
        (this.applications[existingIndex].questionsAnswered || []).forEach(q => mergedMap.set(q.question.toLowerCase(), q));
        questionsAnswered.forEach(q => mergedMap.set(q.question.toLowerCase(), q));
        normalizedRecord.questionsAnswered = Array.from(mergedMap.values());
      } else if (this.applications[existingIndex].questionsAnswered?.length > 0) {
        normalizedRecord.questionsAnswered = this.applications[existingIndex].questionsAnswered;
      }

      this.applications[existingIndex] = {
        ...this.applications[existingIndex],
        ...normalizedRecord
      };
    } else {
      this.applications.unshift(normalizedRecord);
    }

    // Auto-enqueue into Manual Apply Queue - strictly reserved for genuine LinkedIn external apply opportunities
    const isLinkedIn = (
      (jobRecord.platform || normalizedRecord.platform || '').toLowerCase().includes('linkedin') ||
      (jobRecord.sourcePlatform || '').toLowerCase().includes('linkedin') ||
      (jobRecord.url && String(jobRecord.url).includes('linkedin.com')) ||
      (normalizedRecord.url && String(normalizedRecord.url).includes('linkedin.com')) ||
      (jobRecord.jobListingUrl && String(jobRecord.jobListingUrl).includes('linkedin.com'))
    );

    // Filter seeing experience, ATS match, and junk scraping titles before enqueuing to manual queue
    const titleToCheck = String(jobRecord.title || normalizedRecord.title || '').trim();
    const isJunkTitle = /^(people you can reach out to|take the next step.*|about the job|\d+\s*notifications|notifications|unnamed job)$/i.test(titleToCheck) || titleToCheck.length < 3;

    const reqExpStr = String(jobRecord.requiredExperience || normalizedRecord.requiredExperience || jobRecord.experience || '').trim();
    let minExpYears = null;
    const expM = reqExpStr.match(/(\d+(?:\.\d+)?)/);
    if (expM) minExpYears = parseFloat(expM[1]);

    const expComp = String(jobRecord.experienceCompatibility || normalizedRecord.experienceCompatibility || (jobRecord.evaluation?.experienceCompatibility) || '').toLowerCase();
    const isMismatchedExp = expComp === 'below_mandatory' || (minExpYears !== null && minExpYears >= 5.0);
    const isLowMatch = (jobRecord.evaluation && jobRecord.evaluation.isRecommended === false && (jobRecord.evaluation.score || 0) < 55);

    if (this.linkedinOnlyManualQueue && !isLinkedIn && !jobRecord.isUserManualEntry) {
      // Strictly skip non-LinkedIn spam/agency jobs
    } else if ((isJunkTitle || isMismatchedExp || isLowMatch) && !jobRecord.isUserManualEntry) {
      // Strictly skip jobs with junk titles, mismatched experience (>4 yrs or below_mandatory), or very low ATS scores
    } else if (
      normalizedStatus === ApplicationStates.MANUAL_ACTION_REQUIRED ||
      jobRecord.status === 'MANUAL_ACTION_REQUIRED' ||
      jobRecord.status === 'already_applied_or_external' ||
      jobRecord.status === 'needs_manual_review' ||
      jobRecord.actionRequired ||
      jobRecord.applicationMethod === 'manual_shortlist' ||
      jobRecord.applicationMethod === 'login_walled_portal' ||
      jobRecord.applicationMethod === 'external_portal' ||
      jobRecord.externalUrl
    ) {
      if (this.manualQueue) {
        this.manualQueue.enqueue({
          ...normalizedRecord,
          sourcePlatform: isLinkedIn ? 'LinkedIn' : (normalizedRecord.platform || 'Direct'),
          platform: isLinkedIn ? 'LinkedIn' : (normalizedRecord.platform || 'Direct'),
          directApplyUrl: jobRecord.directApplicationUrl || jobRecord.directApplyUrl || jobRecord.externalUrl || normalizedRecord.directApplicationUrl || normalizedRecord.url,
          reason: jobRecord.skipReason || jobRecord.reason || (isLinkedIn ? 'LinkedIn external company career portal application required' : 'External career portal or manual action required')
        });
      }
    }

    if (this.applications.length > 1000) {
      this.applications = this.applications.slice(0, 1000);
    }

    this.recalculateSummary();
    this.persist();

    // Auto-scan for recruiter emails in job description or details
    const textToScan = [
      jobRecord.description,
      jobRecord.jobDescription,
      jobRecord.notes,
      jobRecord.reason,
      jobRecord.recruiterEmail
    ].filter(Boolean).join('\n');

    if (textToScan.trim() && this.recruiterEmails) {
      this.recruiterEmails.extractEmailsFromText(textToScan, {
        title: jobRecord.title,
        company: jobRecord.company,
        url: jobRecord.url || jobRecord.directApplicationUrl,
        platform: jobRecord.platform,
        recruiterName: jobRecord.recruiterName
      });
    }

    return normalizedRecord;
  }

  getApplications(filters = {}) {
    const { period = 'all', platform = 'all', status = 'all', search = '', limit = 200 } = filters;
    const {
      startOfToday,
      endOfToday,
      startOfYesterday,
      endOfYesterday,
      startOfThisMonth,
      startOfPrevMonth,
      endOfPrevMonth
    } = this.getDateBoundaries();

    return this.applications.filter(app => {
      const appDate = new Date(app.appliedAt || app.timestamp || Date.now());

      if (period === 'today') {
        if (appDate < startOfToday || appDate > endOfToday) return false;
      } else if (period === 'yesterday') {
        if (appDate < startOfYesterday || appDate > endOfYesterday) return false;
      } else if (period === 'this_month') {
        if (appDate < startOfThisMonth) return false;
      } else if (period === 'prev_month') {
        if (appDate < startOfPrevMonth || appDate > endOfPrevMonth) return false;
      }

      if (platform !== 'all' && (app.platform || '').toLowerCase() !== platform.toLowerCase()) {
        return false;
      }

      if (status !== 'all') {
        const norm = StateMachine.normalizeStatus(app.status);
        if (status === 'applied') {
          if (!StateMachine.isConfirmedApplied(app.status)) return false;
        } else if (status === 'manual_queue' || status === 'needs_review') {
          if (norm !== ApplicationStates.MANUAL_ACTION_REQUIRED) return false;
        } else if (status === 'skipped') {
          if (norm !== ApplicationStates.SKIPPED_LOW_MATCH) return false;
        } else if (status === 'failed') {
          if (norm !== ApplicationStates.FAILED_FINAL && norm !== ApplicationStates.FAILED_RETRYABLE) return false;
        } else if (status === 'already_applied') {
          if (norm !== ApplicationStates.ALREADY_APPLIED) return false;
        }
      }

      if (search) {
        const q = search.toLowerCase();
        const inTitle = (app.title || '').toLowerCase().includes(q);
        const inCompany = (app.company || '').toLowerCase().includes(q);
        const inPlatform = (app.platform || '').toLowerCase().includes(q);
        const inQuestions = (app.questionsAnswered || []).some(
          qa => (qa.question || '').toLowerCase().includes(q) || (qa.answer || '').toLowerCase().includes(q)
        );
        if (!inTitle && !inCompany && !inPlatform && !inQuestions) return false;
      }

      return true;
    }).slice(0, limit);
  }

  getTimeStats() {
    this.recalculateSummary();
    return this.summary;
  }

  // Returns a Set of normalized keys (URLs, job IDs, title|company) to prevent re-processing
  getProcessedKeys() {
    const keys = new Set();
    const genericTitles = new Set([
      'software developer|company',
      'software engineer|company',
      'developer|company',
      'engineer|company',
      '|'
    ]);

    for (const app of (this.applications || [])) {
      const st = String(app.status || app.normalizedStatus || '').toLowerCase();
      const isAppliedStatus = st.includes('applied') || st.includes('submitted') || st.includes('confirmed');
      if (!isAppliedStatus) continue;

      if (app.url) {
        const norm = ManualQueueService.normalizeJobUrl(app.url);
        if (norm) keys.add(norm);
        const match = norm.match(/\/jobs\/view\/(\d+)/);
        if (match) keys.add(match[1]);
      }
      if (app.title && app.company) {
        const combo = `${(app.title).toLowerCase().trim()}|${(app.company).toLowerCase().trim()}`;
        if (!genericTitles.has(combo)) {
          keys.add(combo);
        }
      }
    }
    if (this.manualQueue && Array.isArray(this.manualQueue.items)) {
      for (const item of this.manualQueue.items) {
        const u = item.normalizedListingUrl || item.jobListingUrl || item.url;
        if (u) {
          keys.add(u);
          const match = u.match(/\/jobs\/view\/(\d+)/);
          if (match) keys.add(match[1]);
        }
        if (item.title && item.company) {
          const combo = `${(item.title).toLowerCase().trim()}|${(item.company).toLowerCase().trim()}`;
          if (!genericTitles.has(combo)) {
            keys.add(combo);
          }
        }
      }
    }
    return keys;
  }

  getApplicationById(id) {
    return this.applications.find(a => a.id === id) || null;
  }

  clearHistory() {
    this.applications = [];
    this.recalculateSummary();
    this.persist();
    return { success: true };
  }
}

module.exports = DataStore;
