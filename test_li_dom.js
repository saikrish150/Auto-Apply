const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const pages = await browser.pages();
  const p = pages[2];
  
  const result = await p.evaluate(() => {
    // 1. Check all anchor tags containing /jobs/view/ or /jobs/search
    const jobAnchors = Array.from(document.querySelectorAll('a'))
      .filter(a => a.href && (a.href.includes('/jobs/view/') || a.href.includes('currentJobId=')))
      .map(a => ({
        text: a.innerText.trim().replace(/\n+/g, ' '),
        href: a.href,
        className: a.className
      }));

    // 2. Check Easy Apply button
    const buttons = Array.from(document.querySelectorAll('button'))
      .filter(b => b.innerText && b.innerText.includes('Easy Apply'))
      .map(b => ({
        text: b.innerText.trim(),
        ariaLabel: b.getAttribute('aria-label'),
        className: b.className
      }));

    return { jobAnchorsCount: jobAnchors.length, sampleAnchors: jobAnchors.slice(0, 5), buttons };
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})();
