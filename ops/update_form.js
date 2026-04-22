const { chromium } = require('playwright');

(async () => {
  // Connect to existing Chrome with Google login via CDP
  // First try launching with user data dir for Google auth
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto('https://docs.google.com/forms/d/1ogjAxMoOg69zcJdnRjKIR0Ad7AdR2z5FdXlnOpso130/edit', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  const url = page.url();
  console.log('URL:', url);
  
  // Check if we need to login
  if (url.includes('accounts.google.com')) {
    console.log('NEED_LOGIN');
    await page.screenshot({ path: 'form_login.png' });
    await browser.close();
    process.exit(1);
  }
  
  await page.screenshot({ path: 'form_state.png' });
  console.log('Form loaded, checking existing questions...');
  
  // Get all question titles
  const questions = await page.locator('[data-params]').allTextContents();
  console.log('Questions found:', questions.length);
  
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
