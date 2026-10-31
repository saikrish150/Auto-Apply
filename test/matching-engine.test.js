const test = require('node:test');
const assert = require('node:assert/strict');
const MatchingEngine = require('../engine/matching-engine');
const ProfileManager = require('../engine/profile-manager');

test('MatchingEngine - Multi-Dimensional Job Matching & Experience Compatibility', async (t) => {
  const profile = ProfileManager.normalizeProfile({
    career: {
      totalYearsExperience: 2.7,
      currentCompany: 'Tech Mahindra',
      willingToRelocate: true,
      workModePreferences: ['Office', 'Hybrid', 'Remote'],
      targetRoles: ['Angular Developer', 'Java Developer', 'Java Full Stack Developer']
    },
    personal: {
      location: 'Hyderabad, India'
    },
    skills: [
      { name: 'Angular', years: 2.7 },
      { name: 'Java', years: 2.7 },
      { name: 'Spring Boot', years: 2.5 },
      { name: 'TypeScript', years: 2.7 },
      { name: 'HTML/CSS', years: 2.7 },
      { name: 'REST APIs', years: 2.7 },
      { name: 'SQL', years: 2.0 }
    ]
  });

  await t.test('Scores high for well-aligned Full Stack Angular & Java role (2-4 yrs exp)', () => {
    const job = {
      title: 'Angular & Java Full Stack Developer',
      description: 'Looking for a Software Engineer with 2 to 4 years of hands-on experience in Angular, Java, and Spring Boot to develop scalable enterprise microservices.',
      company: 'Innovatech Solutions',
      location: 'Hyderabad',
      profile
    };

    const result = MatchingEngine.evaluate(job);

    assert.ok(result.overallScore >= 75, `Expected overallScore >= 75, got ${result.overallScore}`);
    assert.ok(result.technicalScore >= 75, `Expected technicalScore >= 75, got ${result.technicalScore}`);
    assert.equal(result.experienceCompatibility, MatchingEngine.EXPERIENCE_CATEGORIES.MEETS_REQUIRED);
    assert.ok(result.matchedSkills.includes('Angular'));
    assert.ok(result.matchedSkills.includes('Java'));
    assert.equal(result.isMatch, true);
    assert.ok(result.reasoning.length > 0);
  });

  await t.test('Prevents score inflation: rejects/penalizes senior role (8-12 years) for 2.7 yr candidate', () => {
    const seniorJob = {
      title: 'Principal Software Architect / Senior Lead Engineer',
      description: 'Requires minimum 8 to 12 years of extensive experience leading large distributed systems, team mentoring, and cloud architecture.',
      company: 'MegaCorp',
      location: 'Bangalore',
      profile
    };

    const result = MatchingEngine.evaluate(seniorJob);

    // CRITICAL: The old engine inflated this to 98%. New engine MUST cap it <= 60%!
    assert.ok(result.overallScore <= 60, `Overall score must be <= 60 for 8-12 yr role, got ${result.overallScore}`);
    assert.equal(result.experienceCompatibility, MatchingEngine.EXPERIENCE_CATEGORIES.BELOW_MANDATORY);
    assert.ok(typeof result.reasoning === 'string' ? result.reasoning.includes('substantially exceeds') : result.reasoning.some(r => r.includes('mandatory')));
  });

  await t.test('Handles missing required skills with explicit penalties', () => {
    const rustJob = {
      title: 'Rust & Solana Blockchain Systems Engineer',
      description: 'Must have 3 years experience building smart contracts in Rust, Anchor framework, and Solana core runtime.',
      company: 'CryptoLabs',
      location: 'Remote',
      profile
    };

    const result = MatchingEngine.evaluate(rustJob);
    assert.ok(result.overallScore < 50, `Expected low score for mismatched stack, got ${result.overallScore}`);
    assert.equal(result.isMatch, false);
  });

  await t.test('Handles unspecified experience gracefully', () => {
    const generalJob = {
      title: 'Full Stack Java / Angular Engineer',
      description: 'Join our agile team to build modern web applications using Angular frontend and Java Spring backend.',
      company: 'FastTrack Tech',
      location: 'Hyderabad',
      profile
    };

    const result = MatchingEngine.evaluate(generalJob);
    assert.equal(result.experienceCompatibility, MatchingEngine.EXPERIENCE_CATEGORIES.NOT_SPECIFIED);
    assert.ok(result.overallScore >= 60);
  });

  await t.test('Provides transparent scoring breakdown and version tag', () => {
    const job = {
      title: 'Java Developer',
      description: 'Java, Spring Boot, REST APIs developer with 2+ years experience.',
      profile
    };

    const result = MatchingEngine.evaluate(job);
    assert.equal(result.scoringVersion, MatchingEngine.SCORING_VERSION);
    assert.ok(result.breakdown);
    assert.ok('technical' in result.breakdown);
    assert.ok('experience' in result.breakdown);
    assert.ok('role' in result.breakdown);
  });

  await t.test('Correctly ignores company legacy/establishment years and extracts candidate required experience', () => {
    const jobWithCompanyAge = {
      title: 'Full Stack Java & Angular Engineer',
      description: 'Globex Software has 20 years of excellence in banking solutions. We are hiring a Full Stack Developer with minimum 2 to 4 years of experience in Java and Angular.',
      company: 'Globex',
      location: 'Hyderabad',
      profile
    };

    const result = MatchingEngine.evaluate(jobWithCompanyAge);
    // Should NOT be penalized as requiring 20 years
    assert.equal(result.experienceCompatibility, MatchingEngine.EXPERIENCE_CATEGORIES.MEETS_REQUIRED);
    assert.ok(result.overallScore >= 75, `Expected score >= 75, got ${result.overallScore}`);
  });

  await t.test('Correctly scores and recommends Software Engineer - Backend without false skips', () => {
    const backendJob = {
      title: 'Software Engineer - Backend',
      description: 'Looking for a backend engineer to build scalable APIs, microservices, database systems, distributed architectures.',
      company: 'CloudStream Systems',
      location: 'Hyderabad',
      profile
    };

    const result = MatchingEngine.evaluate(backendJob);
    assert.ok(result.overallScore >= 75, `Expected overallScore >= 75, got ${result.overallScore}`);
    assert.equal(result.isRecommended, true);
    assert.equal(result.isMatch, true);
  });

  await t.test('Applies to Java Developer within 3 years, but skips jobs requiring 4+ or 5+ years', () => {
    const javaWithin3Yrs = {
      title: 'Java Developer',
      description: 'Looking for 2 to 3 years experience in Java Spring Boot, microservices, REST APIs.',
      company: 'Innovatech',
      location: 'Hyderabad',
      profile
    };

    const java5PlusYrs = {
      title: 'Java Developer',
      description: 'Looking for 5+ years experience in Java Spring Boot, microservices, AWS.',
      company: 'FinTech Dynamics',
      location: 'Bengaluru',
      profile
    };

    const seniorJava5to7Yrs = {
      title: 'Senior Java Developer',
      description: 'Java, Spring, Microservices, 5-7 years experience required.',
      company: 'Enterprise Solutions',
      location: 'Hyderabad',
      profile
    };

    // Within 3 years -> Apply
    const resWithin = MatchingEngine.evaluate(javaWithin3Yrs);
    assert.ok(resWithin.overallScore >= 75, `Expected resWithin >= 75, got ${resWithin.overallScore}`);
    assert.equal(resWithin.isRecommended, true);

    // 5+ years -> Skip
    const res5Plus = MatchingEngine.evaluate(java5PlusYrs);
    assert.ok(res5Plus.overallScore <= 50, `Expected res5Plus <= 50, got ${res5Plus.overallScore}`);
    assert.equal(res5Plus.isRecommended, false);

    // 5-7 years -> Skip
    const resSenior = MatchingEngine.evaluate(seniorJava5to7Yrs);
    assert.ok(resSenior.overallScore <= 50, `Expected resSenior <= 50, got ${resSenior.overallScore}`);
    assert.equal(resSenior.isRecommended, false);
  });

  await t.test('Firmly rejects completely non-technical roles', () => {
    const accountantJob = {
      title: 'Senior Accountant',
      description: 'Chartered accountant with 5 years experience in GAAP, tax filing, and audits.',
      company: 'AuditCorp',
      location: 'Hyderabad',
      profile
    };

    const mechanicalJob = {
      title: 'Mechanical Design Engineer',
      description: 'Requires 4 years experience with AutoCAD, SolidWorks, and HVAC thermal design.',
      company: 'MechWorks',
      location: 'Hyderabad',
      profile
    };

    const res1 = MatchingEngine.evaluate(accountantJob);
    assert.ok(res1.overallScore <= 40, `Expected accountant score <= 40, got ${res1.overallScore}`);
    assert.equal(res1.isRecommended, false);

    const res2 = MatchingEngine.evaluate(mechanicalJob);
    assert.ok(res2.overallScore <= 40, `Expected mechanical score <= 40, got ${res2.overallScore}`);
    assert.equal(res2.isRecommended, false);
  });
});

