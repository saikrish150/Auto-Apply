const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const BotOrchestrator = require('./engine/bot-orchestrator');
const ProfileManager = require('./engine/profile-manager');
const { StateMachine, ApplicationStates } = require('./engine/state-machine');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // Security: Bind to loopback interface by default

// Security Hardening: Restrict CORS to localhost and local dashboard clients
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS policy'));
    }
  }
}));

// Request size limit for security
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Paths
const PROFILE_PATH = path.join(__dirname, 'config', 'profile.json');
const SETTINGS_PATH = path.join(__dirname, 'config', 'settings.json');

// Ensure settings.json exists from template if missing
if (!fs.existsSync(SETTINGS_PATH)) {
  const examplePath = path.join(__dirname, 'config', 'settings.example.json');
  if (fs.existsSync(examplePath)) {
    try {
      fs.copyFileSync(examplePath, SETTINGS_PATH);
    } catch (e) {
      console.warn('[Server] Could not create settings.json from example template:', e.message);
    }
  }
}

// Read configurations safely
function readJSON(filePath, fallback = {}) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
  }
  return fallback;
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// Secret Scrubbing Helpers
function maskSecretKey(key) {
  if (!key || typeof key !== 'string') return '';
  if (key.length <= 10) return '********';
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

function sanitizeSettings(settings) {
  if (!settings) return {};
  const cloned = JSON.parse(JSON.stringify(settings));
  if (cloned.ai) {
    if (cloned.ai.apiKey) {
      cloned.ai.apiKeyMasked = maskSecretKey(cloned.ai.apiKey);
      cloned.ai.apiKey = cloned.ai.apiKeyMasked;
    }
    if (Array.isArray(cloned.ai.apiKeys)) {
      cloned.ai.apiKeys = cloned.ai.apiKeys.map(k => maskSecretKey(k));
    }
  }
  return cloned;
}

// Canonical profile normalization
let rawProfile = readJSON(PROFILE_PATH);
let profileData = ProfileManager.normalizeProfile(rawProfile);
let settingsData = readJSON(SETTINGS_PATH);

// Initialize orchestrator
const orchestrator = new BotOrchestrator(profileData, settingsData);

// WebSocket clients
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);

  // Send current state and recent snapshot on join (scrubbing secrets)
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      profile: profileData,
      settings: sanitizeSettings(settingsData),
      snapshot: orchestrator.getSnapshot()
    }
  }));

  ws.on('close', () => {
    clients.delete(ws);
  });
});

function broadcast(type, payload) {
  const message = JSON.stringify({ type, data: payload });
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  }
}

// Forward Orchestrator events over WebSocket
orchestrator.on('log', (entry) => {
  broadcast('log', entry);
});

orchestrator.on('state_changed', (state) => {
  broadcast('state_changed', state);
});

orchestrator.on('job_processed', (data) => {
  broadcast('job_processed', data);
});

// Forward AI screening Q&A audit logs in real-time to dashboard
orchestrator.aiAgent.onAuditCallback = (entry) => {
  broadcast('qa_answered', entry);
};

// Forward unfilled/skipped screening questions in real-time to dashboard
orchestrator.aiAgent.onUnfilledCallback = (entry) => {
  broadcast('unfilled_question_detected', entry);
};

// Forward live Gemini API telemetry in real-time to dashboard
orchestrator.aiAgent.onTelemetryCallback = (telemetry) => {
  broadcast('ai_telemetry_updated', telemetry);
};

// Forward Manual Queue updates
if (orchestrator.manualQueue) {
  orchestrator.manualQueue.onQueueChanged = (stats) => {
    broadcast('manual_queue_stats', stats);
  };
}

// REST API Endpoints

// 1. System & Chrome Status
app.get('/api/status', async (req, res) => {
  const chromeStatus = await orchestrator.chromeManager.getStatus();
  res.json({
    status: 'ok',
    orchestrator: orchestrator.getSnapshot(),
    chrome: chromeStatus,
    aiTelemetry: orchestrator.aiAgent.getLiveTelemetry()
  });
});

// 2. Profile Management
app.get('/api/profile', (req, res) => {
  res.json(profileData);
});

app.post('/api/profile', (req, res) => {
  try {
    const validation = ProfileManager.validateProfile(req.body);
    if (!validation.valid) {
      return res.status(400).json({ success: false, errors: validation.errors });
    }

    profileData = ProfileManager.normalizeProfile(req.body);
    profileData.lastUpdated = new Date().toISOString();
    profileData.profileVersion = (profileData.profileVersion || 1) + 1;

    writeJSON(PROFILE_PATH, profileData);
    orchestrator.updateConfig(profileData, null);
    broadcast('profile_updated', profileData);
    res.json({ success: true, message: 'Profile validated and updated successfully.', profile: profileData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Settings Management (with secret protection)
app.get('/api/settings', (req, res) => {
  res.json(sanitizeSettings(settingsData));
});

app.post('/api/settings', (req, res) => {
  try {
    const updated = req.body || {};
    
    // Retain real API keys if frontend submitted masked string
    if (updated.ai?.apiKey && updated.ai.apiKey.includes('...')) {
      updated.ai.apiKey = settingsData.ai?.apiKey || '';
    }
    if (Array.isArray(updated.ai?.apiKeys)) {
      updated.ai.apiKeys = updated.ai.apiKeys.map((k, idx) => {
        if (k && k.includes('...')) {
          return settingsData.ai?.apiKeys?.[idx] || k;
        }
        return k;
      });
    }

    settingsData = updated;
    writeJSON(SETTINGS_PATH, settingsData);
    orchestrator.updateConfig(null, settingsData);
    broadcast('settings_updated', sanitizeSettings(settingsData));
    res.json({ success: true, message: 'Settings updated successfully.', settings: sanitizeSettings(settingsData) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Bot Lifecycle Controls
app.post('/api/bot/start', async (req, res) => {
  try {
    const result = await orchestrator.start();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/bot/pause', async (req, res) => {
  await orchestrator.pause();
  res.json({ success: true, message: 'Bot paused.' });
});

app.post('/api/bot/resume', async (req, res) => {
  await orchestrator.resume();
  res.json({ success: true, message: 'Bot resumed.' });
});

app.post('/api/bot/stop', async (req, res) => {
  await orchestrator.stop();
  res.json({ success: true, message: 'Bot stopped.' });
});

// 5. Chrome Launcher & Background Relauncher helpers
app.post('/api/chrome/launch', async (req, res) => {
  try {
    const result = await orchestrator.chromeManager.launchChrome();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/chrome/relaunch', async (req, res) => {
  try {
    const result = await orchestrator.chromeManager.relaunchChrome();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Test AI Screening Q&A Answer
app.post('/api/ai/test-answer', async (req, res) => {
  const { question, options, inputType } = req.body;
  try {
    const result = await orchestrator.aiAgent.answerScreeningQuestionAI(
      question,
      options || [],
      inputType || 'text',
      { platform: 'Dashboard Tester', jobTitle: 'Interactive Candidate Sandbox', company: 'AI Playground' }
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Live Gemini API Telemetry & Diagnostic Controls
app.get('/api/ai/live-telemetry', (req, res) => {
  res.json({
    success: true,
    telemetry: orchestrator.aiAgent.getLiveTelemetry()
  });
});

app.post('/api/ai/test-call', async (req, res) => {
  try {
    const { question } = req.body;
    const testResult = await orchestrator.aiAgent.testGeminiCall(question);
    res.json(testResult);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/ai/reset-cooldown', (req, res) => {
  try {
    const result = orchestrator.aiAgent.resetCooldown();
    broadcast('ai_telemetry_updated', orchestrator.aiAgent.getLiveTelemetry());
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Q&A Audit Log & Rule Learning Endpoints
app.get('/api/qa-audit', (req, res) => {
  res.json({
    success: true,
    auditLog: orchestrator.aiAgent.getAuditLog(),
    stats: orchestrator.aiAgent.getAuditStats()
  });
});

app.post('/api/qa-audit/save-rule', (req, res) => {
  try {
    const { id, question, pattern, answer, answerType } = req.body;
    const result = orchestrator.aiAgent.saveRuleToMemory({ id, question, pattern, answer, answerType });
    profileData = orchestrator.aiAgent.profile;
    broadcast('profile_updated', profileData);
    broadcast('qa_rule_saved', { id, result });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/qa-audit/clear', (req, res) => {
  orchestrator.aiAgent.clearAuditLog();
  broadcast('qa_audit_cleared', {});
  res.json({ success: true, message: 'Audit log cleared.' });
});

app.delete('/api/qa-audit/:id', (req, res) => {
  const success = orchestrator.aiAgent.deleteAuditEntry(req.params.id);
  if (success) {
    broadcast('qa_entry_deleted', { id: req.params.id });
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Entry not found' });
  }
});

// 8. Unfilled / Missing Fields & Manual Input Endpoints
app.get('/api/unfilled-questions', (req, res) => {
  res.json({
    success: true,
    unfilledQuestions: orchestrator.aiAgent.getUnfilledQuestions()
  });
});

app.post('/api/unfilled-questions/resolve', (req, res) => {
  try {
    const { id, question, answer, inputType, pattern, saveAsRule } = req.body;
    const result = orchestrator.aiAgent.resolveUnfilledQuestion({
      id,
      question,
      answer,
      inputType,
      pattern,
      saveAsRule: saveAsRule !== false
    });
    profileData = orchestrator.aiAgent.profile;
    broadcast('profile_updated', profileData);
    broadcast('unfilled_resolved', { id, result });
    broadcast('qa_rule_saved', { question, result });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/unfilled-questions/:id', (req, res) => {
  const success = orchestrator.aiAgent.dismissUnfilledQuestion(req.params.id);
  if (success) {
    broadcast('unfilled_dismissed', { id: req.params.id });
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Question not found' });
  }
});

app.post('/api/unfilled-questions/clear', (req, res) => {
  orchestrator.aiAgent.clearUnfilledQuestions();
  broadcast('unfilled_cleared', {});
  res.json({ success: true, message: 'All unfilled questions cleared.' });
});

app.post('/api/unfilled-questions/manual-add', (req, res) => {
  try {
    const { question, answer, inputType, platform, saveAsRule } = req.body;
    if (!question || !answer) {
      return res.status(400).json({ success: false, error: 'Both question and answer are required.' });
    }
    const cleanQ = question.trim();
    const cleanA = answer.trim();

    let savedRule = null;
    if (saveAsRule !== false) {
      savedRule = orchestrator.aiAgent.saveRuleToMemory({
        question: cleanQ,
        answer: cleanA,
        answerType: 'fixed'
      });
      profileData = orchestrator.aiAgent.profile;
      broadcast('profile_updated', profileData);
    }

    orchestrator.aiAgent.recordAuditEntry({
      id: `qa-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      question: cleanQ,
      inputType: inputType || 'text',
      answer: cleanA,
      confidence: 1.0,
      engine: 'Manual Candidate Input',
      source: 'User manually entered & verified answer',
      reasoning: 'Entered manually via Dashboard Missing Fields tool',
      platform: platform || 'Manual Input',
      jobTitle: 'Manual Entry',
      company: 'User Profile',
      timestamp: new Date().toISOString(),
      status: 'saved_as_rule'
    });

    broadcast('qa_answered', { question: cleanQ, answer: cleanA });
    res.json({ success: true, savedRule: savedRule?.rule || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. AI Status & Configuration
app.get('/api/ai/status', (req, res) => {
  res.json(orchestrator.aiAgent.getStatus());
});

app.post('/api/ai/set-key', (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required.' });
  }

  settingsData.ai = settingsData.ai || {};
  settingsData.ai.apiKey = apiKey;
  settingsData.ai.provider = 'gemini';
  writeJSON(SETTINGS_PATH, settingsData);

  orchestrator.updateConfig(null, settingsData);
  orchestrator.aiAgent.initializeGemini();

  const status = orchestrator.aiAgent.getStatus();
  broadcast('ai_status', status);
  res.json({ success: true, message: 'Gemini API key saved and AI re-initialized.', status });
});

// 10. Persistent Applications & History Endpoints
app.get('/api/applications', (req, res) => {
  try {
    const { period, platform, status, search, limit } = req.query;
    const applications = orchestrator.dataStore.getApplications({
      period: period || 'all',
      platform: platform || 'all',
      status: status || 'all',
      search: search || '',
      limit: parseInt(limit) || 200
    });
    const timeStats = orchestrator.dataStore.getTimeStats();
    res.json({ success: true, applications, timeStats, total: applications.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/applications/stats', (req, res) => {
  try {
    const timeStats = orchestrator.dataStore.getTimeStats();
    const mqStats = orchestrator.manualQueue ? orchestrator.manualQueue.getStats() : {};
    res.json({ success: true, stats: orchestrator.stats, timeStats, manualQueueStats: mqStats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/applications/:id', (req, res) => {
  try {
    const appItem = orchestrator.dataStore.getApplicationById(req.params.id);
    if (appItem) {
      res.json({ success: true, application: appItem });
    } else {
      res.status(404).json({ success: false, error: 'Application not found' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/bot/clear-history', (req, res) => {
  orchestrator.dataStore.clearHistory();
  orchestrator.jobsHistory = [];
  orchestrator.stats.matchesFound = 0;
  orchestrator.stats.appliedToday = 0;
  orchestrator.stats.skipped = 0;
  orchestrator.stats.failed = 0;
  orchestrator.stats.avgMatchScore = 0;
  broadcast('history_cleared', orchestrator.getSnapshot());
  res.json({ success: true });
});

// 11. High-Match Manual Application Queue Endpoints (PHASE 5)
app.get('/api/manual-queue', (req, res) => {
  try {
    const { minFitScore, minTechScore, platform, status, method, search, sort, limit } = req.query;
    const items = orchestrator.manualQueue.getQueue({
      minFitScore: parseInt(minFitScore) || 0,
      minTechScore: parseInt(minTechScore) || 0,
      platform: platform || 'all',
      status: status || 'all',
      method: method || 'all',
      search: search || ''
    }, sort || 'highest_fit', parseInt(limit) || 100);
    const stats = orchestrator.manualQueue.getStats();
    res.json({ success: true, items, stats, total: items.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/manual-queue/mark-applied', (req, res) => {
  try {
    const { id, confirmationId, notes, appliedDate, isSelfReported } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'Job ID is required' });
    const result = orchestrator.manualQueue.markApplied(id, { confirmationId, notes, appliedDate, isSelfReported });
    if (result.success) {
      broadcast('manual_queue_updated', { id, action: 'applied', item: result.item });
      orchestrator.dataStore.recalculateSummary();
      broadcast('state_changed', orchestrator.getSnapshot());
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/manual-queue/update-status', (req, res) => {
  try {
    const { id, status, reason } = req.body;
    if (!id || !status) return res.status(400).json({ success: false, error: 'Job ID and status are required' });
    const result = orchestrator.manualQueue.updateStatus(id, status, reason);
    if (result.success) {
      broadcast('manual_queue_updated', { id, action: 'status_updated', item: result.item });
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/manual-queue/notes', (req, res) => {
  try {
    const { id, notes } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'Job ID is required' });
    const result = orchestrator.manualQueue.updateNotes(id, notes);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/manual-queue/add', (req, res) => {
  try {
    const jobData = req.body;
    if (!jobData || !jobData.title) {
      return res.status(400).json({ success: false, error: 'Job title is required' });
    }
    const item = orchestrator.manualQueue.enqueue(jobData);
    broadcast('manual_queue_updated', { id: item.id, action: 'enqueued', item });
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12. Direct Career Site Automation Endpoint (PHASE 7 UPGRADES)
const CareerSiteBot = require('./engine/career-site-bot');
const careerSiteBot = new CareerSiteBot(orchestrator.chromeManager, orchestrator.aiAgent, settingsData, (lvl, tag, msg) => orchestrator.log(lvl, tag, msg));

app.post('/api/career-site/apply', async (req, res) => {
  try {
    const { url, jobTitle, company } = req.body;
    await orchestrator.chromeManager.connect();
    const pages = await orchestrator.chromeManager.browser.pages();
    
    let targetPage = null;
    if (url) {
      targetPage = pages.find(p => p.url().includes(url));
      if (!targetPage) {
        targetPage = await orchestrator.chromeManager.newPage();
        await targetPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }
    } else {
      // Find legitimate open career page tab (strictly excluding dashboard, internal tabs, and feeds)
      targetPage = pages.find(p => {
        const u = p.url();
        return (
          u.startsWith('http') &&
          !u.includes('localhost') && 
          !u.includes('127.0.0.1') &&
          !u.includes('chrome://') && 
          !u.includes('linkedin.com/feed') && 
          !u.includes('naukri.com/mnjuser')
        );
      });
    }

    if (!targetPage) {
      return res.status(400).json({
        success: false,
        error: 'No active career page tab found. Please navigate to a job page or provide a valid job URL.'
      });
    }

    const currentUrl = targetPage.url();
    const pageTitle = await targetPage.title();
    const effectiveTitle = jobTitle || pageTitle.split(/[-–|]/)[0].trim() || 'Software Developer';
    
    // Parse company reliably from host or title
    let effectiveCompany = company;
    if (!effectiveCompany) {
      try {
        const hostParts = new URL(currentUrl).hostname.replace('www.', '').split('.');
        effectiveCompany = hostParts.length > 2 ? hostParts[1] : hostParts[0];
        effectiveCompany = effectiveCompany.charAt(0).toUpperCase() + effectiveCompany.slice(1);
      } catch (e) {
        effectiveCompany = 'Direct Employer';
      }
    }

    // Evaluate job fit using shared MatchingEngine instead of hardcoded score
    const evaluation = orchestrator.aiAgent.evaluateJobMatch(effectiveTitle, pageTitle, effectiveCompany);

    const result = await careerSiteBot.applyToCareerPage(targetPage, {
      title: effectiveTitle,
      company: effectiveCompany
    });

    const jobRecord = {
      id: `cs-${Date.now()}`,
      platform: 'Career Website',
      title: effectiveTitle,
      company: effectiveCompany,
      url: currentUrl,
      directApplicationUrl: result.directApplicationUrl || currentUrl,
      matchScore: evaluation.overallFitScore,
      overallFitScore: evaluation.overallFitScore,
      technicalScore: evaluation.technicalScore,
      experienceCompatibility: evaluation.experienceCompatibility,
      status: result.status || ApplicationStates.MANUAL_ACTION_REQUIRED,
      reason: result.reason || (result.status?.includes('applied') ? 'Submitted' : 'Manual action required'),
      appliedAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      questionsAnswered: result.questionsAnswered || [],
      evaluation
    };

    orchestrator.handleJobProcessed(jobRecord);

    // Only close tab if application is explicitly confirmed and settings allow
    if (result.status === ApplicationStates.APPLIED_CONFIRMED && (settingsData.automation?.closeCareerTabAfterSubmit !== false)) {
      setTimeout(async () => {
        try {
          if (!targetPage.isClosed()) await targetPage.close();
        } catch (e) {}
      }, 2500);
    }

    res.json({ success: true, result, jobRecord });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start Server on loopback interface
server.listen(PORT, HOST, () => {
  console.log(`======================================================`);
  console.log(`  AutoApply AI Agent & Control Center (v2.0 Upgraded)`);
  console.log(`  Dashboard: http://${HOST}:${PORT}`);
  console.log(`  Security: Bound to loopback (${HOST})`);
  console.log(`  Remote Debugging: Port 9222`);
  console.log(`======================================================`);
});
