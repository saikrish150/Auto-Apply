const test = require('node:test');
const assert = require('node:assert/strict');
const ProfileManager = require('../engine/profile-manager');

test('ProfileManager - Canonical Candidate Profile Normalization & Validation', async (t) => {
  await t.test('Normalizes raw profile with verified baseline defaults', () => {
    const raw = {
      personal: {
        fullName: 'Sai Krishna G',
        email: 'gsaikrishna150@gmail.com'
      },
      career: {
        totalYearsExperience: 2.7,
        currentCompany: 'Tech Mahindra',
        currentSalaryLPA: 3.8,
        expectedSalaryLPA: 10.0,
        officialNoticePeriodDays: 90,
        negotiableNoticePeriodDays: 45
      },
      skills: [
        { name: 'Angular', years: 2.7, proficiency: 'Expert' },
        { name: 'Java', years: 2.7, proficiency: 'Advanced' }
      ]
    };

    const canonical = ProfileManager.normalizeProfile(raw);

    assert.equal(canonical.personal.fullName, 'Sai Krishna G');
    assert.equal(canonical.personal.email, 'gsaikrishna150@gmail.com');
    assert.equal(canonical.career.totalYearsExperience, 2.7);
    assert.equal(canonical.career.currentCompany, 'Tech Mahindra');
    assert.equal(canonical.career.currentSalaryLPA, 3.8);
    assert.equal(canonical.career.expectedSalaryLPA, 10.0);
    assert.equal(canonical.career.officialNoticePeriodDays, 90);
    assert.equal(canonical.career.negotiableNoticePeriodDays, 45);
    assert.equal(canonical.career.noticePeriodDays, 90);
    assert.equal(canonical.career.willingToRelocate, true);
    assert.ok(Array.isArray(canonical.career.targetRoles));
    assert.ok(canonical.verifiedSkillsMap['angular']);
    assert.equal(canonical.verifiedSkillsMap['angular'].years, 2.7);
  });

  await t.test('Separates official notice period from negotiable notice period', () => {
    const raw = {
      career: {
        officialNoticePeriodDays: 90,
        negotiableNoticePeriodDays: 45
      }
    };
    const canonical = ProfileManager.normalizeProfile(raw);
    assert.equal(canonical.career.officialNoticePeriodDays, 90);
    assert.equal(canonical.career.negotiableNoticePeriodDays, 45);
    assert.notEqual(canonical.career.officialNoticePeriodDays, canonical.career.negotiableNoticePeriodDays);
  });

  await t.test('Separates current CTC from expected CTC', () => {
    const raw = {
      career: {
        currentSalaryLPA: 3.8,
        expectedSalaryLPA: 10.0
      }
    };
    const canonical = ProfileManager.normalizeProfile(raw);
    assert.equal(canonical.career.currentSalaryLPA, 3.8);
    assert.equal(canonical.career.expectedSalaryLPA, 10.0);
    assert.equal(canonical.career.currentSalaryFormatted, '3.80 LPA');
    assert.equal(canonical.career.expectedSalaryFormatted, '10.00 LPA');
  });

  await t.test('Detects conflicts when notice period deviates from 90 days baseline', () => {
    const raw = {
      career: {
        noticePeriodDays: 30,
        currentSalaryLPA: '4.10 LPA'
      }
    };
    const conflicts = ProfileManager.detectConflicts(raw);
    assert.ok(conflicts.length >= 2);
    assert.ok(conflicts.some(c => c.field === 'noticePeriodDays'));
    assert.ok(conflicts.some(c => c.field === 'currentSalaryLPA'));
  });

  await t.test('Validates API payload correctly', () => {
    const invalidProfile = {
      personal: { fullName: '', email: 'invalid-email' },
      career: { totalYearsExperience: -1, officialNoticePeriodDays: 'abc' }
    };
    const result = ProfileManager.validateProfile(invalidProfile);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 3);

    const validProfile = {
      personal: { fullName: 'Sai Krishna', email: 'sai@example.com' },
      career: { totalYearsExperience: 2.7, officialNoticePeriodDays: 90, currentSalaryLPA: 3.8 }
    };
    const validResult = ProfileManager.validateProfile(validProfile);
    assert.equal(validResult.valid, true);
    assert.equal(validResult.errors.length, 0);
  });
});
