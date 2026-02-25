const { chromium } = require('playwright');

(async () => {
  // Connect to existing Chrome via CDP (user's logged-in Chrome)
  const browser = await chromium.connectOverCDP('http://localhost:18800');
  console.log('Connected to Chrome');
  
  const contexts = browser.contexts();
  console.log('Contexts:', contexts.length);
  
  const context = contexts[0];
  const page = await context.newPage();
  
  await page.goto('https://docs.google.com/forms/d/1ogjAxMoOg69zcJdnRjKIR0Ad7AdR2z5FdXlnOpso130/edit', { 
    waitUntil: 'networkidle', 
    timeout: 30000 
  });
  await page.waitForTimeout(3000);
  
  const url = page.url();
  console.log('URL:', url);
  
  if (url.includes('accounts.google.com') || url.includes('edit_requested')) {
    console.log('NOT_LOGGED_IN');
    await page.screenshot({ path: 'form_cdp.png' });
    await page.close();
    browser.close();
    process.exit(1);
  }
  
  console.log('Form editor loaded!');
  await page.screenshot({ path: 'form_editor.png' });
  
  // Add questions by clicking the add button
  async function addShortAnswer(title) {
    // Find and click the floating "Add question" button
    // The sidebar has an icon for adding questions
    const addBtn = page.locator('[data-tooltip="질문 추가"], [data-tooltip="Add question"], [aria-label="질문 추가"], [aria-label="Add question"]').first();
    
    if (await addBtn.count() > 0) {
      await addBtn.click();
    } else {
      // Try the plus icon in the floating toolbar
      const plusBtns = page.locator('.freebirdFormeditorViewAddItemToolbarAddButton, [data-action-id="addQuestion"]');
      if (await plusBtns.count() > 0) {
        await plusBtns.first().click();
      } else {
        console.log('Cannot find add button, trying keyboard shortcut');
        // Fallback: try common selectors
        const toolbar = page.locator('.freebirdFormeditorViewToolbarView');
        await toolbar.locator('div[role="button"]').first().click();
      }
    }
    await page.waitForTimeout(2000);
    
    // The new question should be focused - type the title
    const titleInput = page.locator('[aria-label="질문"], [aria-label="Question"], [placeholder="질문"], [placeholder="Question"]').last();
    if (await titleInput.count() > 0) {
      await titleInput.click();
      await titleInput.fill(title);
    } else {
      // Fallback: type into focused element
      await page.keyboard.type(title);
    }
    await page.waitForTimeout(1000);
    console.log(`Added: ${title}`);
  }
  
  await addShortAnswer('휴대전화번호');
  await addShortAnswer('트위터(X) 아이디');
  await addShortAnswer('유튜브 닉네임');
  
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'form_done.png' });
  console.log('DONE - 3 fields added');
  
  await page.close();
  browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
