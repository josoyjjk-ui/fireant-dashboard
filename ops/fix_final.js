const { chromium } = require('playwright');

(async () => {
  // Launch Playwright chromium with persistent context to keep login
  const context = await chromium.launchPersistentContext('/tmp/pw-persistent', {
    headless: false,
    args: ['--disable-gpu'],
  });
  
  const page = context.pages()[0] || await context.newPage();
  
  // First check if we're logged into Google
  await page.goto('https://accounts.google.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);
  const accountUrl = page.url();
  
  if (accountUrl.includes('signin') || accountUrl.includes('ServiceLogin')) {
    console.log('Need to login to Google. Doing automated login...');
    
    // Type email
    await page.fill('input[type="email"]', 'josoyjjk@gmail.com');
    await page.click('#identifierNext, button[jsname="LgbsSe"]');
    await page.waitForTimeout(3000);
    
    // We can't proceed without password. Try a different approach.
    console.log('NEED_PASSWORD - switching to Apps Script approach');
    await context.close();
    
    // Use Google Apps Script via URL fetch to delete the question
    // Actually, let's try using the form's internal batch API
    process.exit(2);
  }
  
  // If logged in, proceed
  await page.goto('https://docs.google.com/forms/d/1ogjAxMoOg69zcJdnRjKIR0Ad7AdR2z5FdXlnOpso130/edit', {
    waitUntil: 'domcontentloaded', timeout: 30000
  });
  await page.waitForTimeout(6000);
  
  console.log('URL:', page.url());
  await context.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
