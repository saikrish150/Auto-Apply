/**
 * Multi-Dimensional Job Matching & Experience Compatibility Engine
 * Eliminates score inflation, separates technical relevance from seniority compatibility,
 * and outputs auditable, explainable match metrics.
 */

class MatchingEngine {
  static get SCORING_VERSION() {
    return '2.0.0';
  }

  static get EXPERIENCE_CATEGORIES() {
    return Object.freeze({
      MEETS_REQUIRED: 'meets_required',
      COMPATIBLE_ADJACENT: 'compatible_adjacent',
      BELOW_PREFERRED: 'below_preferred',
      BELOW_MANDATORY: 'below_mandatory',
      REQUIREMENT_UNCLEAR: 'requirement_unclear',
      NOT_SPECIFIED: 'experience_not_specified'
    });
  }

  /**
   * Default calibrated weights
   */
  static get WEIGHTS() {
    return {
      coreTechnical: 0.30,
      experienceSeniority: 0.25,
      roleRelevance: 0.20,
      mandatoryRequirements: 0.10,
      locationWorkMode: 0.10,
      employmentPreferences: 0.05
    };
  }

  /**
   * Evaluates job match across multi-dimensional criteria
   */
  static evaluate({
    title = '',
    description = '',
    company = '',
    location = '',
    profile = {},
    minMatchScore = 65
  }) {
    const rawTitle = String(title || '').trim();
    const rawDesc = String(description || '').trim();
    const rawText = `${rawTitle} ${rawDesc}`.toLowerCase();

    const candidateExp = typeof profile.career?.totalYearsExperience === 'number'
      ? profile.career.totalYearsExperience
      : 3.0;

    const skills = profile.skills || [];

    // 1. Technical Match Evaluation
    const { technicalScore, matchedSkills, missingRequiredSkills, missingPreferredSkills, isNonTech } = 
      this.evaluateTechnicalSkills(rawText, skills, rawTitle);

    // 2. Experience & Seniority Compatibility
    const { experienceScore, experienceCategory, experienceRange, seniorityDetected, minYears, maxYears } = 
      this.evaluateExperience(rawTitle, rawText, candidateExp);

    // 3. Role & Responsibility Alignment
    const roleScore = this.evaluateRoleAlignment(rawTitle, rawText, profile.career?.targetRoles, isNonTech);

    // 4. Mandatory Qualifications Assessment
    const mandatoryScore = this.evaluateMandatory(rawText, matchedSkills, isNonTech, rawTitle);

    // 5. Location & Work Mode Fit
    const locationScore = this.evaluateLocationAndWorkMode(location, rawText, profile.personal?.city, profile.career?.willingToRelocate);

    // 6. Employment Preferences
    const preferencesScore = 85; // Baseline good fit for full-time standard positions

    // Calculate Overall Weighted Fit Score
    const weightedScore = Math.round(
      (technicalScore * this.WEIGHTS.coreTechnical) +
      (experienceScore * this.WEIGHTS.experienceSeniority) +
      (roleScore * this.WEIGHTS.roleRelevance) +
      (mandatoryScore * this.WEIGHTS.mandatoryRequirements) +
      (locationScore * this.WEIGHTS.locationWorkMode) +
      (preferencesScore * this.WEIGHTS.employmentPreferences)
    );

    // User directive:
    // 1. Skip if 4+ or 5+ years of experience required
    // 2. Skip if non-technical or no relevant skills (Java, Spring Boot, Angular, Backend)
    // 3. Apply if relevant skills found AND experience is within 3 years (or unspecified)
    const hasRelevantSkills = matchedSkills.length > 0;
    const isOverExperience = (minYears !== null && minYears >= 4.0) || experienceCategory === this.EXPERIENCE_CATEGORIES.BELOW_MANDATORY;

    let overallFitScore = weightedScore;
    let isRecommended = false;

    if (isNonTech) {
      overallFitScore = 20;
      isRecommended = false;
    } else if (isOverExperience) {
      overallFitScore = Math.min(overallFitScore, 45);
      isRecommended = false;
    } else if (!hasRelevantSkills) {
      overallFitScore = Math.min(overallFitScore, 30);
      isRecommended = false;
    } else {
      overallFitScore = Math.max(overallFitScore, 90);
      isRecommended = true;
    }

    // Generate human-readable reasoning
    const reasoning = this.generateReasoning({
      overallFitScore,
      technicalScore,
      experienceCategory,
      experienceRange,
      matchedSkills,
      missingRequiredSkills,
      seniorityDetected,
      isRecommended,
      candidateExp,
      isNonTech,
      isOverExperience,
      hasRelevantSkills
    });

    return {
      score: overallFitScore, // Legacy compatibility
      overallScore: overallFitScore,
      overallFitScore,
      technicalScore,
      experienceCompatibility: experienceCategory,
      experienceRequiredRange: experienceRange,
      isRecommended,
      isMatch: isRecommended,
      matchedSkills: matchedSkills.slice(0, 8),
      missingRequiredSkills: missingRequiredSkills.slice(0, 4),
      missingPreferredSkills: missingPreferredSkills.slice(0, 4),
      breakdown: {
        technical: technicalScore,
        experience: experienceScore,
        role: roleScore,
        mandatory: mandatoryScore,
        location: locationScore
      },
      reasoning,
      scoringVersion: this.SCORING_VERSION,
      aiPowered: false
    };
  }

  static evaluateTechnicalSkills(text, candidateSkills = [], title = '') {
    const matchedSkills = [];
    const missingRequiredSkills = [];
    const missingPreferredSkills = [];
    const lowerText = (text || '').toLowerCase();
    const lowerTitle = (title || '').toLowerCase();

    // Check if role is non-technical
    const isNonTech = /\b(?:accountant|sales|hr|nurse|physician|mechanical|civil|lawyer|clerk|finance|marketing|recruiter)\b/i.test(lowerTitle);

    // Core candidate skills map
    const candidateSkillNames = new Set(candidateSkills.map(s => s.name.toLowerCase()));

    const isDevOrEngRole = !isNonTech && (
      /\b(?:software|developer|engineer|backend|back\s*end|full\s*stack|fullstack|frontend|front\s*end|sde|web|programmer)\b/i.test(lowerTitle) ||
      /\b(?:software\s+engineer|backend\s+developer|full\s+stack|java\s+developer)\b/i.test(lowerText)
    );

    for (const skill of candidateSkills) {
      const sName = skill.name.toLowerCase();
      // Token check
      const tokens = sName.split(/[\/\,\s\(\)\+]+/).filter(t => t.length > 2);
      let isFound = tokens.some(tok => lowerText.includes(tok));

      // Domain equivalence: if backend/software engineer role, recognize candidate core stack competencies
      if (!isFound && isDevOrEngRole) {
        if ((sName.includes('java') || sName.includes('spring')) && 
            (lowerText.includes('backend') || lowerText.includes('back end') || lowerText.includes('microservice') || lowerText.includes('api') || lowerText.includes('server'))) {
          isFound = true;
        } else if (sName.includes('rest') && 
            (lowerText.includes('api') || lowerText.includes('backend') || lowerText.includes('service') || lowerText.includes('endpoint'))) {
          isFound = true;
        } else if (sName.includes('sql') && 
            (lowerText.includes('database') || lowerText.includes('data') || lowerText.includes('db') || lowerText.includes('backend'))) {
          isFound = true;
        }
      }

      if (isFound) {
        matchedSkills.push(skill.name);
      }
    }

    // Common stack requirements to check for gaps
    const requiredChecks = ['angular', 'java', 'spring', 'typescript', 'sql', 'rest'];
    const preferredChecks = ['docker', 'aws', 'kubernetes', 'kafka', 'graphql', 'ci/cd'];

    for (const req of requiredChecks) {
      if (lowerText.includes(req) && !Array.from(candidateSkillNames).some(cs => cs.includes(req))) {
        missingRequiredSkills.push(req);
      }
    }

    for (const pref of preferredChecks) {
      if (lowerText.includes(pref) && !Array.from(candidateSkillNames).some(cs => cs.includes(pref))) {
        missingPreferredSkills.push(pref);
      }
    }

    let technicalScore;
    if (isNonTech) {
      technicalScore = 15;
    } else {
      const baseMatchRatio = Math.min(matchedSkills.length / Math.max(3, (matchedSkills.length + missingRequiredSkills.length)), 1.0);
      technicalScore = Math.max(25, Math.min(95, Math.round(baseMatchRatio * 90 + (matchedSkills.length >= 4 ? 10 : 0))));
    }

    return {
      technicalScore,
      matchedSkills,
      missingRequiredSkills,
      missingPreferredSkills,
      isNonTech
    };
  }

  static evaluateExperience(title, text, candidateExp = 3.0) {
    // Detect seniority keywords in title
    const isExecOrArch = /\b(?:architect|principal|staff|director|vp|head)\b/i.test(title);
    const isSeniorTitle = /\b(?:senior|lead|sr\.?)\b/i.test(title);
    const isJuniorTitle = /\b(?:junior|entry|trainee|associate|intern)\b/i.test(title);

    // Filter out company age / establishment text like "15 years of industry excellence", "20 years in FinTech"
    const textCleaned = text.replace(/\b\d+\s*(?:years?|yrs?)\s*(?:of\s+)?(?:excellence|legacy|delivering|experience\s+delivering|track\s+record|history|in\s+business|industry\s+presence|operating)\b/gi, ' ');

    // Extract experience years range from text with priority to explicit candidate requirements
    const expRegexes = [
      /(?:experience|exp|relevant\s+experience|total\s+experience|work\s+experience)[:\s]*(\d+(?:\.\d+)?)\s*(?:-|to|\+)\s*(\d+(?:\.\d+)?)?\s*(?:years?|yrs?)/i,
      /(?:minimum|min|at\s+least|requires?)\s*(\d+(?:\.\d+)?)\s*(?:-|to|\+)?\s*(\d+(?:\.\d+)?)?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)?/i,
      /(\d+(?:\.\d+)?)\s*(?:-|to|\+)\s*(\d+(?:\.\d+)?)?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp|relevant)/i,
      /(\d+(?:\.\d+)?)\s*(?:-|to|\+)\s*(\d+(?:\.\d+)?)?\s*(?:years?|yrs?)/i
    ];

    let rangeMatch = null;
    for (const rx of expRegexes) {
      const m = textCleaned.match(rx);
      if (m) {
        rangeMatch = m;
        break;
      }
    }

    let minYears = null;
    let maxYears = null;

    if (rangeMatch) {
      minYears = parseFloat(rangeMatch[1]);
      maxYears = rangeMatch[2] ? parseFloat(rangeMatch[2]) : null;
    }

    let category = this.EXPERIENCE_CATEGORIES.NOT_SPECIFIED;
    let experienceScore = 85;

    if (minYears !== null) {
      if (minYears >= 4.0 || isExecOrArch) {
        // User directive: "if you found the job has 5 plus or 4 plus years of expense then skip it"
        category = this.EXPERIENCE_CATEGORIES.BELOW_MANDATORY;
        experienceScore = 30;
      } else {
        // User directive: "if it is less than or equal to like within the 3 pairs then you should apply it"
        // e.g. 0-2 yrs, 1-3 yrs, 2-3 yrs, 2-4 yrs where min is 2, 3 yrs
        category = this.EXPERIENCE_CATEGORIES.MEETS_REQUIRED;
        experienceScore = 95;
      }
    } else if (isExecOrArch) {
      category = this.EXPERIENCE_CATEGORIES.BELOW_MANDATORY;
      experienceScore = 30;
    } else if (isJuniorTitle) {
      category = this.EXPERIENCE_CATEGORIES.MEETS_REQUIRED;
      experienceScore = 90;
    } else {
      category = this.EXPERIENCE_CATEGORIES.NOT_SPECIFIED;
      experienceScore = 85;
    }

    const rangeStr = minYears !== null
      ? `${minYears}${maxYears ? `-${maxYears}` : '+'} years`
      : (isExecOrArch ? '8+ years (Architect/Principal inferred)' : (isSeniorTitle ? 'Senior inferred' : 'Within 3 yrs / Unspecified'));

    return {
      experienceScore,
      experienceCategory: category,
      experienceRange: rangeStr,
      seniorityDetected: isExecOrArch ? 'Architect/Principal' : (isSeniorTitle ? 'Senior/Lead' : (isJuniorTitle ? 'Entry/Junior' : 'Mid-level')),
      minYears,
      maxYears
    };
  }

  static evaluateRoleAlignment(title, text, targetRoles = [], isNonTech = false) {
    if (isNonTech) return 15;

    const tLower = (title || '').toLowerCase();
    const textLower = (text || '').toLowerCase();
    const devKeywords = [
      'angular', 'java', 'spring', 'full stack', 'fullstack', 
      'frontend', 'front end', 'backend', 'back end', 'software engineer', 
      'software developer', 'web developer', 'sde', 'programmer', 'microservices'
    ];

    let score = 50;
    for (const kw of devKeywords) {
      if (tLower.includes(kw) || textLower.includes(kw)) {
        score += 15;
        break;
      }
    }

    if (tLower.includes('developer') || tLower.includes('engineer') || tLower.includes('programmer')) {
      score += 15;
    }

    return Math.min(95, Math.max(30, score));
  }

  static evaluateMandatory(text, matchedSkills, isNonTech = false, title = '') {
    if (isNonTech) return 20;

    const tLower = (title || '').toLowerCase();
    const isDevOrEngRole = /\b(?:software|developer|engineer|backend|back\s*end|full\s*stack|fullstack|frontend|sde|programmer)\b/i.test(tLower);

    const hasCore = matchedSkills.some(s => 
      ['Java', 'Angular', 'Spring Boot', 'RESTful APIs & Microservices', 'PostgreSQL & SQL'].includes(s)
    ) || isDevOrEngRole;

    return hasCore ? 90 : 50;
  }

  static evaluateLocationAndWorkMode(location = '', text = '', candidateCity = 'Hyderabad', willingToRelocate = true) {
    const locLower = `${location} ${text}`.toLowerCase();
    const cityLower = (candidateCity || 'hyderabad').toLowerCase();

    if (locLower.includes(cityLower)) return 100; // Local match
    if (locLower.includes('remote') || locLower.includes('hybrid')) return 95;
    if (locLower.includes('bengaluru') || locLower.includes('bangalore') || locLower.includes('pune') || locLower.includes('chennai')) {
      return willingToRelocate ? 85 : 55;
    }
    return 75;
  }

  static generateReasoning({
    overallFitScore,
    technicalScore,
    experienceCategory,
    experienceRange,
    matchedSkills = [],
    missingRequiredSkills = [],
    seniorityDetected,
    isRecommended,
    candidateExp = 3.0,
    isNonTech = false,
    isOverExperience = false,
    hasRelevantSkills = true
  }) {
    if (isNonTech) {
      return `Non-technical role detected. Skipped.`;
    }

    if (isOverExperience || experienceCategory === this.EXPERIENCE_CATEGORIES.BELOW_MANDATORY) {
      return `Experience requirement (${experienceRange}) substantially exceeds candidate's ~${candidateExp} years limit (4+/5+ yrs). Skipped as per experience preferences.`;
    }

    if (!hasRelevantSkills || matchedSkills.length === 0) {
      return `No matching core skills (Java, Spring Boot, Angular, Backend) detected in job description. Skipped.`;
    }

    if (isRecommended) {
      return `Skills and experience match! Found relevant keywords: ${matchedSkills.slice(0, 3).join(', ')}. Experience alignment: ${experienceRange}. Recommended for application.`;
    }

    return `Overall fit (${overallFitScore}%) is below target threshold. Missing key requirements: ${missingRequiredSkills.join(', ') || 'seniority requirements'}.`;
  }
}

module.exports = MatchingEngine;
