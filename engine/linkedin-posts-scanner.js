const EventEmitter = require('events');
const MatchingEngine = require('./matching-engine');

class LinkedInPostsScanner extends EventEmitter {
  constructor(chromeManager, aiAgent, settings, logger, dataStore, recruiterEmailsService) {
    super();
    this.chrome = chromeManager;
    this.ai = aiAgent;
    this.settings = settings || {};
    this.logger = logger || console.log;
    this.dataStore = dataStore;
    this.recruiterEmails = recruiterEmailsService || (dataStore ? dataStore.recruiterEmails : null);
    this.shouldStop = false;
    this.scannedPostKeys = new Set();
    this.candidateExp = 3.0; // Sai Krishna G baseline experience
  }

  stop() {
    this.shouldStop = true;
  }

  async randomDelay(min = 1200, max = 2500) {
    if (this.settings?.disableDelays || this.settings?.automation?.disableDelaysForTesting) {
      return;
    }
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(r => setTimeout(r, delay));
  }

  /**
   * Generates targeted LinkedIn post search queries for candidate's skill sets
   */
  getTargetQueries() {
    const defaultQueries = [
      'hiring angular email',
      'hiring java email',
      'hiring "full stack" email',
      'hiring "spring boot" email'
    ];

    // If candidate has specific keywords configured in settings, incorporate them
    if (this.settings.search?.keywords) {
      const customKws = this.settings.search.keywords
        .split(',')
        .map(k => k.trim())
        .filter(Boolean);

      const customQueries = [];
      for (const kw of customKws) {
        if (/angular/i.test(kw)) customQueries.push('hiring "angular" email');
        else if (/java/i.test(kw)) customQueries.push('hiring "java" email');
        else if (/full\s*stack/i.test(kw)) customQueries.push('hiring "full stack" email');
        else if (/spring/i.test(kw)) customQueries.push('hiring "spring boot" email');
        else customQueries.push(`hiring "${kw}" email`);
      }

      if (customQueries.length > 0) {
        // Return deduplicated list prioritizing custom keywords then defaults
        return Array.from(new Set([...customQueries, ...defaultQueries])).slice(0, 5);
      }
    }

    return defaultQueries;
  }

  /**
   * Constructs LinkedIn Content/Posts search URL sorted by latest date posted
   */
  buildSearchUrl(query) {
    const encodedQuery = encodeURIComponent(query);
    const dateParam = this.settings.search?.datePosted || 'past_24h';
    
    // Sort by latest date posted
    let url = `https://www.linkedin.com/search/results/content/?keywords=${encodedQuery}&sortBy=%22date_posted%22`;

    // Add freshness filter if specified
    if (dateParam === 'past_24h' || dateParam === 'past_1h' || dateParam === 'past_2h') {
      url += '&datePosted=%22past-24h%22';
    } else if (dateParam === 'past_week' || dateParam === 'past_48h') {
      url += '&datePosted=%22past-week%22';
    } else if (dateParam === 'past_month') {
      url += '&datePosted=%22past-month%22';
    }

    return url;
  }

  /**
   * Infers role title from post text and author headline
   */
  inferJobTitle(text = '', headline = '') {
    const combined = `${headline} ${text}`.toLowerCase();

    if (combined.includes('angular') && (combined.includes('java') || combined.includes('spring'))) {
      return 'Full Stack Java & Angular Developer';
    }
    if (combined.includes('angular')) {
      return 'Angular Developer';
    }
    if (combined.includes('java') && combined.includes('spring')) {
      return 'Java Spring Boot Developer';
    }
    if (combined.includes('java')) {
      return 'Java Developer';
    }
    if (combined.includes('full stack') || combined.includes('fullstack')) {
      return 'Full Stack Developer';
    }
    if (combined.includes('backend') || combined.includes('back end')) {
      return 'Backend Developer';
    }
    if (combined.includes('frontend') || combined.includes('front end')) {
      return 'Frontend Developer';
    }

    return 'Software Engineer';
  }

  /**
   * Infers employer/company from recruiter headline or post body
   */
  inferCompany(headline = '', text = '') {
    // 1. Check headline for "at Company" or "@ Company"
    if (headline) {
      const match = headline.match(/(?:at|@|with)\s+([A-Z0-9][A-Za-z0-9\s&.,\-]{2,30})/);
      if (match && match[1]) {
        const comp = match[1].split(/[|,•\n]/)[0].trim();
        if (comp && !['hiring', 'recruitment', 'team', 'company', 'stealth'].includes(comp.toLowerCase())) {
          return comp;
        }
      }
    }

    // 2. Check post text for "hiring at/for Company" or "join us at Company"
    if (text) {
      const textMatch = text.match(/(?:hiring\s+(?:for|at)|join\s+(?:our\s+team\s+at|us\s+at))\s+([A-Z0-9][A-Za-z0-9\s&.,\-]{2,30})/i);
      if (textMatch && textMatch[1]) {
        let comp = textMatch[1].split(/\s+as\s+|\s+for\s+|\s+in\s+|[|,•\n\.]/)[0].trim();
        if (comp) return comp;
      }
    }

    return 'Direct Employer';
  }

  /**
   * Verifies if post is relevant to Angular / Java / Full Stack technical competencies
   */
  isSkillMatch(text = '', headline = '') {
    const combined = `${headline} ${text}`.toLowerCase();
    
    // Core technical keywords
    const requiredKeywords = [
      'angular',
      'java',
      'spring',
      'full stack',
      'fullstack',
      'backend',
      'typescript',
      'microservices'
    ];

    const hasSkill = requiredKeywords.some(kw => combined.includes(kw));
    if (!hasSkill) return false;

    // Check that post is actually a hiring/recruiting post
    const hiringKeywords = [
      'hiring',
      'opening',
      'requirement',
      'job',
      'opportunity',
      'looking for',
      'seeking',
      'reach out',
      'send cv',
      'send resume',
      'share profile',
      'share resume',
      'share your cv',
      'email your cv',
      'mail your resume',
      'drop your resume'
    ];

    return hiringKeywords.some(hk => combined.includes(hk));
  }

  /**
   * Evaluates experience requirement compatibility against candidate's ~3 years baseline
   */
  isExperienceCompatible(text = '', title = '') {
    const isExecOrArch = /\b(?:architect|principal|staff|director|vp|head)\b/i.test(title) ||
                         /\b(?:architect|principal|staff|director|vp|head)\b/i.test(text);
    if (isExecOrArch) {
      return {
        compatible: false,
        reason: 'Architect / Executive seniority mismatch',
        rangeStr: '8+ years (Architect/Principal inferred)',
        minYears: 8
      };
    }

    const evalResult = MatchingEngine.evaluateExperience(title, text, this.candidateExp);

    // Reject if minimum experience strictly exceeds candidate's ~3 years (e.g. 4+, 5+, 6+, 8+ years)
    if (evalResult.minYears !== null && evalResult.minYears >= 4.0) {
      return {
        compatible: false,
        reason: `Requires ${evalResult.rangeStr} (candidate has ~3 years)`,
        rangeStr: evalResult.rangeStr,
        minYears: evalResult.minYears
      };
    }

    // Reject architectural/executive level posts
    if (evalResult.category === MatchingEngine.EXPERIENCE_CATEGORIES.BELOW_MANDATORY) {
      return {
        compatible: false,
        reason: `Seniority mismatch: ${evalResult.rangeStr}`,
        rangeStr: evalResult.rangeStr,
        minYears: evalResult.minYears
      };
    }

    return {
      compatible: true,
      reason: evalResult.rangeStr,
      rangeStr: evalResult.rangeStr,
      minYears: evalResult.minYears
    };
  }

  /**
   * Main execution method to scan LinkedIn posts across target queries
   */
  async scanPosts(page = null) {
    this.shouldStop = false;
    const isSim = this.settings.automation?.simulationMode;
    const discoveredEmails = [];

    this.logger('info', 'LinkedInPosts', 'Commencing LinkedIn Hiring Posts Recruiter Outreach Scanner...');

    if (isSim) {
      return this.runSimulationScan();
    }

    let ownPage = false;
    let scanPage = page;

    try {
      if (!scanPage) {
        scanPage = await this.chrome.newPage();
        ownPage = true;
        await scanPage.setViewport({ width: 1280, height: 800 });
      }

      const queries = this.getTargetQueries();
      const maxPostsPerQuery = this.settings.automation?.maxPostsPerQuery || 15;
      let totalDiscovered = 0;

      for (let qIdx = 0; qIdx < queries.length; qIdx++) {
        if (this.shouldStop) break;

        const query = queries[qIdx];
        const searchUrl = this.buildSearchUrl(query);

        this.logger('action', 'LinkedInPosts', `[Query ${qIdx + 1}/${queries.length}] Searching LinkedIn Posts for: "${query}" (Latest Posts)...`);

        try {
          await scanPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await this.randomDelay(2000, 3500);

          // Verify if session is active or redirected to login
          const isAuth = await scanPage.evaluate(() => {
            const currentUrl = window.location.href;
            if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint') || currentUrl.includes('/authwall')) {
              return false;
            }
            return !!document.querySelector('.global-nav, #global-nav, nav.search-reusables__primary-filter');
          });

          if (!isAuth) {
            this.logger('warning', 'LinkedInPosts', 'LinkedIn session is not authenticated or hit authwall. Please ensure you are logged into LinkedIn in Chrome.');
            break;
          }

          // Scroll down to load initial batch of posts
          for (let s = 0; s < 3; s++) {
            if (this.shouldStop) break;
            await scanPage.evaluate(() => window.scrollBy(0, 900));
            await this.randomDelay(1000, 1800);
          }

          // Expand all "...see more" buttons on posts to reveal hidden text & recruiter emails
          await this.expandPostSeeMoreButtons(scanPage);
          await this.randomDelay(1000, 1500);

          // Extract raw post elements from the DOM
          const rawPosts = await this.extractPostsFromPage(scanPage);
          this.logger('info', 'LinkedInPosts', `Discovered ${rawPosts.length} posts on page for query "${query}". Filtering for skills, experience, and recruiter emails...`);

          let queryMatches = 0;

          for (const post of rawPosts) {
            if (this.shouldStop || queryMatches >= maxPostsPerQuery) break;

            const postKey = post.postUrn || post.postLink || `${post.authorName}_${post.text.substring(0, 40)}`;
            if (this.scannedPostKeys.has(postKey)) {
              continue;
            }
            this.scannedPostKeys.add(postKey);

            // 1. Skill Match Check
            const isSkillOk = this.isSkillMatch(post.text, post.authorHeadline);
            if (!isSkillOk) {
              continue;
            }

            // 2. Infer Job Title & Company
            const inferredTitle = this.inferJobTitle(post.text, post.authorHeadline);
            const inferredCompany = this.inferCompany(post.authorHeadline, post.text);

            // 3. Experience Compatibility Check
            const expCheck = this.isExperienceCompatible(post.text, inferredTitle);
            if (!expCheck.compatible) {
              this.logger('info', 'LinkedInPosts', `Skipping post by "${post.authorName}" (${inferredCompany}): ${expCheck.reason}`);
              continue;
            }

            // 4. Extract Recruiter Email
            if (this.recruiterEmails) {
              const extracted = this.recruiterEmails.extractEmailsFromText(post.text, {
                title: inferredTitle,
                company: inferredCompany,
                recruiterName: post.authorName,
                url: post.postLink || scanPage.url(),
                platform: 'LinkedIn',
                source: 'LinkedIn Post',
                context: `LinkedIn Post by ${post.authorName} (${post.authorHeadline || 'Recruiter'}): ${post.text.substring(0, 100)}...`
              });

              if (extracted && extracted.length > 0) {
                queryMatches += extracted.length;
                totalDiscovered += extracted.length;
                discoveredEmails.push(...extracted);

                for (const item of extracted) {
                  this.logger('success', 'RecruiterOutreach', `[LinkedIn Post Match] Found recruiter email: ${item.email} (${inferredCompany} - ${inferredTitle}). Experience: ${expCheck.rangeStr}. Added to Recruiter Outreach!`);
                  this.emit('recruiter_email_found', item);
                }
              }
            }
          }

          this.logger('info', 'LinkedInPosts', `Completed scan for "${query}". Found ${queryMatches} recruiter emails meeting candidate criteria.`);
          await this.randomDelay(2000, 3500);

        } catch (queryErr) {
          this.logger('error', 'LinkedInPosts', `Error querying "${query}": ${queryErr.message}`);
        }
      }

      this.logger('success', 'LinkedInPosts', `LinkedIn Hiring Posts scan complete. Discovered and verified ${totalDiscovered} high-match recruiter contacts.`);
      return discoveredEmails;

    } catch (err) {
      this.logger('error', 'LinkedInPosts', `Scanner failure: ${err.message}`);
      return discoveredEmails;
    } finally {
      if (ownPage && scanPage && !scanPage.isClosed()) {
        try {
          await scanPage.close();
        } catch (e) {}
      }
    }
  }

  /**
   * Clicks all "...see more" buttons on posts in DOM to un-truncate text
   */
  async expandPostSeeMoreButtons(page) {
    try {
      await page.evaluate(() => {
        const seeMoreSelectors = [
          'button.feed-shared-inline-show-more-text__see-more-less-toggle',
          'button[aria-label*="see more"]',
          '.feed-shared-inline-show-more-text button',
          'span.feed-shared-inline-show-more-text__see-more-less-toggle',
          'button.see-more',
          'button[data-tracking-control-name*="see_more"]'
        ];

        for (const sel of seeMoreSelectors) {
          const buttons = Array.from(document.querySelectorAll(sel));
          for (const btn of buttons) {
            try {
              if (btn && btn.offsetParent !== null && !btn.hasAttribute('data-autoapply-clicked')) {
                btn.setAttribute('data-autoapply-clicked', 'true');
                btn.click();
              }
            } catch (e) {}
          }
        }
      });
    } catch (e) {
      // Best-effort expansion
    }
  }

  /**
   * Extracts raw post items from the active LinkedIn content search DOM
   */
  async extractPostsFromPage(page) {
    try {
      return await page.evaluate(() => {
        const results = [];
        const cardSelectors = [
          '.feed-shared-update-v2',
          'div[data-urn*="urn:li:activity:"]',
          'div[data-urn*="urn:li:ugcPost:"]',
          '.search-results-container .feed-shared-update-v2',
          'div.search-results-container div[data-view-name*="feed"]'
        ];

        const cards = [];
        for (const sel of cardSelectors) {
          const els = Array.from(document.querySelectorAll(sel));
          if (els.length > 0) {
            cards.push(...els);
            break;
          }
        }

        for (const card of cards) {
          try {
            const postUrn = card.getAttribute('data-urn') || '';

            // Author Name
            const nameEl = card.querySelector('.feed-shared-actor__name, .update-components-actor__name, span[dir="ltr"] > span[aria-hidden="true"], .feed-shared-actor__title');
            const authorName = nameEl ? nameEl.innerText.trim() : 'Recruiter';

            // Author Headline
            const headlineEl = card.querySelector('.feed-shared-actor__description, .update-components-actor__description, .feed-shared-actor__headline');
            const authorHeadline = headlineEl ? headlineEl.innerText.trim() : '';

            // Posted Time
            const timeEl = card.querySelector('.feed-shared-actor__sub-description, .update-components-actor__sub-description');
            const postedTime = timeEl ? timeEl.innerText.trim() : '';

            // Post Text
            const textEl = card.querySelector('.feed-shared-update-v2__description, .update-components-text, .feed-shared-inline-show-more-text');
            const text = textEl ? textEl.innerText.trim() : (card.innerText || '').trim();

            // Post Link / Permalink
            const linkEl = card.querySelector('a[href*="/activity/"], a[href*="/feed/update/"]');
            let postLink = linkEl ? linkEl.href : '';
            if (!postLink && postUrn) {
              postLink = `https://www.linkedin.com/feed/update/${postUrn}`;
            }

            if (text && text.length > 15) {
              results.push({
                postUrn,
                authorName,
                authorHeadline,
                postedTime,
                text,
                postLink
              });
            }
          } catch (e) {
            // Ignore single card extraction error
          }
        }

        return results;
      });
    } catch (err) {
      return [];
    }
  }

  /**
   * Deterministic simulation scan for offline testing and verification
   */
  async runSimulationScan() {
    this.logger('simulation', 'Simulation', 'Scanning simulated LinkedIn Hiring Posts with candidate criteria (Angular, Java, 1-3 yrs experience)...');

    const simulatedPosts = [
      {
        postUrn: 'urn:li:activity:sim-101',
        authorName: 'Sneha Patel',
        authorHeadline: 'Technical Talent Acquisition Specialist at PhonePe',
        postedTime: '2h ago',
        text: 'We are hiring! Looking for an Angular & Java Spring Boot Full Stack Developer with 1 to 3 years of experience. Strong background in TypeScript, RESTful APIs, and MySQL. Location: Bengaluru / Hybrid. Please email your resume to sneha.recruiter@phonepe.com with subject "Full Stack Application".',
        postLink: 'https://www.linkedin.com/feed/update/urn:li:activity:sim-101'
      },
      {
        postUrn: 'urn:li:activity:sim-102',
        authorName: 'Vikram Sethi',
        authorHeadline: 'Engineering Lead at InnovateX Solutions',
        postedTime: '4h ago',
        text: 'Hiring alert: Java Backend Engineer (Spring Boot, Microservices, PostgreSQL). Experience required: 2-4 years. Fast joiners preferred. Send your profile directly to vikram.hiring@innovatex.io',
        postLink: 'https://www.linkedin.com/feed/update/urn:li:activity:sim-102'
      },
      {
        postUrn: 'urn:li:activity:sim-103',
        authorName: 'Rohan Sharma',
        authorHeadline: 'Talent Partner at CloudMinds',
        postedTime: '6h ago',
        text: 'Urgently hiring Frontend Engineer (Angular 16/17, RxJS, JavaScript). 0-3 years experience welcome. Hyderabad or Remote. Send CV to talent@cloudminds.tech',
        postLink: 'https://www.linkedin.com/feed/update/urn:li:activity:sim-103'
      },
      {
        postUrn: 'urn:li:activity:sim-104',
        authorName: 'Priya Nambiar',
        authorHeadline: 'Senior HR Manager at Enterprise Corp',
        postedTime: '1h ago',
        text: 'Hiring Principal Architect (Java & Cloud). Minimum 8+ years of mandatory experience required. Email resume to priya.exec@enterprise.com',
        postLink: 'https://www.linkedin.com/feed/update/urn:li:activity:sim-104'
      }
    ];

    const results = [];

    for (const post of simulatedPosts) {
      if (this.shouldStop) break;

      // 1. Skill check
      if (!this.isSkillMatch(post.text, post.authorHeadline)) {
        continue;
      }

      const inferredTitle = this.inferJobTitle(post.text, post.authorHeadline);
      const inferredCompany = this.inferCompany(post.authorHeadline, post.text);

      // 2. Experience check
      const expCheck = this.isExperienceCompatible(post.text, inferredTitle);
      if (!expCheck.compatible) {
        this.logger('simulation', 'Simulation', `Filtered out post by "${post.authorName}" (${inferredCompany}): ${expCheck.reason}`);
        continue;
      }

      // 3. Extract and save email
      if (this.recruiterEmails) {
        const extracted = this.recruiterEmails.extractEmailsFromText(post.text, {
          title: inferredTitle,
          company: inferredCompany,
          recruiterName: post.authorName,
          url: post.postLink,
          platform: 'LinkedIn',
          source: 'LinkedIn Post',
          context: `Simulated LinkedIn Post: ${post.text.substring(0, 100)}...`
        });

        if (extracted && extracted.length > 0) {
          results.push(...extracted);
          for (const item of extracted) {
            this.logger('success', 'RecruiterOutreach', `[Simulation Match] Discovered recruiter: ${item.email} (${inferredCompany} - ${inferredTitle}). Saved to Recruiter Outreach!`);
            this.emit('recruiter_email_found', item);
          }
        }
      }
    }

    this.logger('success', 'Simulation', `Simulation complete: Processed simulated posts and extracted ${results.length} valid recruiter contacts.`);
    return results;
  }
}

module.exports = LinkedInPostsScanner;
