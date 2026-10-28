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
});
