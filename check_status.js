const puppeteer = require('puppeteer-core');

(async () => {
  try {
    const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
    const pages = await browser.pages();
    console.log('Total pages:', pages.length);

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const url = p.url();
      const title = await p.title();
      console.log('Tab ' + i + ': [' + title + '] -> ' + url);

      if (url.includes('linkedin.com')) {
        const cookies = await p.cookies();
        const liAt = cookies.find(c => c.name === 'li_at');
        console.log('LinkedIn li_at cookie found?:', !!liAt);

        const evalInfo = await p.evaluate(() => {
          return {
            hasMeNav: !!document.querySelector('.global-nav__me, .feed-identity-module, #global-nav'),
            hasSignIn: !!document.querySelector('a.nav__button-secondary, .nav__button-tertiary, .sign-in-modal__outlet-btn'),
            url: window.location.href,
            title: document.title
          };
        });
        console.log('LinkedIn eval:', JSON.stringify(evalInfo));
      }

      if (url.includes('naukri.com')) {
        const evalInfo = await p.evaluate(() => {
          return {
            hasUserDrawer: !!document.querySelector('.nI-gNb-drawer, a[href*="my-profile"], .nI-gNb-header__user'),
            url: window.location.href,
            title: document.title
          };
        });
        console.log('Naukri eval:', JSON.stringify(evalInfo));
      }
    }

    await browser.disconnect();
  } catch (err) {
    console.error('CDP connect error:', err.message);
  }
})();
