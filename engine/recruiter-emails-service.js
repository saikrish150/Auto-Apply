const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class RecruiterEmailsService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.dataDir = options.dataDir || path.join(__dirname, '..', 'data');
    this.filePath = path.join(this.dataDir, 'recruiter_emails.json');
    this.candidateProfile = options.candidateProfile || null;

    // Known noise domains to ignore
    this.ignoredDomains = new Set([
      'example.com',
      'domain.com',
      'test.com',
      'schema.org',
      'w3.org',
      'github.com',
      'npmjs.com',
      'reactjs.org',
      'angular.io',
      'sentry.io',
      'google.com',
      'gstatic.com',
      'linkedin.com',
      'naukri.com',
      'foundit.in',
      'cloudflare.com',
      'facebook.com',
      'twitter.com',
      'instagram.com',
      'youtube.com'
    ]);

    // Ignored prefix patterns (common placeholders or web assets)
    this.ignoredPrefixes = [
      'noreply',
      'no-reply',
      'donotreply',
      'privacy',
      'support',
      'help',
      'admin',
      'info',
      'security',
      'abuse',
      'postmaster',
      'hostmaster',
      'mailer-daemon',
      'feedback',
      'contact-us',
      'terms'
    ];

    // Candidate's own email to avoid self-extraction
    this.candidateEmail = 'gsaikrishna150@gmail.com';

    this.emails = [];
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.emails = parsed;
        } else if (parsed && Array.isArray(parsed.emails)) {
          this.emails = parsed.emails;
        }
      } else {
        this.emails = [];
        this.save();
      }
    } catch (err) {
      console.error('[RecruiterEmailsService] Init error:', err.message);
      this.emails = [];
    }
  }

  save() {
    try {
      const summary = this.getStats();
      const payload = {
        summary,
        emails: this.emails
      };
      fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error('[RecruiterEmailsService] Save error:', err.message);
      return false;
    }
  }

  getStats() {
    const total = this.emails.length;
    const newCount = this.emails.filter(e => e.status === 'new').length;
    const contactedCount = this.emails.filter(e => e.status === 'contacted').length;
    const repliedCount = this.emails.filter(e => e.status === 'replied').length;
    const archivedCount = this.emails.filter(e => e.status === 'archived').length;

    const byPlatform = {
      LinkedIn: this.emails.filter(e => e.platform === 'LinkedIn').length,
      Naukri: this.emails.filter(e => e.platform === 'Naukri').length,
      Foundit: this.emails.filter(e => e.platform === 'Foundit').length,
      'Career Website': this.emails.filter(e => e.platform === 'Career Website' || e.platform === 'Career Site').length,
      Other: this.emails.filter(e => !['LinkedIn', 'Naukri', 'Foundit', 'Career Website', 'Career Site'].includes(e.platform)).length
    };

    return {
      totalEmails: total,
      newCount,
      contactedCount,
      repliedCount,
      archivedCount,
      byPlatform,
      lastUpdated: new Date().toISOString()
    };
  }

  getAll(filters = {}) {
    let result = [...this.emails];

    if (filters.status && filters.status !== 'all') {
      result = result.filter(e => e.status === filters.status);
    }

    if (filters.platform && filters.platform !== 'all') {
      result = result.filter(e => (e.platform || '').toLowerCase() === filters.platform.toLowerCase());
    }

    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(e =>
        (e.email || '').toLowerCase().includes(q) ||
        (e.company || '').toLowerCase().includes(q) ||
        (e.jobTitle || '').toLowerCase().includes(q) ||
        (e.recruiterName || '').toLowerCase().includes(q) ||
        (e.context || '').toLowerCase().includes(q)
      );
    }

    // Sort by foundAt descending (newest first)
    result.sort((a, b) => new Date(b.foundAt || 0) - new Date(a.foundAt || 0));

    return result;
  }

  getById(id) {
    return this.emails.find(e => e.id === id) || null;
  }

  isValidRecruiterEmail(rawEmail) {
    if (!rawEmail || typeof rawEmail !== 'string') return false;
    const email = rawEmail.trim().toLowerCase();

    // Standard RFC-compliant email regex
    const emailRegex = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
    if (!emailRegex.test(email)) return false;

    // Filter candidate email
    if (email === this.candidateEmail.toLowerCase()) return false;

    // Extract domain
    const parts = email.split('@');
    if (parts.length !== 2) return false;
    const prefix = parts[0];
    const domain = parts[1];

    // Filter ignored noise domains
    if (this.ignoredDomains.has(domain)) return false;

    // Discard file extension artifacts (e.g. email.png@domain)
    if (/\.(png|jpg|jpeg|gif|svg|webp|css|js|woff|woff2|ttf)$/i.test(domain)) return false;

    // Discard generic non-recruiter service prefixes unless domain is specifically an employer HR email
    if (this.ignoredPrefixes.includes(prefix) && !domain.includes('talent') && !domain.includes('recruiting') && !domain.includes('careers')) {
      return false;
    }

    // Filter single-letter prefixes or weird minified js tokens
    if (prefix.length <= 1) return false;

    return true;
  }

  /**
   * Generates a tailored, professional cold outreach message ready for Sai Krishna G
   */
  generateOutreachTemplate(meta = {}) {
    const jobTitle = meta.jobTitle || 'Full Stack Developer';
    const company = meta.company || 'your team';
    const recruiter = meta.recruiterName && meta.recruiterName !== 'Hiring Team' ? meta.recruiterName : 'Hiring Team';

    const subject = `Application for ${jobTitle} - Sai Krishna G (3 Yrs Exp | Full Stack Angular & Spring Boot)`;

    const body = `Hi ${recruiter},

I hope this email finds you well.

I came across the ${jobTitle} opening at ${company} and wanted to reach out directly to express my strong interest.

Here is a quick summary of my profile:
• Experience: 3 Years as Full Stack Developer at Tech Mahindra (GE Aerospace Client).
• Core Tech Stack: Angular 17/18, TypeScript, Java, Spring Boot, Microservices, RESTful APIs, PostgreSQL, AWS Lambda, Docker.
• Current Location: Hyderabad (Open to Bengaluru, Pune, Remote & Relocation).
• Notice Period: 30 Days (Currently serving notice period - fast joiner).
• Portfolio & Projects: https://gsaikrishna-portfolio.netlify.app/
• LinkedIn: https://www.linkedin.com/in/saikrishnag150
• GitHub: https://github.com/saikrish150

I have attached my updated resume for your reference. I would love the opportunity to discuss how my hands-on background in enterprise Angular and Spring Boot can add immediate value to ${company}.

Looking forward to hearing from you!

Best regards,
Sai Krishna G
Phone: +91 8688373517
Email: gsaikrishna150@gmail.com`;

    return { subject, body };
  }

  /**
   * Scans arbitrary text (e.g. job description, webpage content, recruiter card)
   * and extracts valid recruiter emails with surrounding context.
   */
  extractEmailsFromText(text, meta = {}) {
    if (!text || typeof text !== 'string') return [];

    const foundRecords = [];
    const rawMatches = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];

    for (const raw of rawMatches) {
      const email = raw.trim().toLowerCase();

      if (!this.isValidRecruiterEmail(email)) continue;

      // Extract a 120-character surrounding snippet for context
      const idx = text.toLowerCase().indexOf(email);
      let context = '';
      if (idx !== -1) {
        const start = Math.max(0, idx - 60);
        const end = Math.min(text.length, idx + email.length + 60);
        context = text.slice(start, end).replace(/\s+/g, ' ').trim();
        if (start > 0) context = '...' + context;
        if (end < text.length) context = context + '...';
      }

      // Check if recruiter name can be inferred from context or meta
      let recruiterName = meta.recruiterName || '';
      if (!recruiterName && context) {
        const nameMatch = context.match(/(?:contact|recruiter|hr|reach\s*out\s*to|connect\s*with|person)\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
        if (nameMatch && nameMatch[1]) {
          recruiterName = nameMatch[1].trim();
        }
      }
      if (!recruiterName) {
        recruiterName = 'Hiring Team';
      }

      const record = this.addOrUpdate({
        email,
        recruiterName,
        company: meta.company || 'Employer',
        jobTitle: meta.title || meta.jobTitle || 'Software Developer',
        jobUrl: meta.url || meta.jobUrl || '',
        platform: meta.platform || 'General',
        context: context || meta.context || 'Found in job listing details'
      });

      if (record) {
        foundRecords.push(record);
      }
    }

    return foundRecords;
  }

  /**
   * Adds a recruiter email or updates existing entry if already recorded
   */
  addOrUpdate(data) {
    if (!data || !data.email) return null;
    const cleanEmail = data.email.trim().toLowerCase();

    if (!this.isValidRecruiterEmail(cleanEmail)) return null;

    const existingIndex = this.emails.findIndex(e => e.email === cleanEmail && (e.company || '').toLowerCase() === (data.company || '').toLowerCase());

    const templates = this.generateOutreachTemplate({
      jobTitle: data.jobTitle,
      company: data.company,
      recruiterName: data.recruiterName
    });

    if (existingIndex >= 0) {
      // Update existing record with newer context or job title
      const existing = this.emails[existingIndex];
      existing.lastSeenAt = new Date().toISOString();
      if (data.jobTitle && !existing.jobTitles?.includes(data.jobTitle)) {
        existing.jobTitles = existing.jobTitles || [existing.jobTitle];
        if (!existing.jobTitles.includes(data.jobTitle)) {
          existing.jobTitles.push(data.jobTitle);
        }
      }
      if (data.context && (!existing.context || existing.context.length < data.context.length)) {
        existing.context = data.context;
      }
      this.save();
      this.emit('recruiter_email_updated', existing);
      return existing;
    }

    const newRecord = {
      id: `recruiter-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      email: cleanEmail,
      recruiterName: data.recruiterName || 'Hiring Team',
      company: data.company || 'Direct Employer',
      jobTitle: data.jobTitle || 'Software Developer',
      jobTitles: [data.jobTitle || 'Software Developer'],
      jobUrl: data.jobUrl || '',
      platform: data.platform || 'Direct',
      context: data.context || 'Found during job application flow',
      status: data.status || 'new', // 'new' | 'contacted' | 'replied' | 'archived'
      notes: data.notes || '',
      subjectTemplate: templates.subject,
      bodyTemplate: templates.body,
      foundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };

    this.emails.unshift(newRecord);
    this.save();
    this.emit('recruiter_email_found', newRecord);
    return newRecord;
  }

  update(id, updates = {}) {
    const record = this.emails.find(e => e.id === id);
    if (!record) return null;

    if (updates.status) {
      const statusNormalized = String(updates.status).trim().toLowerCase();
      if (['new', 'contacted', 'replied', 'archived'].includes(statusNormalized)) {
        record.status = statusNormalized;
        if (statusNormalized === 'contacted' && !record.contactedAt) {
          record.contactedAt = new Date().toISOString();
        }
      }
    }

    if (updates.notes !== undefined) {
      record.notes = updates.notes;
    }

    if (updates.recruiterName) {
      record.recruiterName = updates.recruiterName;
    }

    if (updates.company) {
      record.company = updates.company;
    }

    record.updatedAt = new Date().toISOString();
    this.save();
    this.emit('recruiter_email_updated', record);
    return record;
  }

  delete(id) {
    const initialLen = this.emails.length;
    this.emails = this.emails.filter(e => e.id !== id);
    if (this.emails.length !== initialLen) {
      this.save();
      this.emit('recruiter_email_deleted', { id });
      return true;
    }
    return false;
  }

  /**
   * Retroactively scans all historical applications in data/applications.json
   * to automatically harvest existing recruiter emails!
   */
  scanHistoricalApplications(applications = []) {
    if (!Array.isArray(applications) || applications.length === 0) return 0;

    let harvested = 0;
    for (const app of applications) {
      const textsToScan = [
        app.description || '',
        app.jobDescription || '',
        app.notes || '',
        app.reason || '',
        app.details || ''
      ].join('\n');

      if (!textsToScan.trim()) continue;

      const extracted = this.extractEmailsFromText(textsToScan, {
        title: app.title,
        company: app.company,
        url: app.url,
        platform: app.platform
      });

      harvested += extracted.length;
    }

    return harvested;
  }
}

module.exports = RecruiterEmailsService;
