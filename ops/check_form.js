const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:18800');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  await page.goto('https://docs.google.com/forms/d/e/1FAIpQLSdvCJj9VFPQiGhRYMkTG-HIxaKv4EHcGfnn589N2bZiiszcMQ/viewform', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'form_preview.png', fullPage: true });
  console.log('Preview saved');
  await page.close();
  browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
