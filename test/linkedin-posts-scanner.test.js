const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const LinkedInPostsScanner = require('../engine/linkedin-posts-scanner');
const RecruiterEmailsService = require('../engine/recruiter-emails-service');

describe('LinkedInPostsScanner - LinkedIn Hiring Posts Scanner & Recruiter Email Extractor', () => {
  const tempDir = path.join(__dirname, 'temp_test_posts');
  let emailService;
  let scanner;

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    emailService = new RecruiterEmailsService({ dataDir: tempDir });
    scanner = new LinkedInPostsScanner(
      null, // ChromeManager mock
      null, // AIAgent mock
      {
        disableDelays: true,
        search: {
          keywords: 'Angular Developer, Java Full Stack Developer',
          datePosted: 'past_24h'
        },
        automation: {
          simulationMode: true,
          disableDelaysForTesting: true
        }
      },
      () => {}, // Silent logger
      null,
      emailService
    );
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('Target Queries: Generates proper Angular & Java queries', () => {
    const queries = scanner.getTargetQueries();
    assert.ok(Array.isArray(queries));
    assert.ok(queries.length >= 2);
    const hasAngular = queries.some(q => q.includes('angular'));
    const hasJava = queries.some(q => q.includes('java'));
    assert.ok(hasAngular, 'Should include angular search query');
    assert.ok(hasJava, 'Should include java search query');
  });

  test('Search URL: Correctly formats LinkedIn Content search URL with date_posted sort', () => {
    const url = scanner.buildSearchUrl('hiring angular email');
    assert.ok(url.startsWith('https://www.linkedin.com/search/results/content/?keywords='));
    assert.ok(url.includes('sortBy=%22date_posted%22'), 'Should sort by date_posted');
    assert.ok(url.includes('datePosted=%22past-24h%22'), 'Should filter by past_24h');
  });

  test('Role Inference: Accurately identifies target role from post text & headline', () => {
    assert.equal(
      scanner.inferJobTitle('Looking for an Angular Developer with TypeScript', 'HR at TechCorp'),
      'Angular Developer'
    );
    assert.equal(
      scanner.inferJobTitle('Hiring Java Spring Boot Microservices engineer', 'Recruiter @ Fintech'),
      'Java Spring Boot Developer'
    );
    assert.equal(
      scanner.inferJobTitle('Full stack opportunity: Angular 17 frontend and Java Spring backend', 'Talent Team'),
      'Full Stack Java & Angular Developer'
    );
  });

  test('Company Inference: Parses company cleanly from recruiter headline or post', () => {
    const comp1 = scanner.inferCompany('Talent Partner at PhonePe | Hiring Engineers', '');
    assert.equal(comp1, 'PhonePe');

    const comp2 = scanner.inferCompany('Technical Recruiter @ Razorpay', '');
    assert.equal(comp2, 'Razorpay');

    const comp3 = scanner.inferCompany('', 'Join our team at Swiggy as an SDE-1! Drop your resume.');
    assert.equal(comp3, 'Swiggy');
  });

  test('Skill & Hiring Match: Validates technical competency & hiring intent', () => {
    // Valid hiring posts
    assert.ok(scanner.isSkillMatch('We are hiring Angular developers. Send CV to hr@test.io', 'HR'));
    assert.ok(scanner.isSkillMatch('Urgent requirement for Java Spring Boot engineers. Share your resume.', 'Talent'));
    assert.ok(scanner.isSkillMatch('Full Stack opportunity: Java and Angular', 'Recruiter'));

    // Non-hiring or non-matching posts
    assert.ok(!scanner.isSkillMatch('I just completed an Angular course! Feeling great.', 'Student'));
    assert.ok(!scanner.isSkillMatch('We are hiring Sales Executives with 2 years experience. Email hr@sales.com', 'HR'));
    assert.ok(!scanner.isSkillMatch('Python machine learning data scientist opening', 'Recruiter'));
  });

  test('Experience Matching: Accepts 1-3 years and unspecified, strictly filters 4+ and 5+ years', () => {
    // Acceptable ranges for candidate (~3 years)
    const check1 = scanner.isExperienceCompatible('Hiring Angular Developer (1-3 years of experience)', 'Angular Developer');
    assert.equal(check1.compatible, true, '1-3 years should be compatible');

    const check2 = scanner.isExperienceCompatible('Java Developer role. Experience: 2 to 4 years.', 'Java Developer');
    assert.equal(check2.compatible, true, '2-4 years should be compatible');

    const check3 = scanner.isExperienceCompatible('Hiring Angular & Spring Boot developers. Fast joiners welcome.', 'Full Stack Developer');
    assert.equal(check3.compatible, true, 'Unspecified experience should be accepted');

    const check4 = scanner.isExperienceCompatible('Junior Software Engineer, 0-2 years exp', 'Junior Software Engineer');
    assert.equal(check4.compatible, true, '0-2 years should be compatible');

    // Incompatible: Exceeds candidate's ~3 years experience
    const checkSenior1 = scanner.isExperienceCompatible('Looking for Lead Java Engineer. Minimum 5+ years of experience required.', 'Lead Java Developer');
    assert.equal(checkSenior1.compatible, false, '5+ years must be rejected');

    const checkSenior2 = scanner.isExperienceCompatible('Hiring Senior Angular Specialist with 6-10 years of experience.', 'Senior Angular Developer');
    assert.equal(checkSenior2.compatible, false, '6-10 years must be rejected');

    const checkArch = scanner.isExperienceCompatible('Principal Architect role for Java platform', 'Principal Architect');
    assert.equal(checkArch.compatible, false, 'Architect role must be rejected');
  });

  test('Simulation Scan: Fully executes end-to-end post discovery, filtering, and recruiter email extraction', async () => {
    const discovered = await scanner.scanPosts();

    assert.ok(Array.isArray(discovered));
    assert.ok(discovered.length >= 2, `Expected at least 2 discovered emails, got ${discovered.length}`);

    // Verify discovered emails are in Recruiter Outreach service
    const allEmails = emailService.getAll();
    assert.ok(allEmails.length >= 2);

    const sneha = allEmails.find(e => e.email === 'sneha.recruiter@phonepe.com');
    assert.ok(sneha, 'Should find Sneha from PhonePe');
    assert.equal(sneha.company, 'PhonePe');
    assert.equal(sneha.platform, 'LinkedIn');
    assert.ok(sneha.jobTitle.includes('Full Stack') || sneha.jobTitle.includes('Angular'));
    assert.equal(sneha.status, 'new');

    const vikram = allEmails.find(e => e.email === 'vikram.hiring@innovatex.io');
    assert.ok(vikram, 'Should find Vikram from InnovateX');
    assert.equal(vikram.company, 'InnovateX Solutions');

    // Verify 8+ years Architect post (Priya Nambiar) was filtered out
    const priya = allEmails.find(e => e.email === 'priya.exec@enterprise.com');
    assert.equal(priya, undefined, '8+ years post should be filtered out by experience matcher');

    // Verify tailored candidate outreach pitch was generated
    assert.ok(sneha.bodyTemplate, 'Body template should exist');
    assert.ok(sneha.subjectTemplate, 'Subject template should exist');
    assert.ok(sneha.bodyTemplate.includes('Sai Krishna G'));
    assert.ok(sneha.bodyTemplate.includes('Tech Mahindra'));
  });
});
