const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const RecruiterEmailsService = require('../engine/recruiter-emails-service');

describe('RecruiterEmailsService - Recruiter Outreach & Follow-Up Engine', () => {
  const testDataDir = path.join(__dirname, 'test_emails_data');
  let service;

  beforeEach(() => {
    if (fs.existsSync(testDataDir)) {
      try { fs.rmSync(testDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 }); } catch (e) {}
    }
    fs.mkdirSync(testDataDir, { recursive: true });
    service = new RecruiterEmailsService({ dataDir: testDataDir });
  });

  afterEach(() => {
    if (fs.existsSync(testDataDir)) {
      try { fs.rmSync(testDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 }); } catch (e) {}
    }
  });

  test('Correctly extracts valid recruiter emails from unstructured job descriptions', () => {
    const rawText = `
      We are hiring for Angular Developer role at Acme Tech!
      Key requirements: Angular 17, TypeScript, REST APIs.
      Interested candidates please send your resume directly to hr.talent@acmetech.in or reach out to priya.recruiter@acmetech.in.
      Do not call our office.
    `;

    const extracted = service.extractEmailsFromText(rawText, {
      title: 'Angular Developer',
      company: 'Acme Tech',
      platform: 'LinkedIn',
      url: 'https://linkedin.com/jobs/view/12345'
    });

    assert.strictEqual(extracted.length, 2);
    const emails = extracted.map(e => e.email);
    assert.ok(emails.includes('hr.talent@acmetech.in'));
    assert.ok(emails.includes('priya.recruiter@acmetech.in'));
    assert.strictEqual(extracted[0].company, 'Acme Tech');
    assert.strictEqual(extracted[0].jobTitle, 'Angular Developer');
    assert.strictEqual(extracted[0].status, 'new');
  });

  test('Filters out candidate own email, web asset noise, and documentation domains', () => {
    const noiseText = `
      Please visit https://schema.org or contact user@example.com for info.
      Image asset: icon@2x.png@domain.com
      Developer feedback: gsaikrishna150@gmail.com
      Support desk: noreply@github.com
      Real recruiter: careers@innovatesoft.com
    `;

    const extracted = service.extractEmailsFromText(noiseText, {
      title: 'Full Stack Developer',
      company: 'Innovate Soft',
      platform: 'Naukri'
    });

    assert.strictEqual(extracted.length, 1);
    assert.strictEqual(extracted[0].email, 'careers@innovatesoft.com');
  });

  test('Persists recruiter emails to disk and reloads on startup', () => {
    service.addOrUpdate({
      email: 'recruiting@geaerospace.com',
      company: 'GE Aerospace',
      jobTitle: 'Java Spring Boot Developer',
      recruiterName: 'David Miller',
      platform: 'LinkedIn'
    });

    assert.ok(fs.existsSync(path.join(testDataDir, 'recruiter_emails.json')));

    // Create a new service instance pointing to same file
    const service2 = new RecruiterEmailsService({ dataDir: testDataDir });
    const all = service2.getAll();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].email, 'recruiting@geaerospace.com');
    assert.strictEqual(all[0].recruiterName, 'David Miller');
  });

  test('Deduplicates identical emails for the same company while updating context', () => {
    service.addOrUpdate({
      email: 'hr@techcorp.in',
      company: 'Tech Corp',
      jobTitle: 'Angular Developer',
      context: 'First listing'
    });

    service.addOrUpdate({
      email: 'hr@techcorp.in',
      company: 'Tech Corp',
      jobTitle: 'Full Stack Java Developer',
      context: 'Second listing with more details'
    });

    const all = service.getAll();
    assert.strictEqual(all.length, 1);
    assert.ok(all[0].jobTitles.includes('Angular Developer'));
    assert.ok(all[0].jobTitles.includes('Full Stack Java Developer'));
  });

  test('Generates personalized candidate outreach pitch tailored to Sai Krishna G', () => {
    const record = service.addOrUpdate({
      email: 'hiring@swiggy.in',
      company: 'Swiggy',
      jobTitle: 'Senior Frontend Engineer',
      recruiterName: 'Anjali Verma',
      platform: 'LinkedIn'
    });

    assert.ok(record.subjectTemplate.includes('Senior Frontend Engineer'));
    assert.ok(record.subjectTemplate.includes('Sai Krishna G'));
    assert.ok(record.bodyTemplate.includes('Hi Anjali Verma'));
    assert.ok(record.bodyTemplate.includes('Angular'));
    assert.ok(record.bodyTemplate.includes('Tech Mahindra'));
    assert.ok(record.bodyTemplate.includes('30 Days'));
    assert.ok(record.bodyTemplate.includes('gsaikrishna150@gmail.com'));
  });

  test('Supports status transitions, search filtering, and deletion', () => {
    const item1 = service.addOrUpdate({ email: 'alice@alpha.com', company: 'Alpha Inc', jobTitle: 'Java Dev' });
    const item2 = service.addOrUpdate({ email: 'bob.recruiter@beta.com', company: 'Beta Ltd', jobTitle: 'Angular Dev' });

    // Update status
    service.update(item1.id, { status: 'contacted', notes: 'Sent email on Oct 29' });
    const updated1 = service.getById(item1.id);
    assert.strictEqual(updated1.status, 'contacted');
    assert.strictEqual(updated1.notes, 'Sent email on Oct 29');

    // Filter by status
    const contacted = service.getAll({ status: 'contacted' });
    assert.strictEqual(contacted.length, 1);
    assert.strictEqual(contacted[0].email, 'alice@alpha.com');

    // Search
    const searchRes = service.getAll({ search: 'Beta' });
    assert.strictEqual(searchRes.length, 1);
    assert.strictEqual(searchRes[0].email, 'bob.recruiter@beta.com');

    // Delete
    const deleted = service.delete(item2.id);
    assert.strictEqual(deleted, true);
    assert.strictEqual(service.getAll().length, 1);
  });
});
