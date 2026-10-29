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
      : 2.7;

    const skills = profile.skills || [];

    // 1. Technical Match Evaluation
    const { technicalScore, matchedSkills, missingRequiredSkills, missingPreferredSkills } = 
      this.evaluateTechnicalSkills(rawText, skills);

    // 2. Experience & Seniority Compatibility
    const { experienceScore, experienceCategory, experienceRange, seniorityDetected } = 
      this.evaluateExperience(rawTitle, rawText, candidateExp);

    // 3. Role & Responsibility Alignment
    const roleScore = this.evaluateRoleAlignment(rawTitle, rawText, profile.career?.targetRoles);

    // 4. Mandatory Qualifications Assessment
    const mandatoryScore = this.evaluateMandatory(rawText, matchedSkills);

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

    // Guard against score inflation: A job requiring 6+ years when candidate has 2.7
    // cannot have overallFitScore > 65% regardless of keywords
    let overallFitScore = weightedScore;
    if (matchedSkills.length === 0) {
      overallFitScore = Math.min(overallFitScore, 45); // Penalize complete tech stack mismatch
    }
    if (experienceCategory === this.EXPERIENCE_CATEGORIES.BELOW_MANDATORY) {
      overallFitScore = Math.min(overallFitScore, 58);
    } else if (experienceCategory === this.EXPERIENCE_CATEGORIES.BELOW_PREFERRED) {
      overallFitScore = Math.min(overallFitScore, 74);
    }

    const isRecommended = overallFitScore >= minMatchScore;

    // Generate human-readable reasoning
    const reasoning = this.generateReasoning({
      overallFitScore,
      technicalScore,
      experienceCategory,
      experienceRange,
      matchedSkills,
      missingRequiredSkills,
      seniorityDetected,
      isRecommended
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

  static evaluateTechnicalSkills(text, candidateSkills = []) {
    const matchedSkills = [];
    const missingRequiredSkills = [];
    const missingPreferredSkills = [];

    // Core candidate skills map
    const candidateSkillNames = new Set(candidateSkills.map(s => s.name.toLowerCase()));

    for (const skill of candidateSkills) {
      const sName = skill.name.toLowerCase();
      // Token check
      const tokens = sName.split(/[\/\,\s\(\)\+]+/).filter(t => t.length > 2);
      const isFound = tokens.some(tok => text.includes(tok));
      if (isFound) {
        matchedSkills.push(skill.name);
      }
    }

    // Common stack requirements to check for gaps
    const requiredChecks = ['angular', 'java', 'spring', 'typescript', 'sql', 'rest'];
    const preferredChecks = ['docker', 'aws', 'kubernetes', 'kafka', 'graphql', 'ci/cd'];

    for (const req of requiredChecks) {
      if (text.includes(req) && !Array.from(candidateSkillNames).some(cs => cs.includes(req))) {
        missingRequiredSkills.push(req);
      }
    }

    for (const pref of preferredChecks) {
      if (text.includes(pref) && !Array.from(candidateSkillNames).some(cs => cs.includes(pref))) {
        missingPreferredSkills.push(pref);
      }
    }

    // Ratio of matches
    const baseMatchRatio = Math.min(matchedSkills.length / Math.max(3, (matchedSkills.length + missingRequiredSkills.length)), 1.0);
    const technicalScore = Math.max(25, Math.min(95, Math.round(baseMatchRatio * 90 + (matchedSkills.length >= 4 ? 10 : 0))));

    return {
      technicalScore,
      matchedSkills,
      missingRequiredSkills,
      missingPreferredSkills
    };
  }

  static evaluateExperience(title, text, candidateExp = 2.7) {
    // Detect seniority keywords in title
    const isSeniorTitle = /\b(?:senior|lead|principal|staff|architect|manager|director|vp|head)\b/i.test(title);
    const isJuniorTitle = /\b(?:junior|entry|trainee|associate|intern)\b/i.test(title);

    // Filter out company age / establishment text like "15 years of industry excellence", "20 years in FinTech"
    // Clean company track record text before matching candidate required experience
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
    let experienceScore = 75;

    if (minYears !== null) {
      if (candidateExp >= minYears && (!maxYears || candidateExp <= maxYears + 1.5)) {
        category = this.EXPERIENCE_CATEGORIES.MEETS_REQUIRED;
        experienceScore = 95;
      } else if (candidateExp < minYears) {
        const gap = minYears - candidateExp;
        if (gap <= 1.0) {
          category = this.EXPERIENCE_CATEGORIES.COMPATIBLE_ADJACENT;
          experienceScore = 80;
        } else if (gap <= 2.5) {
          category = this.EXPERIENCE_CATEGORIES.BELOW_PREFERRED;
          experienceScore = 50;
        } else {
          // Significant experience gap (e.g. requires 5-8+ yrs when candidate has 2.7)
          category = this.EXPERIENCE_CATEGORIES.BELOW_MANDATORY;
          experienceScore = 25;
        }
      } else {
        // Overqualified
        category = this.EXPERIENCE_CATEGORIES.COMPATIBLE_ADJACENT;
        experienceScore = 85;
      }
    } else if (isSeniorTitle) {
      category = this.EXPERIENCE_CATEGORIES.BELOW_MANDATORY;
      experienceScore = 40;
    } else if (isJuniorTitle) {
      category = this.EXPERIENCE_CATEGORIES.MEETS_REQUIRED;
      experienceScore = 90;
    }

    const rangeStr = minYears !== null
      ? `${minYears}${maxYears ? `-${maxYears}` : '+'} years`
      : (isSeniorTitle ? '5+ years (Senior inferred)' : 'Not explicitly specified');

    return {
      experienceScore,
      experienceCategory: category,
      experienceRange: rangeStr,
      seniorityDetected: isSeniorTitle ? 'Senior/Lead' : (isJuniorTitle ? 'Entry/Junior' : 'Mid-level')
    };
  }

  static evaluateRoleAlignment(title, text, targetRoles = []) {
    const tLower = title.toLowerCase();
    const devKeywords = ['angular', 'java', 'spring', 'full stack', 'fullstack', 'frontend', 'software engineer', 'software developer', 'web developer'];

    let score = 50;
    for (const kw of devKeywords) {
      if (tLower.includes(kw)) {
        score += 15;
      }
    }

    if (tLower.includes('developer') || tLower.includes('engineer')) {
      score += 10;
    }

    return Math.min(95, Math.max(30, score));
  }

  static evaluateMandatory(text, matchedSkills) {
    // If text mentions mandatory degree or 100% required keywords
    const hasCore = matchedSkills.some(s => ['Java', 'Angular', 'Spring Boot'].includes(s));
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
    matchedSkills,
    missingRequiredSkills,
    seniorityDetected,
    isRecommended
  }) {
    const matchSummary = matchedSkills.length > 0
      ? `Strong synergy with core competencies: ${matchedSkills.slice(0, 3).join(', ')}.`
      : 'General engineering skills overlap.';

    if (experienceCategory === this.EXPERIENCE_CATEGORIES.BELOW_MANDATORY) {
      return `Experience requirement (${experienceRange}) substantially exceeds candidate's ~2.7 years. Role classified as ${seniorityDetected}. Overall fit calibrated to ${overallFitScore}%.`;
    }

    if (experienceCategory === this.EXPERIENCE_CATEGORIES.BELOW_PREFERRED) {
      return `Good technical match (${technicalScore}%), but requires ${experienceRange} which is slightly above candidate's 2.7 years. Recommend manual evaluation.`;
    }

    if (isRecommended) {
      return `High compatibility (${overallFitScore}%)! ${matchSummary} Experience alignment: ${experienceRange}.`;
    }

    return `Overall fit (${overallFitScore}%) is below target threshold. Missing key requirements: ${missingRequiredSkills.join(', ') || 'seniority requirements'}.`;
  }
}

module.exports = MatchingEngine;
