const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

class ChromeManager {
  constructor(settings) {
    this.settings = settings;
    this.browser = null;
    this.isConnected = false;
  }

  updateSettings(settings) {
    this.settings = settings;
  }

  // Check if Chrome with Remote Debugging port is already running
  async isDebugPortOpen() {
    const port = this.settings.chrome?.port || 9222;
    const host = this.settings.chrome?.host || '127.0.0.1';

    return new Promise((resolve) => {
      const req = http.get(`http://${host}:${port}/json/version`, { timeout: 1500 }, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          resolve(false);
        }
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  // Launch Chrome with remote debugging if not already running
  async launchChrome() {
    const isOpen = await this.isDebugPortOpen();
    if (isOpen) {
      return { success: true, message: 'Chrome debug port is already active.' };
    }

    const execPath = this.settings.chrome?.executablePath || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const port = this.settings.chrome?.port || 9222;

    if (!fs.existsSync(execPath)) {
      throw new Error(`Chrome executable not found at: ${execPath}`);
    }

    // Dedicated automation profile in user home directory (guaranteed zero spaces)
    const userHome = process.env.USERPROFILE || 'C:\\Users\\91868';
    const automationProfileDir = path.join(userHome, '.autoapply-chrome-profile');
    if (!fs.existsSync(automationProfileDir)) {
      fs.mkdirSync(automationProfileDir, { recursive: true });
    }

    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${automationProfileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      'about:blank'
    ];

    const proc = spawn(execPath, args, {
      detached: true,
      stdio: 'ignore'
    });
    proc.unref();

    // Wait up to 10 seconds for Chrome to start and port to become available
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await this.isDebugPortOpen()) {
        return { success: true, message: 'Chrome launched with background execution & remote debugging enabled.' };
      }
    }

    throw new Error('Chrome was launched but remote debugging port 9222 did not open.');
  }

  // Relaunch Chrome with background execution flags enabled
  async relaunchChrome() {
    await this.disconnect();
    const isWin = process.platform === 'win32';
    await new Promise((resolve) => {
      const cmd = isWin ? 'taskkill' : 'pkill';
      const kArgs = isWin ? ['/F', '/IM', 'chrome.exe'] : ['-f', 'chrome'];
      const proc = spawn(cmd, kArgs, { stdio: 'ignore' });
      proc.on('exit', () => resolve());
      proc.on('error', () => resolve());
    });
    await new Promise(r => setTimeout(r, 1200));
    return await this.launchChrome();
  }

  // Prepare page for seamless background execution without throttling or stealing focus
  async setupBackgroundExecution(page) {
    if (!page || page.isClosed()) return;
    try {
      // 1. Enable CDP focus emulation so page behaves as permanently active & focused
      const session = await page.target().createCDPSession();
      await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    } catch (e) {}

    try {
      // 2. Override Page Visibility API so sites never know the user switched tabs or minimized
      await page.evaluateOnNewDocument(() => {
        try {
          Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
          Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
          window.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
          window.hasFocus = () => true;
        } catch (e) {}
      });
      // Also apply immediately to already-loaded pages
      await page.evaluate(() => {
        try {
          Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
          Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
          window.hasFocus = () => true;
        } catch (e) {}
      }).catch(() => {});
    } catch (e) {}
  }

  // Connect to Chrome via CDP
  async connect() {
    const port = this.settings.chrome?.port || 9222;
    const host = this.settings.chrome?.host || '127.0.0.1';

    const isOpen = await this.isDebugPortOpen();
    if (!isOpen) {
      await this.launchChrome();
    }

    this.browser = await puppeteer.connect({
      browserURL: `http://${host}:${port}`,
      defaultViewport: null
    });

    this.isConnected = true;

    // Apply background execution hooks to all existing pages
    try {
      const pages = await this.browser.pages();
      for (const p of pages) {
        await this.setupBackgroundExecution(p);
      }
    } catch (e) {}

    // Auto-hook any new pages or popups opened by scripts or clicks
    this.browser.on('targetcreated', async (target) => {
      try {
        const p = await target.page();
        if (p) await this.setupBackgroundExecution(p);
      } catch (e) {}
    });

    return this.browser;
  }

  async getActivePage() {
    if (!this.browser || !this.isConnected) {
      await this.connect();
    }
    const pages = await this.browser.pages();
    const page = pages.length > 0 ? pages[pages.length - 1] : await this.browser.newPage();
    await this.setupBackgroundExecution(page);
    return page;
  }

  async newPage() {
    if (!this.browser || !this.isConnected) {
      await this.connect();
    }
    const page = await this.browser.newPage();
    await this.setupBackgroundExecution(page);
    return page;
  }

  async disconnect() {
    if (this.browser) {
      try {
        await this.browser.disconnect();
      } catch (err) {
        // Ignore disconnect errors
      }
      this.browser = null;
      this.isConnected = false;
    }
  }

  async getStatus() {
    const portOpen = await this.isDebugPortOpen();
    let pagesCount = 0;
    if (this.browser && this.isConnected) {
      try {
        const pages = await this.browser.pages();
        pagesCount = pages.length;
      } catch (e) {
        this.isConnected = false;
      }
    }
    return {
      portOpen,
      isConnected: this.isConnected,
      pagesCount,
      port: this.settings.chrome?.port || 9222,
      execPath: this.settings.chrome?.executablePath
    };
  }
}

module.exports = ChromeManager;
