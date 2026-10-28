const ChromeManager = require('./chrome-manager');
const AIAgent = require('./ai-agent');
const LinkedInBot = require('./linkedin-bot');
const NaukriBot = require('./naukri-bot');
const FounditBot = require('./foundit-bot');
const DataStore = require('./data-store');
const EventEmitter = require('events');

class BotOrchestrator extends EventEmitter {
  constructor(profile, settings) {
    super();
    this.profile = profile;
    this.settings = settings;

    this.chromeManager = new ChromeManager(settings);
    this.aiAgent = new AIAgent(profile, settings);
    this.dataStore = new DataStore();

    this.state = 'idle'; // idle | running | paused | stopped
    this.currentJob = null;
    
    // Load historical applications and statistics from disk
    this.jobsHistory = this.dataStore.getApplications({ limit: 300 });
    const timeStats = this.dataStore.getTimeStats();
    
    // Calculate historical average match score
    const scores = this.jobsHistory.filter(j => j.matchScore).map(j => j.matchScore);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

    this.manualQueue = this.dataStore.manualQueue;
    const mqStats = this.manualQueue.getStats();

    this.stats = {
      appliedToday: timeStats.today || 0,
      matchesFound: timeStats.totalApplications || 0,
      manualQueuePending: mqStats.pendingCount || 0,
      unverifiedSubmissions: timeStats.unverifiedSubmissions || 0,
      skipped: (timeStats.byStatus['SKIPPED_LOW_MATCH'] || 0) + (timeStats.byStatus['skipped'] || 0) + (timeStats.byStatus['already_applied_or_closed'] || 0) + (timeStats.byStatus['already_applied'] || 0),
      failed: (timeStats.byStatus['FAILED_FINAL'] || 0) + (timeStats.byStatus['FAILED_RETRYABLE'] || 0) + (timeStats.byStatus['failed'] || 0),
      avgMatchScore: avgScore,
      sessionStartTime: null
    };

    this.linkedInBot = null;
    this.naukriBot = null;
    this.founditBot = null;
  }

  updateConfig(profile, settings) {
    if (profile) {
      this.profile = profile;
    }
    if (settings) {
      this.settings = settings;
      this.chromeManager.updateSettings(settings);
    }
    this.aiAgent.updateProfileAndSettings(this.profile, this.settings);
    this.emit('config_updated', { profile: this.profile, settings: this.settings });
  }

  log(level, tag, message, extra = null) {
    const entry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toLocaleTimeString(),
      level, // 'info' | 'success' | 'warning' | 'error' | 'action' | 'simulation'
      tag,
      message,
      extra
    };
    this.emit('log', entry);
    return entry;
  }

  async start() {
    if (this.state === 'running') {
      return { success: false, message: 'Bot is already running.' };
    }

    this.state = 'running';
    this.stats.sessionStartTime = new Date().toISOString();
    this.emit('state_changed', { state: this.state });
    this.log('info', 'Orchestrator', 'Starting AutoApply Engine...');

    // Run asynchronously
    this.runPipeline().catch(err => {
      this.log('error', 'Orchestrator', `Run pipeline error: ${err.message}`);
      this.state = 'idle';
      this.emit('state_changed', { state: this.state });
    });

    return { success: true, message: 'Automation session launched.' };
  }

  async pause() {
    if (this.state === 'running') {
      this.state = 'paused';
      this.emit('state_changed', { state: this.state });
      this.log('warning', 'Orchestrator', 'Automation session paused.');
    }
  }

  async resume() {
    if (this.state === 'paused') {
      this.state = 'running';
      this.emit('state_changed', { state: this.state });
      this.log('info', 'Orchestrator', 'Automation session resumed.');
    }
  }

  async stop() {
    this.state = 'stopped';
    if (this.linkedInBot) this.linkedInBot.stop();
    if (this.naukriBot) this.naukriBot.stop();
    if (this.founditBot) this.founditBot.stop();
    this.emit('state_changed', { state: this.state });
    this.log('warning', 'Orchestrator', 'Stopping automation session...');
    
    setTimeout(() => {
      this.state = 'idle';
      this.emit('state_changed', { state: this.state });
    }, 1000);
  }

  async runPipeline() {
    const isSim = this.settings.automation?.simulationMode;

    if (isSim) {
      this.log('simulation', 'Simulation', 'Running in safe SIMULATION MODE. No live job submissions will be finalized.');
      await this.runSimulationPipeline();
      return;
    }

    // Live mode: connect to Chrome
    try {
      this.log('info', 'Chrome', 'Connecting to Chrome via remote debugging (port 9222)...');
      await this.chromeManager.connect();
      this.log('success', 'Chrome', 'Successfully connected to Chrome browser!');
    } catch (chromeErr) {
      this.log('error', 'Chrome', `Could not connect to Chrome on port 9222: ${chromeErr.message}`);
      this.log('info', 'Chrome', 'Tip: You can click "Open Chrome with Debugging" or test with "Simulation Mode" in settings.');
      this.state = 'idle';
      this.emit('state_changed', { state: this.state });
      return;
    }

    // 1. Run LinkedIn if enabled
    if (this.settings.platforms?.linkedin && this.state === 'running') {
      this.log('info', 'LinkedIn', 'Starting LinkedIn Easy Apply automation...');
      this.linkedInBot = new LinkedInBot(
        this.chromeManager,
        this.aiAgent,
        this.settings,
        (lvl, tag, msg) => this.log(lvl, tag, msg)
      );

      await this.linkedInBot.run((job) => this.handleJobProcessed(job));
    }

    // 2. Run Naukri if enabled
    if (this.settings.platforms?.naukri && this.state === 'running') {
      this.log('info', 'Naukri', 'Starting Naukri Fast Apply automation...');
      this.naukriBot = new NaukriBot(
        this.chromeManager,
        this.aiAgent,
        this.settings,
        (lvl, tag, msg) => this.log(lvl, tag, msg)
      );

      await this.naukriBot.run((job) => this.handleJobProcessed(job));
    }

    // 3. Run Foundit if enabled
    if (this.settings.platforms?.foundit && this.state === 'running') {
      this.log('info', 'Foundit', 'Starting Foundit (Monster India) Fast Apply automation...');
      this.founditBot = new FounditBot(
        this.chromeManager,
        this.aiAgent,
        this.settings,
        (lvl, tag, msg) => this.log(lvl, tag, msg)
      );

      await this.founditBot.run((job) => this.handleJobProcessed(job));
    }

    this.log('success', 'Orchestrator', 'AutoApply session completed all target platforms.');
    this.state = 'idle';
    this.emit('state_changed', { state: this.state });
  }

  handleJobProcessed(job) {
    this.currentJob = job;

    // Save application to persistent DataStore
    const savedRecord = this.dataStore.saveApplication(job);

    // Refresh jobsHistory from dataStore
    this.jobsHistory = this.dataStore.getApplications({ limit: 300 });

    // Sync stats with DataStore metrics
    const timeStats = this.dataStore.getTimeStats();
    const mqStats = this.manualQueue ? this.manualQueue.getStats() : { pendingCount: 0 };
    this.stats.appliedToday = timeStats.today;
    this.stats.matchesFound = timeStats.totalApplications;
    this.stats.manualQueuePending = mqStats.pendingCount;
    this.stats.unverifiedSubmissions = timeStats.unverifiedSubmissions || 0;
    this.stats.skipped = (timeStats.byStatus['SKIPPED_LOW_MATCH'] || 0) + (timeStats.byStatus['skipped'] || 0) + (timeStats.byStatus['already_applied_or_closed'] || 0) + (timeStats.byStatus['already_applied'] || 0);
    this.stats.failed = (timeStats.byStatus['FAILED_FINAL'] || 0) + (timeStats.byStatus['FAILED_RETRYABLE'] || 0) + (timeStats.byStatus['failed'] || 0);

    // Recalculate avg score
    const scores = this.jobsHistory.filter(j => j.matchScore).map(j => j.matchScore);
    if (scores.length > 0) {
      this.stats.avgMatchScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    }

    this.emit('job_processed', { job: savedRecord || job, stats: this.stats, timeStats, manualQueueStats: mqStats });
  }

  // Realistic interactive simulation for demonstrations and dry runs
  async runSimulationPipeline() {
    const mockJobs = [
      {
        platform: 'LinkedIn',
        title: 'Senior Frontend Engineer (React/TypeScript)',
        company: 'Stripe Technologies',
        location: 'Bengaluru / Remote',
        description: 'Looking for a Senior Frontend Engineer proficient in React, TypeScript, Redux, Performance Optimization, and modern UI engineering.',
        questions: [
          { q: 'How many years of experience do you have with React.js?', type: 'text' },
          { q: 'What is your current notice period?', type: 'text' },
          { q: 'Are you comfortable working in a hybrid environment?', type: 'radio', options: ['Yes', 'No'] }
        ]
      },
      {
        platform: 'Naukri',
        title: 'Full Stack Developer (Node.js & React)',
        company: 'Razorpay',
        location: 'Bengaluru',
        description: 'Seeking a Full Stack Developer with 4+ years in Node.js, Express, React, PostgreSQL, Docker, and REST APIs.',
        questions: [
          { q: 'What is your expected CTC?', type: 'text' },
          { q: 'How many years of experience do you have with Node.js?', type: 'text' }
        ]
      },
      {
        platform: 'LinkedIn',
        title: 'Lead UI/UX Fullstack Engineer',
        company: 'Swiggy',
        location: 'Bengaluru (On-site)',
        description: 'Architect next-generation customer-facing web apps. Required: JavaScript, React, Micro-frontends, AWS, CI/CD pipelines.',
        questions: [
          { q: 'Are you willing to relocate to Bengaluru?', type: 'radio', options: ['Yes', 'No'] },
          { q: 'Total years of software engineering experience?', type: 'text' }
        ]
      },
      {
        platform: 'Naukri',
        title: 'Junior Java Backend Developer',
        company: 'Legacy Corp',
        location: 'Hyderabad',
        description: 'Looking for Junior Java Spring Boot developer with Hibernate, Oracle DB, and JSP.',
        questions: []
      },
      {
        platform: 'LinkedIn',
        title: 'Staff Software Engineer - Web Platform',
        company: 'Postman',
        location: 'Remote, India',
        description: 'Building world-class developer tools. Expert level React, TypeScript, WebSockets, Node.js, and high performance client architectures.',
        questions: [
          { q: 'Why are you interested in this role?', type: 'text' },
          { q: 'Do you require visa sponsorship?', type: 'radio', options: ['Yes', 'No'] }
        ]
      }
    ];

    for (let i = 0; i < mockJobs.length; i++) {
      if (this.state === 'stopped') break;
      while (this.state === 'paused') {
        await new Promise(r => setTimeout(r, 600));
        if (this.state === 'stopped') break;
      }
      if (this.state === 'stopped') break;

      const mock = mockJobs[i];
      this.log('info', mock.platform, `Evaluating listing: "${mock.title}" at ${mock.company}...`);
      await new Promise(r => setTimeout(r, 1400));

      const evaluation = await this.aiAgent.evaluateJobMatchAI(mock.title, mock.description, mock.company);
      this.log('action', mock.platform, `AI Match Score: ${evaluation.score}% - ${evaluation.reasoning}`);

      const jobRecord = {
        id: `sim-${Date.now()}-${i}`,
        platform: mock.platform,
        title: mock.title,
        company: mock.company,
        location: mock.location,
        url: mock.platform === 'LinkedIn' ? 'https://linkedin.com/jobs' : 'https://naukri.com/jobs',
        matchScore: evaluation.score,
        evaluation,
        status: 'evaluating',
        timestamp: new Date().toISOString()
      };

      if (!evaluation.isRecommended) {
        this.log('warning', mock.platform, `Job filtered out: ATS score ${evaluation.score}% < threshold ${this.settings.automation?.minMatchScore}%.`);
        jobRecord.status = 'skipped';
        jobRecord.skipReason = `ATS score ${evaluation.score}% < threshold`;
        this.handleJobProcessed(jobRecord);
        await new Promise(r => setTimeout(r, 1800));
        continue;
      }

      // Simulate question answering
      const answeredQAs = [];
      for (const question of mock.questions) {
        await new Promise(r => setTimeout(r, 800));
        const ans = await this.aiAgent.answerScreeningQuestionAI(
          question.q,
          question.options || [],
          question.type || 'text',
          { platform: mock.platform, jobTitle: mock.title, company: mock.company }
        );
        answeredQAs.push({
          question: question.q,
          answer: ans.answer,
          inputType: question.type || 'text',
          source: ans.source || 'AI Engine',
          timestamp: new Date().toISOString()
        });
        const aiTag = ans.aiPowered ? '🤖' : '⚡';
        this.log('action', mock.platform, `${aiTag} Agent Answered: "${question.q}" → [${ans.answer}] (${ans.source})`);
      }
      jobRecord.questionsAnswered = answeredQAs;

      await new Promise(r => setTimeout(r, 1200));
      jobRecord.status = 'applied (simulated)';
      this.log('success', mock.platform, `Application successfully simulated for "${mock.title}" at ${mock.company}!`);
      this.handleJobProcessed(jobRecord);
      await new Promise(r => setTimeout(r, 2000));
    }

    this.log('success', 'Simulation', 'Completed simulation sequence. Review results in the Job History tab.');
    this.state = 'idle';
    this.emit('state_changed', { state: this.state });
  }

  getSnapshot() {
    const timeStats = this.dataStore.getTimeStats();
    const mqStats = this.manualQueue ? this.manualQueue.getStats() : { pendingCount: 0 };
    return {
      state: this.state,
      currentJob: this.currentJob,
      stats: this.stats,
      timeStats,
      manualQueueStats: mqStats,
      jobsCount: this.jobsHistory.length,
      recentJobs: this.jobsHistory.slice(0, 100)
    };
  }
}

module.exports = BotOrchestrator;
