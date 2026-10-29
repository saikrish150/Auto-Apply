// AutoApply AI Client Controller

class AutoApplyApp {
  constructor() {
    window.app = this;
    this.ws = null;
    this.profile = null;
    this.settings = null;
    this.state = 'idle'; // idle | running | paused | stopped
    this.activeFilter = 'all';
    this.historyJobs = [];
    this.timeStats = null;
    this.selectedPeriod = 'all';
    this.selectedPlatform = 'all';
    this.selectedStatus = 'all';
    this.logs = [];
    this.qaAuditList = [];
    this.qaFilteredList = [];

    this.initDOM();
    this.bindEvents();
    this.connectWebSocket();
    this.loadInitialData();
  }

  initDOM() {
    // Header & Status
    this.chromeStatusDot = document.getElementById('chrome-status-dot');
    this.chromeStatusText = document.getElementById('chrome-status-text');
    this.botStatusDot = document.getElementById('bot-status-dot');
    this.botStatusText = document.getElementById('bot-status-text');
    this.btnLaunchChrome = document.getElementById('btn-launch-chrome');
    this.btnRelaunchChrome = document.getElementById('btn-relaunch-chrome');

    // Controls
    this.btnStart = document.getElementById('btn-start-bot');
    this.btnPause = document.getElementById('btn-pause-bot');
    this.btnStop = document.getElementById('btn-stop-bot');
    this.toggleSim = document.getElementById('toggle-sim-mode');
    this.toggleSemiAuto = document.getElementById('toggle-semi-auto');
    this.chipLinkedIn = document.getElementById('chip-linkedin');
    this.chipNaukri = document.getElementById('chip-naukri');
    this.chipFoundit = document.getElementById('chip-foundit');
    this.btnCareerAutofill = document.getElementById('btn-career-autofill');

    // Stats
    this.statApplied = document.getElementById('stat-applied');
    this.statTargetCap = document.getElementById('stat-target-cap');
    this.statProgressFill = document.getElementById('stat-progress-fill');
    this.statMatches = document.getElementById('stat-matches');
    this.statScore = document.getElementById('stat-score');
    this.statModeBadge = document.getElementById('stat-mode-badge');
    this.statSimSub = document.getElementById('stat-sim-sub');

    // Tabs
    this.tabButtons = document.querySelectorAll('.tab-btn');
    this.tabPanes = document.querySelectorAll('.tab-pane');

    // Monitor
    this.currentJobTitle = document.getElementById('current-job-title');
    this.currentJobCompany = document.getElementById('current-job-company');
    this.currentJobScore = document.getElementById('current-job-score');
    this.currentJobScoreBadge = document.getElementById('current-job-score-badge');
    this.currentJobPlatform = document.getElementById('current-job-platform');
    this.currentJobLocation = document.getElementById('current-job-location');
    this.currentJobReasoning = document.getElementById('current-job-reasoning');
    this.currentJobSkills = document.getElementById('current-job-skills');
    this.currentJobStatus = document.getElementById('current-job-status');
    this.currentJobLink = document.getElementById('current-job-link');

    // Terminal
    this.terminalLogs = document.getElementById('terminal-logs-container');
    this.btnClearLogs = document.getElementById('btn-clear-logs');
    this.toggleAutoscroll = document.getElementById('toggle-autoscroll');
    this.filterPills = document.querySelectorAll('.filter-pill');

    // History & Time Analytics
    this.historyTableBody = document.getElementById('history-table-body');
    this.historyBadgeCount = document.getElementById('history-badge-count');
    this.inputHistorySearch = document.getElementById('input-history-search');
    this.btnClearHistory = document.getElementById('btn-clear-history');
    this.btnRefreshHistory = document.getElementById('btn-refresh-history');

    this.timeStatToday = document.getElementById('time-stat-today');
    this.timeStatYesterday = document.getElementById('time-stat-yesterday');
    this.timeStatThisMonth = document.getElementById('time-stat-this-month');
    this.timeStatPrevMonth = document.getElementById('time-stat-prev-month');
    this.timeStatAllTime = document.getElementById('time-stat-all-time');
    this.timeMetricCards = document.querySelectorAll('.time-metric-card');
    this.historyPeriodPills = document.querySelectorAll('.history-period-pill');
    this.historyFilterPlatform = document.getElementById('history-filter-platform');
    this.historyFilterStatus = document.getElementById('history-filter-status');

    // Screening Q&A Details Modal
    this.qaDetailsModal = document.getElementById('qa-details-modal');
    this.modalQaPlatform = document.getElementById('modal-qa-platform');
    this.modalQaTitle = document.getElementById('modal-qa-title');
    this.modalQaCompany = document.getElementById('modal-qa-company');
    this.modalQaStatus = document.getElementById('modal-qa-status');
    this.modalQaScore = document.getElementById('modal-qa-score');
    this.modalQaTime = document.getElementById('modal-qa-time');
    this.modalQaLink = document.getElementById('modal-qa-link');
    this.modalQaLinkContainer = document.getElementById('modal-qa-link-container');
    this.modalQaCount = document.getElementById('modal-qa-count');
    this.modalQaList = document.getElementById('modal-qa-list');
    this.btnCloseQaModal = document.getElementById('btn-close-qa-modal');
    this.btnCloseQaModalFooter = document.getElementById('btn-close-qa-modal-footer');

    // Profile Form
    this.btnSaveProfile = document.getElementById('btn-save-profile');
    this.skillsContainer = document.getElementById('skills-list-container');
    this.btnAddSkill = document.getElementById('btn-add-skill');

    // AI Tester
    this.testQuestionInput = document.getElementById('test-question-input');
    this.btnTestAiAnswer = document.getElementById('btn-test-ai-answer');
    this.testAnswerText = document.getElementById('test-answer-text');
    this.testAnswerSource = document.getElementById('test-answer-source');
    this.activeRulesList = document.getElementById('active-rules-list');

    // Settings Form
    this.btnSaveSettings = document.getElementById('btn-save-settings');
    this.rangeMinScore = document.getElementById('sett-minScore');
    this.rangeMinScoreVal = document.getElementById('sett-minScore-val');
    this.selectDatePosted = document.getElementById('sett-datePosted');
    this.inputMaxPages = document.getElementById('sett-maxPages');
    this.inputScenarios = document.getElementById('sett-scenarios');

    // AI Configuration & Status
    this.inputGeminiKey = document.getElementById('sett-gemini-key');
    this.btnSaveAiKey = document.getElementById('btn-save-ai-key');
    this.aiStatusBadge = document.getElementById('ai-status-badge');
    this.aiTesterBadge = document.getElementById('ai-tester-badge');
    this.aiStatStatus = document.getElementById('ai-stat-status');
    this.testAnswerEngine = document.getElementById('test-answer-engine');

    // Q&A Audit & Learning Controls
    this.qaBadgeCount = document.getElementById('qa-badge-count');
    this.qaStatTotal = document.getElementById('qa-stat-total');
    this.qaStatGemini = document.getElementById('qa-stat-gemini');
    this.qaStatLocal = document.getElementById('qa-stat-local');
    this.qaStatRules = document.getElementById('qa-stat-rules');
    this.qaSearchInput = document.getElementById('qa-search-input');
    this.qaFilterPlatform = document.getElementById('qa-filter-platform');
    this.qaFilterEngine = document.getElementById('qa-filter-engine');
    this.qaFilterStatus = document.getElementById('qa-filter-status');
    this.qaItemsContainer = document.getElementById('qa-items-container');
    this.btnQaExport = document.getElementById('btn-qa-export');
    this.btnQaClear = document.getElementById('btn-qa-clear');
    this.qaQuickQuestionInput = document.getElementById('qa-quick-question-input');
    this.btnQaQuickTest = document.getElementById('btn-qa-quick-test');
    this.qaQuickResult = document.getElementById('qa-quick-result');

    // Missing & Unfilled Fields Controls
    this.unfilledQuestions = [];
    this.tabBtnUnfilled = document.getElementById('tab-btn-unfilled');
    this.unfilledBadgeCount = document.getElementById('unfilled-badge-count');
    this.unfilledAlertBanner = document.getElementById('unfilled-alert-banner');
    this.unfilledBannerText = document.getElementById('unfilled-banner-text');
    this.btnBannerGoUnfilled = document.getElementById('btn-banner-go-unfilled');
    this.unfilledItemsContainer = document.getElementById('unfilled-items-container');
    this.unfilledStatPending = document.getElementById('unfilled-stat-pending');
    this.unfilledStatRules = document.getElementById('unfilled-stat-rules');
    this.unfilledStatTotalQa = document.getElementById('unfilled-stat-total-qa');
    this.btnManualAddRule = document.getElementById('btn-manual-add-rule');
    this.inputManualQuestion = document.getElementById('input-manual-question');
    this.inputManualAnswer = document.getElementById('input-manual-answer');
    this.selectManualType = document.getElementById('select-manual-type');
    this.btnUnfilledRefresh = document.getElementById('btn-unfilled-refresh');
    this.btnUnfilledClear = document.getElementById('btn-unfilled-clear');

    // Live Gemini API Telemetry Controls & Elements
    this.geminiTelemetryCard = document.getElementById('gemini-telemetry-card');
    this.aiModelBadge = document.getElementById('ai-model-badge');
    this.aiKeyBadge = document.getElementById('ai-key-badge');
    this.aiStatusPill = document.getElementById('ai-status-pill');
    this.aiStatusDot = document.getElementById('ai-status-dot');
    this.aiStatusText = document.getElementById('ai-status-text');
    this.btnTestGeminiApi = document.getElementById('btn-test-gemini-api');
    this.btnResetCooldown = document.getElementById('btn-reset-cooldown');
    this.aiErrorBanner = document.getElementById('ai-error-banner');
    this.aiErrorTitle = document.getElementById('ai-error-title');
    this.aiErrorMessage = document.getElementById('ai-error-message');
    this.aiCooldownTimer = document.getElementById('ai-cooldown-timer');
    this.telemetryTotalCalls = document.getElementById('telemetry-total-calls');
    this.telemetrySuccessCalls = document.getElementById('telemetry-success-calls');
    this.telemetryFailedCalls = document.getElementById('telemetry-failed-calls');
    this.telemetryLatency = document.getElementById('telemetry-latency');
    this.telemetryKeySnippet = document.getElementById('telemetry-key-snippet');
    this.telemetryReqTime = document.getElementById('telemetry-req-time');
    this.telemetryLastQuestion = document.getElementById('telemetry-last-question');
    this.telemetryLastMeta = document.getElementById('telemetry-last-meta');
    this.telemetryFullPrompt = document.getElementById('telemetry-full-prompt');
    this.telemetryResStatus = document.getElementById('telemetry-res-status');
    this.telemetryParsedAnswer = document.getElementById('telemetry-parsed-answer');
    this.telemetryAiReasoning = document.getElementById('telemetry-ai-reasoning');
    this.telemetryRawResponse = document.getElementById('telemetry-raw-response');

    // Manual Apply Queue Controls (PHASE 5)
    this.mqFilterFit = document.getElementById('mq-filter-fit');
    this.mqFilterPlatform = document.getElementById('mq-filter-platform');
    this.mqFilterStatus = document.getElementById('mq-filter-status');
    this.mqSortBy = document.getElementById('mq-sort-by');
    this.mqSearchInput = document.getElementById('mq-search-input');
    this.btnRefreshManualQueue = document.getElementById('btn-refresh-manual-queue');
    this.btnAddManualJob = document.getElementById('btn-add-manual-job');
    this.mqItemsContainer = document.getElementById('mq-items-container');
    this.mqEmptyState = document.getElementById('mq-empty-state');
    this.badgeManualQueue = document.getElementById('manual-queue-badge-count');
    this.mqPendingBadge = document.getElementById('mq-pending-badge');
    this.statManualQueue = document.getElementById('stat-manual-queue');

    // Manual Queue Modals
    this.mqAppliedModal = document.getElementById('mq-applied-modal');
    this.btnCloseMqApplied = document.getElementById('btn-close-mq-applied-modal');
    this.btnCancelMqApplied = document.getElementById('btn-cancel-mq-applied-modal');
    this.btnConfirmMqApplied = document.getElementById('btn-confirm-mq-applied');
    this.mqModalJobTitle = document.getElementById('mq-modal-job-title');
    this.mqModalConfId = document.getElementById('mq-modal-conf-id');
    this.mqModalAppliedDate = document.getElementById('mq-modal-applied-date');
    this.mqModalNotes = document.getElementById('mq-modal-notes');
    this.mqModalVerifiedCheck = document.getElementById('mq-modal-verified-check');

    this.mqAddModal = document.getElementById('mq-add-modal');
    this.btnCloseMqAdd = document.getElementById('btn-close-mq-add-modal');
    this.btnCancelMqAdd = document.getElementById('btn-cancel-mq-add-modal');
    this.btnConfirmMqAdd = document.getElementById('btn-confirm-mq-add');

    this.mqNotesModal = document.getElementById('mq-notes-modal');
    this.btnCloseMqNotes = document.getElementById('btn-close-mq-notes-modal');
    this.btnCancelMqNotes = document.getElementById('btn-cancel-mq-notes-modal');
    this.btnConfirmMqNotes = document.getElementById('btn-confirm-mq-notes');
    this.mqNotesJobTitle = document.getElementById('mq-notes-job-title');
    this.mqEditNotesInput = document.getElementById('mq-edit-notes-input');

    // Toast
    this.toastContainer = document.getElementById('toast-container');
  }

  bindEvents() {
    // Tabs Navigation
    this.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetPaneId = btn.id.replace('tab-btn-', 'pane-');
        this.tabButtons.forEach(b => b.classList.remove('active'));
        this.tabPanes.forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const pane = document.getElementById(targetPaneId);
        if (pane) pane.classList.add('active');

        if (btn.id === 'tab-btn-manual-queue') {
          this.loadManualQueue();
        }
      });
    });

    // KPI Card click: navigate directly to Manual Apply Queue tab
    const kpiManualCard = document.getElementById('card-manual-queue-kpi');
    if (kpiManualCard) {
      kpiManualCard.addEventListener('click', () => {
        const tabBtn = document.getElementById('tab-btn-manual-queue');
        if (tabBtn) tabBtn.click();
      });
    }

    // Manual Queue Toolbar & Modal Events
    if (this.btnRefreshManualQueue) {
      this.btnRefreshManualQueue.addEventListener('click', () => this.loadManualQueue());
    }
    if (this.btnAddManualJob) {
      this.btnAddManualJob.addEventListener('click', () => this.openAddManualJobModal());
    }
    if (this.mqFilterFit) this.mqFilterFit.addEventListener('change', () => this.loadManualQueue());
    if (this.mqFilterPlatform) this.mqFilterPlatform.addEventListener('change', () => this.loadManualQueue());
    if (this.mqFilterStatus) this.mqFilterStatus.addEventListener('change', () => this.loadManualQueue());
    if (this.mqSortBy) this.mqSortBy.addEventListener('change', () => this.loadManualQueue());
    if (this.mqSearchInput) {
      this.mqSearchInput.addEventListener('input', () => {
        clearTimeout(this._mqSearchTimer);
        this._mqSearchTimer = setTimeout(() => this.loadManualQueue(), 300);
      });
    }

    if (this.btnCloseMqApplied) this.btnCloseMqApplied.addEventListener('click', () => this.closeMqModals());
    if (this.btnCancelMqApplied) this.btnCancelMqApplied.addEventListener('click', () => this.closeMqModals());
    if (this.btnConfirmMqApplied) this.btnConfirmMqApplied.addEventListener('click', () => this.submitMarkApplied());

    if (this.btnCloseMqAdd) this.btnCloseMqAdd.addEventListener('click', () => this.closeMqModals());
    if (this.btnCancelMqAdd) this.btnCancelMqAdd.addEventListener('click', () => this.closeMqModals());
    if (this.btnConfirmMqAdd) this.btnConfirmMqAdd.addEventListener('click', () => this.submitAddManualJob());

    if (this.btnCloseMqNotes) this.btnCloseMqNotes.addEventListener('click', () => this.closeMqModals());
    if (this.btnCancelMqNotes) this.btnCancelMqNotes.addEventListener('click', () => this.closeMqModals());
    if (this.btnConfirmMqNotes) this.btnConfirmMqNotes.addEventListener('click', () => this.submitSaveNotes());

    // Bot Controls
    this.btnStart.addEventListener('click', () => this.startBot());
    this.btnPause.addEventListener('click', () => this.pauseOrResumeBot());
    this.btnStop.addEventListener('click', () => this.stopBot());
    if (this.btnCareerAutofill) {
      this.btnCareerAutofill.addEventListener('click', () => this.autofillCareerPage());
    }

    // Launch Chrome
    this.btnLaunchChrome.addEventListener('click', () => this.launchChrome());
    if (this.btnRelaunchChrome) {
      this.btnRelaunchChrome.addEventListener('click', () => this.relaunchChrome());
    }

    // Controls Toggles
    this.toggleSim.addEventListener('change', () => {
      if (this.settings) {
        this.settings.automation.simulationMode = this.toggleSim.checked;
        this.updateSettingsOnServer();
        this.updateModeDisplay();
      }
    });

    this.toggleSemiAuto.addEventListener('change', () => {
      if (this.settings) {
        this.settings.automation.mode = this.toggleSemiAuto.checked ? 'semi-auto' : 'auto';
        this.settings.automation.reviewBeforeSubmit = this.toggleSemiAuto.checked;
        this.updateSettingsOnServer();
        this.updateModeDisplay();
      }
    });

    // Platform chips
    this.chipLinkedIn.addEventListener('click', () => {
      this.chipLinkedIn.classList.toggle('active');
      if (this.settings) {
        this.settings.platforms.linkedin = this.chipLinkedIn.classList.contains('active');
        this.updateSettingsOnServer();
      }
    });

    this.chipNaukri.addEventListener('click', () => {
      this.chipNaukri.classList.toggle('active');
      if (this.settings) {
        this.settings.platforms.naukri = this.chipNaukri.classList.contains('active');
        this.updateSettingsOnServer();
      }
    });

    if (this.chipFoundit) {
      this.chipFoundit.addEventListener('click', () => {
        this.chipFoundit.classList.toggle('active');
        if (this.settings) {
          this.settings.platforms.foundit = this.chipFoundit.classList.contains('active');
          this.updateSettingsOnServer();
        }
      });
    }

    // Terminal filters & actions
    this.btnClearLogs.addEventListener('click', () => {
      this.terminalLogs.innerHTML = '';
      this.logs = [];
    });

    this.filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        this.filterPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.activeFilter = pill.getAttribute('data-filter');
        this.applyLogFilter();
      });
    });

    // Profile & Skills
    this.btnAddSkill.addEventListener('click', () => this.addSkillRow());
    this.btnSaveProfile.addEventListener('click', () => this.saveProfile());

    // Settings
    this.rangeMinScore.addEventListener('input', () => {
      this.rangeMinScoreVal.textContent = `${this.rangeMinScore.value}%`;
    });
    this.btnSaveSettings.addEventListener('click', () => this.saveSettings());

    // AI Key & Tester
    if (this.btnSaveAiKey) {
      this.btnSaveAiKey.addEventListener('click', () => this.saveAiApiKey());
    }
    this.btnTestAiAnswer.addEventListener('click', () => this.testAiScreening());
    document.querySelectorAll('.sample-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this.testQuestionInput.value = chip.getAttribute('data-q');
        this.testAiScreening();
      });
    });

    // History & Period Filters
    this.btnClearHistory.addEventListener('click', () => this.clearHistory());
    if (this.btnRefreshHistory) {
      this.btnRefreshHistory.addEventListener('click', () => this.refreshApplicationsData());
    }
    if (this.inputHistorySearch) {
      this.inputHistorySearch.addEventListener('input', () => this.renderHistoryTable());
    }

    this.historyPeriodPills.forEach(pill => {
      pill.addEventListener('click', () => {
        this.historyPeriodPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.selectedPeriod = pill.getAttribute('data-period') || 'all';
        this.syncPeriodCardsUI();
        this.renderHistoryTable();
      });
    });

    this.timeMetricCards.forEach(card => {
      card.addEventListener('click', () => {
        const period = card.getAttribute('data-period');
        if (period) {
          this.selectedPeriod = period;
          this.historyPeriodPills.forEach(p => {
            if (p.getAttribute('data-period') === period) {
              p.classList.add('active');
            } else {
              p.classList.remove('active');
            }
          });
          this.syncPeriodCardsUI();
          this.renderHistoryTable();
        }
      });
    });

    if (this.historyFilterPlatform) {
      this.historyFilterPlatform.addEventListener('change', () => {
        this.selectedPlatform = this.historyFilterPlatform.value;
        this.renderHistoryTable();
      });
    }

    if (this.historyFilterStatus) {
      this.historyFilterStatus.addEventListener('change', () => {
        this.selectedStatus = this.historyFilterStatus.value;
        this.renderHistoryTable();
      });
    }

    // Modal Close Listeners
    if (this.btnCloseQaModal) {
      this.btnCloseQaModal.addEventListener('click', () => this.closeQaModal());
    }
    if (this.btnCloseQaModalFooter) {
      this.btnCloseQaModalFooter.addEventListener('click', () => this.closeQaModal());
    }
    if (this.qaDetailsModal) {
      this.qaDetailsModal.addEventListener('click', (e) => {
        if (e.target === this.qaDetailsModal) {
          this.closeQaModal();
        }
      });
    }

    // Q&A Audit controls
    if (this.qaSearchInput) {
      this.qaSearchInput.addEventListener('input', () => this.filterAndRenderQAAudit());
    }
    if (this.qaFilterPlatform) {
      this.qaFilterPlatform.addEventListener('change', () => this.filterAndRenderQAAudit());
    }
    if (this.qaFilterEngine) {
      this.qaFilterEngine.addEventListener('change', () => this.filterAndRenderQAAudit());
    }
    if (this.qaFilterStatus) {
      this.qaFilterStatus.addEventListener('change', () => this.filterAndRenderQAAudit());
    }
    if (this.btnQaExport) {
      this.btnQaExport.addEventListener('click', () => this.exportQAAudit());
    }
    if (this.btnQaClear) {
      this.btnQaClear.addEventListener('click', () => this.clearQAAudit());
    }
    if (this.btnQaQuickTest) {
      this.btnQaQuickTest.addEventListener('click', () => this.runQaQuickTest());
    }
    if (this.qaQuickQuestionInput) {
      this.qaQuickQuestionInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.runQaQuickTest();
        }
      });
    }

    // Missing & Unfilled Fields Handlers
    if (this.btnBannerGoUnfilled) {
      this.btnBannerGoUnfilled.addEventListener('click', () => this.switchToTab('unfilled'));
    }
    if (this.btnUnfilledRefresh) {
      this.btnUnfilledRefresh.addEventListener('click', () => this.loadUnfilledQuestions());
    }
    if (this.btnUnfilledClear) {
      this.btnUnfilledClear.addEventListener('click', () => this.clearAllUnfilled());
    }
    if (this.btnManualAddRule) {
      this.btnManualAddRule.addEventListener('click', () => this.handleManualAddRule());
    }
    if (this.inputManualAnswer) {
      this.inputManualAnswer.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleManualAddRule();
        }
      });
    }

    // Live Gemini Telemetry Actions
    if (this.btnTestGeminiApi) {
      this.btnTestGeminiApi.addEventListener('click', () => this.runGeminiTestCall());
    }
    if (this.btnResetCooldown) {
      this.btnResetCooldown.addEventListener('click', () => this.resetGeminiCooldown());
    }
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.addLog('info', 'WebSocket', 'Connected to local AutoApply backend.');
      this.checkChromeStatus();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleSocketMessage(msg);
      } catch (e) {
        console.error('Socket parse error:', e);
      }
    };

    this.ws.onclose = () => {
      this.addLog('warning', 'WebSocket', 'Connection lost. Reconnecting in 3s...');
      setTimeout(() => this.connectWebSocket(), 3000);
    };
  }

  handleSocketMessage(msg) {
    const { type, data } = msg;

    switch (type) {
      case 'init':
        this.profile = data.profile;
        this.settings = data.settings;
        this.populateProfileForm();
        this.populateSettingsForm();
        if (data.snapshot) {
          this.updateFromSnapshot(data.snapshot);
        }
        this.loadManualQueue();
        break;

      case 'log':
        this.addLog(data.level, data.tag, data.message, data.timestamp);
        break;

      case 'state_changed':
        this.setState(data.state);
        break;

      case 'job_processed':
        this.renderActiveJob(data.job);
        const existingIdx = this.historyJobs.findIndex(j => j.id === data.job.id);
        if (existingIdx >= 0) {
          this.historyJobs[existingIdx] = { ...this.historyJobs[existingIdx], ...data.job };
        } else {
          this.historyJobs.unshift(data.job);
        }
        if (data.timeStats) {
          this.renderTimeMetrics(data.timeStats);
        }
        this.renderHistoryTable();
        this.updateStats(data.stats, data.timeStats);
        break;

      case 'history_cleared':
        this.historyJobs = [];
        this.renderTimeMetrics({ today: 0, yesterday: 0, thisMonth: 0, previousMonth: 0, allTime: 0 });
        this.renderHistoryTable();
        this.updateStats(data.stats);
        break;

      case 'ai_status':
        this.renderAiStatus(data);
        break;

      case 'qa_answered':
        this.qaAuditList.unshift(data);
        this.filterAndRenderQAAudit();
        this.updateQAStats();
        break;

      case 'qa_rule_saved':
        if (data?.id) {
          const found = this.qaAuditList.find(i => i.id === data.id);
          if (found) {
            found.status = 'saved_as_rule';
            if (data.result?.rule?.defaultAnswer) {
              found.answer = data.result.rule.defaultAnswer;
            }
          }
        }
        this.filterAndRenderQAAudit();
        this.updateQAStats();
        break;

      case 'qa_audit_cleared':
        this.qaAuditList = [];
        this.filterAndRenderQAAudit();
        this.updateQAStats();
        break;

      case 'qa_entry_deleted':
        this.qaAuditList = this.qaAuditList.filter(item => item.id !== data.id);
        this.filterAndRenderQAAudit();
        this.updateQAStats();
        break;

      case 'unfilled_question_detected':
        this.addOrUpdateUnfilledQuestion(data);
        this.showToast(`⚠️ Missing screening field: "${(data.question || '').slice(0, 35)}..."`, 'warning');
        break;

      case 'unfilled_resolved':
        if (data?.id) {
          this.unfilledQuestions = this.unfilledQuestions.filter(q => q.id !== data.id);
          this.renderUnfilledQuestions();
        }
        break;

      case 'unfilled_dismissed':
        if (data?.id) {
          this.unfilledQuestions = this.unfilledQuestions.filter(q => q.id !== data.id);
          this.renderUnfilledQuestions();
        }
        break;

      case 'unfilled_cleared':
        this.unfilledQuestions = [];
        this.renderUnfilledQuestions();
        break;

      case 'manual_queue_stats':
        if (this.badgeManualQueue) this.badgeManualQueue.textContent = data.pendingCount || 0;
        if (this.mqPendingBadge) this.mqPendingBadge.textContent = `${data.pendingCount || 0} Pending`;
        if (this.statManualQueue) this.statManualQueue.textContent = data.pendingCount || 0;
        break;

      case 'manual_queue_updated':
        this.loadManualQueue();
        break;

      case 'ai_telemetry_updated':
        this.updateAiTelemetryUI(data);
        break;
    }
  }

  async loadInitialData() {
    try {
      const [resProf, resSett, resStatus, resAiStatus, resQaAudit, resUnfilled, resApps, resStats] = await Promise.all([
        fetch('/api/profile').then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
        fetch('/api/status').then(r => r.json()),
        fetch('/api/ai/status').then(r => r.json()).catch(() => null),
        fetch('/api/qa-audit').then(r => r.json()).catch(() => null),
        fetch('/api/unfilled-questions').then(r => r.json()).catch(() => null),
        fetch('/api/applications').then(r => r.json()).catch(() => null),
        fetch('/api/applications/stats').then(r => r.json()).catch(() => null)
      ]);

      this.profile = resProf;
      this.settings = resSett;
      this.populateProfileForm();
      this.populateSettingsForm();

      if (resAiStatus) {
        this.renderAiStatus(resAiStatus);
      }

      if (resQaAudit?.auditLog) {
        this.qaAuditList = resQaAudit.auditLog;
        this.filterAndRenderQAAudit();
        this.updateQAStats(resQaAudit.stats);
      }

      if (resUnfilled?.unfilledQuestions) {
        this.unfilledQuestions = resUnfilled.unfilledQuestions;
        this.renderUnfilledQuestions();
      }

      // Populate persistent application records and time analytics
      if (resApps?.applications && Array.isArray(resApps.applications)) {
        this.historyJobs = resApps.applications;
      }
      const timeStats = resApps?.timeStats || resStats?.timeStats;
      if (timeStats) {
        this.renderTimeMetrics(timeStats);
      }
      this.renderHistoryTable();

      if (resStatus?.orchestrator) {
        this.updateFromSnapshot(resStatus.orchestrator);
      }
      if (resStatus?.chrome) {
        this.renderChromeStatus(resStatus.chrome);
      }
      if (resStatus?.aiTelemetry) {
        this.updateAiTelemetryUI(resStatus.aiTelemetry);
      } else {
        fetch('/api/ai/live-telemetry')
          .then(r => r.json())
          .then(d => { if (d?.telemetry) this.updateAiTelemetryUI(d.telemetry); })
          .catch(() => {});
      }

      // Load High-Match Manual Application Queue (PHASE 5)
      this.loadManualQueue();
    } catch (err) {
      console.error('Failed to load initial data:', err);
    }
  }

  async checkChromeStatus() {
    try {
      const res = await fetch('/api/status').then(r => r.json());
      if (res.chrome) {
        this.renderChromeStatus(res.chrome);
      }
    } catch (e) {}
  }

  renderChromeStatus(chrome) {
    if (chrome.portOpen || chrome.isConnected) {
      this.chromeStatusDot.className = 'status-dot dot-connected';
      this.chromeStatusText.textContent = `Chrome Connected • Background Ready ⚡`;
      this.btnLaunchChrome.style.display = 'none';
      if (this.btnRelaunchChrome) this.btnRelaunchChrome.style.display = 'inline-block';
    } else {
      this.chromeStatusDot.className = 'status-dot dot-disconnected';
      this.chromeStatusText.textContent = `Chrome Offline (Port ${chrome.port})`;
      this.btnLaunchChrome.style.display = 'inline-block';
      if (this.btnRelaunchChrome) this.btnRelaunchChrome.style.display = 'none';
    }
  }

  async launchChrome() {
    this.btnLaunchChrome.disabled = true;
    this.btnLaunchChrome.textContent = 'Launching...';
    try {
      const res = await fetch('/api/chrome/launch', { method: 'POST' }).then(r => r.json());
      if (res.success) {
        this.showToast('Chrome launched with background execution flags & port 9222!', 'success');
        setTimeout(() => this.checkChromeStatus(), 2000);
      } else {
        this.showToast(res.error || 'Failed to launch Chrome', 'error');
      }
    } catch (err) {
      this.showToast(err.message, 'error');
    } finally {
      this.btnLaunchChrome.disabled = false;
      this.btnLaunchChrome.textContent = 'Launch';
    }
  }

  async relaunchChrome() {
    if (this.btnRelaunchChrome) {
      this.btnRelaunchChrome.disabled = true;
      this.btnRelaunchChrome.textContent = 'Restarting...';
    }
    try {
      const res = await fetch('/api/chrome/relaunch', { method: 'POST' }).then(r => r.json());
      if (res.success) {
        this.showToast('Chrome relaunched with background execution flags!', 'success');
        setTimeout(() => this.checkChromeStatus(), 2000);
      } else {
        this.showToast(res.error || 'Failed to restart Chrome', 'error');
      }
    } catch (err) {
      this.showToast(err.message, 'error');
    } finally {
      if (this.btnRelaunchChrome) {
        this.btnRelaunchChrome.disabled = false;
        this.btnRelaunchChrome.textContent = 'Relaunch Background';
      }
    }
  }

  setState(state) {
    this.state = state;
    this.botStatusDot.className = `status-dot dot-${state}`;
    this.botStatusText.textContent = `Agent ${state.charAt(0).toUpperCase() + state.slice(1)}`;

    if (state === 'running') {
      this.btnStart.disabled = true;
      this.btnPause.disabled = false;
      this.btnPause.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
        Pause
      `;
      this.btnStop.disabled = false;
    } else if (state === 'paused') {
      this.btnStart.disabled = true;
      this.btnPause.disabled = false;
      this.btnPause.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        Resume
      `;
      this.btnStop.disabled = false;
    } else {
      // idle or stopped
      this.btnStart.disabled = false;
      this.btnPause.disabled = true;
      this.btnStop.disabled = true;
      this.btnPause.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
        Pause
      `;
    }
  }

  updateFromSnapshot(snapshot) {
    if (snapshot.state) this.setState(snapshot.state);
    if (snapshot.stats) this.updateStats(snapshot.stats, snapshot.timeStats);
    if (snapshot.timeStats) this.renderTimeMetrics(snapshot.timeStats);
    if (snapshot.currentJob) this.renderActiveJob(snapshot.currentJob);
    if (snapshot.recentJobs && snapshot.recentJobs.length > 0) {
      this.historyJobs = snapshot.recentJobs;
      this.renderHistoryTable();
    }
    if (snapshot.manualQueueStats) {
      if (this.badgeManualQueue) this.badgeManualQueue.textContent = snapshot.manualQueueStats.pendingCount || 0;
      if (this.mqPendingBadge) this.mqPendingBadge.textContent = `${snapshot.manualQueueStats.pendingCount || 0} Pending`;
      if (this.statManualQueue) this.statManualQueue.textContent = snapshot.manualQueueStats.pendingCount || 0;
    }
  }

  updateStats(stats, timeStats = null) {
    if (!stats) return;
    this.statApplied.textContent = stats.appliedToday || 0;
    this.statMatches.textContent = stats.matchesFound || 0;
    this.statScore.textContent = `${stats.avgMatchScore || 0}%`;

    const mqCount = stats.manualQueuePending !== undefined ? stats.manualQueuePending : (timeStats?.manualQueuePending || 0);
    if (this.badgeManualQueue) this.badgeManualQueue.textContent = mqCount;
    if (this.mqPendingBadge) this.mqPendingBadge.textContent = `${mqCount} Pending`;
    if (this.statManualQueue) this.statManualQueue.textContent = mqCount;

    const cap = this.settings?.automation?.maxApplicationsPerSession || 20;
    this.statTargetCap.textContent = cap;

    const pct = Math.min(100, Math.round(((stats.appliedToday || 0) / cap) * 100));
    this.statProgressFill.style.width = `${pct}%`;

    if (timeStats) {
      this.renderTimeMetrics(timeStats);
    }
  }

  updateModeDisplay() {
    const isSim = this.settings?.automation?.simulationMode;
    const mode = this.settings?.automation?.mode || 'semi-auto';

    this.statModeBadge.textContent = mode === 'semi-auto' ? 'Semi-Auto' : 'Full Auto';
    this.statSimSub.textContent = isSim ? 'Simulation Mode' : 'Live Chrome Mode';
    this.statSimSub.style.color = isSim ? '#e879f9' : '#34d399';
  }

  renderActiveJob(job) {
    if (!job) return;
    this.currentJobTitle.textContent = job.title || 'Software Engineer';
    this.currentJobCompany.textContent = `${job.company || 'Company'} • ${job.location || 'India'}`;
    this.currentJobScore.textContent = job.matchScore ? `${job.matchScore}%` : '--';

    // Color code badge
    if (job.matchScore >= 80) {
      this.currentJobScore.style.color = '#34d399'; // green
    } else if (job.matchScore >= 65) {
      this.currentJobScore.style.color = '#818cf8'; // indigo
    } else {
      this.currentJobScore.style.color = '#fbbf24'; // amber
    }

    this.currentJobPlatform.innerHTML = `
      <span class="platform-dot dot-${job.platform?.toLowerCase()}"></span> ${job.platform}
    `;

    if (job.evaluation) {
      this.currentJobReasoning.innerHTML = `
        <strong>AI Analysis:</strong> ${job.evaluation.reasoning}
      `;

      if (job.evaluation.matchedSkills?.length > 0) {
        this.currentJobSkills.innerHTML = job.evaluation.matchedSkills.map(
          s => `<span class="skill-pill">✓ ${s}</span>`
        ).join('');
      } else {
        this.currentJobSkills.innerHTML = '';
      }
    }

    // Status pill
    this.currentJobStatus.textContent = job.status || 'evaluating';
    this.currentJobStatus.className = `status-chip chip-${job.status?.includes('applied') ? 'applied' : job.status === 'skipped' ? 'skipped' : 'waiting'}`;

    if (job.url && job.url.startsWith('http')) {
      this.currentJobLink.href = job.url;
      this.currentJobLink.style.display = 'inline-block';
    } else {
      this.currentJobLink.style.display = 'none';
    }
  }

  addLog(level, tag, message, time = null) {
    const timestamp = time || new Date().toLocaleTimeString();
    const entry = { level, tag, message, timestamp };
    this.logs.push(entry);

    const logEl = document.createElement('div');
    logEl.className = `log-entry log-${level}`;
    logEl.setAttribute('data-level', level);

    const tagClass = `tag-${tag?.toLowerCase().replace(/[^a-z]/g, '') || 'system'}`;

    logEl.innerHTML = `
      <span class="log-time">${timestamp}</span>
      <span class="log-tag ${tagClass}">${tag || 'LOG'}</span>
      <span class="log-msg">${this.escapeHTML(message)}</span>
    `;

    // Filter check
    if (this.activeFilter !== 'all' && this.activeFilter !== level) {
      logEl.style.display = 'none';
    }

    this.terminalLogs.appendChild(logEl);

    if (this.toggleAutoscroll.checked) {
      this.terminalLogs.scrollTop = this.terminalLogs.scrollHeight;
    }
  }

  applyLogFilter() {
    const entries = this.terminalLogs.querySelectorAll('.log-entry');
    entries.forEach(entry => {
      const lvl = entry.getAttribute('data-level');
      if (this.activeFilter === 'all' || this.activeFilter === lvl) {
        entry.style.display = 'flex';
      } else {
        entry.style.display = 'none';
      }
    });
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
      startOfToday,
      endOfToday,
      startOfYesterday,
      endOfYesterday,
      startOfThisMonth,
      startOfPrevMonth,
      endOfPrevMonth
    };
  }

  renderTimeMetrics(timeStats) {
    if (!timeStats) return;
    this.timeStats = timeStats;
    if (this.timeStatToday) this.timeStatToday.textContent = timeStats.today ?? 0;
    if (this.timeStatYesterday) this.timeStatYesterday.textContent = timeStats.yesterday ?? 0;
    if (this.timeStatThisMonth) this.timeStatThisMonth.textContent = timeStats.thisMonth ?? 0;
    if (this.timeStatPrevMonth) this.timeStatPrevMonth.textContent = timeStats.previousMonth ?? 0;
    if (this.timeStatAllTime) this.timeStatAllTime.textContent = timeStats.allTime ?? timeStats.totalApplied ?? 0;
  }

  syncPeriodCardsUI() {
    this.timeMetricCards.forEach(card => {
      const p = card.getAttribute('data-period');
      if (p === this.selectedPeriod) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });
  }

  async refreshApplicationsData() {
    if (this.btnRefreshHistory) {
      this.btnRefreshHistory.disabled = true;
      this.btnRefreshHistory.innerHTML = `
        <svg class="spin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
        Refreshing...
      `;
    }
    try {
      const res = await fetch('/api/applications').then(r => r.json());
      if (res.applications) {
        this.historyJobs = res.applications;
        if (res.timeStats) {
          this.renderTimeMetrics(res.timeStats);
        }
        this.renderHistoryTable();
        this.showToast('Application history & analytics reloaded from disk.', 'success');
      }
    } catch (err) {
      this.showToast(`Refresh error: ${err.message}`, 'error');
    } finally {
      if (this.btnRefreshHistory) {
        this.btnRefreshHistory.disabled = false;
        this.btnRefreshHistory.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          Refresh Data
        `;
      }
    }
  }

  openQaModal(appId) {
    const job = this.historyJobs.find(j => j.id === appId);
    if (!job || !this.qaDetailsModal) return;

    if (this.modalQaPlatform) {
      this.modalQaPlatform.textContent = job.platform || 'Direct';
      this.modalQaPlatform.className = `modal-badge-platform platform-${(job.platform || 'other').toLowerCase()}`;
    }
    if (this.modalQaTitle) this.modalQaTitle.textContent = job.title || 'Job Application';
    if (this.modalQaCompany) this.modalQaCompany.textContent = `${job.company || 'Direct Employer'} • ${job.location || 'India'}`;
    if (this.modalQaStatus) {
      this.modalQaStatus.textContent = job.status || 'applied';
      this.modalQaStatus.className = `status-chip ${job.status?.includes('applied') ? 'chip-applied' : job.status === 'skipped' ? 'chip-skipped' : 'chip-waiting'}`;
    }
    if (this.modalQaScore) this.modalQaScore.textContent = `${job.matchScore || 0}%`;

    const appDate = job.appliedAt || job.timestamp;
    if (this.modalQaTime) {
      this.modalQaTime.textContent = appDate ? new Date(appDate).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '--';
    }

    if (this.modalQaLinkContainer) {
      if (job.url && job.url.startsWith('http')) {
        this.modalQaLink.href = job.url;
        this.modalQaLinkContainer.style.display = 'flex';
      } else {
        this.modalQaLinkContainer.style.display = 'none';
      }
    }

    const qas = job.questionsAnswered || [];
    if (this.modalQaCount) {
      this.modalQaCount.textContent = `${qas.length} Question${qas.length === 1 ? '' : 's'}`;
    }

    if (this.modalQaList) {
      if (qas.length === 0) {
        this.modalQaList.innerHTML = `
          <div style="text-align: center; padding: 28px; color: var(--text-muted); font-size: 0.9rem;">
            No specific screening questions were encountered or needed filling for this job.
          </div>
        `;
      } else {
        this.modalQaList.innerHTML = qas.map((qa, idx) => `
          <div class="modal-qa-item">
            <div class="modal-qa-question">
              <span class="modal-qa-q-icon">${idx + 1}</span>
              <span class="modal-qa-q-text">${this.escapeHTML(qa.question)}</span>
            </div>
            <div class="modal-qa-answer-box">
              <span class="modal-qa-ans-val">${this.escapeHTML(qa.answer || '(Empty)')}</span>
              <div class="modal-qa-tags">
                <span class="modal-qa-type-pill">${this.escapeHTML(qa.inputType || 'text')}</span>
                <span class="modal-qa-source-pill">${this.escapeHTML(qa.source || 'AI Engine')}</span>
              </div>
            </div>
          </div>
        `).join('');
      }
    }

    this.qaDetailsModal.style.display = 'flex';
  }

  closeQaModal() {
    if (this.qaDetailsModal) {
      this.qaDetailsModal.style.display = 'none';
    }
  }

  renderHistoryTable() {
    const query = (this.inputHistorySearch ? this.inputHistorySearch.value : '').trim().toLowerCase();
    const {
      startOfToday,
      endOfToday,
      startOfYesterday,
      endOfYesterday,
      startOfThisMonth,
      startOfPrevMonth,
      endOfPrevMonth
    } = this.getDateBoundaries();

    const filtered = this.historyJobs.filter(job => {
      const appDate = new Date(job.appliedAt || job.timestamp || Date.now());

      // Period filter
      if (this.selectedPeriod === 'today') {
        if (appDate < startOfToday || appDate > endOfToday) return false;
      } else if (this.selectedPeriod === 'yesterday') {
        if (appDate < startOfYesterday || appDate > endOfYesterday) return false;
      } else if (this.selectedPeriod === 'this_month') {
        if (appDate < startOfThisMonth) return false;
      } else if (this.selectedPeriod === 'prev_month') {
        if (appDate < startOfPrevMonth || appDate > endOfPrevMonth) return false;
      }

      // Platform filter
      if (this.selectedPlatform !== 'all') {
        if ((job.platform || '').toLowerCase() !== this.selectedPlatform.toLowerCase()) return false;
      }

      // Status filter
      if (this.selectedStatus !== 'all') {
        const st = (job.status || '').toLowerCase();
        if (this.selectedStatus === 'applied' && !st.includes('applied')) return false;
        if (this.selectedStatus === 'skipped' && st !== 'skipped') return false;
        if (this.selectedStatus === 'failed' && st !== 'failed' && st !== 'needs_manual_review') return false;
      }

      // Search filter
      if (query) {
        const inTitle = (job.title || '').toLowerCase().includes(query);
        const inCompany = (job.company || '').toLowerCase().includes(query);
        const inPlatform = (job.platform || '').toLowerCase().includes(query);
        const inLocation = (job.location || '').toLowerCase().includes(query);
        const inQuestions = (job.questionsAnswered || []).some(
          qa => (qa.question || '').toLowerCase().includes(query) || (qa.answer || '').toLowerCase().includes(query)
        );
        if (!inTitle && !inCompany && !inPlatform && !inLocation && !inQuestions) return false;
      }

      return true;
    });

    if (this.historyBadgeCount) {
      this.historyBadgeCount.textContent = this.historyJobs.length;
    }

    if (filtered.length === 0) {
      this.historyTableBody.innerHTML = `
        <tr class="empty-row">
          <td colspan="8">No matching application records found for the selected filters.</td>
        </tr>
      `;
      return;
    }

    this.historyTableBody.innerHTML = filtered.map(job => {
      const appDate = job.appliedAt || job.timestamp;
      const dateObj = appDate ? new Date(appDate) : null;
      const timeStr = dateObj ? dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--';
      const statusClass = job.status?.includes('applied') ? 'chip-applied' : job.status === 'skipped' ? 'chip-skipped' : 'chip-waiting';
      const qas = job.questionsAnswered || [];
      const qBadge = qas.length > 0
        ? `<button class="qa-badge-btn" onclick="app.openQaModal('${job.id}')" title="Click to view answered screening questions">
             💬 ${qas.length} Answered ↗
           </button>`
        : `<span class="qa-badge-btn-empty">-- None --</span>`;

      return `
        <tr>
          <td>
            <strong>${this.escapeHTML(job.title)}</strong>
            ${job.scenario ? `<span style="display:block; font-size:0.75rem; color:var(--text-muted);">${this.escapeHTML(job.scenario)}</span>` : ''}
          </td>
          <td>
            <div>${this.escapeHTML(job.company)}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${this.escapeHTML(job.location || 'India')}</div>
          </td>
          <td>
            <span class="meta-item">
              <span class="platform-dot dot-${(job.platform || '').toLowerCase().replace(/[^a-z0-9]/g, '-')}"></span> ${job.platform}
            </span>
          </td>
          <td>${qBadge}</td>
          <td>
            <span class="score-pill" style="font-weight: 700; color: ${job.matchScore >= 75 ? '#34d399' : '#818cf8'};">
              ${job.matchScore || 0}%
            </span>
          </td>
          <td>
            <span class="status-chip ${statusClass}">${job.status}</span>
          </td>
          <td style="color: var(--text-muted); font-size: 0.8rem; white-space: nowrap;">${timeStr}</td>
          <td>
            ${job.url && job.url.startsWith('http') ? `<a href="${job.url}" target="_blank" class="link-btn">View ↗</a>` : '--'}
          </td>
        </tr>
      `;
    }).join('');
  }

  populateProfileForm() {
    if (!this.profile) return;
    const p = this.profile.personal || {};
    const c = this.profile.career || {};

    document.getElementById('prof-fullName').value = p.fullName || '';
    if (document.getElementById('prof-firstName')) document.getElementById('prof-firstName').value = p.firstName || '';
    if (document.getElementById('prof-lastName')) document.getElementById('prof-lastName').value = p.lastName || '';
    document.getElementById('prof-email').value = p.email || '';
    document.getElementById('prof-phone').value = p.phone || '';
    if (document.getElementById('prof-phoneCountryCode')) document.getElementById('prof-phoneCountryCode').value = p.phoneCountryCode || '';
    if (document.getElementById('prof-city')) document.getElementById('prof-city').value = p.city || '';
    if (document.getElementById('prof-state')) document.getElementById('prof-state').value = p.state || '';
    if (document.getElementById('prof-country')) document.getElementById('prof-country').value = p.country || '';
    if (document.getElementById('prof-postalCode')) document.getElementById('prof-postalCode').value = p.postalCode || '';
    if (document.getElementById('prof-streetAddress')) document.getElementById('prof-streetAddress').value = p.streetAddress || '';
    if (document.getElementById('prof-gender')) document.getElementById('prof-gender').value = p.gender || '';
    document.getElementById('prof-location').value = p.location || '';
    document.getElementById('prof-linkedin').value = p.linkedInUrl || '';
    document.getElementById('prof-github').value = p.githubUrl || p.portfolioUrl || '';

    document.getElementById('prof-primaryRole').value = c.primaryRole || '';
    document.getElementById('prof-totalExp').value = c.totalYearsExperience || 0;
    document.getElementById('prof-currentSalary').value = c.currentSalaryLPA || '';
    document.getElementById('prof-expectedSalary').value = c.expectedSalaryLPA || '';
    document.getElementById('prof-noticePeriod').value = c.noticePeriodDays || 30;
    document.getElementById('prof-relocate').checked = !!c.willingToRelocate;
    document.getElementById('prof-visa').checked = !!c.needsVisaSponsorship;
    document.getElementById('prof-coverIntro').value = this.profile.customCoverLetterIntro || '';

    // Render skills
    this.renderSkillsManager(this.profile.skills || []);

    // Render active screening Q&A memory list
    this.renderActiveRulesList(this.profile.screeningQA || []);
  }

  renderSkillsManager(skills) {
    this.skillsContainer.innerHTML = '';
    skills.forEach(skill => this.addSkillRow(skill.name, skill.years, skill.proficiency));
  }

  addSkillRow(name = '', years = 3, proficiency = 'Intermediate') {
    const row = document.createElement('div');
    row.className = 'skill-row';
    row.innerHTML = `
      <input type="text" class="form-input skill-name" placeholder="Skill (e.g. React.js)" value="${this.escapeHTML(name)}">
      <input type="number" class="form-input skill-years" placeholder="Years" min="0" max="40" value="${years}">
      <select class="form-input skill-level">
        <option value="Beginner" ${proficiency === 'Beginner' ? 'selected' : ''}>Beginner</option>
        <option value="Intermediate" ${proficiency === 'Intermediate' ? 'selected' : ''}>Intermediate</option>
        <option value="Advanced" ${proficiency === 'Advanced' ? 'selected' : ''}>Advanced</option>
        <option value="Expert" ${proficiency === 'Expert' ? 'selected' : ''}>Expert</option>
      </select>
      <button type="button" class="btn-remove-skill" title="Remove skill">✕</button>
    `;

    row.querySelector('.btn-remove-skill').addEventListener('click', () => row.remove());
    this.skillsContainer.appendChild(row);
  }

  renderActiveRulesList(rules) {
    this.activeRulesList.innerHTML = rules.map(rule => `
      <li class="rule-item">
        <span class="rule-pattern">/${rule.pattern}/</span>
        <span class="rule-val">${rule.defaultAnswer}</span>
      </li>
    `).join('');
  }

  async saveProfile() {
    // Read skills from DOM
    const skillRows = this.skillsContainer.querySelectorAll('.skill-row');
    const skills = Array.from(skillRows).map(row => ({
      name: row.querySelector('.skill-name').value.trim(),
      years: parseInt(row.querySelector('.skill-years').value, 10) || 0,
      proficiency: row.querySelector('.skill-level').value
    })).filter(s => s.name.length > 0);

    const curP = this.profile.personal || {};
    const updated = {
      ...this.profile,
      personal: {
        fullName: document.getElementById('prof-fullName').value.trim(),
        firstName: document.getElementById('prof-firstName')?.value.trim() || curP.firstName || '',
        lastName: document.getElementById('prof-lastName')?.value.trim() || curP.lastName || '',
        email: document.getElementById('prof-email').value.trim(),
        phone: document.getElementById('prof-phone').value.trim(),
        phoneCountryCode: document.getElementById('prof-phoneCountryCode')?.value.trim() || curP.phoneCountryCode || 'India (+91)',
        city: document.getElementById('prof-city')?.value.trim() || curP.city || 'Hyderabad',
        state: document.getElementById('prof-state')?.value.trim() || curP.state || 'Telangana',
        country: document.getElementById('prof-country')?.value.trim() || curP.country || 'India',
        postalCode: document.getElementById('prof-postalCode')?.value.trim() || curP.postalCode || '500081',
        streetAddress: document.getElementById('prof-streetAddress')?.value.trim() || curP.streetAddress || 'Hyderabad, Telangana',
        gender: document.getElementById('prof-gender')?.value.trim() || curP.gender || 'Male',
        location: document.getElementById('prof-location').value.trim(),
        linkedInUrl: document.getElementById('prof-linkedin').value.trim(),
        portfolioUrl: document.getElementById('prof-github').value.trim()
      },
      career: {
        primaryRole: document.getElementById('prof-primaryRole').value.trim(),
        totalYearsExperience: parseInt(document.getElementById('prof-totalExp').value, 10) || 0,
        currentSalaryLPA: document.getElementById('prof-currentSalary').value.trim(),
        expectedSalaryLPA: document.getElementById('prof-expectedSalary').value.trim(),
        noticePeriodDays: parseInt(document.getElementById('prof-noticePeriod').value, 10) || 30,
        willingToRelocate: document.getElementById('prof-relocate').checked,
        needsVisaSponsorship: document.getElementById('prof-visa').checked
      },
      skills,
      customCoverLetterIntro: document.getElementById('prof-coverIntro').value.trim()
    };

    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      }).then(r => r.json());

      if (res.success) {
        this.profile = updated;
        this.showToast('Candidate profile updated in agent memory!', 'success');
      }
    } catch (e) {
      this.showToast('Failed to save profile: ' + e.message, 'error');
    }
  }

  populateSettingsForm() {
    if (!this.settings) return;
    const s = this.settings;

    document.getElementById('sett-keywords').value = s.search?.keywords || '';
    document.getElementById('sett-locations').value = s.search?.locations || '';

    const minScore = s.automation?.minMatchScore || 65;
    this.rangeMinScore.value = minScore;
    this.rangeMinScoreVal.textContent = `${minScore}%`;

    document.getElementById('sett-maxApps').value = s.automation?.maxApplicationsPerSession || 20;
    document.getElementById('sett-delayMin').value = s.automation?.humanDelayMinMs || 1800;
    document.getElementById('sett-delayMax').value = s.automation?.humanDelayMaxMs || 3500;

    document.getElementById('sett-chromePort').value = s.chrome?.port || 9222;
    document.getElementById('sett-chromePath').value = s.chrome?.executablePath || '';

    this.toggleSim.checked = !!s.automation?.simulationMode;
    this.toggleSemiAuto.checked = s.automation?.mode === 'semi-auto' || s.automation?.reviewBeforeSubmit === true;

    if (s.platforms?.linkedin) this.chipLinkedIn.classList.add('active');
    else this.chipLinkedIn.classList.remove('active');

    if (s.platforms?.naukri) this.chipNaukri.classList.add('active');
    else this.chipNaukri.classList.remove('active');

    if (s.platforms?.foundit) this.chipFoundit?.classList.add('active');
    else this.chipFoundit?.classList.remove('active');

    if (this.selectDatePosted) {
      this.selectDatePosted.value = s.search?.datePosted || 'past_24h';
    }
    if (this.inputMaxPages) {
      this.inputMaxPages.value = s.automation?.maxPagesPerScenario || 2;
    }
    if (this.inputScenarios) {
      this.inputScenarios.value = Array.isArray(s.search?.scenarios)
        ? s.search.scenarios.join(', ')
        : (s.search?.keywords || '');
    }

    if (this.inputGeminiKey) {
      this.inputGeminiKey.value = s.ai?.apiKey || '';
    }

    const chkShortlist = document.getElementById('sett-shortlistNonEasyApply');
    if (chkShortlist) {
      chkShortlist.checked = s.automation?.shortlistNonEasyApplyJobs !== false;
    }

    this.updateModeDisplay();
  }

  async saveSettings() {
    const scenarios = this.inputScenarios && this.inputScenarios.value.trim()
      ? this.inputScenarios.value.split(',').map(x => x.trim()).filter(Boolean)
      : (this.settings?.search?.scenarios || ['Full Stack Developer', 'Java Developer']);

    const updated = {
      ...this.settings,
      platforms: {
        linkedin: this.chipLinkedIn.classList.contains('active'),
        naukri: this.chipNaukri.classList.contains('active'),
        foundit: this.chipFoundit ? this.chipFoundit.classList.contains('active') : false
      },
      search: {
        keywords: document.getElementById('sett-keywords').value.trim(),
        scenarios,
        locations: document.getElementById('sett-locations').value.trim(),
        experienceLevel: this.settings.search?.experienceLevel || 'Mid-Senior level',
        datePosted: this.selectDatePosted ? this.selectDatePosted.value : 'past_24h'
      },
      automation: {
        ...this.settings.automation,
        shortlistNonEasyApplyJobs: document.getElementById('sett-shortlistNonEasyApply') ? document.getElementById('sett-shortlistNonEasyApply').checked : true,
        minMatchScore: parseInt(this.rangeMinScore.value, 10),
        maxApplicationsPerSession: parseInt(document.getElementById('sett-maxApps').value, 10),
        maxPagesPerScenario: this.inputMaxPages ? (parseInt(this.inputMaxPages.value, 10) || 2) : 2,
        humanDelayMinMs: parseInt(document.getElementById('sett-delayMin').value, 10),
        humanDelayMaxMs: parseInt(document.getElementById('sett-delayMax').value, 10),
        simulationMode: this.toggleSim.checked,
        mode: this.toggleSemiAuto.checked ? 'semi-auto' : 'auto'
      },
      chrome: {
        ...this.settings.chrome,
        port: parseInt(document.getElementById('sett-chromePort').value, 10),
        executablePath: document.getElementById('sett-chromePath').value.trim()
      }
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      }).then(r => r.json());

      if (res.success) {
        this.settings = updated;
        this.updateModeDisplay();
        this.showToast('Automation settings saved!', 'success');
      }
    } catch (e) {
      this.showToast('Failed to save settings: ' + e.message, 'error');
    }
  }

  async updateSettingsOnServer() {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.settings)
      });
    } catch (e) {}
  }

  async saveAiApiKey() {
    const apiKey = this.inputGeminiKey ? this.inputGeminiKey.value.trim() : '';
    if (!apiKey) {
      this.showToast('Please enter a valid Gemini API key.', 'warning');
      return;
    }

    this.btnSaveAiKey.disabled = true;
    this.btnSaveAiKey.textContent = 'Saving...';
    try {
      const res = await fetch('/api/ai/set-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      }).then(r => r.json());

      if (res.success) {
        this.showToast('Gemini AI connected successfully!', 'success');
        if (res.status) {
          this.renderAiStatus(res.status);
        }
      } else {
        this.showToast(res.error || 'Failed to save API key', 'error');
      }
    } catch (e) {
      this.showToast('Error: ' + e.message, 'error');
    } finally {
      this.btnSaveAiKey.disabled = false;
      this.btnSaveAiKey.textContent = 'Save & Activate';
    }
  }

  renderAiStatus(status) {
    if (!status) return;

    if (this.aiStatusBadge) {
      if (status.initialized) {
        this.aiStatusBadge.className = 'ai-status-badge badge-active';
        this.aiStatusBadge.textContent = 'Active (Gemini 2.5 Flash)';
      } else {
        this.aiStatusBadge.className = 'ai-status-badge badge-inactive';
        this.aiStatusBadge.textContent = 'Not Connected';
      }
    }

    if (this.aiTesterBadge) {
      if (status.initialized) {
        this.aiTesterBadge.className = 'ai-status-badge badge-active';
        this.aiTesterBadge.textContent = 'Hybrid: Local + Gemini AI';
      } else {
        this.aiTesterBadge.className = 'ai-status-badge badge-inactive';
        this.aiTesterBadge.textContent = 'Local Only';
      }
    }

    if (this.aiStatStatus) {
      this.aiStatStatus.innerHTML = status.initialized
        ? '<span style="color: #34d399; font-weight: 600;">✓ Connected & Ready</span>'
        : '<span style="color: #fbbf24;">⏳ Waiting for API key (Local Fallback active)</span>';
    }
  }

  async testAiScreening() {
    const q = this.testQuestionInput.value.trim();
    if (!q) return;

    this.testAnswerText.textContent = 'Agent evaluating (hybrid local + AI)...';
    this.testAnswerSource.textContent = 'Processing...';
    if (this.testAnswerEngine) this.testAnswerEngine.innerHTML = '';

    const startTime = Date.now();
    try {
      const res = await fetch('/api/ai/test-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q })
      }).then(r => r.json());

      const elapsed = Date.now() - startTime;
      this.testAnswerText.textContent = `"${res.answer}"`;

      const isAi = res.source === 'gemini-ai';
      const engineIcon = isAi ? '🤖' : '⚡';
      const engineLabel = isAi ? 'Google Gemini AI' : 'Local Rule Engine';
      const engineClass = isAi ? 'chip-ai' : 'chip-local';

      this.testAnswerSource.textContent = `Source: ${res.source} | Confidence: ${Math.round((res.confidence || 1) * 100)}% | Latency: ${elapsed}ms`;
      if (this.testAnswerEngine) {
        this.testAnswerEngine.innerHTML = `
          <div class="result-badge-row">
            <span class="engine-badge ${engineClass}">${engineIcon} Answered by ${engineLabel}</span>
            ${res.reasoning ? `<span class="engine-reasoning">${this.escapeHTML(res.reasoning)}</span>` : ''}
          </div>
        `;
      }
    } catch (e) {
      this.testAnswerText.textContent = 'Error computing answer: ' + e.message;
      this.testAnswerSource.textContent = 'Failed';
    }
  }

  async startBot() {
    try {
      const res = await fetch('/api/bot/start', { method: 'POST' }).then(r => r.json());
      if (res.success) {
        this.showToast('AutoApply session started!', 'success');
      } else {
        this.showToast(res.message || 'Could not start bot', 'warning');
      }
    } catch (e) {
      this.showToast('Error: ' + e.message, 'error');
    }
  }

  async pauseOrResumeBot() {
    const endpoint = this.state === 'running' ? '/api/bot/pause' : '/api/bot/resume';
    try {
      await fetch(endpoint, { method: 'POST' });
    } catch (e) {
      this.showToast(e.message, 'error');
    }
  }

  async stopBot() {
    try {
      await fetch('/api/bot/stop', { method: 'POST' });
      this.showToast('Automation stopping...', 'info');
    } catch (e) {
      this.showToast(e.message, 'error');
    }
  }

  async autofillCareerPage() {
    try {
      this.showToast('Connecting to Chrome & inspecting career portal tab...', 'info');
      if (this.btnCareerAutofill) {
        this.btnCareerAutofill.disabled = true;
        this.btnCareerAutofill.innerHTML = '<span class="spinner-sm"></span> Autofilling...';
      }

      const res = await fetch('/api/career-site/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).then(r => r.json());

      if (this.btnCareerAutofill) {
        this.btnCareerAutofill.disabled = false;
        this.btnCareerAutofill.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="12" y1="18" x2="12" y2="12"></line>
            <line x1="9" y1="15" x2="15" y2="15"></line>
          </svg>
          Autofill Career Tab
        `;
      }

      if (res.success) {
        const title = res.jobRecord?.title || 'Job';
        const company = res.jobRecord?.company || 'Career Portal';
        const count = (res.result?.filledFields || []).length;
        const qCount = (res.result?.questionsAnswered || []).length;
        this.showToast(`Autofilled "${title}" at ${company}! (${count} fields filled, ${qCount} questions answered, resume attached)`, 'success');
        this.refreshApplicationsData();
      } else {
        this.showToast(res.error || 'Could not autofill career portal.', 'warning');
      }
    } catch (err) {
      if (this.btnCareerAutofill) {
        this.btnCareerAutofill.disabled = false;
        this.btnCareerAutofill.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="12" y1="18" x2="12" y2="12"></line>
            <line x1="9" y1="15" x2="15" y2="15"></line>
          </svg>
          Autofill Career Tab
        `;
      }
      this.showToast('Autofill error: ' + err.message, 'error');
    }
  }

  async clearHistory() {
    if (!confirm('Clear all recorded application history?')) return;
    try {
      await fetch('/api/bot/clear-history', { method: 'POST' });
      this.showToast('Application history cleared.', 'info');
    } catch (e) {
      this.showToast(e.message, 'error');
    }
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${this.escapeHTML(message)}</span>`;
    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ============================================================
  // Q&A AUDIT & ACTIVE RULE LEARNING METHODS
  // ============================================================

  updateQAStats(stats = null) {
    let total = this.qaAuditList.length;
    let geminiCount = 0;
    let localCount = 0;
    let savedRules = 0;

    for (const item of this.qaAuditList) {
      if (item.engine && item.engine.includes('Gemini')) geminiCount++;
      else localCount++;
      if (item.status === 'saved_as_rule') savedRules++;
    }

    if (this.qaBadgeCount) {
      this.qaBadgeCount.textContent = total;
    }
    if (this.qaStatTotal) this.qaStatTotal.textContent = total;
    if (this.qaStatGemini) this.qaStatGemini.textContent = geminiCount;
    if (this.qaStatLocal) this.qaStatLocal.textContent = localCount;
    if (this.qaStatRules) {
      const totalRules = stats?.totalProfileRules || (this.profile?.screeningQA?.length) || savedRules;
      this.qaStatRules.textContent = totalRules;
    }
  }

  filterAndRenderQAAudit() {
    const search = (this.qaSearchInput?.value || '').trim().toLowerCase();
    const platform = this.qaFilterPlatform?.value || 'all';
    const engine = this.qaFilterEngine?.value || 'all';
    const status = this.qaFilterStatus?.value || 'all';

    this.qaFilteredList = this.qaAuditList.filter(item => {
      // Platform filter
      if (platform !== 'all' && (item.platform || '').toLowerCase() !== platform.toLowerCase()) {
        return false;
      }

      // Engine filter
      if (engine !== 'all') {
        if (engine === 'Gemini AI' && !item.engine?.includes('Gemini')) return false;
        if (engine === 'Local Rule' && item.engine?.includes('Gemini')) return false;
        if (engine === 'Verified Memory Rule' && item.status !== 'saved_as_rule') return false;
      }

      // Status filter
      if (status !== 'all' && (item.status || 'auto') !== status) {
        return false;
      }

      // Search query
      if (search) {
        const qMatch = (item.question || '').toLowerCase().includes(search);
        const aMatch = (item.answer || '').toLowerCase().includes(search);
        const cMatch = (item.company || '').toLowerCase().includes(search);
        const tMatch = (item.jobTitle || '').toLowerCase().includes(search);
        if (!qMatch && !aMatch && !cMatch && !tMatch) return false;
      }

      return true;
    });

    this.renderQAAudit();
  }

  renderQAAudit() {
    if (!this.qaItemsContainer) return;

    if (this.qaFilteredList.length === 0) {
      this.qaItemsContainer.innerHTML = `
        <div class="qa-empty-state">
          <div class="qa-empty-icon">🔍</div>
          <h4>No Screening Questions Found</h4>
          <p>Questions answered by Gemini AI or local rules during job applications will be audited here in real-time.</p>
        </div>
      `;
      return;
    }

    this.qaItemsContainer.innerHTML = this.qaFilteredList.map((item) => {
      const isGemini = (item.engine || '').includes('Gemini');
      const isVerified = item.status === 'saved_as_rule';
      const engineClass = isVerified ? 'chip-verified' : (isGemini ? 'chip-ai' : 'chip-local');
      const engineIcon = isVerified ? '⭐' : (isGemini ? '🤖' : '⚡');
      const engineLabel = isVerified ? 'Verified Memory Rule' : (isGemini ? 'Gemini 2.5 Flash' : 'Local Rule Engine');

      const cardModifier = isVerified ? 'qa-status-verified' : (isGemini ? 'qa-engine-gemini' : 'qa-engine-local');

      // Platform badge class
      const platLower = (item.platform || '').toLowerCase();
      let platClass = 'platform-tester';
      if (platLower.includes('linkedin')) platClass = 'platform-linkedin';
      else if (platLower.includes('naukri')) platClass = 'platform-naukri';
      else if (platLower.includes('foundit')) platClass = 'platform-foundit';

      // Format time
      const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent';

      // Options rendering
      let optionsHtml = '';
      if (item.options && item.options.length > 0) {
        optionsHtml = `
          <div class="qa-options-pills">
            ${item.options.map(opt => {
              const isSelected = item.answer && opt.toLowerCase().includes(item.answer.toLowerCase());
              return `<span class="qa-option-pill ${isSelected ? 'is-selected' : ''}">${this.escapeHTML(opt)}</span>`;
            }).join('')}
          </div>
        `;
      }

      return `
        <div class="qa-card ${cardModifier}" id="qa-card-${this.escapeHTML(item.id)}">
          <div class="qa-card-header">
            <div class="qa-card-meta">
              <span class="qa-platform-badge ${platClass}">${this.escapeHTML(item.platform || 'General')}</span>
              <span class="qa-job-context">
                <strong>${this.escapeHTML(item.company || 'Direct Recruiter')}</strong> · ${this.escapeHTML(item.jobTitle || 'Role Application')}
              </span>
            </div>
            <div class="qa-card-header-right">
              <span class="engine-badge ${engineClass}">${engineIcon} ${engineLabel}</span>
              <span class="qa-timestamp">${timeStr}</span>
            </div>
          </div>

          <div class="qa-question-row">
            <span class="qa-q-icon">Q</span>
            <div class="qa-question-text">${this.escapeHTML(item.question)}</div>
            <span class="qa-input-type-tag">${this.escapeHTML(item.inputType || 'text')}</span>
          </div>

          ${optionsHtml}

          <div class="qa-answer-box">
            <div class="qa-answer-label-row">
              <span>Answer provided to application:</span>
              <span class="qa-confidence-badge">${Math.round((item.confidence || 0.9) * 100)}% Confidence</span>
            </div>
            <input type="text" 
                   class="qa-editable-answer-input" 
                   id="qa-ans-input-${this.escapeHTML(item.id)}" 
                   value="${this.escapeHTML(item.answer)}" 
                   placeholder="Type your preferred answer here...">
            ${item.reasoning ? `
              <div class="qa-reasoning-snippet">
                <span>💡 Reasoning:</span>
                <span>${this.escapeHTML(item.reasoning)}</span>
              </div>
            ` : ''}
          </div>

          <div class="qa-card-footer">
            <div class="qa-card-footer-left">
              ${isVerified ? `
                <span class="qa-verified-badge">✓ Active Profile Memory Rule</span>
                <button class="btn-save-rule" onclick="window.autoApplyApp.saveRuleFromAudit('${this.escapeHTML(item.id)}')">
                  Update Memory Rule
                </button>
              ` : `
                <button class="btn-save-rule" onclick="window.autoApplyApp.saveRuleFromAudit('${this.escapeHTML(item.id)}')">
                  ⭐ Save as Permanent Memory Rule
                </button>
              `}
            </div>
            <button class="btn-delete-qa-item" title="Delete from audit history" onclick="window.autoApplyApp.deleteQaItem('${this.escapeHTML(item.id)}')">
              Remove
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  async saveRuleFromAudit(id) {
    const item = this.qaAuditList.find(i => i.id === id);
    if (!item) return;

    const inputEl = document.getElementById(`qa-ans-input-${id}`);
    const answerToSave = inputEl ? inputEl.value.trim() : item.answer;

    try {
      const res = await fetch('/api/qa-audit/save-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          question: item.question,
          answer: answerToSave,
          answerType: 'fixed'
        })
      }).then(r => r.json());

      if (res.success) {
        item.status = 'saved_as_rule';
        item.answer = answerToSave;
        this.filterAndRenderQAAudit();
        this.updateQAStats();
        this.showToast(`Saved as permanent memory rule! Future matching questions will use "${answerToSave}".`, 'success');
        
        // Refresh profile tab to reflect the new rule
        fetch('/api/profile').then(r => r.json()).then(p => {
          this.profile = p;
          this.populateProfileForm();
        }).catch(() => null);
      } else {
        this.showToast('Failed to save rule: ' + (res.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      this.showToast('Error saving rule: ' + err.message, 'error');
    }
  }

  async deleteQaItem(id) {
    try {
      const res = await fetch(`/api/qa-audit/${id}`, { method: 'DELETE' }).then(r => r.json());
      if (res.success) {
        this.qaAuditList = this.qaAuditList.filter(i => i.id !== id);
        this.filterAndRenderQAAudit();
        this.updateQAStats();
        this.showToast('Question removed from audit trail.', 'info');
      }
    } catch (err) {
      this.showToast('Error removing entry: ' + err.message, 'error');
    }
  }

  async clearQAAudit() {
    if (!confirm('Clear all recorded screening Q&A audit logs?')) return;
    try {
      await fetch('/api/qa-audit/clear', { method: 'POST' });
      this.qaAuditList = [];
      this.filterAndRenderQAAudit();
      this.updateQAStats();
      this.showToast('Screening Q&A audit trail cleared.', 'info');
    } catch (err) {
      this.showToast('Error: ' + err.message, 'error');
    }
  }

  exportQAAudit() {
    if (this.qaAuditList.length === 0) {
      this.showToast('No audit entries to export.', 'warning');
      return;
    }
    const blob = new Blob([JSON.stringify(this.qaAuditList, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `autoapply_qa_audit_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast('Exported audit log JSON!', 'success');
  }

  async runQaQuickTest() {
    const q = (this.qaQuickQuestionInput?.value || '').trim();
    if (!q) {
      this.showToast('Please enter a screening question to test.', 'warning');
      return;
    }

    if (this.btnQaQuickTest) {
      this.btnQaQuickTest.disabled = true;
      this.btnQaQuickTest.innerHTML = '<span>Thinking...</span>';
    }

    try {
      const res = await fetch('/api/ai/test-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q })
      }).then(r => r.json());

      if (this.qaQuickResult) {
        this.qaQuickResult.style.display = 'block';
        const isGemini = res.source?.includes('Gemini') || res.aiPowered;
        const icon = isGemini ? '🤖' : '⚡';
        const label = isGemini ? 'Gemini 2.5 Flash' : 'Local Memory Rule';
        const badgeClass = isGemini ? 'chip-ai' : 'chip-local';

        this.qaQuickResult.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span class="engine-badge ${badgeClass}">${icon} Answered by ${label}</span>
            <span style="font-size: 0.78rem; color: #34d399; font-weight: 600;">${Math.round((res.confidence || 0.9) * 100)}% Confidence</span>
          </div>
          <div style="font-size: 1.05rem; font-weight: 600; color: #fff; margin-bottom: 8px;">"${this.escapeHTML(res.answer)}"</div>
          ${res.source ? `<div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 12px;"><strong>Source / Reason:</strong> ${this.escapeHTML(res.source)}</div>` : ''}
          <div style="display: flex; gap: 10px;">
            <button class="btn-save-rule" onclick="window.autoApplyApp.saveCustomQuickRule('${this.escapeHTML(q)}', '${this.escapeHTML(res.answer)}')">
              ⭐ Save Answer as Permanent Rule
            </button>
          </div>
        `;
      }
      this.showToast('Question evaluated and logged to audit trail!', 'success');
    } catch (err) {
      this.showToast('Error testing question: ' + err.message, 'error');
    } finally {
      if (this.btnQaQuickTest) {
        this.btnQaQuickTest.disabled = false;
        this.btnQaQuickTest.innerHTML = '<span>Ask AI Agent</span>';
      }
    }
  }

  async saveCustomQuickRule(question, answer) {
    try {
      const res = await fetch('/api/qa-audit/save-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer, answerType: 'fixed' })
      }).then(r => r.json());

      if (res.success) {
        this.showToast(`Saved rule for "${question}" -> "${answer}"!`, 'success');
        this.loadInitialData();
      }
    } catch (err) {
      this.showToast('Error: ' + err.message, 'error');
    }
  }

  // ============================================================
  // MISSING & UNFILLED FIELDS MANAGEMENT METHODS
  // ============================================================

  switchToTab(tabName) {
    const btn = document.getElementById(`tab-btn-${tabName}`);
    if (btn) btn.click();
  }

  addOrUpdateUnfilledQuestion(entry) {
    const idx = this.unfilledQuestions.findIndex(q => q.id === entry.id || q.question.toLowerCase() === entry.question.toLowerCase());
    if (idx >= 0) {
      this.unfilledQuestions[idx] = entry;
    } else {
      this.unfilledQuestions.unshift(entry);
    }
    this.renderUnfilledQuestions();
  }

  async loadUnfilledQuestions() {
    try {
      const res = await fetch('/api/unfilled-questions').then(r => r.json());
      if (res.success) {
        this.unfilledQuestions = res.unfilledQuestions || [];
        this.renderUnfilledQuestions();
        this.showToast('Missing fields list updated', 'info');
      }
    } catch (e) {
      this.showToast('Failed to refresh missing fields: ' + e.message, 'error');
    }
  }

  renderUnfilledQuestions() {
    const count = this.unfilledQuestions.length;
    if (this.unfilledBadgeCount) {
      this.unfilledBadgeCount.textContent = count;
    }
    if (this.tabBtnUnfilled) {
      if (count > 0) {
        this.tabBtnUnfilled.classList.add('has-unfilled');
      } else {
        this.tabBtnUnfilled.classList.remove('has-unfilled');
      }
    }

    if (this.unfilledStatPending) {
      this.unfilledStatPending.textContent = count;
    }
    if (this.unfilledStatRules) {
      this.unfilledStatRules.textContent = (this.profile?.screeningQA || []).length;
    }
    if (this.unfilledStatTotalQa) {
      this.unfilledStatTotalQa.textContent = this.qaAuditList.length;
    }

    // Monitor banner
    if (this.unfilledAlertBanner && this.unfilledBannerText) {
      if (count > 0) {
        this.unfilledAlertBanner.style.display = 'flex';
        this.unfilledBannerText.textContent = `${count} application field${count > 1 ? 's' : ''} require your manual review/input!`;
      } else {
        this.unfilledAlertBanner.style.display = 'none';
      }
    }

    if (!this.unfilledItemsContainer) return;

    if (count === 0) {
      this.unfilledItemsContainer.innerHTML = `
        <div class="unfilled-empty-box">
          <div class="unfilled-empty-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <span class="unfilled-empty-title">All Form Fields Covered!</span>
          <span class="unfilled-empty-desc">Your agent has filled all encountered fields accurately using Candidate Profile data and verified memory rules. Whenever an unrecognized or skipped question appears on LinkedIn, Naukri, or Foundit, it will immediately show up here.</span>
        </div>
      `;
      return;
    }

    this.unfilledItemsContainer.innerHTML = this.unfilledQuestions.map(item => {
      const typeBadge = (item.inputType || 'text').toUpperCase();
      const options = item.options || [];
      const isNumber = item.inputType === 'number';

      return `
        <div class="unfilled-card-item" id="unfilled-card-${item.id}">
          <div class="unfilled-item-header">
            <div class="unfilled-badges">
              <span class="badge-unfilled-warning">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path></svg>
                Needs Input
              </span>
              <span class="badge-type-pill">[${typeBadge}]</span>
              <span class="qa-platform-badge qa-platform-${(item.platform || 'General').toLowerCase()}">${item.platform}</span>
              ${item.occurrences > 1 ? `<span class="badge badge-warning" style="font-size: 0.72rem;">Seen ${item.occurrences}x</span>` : ''}
            </div>
            <div class="unfilled-job-context">
              <strong>${this.escapeHTML(item.jobTitle || 'Job')}</strong> at ${this.escapeHTML(item.company || 'Company')}
            </div>
          </div>

          <div class="unfilled-question-text">
            "${this.escapeHTML(item.question)}"
          </div>

          ${item.reason ? `
            <div class="unfilled-reason-box">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              <span><strong>Detection Note:</strong> ${this.escapeHTML(item.reason)}</span>
            </div>
          ` : ''}

          ${options.length > 0 ? `
            <div class="unfilled-options-row">
              <span class="unfilled-options-label">Click option to select:</span>
              ${options.map(opt => `
                <button type="button" class="unfilled-opt-pill" onclick="window.autoApplyApp.pickUnfilledOption('${item.id}', '${this.escapeHTML(opt)}')">
                  ${this.escapeHTML(opt)}
                </button>
              `).join('')}
            </div>
          ` : ''}

          <div class="unfilled-input-action-row">
            <input 
              type="${isNumber ? 'number' : 'text'}" 
              id="input-unfilled-ans-${item.id}" 
              class="form-input" 
              placeholder="${isNumber ? 'Enter numeric value (e.g. 3, 30, 4.10)' : 'Enter your verified answer (e.g. Hyderabad, 30 days, Yes)...'}"
              value="${this.escapeHTML(item.currentVal || '')}"
            >
            <button class="btn btn-primary" onclick="window.autoApplyApp.resolveUnfilled('${item.id}', '${this.escapeHTML(item.question)}', '${item.inputType || 'text'}')">
              💾 Save & Remember Forever
            </button>
            <button class="btn btn-secondary" onclick="window.autoApplyApp.dismissUnfilled('${item.id}')" title="Dismiss this question">
              ✕ Dismiss
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  pickUnfilledOption(id, optText) {
    const input = document.getElementById(`input-unfilled-ans-${id}`);
    if (input) {
      input.value = optText;
      input.focus();
    }
  }

  async resolveUnfilled(id, question, inputType) {
    const input = document.getElementById(`input-unfilled-ans-${id}`);
    const answer = input ? input.value.trim() : '';

    if (!answer) {
      this.showToast('Please type an answer before saving.', 'warning');
      if (input) input.focus();
      return;
    }

    try {
      const res = await fetch('/api/unfilled-questions/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          question,
          answer,
          inputType,
          saveAsRule: true
        })
      }).then(r => r.json());

      if (res.success) {
        this.showToast(`Saved answer & memory rule for "${question.slice(0, 30)}..."!`, 'success');
        this.unfilledQuestions = this.unfilledQuestions.filter(q => q.id !== id);
        this.renderUnfilledQuestions();
        this.loadInitialData(); // Refresh profile & rules count
      } else {
        this.showToast('Failed to save answer: ' + (res.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      this.showToast('Error saving: ' + err.message, 'error');
    }
  }

  async dismissUnfilled(id) {
    try {
      const res = await fetch(`/api/unfilled-questions/${id}`, { method: 'DELETE' }).then(r => r.json());
      if (res.success) {
        this.unfilledQuestions = this.unfilledQuestions.filter(q => q.id !== id);
        this.renderUnfilledQuestions();
        this.showToast('Question dismissed.', 'info');
      }
    } catch (err) {
      this.showToast('Failed to dismiss: ' + err.message, 'error');
    }
  }

  async clearAllUnfilled() {
    if (!confirm('Clear all pending missing fields?')) return;
    try {
      const res = await fetch('/api/unfilled-questions/clear', { method: 'POST' }).then(r => r.json());
      if (res.success) {
        this.unfilledQuestions = [];
        this.renderUnfilledQuestions();
        this.showToast('All missing fields cleared.', 'info');
      }
    } catch (err) {
      this.showToast('Error: ' + err.message, 'error');
    }
  }

  async handleManualAddRule() {
    const q = this.inputManualQuestion?.value.trim() || '';
    const a = this.inputManualAnswer?.value.trim() || '';
    const type = this.selectManualType?.value || 'text';

    if (!q || !a) {
      this.showToast('Please enter both Question/Field label and your Answer.', 'warning');
      return;
    }

    try {
      if (this.btnManualAddRule) {
        this.btnManualAddRule.disabled = true;
        this.btnManualAddRule.innerHTML = '<span>Saving...</span>';
      }

      const res = await fetch('/api/unfilled-questions/manual-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          answer: a,
          inputType: type,
          platform: 'Manual Input',
          saveAsRule: true
        })
      }).then(r => r.json());

      if (res.success) {
        this.showToast(`Saved permanent memory rule: "${q}" -> "${a}"!`, 'success');
        if (this.inputManualQuestion) this.inputManualQuestion.value = '';
        if (this.inputManualAnswer) this.inputManualAnswer.value = '';
        this.loadInitialData();
      } else {
        this.showToast('Error: ' + (res.error || 'Failed to save'), 'error');
      }
    } catch (err) {
      this.showToast('Error adding rule: ' + err.message, 'error');
    } finally {
      if (this.btnManualAddRule) {
        this.btnManualAddRule.disabled = false;
        this.btnManualAddRule.innerHTML = '<span>💾 Save & Remember in Memory</span>';
      }
    }
  }

  // ============================================================
  // LIVE GEMINI API TELEMETRY & DIAGNOSTIC UI CONTROLLER
  // ============================================================
  updateAiTelemetryUI(telemetry) {
    if (!telemetry) return;

    // 1. Model & Key Badges
    if (this.aiModelBadge && telemetry.model) {
      this.aiModelBadge.textContent = telemetry.model;
    }
    if (this.aiKeyBadge) {
      const idx = (telemetry.activeKeyIndex || 0) + 1;
      const total = telemetry.totalKeys || 1;
      this.aiKeyBadge.textContent = `Key ${idx}/${total}`;
      this.aiKeyBadge.title = `Active key pool snippet: ${telemetry.activeKeySnippet || 'None'}`;
    }

    // 2. Status Dot & Text
    if (this.aiStatusDot && this.aiStatusText) {
      this.aiStatusDot.className = 'status-dot';
      if (telemetry.status === 'calling') {
        this.aiStatusDot.classList.add('dot-calling');
        this.aiStatusText.textContent = 'Calling Gemini API...';
      } else if (telemetry.status === 'throttled' || telemetry.isThrottled) {
        this.aiStatusDot.classList.add('dot-throttled');
        const rem = telemetry.cooldownRemainingSeconds || 0;
        this.aiStatusText.textContent = `Throttled (429 Quota - ${rem}s)`;
      } else if (telemetry.status === 'error') {
        this.aiStatusDot.classList.add('dot-error');
        this.aiStatusText.textContent = 'API Error';
      } else {
        this.aiStatusDot.classList.add('dot-connected');
        this.aiStatusText.textContent = 'Ready & Active';
      }
    }

    // 3. Error Banner & Reset Button
    if (this.aiErrorBanner) {
      if (telemetry.isThrottled) {
        this.aiErrorBanner.style.display = 'flex';
        if (this.aiErrorTitle) this.aiErrorTitle.textContent = 'Gemini Quota / Rate-Limit (429 Cooldown)';
        if (this.aiCooldownTimer) this.aiCooldownTimer.textContent = telemetry.cooldownRemainingSeconds || 0;
        if (this.btnResetCooldown) this.btnResetCooldown.style.display = 'inline-flex';
      } else if (telemetry.status === 'error' && telemetry.lastCall?.error) {
        this.aiErrorBanner.style.display = 'flex';
        if (this.aiErrorTitle) this.aiErrorTitle.textContent = 'Gemini API Error';
        if (this.aiErrorMessage) this.aiErrorMessage.textContent = telemetry.lastCall.error;
        if (this.btnResetCooldown) this.btnResetCooldown.style.display = 'none';
      } else {
        this.aiErrorBanner.style.display = 'none';
        if (this.btnResetCooldown) this.btnResetCooldown.style.display = 'none';
      }
    }

    // 4. Metrics Ribbon
    if (this.telemetryTotalCalls) this.telemetryTotalCalls.textContent = telemetry.stats?.totalCalls || 0;
    if (this.telemetrySuccessCalls) this.telemetrySuccessCalls.textContent = telemetry.stats?.successCalls || 0;
    if (this.telemetryFailedCalls) {
      const fails = (telemetry.stats?.failedCalls || 0) + (telemetry.stats?.throttledCalls || 0);
      this.telemetryFailedCalls.textContent = fails;
    }
    if (this.telemetryLatency) {
      this.telemetryLatency.textContent = telemetry.lastCallLatencyMs ? `${telemetry.lastCallLatencyMs} ms` : '-- ms';
    }
    if (this.telemetryKeySnippet) {
      this.telemetryKeySnippet.textContent = telemetry.activeKeySnippet || '--';
    }

    // 5. Current or Last Call Inspector
    const activeCall = telemetry.currentCall;
    const lastCall = telemetry.lastCall;

    if (activeCall) {
      if (this.telemetryLastQuestion) this.telemetryLastQuestion.textContent = activeCall.question || '--';
      if (this.telemetryLastMeta) {
        this.telemetryLastMeta.textContent = `Platform: ${activeCall.context?.platform || 'General'} • Company: ${activeCall.context?.company || 'N/A'} • Type: ${activeCall.inputType || 'text'}`;
      }
      if (this.telemetryFullPrompt) this.telemetryFullPrompt.textContent = activeCall.promptSnippet || 'Sending to Gemini API...';
      if (this.telemetryReqTime) this.telemetryReqTime.textContent = 'Now (In Progress)';
      if (this.telemetryResStatus) this.telemetryResStatus.textContent = 'Streaming response...';
      if (this.telemetryParsedAnswer) this.telemetryParsedAnswer.textContent = 'Waiting for response...';
    } else if (lastCall) {
      if (this.telemetryLastQuestion) this.telemetryLastQuestion.textContent = lastCall.question || '--';
      if (this.telemetryLastMeta) {
        this.telemetryLastMeta.textContent = `Platform: ${lastCall.context?.platform || 'General'} • Company: ${lastCall.context?.company || 'N/A'} • Type: ${lastCall.inputType || 'text'} • Latency: ${lastCall.latencyMs || 0}ms`;
      }
      if (this.telemetryFullPrompt) this.telemetryFullPrompt.textContent = lastCall.prompt || 'No prompt recorded';
      if (this.telemetryReqTime) {
        const timeStr = lastCall.timestamp ? new Date(lastCall.timestamp).toLocaleTimeString() : 'Recent';
        this.telemetryReqTime.textContent = timeStr;
      }
      if (this.telemetryResStatus) {
        this.telemetryResStatus.textContent = lastCall.status === 'success' ? `✅ Success (${lastCall.latencyMs}ms)` : `⚠️ ${lastCall.status.toUpperCase()}`;
      }
      if (this.telemetryParsedAnswer) {
        this.telemetryParsedAnswer.textContent = lastCall.finalAnswer || '--';
      }
      if (this.telemetryAiReasoning) {
        this.telemetryAiReasoning.textContent = lastCall.parsedResponse?.reasoning || lastCall.error || 'Autofilled successfully based on candidate profile.';
      }
      if (this.telemetryRawResponse) {
        if (lastCall.rawResponse) {
          try {
            const pretty = JSON.stringify(JSON.parse(lastCall.rawResponse), null, 2);
            this.telemetryRawResponse.textContent = pretty;
          } catch (e) {
            this.telemetryRawResponse.textContent = lastCall.rawResponse;
          }
        } else if (lastCall.error) {
          this.telemetryRawResponse.textContent = `ERROR: ${lastCall.error}`;
        }
      }
    }
  }

  async runGeminiTestCall() {
    if (!this.btnTestGeminiApi) return;
    const originalText = this.btnTestGeminiApi.innerHTML;
    this.btnTestGeminiApi.disabled = true;
    this.btnTestGeminiApi.innerHTML = '<span class="status-dot dot-calling"></span> Testing...';

    const testQuestion = 'How many years of experience do you have with Angular and Java?';
    this.showToast('🚀 Sending test question to Gemini API...', 'info');

    try {
      const res = await fetch('/api/ai/test-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: testQuestion })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`✅ Gemini responded in ${data.latencyMs}ms: "${data.answer}"`, 'success');
        if (data.telemetry) this.updateAiTelemetryUI(data.telemetry);
      } else {
        this.showToast(`⚠️ Gemini error: ${data.error || 'Unknown error'}`, 'error');
        if (data.telemetry) this.updateAiTelemetryUI(data.telemetry);
      }
    } catch (err) {
      this.showToast(`❌ Connection error: ${err.message}`, 'error');
    } finally {
      this.btnTestGeminiApi.disabled = false;
      this.btnTestGeminiApi.innerHTML = originalText;
    }
  }

  // ============================================================
  // MANUAL APPLICATION QUEUE (PHASE 5)
  // ============================================================
  async loadManualQueue() {
    try {
      const fit = this.mqFilterFit ? this.mqFilterFit.value : 0;
      const platform = this.mqFilterPlatform ? this.mqFilterPlatform.value : 'all';
      const status = this.mqFilterStatus ? this.mqFilterStatus.value : 'all';
      const sort = this.mqSortBy ? this.mqSortBy.value : 'highest_fit';
      const search = this.mqSearchInput ? encodeURIComponent(this.mqSearchInput.value.trim()) : '';

      const url = `/api/manual-queue?minFitScore=${fit}&platform=${platform}&status=${status}&sort=${sort}&search=${search}&limit=100`;
      const res = await fetch(url).then(r => r.json());

      if (res.success) {
        this.manualQueueItems = res.items || [];
        this.renderManualQueueCards(this.manualQueueItems);
        if (res.stats) {
          if (this.badgeManualQueue) this.badgeManualQueue.textContent = res.stats.pendingCount || 0;
          if (this.mqPendingBadge) this.mqPendingBadge.textContent = `${res.stats.pendingCount || 0} Pending`;
          if (this.statManualQueue) this.statManualQueue.textContent = res.stats.pendingCount || 0;
        }
      }
    } catch (err) {
      console.error('[ManualQueue] Error loading queue:', err);
    }
  }

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  renderManualQueueCards(items) {
    if (!this.mqItemsContainer) return;

    if (!items || items.length === 0) {
      this.mqItemsContainer.innerHTML = '';
      if (this.mqEmptyState) this.mqEmptyState.style.display = 'block';
      return;
    }

    if (this.mqEmptyState) this.mqEmptyState.style.display = 'none';

    this.mqItemsContainer.innerHTML = items.map(job => {
      const fitScore = job.overallFitScore || job.matchScore || 0;
      const techScore = job.technicalScore || fitScore;
      const expCategory = (job.experienceCompatibility || 'meets_required').replace(/_/g, ' ');

      let priorityClass = 'badge-normal';
      let priorityLabel = 'MODERATE MATCH';
      if (fitScore >= 85) {
        priorityClass = 'badge-high';
        priorityLabel = 'HIGH PRIORITY MATCH';
      } else if (fitScore >= 75) {
        priorityClass = 'badge-medium';
        priorityLabel = 'STRONG MATCH';
      }

      const isCompleted = job.status === 'APPLIED_CONFIRMED' || job.status === 'applied';
      const isNotInterested = job.status === 'NOT_INTERESTED';

      const appUrl = job.directApplicationUrl || job.directApplyUrl || job.jobListingUrl || job.url || '#';
      const hasDirectUrl = !!(job.directApplicationUrl || job.directApplyUrl);
      const listingUrl = job.jobListingUrl || job.url || appUrl;

      const matchedSkillsHtml = (job.matchedSkills || []).slice(0, 6)
        .map(s => `<span class="skill-tag match-tag">✓ ${this.escapeHtml(s)}</span>`).join('');
      const missingSkillsHtml = (job.missingRequiredSkills || []).slice(0, 3)
        .map(s => `<span class="skill-tag miss-tag">✗ ${this.escapeHtml(s)}</span>`).join('');

      return `
        <div class="mq-card ${isCompleted ? 'mq-card-completed' : ''}" id="mq-card-${job.id}">
          <div class="mq-card-header">
            <div class="mq-badge-group">
              <span class="mq-priority-badge ${priorityClass}">${priorityLabel}</span>
              <span class="mq-exp-badge" title="Experience alignment category">🎓 ${expCategory} (${this.escapeHtml(job.requiredExperience || '1-4 yrs')})</span>
              <span class="mq-platform-badge">🌐 ${this.escapeHtml(job.sourcePlatform || 'Job Portal')}</span>
            </div>
            <div class="mq-score-dial">
              <div class="mq-score-val">${fitScore}%</div>
              <div class="mq-score-lbl">Overall Fit</div>
            </div>
          </div>

          <div class="mq-card-body">
            <h4 class="mq-job-title">
              <a href="${this.escapeHtml(appUrl)}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: none;" title="Open application link in new tab">
                ${this.escapeHtml(job.title)} <span style="font-size: 0.8em; color: #38bdf8;">↗</span>
              </a>
            </h4>
            <div class="mq-company-meta">
              <span class="mq-company">🏢 ${this.escapeHtml(job.company)}</span>
              <span class="mq-location">📍 ${this.escapeHtml(job.location || 'India')}</span>
              <span class="mq-workmode">💻 ${this.escapeHtml(job.workMode || 'Hybrid')}</span>
            </div>

            <!-- Direct URL Link Display on Screen -->
            <div class="mq-direct-url-box" style="margin: 10px 0 12px 0; padding: 10px 14px; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 8px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px;">
                <span style="font-size: 0.75rem; font-weight: 700; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.5px;">
                  🔗 DIRECT APPLICATION LINK:
                </span>
                <button class="btn btn-secondary btn-xs btn-copy-mq-link" data-url="${this.escapeHtml(appUrl)}" style="padding: 2px 8px; font-size: 0.75rem; cursor: pointer;">
                  📋 Copy Link
                </button>
              </div>
              <a href="${this.escapeHtml(appUrl)}" target="_blank" rel="noopener noreferrer" style="color: #67e8f9; font-size: 0.88rem; font-weight: 500; text-decoration: underline; word-break: break-all; display: block; line-height: 1.4;">
                ${this.escapeHtml(appUrl)} ↗
              </a>
            </div>

            <div class="mq-reason-callout">
              <span class="mq-reason-icon">⚠️</span>
              <div class="mq-reason-text">
                <strong>Manual Action Required:</strong> ${this.escapeHtml(job.reason || 'External employer portal requires manual submission')}
              </div>
            </div>

            <div class="mq-skills-container">
              <div class="mq-skills-row">
                <span class="mq-skills-label">Matched Skills:</span>
                <div class="mq-tags">${matchedSkillsHtml || '<span class="skill-tag">General Developer</span>'}</div>
              </div>
              ${missingSkillsHtml ? `
                <div class="mq-skills-row">
                  <span class="mq-skills-label">Gaps:</span>
                  <div class="mq-tags">${missingSkillsHtml}</div>
                </div>
              ` : ''}
            </div>

            ${job.notes ? `
              <div class="mq-user-notes">
                <strong>📝 Notes:</strong> ${this.escapeHtml(job.notes)}
              </div>
            ` : ''}
          </div>

          <div class="mq-card-footer">
            <div class="mq-links-group" style="display: flex; gap: 8px; flex-wrap: wrap;">
              <a href="${this.escapeHtml(appUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-accent btn-sm mq-apply-btn" style="font-weight: 600; padding: 7px 16px; background: #2563eb; color: #ffffff; box-shadow: 0 0 14px rgba(37, 99, 235, 0.45); display: inline-flex; align-items: center; gap: 6px;" title="Open application page in a new browser tab">
                🚀 Open & Apply Online Now
              </a>
              ${hasDirectUrl && listingUrl && listingUrl !== appUrl ? `
                <a href="${this.escapeHtml(listingUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" title="View original listing page">
                  🌐 View Job Posting
                </a>
              ` : ''}
            </div>

            <div class="mq-actions-group">
              ${isCompleted ? `
                <span class="mq-status-done">✅ Applied on ${new Date(job.appliedAt || Date.now()).toLocaleDateString()}</span>
              ` : isNotInterested ? `
                <span class="mq-status-dismissed">Archived (Not Interested)</span>
              ` : `
                <button class="btn btn-primary btn-sm btn-mq-mark-applied" data-id="${job.id}">
                  ✓ Mark Applied
                </button>
                <button class="btn btn-secondary btn-sm btn-mq-notes" data-id="${job.id}" title="Add/Edit Notes">
                  📝 Notes
                </button>
                <button class="btn btn-danger-soft btn-sm btn-mq-dismiss" data-id="${job.id}" title="Mark as not interested">
                  ✕ Dismiss
                </button>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Bind copy link buttons
    this.mqItemsContainer.querySelectorAll('.btn-copy-mq-link').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const url = e.currentTarget.getAttribute('data-url');
        if (url) {
          navigator.clipboard.writeText(url).then(() => {
            const originalText = e.currentTarget.innerText;
            e.currentTarget.innerText = '✓ Copied!';
            setTimeout(() => { e.currentTarget.innerText = originalText; }, 1500);
          });
        }
      });
    });

    // Bind item action buttons
    this.mqItemsContainer.querySelectorAll('.btn-mq-mark-applied').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const job = this.manualQueueItems.find(j => j.id === id);
        if (job) this.openMarkAppliedModal(job);
      });
    });

    this.mqItemsContainer.querySelectorAll('.btn-mq-notes').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const job = this.manualQueueItems.find(j => j.id === id);
        if (job) this.openNotesModal(job);
      });
    });

    this.mqItemsContainer.querySelectorAll('.btn-mq-dismiss').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm('Mark this job as Not Interested?')) {
          this.updateManualQueueStatus(id, 'NOT_INTERESTED', 'Candidate marked as not interested');
        }
      });
    });
  }

  openMarkAppliedModal(job) {
    this.mqActiveModalJob = job;
    if (this.mqModalJobTitle) {
      this.mqModalJobTitle.textContent = `${job.title} at ${job.company}`;
    }
    if (this.mqModalAppliedDate) {
      this.mqModalAppliedDate.value = new Date().toISOString().split('T')[0];
    }
    if (this.mqModalConfId) this.mqModalConfId.value = '';
    if (this.mqModalNotes) this.mqModalNotes.value = '';
    if (this.mqAppliedModal) this.mqAppliedModal.style.display = 'flex';
  }

  async submitMarkApplied() {
    if (!this.mqActiveModalJob) return;
    const id = this.mqActiveModalJob.id;
    const confId = this.mqModalConfId ? this.mqModalConfId.value.trim() : '';
    const appliedDate = this.mqModalAppliedDate?.value ? new Date(this.mqModalAppliedDate.value).toISOString() : new Date().toISOString();
    const notes = this.mqModalNotes ? this.mqModalNotes.value.trim() : '';
    const isSelfReported = this.mqModalVerifiedCheck ? this.mqModalVerifiedCheck.checked : true;

    try {
      const res = await fetch('/api/manual-queue/mark-applied', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          confirmationId: confId,
          notes,
          appliedDate,
          isSelfReported
        })
      }).then(r => r.json());

      if (res.success) {
        this.showToast('✅ Application recorded successfully!', 'success');
        this.closeMqModals();
        this.loadManualQueue();
      } else {
        this.showToast(`Error: ${res.error || 'Failed to record application'}`, 'error');
      }
    } catch (err) {
      this.showToast(`Error: ${err.message}`, 'error');
    }
  }

  async updateManualQueueStatus(id, status, reason = '') {
    try {
      const res = await fetch('/api/manual-queue/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, reason })
      }).then(r => r.json());

      if (res.success) {
        this.showToast(`Status updated to ${status}`, 'info');
        this.loadManualQueue();
      }
    } catch (err) {
      this.showToast(`Error updating status: ${err.message}`, 'error');
    }
  }

  openNotesModal(job) {
    this.mqActiveModalJob = job;
    if (this.mqNotesJobTitle) {
      this.mqNotesJobTitle.textContent = `${job.title} at ${job.company}`;
    }
    if (this.mqEditNotesInput) {
      this.mqEditNotesInput.value = job.notes || '';
    }
    if (this.mqNotesModal) this.mqNotesModal.style.display = 'flex';
  }

  async submitSaveNotes() {
    if (!this.mqActiveModalJob) return;
    const id = this.mqActiveModalJob.id;
    const notes = this.mqEditNotesInput ? this.mqEditNotesInput.value.trim() : '';

    try {
      const res = await fetch('/api/manual-queue/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, notes })
      }).then(r => r.json());

      if (res.success) {
        this.showToast('Notes saved successfully', 'success');
        this.closeMqModals();
        this.loadManualQueue();
      }
    } catch (err) {
      this.showToast(`Error saving notes: ${err.message}`, 'error');
    }
  }

  openAddManualJobModal() {
    const titleEl = document.getElementById('mq-add-title');
    const compEl = document.getElementById('mq-add-company');
    const listUrlEl = document.getElementById('mq-add-listing-url');
    const directUrlEl = document.getElementById('mq-add-direct-url');
    const notesEl = document.getElementById('mq-add-notes');

    if (titleEl) titleEl.value = '';
    if (compEl) compEl.value = '';
    if (listUrlEl) listUrlEl.value = '';
    if (directUrlEl) directUrlEl.value = '';
    if (notesEl) notesEl.value = '';

    if (this.mqAddModal) this.mqAddModal.style.display = 'flex';
  }

  async submitAddManualJob() {
    const title = document.getElementById('mq-add-title')?.value.trim();
    const company = document.getElementById('mq-add-company')?.value.trim();
    const location = document.getElementById('mq-add-location')?.value.trim() || 'India';
    const platform = document.getElementById('mq-add-platform')?.value || 'Career Website';
    const listingUrl = document.getElementById('mq-add-listing-url')?.value.trim();
    const directUrl = document.getElementById('mq-add-direct-url')?.value.trim();
    const fitScore = parseInt(document.getElementById('mq-add-fit-score')?.value) || 88;
    const techScore = parseInt(document.getElementById('mq-add-tech-score')?.value) || 85;
    const notes = document.getElementById('mq-add-notes')?.value.trim() || '';

    if (!title || !company || !listingUrl) {
      alert('Please fill in Job Title, Company, and Listing URL.');
      return;
    }

    try {
      const res = await fetch('/api/manual-queue/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          company,
          location,
          sourcePlatform: platform,
          jobListingUrl: listingUrl,
          directApplicationUrl: directUrl,
          overallFitScore: fitScore,
          technicalScore: techScore,
          notes,
          reason: 'Manually added candidate opportunity'
        })
      }).then(r => r.json());

      if (res.success) {
        this.showToast('✅ Job opportunity added to Manual Apply Queue!', 'success');
        this.closeMqModals();
        this.loadManualQueue();
      }
    } catch (err) {
      this.showToast(`Error: ${err.message}`, 'error');
    }
  }

  closeMqModals() {
    if (this.mqAppliedModal) this.mqAppliedModal.style.display = 'none';
    if (this.mqAddModal) this.mqAddModal.style.display = 'none';
    if (this.mqNotesModal) this.mqNotesModal.style.display = 'none';
    this.mqActiveModalJob = null;
  }

  async resetGeminiCooldown() {
    if (!this.btnResetCooldown) return;
    this.btnResetCooldown.disabled = true;
    try {
      const res = await fetch('/api/ai/reset-cooldown', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        this.showToast('✅ Rate-limit cooldown reset. Ready for next API call.', 'success');
        const telRes = await fetch('/api/ai/live-telemetry').then(r => r.json());
        if (telRes?.telemetry) this.updateAiTelemetryUI(telRes.telemetry);
      }
    } catch (err) {
      this.showToast(`Error resetting cooldown: ${err.message}`, 'error');
    } finally {
      this.btnResetCooldown.disabled = false;
    }
  }
}

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.autoApplyApp = new AutoApplyApp();
});
