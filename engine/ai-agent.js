const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const MatchingEngine = require('./matching-engine');
const ScreeningClassifier = require('./screening-classifier');
const ProfileManager = require('./profile-manager');

class AIAgent {
  constructor(profile, settings) {
    this.profile = ProfileManager.normalizeProfile(profile || {});
    this.settings = settings || {};
    this.genAI = null;
    this.model = null;
    this.chatSession = null;
    this.isInitialized = false;
    this.aiUnavailableUntil = 0;
    this.apiKeyIndex = 0;
    this.apiKeys = [];
    this.answerCache = new Map(); // Cache to avoid duplicate API calls
    this.auditLogPath = path.join(__dirname, '..', 'config', 'qa_audit_log.json');
    this.unfilledQuestionsPath = path.join(__dirname, '..', 'config', 'unfilled_questions.json');
    this.profilePath = path.join(__dirname, '..', 'config', 'profile.json');
    this.auditLog = this.loadAuditLog();
    this.unfilledQuestions = this.loadUnfilledQuestions();
    this.onAuditCallback = null; // Callback for real-time WebSocket broadcast
    this.onUnfilledCallback = null; // Callback for real-time unfilled questions broadcast
    this.onTelemetryCallback = null; // Callback for real-time live Gemini API telemetry broadcast
    this.activeModelName = this.settings?.ai?.model || 'gemini-3.5-flash';

    // Live Gemini API Telemetry State for Real-Time Dashboard Visibility
    this.apiLiveTelemetry = {
      status: 'idle', // 'idle' | 'calling' | 'success' | 'error' | 'throttled'
      provider: 'Google Gemini',
      model: this.activeModelName,
      activeKeyIndex: 0,
      totalKeys: 0,
      activeKeySnippet: '',
      isThrottled: false,
      throttledUntil: null,
      cooldownRemainingSeconds: 0,
      lastCallTimestamp: null,
      lastCallLatencyMs: 0,
      stats: {
        totalCalls: 0,
        successCalls: 0,
        failedCalls: 0,
        throttledCalls: 0
      },
      currentCall: null,
      lastCall: null,
      history: []
    };

    this.initializeGemini();
  }

  _updateTelemetry(patch = {}, emit = true) {
    if (patch.status) this.apiLiveTelemetry.status = patch.status;
    if (patch.stats) Object.assign(this.apiLiveTelemetry.stats, patch.stats);
    if (patch.currentCall !== undefined) this.apiLiveTelemetry.currentCall = patch.currentCall;
    if (patch.lastCall) {
      this.apiLiveTelemetry.lastCall = patch.lastCall;
      this.apiLiveTelemetry.history.unshift(patch.lastCall);
      if (this.apiLiveTelemetry.history.length > 20) this.apiLiveTelemetry.history.pop();
    }
    if (patch.lastCallLatencyMs !== undefined) this.apiLiveTelemetry.lastCallLatencyMs = patch.lastCallLatencyMs;
    if (patch.lastCallTimestamp !== undefined) this.apiLiveTelemetry.lastCallTimestamp = patch.lastCallTimestamp;
    if (patch.isThrottled !== undefined) this.apiLiveTelemetry.isThrottled = patch.isThrottled;
    if (patch.throttledUntil !== undefined) this.apiLiveTelemetry.throttledUntil = patch.throttledUntil;
    if (patch.model) this.apiLiveTelemetry.model = patch.model;

    this.apiLiveTelemetry.activeKeyIndex = this.apiKeyIndex;
    this.apiLiveTelemetry.totalKeys = this.apiKeys.length;
    const currentKey = this.apiKeys[this.apiKeyIndex % this.apiKeys.length] || '';
    this.apiLiveTelemetry.activeKeySnippet = currentKey ? `${currentKey.slice(0, 8)}...${currentKey.slice(-4)}` : 'None';

    const now = Date.now();
    if (this.aiUnavailableUntil > now) {
      this.apiLiveTelemetry.isThrottled = true;
      this.apiLiveTelemetry.throttledUntil = new Date(this.aiUnavailableUntil).toISOString();
      this.apiLiveTelemetry.cooldownRemainingSeconds = Math.ceil((this.aiUnavailableUntil - now) / 1000);
      if (this.apiLiveTelemetry.status === 'idle') this.apiLiveTelemetry.status = 'throttled';
    } else {
      this.apiLiveTelemetry.isThrottled = false;
      this.apiLiveTelemetry.throttledUntil = null;
      this.apiLiveTelemetry.cooldownRemainingSeconds = 0;
      if (this.apiLiveTelemetry.status === 'throttled') this.apiLiveTelemetry.status = 'idle';
    }

    if (emit && typeof this.onTelemetryCallback === 'function') {
      try {
        this.onTelemetryCallback(this.getLiveTelemetry());
      } catch (e) {}
    }
  }

  getLiveTelemetry() {
    const now = Date.now();
    const isThrottled = this.aiUnavailableUntil > now;
    return {
      ...this.apiLiveTelemetry,
      isThrottled,
      throttledUntil: isThrottled ? new Date(this.aiUnavailableUntil).toISOString() : null,
      cooldownRemainingSeconds: isThrottled ? Math.ceil((this.aiUnavailableUntil - now) / 1000) : 0,
      activeKeyIndex: this.apiKeyIndex,
      totalKeys: this.apiKeys.length,
      activeKeySnippet: (this.apiKeys[this.apiKeyIndex % this.apiKeys.length] || '').slice(0, 8) + '...'
    };
  }

  initializeGemini(preferredModel) {
    // GEMINI_API_KEYS supports a comma-separated rotation pool. Settings are
    // retained for backwards compatibility with the dashboard configuration.
    const environmentKeys = [process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY]
      .filter(Boolean).flatMap(value => String(value).split(','));
    const configuredKeys = [
      this.settings?.ai?.apiKey,
      ...(Array.isArray(this.settings?.ai?.apiKeys) ? this.settings.ai.apiKeys : [])
    ];
    this.apiKeys = [...new Set([...environmentKeys, ...configuredKeys]
      .map(key => String(key || '').trim()).filter(Boolean))];
    const apiKey = this.apiKeys[this.apiKeyIndex % this.apiKeys.length];
    if (!apiKey) {
      console.warn('[AIAgent] No Gemini API key set. AI will use local fallback until a key is configured.');
      this.isInitialized = false;
      this._updateTelemetry({ status: 'idle' });
      return;
    }

    try {
      this.genAI = new GoogleGenerativeAI(apiKey);
      const configuredModel = preferredModel || this.settings?.ai?.model || 'gemini-3.5-flash';
      // If we are rotating to key 2, 3, 4, default to gemini-3.5-flash which is universally supported
      const modelName = (this.apiKeyIndex > 0 && configuredModel === 'gemini-2.5-flash')
        ? 'gemini-3.5-flash'
        : configuredModel;
      this.activeModelName = modelName;

      this.model = this.genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.3,
          topP: 0.85,
          topK: 40,
          maxOutputTokens: 2048,
        },
      });
      this.isInitialized = true;
      this._updateTelemetry({ status: 'idle', model: modelName });
      console.log(`[AIAgent] Gemini AI initialized successfully with model: ${modelName} (key ${this.apiKeyIndex + 1}/${this.apiKeys.length})`);
    } catch (err) {
      console.error('[AIAgent] Failed to initialize Gemini:', err.message);
      this.isInitialized = false;
      this._updateTelemetry({ status: 'error' });
    }
  }

  _isGeminiThrottleError(error) {
    return /\b(?:429|quota exceeded|rate.limit|503|high demand|unreachable|service unavailable)\b/i.test(error?.message || '');
  }

  _isNetworkOrConnectionError(error) {
    return /\b(?:wsarecv|connection.*closed|forcibly closed|socket hang up|ECONNRESET|ETIMEDOUT|stream reading error|fetch failed|network|ENOTFOUND|unreachable)\b/i.test(error?.message || '');
  }

  _rotateGeminiKey() {
    if (this.apiKeys.length < 2) return false;
    this.apiKeyIndex = (this.apiKeyIndex + 1) % this.apiKeys.length;
    this.chatSession = null;
    this.isInitialized = false;
    this.initializeGemini();
    return this.isInitialized;
  }

  async _sendGeminiMessage(prompt, retryCount = 0) {
    try {
      const chat = await this._getChatSession();
      return await chat.sendMessage(prompt);
    } catch (error) {
      console.warn(`[AIAgent] Gemini API send error (attempt ${retryCount + 1}):`, error.message);

      // 1. If socket connection was closed / stream reading error / wsarecv:
      // Reset chatSession so a clean TLS connection is established, and retry
      if (this._isNetworkOrConnectionError(error) && retryCount < 2) {
        console.warn('[AIAgent] Transient socket/network reset by remote host (wsarecv). Rebuilding session and retrying in 1.5s...');
        this.chatSession = null;
        await new Promise(r => setTimeout(r, 1500));
        return this._sendGeminiMessage(prompt, retryCount + 1);
      }

      // 2. If 503 high demand or 404 model not found, try the alternate model
      const altModel = this.activeModelName === 'gemini-2.5-flash' ? 'gemini-3.5-flash' : 'gemini-2.5-flash';
      if ((/503|high demand|temporarily unavailable|unreachable/i.test(error?.message || '') ||
           /404|no longer available|not found/i.test(error?.message || '')) && retryCount < 2) {
        console.warn(`[AIAgent] Model ${this.activeModelName} unavailable (${(error.message || '').slice(0, 50)}); auto-switching to alternate ${altModel}...`);
        this.chatSession = null;
        this.initializeGemini(altModel);
        return this._sendGeminiMessage(prompt, retryCount + 1);
      }

      // 3. If quota or throttle error, attempt rotating to next key in pool
      if (this._isGeminiThrottleError(error) && this._rotateGeminiKey()) {
        console.warn('[AIAgent] Gemini quota/capacity issue; retrying with the next configured key.');
        const chat = await this._getChatSession();
        return await chat.sendMessage(prompt);
      }

      throw error;
    }
  }

  updateProfileAndSettings(profile, settings) {
    this.profile = profile || this.profile;
    this.settings = settings || this.settings;
    this.answerCache.clear();
    // Re-initialize Gemini if API key changed
    const currentKey = this.settings?.ai?.apiKey || this.settings?.ai?.apiKeys?.[0] || process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS;
    if (currentKey && !this.isInitialized) {
      this.initializeGemini();
    }
    // Reset chat session to pick up profile changes
    this.chatSession = null;
  }

  // Build a comprehensive system prompt with the candidate's full profile context
  _buildSystemPrompt() {
    const p = this.profile || {};
    const personal = p.personal || {};
    const career = p.career || {};
    const skills = p.skills || [];
    const experience = p.experience || [];
    const projects = p.projects || [];
    const education = p.education || {};
    const screeningQA = p.screeningQA || [];

    return `You are an AI assistant helping a job candidate automatically fill out job application forms and screening questionnaires on platforms like LinkedIn and Naukri.com.

YOUR CANDIDATE'S FULL PROFILE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PERSONAL DETAILS:
• Full Name: ${personal.fullName || 'Sai Krishna G'}
• First Name: ${personal.firstName || 'Sai Krishna'}
• Last Name: ${personal.lastName || 'G'}
• Email: ${personal.email || 'gsaikrishna150@gmail.com'}
• Phone: ${personal.phone || '+91 8688373517'}
• Phone Country Code: ${personal.phoneCountryCode || 'India (+91)'}
• Phone Digits / Mobile: ${personal.phoneDigits || '8688373517'}
• Location: ${personal.location || 'Hyderabad, Telangana, India'}
• City: ${personal.city || 'Hyderabad'}
• State: ${personal.state || 'Telangana'}
• Country: ${personal.country || 'India'}
• Postal Code / PIN: ${personal.postalCode || '500081'}
• Street Address: ${personal.streetAddress || 'Hyderabad, Telangana'}
• Full Address: ${personal.address || 'Hyderabad, Telangana, India - 500081'}
• Gender: ${personal.gender || 'Male'}
• LinkedIn: ${personal.linkedInUrl || 'https://linkedin.com'}
• GitHub: ${personal.githubUrl || 'https://github.com'}
• Portfolio: ${personal.portfolioUrl || 'https://indianmetroguide.in'}

CAREER SUMMARY:
• Current Role: ${career.primaryRole || 'Software Developer'}
• Total Experience: ${career.totalYearsExperience || 0} years
• Current Company: ${career.currentCompany || 'N/A'}
• Current Client: ${career.currentClient || 'N/A'}
• Current Designation: ${career.currentDesignation || 'N/A'}
• Current CTC: ${career.currentSalaryLPA || 'N/A'}
• Expected CTC: ${career.expectedSalaryLPA || 'N/A'}
• Notice Period: ${career.noticePeriodDays || 30} days ${career.noticePeriodDescription ? `(${career.noticePeriodDescription})` : ''}
• Willing to Relocate: ${career.willingToRelocate ? 'Yes' : 'No'}
• Visa Sponsorship Needed: ${career.needsVisaSponsorship ? 'Yes' : 'No'}
• Shift Preference: ${career.shiftPreference || 'Flexible'}
• Offers in Hand: ${career.offersInHand || 'None'}
• Interview Availability: Fully available for virtual, in-person (face-to-face), and in-office interviews immediately.
• Work Location Preference: Open to working from office, hybrid, or remote; willing to relocate.
• Background Verification (BGV): Consents to background checks; all previous employment documents, payslips, and relieving letters are ready.

TECHNICAL SKILLS:
${skills.map(s => `• ${s.name}: ${s.years} years (${s.proficiency})`).join('\n')}

WORK EXPERIENCE:
${experience.map(e => `• ${e.title} at ${e.company} (${e.duration})\n  ${e.highlights}`).join('\n\n')}

PROJECTS:
${projects.map(p => `• ${p.name} [${p.techStack}] — ${p.highlights}${p.liveUrl ? ` (${p.liveUrl})` : ''}`).join('\n')}

EDUCATION:
• ${education.degree || 'N/A'} from ${education.institution || 'N/A'} (${education.graduationYear || 'N/A'})
• CGPA: ${education.cgpa || 'N/A'}

ACHIEVEMENTS & CERTIFICATIONS:
${(p.achievements || []).map(a => `• ${a}`).join('\n')}
${(p.certifications || []).map(c => `• ${c}`).join('\n')}

PRE-CONFIGURED SCREENING ANSWERS (USE THESE AS GROUND TRUTH):
${screeningQA.map(qa => `• Pattern: "${qa.pattern}" → Answer: "${qa.defaultAnswer}"`).join('\n')}

COVER LETTER INTRO:
${p.customCoverLetterIntro || 'N/A'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULES FOR ANSWERING SCREENING QUESTIONS:
1. ALWAYS answer from the candidate's perspective using the profile data above.
2. For "years of experience" questions: Look up the skill in the skills list and return the years value. If the candidate DOES NOT have the skill listed in their skills profile (e.g. C#, .NET, Python, etc.), ALWAYS answer "0" (or "No" for yes/no questions). NEVER invent experience with unlisted technologies.
3. For salary/CTC questions: Use the EXACT values from the career section (Current CTC: ${career.currentSalaryLPA}, Expected CTC: ${career.expectedSalaryLPA}).
4. For yes/no questions: Answer based on the profile data. Default to "Yes" for generic positive questions (willing to learn, comfortable with technology, etc). Answer "No" for criminal/conviction questions.
5. For notice period: Always answer "${career.noticePeriodDays || 30} days" or "${career.noticePeriodDescription || '30 days'}".
6. For dropdown/radio options: Pick the BEST matching option from the provided choices.
7. For open-ended questions (cover letter, why interested, strengths): Craft a brief, professional 2-3 sentence response using the candidate's real experience and projects.
8. Keep answers CONCISE — applications want short answers, not essays.
9. For numeric fields, return ONLY the number (e.g., "3" not "3 years").
10. If multiple choice options are given, return the EXACT text of the best matching option.
11. PREVIOUS EMPLOYMENT ("Have you ever worked with us / former employee of this company?"): Unless the target company is Tech Mahindra (or GE Aerospace), ALWAYS answer "No".
12. LEGAL WORK AUTHORIZATION ("Are you legally authorized to work in the country you are applying / India?"): ALWAYS answer "Yes" (candidate is an Indian citizen with full authorization to work without restriction).
13. DISABILITY STATUS / VOLUNTARY SELF-IDENTIFICATION: Answer "No" (or select "No, I do not have a disability" / "I do not wish to answer" if multiple choices).
14. VETERAN STATUS: Answer "No" (or select "I am not a protected veteran").
15. CRIMINAL RECORD / FELONY / CONVICTION: ALWAYS answer "No". Candidate has clean record with zero convictions.
16. NON-COMPETE / RESTRICTIVE COVENANTS: ALWAYS answer "No". Candidate is not bound by any non-compete.
17. AGE VERIFICATION ("Are you 18 or older?"): ALWAYS answer "Yes".
18. DRUG TESTING / BACKGROUND CHECK CONSENT: ALWAYS answer "Yes".
19. CONFLICT OF INTEREST / RELATIVES AT COMPANY: ALWAYS answer "No".
20. GOVERNMENT OFFICIAL: ALWAYS answer "No".

RESPONSE FORMAT:
Always respond in this exact JSON format only, no markdown, no extra text:
{"answer": "your answer here", "confidence": 0.95, "reasoning": "brief explanation of why this answer"}`;
  }

  // Get or create a Gemini chat session with profile context
  async _getChatSession() {
    if (!this.chatSession && this.model) {
      this.chatSession = this.model.startChat({
        history: [
          {
            role: 'user',
            parts: [{ text: this._buildSystemPrompt() }],
          },
          {
            role: 'model',
            parts: [{ text: '{"status": "ready", "message": "I have loaded the candidate profile and am ready to answer screening questions accurately based on their data."}' }],
          },
        ],
      });
    }
    return this.chatSession;
  }

  // ============================================================
  // MAIN: Hybrid answer engine — Local-first, AI-escalation
  // Now tracks every Q&A into the persistent Audit Log
  // ============================================================
  async answerScreeningQuestionAI(questionText, options = [], inputType = 'text', context = {}) {
    const q = (questionText || '').trim();
    if (!q) {
      return { answer: '', confidence: 0, source: 'Empty question' };
    }

    const hasProfileRule = this.isRuleInProfile(q);

    // 1. Check cache first
    const safeOptions = this.normalizeOptions(options);
    const cacheKey = `${q}|${safeOptions.join(',')}|${inputType}`;
    if (this.answerCache.has(cacheKey)) {
      const cached = this.answerCache.get(cacheKey);
      return { ...cached, source: cached.source + ' (cached)' };
    }

    // A radio/select whose extracted choices are only browser values such as
    // "on" cannot be answered safely.  Do not ask Gemini to guess and do not
    // let an automation click the first control in the group.
    if ((inputType === 'select' || inputType === 'radio') && options.length > 0 && safeOptions.length === 0) {
      const result = {
        answer: '', confidence: 0, aiPowered: false,
        source: 'Skipped — form options have no visible labels',
        reasoning: 'The page extractor returned browser values instead of option labels.'
      };
      this.answerCache.set(cacheKey, result);
      this.recordAuditEntry({
        id: `qa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        question: q, options: options || [], inputType, answer: '', confidence: 0,
        engine: 'Skipped', source: result.source, reasoning: result.reasoning,
        platform: context.platform || 'General', jobTitle: context.jobTitle || 'N/A',
        company: context.company || 'N/A', timestamp: new Date().toISOString(), status: 'needs_review'
      });
      return result;
    }

    // 2. Try local pattern matching FIRST (fast, free, no API)
    const localResult = this.answerScreeningQuestionLocal(questionText, safeOptions, inputType, context);

    let finalResult = null;
    let engine = 'Local Rule';
    let reasoning = localResult.source;

    // 3. If local match is confident enough, use it directly
    //    This covers: notice period, CTC, experience years, yes/no,
    //    relocation, visa, work auth, shift preference, etc.
    const CONFIDENCE_THRESHOLD = 0.85;
    if (localResult.confidence >= CONFIDENCE_THRESHOLD) {
      console.log(`[AIAgent] Local match (confidence ${localResult.confidence}): "${q.substring(0, 50)}..." → "${localResult.answer}"`);
      finalResult = localResult;
      engine = hasProfileRule ? 'Verified Memory Rule' : 'Local Rule';
      reasoning = localResult.source;
    } else if (this.isInitialized && Date.now() >= this.aiUnavailableUntil) {
      // 4. Low-confidence or unknown question → Escalate to Gemini AI
      const callStart = Date.now();
      let prompt = `SCREENING QUESTION: "${q}"`;
      if (context.company && context.company !== 'N/A') {
        prompt += `\nTARGET COMPANY: "${context.company}" (Candidate current/past company: Tech Mahindra / GE Aerospace)`;
      }
      if (context.jobTitle && context.jobTitle !== 'N/A') {
        prompt += `\nJOB TITLE: "${context.jobTitle}"`;
      }
      if (context.platform && context.platform !== 'General') {
        prompt += `\nJOB PLATFORM: "${context.platform}"`;
      }
      if (safeOptions.length > 0) {
        prompt += `\nAVAILABLE OPTIONS (YOU MUST PICK FROM THIS LIST): ${JSON.stringify(safeOptions)}`;
      }
      prompt += `\nINPUT FIELD TYPE: ${inputType.toUpperCase()}`;
      if (inputType === 'number') {
        prompt += `\nCRITICAL FORMAT RULE: The field accepts NUMBERS ONLY. Your "answer" MUST be digits/numeric value only (e.g. "3", "30", "4.1"). DO NOT include words like "years", "days", "LPA", or symbols.`;
      } else if ((inputType === 'select' || inputType === 'radio') && safeOptions.length > 0) {
        prompt += `\nCRITICAL FORMAT RULE: This is a multiple-choice selection. Your "answer" MUST EXACTLY match one of the available choices from: ${JSON.stringify(safeOptions)}. DO NOT invent new text.`;
      }
      if (localResult.answer && localResult.confidence > 0.5) {
        prompt += `\n\nNOTE: My local pattern matching suggested "${localResult.answer}" but with low confidence (${localResult.confidence}). Verify or provide a better answer.`;
      }
      prompt += `\n\nAnalyze this question carefully using the candidate's full profile and provide the most accurate, contextual answer. Respond in JSON format only.`;

      try {
        console.log(`[AIAgent] Escalating to Gemini AI (local confidence was ${localResult.confidence}): "${q.substring(0, 60)}..."`);
        this._updateTelemetry({
          status: 'calling',
          currentCall: {
            question: q,
            inputType,
            options: safeOptions,
            context: { platform: context.platform, company: context.company, jobTitle: context.jobTitle },
            promptSnippet: prompt.slice(0, 300),
            startedAt: new Date().toISOString()
          }
        });

        const result = await this._sendGeminiMessage(prompt);
        const responseText = result.response.text().trim();
        const latencyMs = Date.now() - callStart;

        // Parse AI response
        let parsed = null;
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[0]);
          } catch (e) {}
        }
        if (!parsed || !parsed.answer) {
          parsed = {
            answer: responseText.replace(/```json/gi, '').replace(/```/g, '').trim(),
            confidence: 0.85,
            reasoning: 'Extracted from AI response'
          };
        }

        const sanitizedAiAns = this.sanitizeAnswerForInputType(parsed.answer || localResult.answer, inputType, safeOptions);

        finalResult = {
          answer: sanitizedAiAns,
          confidence: parsed.confidence || 0.9,
          source: `🤖 Gemini AI: ${parsed.reasoning || 'AI-generated contextual answer'}`,
          reasoning: parsed.reasoning || 'AI-generated contextual answer using candidate profile',
          aiPowered: true
        };
        engine = 'Gemini AI';
        reasoning = parsed.reasoning || 'AI-generated contextual answer';

        this.apiLiveTelemetry.stats.totalCalls++;
        this.apiLiveTelemetry.stats.successCalls++;
        this._updateTelemetry({
          status: 'success',
          lastCallLatencyMs: latencyMs,
          lastCallTimestamp: new Date().toISOString(),
          currentCall: null,
          lastCall: {
            question: q,
            prompt,
            options: safeOptions,
            inputType,
            context: { platform: context.platform, company: context.company, jobTitle: context.jobTitle },
            rawResponse: responseText,
            parsedResponse: parsed,
            finalAnswer: sanitizedAiAns,
            latencyMs,
            timestamp: new Date().toISOString(),
            status: 'success',
            error: null
          }
        });

      } catch (aiErr) {
        const latencyMs = Date.now() - callStart;
        console.error('[AIAgent] Gemini API error, using local fallback:', aiErr.message);
        
        this.apiLiveTelemetry.stats.totalCalls++;
        this.apiLiveTelemetry.stats.failedCalls++;
        const isThrottle = this._isGeminiThrottleError(aiErr);
        if (isThrottle) this.apiLiveTelemetry.stats.throttledCalls++;

        if (isThrottle) {
          const retrySeconds = Number((aiErr.message || '').match(/retryDelay[^\d]*(\d+)s/i)?.[1]);
          const cooldownMs = retrySeconds > 0
            ? Math.min(retrySeconds * 1000, 24 * 60 * 60 * 1000)
            : 10 * 60 * 1000;
          this.aiUnavailableUntil = Date.now() + cooldownMs;
          console.warn(`[AIAgent] Gemini temporarily paused for ${Math.ceil(cooldownMs / 60000)} minutes.`);
        }

        this._updateTelemetry({
          status: isThrottle ? 'throttled' : 'error',
          lastCallLatencyMs: latencyMs,
          lastCallTimestamp: new Date().toISOString(),
          currentCall: null,
          lastCall: {
            question: q,
            prompt,
            options: safeOptions,
            inputType,
            context: { platform: context.platform, company: context.company, jobTitle: context.jobTitle },
            rawResponse: null,
            parsedResponse: null,
            finalAnswer: this.sanitizeAnswerForInputType(localResult.answer, inputType, safeOptions),
            latencyMs,
            timestamp: new Date().toISOString(),
            status: isThrottle ? 'throttled' : 'error',
            error: aiErr.message
          }
        });

        finalResult = {
          ...localResult,
          answer: this.sanitizeAnswerForInputType(localResult.answer, inputType, safeOptions)
        };
        engine = 'Local Fallback';
        reasoning = `Gemini API fallback: ${aiErr.message}`;
      }
    } else {
      // 5. If Gemini unavailable, use local answer
      finalResult = {
        ...localResult,
        answer: this.sanitizeAnswerForInputType(localResult.answer, inputType, safeOptions)
      };
      engine = 'Local Rule';
      reasoning = localResult.source;
    }

    // Ensure final answer is strictly sanitized for the required input type
    finalResult.answer = this.sanitizeAnswerForInputType(finalResult.answer, inputType, safeOptions);

    // Cache the result
    this.answerCache.set(cacheKey, finalResult);

    // Record persistent audit entry so user can review and improve answers
    const auditEntry = {
      id: `qa-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      question: q,
      options: options || [],
      inputType: inputType || 'text',
      answer: String(finalResult.answer || ''),
      confidence: finalResult.confidence || 0.85,
      engine,
      source: finalResult.source || '',
      reasoning: reasoning || '',
      platform: context.platform || 'General',
      jobTitle: context.jobTitle || 'N/A',
      company: context.company || 'N/A',
      timestamp: new Date().toISOString(),
      status: hasProfileRule ? 'saved_as_rule' : 'auto'
    };

    this.recordAuditEntry(auditEntry);

    return finalResult;
  }

  // ============================================================
  // MAIN: Evaluate job match using Gemini AI with calibrated MatchingEngine
  // ============================================================
  async evaluateJobMatchAI(jobTitle, jobDescription, company) {
    const baseEvaluation = MatchingEngine.evaluate({
      title: jobTitle,
      description: jobDescription,
      company: company,
      profile: this.profile,
      minMatchScore: this.settings.automation?.minMatchScore || 65
    });

    if (this.isInitialized) {
      try {
        const prompt = `EVALUATE THIS JOB FOR THE CANDIDATE:

Job Title: "${jobTitle}"
Company: "${company}"
Job Description: "${(jobDescription || '').substring(0, 2000)}"

Based on candidate profile:
1. Candidate total experience: ~${this.profile.career?.totalYearsExperience || 2.7} years.
2. Verified skills: ${JSON.stringify((this.profile.skills || []).map(s => s.name))}.
3. Current experience baseline: ${baseEvaluation.experienceCompatibility} (Required: ${baseEvaluation.experienceRequiredRange}).

Respond in this JSON format only:
{"score": ${baseEvaluation.overallFitScore}, "isRecommended": ${baseEvaluation.isRecommended}, "matchedSkills": ${JSON.stringify(baseEvaluation.matchedSkills)}, "missingSkills": ${JSON.stringify(baseEvaluation.missingRequiredSkills)}, "reasoning": "${baseEvaluation.reasoning}"}`;

        const result = await this._sendGeminiMessage(prompt);
        const responseText = result.response.text().trim();

        let parsed;
        try {
          const cleanJson = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          parsed = JSON.parse(cleanJson);
        } catch (parseErr) {
          return baseEvaluation;
        }

        // Calibrate Gemini's raw score with experience bounds to prevent inflation
        let calibratedScore = Math.round(parsed.score || baseEvaluation.overallFitScore);
        if (baseEvaluation.experienceCompatibility === MatchingEngine.EXPERIENCE_CATEGORIES.BELOW_MANDATORY) {
          calibratedScore = Math.min(calibratedScore, 58);
        } else if (baseEvaluation.experienceCompatibility === MatchingEngine.EXPERIENCE_CATEGORIES.BELOW_PREFERRED) {
          calibratedScore = Math.min(calibratedScore, 74);
        }

        return {
          score: calibratedScore,
          overallFitScore: calibratedScore,
          technicalScore: baseEvaluation.technicalScore,
          experienceCompatibility: baseEvaluation.experienceCompatibility,
          experienceRequiredRange: baseEvaluation.experienceRequiredRange,
          isRecommended: calibratedScore >= (this.settings.automation?.minMatchScore || 65),
          matchedSkills: parsed.matchedSkills && parsed.matchedSkills.length > 0 ? parsed.matchedSkills : baseEvaluation.matchedSkills,
          missingSkills: parsed.missingSkills && parsed.missingSkills.length > 0 ? parsed.missingSkills : baseEvaluation.missingRequiredSkills,
          missingRequiredSkills: baseEvaluation.missingRequiredSkills,
          missingPreferredSkills: baseEvaluation.missingPreferredSkills,
          breakdown: baseEvaluation.breakdown,
          reasoning: parsed.reasoning || baseEvaluation.reasoning,
          scoringVersion: MatchingEngine.SCORING_VERSION,
          aiPowered: true
        };

      } catch (aiErr) {
        console.error('[AIAgent] Gemini job evaluation error, using calibrated MatchingEngine:', aiErr.message);
      }
    }

    // Fallback to local multi-dimensional MatchingEngine
    return baseEvaluation;
  }

  // ============================================================
  // LOCAL MULTI-DIMENSIONAL MATCHING ENGINE
  // ============================================================
  evaluateJobMatch(jobTitle, jobDescription, company) {
    return MatchingEngine.evaluate({
      title: jobTitle,
      description: jobDescription,
      company: company,
      profile: this.profile,
      minMatchScore: this.settings.automation?.minMatchScore || 65
    });
  }

  // ============================================================
  // STRICT DATA TYPE SANITIZER & OPTION MATCHER
  // ============================================================
  normalizeOptions(options = []) {
    if (!Array.isArray(options)) return [];
    return [...new Set(options
      .map(option => String(option || '').replace(/\s+/g, ' ').trim())
      // "on" is the browser's default radio value, not a candidate-visible choice.
      .filter(option => option && !/^(on|off|true|false)$/i.test(option)))];
  }

  sanitizeAnswerForInputType(rawAnswer, inputType = 'text', options = []) {
    if (rawAnswer === null || rawAnswer === undefined) return '';
    let val = String(rawAnswer).trim();

    // 1. NUMBER / NUMERIC ONLY INPUT FIELDS
    if (inputType === 'number') {
      // Extract numeric value only (e.g., "30 days" -> "30", "3 years" -> "3", "4.10 LPA" -> "4.10")
      const numMatch = val.match(/-?\d+(?:\.\d+)?/);
      if (numMatch) {
        return numMatch[0];
      }
      return '0';
    }

    // 2. DROPDOWN (SELECT) OR RADIO BUTTONS (MUST MATCH GIVEN OPTIONS)
    if ((inputType === 'select' || inputType === 'radio') && Array.isArray(options) && options.length > 0) {
      // A. Exact case-insensitive match
      const exact = options.find(o => o.trim().toLowerCase() === val.toLowerCase());
      if (exact) return exact;

      // B. Substring match (either option contains answer, or answer contains option)
      const sub = options.find(o => {
        const oL = o.trim().toLowerCase();
        const aL = val.toLowerCase();
        return oL.includes(aL) || aL.includes(oL);
      });
      if (sub) return sub;

      // C. Numeric range or exact number match inside options (e.g., answer is "3", option is "3 to 5 years", "1 to 3 years", "3+")
      const candNum = parseFloat(val.match(/-?\d+(?:\.\d+)?/)?.[0]);
      if (!isNaN(candNum)) {
        for (const opt of options) {
          const rangeMatch = opt.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/i);
          if (rangeMatch) {
            const min = parseFloat(rangeMatch[1]);
            const max = parseFloat(rangeMatch[2]);
            if (candNum >= min && candNum <= max) {
              return opt;
            }
          }
          const plusMatch = opt.match(/(\d+(?:\.\d+)?)\s*\+/);
          if (plusMatch) {
            const min = parseFloat(plusMatch[1]);
            if (candNum >= min) return opt;
          }
          const moreMatch = opt.match(/(?:more than|>)\s*(\d+(?:\.\d+)?)/i);
          if (moreMatch) {
            const min = parseFloat(moreMatch[1]);
            if (candNum > min) return opt;
          }
          const lessMatch = opt.match(/(?:less than|<)\s*(\d+(?:\.\d+)?)/i);
          if (lessMatch) {
            const max = parseFloat(lessMatch[1]);
            if (candNum < max) return opt;
          }
        }

        const numMatch = val.match(/\d+/);
        if (numMatch) {
          const numOpt = options.find(o => o.includes(numMatch[0]));
          if (numOpt) return numOpt;
        }
      }

      // D. Boolean / Affirmative match
      if (/^(yes|true|willing|authorized|agree|comfortable|expert|experienced)/i.test(val)) {
        const yesOpt = options.find(o => /^(yes|agree|authorized|willing|comfortable)/i.test(o.trim()));
        if (yesOpt) return yesOpt;
      }
      if (/^(no|false|not|none|require.*visa|refuse)/i.test(val)) {
        const noOpt = options.find(o => /^(no|none|never)/i.test(o.trim()));
        if (noOpt) return noOpt;
      }

      // Never select the first option just because an answer could not be
      // mapped. That silently submits incorrect answers (for example a random
      // work location). The caller will record the field for review instead.
      return '';
    }

    // 3. TEXT / TEXTAREA
    return val;
  }

  // ============================================================
  // SEMANTIC QUESTION NORMALIZER & INTENT CLASSIFIER
  // Eliminates duplicate questions with slight phrasing variations
  // ============================================================
  normalizeQuestionText(text) {
    if (!text) return '';
    let str = String(text).toLowerCase().trim();

    // Fix typical typos in job postings (e.g. "what is you Notice period")
    str = str.replace(/\byou\b/g, 'your');
    str = str.replace(/\bu\b/g, 'your');
    str = str.replace(/\bcurrent\s+compensation\b/g, 'current ctc');
    str = str.replace(/\bexpected\s+compensation\b/g, 'expected ctc');
    str = str.replace(/\bpresent\s+compensation\b/g, 'current ctc');
    str = str.replace(/\bcomp\b/g, 'compensation');

    // Strip noisy parentheticals & prompt constraints like (in LPA), (in days), (only whole numbers allowed)
    str = str.replace(/\((?:in\s+)?(?:days|lpa|lakhs?|years?|whole\s+numbers?|only\s+whole\s+numbers?\s+allowed|optional|fixed|negotiable|inr)\)/gi, ' ');
    str = str.replace(/\[(?:in\s+)?(?:days|lpa|lakhs?|years?|whole\s+numbers?)\]/gi, ' ');
    str = str.replace(/\b(only\s+whole\s+numbers?\s+allowed|whole\s+numbers?\s+only)\b/gi, ' ');

    // Remove punctuation
    str = str.replace(/[?*:,!;()\[\]"']/g, ' ');

    // Normalize spacing
    return str.replace(/\s+/g, ' ').trim();
  }

  getSemanticQuestionKey(questionText) {
    const norm = this.normalizeQuestionText(questionText);
    if (!norm) return 'unknown';

    // 1. Notice Period
    if (/\b(?:notice\s*period|days\s*to\s*join|how\s*soon\s*(?:can\s*you\s*)?start|joining\s*time|how\s*soon\s*(?:can\s*you\s*)?join)\b/i.test(norm)) {
      return 'intent:notice_period';
    }

    // 2. Current Compensation / CTC
    if (/\b(?:current\s*ctc|current\s*salary|current\s*compensation|current\s*package|present\s*ctc|current\s*annual)\b/i.test(norm) ||
        (norm.includes('current') && (norm.includes('salary') || norm.includes('ctc') || norm.includes('compensation') || norm.includes('package')))) {
      return 'intent:ctc_current';
    }

    // 3. Expected Compensation / CTC
    if (/\b(?:expected\s*ctc|expected\s*salary|expected\s*compensation|expected\s*package|salary\s*expectation)\b/i.test(norm) ||
        (norm.includes('expected') && (norm.includes('salary') || norm.includes('ctc') || norm.includes('compensation') || norm.includes('package')))) {
      return 'intent:ctc_expected';
    }

    // 4. Skill-specific experience vs Total experience
    const skillExpMatch = norm.match(/(?:years|experience).*(?:with|in|using|on)\s+([a-zA-Z0-9#\+\.\s_-]+)/i) ||
                          norm.match(/(?:with|in|using|on)\s+([a-zA-Z0-9#\+\.\s_-]+)\s*(?:experience|years)/i);
    if (skillExpMatch && skillExpMatch[1]) {
      const candidateTech = skillExpMatch[1].trim().toLowerCase().replace(/[^a-z0-9#+.]/g, '');
      const nonSkillWords = ['total', 'overall', 'it', 'software', 'softwaredevelopment', 'fullstack', 'all', 'industry', 'field', 'role', 'programming'];
      if (!nonSkillWords.includes(candidateTech) && candidateTech.length > 1) {
        return `intent:skill_exp:${candidateTech}`;
      }
    }

    // 5. Total Experience
    if (/\b(?:total\s*(?:years\s*(?:of\s*)?)?(?:work\s*)?experience|overall\s*experience|total\s*it\s*experience|total\s*experience)\b/i.test(norm) ||
        norm === 'how many years of work experience do you have' ||
        norm === 'total years of experience' ||
        norm === 'total experience') {
      return 'intent:total_experience';
    }

    // 6. Interview in person / F2F
    if (/\b(?:interview.*(?:in\s*person|face\s*to\s*face|f2f|in-office|office|onsite)|available\s*for\s*interview)\b/i.test(norm)) {
      return 'intent:interview_in_person';
    }

    // 7. BGV
    if (/\b(?:background\s*verification|bgv|background\s*check)\b/i.test(norm)) {
      return 'intent:bgv_consent';
    }

    // 8. Location & Personal
    if (/\b(?:city|current\s*city|city\s*of\s*residence|current\s*location|where\s*(?:are|do)\s*you\s*(?:live|reside))\b/i.test(norm)) return 'intent:city';
    if (/\b(?:country|current\s*country|citizenship|nationality)\b/i.test(norm)) return 'intent:country';
    if (/\b(?:state|province|region)\b/i.test(norm)) return 'intent:state';
    if (/\b(?:postal\s*code|zip\s*code|pincode|pin\s*code)\b/i.test(norm)) return 'intent:postal_code';
    if (/\b(?:address|street\s*address|residence\s*address)\b/i.test(norm)) return 'intent:address';
    if (/\b(?:phone\s*country\s*code|country\s*dial\s*code|dialing\s*code)\b/i.test(norm)) return 'intent:phone_code';
    if (/\b(?:phone\s*number|mobile\s*number|contact\s*number)\b/i.test(norm)) return 'intent:phone_number';

    // 9. Work Preferences
    if (/\b(?:relocate|willing\s*to\s*move)\b/i.test(norm)) return 'intent:relocate';
    if (/\b(?:work\s*remotely|hybrid|work\s*from\s*home)\b/i.test(norm)) return 'intent:work_mode';
    if (/\b(?:sponsorship|require\s*visa|need\s*sponsorship)\b/i.test(norm)) return 'intent:visa_sponsorship';

    // 10. Tricky & Legal Screening Questions
    // A. Previous employment with applying company
    if (/\b(?:worked\s*(?:with|at|for)\s*(?:us|this\s*company)|previous(?:ly)?\s*(?:employed|worked)|former\s*employee|ever\s*worked\s*(?:with|at|for)|previously\s*applied)\b/i.test(norm)) {
      return 'intent:previous_employee';
    }
    // B. Legal work authorization in applying country (India / country of job)
    if (/\b(?:legally\s*(?:authorized|eligible|permitted)|authorized\s*to\s*work|legal\s*right\s*to\s*work|eligible\s*to\s*work|legally\s*work)\b/i.test(norm)) {
      return 'intent:legal_work_auth';
    }
    // C. Disability status & self-identification
    if (/\b(?:disability|disabled|physical\s*or\s*mental\s*impairment|handicap|special\s*needs)\b/i.test(norm)) {
      return 'intent:disability_status';
    }
    // D. Veteran status
    if (/\b(?:veteran|protected\s*veteran|military\s*service|armed\s*forces)\b/i.test(norm)) {
      return 'intent:veteran_status';
    }
    // E. Criminal conviction / Felony
    if (/\b(?:convicted|felony|criminal\s*record|misdemeanor|crime)\b/i.test(norm)) {
      return 'intent:criminal_record';
    }
    // F. Non-compete / restrictive covenants
    if (/\b(?:non[\s-]*compete|restrictive\s*covenant|non[\s-]*solicitation)\b/i.test(norm)) {
      return 'intent:non_compete';
    }
    // G. Age legal requirement
    if (/\b(?:18\s*years|at\s*least\s*18|legal\s*age\s*to\s*work|minimum\s*age)\b/i.test(norm)) {
      return 'intent:age_legal';
    }
    // H. Relatives at company / Conflict of interest
    if (/\b(?:relatives?\s*(?:employed|working)|family\s*member|conflict\s*of\s*interest)\b/i.test(norm)) {
      return 'intent:conflict_of_interest';
    }
    // I. Drug testing & medical screening consent
    if (/\b(?:drug\s*test|drug\s*screen|substance\s*abuse\s*test)\b/i.test(norm)) {
      return 'intent:drug_test_consent';
    }

    // Fallback: simplified string key
    return 'norm:' + norm.slice(0, 40);
  }

  resolveSemanticQuestionIntent(questionText, options = [], inputType = 'text', context = {}) {
    const rawQ = (questionText || '').trim();
    if (!rawQ) return null;

    const norm = this.normalizeQuestionText(rawQ);
    const semanticKey = this.getSemanticQuestionKey(rawQ);
    const personal = this.profile.personal || {};
    const career = this.profile.career || {};
    const skills = this.profile.skills || [];

    // A. First priority: Check learned rules in profile.screeningQA that match rawQ or norm
    if (this.profile.screeningQA && Array.isArray(this.profile.screeningQA)) {
      for (const rule of this.profile.screeningQA) {
        try {
          const regex = new RegExp(rule.pattern, 'i');
          if (regex.test(rawQ) || regex.test(norm)) {
            let ans = rule.defaultAnswer;
            if (rule.answerType === 'dynamic_skill_lookup') {
              const matchedSkill = skills.find(s => norm.includes(s.name.toLowerCase()));
              if (matchedSkill) ans = String(matchedSkill.years);
            }
            return {
              answer: this.sanitizeAnswerForInputType(ans, inputType, options),
              confidence: 0.98,
              source: `Semantic Engine — Profile Memory Rule (${rule.pattern})`,
              semanticKey,
              aiPowered: false
            };
          }
        } catch (e) {}
      }
    }

    // B. Skill Experience Extraction (e.g. C#, Dot Net, Gen AI, Java, Angular, etc.)
    if (semanticKey.startsWith('intent:skill_exp:')) {
      const targetTech = semanticKey.replace('intent:skill_exp:', '').toLowerCase();

      // Check if targetTech matches any skill in candidate profile
      let matchedSkill = null;
      for (const skill of skills) {
        const sLower = skill.name.toLowerCase();
        const sClean = sLower.replace(/[^a-z0-9]/g, '');
        const targetClean = targetTech.replace(/[^a-z0-9]/g, '');

        // Exact skill match
        if (sClean === targetClean || sLower === targetTech) {
          matchedSkill = skill;
          break;
        }

        // Substring match for robust technology names (both must be >= 3 characters)
        if (sClean.length >= 3 && targetClean.length >= 3 && (targetClean.includes(sClean) || sClean.includes(targetClean))) {
          matchedSkill = skill;
          break;
        }

        // Token match with boundary safety (both token and target must be >= 3 characters)
        const sTokens = sLower.split(/[\/\,\s\(\)\+]+/).filter(t => t.length >= 3);
        if (targetClean.length >= 3 && sTokens.some(tok => targetClean.includes(tok) || targetClean === tok)) {
          matchedSkill = skill;
          break;
        }
      }

      if (matchedSkill) {
        const ans = this.sanitizeAnswerForInputType(String(matchedSkill.years), inputType, options);
        return {
          answer: ans,
          confidence: 0.98,
          source: `Semantic Engine — Matched profile skill "${matchedSkill.name}" (${matchedSkill.years} yrs)`,
          semanticKey,
          aiPowered: false
        };
      }

      // CRITICAL GENIUS RULE: If skill is NOT listed in candidate's profile (e.g. C#, Dot Net, Gen AI, Python, Ruby, PHP, Subversion):
      // The honest, optimal answer is strictly 0 (or "No" for radio/select/boolean options)!
      let zeroAns = '0';
      if ((inputType === 'radio' || inputType === 'select') && options.length > 0) {
        const noOpt = options.find(o => /^(no|none|never|0)/i.test(o.trim()));
        if (noOpt) zeroAns = noOpt;
      }
      return {
        answer: this.sanitizeAnswerForInputType(zeroAns, inputType, options),
        confidence: 0.98,
        source: `Semantic Engine — Unlisted skill "${targetTech}" auto-answered as 0 yrs`,
        semanticKey,
        aiPowered: false
      };
    }

    // C. Notice Period
    if (semanticKey === 'intent:notice_period') {
      const days = String(career.noticePeriodDays || 30);
      let ans = days;
      if ((inputType === 'select' || inputType === 'radio') && options.length > 0) {
        ans = this.sanitizeAnswerForInputType('30 days', inputType, options);
      } else if (inputType === 'text' && !norm.includes('day')) {
        ans = days; // Pure digits prevents LinkedIn validation failures
      }
      return {
        answer: ans,
        confidence: 0.98,
        source: `Semantic Engine — Notice Period (${days} days)`,
        semanticKey,
        aiPowered: false
      };
    }

    // D. Current Compensation / CTC
    if (semanticKey === 'intent:ctc_current') {
      const numVal = (career.currentSalaryLPA || '4.10').match(/\d+(?:\.\d+)?/)?.[0] || '4.10';
      return {
        answer: this.sanitizeAnswerForInputType(numVal, inputType, options),
        confidence: 0.98,
        source: `Semantic Engine — Current CTC (${career.currentSalaryLPA || '4.10 LPA'})`,
        semanticKey,
        aiPowered: false
      };
    }

    // E. Expected Compensation / CTC
    if (semanticKey === 'intent:ctc_expected') {
      const numVal = (career.expectedSalaryLPA || '10').match(/\d+(?:\.\d+)?/)?.[0] || '10';
      return {
        answer: this.sanitizeAnswerForInputType(numVal, inputType, options),
        confidence: 0.98,
        source: `Semantic Engine — Expected CTC (${career.expectedSalaryLPA || '10 LPA'})`,
        semanticKey,
        aiPowered: false
      };
    }

    // F. Total Experience
    if (semanticKey === 'intent:total_experience') {
      const yearsVal = String(career.totalYearsExperience || 3);
      return {
        answer: this.sanitizeAnswerForInputType(yearsVal, inputType, options),
        confidence: 0.98,
        source: `Semantic Engine — Total Experience (${yearsVal} yrs)`,
        semanticKey,
        aiPowered: false
      };
    }

    // G. Interview in Person / Face-to-Face & Background Verification
    if (semanticKey === 'intent:interview_in_person') {
      return {
        answer: this.sanitizeAnswerForInputType('Yes', inputType, options),
        confidence: 0.98,
        source: 'Semantic Engine — In-person interview availability (Yes)',
        semanticKey,
        aiPowered: false
      };
    }
    if (semanticKey === 'intent:bgv_consent') {
      return {
        answer: this.sanitizeAnswerForInputType('Yes', inputType, options),
        confidence: 0.98,
        source: 'Semantic Engine — Background verification consent (Yes)',
        semanticKey,
        aiPowered: false
      };
    }

    // H. Candidate Location Details
    if (semanticKey === 'intent:city') {
      return { answer: this.sanitizeAnswerForInputType(personal.city || 'Hyderabad', inputType, options), confidence: 0.98, source: 'Semantic Engine — Candidate City', semanticKey, aiPowered: false };
    }
    if (semanticKey === 'intent:country') {
      return { answer: this.sanitizeAnswerForInputType(personal.country || 'India', inputType, options), confidence: 0.98, source: 'Semantic Engine — Candidate Country', semanticKey, aiPowered: false };
    }
    if (semanticKey === 'intent:state') {
      return { answer: this.sanitizeAnswerForInputType(personal.state || 'Telangana', inputType, options), confidence: 0.98, source: 'Semantic Engine — Candidate State', semanticKey, aiPowered: false };
    }
    if (semanticKey === 'intent:postal_code') {
      return { answer: this.sanitizeAnswerForInputType(personal.postalCode || '500081', inputType, options), confidence: 0.98, source: 'Semantic Engine — Candidate Postal Code', semanticKey, aiPowered: false };
    }
    if (semanticKey === 'intent:address') {
      return { answer: this.sanitizeAnswerForInputType(personal.address || 'Flat 402, High-Tech Residency, Madhapur, Hyderabad, Telangana - 500081', inputType, options), confidence: 0.98, source: 'Semantic Engine — Candidate Address', semanticKey, aiPowered: false };
    }
    if (semanticKey === 'intent:phone_code') {
      return { answer: this.sanitizeAnswerForInputType(personal.phoneCountryCode || 'India (+91)', inputType, options), confidence: 0.98, source: 'Semantic Engine — Phone Country Code', semanticKey, aiPowered: false };
    }
    if (semanticKey === 'intent:phone_number') {
      return { answer: this.sanitizeAnswerForInputType(personal.phoneDigits || '8688373517', inputType, options), confidence: 0.98, source: 'Semantic Engine — Phone Number', semanticKey, aiPowered: false };
    }

    // Common profile-based long answers. These avoid wasting a Gemini request
    // on information already present verbatim in the candidate profile.
    if (/\b(?:describe|tell\s+us\s+about).*(?:role|work|responsibilit)/i.test(norm) &&
        /tech\s*mahindra|ge\s*aerospace|current/i.test(norm)) {
      const current = (this.profile.experience || [])[0] || {};
      return {
        answer: `As a ${current.title || career.currentDesignation || 'Full Stack Developer'} at ${career.currentCompany || 'Tech Mahindra'} for the GE Aerospace client, ${current.highlights || 'I build Angular and Spring Boot enterprise applications.'}`,
        confidence: 0.96, source: 'Semantic Engine — Current role summary', semanticKey: 'intent:current_role_summary', aiPowered: false
      };
    }
    if (/\b(?:personal\s+project|project\s+you\s+built|project.*impact|project.*tech)/i.test(norm)) {
      const project = (this.profile.projects || [])[0];
      if (project) {
        return {
          answer: `I built ${project.name}, a ${project.techStack} project. ${project.highlights || ''}`.trim(),
          confidence: 0.96, source: `Semantic Engine — Project summary (${project.name})`, semanticKey: 'intent:project_summary', aiPowered: false
        };
      }
    }

    // I. Work Preferences
    if (semanticKey === 'intent:relocate') {
      return { answer: this.sanitizeAnswerForInputType('Yes', inputType, options), confidence: 0.98, source: 'Semantic Engine — Willing to relocate (Yes)', semanticKey, aiPowered: false };
    }
    if (semanticKey === 'intent:work_mode') {
      return { answer: this.sanitizeAnswerForInputType('Yes', inputType, options), confidence: 0.98, source: 'Semantic Engine — Work mode flexibility (Yes)', semanticKey, aiPowered: false };
    }
    if (semanticKey === 'intent:visa_sponsorship') {
      return { answer: this.sanitizeAnswerForInputType('No', inputType, options), confidence: 0.98, source: 'Semantic Engine — Visa sponsorship needed (No)', semanticKey, aiPowered: false };
    }

    // J. Tricky & Legal Screening Questions
    if (semanticKey === 'intent:previous_employee') {
      const companyTarget = (context?.company || '').toLowerCase();
      const wasAtCompany = companyTarget.includes('tech mahindra') || companyTarget.includes('ge aerospace');
      const ans = wasAtCompany ? 'Yes' : 'No';
      return {
        answer: this.sanitizeAnswerForInputType(ans, inputType, options),
        confidence: 0.98,
        source: `Semantic Engine — Previous employee check for "${context?.company || 'Company'}" (Ans: ${ans})`,
        semanticKey,
        aiPowered: false
      };
    }
    if (semanticKey === 'intent:legal_work_auth') {
      return { answer: this.sanitizeAnswerForInputType('Yes', inputType, options), confidence: 0.98, source: 'Semantic Engine — Legal work authorization in India (Yes)', semanticKey, aiPowered: false };
    }
    if (semanticKey === 'intent:disability_status') {
      let ans = 'No';
      if ((inputType === 'radio' || inputType === 'select') && options.length > 0) {
        const noOpt = options.find(o => /no.*disability|^no$|do not have.*disability|prefer not to/i.test(o.trim()));
        if (noOpt) ans = noOpt;
      }
      return { answer: this.sanitizeAnswerForInputType(ans, inputType, options), confidence: 0.98, source: 'Semantic Engine — Disability status (No)', semanticKey, aiPowered: false };
    }
    if (semanticKey === 'intent:veteran_status') {
      let ans = 'No';
      if ((inputType === 'radio' || inputType === 'select') && options.length > 0) {
        const noOpt = options.find(o => /not a.*veteran|^no$|not protected/i.test(o.trim()));
        if (noOpt) ans = noOpt;
      }
      return { answer: this.sanitizeAnswerForInputType(ans, inputType, options), confidence: 0.98, source: 'Semantic Engine — Veteran status (No)', semanticKey, aiPowered: false };
    }
    if (semanticKey === 'intent:criminal_record') {
      return { answer: this.sanitizeAnswerForInputType('No', inputType, options), confidence: 0.98, source: 'Semantic Engine — Criminal conviction check (No)', semanticKey, aiPowered: false };
    }
    if (semanticKey === 'intent:non_compete') {
      return { answer: this.sanitizeAnswerForInputType('No', inputType, options), confidence: 0.98, source: 'Semantic Engine — Non-compete agreement check (No)', semanticKey, aiPowered: false };
    }
    if (semanticKey === 'intent:age_legal') {
      return { answer: this.sanitizeAnswerForInputType('Yes', inputType, options), confidence: 0.98, source: 'Semantic Engine — Age verification >= 18 (Yes)', semanticKey, aiPowered: false };
    }
    if (semanticKey === 'intent:conflict_of_interest') {
      return { answer: this.sanitizeAnswerForInputType('No', inputType, options), confidence: 0.98, source: 'Semantic Engine — Relatives/Conflict of interest (No)', semanticKey, aiPowered: false };
    }
    if (semanticKey === 'intent:drug_test_consent') {
      return { answer: this.sanitizeAnswerForInputType('Yes', inputType, options), confidence: 0.98, source: 'Semantic Engine — Drug testing & medical screening consent (Yes)', semanticKey, aiPowered: false };
    }

    return null;
  }

  // ============================================================
  // LOCAL FALLBACK: Pattern-based screening answer (no API needed)
  // Strictly typed for number, select, radio, or text
  // ============================================================
  answerScreeningQuestionLocal(questionText, options = [], inputType = 'text', context = {}) {
    // 1. Strongly-typed ScreeningClassifier (Strict email vs address, current vs expected CTC, notice, unlisted skills = 0)
    const classification = ScreeningClassifier.classifyIntent(questionText);
    if (classification.intent !== ScreeningClassifier.INTENTS.UNKNOWN_OR_UNSUPPORTED) {
      const resolved = ScreeningClassifier.resolveAnswer(classification, this.profile, options, inputType, context);
      if (resolved && resolved.proposedAnswer && resolved.confidence >= 0.85) {
        return {
          answer: resolved.proposedAnswer,
          confidence: resolved.confidence,
          source: `ScreeningClassifier — ${classification.intent} (${resolved.sourceField})`,
          aiPowered: false,
          intent: classification.intent,
          requiresReview: resolved.requiresReview
        };
      }
    }

    // 2. Try our Centralized Semantic Intent Classifier & Pattern Matcher
    const semanticMatch = this.resolveSemanticQuestionIntent(questionText, options, inputType, context);
    if (semanticMatch && semanticMatch.confidence >= 0.85) {
      return semanticMatch;
    }

    const q = (questionText || '').trim().toLowerCase();
    const personal = this.profile.personal || {};
    const career = this.profile.career || {};
    const skills = this.profile.skills || [];

    // 1. Check exact match rules from profile screeningQA
    if (this.profile.screeningQA && Array.isArray(this.profile.screeningQA)) {
      for (const rule of this.profile.screeningQA) {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(q)) {
          let ans = rule.defaultAnswer;
          if (rule.answerType === 'dynamic_skill_lookup') {
            const matchedSkill = skills.find(s => q.includes(s.name.toLowerCase()));
            if (matchedSkill) {
              ans = String(matchedSkill.years);
            }
          }
          ans = this.sanitizeAnswerForInputType(ans, inputType, options);
          return {
            answer: ans,
            confidence: 0.95,
            source: 'Local Fallback — Screening Q&A memory match',
            aiPowered: false
          };
        }
      }
    }

    // 2. Years of experience pattern (total or skill-specific)
    if (q.includes('how many years') || q.includes('years of experience') || q.includes('years experience') || q.includes('total experience') || q.includes('overall experience') || q.includes('work experience')) {
      for (const skill of skills) {
        const skillTokens = skill.name.toLowerCase().split(/[\/\,\s]+/).filter(t => t.length > 2);
        for (const token of skillTokens) {
          if (q.includes(token)) {
            const yearsVal = String(skill.years);
            return {
              answer: this.sanitizeAnswerForInputType(yearsVal, inputType, options),
              confidence: 0.95,
              source: `Local Fallback — Skill lookup for ${skill.name}`,
              aiPowered: false
            };
          }
        }
      }
      return {
        answer: this.sanitizeAnswerForInputType(String(career.totalYearsExperience || 3), inputType, options),
        confidence: 0.85,
        source: 'Local Fallback — Total career experience',
        aiPowered: false
      };
    }

    // 3. Notice period questions
    if (q.includes('notice period') || q.includes('days to join') || q.includes('how soon can you start') || q.includes('joining time')) {
      if (options.length > 0) {
        const opt = this.sanitizeAnswerForInputType('30 days', 'select', options);
        if (opt) return { answer: opt, confidence: 0.92, source: 'Local Fallback — Option match', aiPowered: false };
      }
      const days = String(career.noticePeriodDays || 30);
      const ans = inputType === 'number' ? days : `${days} days (Negotiable)`;
      return {
        answer: this.sanitizeAnswerForInputType(ans, inputType, options),
        confidence: 0.92,
        source: 'Local Fallback — Career profile notice period',
        aiPowered: false
      };
    }

    // 4. Salary / CTC questions
    if (q.includes('current ctc') || q.includes('current salary') || q.includes('current annual')) {
      const numVal = (career.currentSalaryLPA || '4.10').match(/\d+(?:\.\d+)?/)?.[0] || '4.10';
      const ans = inputType === 'number' ? numVal : (career.currentSalaryLPA || '4.10 LPA');
      return { answer: this.sanitizeAnswerForInputType(ans, inputType, options), confidence: 0.9, source: 'Local Fallback — Current compensation', aiPowered: false };
    }
    if (q.includes('expected ctc') || q.includes('expected salary') || q.includes('salary expectation')) {
      const numVal = (career.expectedSalaryLPA || '11').match(/\d+(?:\.\d+)?/)?.[0] || '11';
      const ans = inputType === 'number' ? numVal : (career.expectedSalaryLPA || '11 LPA');
      return { answer: this.sanitizeAnswerForInputType(ans, inputType, options), confidence: 0.9, source: 'Local Fallback — Expected compensation', aiPowered: false };
    }

    // 5. Relocation & Remote
    if (q.includes('relocate') || q.includes('willing to move')) {
      const ans = this.sanitizeAnswerForInputType(career.willingToRelocate ? 'Yes' : 'No', inputType, options);
      return { answer: ans, confidence: 0.95, source: 'Local Fallback — Relocation preference', aiPowered: false };
    }
    if (q.includes('remote') || q.includes('hybrid') || q.includes('work from home')) {
      const ans = this.sanitizeAnswerForInputType('Yes', inputType, options);
      return { answer: ans, confidence: 0.95, source: 'Local Fallback — Remote preference', aiPowered: false };
    }

    // 6. Visa / Sponsorship / Citizenship
    if (q.includes('sponsorship') || q.includes('require visa') || q.includes('need sponsorship')) {
      const ans = this.sanitizeAnswerForInputType(career.needsVisaSponsorship ? 'Yes' : 'No', inputType, options);
      return { answer: ans, confidence: 0.98, source: 'Local Fallback — Visa authorization', aiPowered: false };
    }
    if (q.includes('authorized to work') || q.includes('legal right to work') || q.includes('citizen')) {
      const ans = this.sanitizeAnswerForInputType('Yes', inputType, options);
      return { answer: ans, confidence: 0.98, source: 'Local Fallback — Work authorization', aiPowered: false };
    }

    // 7. Location & Address Specific Patterns (City, State, Country, Postal Code, Address)
    if (/\bcity\b|current city|city of residence|location preference/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType(personal.city || 'Hyderabad', inputType, options);
      return { answer: ans, confidence: 0.96, source: 'Local Fallback — Candidate City', aiPowered: false };
    }
    if (/\bcountry\b|country of residence|current country|nationality|citizenship/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType(personal.country || 'India', inputType, options);
      return { answer: ans, confidence: 0.96, source: 'Local Fallback — Candidate Country', aiPowered: false };
    }
    if (/\bstate\b|province|region/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType(personal.state || 'Telangana', inputType, options);
      return { answer: ans, confidence: 0.96, source: 'Local Fallback — Candidate State', aiPowered: false };
    }
    if (/postal code|zip code|pincode|pin code/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType(personal.postalCode || '500081', inputType, options);
      return { answer: ans, confidence: 0.96, source: 'Local Fallback — Candidate Postal Code', aiPowered: false };
    }
    if (/\baddress\b|street address|address line|home address/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType(personal.address || personal.streetAddress || 'Hyderabad, Telangana, India', inputType, options);
      return { answer: ans, confidence: 0.96, source: 'Local Fallback — Candidate Address', aiPowered: false };
    }
    if (/phone country code|country dial code|dialing code|phone code/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType(personal.phoneCountryCode || 'India (+91)', inputType, options);
      return { answer: ans, confidence: 0.96, source: 'Local Fallback — Phone Country Code', aiPowered: false };
    }
    if (/phone number|mobile number|contact number|cell phone/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType(personal.phoneDigits || '8688373517', inputType, options);
      return { answer: ans, confidence: 0.96, source: 'Local Fallback — Phone Number', aiPowered: false };
    }

    // 8. Personal identity & Education
    if (/first name|given name/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType(personal.firstName || 'Sai Krishna', inputType, options);
      return { answer: ans, confidence: 0.98, source: 'Local Fallback — First Name', aiPowered: false };
    }
    if (/last name|surname|family name/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType(personal.lastName || 'G', inputType, options);
      return { answer: ans, confidence: 0.98, source: 'Local Fallback — Last Name', aiPowered: false };
    }
    if (/gender|sex/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType(personal.gender || 'Male', inputType, options);
      return { answer: ans, confidence: 0.98, source: 'Local Fallback — Gender', aiPowered: false };
    }
    if (/university|college|institution|school/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType(this.profile.education?.institution || 'SRM Institute of Science and Technology', inputType, options);
      return { answer: ans, confidence: 0.95, source: 'Local Fallback — Education Institution', aiPowered: false };
    }
    if (/graduation year|year of graduation|year of passing/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType(String(this.profile.education?.graduationYear || 2023), inputType, options);
      return { answer: ans, confidence: 0.95, source: 'Local Fallback — Graduation Year', aiPowered: false };
    }
    if (/cgpa|gpa|percentage/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType(String(this.profile.education?.cgpa || '8.9'), inputType, options);
      return { answer: ans, confidence: 0.95, source: 'Local Fallback — CGPA', aiPowered: false };
    }
    if (/current company|current employer|present employer/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType(career.currentCompany || 'Tech Mahindra', inputType, options);
      return { answer: ans, confidence: 0.95, source: 'Local Fallback — Current Company', aiPowered: false };
    }
    if (/current designation|current job title|current role/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType(career.currentDesignation || 'Full Stack Developer', inputType, options);
      return { answer: ans, confidence: 0.95, source: 'Local Fallback — Current Designation', aiPowered: false };
    }

    // 9. Interview Availability (In-Person / Virtual) & Background Checks
    if (/interview.*(?:in person|face to face|f2f|in-office|office|onsite)|available for interview|in-person interview|face-to-face/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType('Yes', inputType, options);
      return { answer: ans, confidence: 0.96, source: 'Local Fallback — In-person interview availability', aiPowered: false };
    }
    if (/background verification|bgv|background check/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType('Yes', inputType, options);
      return { answer: ans, confidence: 0.96, source: 'Local Fallback — Background verification consent', aiPowered: false };
    }
    if (/currently employed|are you currently working|presently working/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType('Yes', inputType, options);
      return { answer: ans, confidence: 0.96, source: 'Local Fallback — Current employment status', aiPowered: false };
    }
    if (/serving notice period|currently serving/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType('No', inputType, options);
      return { answer: ans, confidence: 0.96, source: 'Local Fallback — Serving notice status', aiPowered: false };
    }
    if (/all documents|relieving letter|payslips|form 16/i.test(q)) {
      const ans = this.sanitizeAnswerForInputType('Yes', inputType, options);
      return { answer: ans, confidence: 0.96, source: 'Local Fallback — Documentation readiness', aiPowered: false };
    }

    // 10. An unknown choice field needs Gemini. Do not assume "Yes" or pick
    // the first option: both behaviours produced incorrect submissions.
    if (options.length > 0) {
      return { answer: '', confidence: 0.2, source: 'Local Fallback — Unknown choice (needs AI/review)', aiPowered: false };
    }

    // 8. Cover letter / open-ended
    if (q.includes('cover letter') || q.includes('why are you interested') || q.includes('why should we hire you')) {
      return {
        answer: `${this.profile.customCoverLetterIntro || ''} I have a proven track record delivering scalable enterprise solutions with Angular and Spring Boot and would be thrilled to contribute to your engineering goals.`,
        confidence: 0.85,
        source: 'Local Fallback — AI tailored cover statement',
        aiPowered: false
      };
    }

    // Unknown questions must be sent to Gemini when available. If it is
    // unavailable, leave them blank instead of inventing a positive answer.
    return { answer: '', confidence: 0.2, source: 'Local Fallback — Unknown question (needs AI/review)', aiPowered: false };
  }

  // ============================================================
  // Synchronous wrapper for backward compatibility with bots
  // Uses cached results or local fallback for sync callers
  // ============================================================
  answerScreeningQuestion(questionText, options = [], inputType = 'text', context = {}) {
    const cacheKey = `${(questionText || '').trim()}|${options.join(',')}|${inputType}`;
    if (this.answerCache.has(cacheKey)) {
      return this.answerCache.get(cacheKey);
    }
    // Return local fallback for sync callers
    return this.answerScreeningQuestionLocal(questionText, options, inputType);
  }

  // ============================================================
  // PERSISTENT AUDIT LOG & RULE LEARNING ENGINE
  // ============================================================

  loadAuditLog() {
    try {
      if (fs.existsSync(this.auditLogPath)) {
        const raw = fs.readFileSync(this.auditLogPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (err) {
      console.warn('[AIAgent] Could not read qa_audit_log.json:', err.message);
    }
    return [];
  }

  saveAuditLog(data = null) {
    try {
      const toWrite = data || this.auditLog;
      fs.writeFileSync(this.auditLogPath, JSON.stringify(toWrite, null, 2), 'utf8');
    } catch (err) {
      console.error('[AIAgent] Failed to save qa_audit_log.json:', err.message);
    }
  }

  recordAuditEntry(entry) {
    if (!entry) return;
    // Prepend to show latest first
    this.auditLog.unshift(entry);
    // Keep max 500 audit items to avoid unbounded memory growth
    if (this.auditLog.length > 500) {
      this.auditLog = this.auditLog.slice(0, 500);
    }
    this.saveAuditLog();

    // Trigger callback (for server WebSocket real-time broadcast)
    if (typeof this.onAuditCallback === 'function') {
      try {
        this.onAuditCallback(entry);
      } catch (cbErr) {
        console.error('[AIAgent] Error in onAuditCallback:', cbErr.message);
      }
    }
  }

  getAuditLog() {
    return this.auditLog || [];
  }

  getAuditStats() {
    const total = this.auditLog.length;
    let geminiCount = 0;
    let localCount = 0;
    let savedAsRuleCount = 0;

    for (const item of this.auditLog) {
      if (item.engine && item.engine.includes('Gemini')) {
        geminiCount++;
      } else {
        localCount++;
      }
      if (item.status === 'saved_as_rule') {
        savedAsRuleCount++;
      }
    }

    const totalProfileRules = (this.profile?.screeningQA || []).length;

    return {
      total,
      geminiCount,
      localCount,
      savedAsRuleCount,
      totalProfileRules
    };
  }

  clearAuditLog() {
    this.auditLog = [];
    this.saveAuditLog([]);
    return true;
  }

  deleteAuditEntry(id) {
    const initialLen = this.auditLog.length;
    this.auditLog = this.auditLog.filter(item => item.id !== id);
    if (this.auditLog.length !== initialLen) {
      this.saveAuditLog();
      return true;
    }
    return false;
  }

  isRuleInProfile(questionText) {
    if (!this.profile?.screeningQA || !Array.isArray(this.profile.screeningQA)) return false;
    const q = (questionText || '').trim().toLowerCase();
    return this.profile.screeningQA.some(rule => {
      try {
        return new RegExp(rule.pattern, 'i').test(q);
      } catch (e) {
        return false;
      }
    });
  }

  _generateRegexPattern(qText) {
    if (!qText) return '.*';
    const norm = this.normalizeQuestionText(qText);
    const semKey = this.getSemanticQuestionKey(qText);

    if (semKey === 'intent:notice_period') {
      return 'notice\\s*period|how\\s*soon.*join|days\\s*to\\s*join|joining\\s*time';
    }
    if (semKey === 'intent:ctc_current') {
      return 'current.*(?:ctc|salary|compensation|package|remuneration)';
    }
    if (semKey === 'intent:ctc_expected') {
      return 'expected.*(?:ctc|salary|compensation|package|remuneration|expectation)';
    }
    if (semKey === 'intent:total_experience') {
      return 'total.*(?:work\\s*)?experience|overall\\s*experience|total\\s*years';
    }
    if (semKey.startsWith('intent:skill_exp:')) {
      const tech = semKey.replace('intent:skill_exp:', '');
      return `(?:years|experience).*(?:with|in|using|on)?\\s*${tech}|${tech}.*(?:years|experience)`;
    }
    if (semKey === 'intent:interview_in_person') {
      return 'interview.*(?:in\\s*person|face\\s*to\\s*face|f2f|in-office|office|onsite)|available\\s*for\\s*interview';
    }
    if (semKey === 'intent:bgv_consent') {
      return 'background\\s*verification|bgv|background\\s*check';
    }

    // Pick top 3-4 significant words
    const stopWords = new Set(['what', 'is', 'your', 'are', 'you', 'the', 'a', 'an', 'in', 'on', 'for', 'to', 'of', 'and', 'do', 'have', 'please', 'can', 'any', 'enter', 'yes', 'no', 'if', 'not']);
    const words = norm.split(' ').filter(w => w.length > 2 && !stopWords.has(w));
    if (words.length > 0) {
      if (words.length === 1 && words[0].length <= 6) {
        return `^\\s*${words[0]}\\s*$`;
      }
      return words.slice(0, 4).join('.*');
    }

    return `^\\s*${norm.slice(0, 40)}\\s*$`;
  }

  saveRuleToMemory({ id, question, pattern, answer, answerType = 'fixed' }) {
    if (!this.profile.screeningQA) {
      this.profile.screeningQA = [];
    }

    const effectivePattern = pattern || this._generateRegexPattern(question);
    const finalAnswer = String(answer !== undefined ? answer : '').trim();

    // Check if an existing rule with this pattern already exists
    const existingIdx = this.profile.screeningQA.findIndex(
      r => r.pattern.toLowerCase() === effectivePattern.toLowerCase()
    );

    const newRule = {
      pattern: effectivePattern,
      answerType: answerType || 'fixed',
      defaultAnswer: finalAnswer,
      notes: `Learned from screening Q: "${(question || '').substring(0, 60)}"`,
      updatedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      this.profile.screeningQA[existingIdx] = newRule;
    } else {
      // Prepend so newly learned rules take immediate priority
      this.profile.screeningQA.unshift(newRule);
    }

    // Save profile to disk
    try {
      fs.writeFileSync(this.profilePath, JSON.stringify(this.profile, null, 2), 'utf8');
      console.log(`[AIAgent] Saved permanent memory rule to profile.json: /${effectivePattern}/i -> "${finalAnswer}"`);
    } catch (err) {
      console.error('[AIAgent] Failed to write profile.json:', err.message);
      throw err;
    }

    // Mark matching audit log entries as 'saved_as_rule'
    for (const item of this.auditLog) {
      if (item.id === id || (question && item.question.toLowerCase() === question.toLowerCase())) {
        item.status = 'saved_as_rule';
        item.savedRulePattern = effectivePattern;
        item.answer = finalAnswer;
      }
    }
    this.saveAuditLog();

    // Invalidate answerCache so future questions use the verified rule immediately!
    this.answerCache.clear();

    return {
      success: true,
      rule: newRule,
      totalRules: this.profile.screeningQA.length
    };
  }

  // ============================================================
  // UNFILLED / MISSING FIELDS TRACKING & RESOLUTION ENGINE
  // ============================================================

  loadUnfilledQuestions() {
    try {
      if (fs.existsSync(this.unfilledQuestionsPath)) {
        const raw = fs.readFileSync(this.unfilledQuestionsPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (err) {
      console.warn('[AIAgent] Could not read unfilled_questions.json:', err.message);
    }
    return [];
  }

  saveUnfilledQuestions(data = null) {
    try {
      const toWrite = data || this.unfilledQuestions;
      fs.writeFileSync(this.unfilledQuestionsPath, JSON.stringify(toWrite, null, 2), 'utf8');
    } catch (err) {
      console.error('[AIAgent] Failed to save unfilled_questions.json:', err.message);
    }
  }

  recordUnfilledQuestion({ question, label, inputType = 'text', options = [], platform = 'General', jobTitle = 'N/A', company = 'N/A', reason = 'Skipped or left empty by automation', context = {} }) {
    if (!question && !label) return null;
    const rawQ = (question || label || '').trim();
    const semanticKey = this.getSemanticQuestionKey(rawQ);

    // 1. SMART CHECK: Can this question already be resolved with high confidence by semantic intent or memory?
    const semanticRes = this.resolveSemanticQuestionIntent(rawQ, options, inputType);
    if (semanticRes && semanticRes.confidence >= 0.90) {
      console.log(`[AIAgent] ✨ Question "${rawQ.substring(0, 50)}" is already resolved by semantic engine (${semanticKey} -> "${semanticRes.answer}"). Suppressing from unfilled queue.`);
      return null;
    }

    // 2. SMART DEDUPLICATION: Check if this question or a question with the SAME semanticKey is already in the list
    const existing = this.unfilledQuestions.find(
      u => (u.semanticKey && u.semanticKey === semanticKey) ||
           (u.question && this.getSemanticQuestionKey(u.question) === semanticKey) ||
           (u.question && u.question.toLowerCase() === rawQ.toLowerCase())
    );

    if (existing) {
      if (existing.status === 'resolved') {
        console.log(`[AIAgent] ✨ Question "${rawQ.substring(0, 50)}" was already resolved in memory (${existing.resolvedAnswer}). Suppressing.`);
        return null;
      }
      existing.occurrences = (existing.occurrences || 1) + 1;
      existing.lastEncountered = new Date().toISOString();
      existing.jobTitle = jobTitle;
      existing.company = company;
      existing.reason = reason;
      if (options && options.length > 0 && (!existing.options || existing.options.length === 0)) {
        existing.options = options;
      }
      this.saveUnfilledQuestions();
      if (this.onUnfilledCallback) this.onUnfilledCallback(existing);
      return existing;
    }

    const entry = {
      id: `unfilled-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      semanticKey,
      question: rawQ,
      label: (label || rawQ).trim(),
      inputType: inputType || 'text',
      options: Array.isArray(options) ? options : [],
      platform,
      jobTitle,
      company,
      reason,
      status: 'pending', // 'pending' | 'resolved' | 'dismissed'
      occurrences: 1,
      createdAt: new Date().toISOString(),
      lastEncountered: new Date().toISOString()
    };

    this.unfilledQuestions.unshift(entry);
    this.saveUnfilledQuestions();

    console.log(`[AIAgent] ⚠️ Recorded unfilled question for manual input: "${rawQ.substring(0, 50)}" [${semanticKey}] (${platform})`);

    if (this.onUnfilledCallback) {
      this.onUnfilledCallback(entry);
    }

    return entry;
  }

  getUnfilledQuestions() {
    return this.unfilledQuestions.filter(q => q.status === 'pending');
  }

  resolveUnfilledQuestion({ id, question, answer, inputType = 'text', pattern = null, saveAsRule = true }) {
    const finalAnswer = String(answer !== undefined ? answer : '').trim();
    let target = this.unfilledQuestions.find(u => u.id === id);
    if (!target && question) {
      target = this.unfilledQuestions.find(u => u.question.toLowerCase() === question.toLowerCase());
    }

    const qText = target ? target.question : (question || '');
    const semanticKey = target?.semanticKey || this.getSemanticQuestionKey(qText);

    // Mark ALL entries matching this semanticKey or ID as resolved
    for (const item of this.unfilledQuestions) {
      if (item.id === id || (item.semanticKey && item.semanticKey === semanticKey) || (item.question && this.getSemanticQuestionKey(item.question) === semanticKey)) {
        item.status = 'resolved';
        item.resolvedAnswer = finalAnswer;
        item.resolvedAt = new Date().toISOString();
      }
    }
    this.saveUnfilledQuestions();

    let savedRule = null;
    if (saveAsRule) {
      savedRule = this.saveRuleToMemory({
        question: qText,
        pattern: pattern || this._generateRegexPattern(qText),
        answer: finalAnswer,
        answerType: 'fixed'
      });
    }

    // Invalidate answer cache
    this.answerCache.clear();

    return {
      success: true,
      resolvedEntry: target,
      savedRule: savedRule?.rule || null,
      remainingUnfilled: this.getUnfilledQuestions().length
    };
  }

  dismissUnfilledQuestion(id) {
    const idx = this.unfilledQuestions.findIndex(u => u.id === id);
    if (idx >= 0) {
      this.unfilledQuestions[idx].status = 'dismissed';
      this.unfilledQuestions[idx].dismissedAt = new Date().toISOString();
      this.saveUnfilledQuestions();
      return true;
    }
    return false;
  }

  clearUnfilledQuestions() {
    this.unfilledQuestions = [];
    this.saveUnfilledQuestions();
    return true;
  }

  // Reset rate-limit cooldown so user can force immediate retry
  resetCooldown() {
    this.aiUnavailableUntil = 0;
    this._updateTelemetry({
      status: 'idle',
      isThrottled: false,
      throttledUntil: null
    });
    console.log('[AIAgent] Gemini API rate-limit cooldown manually reset.');
    return { success: true, message: 'Gemini rate-limit cooldown reset. Ready for next call.' };
  }

  // Interactive diagnostic test to verify Gemini API connection and view prompt/response
  async testGeminiCall(sampleQuestion) {
    const q = (sampleQuestion || '').trim() || 'How many years of experience do you have with Angular and Java?';
    this.aiUnavailableUntil = 0; // Clear throttle for intentional user tests
    
    // Clear cache for this test so it always hits Gemini
    const cacheKeyPattern = q.toLowerCase();
    for (const k of this.answerCache.keys()) {
      if (k.toLowerCase().includes(cacheKeyPattern)) this.answerCache.delete(k);
    }

    const testContext = {
      platform: 'Dashboard Interactive Tester',
      company: 'Infosys',
      jobTitle: 'Full Stack Java & Angular Developer'
    };

    console.log(`[AIAgent] Running interactive test call to Gemini API: "${q}"...`);
    const callStart = Date.now();
    let prompt = `SCREENING QUESTION: "${q}"\nTARGET COMPANY: "${testContext.company}"\nJOB TITLE: "${testContext.jobTitle}"\nJOB PLATFORM: "${testContext.platform}"\nINPUT FIELD TYPE: NUMBER\nCRITICAL FORMAT RULE: The field accepts NUMBERS ONLY. Your "answer" MUST be digits/numeric value only (e.g. "3", "30", "4.1"). DO NOT include words like "years", "days", "LPA", or symbols.\n\nAnalyze this question carefully using the candidate's full profile and provide the most accurate, contextual answer. Respond in JSON format only.`;

    this._updateTelemetry({
      status: 'calling',
      currentCall: {
        question: q,
        inputType: 'number',
        options: [],
        context: testContext,
        promptSnippet: prompt.slice(0, 300),
        startedAt: new Date().toISOString()
      }
    });

    try {
      const result = await this._sendGeminiMessage(prompt);
      const responseText = result.response.text().trim();
      const latencyMs = Date.now() - callStart;

      let parsed = null;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch (e) {}
      }
      if (!parsed || !parsed.answer) {
        parsed = {
          answer: responseText.replace(/```json/gi, '').replace(/```/g, '').trim(),
          confidence: 0.95,
          reasoning: 'Extracted from AI response'
        };
      }

      const finalAns = this.sanitizeAnswerForInputType(parsed.answer, 'number', []);

      this.apiLiveTelemetry.stats.totalCalls++;
      this.apiLiveTelemetry.stats.successCalls++;
      this._updateTelemetry({
        status: 'success',
        lastCallLatencyMs: latencyMs,
        lastCallTimestamp: new Date().toISOString(),
        currentCall: null,
        lastCall: {
          question: q,
          prompt,
          options: [],
          inputType: 'number',
          context: testContext,
          rawResponse: responseText,
          parsedResponse: parsed,
          finalAnswer: finalAns,
          latencyMs,
          timestamp: new Date().toISOString(),
          status: 'success',
          error: null
        }
      });

      return {
        success: true,
        answer: finalAns,
        confidence: parsed.confidence || 0.95,
        reasoning: parsed.reasoning || 'Evaluated from candidate profile',
        latencyMs,
        model: this.activeModelName,
        rawResponse: responseText,
        telemetry: this.getLiveTelemetry()
      };
    } catch (err) {
      const latencyMs = Date.now() - callStart;
      const isThrottle = this._isGeminiThrottleError(err);
      this.apiLiveTelemetry.stats.totalCalls++;
      this.apiLiveTelemetry.stats.failedCalls++;
      if (isThrottle) this.apiLiveTelemetry.stats.throttledCalls++;

      this._updateTelemetry({
        status: isThrottle ? 'throttled' : 'error',
        lastCallLatencyMs: latencyMs,
        lastCallTimestamp: new Date().toISOString(),
        currentCall: null,
        lastCall: {
          question: q,
          prompt,
          options: [],
          inputType: 'number',
          context: testContext,
          rawResponse: null,
          parsedResponse: null,
          finalAnswer: '3',
          latencyMs,
          timestamp: new Date().toISOString(),
          status: isThrottle ? 'throttled' : 'error',
          error: err.message
        }
      });

      return {
        success: false,
        error: err.message,
        latencyMs,
        model: this.activeModelName,
        isThrottled: isThrottle,
        telemetry: this.getLiveTelemetry()
      };
    }
  }

  // Get AI status for the dashboard
  getStatus() {
    return {
      provider: 'Google Gemini',
      model: this.activeModelName || this.settings?.ai?.model || 'gemini-3.5-flash',
      initialized: this.isInitialized,
      hasApiKey: !!(this.settings?.ai?.apiKey),
      cacheSize: this.answerCache.size,
      auditLogCount: this.auditLog.length,
      unfilledQuestionsCount: this.getUnfilledQuestions().length,
      memoryRulesCount: (this.profile?.screeningQA || []).length,
      telemetry: this.getLiveTelemetry()
    };
  }
}

module.exports = AIAgent;
