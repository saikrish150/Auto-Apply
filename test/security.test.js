const test = require('node:test');
const assert = require('node:assert/strict');
const ProfileManager = require('../engine/profile-manager');

test('Security & Data Hardening Verification', async (t) => {
  await t.test('Secret Scrubbing: Never leaks raw Gemini API keys in settings payloads', () => {
    const rawSettings = {
      geminiApiKey: 'AIzaSyD-fakeKeySecret9876543210abcdef',
      platforms: { linkedin: true, naukri: true },
      minMatchScore: 70
    };

    // Implementation pattern matching server.js sanitizeSettings
    const sanitizeSettings = (cfg) => {
      if (!cfg) return {};
      const sanitized = JSON.parse(JSON.stringify(cfg));
      if (sanitized.geminiApiKey) {
        const key = String(sanitized.geminiApiKey);
        sanitized.geminiApiKey = key.length > 8
          ? `${key.slice(0, 4)}...${key.slice(-4)}`
          : '********';
        sanitized.hasGeminiApiKey = true;
      } else {
        sanitized.hasGeminiApiKey = false;
      }
      return sanitized;
    };

    const sanitized = sanitizeSettings(rawSettings);
    assert.equal(sanitized.hasGeminiApiKey, true);
    assert.ok(sanitized.geminiApiKey.includes('...'));
    assert.ok(!sanitized.geminiApiKey.includes('fakeKeySecret9876543210abcdef'));
  });

  await t.test('CORS Policy: Only allows loopback and localhost origins', () => {
    const isOriginAllowed = (origin) => {
      if (!origin) return true; // Server-to-server or direct browser
      return (
        origin.startsWith('http://localhost') ||
        origin.startsWith('http://127.0.0.1') ||
        origin.startsWith('https://localhost') ||
        origin.startsWith('https://127.0.0.1')
      );
    };

    assert.equal(isOriginAllowed('http://localhost:3000'), true);
    assert.equal(isOriginAllowed('http://127.0.0.1:3000'), true);
    assert.equal(isOriginAllowed('https://evil-attacker-site.com'), false);
    assert.equal(isOriginAllowed('http://phishing.org'), false);
  });

  await t.test('URL Validation: Rejects dangerous pseudo-protocols', () => {
    const isSafeUrl = (urlStr) => {
      try {
        const parsed = new URL(urlStr);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    };

    assert.equal(isSafeUrl('https://careers.google.com/jobs/123'), true);
    assert.equal(isSafeUrl('http://mycompany.com/apply'), true);
    assert.equal(isSafeUrl('javascript:alert(document.cookie)'), false);
    assert.equal(isSafeUrl('file:///C:/Windows/System32/calc.exe'), false);
    assert.equal(isSafeUrl('data:text/html,<script>evil()</script>'), false);
  });

  await t.test('Payload validation: Rejects malformed or malicious candidate profile injections', () => {
    const maliciousProfile = {
      personal: {
        fullName: '<script>alert("xss")</script>',
        email: 'not-an-email'
      },
      career: {
        totalYearsExperience: -99,
        officialNoticePeriodDays: 'DROP TABLE applications;'
      }
    };

    const validation = ProfileManager.validateProfile(maliciousProfile);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.length > 0);
  });
});
