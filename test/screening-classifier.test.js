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

  await t.test('Answers Personal Identity & Background questions accurately', () => {
    const dobResult = ScreeningClassifier.classifyAndAnswer('What is your Date of Birth (DOB)?', profile);
    assert.equal(dobResult.intent, ScreeningClassifier.INTENTS.DATE_OF_BIRTH);
    assert.equal(dobResult.answer, '28/01/2002');

    const genderResult = ScreeningClassifier.classifyAndAnswer('Please select your gender', profile);
    assert.equal(genderResult.intent, ScreeningClassifier.INTENTS.GENDER);
    assert.equal(genderResult.answer, 'Male');

    const fatherResult = ScreeningClassifier.classifyAndAnswer("What is your father's name?", profile);
    assert.equal(fatherResult.intent, ScreeningClassifier.INTENTS.FATHER_NAME);
    assert.equal(fatherResult.answer, 'Gaddula Ushanna');

    const passportResult = ScreeningClassifier.classifyAndAnswer('Do you hold a valid passport?', profile);
    assert.equal(passportResult.intent, ScreeningClassifier.INTENTS.PASSPORT);
    assert.equal(passportResult.answer, 'Yes');

    const permAddrResult = ScreeningClassifier.classifyAndAnswer('What is your permanent address / native place?', profile);
    assert.equal(permAddrResult.intent, ScreeningClassifier.INTENTS.PERMANENT_ADDRESS);
    assert.ok(permAddrResult.answer.includes('kothakota') || permAddrResult.answer.includes('6-31'));
  });

  await t.test('Answers Academic details: 10th, 12th marks and backlogs accurately', () => {
    const tenthMarks = ScreeningClassifier.classifyAndAnswer('What was your 10th percentage / marks?', profile);
    assert.equal(tenthMarks.intent, ScreeningClassifier.INTENTS.ACADEMIC_10TH);
    assert.ok(tenthMarks.answer.includes('77'));

    const tenthNumeric = ScreeningClassifier.classifyAndAnswer('10th percentage (number only)', profile, [], 'number');
    assert.equal(tenthNumeric.answer, '77');

    const interMarks = ScreeningClassifier.classifyAndAnswer('What was your 12th / intermediate percentage?', profile);
    assert.equal(interMarks.intent, ScreeningClassifier.INTENTS.ACADEMIC_12TH);
    assert.ok(interMarks.answer.includes('94'));

    const backlogs = ScreeningClassifier.classifyAndAnswer('Do you have any active or history of backlogs?', profile);
    assert.equal(backlogs.intent, ScreeningClassifier.INTENTS.ACADEMIC_BACKLOGS);
    assert.equal(backlogs.answer, 'No');
  });

  await t.test('Strictly declares No for court cases, disciplinary actions, military, government, and politics', () => {
    const courtResult = ScreeningClassifier.classifyAndAnswer('Have you ever gone to court or faced lawsuits from previous employers?', profile);
    assert.equal(courtResult.intent, ScreeningClassifier.INTENTS.CONSEQUENTIAL_LEGAL);
    assert.equal(courtResult.answer, 'No');

    const discResult = ScreeningClassifier.classifyAndAnswer('Have you ever faced disciplinary action or termination for cause?', profile);
    assert.equal(discResult.intent, ScreeningClassifier.INTENTS.CONSEQUENTIAL_LEGAL);
    assert.equal(discResult.answer, 'No');

    const militaryResult = ScreeningClassifier.classifyAndAnswer('Are you currently or have you ever served in the military / armed forces?', profile);
    assert.equal(militaryResult.intent, ScreeningClassifier.INTENTS.CONSEQUENTIAL_LEGAL);
    assert.equal(militaryResult.answer, 'No');

    const govResult = ScreeningClassifier.classifyAndAnswer('Are you currently or have you ever been a government employee / civil servant?', profile);
    assert.equal(govResult.intent, ScreeningClassifier.INTENTS.CONSEQUENTIAL_LEGAL);
    assert.equal(govResult.answer, 'No');

    const politicalResult = ScreeningClassifier.classifyAndAnswer('Are you a politically exposed person (PEP) or connected to any political party?', profile);
    assert.equal(politicalResult.intent, ScreeningClassifier.INTENTS.CONSEQUENTIAL_LEGAL);
    assert.equal(politicalResult.answer, 'No');
  });

  await t.test('AIAgent correctly reads CANDIDATE_KNOWLEDGE_BASE.md', () => {
    const AIAgent = require('../engine/ai-agent');
    const agent = new AIAgent(profile, {});
    const kb = agent.loadCandidateKnowledgeBase();
    assert.ok(kb.length > 500);
    assert.ok(kb.includes('Sai Krishna G'));
    assert.ok(kb.includes('28/01/2002'));
    assert.ok(kb.includes('Montessori High School'));
    assert.ok(kb.includes('Narayana Junior College'));
    assert.ok(kb.includes('Tech Mahindra'));
    assert.ok(kb.includes('GE Aerospace'));
    assert.ok(kb.includes('Gaddula Ushanna'));
    assert.ok(kb.toLowerCase().includes('committed any crime'));
  });
});
