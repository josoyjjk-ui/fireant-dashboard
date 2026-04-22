const { chromium } = require('playwright');

(async () => {
  // Use persistent context with Chrome's user data to get Google login
  const userDataDir = '/tmp/pw-chrome-profile';
  
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',  // Use installed Chrome
    args: ['--disable-blink-features=AutomationControlled'],
  });
  
  const page = context.pages()[0] || await context.newPage();
  
  // Navigate to form edit
  await page.goto('https://docs.google.com/forms/d/1ogjAxMoOg69zcJdnRjKIR0Ad7AdR2z5FdXlnOpso130/edit', { 
    waitUntil: 'networkidle', 
    timeout: 30000 
  });
  await page.waitForTimeout(3000);
  
  const url = page.url();
  console.log('URL:', url);
  
  if (url.includes('accounts.google.com') || url.includes('edit_requested')) {
    console.log('NOT_LOGGED_IN - need Google auth');
    await page.screenshot({ path: 'form_need_login.png' });
    await context.close();
    process.exit(1);
  }
  
  console.log('Logged in! Adding fields...');
  
  // Function to add a question
  async function addQuestion(title) {
    // Click "Add question" button (+ icon)
    const addBtn = page.locator('[data-tooltip="질문 추가"]').first();
    if (await addBtn.count() === 0) {
      // Try English tooltip
      const addBtnEn = page.locator('[data-tooltip="Add question"]').first();
      await addBtnEn.click();
    } else {
      await addBtn.click();
    }
    await page.waitForTimeout(1500);
    
    // Type the question title in the focused input
    await page.keyboard.type(title);
    await page.waitForTimeout(500);
    
    console.log(`Added: ${title}`);
  }
  
  await addQuestion('휴대전화번호');
  await addQuestion('트위터(X) 아이디');  
  await addQuestion('유튜브 닉네임');
  
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'form_updated.png' });
  console.log('DONE');
  
  await context.close();
})().catch(e => { console.error(e.message); process.exit(1); });
