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

    const inrCurrent = ScreeningClassifier.classifyAndAnswer('Please enter your current ctc in INR* Please enter your current annual compensation in INR. Example: 200000', profile);
    assert.equal(inrCurrent.intent, ScreeningClassifier.INTENTS.CURRENT_CTC);
    assert.equal(inrCurrent.answer, '380000');

    const expectedResult = ScreeningClassifier.classifyAndAnswer('What is your expected CTC in LPA?', profile);
    assert.equal(expectedResult.intent, ScreeningClassifier.INTENTS.EXPECTED_CTC);
    assert.ok(expectedResult.answer.includes('10'));

    const inrExpected = ScreeningClassifier.classifyAndAnswer('Please enter your expected ctc in INR* Please enter your expected annual compensation in INR. Example: 350000', profile);
    assert.equal(inrExpected.intent, ScreeningClassifier.INTENTS.EXPECTED_CTC);
    assert.equal(inrExpected.answer, '1000000');

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

  await t.test('Candidate Knowledge Base v2: answers new logistics, notice, and work preferences accurately', () => {
    const v2Profile = {
      ...profile,
      career: {
        ...profile.career,
        currentlyServingNotice: true,
        lastWorkingDay: '30/11/2026',
        monthlyInHandExpectation: 83000,
        careerGap: 'No',
        reasonForChange: 'Seeking career growth and bigger responsibilities, with greater ownership of design and delivery.',
        fiveDaysInOffice: true,
        saturdayWorking: false,
        contractOrC2H: false,
        thirdPartyPayroll: true
      }
    };

    // Career gap
    const gapRes = ScreeningClassifier.classifyAndAnswer('Do you have any career gap or employment break?', v2Profile);
    assert.equal(gapRes.intent, ScreeningClassifier.INTENTS.CAREER_GAP);
    assert.ok(gapRes.answer.includes('No'));

    // Reason for job change
    const changeRes = ScreeningClassifier.classifyAndAnswer('What is your reason for job change?', v2Profile);
    assert.equal(changeRes.intent, ScreeningClassifier.INTENTS.REASON_FOR_JOB_CHANGE);
    assert.ok(changeRes.answer.includes('career growth'));

    // Currently serving notice
    const servingRes = ScreeningClassifier.classifyAndAnswer('Are you currently serving notice period?', v2Profile);
    assert.equal(servingRes.intent, ScreeningClassifier.INTENTS.CURRENTLY_SERVING_NOTICE);
    assert.equal(servingRes.answer, 'Yes');

    // Last working day
    const lwdRes = ScreeningClassifier.classifyAndAnswer('What is your last working day (LWD)?', v2Profile);
    assert.equal(lwdRes.intent, ScreeningClassifier.INTENTS.LAST_WORKING_DAY);
    assert.equal(lwdRes.answer, '30/11/2026');

    // Monthly gross compensation
    const monthlyRes = ScreeningClassifier.classifyAndAnswer('What are your financial expectations (monthly gross)?', v2Profile, [], 'number');
    assert.equal(monthlyRes.intent, ScreeningClassifier.INTENTS.MONTHLY_GROSS);
    assert.equal(monthlyRes.answer, '83000');

    // 5 days WFO
    const wfoRes = ScreeningClassifier.classifyAndAnswer('Are you comfortable with 5 days work from office (WFO)?', v2Profile);
    assert.equal(wfoRes.intent, ScreeningClassifier.INTENTS.FIVE_DAYS_OFFICE);
    assert.equal(wfoRes.answer, 'Yes');

    // Saturday working
    const satRes = ScreeningClassifier.classifyAndAnswer('Are you open to Saturday working?', v2Profile);
    assert.equal(satRes.intent, ScreeningClassifier.INTENTS.SATURDAY_WORKING);
    assert.equal(satRes.answer, 'No');

    // Contract / C2H
    const c2hRes = ScreeningClassifier.classifyAndAnswer('Are you open for contract-to-hire (C2H) roles?', v2Profile);
    assert.equal(c2hRes.intent, ScreeningClassifier.INTENTS.CONTRACT_ROLES);
    assert.equal(c2hRes.answer, 'No');

    // Third-party payroll
    const tppRes = ScreeningClassifier.classifyAndAnswer('Are you open to third-party payroll?', v2Profile);
    assert.equal(tppRes.intent, ScreeningClassifier.INTENTS.THIRD_PARTY_PAYROLL);
    assert.equal(tppRes.answer, 'Yes');

    // Employment Bond / Service Agreement (e.g. TVM Infotech job)
    const bondRes = ScreeningClassifier.classifyAndAnswer('Would you be open to committing to a one-year employment bond with the company?', v2Profile, ['Yes', 'No'], 'radio');
    assert.equal(bondRes.intent, ScreeningClassifier.INTENTS.SERVICE_BOND);
    assert.equal(bondRes.answer, 'Yes');

    // Government IDs -> privacy/security policy triggers human review
    const aadhaarRes = ScreeningClassifier.classifyAndAnswer('Please provide your Aadhaar or PAN card number', v2Profile);
    assert.equal(aadhaarRes.intent, ScreeningClassifier.INTENTS.GOVERNMENT_ID);
    assert.equal(aadhaarRes.requiresReview, true);
    assert.equal(aadhaarRes.answer, '');

    // Zero-experience skill questions: strictly '0' or 'No'
    const kubernetesRes = ScreeningClassifier.classifyAndAnswer('How many years of experience do you have with Kubernetes?', v2Profile);
    assert.equal(kubernetesRes.intent, ScreeningClassifier.INTENTS.SKILL_EXPERIENCE);
    assert.equal(kubernetesRes.answer, '0');

    const kafkaRes = ScreeningClassifier.classifyAndAnswer('How many years of experience in Apache Kafka?', v2Profile);
    assert.equal(kafkaRes.intent, ScreeningClassifier.INTENTS.SKILL_EXPERIENCE);
    assert.equal(kafkaRes.answer, '0');
  });

  await t.test('Precisely application: accurately resolves base salary in local currency & dropdown ranges', () => {
    // 1. Base salary range in local currency (must NOT be treated as a missing skill 'localcurrency')
    const salaryQ = 'Based on your experience and the responsibilities of this role, what base salary range in local currency are you looking for? (please do not enter zero)';
    const salaryRes = ScreeningClassifier.classifyAndAnswer(salaryQ, profile, [], 'number');
    assert.equal(salaryRes.intent, ScreeningClassifier.INTENTS.EXPECTED_CTC);
    assert.equal(salaryRes.answer, '1000000');
    assert.notEqual(salaryRes.answer, '0');

    // 2. Dropdown range matching: 'Up to 4 years' for candidate with 2.5/2.7 years experience
    const springBootQ = 'How many years of hands-on experience do you have developing Java-based microservices applications using Spring Boot?';
    const springBootOptions = ['Up to 4 years', '4 - 7 years', '7 - 8 years', '8 - 9 years', '9 - 10 years', '10+ years'];
    const springBootRes = ScreeningClassifier.classifyAndAnswer(springBootQ, profile, springBootOptions, 'select');
    assert.equal(springBootRes.intent, ScreeningClassifier.INTENTS.SKILL_EXPERIENCE);
    assert.equal(springBootRes.answer, 'Up to 4 years');

    // 3. Dropdown option matching: 'LinkedIn Job' for hear about us
    const matchedHear = ScreeningClassifier.matchOption('LinkedIn', ['Black Perspective', 'Company Website', 'LinkedIn Job', 'Other'], 'select');
    assert.equal(matchedHear, 'LinkedIn Job');
  });

  await t.test('Naukri Solvecorp application: accurately answers skill, framework, and role questions', () => {
    const naukriProfile = ProfileManager.normalizeProfile({
      career: {
        totalYearsExperience: 3,
        willingToRelocate: true,
        currentlyServingNotice: true,
        zeroExperienceSkills: ['C#', '.NET', 'Python', 'React']
      },
      skills: [
        { name: 'Spring MVC', years: 3 },
        { name: 'SQL, PostgreSQL, MySQL', years: 3 },
        { name: 'Java', years: 3 },
        { name: 'Angular', years: 3 }
      ]
    });

    // 1. MVC Framework (strips 'Framework' suffix -> matches 'Spring MVC')
    const mvcQ = 'How many years of experience do you have in MVC Framework?';
    const mvcRes = ScreeningClassifier.classifyAndAnswer(mvcQ, naukriProfile, [], 'number');
    assert.equal(mvcRes.intent, ScreeningClassifier.INTENTS.SKILL_EXPERIENCE);
    assert.equal(mvcRes.answer, '3');

    // 2. SQL Database (strips 'Database' suffix -> matches 'SQL, PostgreSQL, MySQL')
    const sqlQ = 'How many years of experience do you have in SQL Database?';
    const sqlRes = ScreeningClassifier.classifyAndAnswer(sqlQ, naukriProfile, [], 'number');
    assert.equal(sqlRes.intent, ScreeningClassifier.INTENTS.SKILL_EXPERIENCE);
    assert.equal(sqlRes.answer, '3');

    // 3. Backend Development (generic role experience -> returns totalYearsExperience)
    const backendQ = 'How many years of experience do you have in Backend Development?';
    const backendRes = ScreeningClassifier.classifyAndAnswer(backendQ, naukriProfile, [], 'number');
    assert.equal(backendRes.intent, ScreeningClassifier.INTENTS.SKILL_EXPERIENCE);
    assert.equal(backendRes.answer, '3');

    // 4. Zero experience skills (C#, .NET)
    const csharpQ = 'How many years of experience do you have in C#?';
    const csharpRes = ScreeningClassifier.classifyAndAnswer(csharpQ, naukriProfile, [], 'number');
    assert.equal(csharpRes.intent, ScreeningClassifier.INTENTS.SKILL_EXPERIENCE);
    assert.equal(csharpRes.answer, '0');

    // 5. Notice period serving (Radio: Yes / No)
    const servingNoticeQ = 'Are you currently serving notice period?';
    const servingRes = ScreeningClassifier.classifyAndAnswer(servingNoticeQ, naukriProfile, ['Yes', 'No'], 'radio');
    assert.equal(servingRes.intent, ScreeningClassifier.INTENTS.CURRENTLY_SERVING_NOTICE);
    assert.equal(servingRes.answer, 'Yes');

    // 6. Relocation to Chennai (Radio: Yes / No)
    const relocateQ = 'Are you willing to relocate to Chennai?';
    const relocateRes = ScreeningClassifier.classifyAndAnswer(relocateQ, naukriProfile, ['Yes', 'No'], 'radio');
    assert.equal(relocateRes.intent, ScreeningClassifier.INTENTS.WILLING_TO_RELOCATE);
    assert.equal(relocateRes.answer, 'Yes');
  });
});
