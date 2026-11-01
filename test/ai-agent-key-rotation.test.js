const test = require('node:test');
const assert = require('node:assert/strict');
const AIAgent = require('../engine/ai-agent');

test('AIAgent - Multi-Key Rotation & Per-Key Cooldown Resilience', async (t) => {
  const mockSettings = {
    ai: {
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      apiKey: 'TEST_KEY_ALPHA_111111111111111111111111',
      apiKeys: [
        'TEST_KEY_BETA_2222222222222222222222222',
        'TEST_KEY_GAMMA_333333333333333333333333',
        'TEST_KEY_DELTA_444444444444444444444444'
      ]
    }
  };

  const mockProfile = {
    personal: { fullName: 'Sai Krishna G', email: 'gsaikrishna150@gmail.com' },
    career: { totalYearsExperience: 3, currentSalaryLPA: 4.1, expectedSalaryLPA: 10.0, noticePeriodDays: 30 },
    skills: [{ name: 'Java', years: 3 }, { name: 'Angular', years: 3 }]
  };

  await t.test('Loads all 4 configured API keys into the rotation pool', () => {
    const agent = new AIAgent(mockProfile, mockSettings);
    assert.equal(agent.apiKeys.length, 4);
    assert.equal(agent.apiKeys[0], 'TEST_KEY_ALPHA_111111111111111111111111');
    assert.equal(agent.apiKeys[3], 'TEST_KEY_DELTA_444444444444444444444444');
    assert.equal(agent.apiKeyIndex, 0);
    assert.equal(agent.hasAnyAvailableKey(), true);
  });

  await t.test('Tracks cooldown per key instead of locking out the entire agent', () => {
    const agent = new AIAgent(mockProfile, mockSettings);
    const key1 = agent.apiKeys[0];

    assert.equal(agent.isKeyAvailable(key1), true);

    // Simulate 429 quota error on Key 1 with retryDelay
    agent.markKeyThrottled(key1, new Error('429 Quota Exceeded retryDelay 60s'));

    // Key 1 is cooling down
    assert.equal(agent.isKeyAvailable(key1), false);
    // Keys 2, 3, 4 are still healthy
    assert.equal(agent.isKeyAvailable(agent.apiKeys[1]), true);
    assert.equal(agent.isKeyAvailable(agent.apiKeys[2]), true);
    assert.equal(agent.isKeyAvailable(agent.apiKeys[3]), true);
    assert.equal(agent.hasAnyAvailableKey(), true);

    // Live telemetry reflects that Gemini is NOT throttled because other keys are ready
    const telemetry = agent.getLiveTelemetry();
    assert.equal(telemetry.isThrottled, false);
    assert.equal(telemetry.cooldownRemainingSeconds, 0);
  });

  await t.test('_rotateGeminiKey skips cooling keys and selects the next healthy key', () => {
    const agent = new AIAgent(mockProfile, mockSettings);
    agent.markKeyThrottled(agent.apiKeys[0], new Error('429 Quota Exceeded'));
    agent.markKeyThrottled(agent.apiKeys[1], new Error('429 Quota Exceeded'));

    // Rotating should skip Key 0 and Key 1, landing on Key 2
    agent._rotateGeminiKey();
    assert.equal(agent.apiKeyIndex, 2);
    assert.equal(agent.isKeyAvailable(agent.apiKeys[agent.apiKeyIndex]), true);
  });

  await t.test('Telemetry reports throttled only when ALL 4 keys in the pool are cooling down', () => {
    const agent = new AIAgent(mockProfile, mockSettings);
    agent.apiKeys.forEach(k => agent.markKeyThrottled(k, new Error('429 Quota Exceeded retryDelay 300s')));

    assert.equal(agent.hasAnyAvailableKey(), false);
    const telemetry = agent.getLiveTelemetry();
    assert.equal(telemetry.isThrottled, true);
    assert.ok(telemetry.cooldownRemainingSeconds > 0);
    assert.ok(telemetry.cooldownRemainingSeconds <= 300);
  });

  await t.test('resetCooldown clears all key cooldowns and re-activates Key 1', () => {
    const agent = new AIAgent(mockProfile, mockSettings);
    agent.apiKeys.forEach(k => agent.markKeyThrottled(k, new Error('429 Quota Exceeded')));

    assert.equal(agent.hasAnyAvailableKey(), false);

    const resetResult = agent.resetCooldown();
    assert.equal(resetResult.success, true);
    assert.equal(agent.apiKeyIndex, 0);
    assert.equal(agent.hasAnyAvailableKey(), true);
    assert.equal(agent.isKeyAvailable(agent.apiKeys[0]), true);

    const telemetry = agent.getLiveTelemetry();
    assert.equal(telemetry.isThrottled, false);
    assert.equal(telemetry.cooldownRemainingSeconds, 0);
  });

  await t.test('Groq Integration: Initializes with Groq provider and model', () => {
    const groqSettings = {
      ai: {
        provider: 'auto',
        groqApiKey: 'gsk_test_1234567890abcdef',
        groqModel: 'openai/gpt-oss-120b',
        apiKey: 'TEST_KEY_ALPHA_111111111111111111111111'
      }
    };
    const agent = new AIAgent(mockProfile, groqSettings);
    assert.equal(agent.provider, 'auto');
    assert.equal(agent.groqApiKey, 'gsk_test_1234567890abcdef');
    assert.equal(agent.groqModel, 'openai/gpt-oss-120b');
    assert.equal(agent.isGroqAvailable(), true);
    assert.equal(agent.isAiAvailable(), true);

    const telemetry = agent.getLiveTelemetry();
    assert.equal(telemetry.provider, 'Groq Cloud');
    assert.equal(telemetry.groqConfigured, true);
    assert.equal(telemetry.activeGroqKeySnippet, 'gsk_test...cdef');
  });

  await t.test('Groq Integration: Handles Groq throttle cooldown correctly', () => {
    const groqSettings = {
      ai: {
        provider: 'groq',
        groqApiKey: 'gsk_test_1234567890abcdef',
        groqModel: 'openai/gpt-oss-120b'
      }
    };
    const agent = new AIAgent(mockProfile, groqSettings);
    assert.equal(agent.isGroqAvailable(), true);

    // Simulate 429
    agent.markGroqThrottled(new Error('Groq 429 Rate Limit retry-after: 30s'));
    assert.equal(agent.isGroqAvailable(), false);
    assert.ok(agent.groqCooldownUntil > Date.now());

    // Reset clears Groq cooldown
    agent.resetCooldown();
    assert.equal(agent.isGroqAvailable(), true);
  });

  await t.test('Auto Failover: Falls over from Groq to Gemini pool when Groq fails', async () => {
    const hybridSettings = {
      ai: {
        provider: 'auto',
        groqApiKey: 'gsk_test_invalid_failover',
        groqModel: 'openai/gpt-oss-120b',
        apiKey: 'TEST_KEY_ALPHA_111111111111111111111111',
        apiKeys: ['TEST_KEY_BETA_2222222222222222222222222']
      }
    };
    const agent = new AIAgent(mockProfile, hybridSettings);
    // Mock Groq to fail with 429
    agent._sendGroqMessage = async () => {
      const err = new Error('Groq 429 Rate Limit');
      agent.markGroqThrottled(err);
      throw err;
    };
    // Mock Gemini to succeed
    agent._sendGeminiMessage = async () => ({
      response: {
        text: () => '{"answer": "3", "confidence": 0.95, "reasoning": "Candidate has 3 years"}'
      }
    });

    const callResult = await agent._executeAICall('Test question');
    assert.equal(callResult.provider, 'Google Gemini');
    assert.ok(callResult.responseText.includes('"answer": "3"'));
    assert.equal(agent.isGroqAvailable(), false);
  });

  await t.test('Instant local fallback: never stalls or pauses application process when keys are cooling down', async () => {
    const agent = new AIAgent(mockProfile, mockSettings);
    agent.apiKeys.forEach(k => agent.markKeyThrottled(k, new Error('429 Quota Exceeded retryDelay 300s')));

    const startTime = Date.now();
    const result = await agent.answerScreeningQuestionAI(
      'What is your notice period in days?',
      [],
      'number'
    );
    const duration = Date.now() - startTime;

    // Must return immediately with 0 sleep or freeze
    assert.ok(duration < 1500, `Expected instant return, took ${duration}ms`);
    assert.equal(result.answer, '30');
    assert.ok(result.confidence >= 0.85);
  });
});

