const test = require('node:test');
const assert = require('node:assert/strict');
const ScreeningClassifier = require('../engine/screening-classifier');
const ProfileManager = require('../engine/profile-manager');

test('ScreeningClassifier - Typed Question Classification & Answer Engine', async (t) => {
  const profile = ProfileManager.normalizeProfile({
    personal: {
      fullName: 'Sai Krishna G',
      email: 'gsaikrishna150@gmail.com',
      streetAddress: 'Flat 402, High-Tech Residency, Madhapur, Hyderabad',
      city: 'Hyderabad',
      country: 'India',
      phone: '+91 8688373517'
    },
    career: {
      totalYearsExperience: 2.7,
      currentSalaryLPA: 3.8,
      expectedSalaryLPA: 10.0,
      officialNoticePeriodDays: 90,
      negotiableNoticePeriodDays: 45
    },
    skills: [
      { name: 'Angular', years: 2.7 },
      { name: 'Java', years: 2.7 },
      { name: 'Spring Boot', years: 2.5 }
    ]
  });

  await t.test('Strictly separates Email from Residential Address (No cross-bleeding)', () => {
    // Crucial bug test: "What is your email address?" must NOT return street address!
    const emailResult = ScreeningClassifier.classifyAndAnswer('What is your email address?', profile);
    assert.equal(emailResult.intent, ScreeningClassifier.INTENTS.EMAIL);
    assert.equal(emailResult.answer, 'gsaikrishna150@gmail.com');
    assert.ok(!emailResult.answer.includes('High-Tech Residency'));

    const addressResult = ScreeningClassifier.classifyAndAnswer('What is your current residential address?', profile);
    assert.ok(
      addressResult.intent === ScreeningClassifier.INTENTS.RESIDENTIAL_ADDRESS ||
      addressResult.intent === ScreeningClassifier.INTENTS.STREET_ADDRESS
    );
    assert.ok(addressResult.answer.includes('High-Tech Residency'));
  });

  await t.test('Strictly separates Current CTC from Expected CTC', () => {
    const currentResult = ScreeningClassifier.classifyAndAnswer('What is your current CTC?', profile);
    assert.equal(currentResult.intent, ScreeningClassifier.INTENTS.CURRENT_CTC);
    assert.ok(currentResult.answer.includes('3.8'));

    const expectedResult = ScreeningClassifier.classifyAndAnswer('What is your expected CTC in LPA?', profile);
    assert.equal(expectedResult.intent, ScreeningClassifier.INTENTS.EXPECTED_CTC);
    assert.ok(expectedResult.answer.includes('10'));

    const numericExpected = ScreeningClassifier.classifyAndAnswer('Expected salary (numeric only)', profile, [], 'number');
    assert.equal(numericExpected.answer, '10');
  });

  await t.test('Separates Official Notice Period, Negotiable Notice, and Earliest Joining', () => {
    const noticeResult = ScreeningClassifier.classifyAndAnswer('What is your official notice period in days?', profile);
    assert.equal(noticeResult.intent, ScreeningClassifier.INTENTS.OFFICIAL_NOTICE_PERIOD);
    assert.equal(noticeResult.answer, '90');

    const negotiableResult = ScreeningClassifier.classifyAndAnswer('Can you negotiate your notice period or minimum days to join?', profile);
    assert.equal(negotiableResult.intent, ScreeningClassifier.INTENTS.NEGOTIABLE_NOTICE_PERIOD);
    assert.equal(negotiableResult.answer, '45');

    const earliestResult = ScreeningClassifier.classifyAndAnswer('What is your earliest possible joining date?', profile);
    assert.equal(earliestResult.intent, ScreeningClassifier.INTENTS.EARLIEST_JOINING_DATE);
    assert.ok(earliestResult.answer.length > 0);
  });

  await t.test('Handles Total Experience vs Skill-Specific Experience', () => {
    const totalExpResult = ScreeningClassifier.classifyAndAnswer('How many total years of experience do you have?', profile);
    assert.equal(totalExpResult.intent, ScreeningClassifier.INTENTS.TOTAL_EXPERIENCE);
    assert.equal(totalExpResult.answer, '2.7');

    const angularExpResult = ScreeningClassifier.classifyAndAnswer('How many years of experience do you have with Angular?', profile);
    assert.equal(angularExpResult.intent, ScreeningClassifier.INTENTS.SKILL_EXPERIENCE);
    assert.equal(angularExpResult.answer, '2.7');

    // Unlisted skill policy: MUST yield '0', never hallucinate candidate experience!
    const rubyExpResult = ScreeningClassifier.classifyAndAnswer('How many years of experience do you have with Ruby on Rails?', profile);
    assert.equal(rubyExpResult.intent, ScreeningClassifier.INTENTS.SKILL_EXPERIENCE);
    assert.equal(rubyExpResult.answer, '0');
  });

  await t.test('Flags consequential legal / security questions for human review', () => {
    const legalResult = ScreeningClassifier.classifyAndAnswer('Do you have any past criminal convictions or pending legal actions?', profile);
    assert.equal(legalResult.intent, ScreeningClassifier.INTENTS.CONSEQUENTIAL_LEGAL);
    assert.equal(legalResult.requiresReview, true);
  });

  await t.test('Matches select/dropdown options accurately without blind first-item picking', () => {
    const options = ['Immediate', '15 Days', '30 Days', '45 Days', '60 Days', '90 Days'];
    const matched = ScreeningClassifier.matchOption('90', options);
    assert.equal(matched, '90 Days');

    const yesNoOptions = ['Yes, definitely', 'No, not willing'];
    const matchedYes = ScreeningClassifier.matchOption('yes', yesNoOptions);
    assert.equal(matchedYes, 'Yes, definitely');

    const matchedNo = ScreeningClassifier.matchOption('no', yesNoOptions);
    assert.equal(matchedNo, 'No, not willing');
  });
});
