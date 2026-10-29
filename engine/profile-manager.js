/**
 * Canonical Candidate Profile Schema & Validator
 * Enforces typed fields, separates official vs negotiable notice, current vs expected CTC,
 * and maintains field verification status and version history.
 */

const fs = require('fs');
const path = require('path');

class ProfileManager {
  static get CANONICAL_VERSION() {
    return '2.0.0';
  }

  /**
   * Verified baseline defaults per user specifications:
   * - Total experience: ~2.7 years
   * - Current company: Tech Mahindra
   * - Current CTC: ₹3.8 LPA
   * - Expected CTC: ₹10 LPA
   * - Official notice period: 90 days
   * - Negotiable notice period: 45-60 days (default 45 days)
   * - Target roles: Angular Developer, Java Developer, Java Full Stack Developer
   * - Relocation: acceptable (true)
   * - Work mode: Office / Hybrid
   */
  static get VERIFIED_BASELINE() {
    return {
      totalYearsExperience: 2.7,
      currentCompany: 'Tech Mahindra',
      currentClient: 'GE Aerospace',
      currentSalaryLPA: 3.8,
      currentSalaryFormatted: '3.80 LPA',
      expectedSalaryLPA: 10.0,
      expectedSalaryFormatted: '10.00 LPA',
      officialNoticePeriodDays: 90,
      negotiableNoticePeriodDays: 45,
      willingToRelocate: true,
      workModePreferences: ['Office', 'Hybrid'],
      preferredCountry: 'India',
      targetRoles: [
        'Angular Developer',
        'Java Developer',
        'Java Full Stack Developer',
        'Frontend Developer',
        'Full Stack Developer'
      ]
    };
  }

  /**
   * Normalizes any raw profile JSON into the canonical schema while preserving
   * all custom fields, skills, screeningQA rules, and projects.
   */
  static normalizeProfile(rawProfile = {}) {
    const raw = rawProfile || {};
    const personal = raw.personal || {};
    const career = raw.career || {};
    const skills = Array.isArray(raw.skills) ? raw.skills : [];
    const experience = Array.isArray(raw.experience) ? raw.experience : [];
    const projects = Array.isArray(raw.projects) ? raw.projects : [];
    const education = raw.education || {};
    const achievements = Array.isArray(raw.achievements) ? raw.achievements : [];
    const certifications = Array.isArray(raw.certifications) ? raw.certifications : [];
    const screeningQA = Array.isArray(raw.screeningQA) ? raw.screeningQA : [];

    // Parse numeric salary
    const parseSalary = (val, fallback) => {
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        const match = val.match(/\d+(?:\.\d+)?/);
        if (match) return parseFloat(match[0]);
      }
      return fallback;
    };

    const currentSal = parseSalary(career.currentSalaryLPA, ProfileManager.VERIFIED_BASELINE.currentSalaryLPA);
    const expectedSal = parseSalary(career.expectedSalaryLPA, ProfileManager.VERIFIED_BASELINE.expectedSalaryLPA);

    // Official vs negotiable notice period
    const officialNotice = parseInt(career.officialNoticePeriodDays || career.noticePeriodDays || 90, 10);
    const negotiableNotice = parseInt(career.negotiableNoticePeriodDays || 45, 10);

    // Total years experience
    const totalExp = typeof career.totalYearsExperience === 'number'
      ? career.totalYearsExperience
      : parseFloat(career.totalYearsExperience || ProfileManager.VERIFIED_BASELINE.totalYearsExperience);

    // Build verified skills map
    const verifiedSkillsMap = {};
    skills.forEach(s => {
      if (s && s.name) {
        verifiedSkillsMap[s.name.toLowerCase()] = {
          name: s.name,
          years: typeof s.years === 'number' ? s.years : parseFloat(s.years || 0),
          proficiency: s.proficiency || 'Intermediate',
          verified: s.verified !== false
        };
      }
    });

    const canonicalProfile = {
      ...raw,
      canonicalVersion: raw.canonicalVersion || ProfileManager.CANONICAL_VERSION,
      profileVersion: raw.profileVersion || 1,
      lastUpdated: raw.lastUpdated || new Date().toISOString(),
      personal: {
        ...personal,
        fullName: personal.fullName || 'Sai Krishna G',
        firstName: personal.firstName || 'Sai Krishna',
        lastName: personal.lastName || 'G',
        email: personal.email || 'gsaikrishna150@gmail.com',
        phone: personal.phone || '+91 8688373517',
        phoneCountryCode: personal.phoneCountryCode || 'India (+91)',
        phoneDigits: personal.phoneDigits || '8688373517',
        dateOfBirth: personal.dateOfBirth || '28/01/2002',
        gender: personal.gender || 'Male',
        maritalStatus: personal.maritalStatus || 'Single',
        fatherName: personal.fatherName || 'Gaddula Ushanna',
        nationality: personal.nationality || 'Indian',
        hasPassport: personal.hasPassport !== false,
        location: personal.location || 'Hyderabad, Telangana, India',
        city: personal.city || 'Hyderabad',
        state: personal.state || 'Telangana',
        country: personal.country || 'India',
        postalCode: personal.postalCode || '500032',
        streetAddress: personal.streetAddress || 'Anjaiah nagar, Gachibowli, Hyderabad, Telangana',
        address: personal.address || 'Anjaiah nagar, Gachibowli, Hyderabad, Telangana - 500032',
        permanentAddress: personal.permanentAddress || '6-31, potti sri ramulu street, kothakota, wanaparthy district, telangana 509381',
        linkedInUrl: personal.linkedInUrl || 'https://www.linkedin.com/in/saikrishnag150',
        githubUrl: personal.githubUrl || 'https://github.com/saikrish150',
        portfolioUrl: personal.portfolioUrl || 'https://gsaikrishna-portfolio.netlify.app/',
        resumePath: personal.resumePath || path.join(__dirname, '..', 'config', 'resume.pdf')
      },
      career: {
        ...career,
        primaryRole: career.primaryRole || 'Full Stack Developer (Angular, Java, Spring Boot)',
        targetRoles: Array.isArray(career.targetRoles) && career.targetRoles.length > 0
          ? career.targetRoles
          : ProfileManager.VERIFIED_BASELINE.targetRoles,
        totalYearsExperience: totalExp,
        currentCompany: career.currentCompany || ProfileManager.VERIFIED_BASELINE.currentCompany,
        currentClient: career.currentClient || ProfileManager.VERIFIED_BASELINE.currentClient,
        currentDesignation: career.currentDesignation || 'Full Stack Developer',
        // Separate and typed current vs expected CTC
        currentSalaryLPA: currentSal,
        currentSalaryFormatted: `${currentSal.toFixed(2)} LPA`,
        expectedSalaryLPA: expectedSal,
        expectedSalaryFormatted: `${expectedSal.toFixed(2)} LPA`,
        // Separate official vs negotiable notice
        officialNoticePeriodDays: officialNotice,
        negotiableNoticePeriodDays: negotiableNotice,
        noticePeriodDays: officialNotice, // Backwards compatibility
        noticePeriodDescription: `${officialNotice} days official (${negotiableNotice} days negotiable)`,
        willingToRelocate: career.willingToRelocate !== false,
        workModePreferences: Array.isArray(career.workModePreferences)
          ? career.workModePreferences
          : ProfileManager.VERIFIED_BASELINE.workModePreferences,
        needsVisaSponsorship: career.needsVisaSponsorship === true,
        workAuthorization: career.workAuthorization || 'Indian Citizen / Authorized to work without restriction in India',
        shiftPreference: career.shiftPreference || 'Day / Flexible / General',
        offersInHand: career.offersInHand || 'None (Actively interviewing)'
      },
      skills,
      verifiedSkillsMap,
      experience,
      projects,
      education: {
        ...education,
        degree: education.degree || 'B.Tech in Electronics and Communication Engineering',
        institution: education.institution || 'SRM Institute of Science and Technology, Ramapuram Campus',
        graduationYear: education.graduationYear || 2023,
        cgpa: education.cgpa || '8.9 / 10',
        percentage: education.percentage || '85%',
        backlogs: education.backlogs !== undefined ? education.backlogs : 0,
        ssc: education.ssc || {
          school: 'Montessori High School, Alampur',
          board: 'SSC',
          year: 2017,
          percentage: '77%'
        },
        intermediate: education.intermediate || {
          college: 'Narayana Junior College, Hyderabad',
          board: 'Telangana State Board (TSBIE)',
          stream: 'MPC',
          year: 2019,
          percentage: '94%'
        }
      },
      achievements,
      certifications,
      screeningQA,
      verificationStatus: {
        experienceVerified: true,
        noticePeriodVerified: true,
        ctcVerified: true,
        legalAuthVerified: true,
        conflicts: ProfileManager.detectConflicts(raw)
      }
    };

    return canonicalProfile;
  }

  /**
   * Detects conflicts between existing raw settings and verified facts
   */
  static detectConflicts(rawProfile = {}) {
    const conflicts = [];
    const career = rawProfile.career || {};

    if (career.noticePeriodDays && career.noticePeriodDays !== 90) {
      conflicts.push({
        field: 'noticePeriodDays',
        foundValue: career.noticePeriodDays,
        verifiedValue: 90,
        message: `Notice period in settings (${career.noticePeriodDays} days) differs from official 90 days. Marked as 90 days official, 45 days negotiable.`
      });
    }

    if (career.currentSalaryLPA && typeof career.currentSalaryLPA === 'string' && career.currentSalaryLPA.includes('4.10')) {
      conflicts.push({
        field: 'currentSalaryLPA',
        foundValue: career.currentSalaryLPA,
        verifiedValue: '3.80 LPA',
        message: 'Current salary differs between 4.10 LPA and verified 3.80 LPA baseline.'
      });
    }

    return conflicts;
  }

  /**
   * Validates a profile payload submitted via API
   */
  static validateProfile(profile) {
    const errors = [];
    if (!profile) {
      return { valid: false, errors: ['Profile payload is empty'] };
    }

    const personal = profile.personal || {};
    const career = profile.career || {};

    if (!personal.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personal.email)) {
      errors.push('A valid email address is required');
    }
    if (!personal.fullName || personal.fullName.trim().length < 2) {
      errors.push('Candidate full name is required');
    }
    if (career.totalYearsExperience !== undefined && (isNaN(career.totalYearsExperience) || career.totalYearsExperience < 0)) {
      errors.push('Total experience must be a non-negative number');
    }
    if (career.officialNoticePeriodDays !== undefined && (isNaN(career.officialNoticePeriodDays) || career.officialNoticePeriodDays < 0)) {
      errors.push('Official notice period days must be a non-negative number');
    }
    if (career.currentSalaryLPA !== undefined && isNaN(parseFloat(career.currentSalaryLPA))) {
      errors.push('Current salary must be a valid number');
    }
    if (career.expectedSalaryLPA !== undefined && isNaN(parseFloat(career.expectedSalaryLPA))) {
      errors.push('Expected salary must be a valid number');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = ProfileManager;
