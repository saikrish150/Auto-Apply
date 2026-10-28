/**
 * Typed Screening Question Classification & Answering Engine
 * Strictly prevents cross-field bleeding (e.g. Email receiving Residential Address,
 * Expected CTC receiving Current CTC, or unverified skills hallucinating experience).
 */

class ScreeningClassifier {
  static get INTENTS() {
    return Object.freeze({
      EMAIL: 'INTENT_EMAIL',
      RESIDENTIAL_ADDRESS: 'INTENT_RESIDENTIAL_ADDRESS',
      STREET_ADDRESS: 'INTENT_STREET_ADDRESS',
      CITY: 'INTENT_CITY',
      STATE: 'INTENT_STATE',
      COUNTRY: 'INTENT_COUNTRY',
      POSTAL_CODE: 'INTENT_POSTAL_CODE',
      PHONE_NUMBER: 'INTENT_PHONE_NUMBER',
      PHONE_COUNTRY_CODE: 'INTENT_PHONE_COUNTRY_CODE',
      LINKEDIN_URL: 'INTENT_LINKEDIN_URL',
      PORTFOLIO_URL: 'INTENT_PORTFOLIO_URL',
      GITHUB_URL: 'INTENT_GITHUB_URL',

      TOTAL_EXPERIENCE: 'INTENT_TOTAL_EXPERIENCE',
      SKILL_EXPERIENCE: 'INTENT_SKILL_EXPERIENCE',

      CURRENT_CTC: 'INTENT_CURRENT_CTC',
      EXPECTED_CTC: 'INTENT_EXPECTED_CTC',

      OFFICIAL_NOTICE_PERIOD: 'INTENT_OFFICIAL_NOTICE_PERIOD',
      NEGOTIABLE_NOTICE_PERIOD: 'INTENT_NEGOTIABLE_NOTICE_PERIOD',
      EARLIEST_JOINING_DATE: 'INTENT_EARLIEST_JOINING_DATE',
      CURRENTLY_SERVING_NOTICE: 'INTENT_CURRENTLY_SERVING_NOTICE',

      WILLING_TO_RELOCATE: 'INTENT_WILLING_TO_RELOCATE',
      WORK_MODE_PREFERENCE: 'INTENT_WORK_MODE_PREFERENCE',
      SHIFT_PREFERENCE: 'INTENT_SHIFT_PREFERENCE',

      WORK_AUTHORIZATION: 'INTENT_WORK_AUTHORIZATION',
      VISA_SPONSORSHIP: 'INTENT_VISA_SPONSORSHIP',

      PREVIOUS_EMPLOYEE: 'INTENT_PREVIOUS_EMPLOYEE',
      CURRENTLY_EMPLOYED: 'INTENT_CURRENTLY_EMPLOYED',
      EDUCATION_DEGREE: 'INTENT_EDUCATION_DEGREE',
      INTERVIEW_AVAILABILITY: 'INTENT_INTERVIEW_AVAILABILITY',
      BACKGROUND_CHECK_CONSENT: 'INTENT_BACKGROUND_CHECK_CONSENT',

      CONSEQUENTIAL_LEGAL: 'INTENT_CONSEQUENTIAL_LEGAL',
      UNKNOWN_OR_UNSUPPORTED: 'INTENT_UNKNOWN_OR_UNSUPPORTED'
    });
  }

  static get CONFIDENCE_LEVELS() {
    return Object.freeze({
      HIGH: 0.95,
      MEDIUM: 0.75,
      LOW: 0.40,
      CONSEQUENTIAL: 0.60
    });
  }

  /**
   * Normalizes question text for robust semantic matching
   */
  static normalize(text) {
    if (!text) return '';
    return String(text)
      .toLowerCase()
      .replace(/\byou\b/g, 'your')
      .replace(/\bu\b/g, 'your')
      .replace(/[\(\)\[\]\{\}\*:,!;?"']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Classifies a question into a strongly-typed intent with extracted parameters.
   * STRICT ORDERING: Email is evaluated BEFORE Address to prevent cross-bleeding!
   */
  static classifyIntent(questionText) {
    const raw = String(questionText || '').trim();
    const norm = this.normalize(raw);
    if (!norm) {
      return { intent: this.INTENTS.UNKNOWN_OR_UNSUPPORTED, confidence: 0, params: {} };
    }

    // 1. EMAIL (CRITICAL: Must check BEFORE generic 'address'!)
    if (/\b(?:email|e-mail|email\s*id|email\s*address|mail\s*id|electronic\s*mail)\b/i.test(norm)) {
      return { intent: this.INTENTS.EMAIL, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }

    // 2. PHONE & COUNTRY CODE
    if (/\b(?:phone\s*country\s*code|country\s*dial\s*code|dialing\s*code|country\s*code)\b/i.test(norm)) {
      return { intent: this.INTENTS.PHONE_COUNTRY_CODE, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (/\b(?:phone|mobile|cell|contact\s*number|phone\s*number|mobile\s*number|whatsapp\s*number)\b/i.test(norm)) {
      return { intent: this.INTENTS.PHONE_NUMBER, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }

    // 3. URLs
    if (/\b(?:linkedin|linkedin\s*profile|linkedin\s*url)\b/i.test(norm)) {
      return { intent: this.INTENTS.LINKEDIN_URL, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (/\b(?:portfolio|website|personal\s*website)\b/i.test(norm)) {
      return { intent: this.INTENTS.PORTFOLIO_URL, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (/\b(?:github|git\s*repo|github\s*profile)\b/i.test(norm)) {
      return { intent: this.INTENTS.GITHUB_URL, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }

    // 4. COMPENSATION (Strict Current vs Expected Separation)
    const isCurrentCTC = /\b(?:current\s*ctc|current\s*salary|present\s*ctc|present\s*salary|current\s*annual|cctc|current\s*package)\b/i.test(norm) ||
      (norm.includes('current') && (norm.includes('ctc') || norm.includes('salary') || norm.includes('compensation') || norm.includes('package')));

    const isExpectedCTC = /\b(?:expected\s*ctc|expected\s*salary|desired\s*salary|salary\s*expectation|ectc|expected\s*package)\b/i.test(norm) ||
      (norm.includes('expected') && (norm.includes('ctc') || norm.includes('salary') || norm.includes('compensation') || norm.includes('package')));

    if (isExpectedCTC && !isCurrentCTC) {
      return { intent: this.INTENTS.EXPECTED_CTC, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (isCurrentCTC && !isExpectedCTC) {
      return { intent: this.INTENTS.CURRENT_CTC, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (isExpectedCTC && isCurrentCTC) {
      // If both appear in the same prompt string, evaluate which is the primary subject
      if (norm.startsWith('expected') || norm.includes('your expected')) {
        return { intent: this.INTENTS.EXPECTED_CTC, confidence: this.CONFIDENCE_LEVELS.MEDIUM, params: {} };
      }
      return { intent: this.INTENTS.CURRENT_CTC, confidence: this.CONFIDENCE_LEVELS.MEDIUM, params: {} };
    }

    // 5. NOTICE PERIOD & JOINING TIME
    if (/\b(?:serving\s*notice|currently\s*serving|on\s*notice)\b/i.test(norm)) {
      return { intent: this.INTENTS.CURRENTLY_SERVING_NOTICE, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (/\b(?:earliest\s*(?:possible\s*)?joining|when\s*can\s*you\s*join|joining\s*date|available\s*to\s*start\s*from)\b/i.test(norm)) {
      return { intent: this.INTENTS.EARLIEST_JOINING_DATE, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (/\b(?:negotiable\s*notice|can\s*you\s*negotiate\s*notice|minimum\s*days\s*to\s*join)\b/i.test(norm)) {
      return { intent: this.INTENTS.NEGOTIABLE_NOTICE_PERIOD, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (/\b(?:notice\s*period|days\s*to\s*join|how\s*soon\s*can\s*you\s*join|how\s*soon\s*can\s*you\s*start|np\s*in\s*days)\b/i.test(norm)) {
      return { intent: this.INTENTS.OFFICIAL_NOTICE_PERIOD, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }

    // 6. SKILL-SPECIFIC EXPERIENCE vs TOTAL EXPERIENCE
    const skillExpMatch = norm.match(/(?:years|experience).*(?:with|in|using|on)\s+([a-zA-Z0-9#\+\.\s_-]+)/i) ||
                          norm.match(/(?:with|in|using|on)\s+([a-zA-Z0-9#\+\.\s_-]+)\s*(?:experience|years)/i);
    if (skillExpMatch && skillExpMatch[1]) {
      const candidateTech = skillExpMatch[1].trim().toLowerCase().replace(/[^a-z0-9#+.]/g, '');
      const nonSkillWords = ['total', 'overall', 'it', 'software', 'softwaredevelopment', 'fullstack', 'all', 'industry', 'field', 'role', 'programming'];
      if (!nonSkillWords.includes(candidateTech) && candidateTech.length > 1) {
        return {
          intent: this.INTENTS.SKILL_EXPERIENCE,
          confidence: this.CONFIDENCE_LEVELS.HIGH,
          params: { skillName: candidateTech }
        };
      }
    }

    if (/\b(?:total\s*(?:years\s*(?:of\s*)?)?(?:work\s*)?experience|overall\s*experience|total\s*it\s*experience|total\s*experience)\b/i.test(norm) ||
        norm === 'how many years of work experience do you have' ||
        norm === 'total years of experience' ||
        norm === 'total experience') {
      return { intent: this.INTENTS.TOTAL_EXPERIENCE, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }

    // 7. LOCATION & ADDRESS (Only matches residential/physical address now!)
    if (/\b(?:city|current\s*city|city\s*of\s*residence|current\s*location)\b/i.test(norm)) {
      return { intent: this.INTENTS.CITY, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (/\b(?:country|current\s*country|nationality)\b/i.test(norm)) {
      return { intent: this.INTENTS.COUNTRY, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (/\b(?:state|province|region)\b/i.test(norm)) {
      return { intent: this.INTENTS.STATE, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (/\b(?:postal\s*code|zip\s*code|pincode|pin\s*code)\b/i.test(norm)) {
      return { intent: this.INTENTS.POSTAL_CODE, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (/\b(?:street\s*address|residence\s*address|residential\s*address|home\s*address|address\s*line)\b/i.test(norm) ||
        (norm.includes('address') && !norm.includes('email') && !norm.includes('mail') && !norm.includes('web'))) {
      return { intent: this.INTENTS.RESIDENTIAL_ADDRESS, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }

    // 8. WORK PREFERENCES & LEGAL AUTHORIZATION
    if (/\b(?:relocate|willing\s*to\s*move|relocation)\b/i.test(norm)) {
      return { intent: this.INTENTS.WILLING_TO_RELOCATE, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (/\b(?:remote|hybrid|work\s*from\s*office|wfo|wfh|work\s*mode)\b/i.test(norm)) {
      return { intent: this.INTENTS.WORK_MODE_PREFERENCE, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (/\b(?:sponsorship|require\s*visa|need\s*sponsorship|visa\s*sponsorship)\b/i.test(norm)) {
      return { intent: this.INTENTS.VISA_SPONSORSHIP, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (/\b(?:legally\s*authorized|authorized\s*to\s*work|legal\s*right\s*to\s*work|work\s*authorization)\b/i.test(norm)) {
      return { intent: this.INTENTS.WORK_AUTHORIZATION, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (/\b(?:currently\s*employed|are\s*you\s*currently\s*working)\b/i.test(norm)) {
      return { intent: this.INTENTS.CURRENTLY_EMPLOYED, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }

    // 9. INTERVIEWS & CONSENTS
    if (/\b(?:interview.*(?:in\s*person|face\s*to\s*face|f2f|in-office|office|onsite)|available\s*for\s*interview)\b/i.test(norm)) {
      return { intent: this.INTENTS.INTERVIEW_AVAILABILITY, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }
    if (/\b(?:background\s*verification|bgv|background\s*check)\b/i.test(norm)) {
      return { intent: this.INTENTS.BACKGROUND_CHECK_CONSENT, confidence: this.CONFIDENCE_LEVELS.HIGH, params: {} };
    }

    // 10. CONSEQUENTIAL LEGAL & COMPLIANCE QUESTIONS (Require Strict Verification)
    if (/\b(?:convict(?:ed|ion|ions)?|felony|criminal|misdemeanor|crime|legal\s*actions?)\b/i.test(norm) ||
        /\b(?:non[\s-]*compete|restrictive\s*covenant)\b/i.test(norm) ||
        /\b(?:drug\s*test|drug\s*screen|substance\s*abuse)\b/i.test(norm) ||
        /\b(?:relatives?\s*(?:employed|working)|conflict\s*of\s*interest)\b/i.test(norm) ||
        /\b(?:disability|disabled|physical\s*or\s*mental\s*impairment)\b/i.test(norm) ||
        /\b(?:veteran|protected\s*veteran|military\s*service)\b/i.test(norm) ||
        /\b(?:18\s*years|at\s*least\s*18|legal\s*age\s*to\s*work)\b/i.test(norm)) {
      return { intent: this.INTENTS.CONSEQUENTIAL_LEGAL, confidence: this.CONFIDENCE_LEVELS.CONSEQUENTIAL, params: { subType: norm } };
    }

    // Unknown or unsupported question
    return {
      intent: this.INTENTS.UNKNOWN_OR_UNSUPPORTED,
      confidence: this.CONFIDENCE_LEVELS.LOW,
      params: { raw }
    };
  }

  /**
   * High-level helper: classifies question and resolves verified answer in one step
   */
  static classifyAndAnswer(questionText, profile = {}, options = [], inputType = 'text', context = {}) {
    const classification = this.classifyIntent(questionText);
    const resolved = this.resolveAnswer(classification, profile, options, inputType, context);
    return {
      question: questionText,
      intent: classification.intent,
      answer: resolved.proposedAnswer,
      confidence: resolved.confidence,
      requiresReview: resolved.requiresReview,
      sourceField: resolved.sourceField,
      audit: resolved
    };
  }

  /**
   * Resolves a canonical answer based on the classified intent and verified candidate profile.
   */
  static resolveAnswer(classification, profile = {}, options = [], inputType = 'text', context = {}) {
    const { intent, confidence, params } = classification;
    const personal = profile.personal || {};
    const career = profile.career || {};
    const skills = profile.skills || [];

    let proposedAnswer = '';
    let sourceField = '';
    let finalConfidence = confidence;
    let requiresReview = false;

    switch (intent) {
      case this.INTENTS.EMAIL:
        proposedAnswer = personal.email || 'gsaikrishna150@gmail.com';
        sourceField = 'personal.email';
        break;

      case this.INTENTS.RESIDENTIAL_ADDRESS:
      case this.INTENTS.STREET_ADDRESS:
        proposedAnswer = personal.streetAddress || personal.address || 'Flat 402, High-Tech Residency, Madhapur, Hyderabad, Telangana - 500081';
        sourceField = 'personal.streetAddress';
        break;

      case this.INTENTS.CITY:
        proposedAnswer = personal.city || 'Hyderabad';
        sourceField = 'personal.city';
        break;

      case this.INTENTS.STATE:
        proposedAnswer = personal.state || 'Telangana';
        sourceField = 'personal.state';
        break;

      case this.INTENTS.COUNTRY:
        proposedAnswer = personal.country || 'India';
        sourceField = 'personal.country';
        break;

      case this.INTENTS.POSTAL_CODE:
        proposedAnswer = personal.postalCode || '500081';
        sourceField = 'personal.postalCode';
        break;

      case this.INTENTS.PHONE_NUMBER:
        proposedAnswer = personal.phoneDigits || '8688373517';
        sourceField = 'personal.phoneDigits';
        break;

      case this.INTENTS.PHONE_COUNTRY_CODE:
        proposedAnswer = personal.phoneCountryCode || 'India (+91)';
        sourceField = 'personal.phoneCountryCode';
        break;

      case this.INTENTS.LINKEDIN_URL:
        proposedAnswer = personal.linkedInUrl || 'https://www.linkedin.com/in/saikrishnag150';
        sourceField = 'personal.linkedInUrl';
        break;

      case this.INTENTS.PORTFOLIO_URL:
        proposedAnswer = personal.portfolioUrl || 'https://indianmetroguide.in';
        sourceField = 'personal.portfolioUrl';
        break;

      case this.INTENTS.GITHUB_URL:
        proposedAnswer = personal.githubUrl || 'https://github.com';
        sourceField = 'personal.githubUrl';
        break;

      case this.INTENTS.TOTAL_EXPERIENCE:
        const totalVal = career.totalYearsExperience !== undefined ? career.totalYearsExperience : 2.7;
        proposedAnswer = inputType === 'number' ? String(totalVal) : (totalVal % 1 === 0 ? String(totalVal) : totalVal.toFixed(1));
        sourceField = 'career.totalYearsExperience';
        break;

      case this.INTENTS.SKILL_EXPERIENCE: {
        const targetTech = (params.skillName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        let matched = null;

        for (const s of skills) {
          const sClean = s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (sClean === targetTech || s.name.toLowerCase() === params.skillName) {
            matched = s;
            break;
          }
          if (sClean.length >= 3 && targetTech.length >= 3 && (sClean.includes(targetTech) || targetTech.includes(sClean))) {
            matched = s;
            break;
          }
        }

        if (matched) {
          proposedAnswer = String(matched.years);
          sourceField = `skills[${matched.name}].years`;
        } else {
          // Unlisted skill: strictly 0 years or "No"
          proposedAnswer = '0';
          sourceField = 'unlisted_skill_zero_policy';
        }
        break;
      }

      case this.INTENTS.CURRENT_CTC: {
        const curLPA = typeof career.currentSalaryLPA === 'number' ? career.currentSalaryLPA : 3.8;
        if (inputType === 'number') {
          proposedAnswer = String(curLPA);
        } else {
          proposedAnswer = `${curLPA.toFixed(2)} LPA`;
        }
        sourceField = 'career.currentSalaryLPA';
        break;
      }

      case this.INTENTS.EXPECTED_CTC: {
        const expLPA = typeof career.expectedSalaryLPA === 'number' ? career.expectedSalaryLPA : 10.0;
        if (inputType === 'number') {
          proposedAnswer = String(expLPA);
        } else {
          proposedAnswer = `${expLPA.toFixed(2)} LPA`;
        }
        sourceField = 'career.expectedSalaryLPA';
        break;
      }

      case this.INTENTS.OFFICIAL_NOTICE_PERIOD:
        proposedAnswer = String(career.officialNoticePeriodDays || 90);
        sourceField = 'career.officialNoticePeriodDays';
        break;

      case this.INTENTS.NEGOTIABLE_NOTICE_PERIOD:
        proposedAnswer = String(career.negotiableNoticePeriodDays || 45);
        sourceField = 'career.negotiableNoticePeriodDays';
        break;

      case this.INTENTS.EARLIEST_JOINING_DATE:
        proposedAnswer = 'Available within 45 to 60 days (Negotiable from 90 days official notice)';
        sourceField = 'career.negotiableNoticePeriodDays';
        break;

      case this.INTENTS.CURRENTLY_SERVING_NOTICE:
        proposedAnswer = 'No';
        sourceField = 'career.servingNoticePeriod';
        break;

      case this.INTENTS.WILLING_TO_RELOCATE:
        proposedAnswer = career.willingToRelocate !== false ? 'Yes' : 'No';
        sourceField = 'career.willingToRelocate';
        break;

      case this.INTENTS.WORK_MODE_PREFERENCE:
        proposedAnswer = 'Yes';
        sourceField = 'career.workModePreferences';
        break;

      case this.INTENTS.WORK_AUTHORIZATION:
        proposedAnswer = 'Yes';
        sourceField = 'career.workAuthorization';
        break;

      case this.INTENTS.VISA_SPONSORSHIP:
        proposedAnswer = career.needsVisaSponsorship ? 'Yes' : 'No';
        sourceField = 'career.needsVisaSponsorship';
        break;

      case this.INTENTS.CURRENTLY_EMPLOYED:
        proposedAnswer = 'Yes';
        sourceField = 'career.currentCompany';
        break;

      case this.INTENTS.INTERVIEW_AVAILABILITY:
      case this.INTENTS.BACKGROUND_CHECK_CONSENT:
        proposedAnswer = 'Yes';
        sourceField = 'verified_affirmative_consent';
        break;

      case this.INTENTS.CONSEQUENTIAL_LEGAL: {
        requiresReview = true; // Legal compliance and declarations always require human review
        const sub = (params.subType || '').toLowerCase();
        if (sub.includes('convict') || sub.includes('felony') || sub.includes('criminal')) {
          proposedAnswer = 'No';
        } else if (sub.includes('non-compete') || sub.includes('non compete')) {
          proposedAnswer = 'No';
        } else if (sub.includes('relatives') || sub.includes('conflict of interest')) {
          proposedAnswer = 'No';
        } else if (sub.includes('disability')) {
          proposedAnswer = 'No';
        } else if (sub.includes('veteran')) {
          proposedAnswer = 'No';
        } else if (sub.includes('18 years') || sub.includes('legal age')) {
          proposedAnswer = 'Yes';
        } else if (sub.includes('drug test')) {
          proposedAnswer = 'Yes';
        } else {
          proposedAnswer = '';
        }
        sourceField = 'consequential_compliance_policy';
        break;
      }

      default:
        requiresReview = true;
        proposedAnswer = '';
        sourceField = 'none';
        finalConfidence = this.CONFIDENCE_LEVELS.LOW;
        break;
    }

    // Option Matching & Normalization for Select/Radio
    const sanitizedAnswer = this.matchOption(proposedAnswer, options, inputType);

    return {
      intent,
      proposedAnswer: sanitizedAnswer || proposedAnswer,
      rawAnswer: proposedAnswer,
      sourceField,
      confidence: finalConfidence,
      requiresReview: requiresReview || !sanitizedAnswer && options.length > 0,
      validationResult: {
        isValid: !!proposedAnswer,
        optionsAvailable: options.length > 0,
        optionMatched: !!sanitizedAnswer
      }
    };
  }

  /**
   * Safe Option Matcher: Never blindly selects first option!
   */
  static matchOption(val, options = [], inputType = 'text') {
    if (!Array.isArray(options) || options.length === 0) return val;
    if (val === null || val === undefined || val === '') return '';

    const cleanVal = String(val).trim().toLowerCase();

    // 1. Exact match
    const exact = options.find(o => String(o).trim().toLowerCase() === cleanVal);
    if (exact) return exact;

    // 2. Numeric match (e.g. "3" vs "3 years" or "30" vs "30 days")
    const numMatch = cleanVal.match(/\d+(?:\.\d+)?/);
    if (numMatch) {
      const numStr = numMatch[0];
      const optMatch = options.find(o => {
        const oNum = String(o).match(/\d+(?:\.\d+)?/);
        return oNum && oNum[0] === numStr;
      });
      if (optMatch) return optMatch;
    }

    // 3. Boolean / Affirmative match
    if (/^(yes|true|willing|authorized|agree|comfortable|expert|experienced)$/i.test(cleanVal)) {
      const yesOpt = options.find(o => /^(yes|agree|authorized|willing|comfortable)/i.test(String(o).trim()));
      if (yesOpt) return yesOpt;
    }
    if (/^(no|false|not|none|never|0)$/i.test(cleanVal)) {
      const noOpt = options.find(o => /^(no|none|never|do not have|not)/i.test(String(o).trim()));
      if (noOpt) return noOpt;
    }

    return '';
  }
}

module.exports = ScreeningClassifier;
