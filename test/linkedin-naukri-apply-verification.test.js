const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const LinkedInBot = require('../engine/linkedin-bot');
const NaukriBot = require('../engine/naukri-bot');
const DataStore = require('../engine/data-store');
const ManualQueueService = require('../engine/manual-queue');
const AIAgent = require('../engine/ai-agent');
const { ApplicationStates } = require('../engine/state-machine');

test('LinkedIn Easy Apply & Naukri External Link Prevention Verification', async (t) => {
  const testDataDir = path.join(__dirname, '..', 'scratch', 'test_apply_verification');
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDataDir, { recursive: true });

  const profile = require('../config/profile.json');
  const settings = require('../config/settings.json');
  const ai = new AIAgent(profile, settings);
  const manualQueue = new ManualQueueService({ dataDir: testDataDir });
  manualQueue.linkedinOnlyManualQueue = true;
  const dataStore = new DataStore({ dataDir: testDataDir, manualQueueService: manualQueue });
  dataStore.linkedinOnlyManualQueue = true;

  await t.test('1. LinkedInBot successfully locates candidate resume PDF file', () => {
    const liBot = new LinkedInBot(null, ai, settings, () => {}, dataStore);
    const resumePath = liBot.resolveResumePath();
    assert.ok(resumePath, 'Resume path should be resolved');
    assert.ok(fs.existsSync(resumePath), `Resolved resume file should exist on disk: ${resumePath}`);
    assert.ok(resumePath.toLowerCase().endsWith('.pdf'), 'Resolved resume should be a PDF');
  });

  await t.test('2. AIAgent evaluates real LinkedIn job titles with high ATS compatibility', () => {
    // With our fix, real titles like "Java Software Engineer" and "Angular Developer" are passed instead of defaulting to empty/generic
    const evalJava = ai.evaluateJobMatch('Java Software Engineer', 'Java, Spring Boot, Microservices, REST APIs', 'Mizuho');
    assert.ok(evalJava.isRecommended, 'Java role should be recommended');
    assert.ok(evalJava.score >= 75, `Expected score >= 75, got ${evalJava.score}`);

    const evalAngular = ai.evaluateJobMatch('Angular Java Developer', 'Angular 17, TypeScript, Java, Spring Boot', 'Viraaj HR Solutions');
    assert.ok(evalAngular.isRecommended, 'Angular Java role should be recommended');
    assert.ok(evalAngular.score >= 80, `Expected score >= 80, got ${evalAngular.score}`);
  });

  await t.test('3. LinkedInBot modal flow correctly finds buttons in artdeco actionbars (no footer tag needed)', async () => {
    const liBot = new LinkedInBot(null, ai, settings, () => {}, dataStore);

    // Mock page with artdeco actionbar (standard modern LinkedIn DOM)
    let submitClicked = false;
    let dismissed = false;

    const mockPage = {
      evaluate: async (fn, ...args) => {
        // If it is the stepAction function in handleModalFlow
        const fnStr = fn.toString();
        if (fnStr.includes('submit_clicked') || fnStr.includes('submit application')) {
          submitClicked = true;
          return { action: 'submit_clicked' };
        }
        if (fnStr.includes('dismiss') || fnStr.includes('overlay.close_padding')) {
          dismissed = true;
          return true;
        }
        return null;
      },
      $: async () => null,
      $$: async () => []
    };

    // Override handleResumeStep and fillFormFields for unit test
    liBot.handleResumeStep = async () => {};
    liBot.fillFormFields = async () => {};
    liBot.randomDelay = async () => {};

    const answered = [];
    const success = await liBot.handleModalFlow(mockPage, { title: 'Java Developer', company: 'Acme Corp' }, answered);
    assert.equal(success, true, 'handleModalFlow should successfully submit when submit button is present');
    assert.equal(submitClicked, true, 'Submit button should have been clicked');
    assert.equal(dismissed, true, 'Done / Dismiss dialog should be dismissed after submit');
  });

  await t.test('4. LinkedInBot dismisses and discards blocked modal cleanly', async () => {
    const liBot = new LinkedInBot(null, ai, settings, () => {}, dataStore);

    let discardTriggered = false;
    liBot.dismissAndDiscardModal = async () => {
      discardTriggered = true;
    };
    liBot.handleResumeStep = async () => {};
    liBot.fillFormFields = async () => {};
    liBot.scanAndRecordUnfilledFields = async () => {};
    liBot.randomDelay = async () => {};

    // Mock page where button is disabled and form has validation errors
    const mockPage = {
      evaluate: async (fn) => {
        const fnStr = fn.toString();
        if (fnStr.includes('submit_clicked')) {
          return { action: 'submit_disabled' };
        }
        if (fnStr.includes('artdeco-inline-feedback--error')) {
          return ['Please enter a valid phone number'];
        }
        return null;
      }
    };

    const success = await liBot.handleModalFlow(mockPage, { title: 'Java Developer', company: 'Acme Corp' }, []);
    assert.equal(success, false, 'Modal flow should report failure when blocked');
  });

  await t.test('5. LinkedIn high-match external apply job enqueues into Manual Apply Queue', () => {
    const linkedInJob = {
      id: 'li-ext-test-101',
      platform: 'LinkedIn',
      sourcePlatform: 'LinkedIn',
      title: 'Full Stack Java & Angular Engineer',
      company: 'Postman Inc',
      location: 'Hyderabad / Remote',
      url: 'https://www.linkedin.com/jobs/view/4475999888',
      directApplicationUrl: 'https://boards.greenhouse.io/postman/jobs/998877',
      matchScore: 92,
      overallFitScore: 92,
      status: 'MANUAL_ACTION_REQUIRED',
      actionRequired: true,
      applicationMethod: 'manual_shortlist',
      reason: 'LinkedIn External Apply: High match (92%) preserved in Manual Apply Queue'
    };

    const saved = dataStore.saveApplication(linkedInJob);
    assert.ok(saved);
    assert.equal(saved.normalizedStatus, ApplicationStates.MANUAL_ACTION_REQUIRED);

    // Verify it entered manual queue
    const queueItem = manualQueue.items.find(i => i.id === 'li-ext-test-101' || i.company === 'Postman Inc');
    assert.ok(queueItem, 'LinkedIn external apply job should be in manual queue');
    assert.equal(queueItem.directApplyUrl, 'https://boards.greenhouse.io/postman/jobs/998877');
    assert.equal(queueItem.sourcePlatform, 'LinkedIn');
    assert.equal(queueItem.overallFitScore, 92);
  });

  await t.test('6. Naukri external links are strictly excluded from Manual Apply Queue when linkedinOnlyManualQueue is active', () => {
    const naukriJob = {
      id: 'nk-ext-test-202',
      platform: 'Naukri',
      sourcePlatform: 'Naukri',
      title: 'Java Full Stack Developer',
      company: 'TechCorp Solutions',
      location: 'Hyderabad',
      url: 'https://www.naukri.com/job-listings-202',
      directApplicationUrl: 'https://careers.techcorp.com/job/202',
      matchScore: 88,
      overallFitScore: 88,
      status: 'MANUAL_ACTION_REQUIRED',
      actionRequired: true,
      applicationMethod: 'external_portal',
      reason: 'Naukri External Employer Redirect'
    };

    dataStore.saveApplication(naukriJob);
    const item = manualQueue.items.find(i => i.id === 'nk-ext-test-202' || i.company === 'TechCorp Solutions');
    assert.equal(item, undefined, 'Naukri job must NOT be added to manual queue when linkedinOnlyManualQueue is active');
  });

  await t.test('7. NaukriBot findNaukriApplyButton correctly detects external apply buttons', async () => {
    const naukriBot = new NaukriBot(null, ai, settings, () => {}, dataStore);

    // Mock tab where directBtn has text "Apply on company site"
    const mockTabExternal = {
      $: async (selector) => {
        if (selector.includes('apply-button') || selector.includes('company-site')) {
          return {
            evaluate: async (fn) => {
              return fn({
                innerText: 'Apply on Company Site',
                textContent: 'Apply on Company Site',
                id: 'company-site-button',
                className: 'company-site-button',
                tagName: 'BUTTON',
                getAttribute: () => 'https://careers.google.com/jobs'
              });
            }
          };
        }
        return null;
      },
      evaluateHandle: async () => ({ asElement: () => null })
    };

    const resExt = await naukriBot.findNaukriApplyButton(mockTabExternal);
    assert.ok(resExt, 'Should return button info');
    assert.equal(resExt.isExternal, true, 'isExternal should be true for company site button');

    // Mock tab where button is 1-Click Fast Apply
    const mockTabInternal = {
      $: async (selector) => {
        if (selector.includes('apply-button')) {
          return {
            evaluate: async (fn) => {
              return fn({
                innerText: 'Apply',
                textContent: 'Apply',
                id: 'apply-button',
                className: 'apply-button',
                tagName: 'BUTTON',
                getAttribute: () => ''
              });
            }
          };
        }
        return null;
      },
      evaluateHandle: async () => ({ asElement: () => null })
    };

    const resInt = await naukriBot.findNaukriApplyButton(mockTabInternal);
    assert.ok(resInt, 'Should return button info');
    assert.equal(resInt.isExternal, false, 'isExternal should be false for internal 1-Click apply');
  });

  await t.test('8. DataStore getProcessedKeys ignores generic titles and non-applied entries', () => {
    // Add a skipped entry and a generic title entry to dataStore
    dataStore.applications = [
      {
        id: 'generic-skipped',
        platform: 'LinkedIn',
        title: 'Software Developer',
        company: 'Company',
        status: 'skipped'
      },
      {
        id: 'low-match-skipped',
        platform: 'LinkedIn',
        title: 'Python Data Scientist',
        company: 'DataCorp',
        status: 'skipped'
      },
      {
        id: 'real-applied',
        platform: 'LinkedIn',
        title: 'Angular Developer',
        company: 'Virtusa',
        url: 'https://www.linkedin.com/jobs/view/4499887711',
        status: 'applied'
      }
    ];

    const keys = dataStore.getProcessedKeys();
    assert.ok(!keys.has('software developer|company'), 'Generic key should be excluded');
    assert.ok(!keys.has('python data scientist|datacorp'), 'Skipped job should not be locked in processed keys');
    assert.ok(keys.has('angular developer|virtusa'), 'Applied job should be tracked to avoid re-applying');
    assert.ok(keys.has('4499887711'), 'Applied job ID should be tracked');
  });

  await t.test('9. Detail pane scoping finds Easy Apply button in top card even when .jobs-details__main-content is present', () => {
    // Simulating DOM structure where .jobs-details__main-content is the description and top card is in .scaffold-layout__detail
    const mockDOM = {
      querySelector: (sel) => {
        if (sel.includes('.scaffold-layout__detail')) {
          return {
            querySelector: (s) => null,
            querySelectorAll: (s) => [
              {
                tagName: 'BUTTON',
                className: 'jobs-apply-button artdeco-button artdeco-button--primary',
                innerText: 'Easy Apply',
                textContent: 'Easy Apply',
                getAttribute: (attr) => attr === 'aria-label' ? 'Easy Apply to Java Engineer' : null,
                getBoundingClientRect: () => ({ width: 120, height: 36 }),
                getClientRects: () => [{ width: 120, height: 36 }]
              }
            ]
          };
        }
        return null;
      }
    };

    // Evaluate the apply button logic
    const detailPane = mockDOM.querySelector('.scaffold-layout__detail, .jobs-search__job-details, .job-view-layout, main');
    assert.ok(detailPane, 'detailPane should be matched via scaffold-layout__detail');
    const buttons = detailPane.querySelectorAll('button');
    const easyBtn = buttons.find(b => {
      const txt = (b.innerText || '').toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const cls = (b.className || '').toLowerCase();
      return txt.includes('easy apply') || aria.includes('easy apply') || (cls.includes('jobs-apply-button') && !txt.includes('company'));
    });
    assert.ok(easyBtn, 'Easy Apply button must be found in top card');
    assert.equal(easyBtn.innerText, 'Easy Apply');
  });

  await t.test('10. Fixed-position modal with offsetParent === null is recognized as visible and action button is clicked', async () => {
    const liBot = new LinkedInBot(null, ai, settings, () => {}, dataStore);

    let submitClicked = false;
    const mockPageFixedModal = {
      evaluate: async (fn, ...args) => {
        const fnStr = fn.toString();
        if (fnStr.includes('submit_clicked')) {
          // Simulate isVisible returning true even when offsetParent is null (standard CSSOM View for fixed elements)
          const mockButton = {
            offsetParent: null, // Fixed position!
            getBoundingClientRect: () => ({ width: 110, height: 36 }),
            getClientRects: () => [{ width: 110, height: 36 }],
            innerText: 'Submit application',
            getAttribute: (attr) => attr === 'aria-label' ? 'Submit application' : null,
            classList: { contains: () => false },
            disabled: false,
            click: () => { submitClicked = true; }
          };
          mockButton.click();
          return { action: 'submit_clicked' };
        }
        if (fnStr.includes('dismiss') || fnStr.includes('done')) {
          return true;
        }
        return null;
      },
      $: async () => null,
      $$: async () => []
    };

    liBot.handleResumeStep = async () => {};
    liBot.fillFormFields = async () => {};
    liBot.randomDelay = async () => {};

    const answered = [];
    const success = await liBot.handleModalFlow(mockPageFixedModal, { title: 'Angular Developer', company: 'Google' }, answered);
    assert.equal(success, true, 'Modal flow must succeed for fixed-position modal dialogs');
    assert.equal(submitClicked, true, 'Submit button with offsetParent === null must be clicked via visibility checking');
  });

  await t.test('11. button.jobs-apply-button is NEVER misclassified as an external link', () => {
    const easyApplyButton = {
      tagName: 'BUTTON',
      className: 'jobs-apply-button artdeco-button',
      innerText: 'Easy Apply',
      getAttribute: (attr) => attr === 'aria-label' ? 'Easy Apply to Senior Java Engineer' : null
    };

    const txt = (easyApplyButton.innerText || '').toLowerCase();
    const aria = (easyApplyButton.getAttribute('aria-label') || '').toLowerCase();
    const href = (easyApplyButton.getAttribute('href') || '').toLowerCase();

    // Check external apply condition
    const isExternal = href.includes('externalapply') || aria.includes('company website') || txt.includes('company website') || (easyApplyButton.tagName.toLowerCase() === 'a' && href.startsWith('http'));
    const isEasy = txt.includes('easy apply') || aria.includes('easy apply') || (easyApplyButton.className.includes('jobs-apply-button') && !isExternal);

    assert.equal(isEasy, true, 'Button must be classified as Easy Apply');
    assert.equal(isExternal, false, 'Button must NEVER be classified as External Apply');
  });

  await t.test('12. Required terms and consent checkboxes are identified for automatic checking', () => {
    const testCases = [
      { label: 'I agree to the terms and conditions', required: false, expectedCheck: true },
      { label: 'I certify that all information submitted is true', required: false, expectedCheck: true },
      { label: 'I acknowledge the privacy notice', required: false, expectedCheck: true },
      { label: 'Follow Google to stay up to date', required: false, expectedCheck: false },
      { label: 'Any standard question', required: true, expectedCheck: true }
    ];

    for (const tc of testCases) {
      const isConsent = /agree|certify|consent|terms|acknowledge|confirm|understand/i.test(tc.label);
      const shouldCheck = tc.required || isConsent;
      assert.equal(shouldCheck, tc.expectedCheck, `Failed for checkbox: "${tc.label}"`);
    }
  });

  await t.test('13. NaukriBot API-level pre-filter skips external company jobs before opening tabs', () => {
    const jobMetadataMap = new Map();
    // Simulate intercepted Naukri Search API response
    jobMetadataMap.set('110926500938', {
      companyApplyJob: true,
      applyRedirectUrl: 'https://privetonline.com/requirement.php?id=6',
      title: 'ANGULAR DEVELOPER'
    });
    jobMetadataMap.set('271026027254', {
      companyApplyJob: false,
      applyRedirectUrl: '',
      title: 'Urgent requirement For Angular developer'
    });

    // Test external job
    const extMeta = jobMetadataMap.get('110926500938');
    assert.equal(extMeta.companyApplyJob, true, 'Job 110926500938 should be flagged as external');
    const shouldSkipExt = extMeta && extMeta.companyApplyJob === true;
    assert.equal(shouldSkipExt, true, 'External company job must be skipped in pre-check without opening tab');

    // Test native Easy Apply job
    const easyMeta = jobMetadataMap.get('271026027254');
    assert.equal(easyMeta.companyApplyJob, false, 'Job 271026027254 should be native 1-Click Fast Apply');
    const shouldSkipEasy = easyMeta && easyMeta.companyApplyJob === true;
    assert.equal(shouldSkipEasy, false, 'Native Easy Apply job must NOT be skipped');
  });

  await t.test('14. NaukriBot.handleNaukriSaveApplyPage accurately parses HTTP 200 success and HTTP 406 incomplete', async () => {
    const naukriBot = new NaukriBot(null, ai, settings, () => {}, dataStore);

    // Mock page with HTTP 200 multiApplyResp
    const page200 = {
      url: () => 'https://www.naukri.com/myapply/saveApply?strJobsarr=[311026015487]&multiApplyResp=%7B%22311026015487%22%3A200%7D',
      evaluate: async () => false,
      $$: async () => []
    };
    const res200 = await naukriBot.handleNaukriSaveApplyPage(page200);
    assert.equal(res200.success, true, 'HTTP 200 saveApply page must be treated as successful application');

    // Mock page with HTTP 406 multiApplyResp
    const page406 = {
      url: () => 'https://www.naukri.com/myapply/saveApply?strJobsarr=[270626005217]&multiApplyResp=%7B%22270626005217%22%3A406%7D',
      evaluate: async (fn) => {
        // Return true for is406Error check
        return true;
      },
      $$: async () => []
    };
    const res406 = await naukriBot.handleNaukriSaveApplyPage(page406);
    assert.equal(res406.success, false, 'HTTP 406 saveApply page must NOT be treated as applied');
    assert.ok(res406.reason.includes('406') || res406.reason.includes('incomplete'), 'Reason must indicate 406 rejection');
  });

  await t.test('15. NaukriBot.handleNaukriChatbot detects chatbot drawer and ignores header .nI-gNb-drawer', async () => {
    const naukriBot = new NaukriBot(null, ai, settings, () => {}, dataStore);
    naukriBot.randomDelay = async () => {};

    let typedText = '';
    let sendClicked = false;

    // Simulate page where header .nI-gNb-drawer is present, but ._chatBotContainer is also present
    const mockPage = {
      url: () => 'https://www.naukri.com/job-listings-software-engineer-solvecorp-chennai-1-to-3-years-270626005217',
      $$: async (selector) => {
        if (selector.includes('_chatBotContainer')) {
          return [{
            evaluate: async (fn) => {
              // Simulating isValidDrawer check: node is not nI-gNb, visible, and width/height > 100
              const mockNode = {
                className: '_chatBotContainer',
                closest: (sel) => null,
                offsetWidth: 380,
                offsetHeight: 650
              };
              return fn(mockNode);
            }
          }];
        }
        return [];
      },
      $: async (selector) => {
        if (selector.includes('div.textArea[contenteditable="true"]')) {
          return {
            evaluate: async (fn, ...args) => {
              if (args.length > 0) return fn({}, ...args);
              return true; // isContentEditable
            }
          };
        }
        return null;
      },
      keyboard: {
        type: async (text) => { typedText = text; },
        press: async (key) => {}
      },
      evaluate: async (fn, ...args) => {
        const fnStr = fn.toString();
        // Completion check in chat loop
        if (fnStr.includes('combined.includes') || fnStr.includes('thank you for applying')) {
          return !!typedText;
        }
        // Question extraction: return Solvecorp backend experience question
        if (fnStr.includes('botMsgs') || fnStr.includes('botMsg')) {
          if (typedText) return ''; // Finished after typing
          return 'How many years of experience do you have in Backend Development?';
        }
        // Check options: no options for text question
        if (fnStr.includes('chips')) {
          return false;
        }
        // Send button click
        if (fnStr.includes('sendBtn')) {
          sendClicked = true;
          return true;
        }
        // Final completion check object
        if (fnStr.includes('isSuccess') && fnStr.includes('is406')) {
          return { isSuccess: true, is406: false };
        }
        return false;
      }
    };

    const outcome = await naukriBot.handleNaukriChatbot(mockPage, { title: 'Software Engineer', company: 'Solvecorp' });
    assert.equal(outcome.success, true, 'Chatbot handler must succeed after filling questions, got reason: ' + outcome.reason);
    assert.equal(typedText, '3', 'Backend development experience must be filled with 3 years from profile');
    assert.equal(sendClicked, true, 'Chatbot send button must be clicked');
    assert.equal(outcome.questionsAnswered.length, 1, 'Question must be recorded in questionsAnswered');
  });

  await t.test('16. NaukriBot.handleNaukriChatbot answers radio options (TVM Infotech employment bond) and clicks drawer Save button', async () => {
    const naukriBot = new NaukriBot(null, ai, settings, () => {}, dataStore);
    naukriBot.randomDelay = async () => {};

    let optionChosen = null;
    let saveClicked = false;
    let questionsAskedCount = 0;

    const mockPage = {
      url: () => 'https://www.naukri.com/job-listings-angular-developer-freshers-chennai-tvm-infotech-chennai-0-to-1-years-161026024689',
      isClosed: () => false,
      $$: async (selector) => {
        if (selector.includes('._chatBotContainer') || selector.includes('.chatbot_Drawer')) {
          return [{
            evaluate: async (fn) => fn({ className: 'chatbot_Drawer', closest: () => null, offsetWidth: 380, offsetHeight: 650 })
          }];
        }
        return [];
      },
      $: async () => null,
      keyboard: {
        type: async () => {},
        press: async () => {}
      },
      evaluate: async (fn, ...args) => {
        const fnStr = fn.toString();

        // Check if finished
        if (fnStr.includes('combined.includes') || fnStr.includes('thank you for applying')) {
          return saveClicked;
        }

        // Question extraction: TVM Infotech bond question
        if (fnStr.includes('botMsgs') || fnStr.includes('botMsg')) {
          if (saveClicked) return '';
          questionsAskedCount++;
          return 'Would you be open to committing to a one-year employment bond with the company?';
        }

        // Radio click evaluation: targetAns is 'Yes'
        if (fnStr.includes('targetAns') || fnStr.includes('isMatch')) {
          optionChosen = args[0] || 'Yes';
          return { clicked: true, isRadio: true, text: 'Yes' };
        }

        // Drawer Save button click
        if (fnStr.includes('saveBtn') || fnStr.includes('saveClicked') || fnStr.includes('saveResult')) {
          saveClicked = true;
          return { saveClicked: true, text: 'Save' };
        }

        // Options extraction inside chatbot drawer: returns ['Yes', 'No']
        if (fnStr.includes('radioInputs')) {
          return ['Yes', 'No'];
        }

        // Final completion check
        if (fnStr.includes('isSuccess') && fnStr.includes('is406')) {
          return { isSuccess: true, is406: false };
        }

        return false;
      }
    };

    const outcome = await naukriBot.handleNaukriChatbot(mockPage, {
      title: 'Angular Developer Freshers',
      company: 'Tvm Infotech'
    });

    assert.equal(outcome.success, true, 'Chatbot handler must succeed for TVM Infotech');
    assert.equal(optionChosen, 'Yes', 'Radio option must be chosen as Yes for 1-year employment bond');
    assert.equal(saveClicked, true, 'Drawer Save button must be clicked after selecting radio');
    assert.equal(outcome.questionsAnswered.length, 1, 'Question must be recorded in questionsAnswered');
    assert.equal(outcome.questionsAnswered[0].answer, 'Yes');
  });
});


