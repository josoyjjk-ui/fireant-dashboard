const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:18800');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  
  await page.goto('https://docs.google.com/forms/d/1ogjAxMoOg69zcJdnRjKIR0Ad7AdR2z5FdXlnOpso130/edit', { 
    waitUntil: 'domcontentloaded', 
    timeout: 30000 
  });
  await page.waitForTimeout(6000);
  
  async function addQuestion(title) {
    // Click add question (+ icon in floating toolbar on right side)
    await page.click('[data-tooltip="질문 추가"], [data-tooltip="Add question"]');
    await page.waitForTimeout(2500);
    
    // The new question title is an editable input - find the focused/active one
    // In Google Forms, the question title is a textarea inside the active card
    // Try typing directly since the new question should be focused
    
    // First, find the "제목 없는 질문" or "Untitled Question" text and replace it
    const untitledInputs = await page.locator('textarea[aria-label="제목 없는 질문"], textarea[aria-label="Untitled Question"], input[aria-label="제목 없는 질문"], input[aria-label="Untitled Question"]').all();
    
    if (untitledInputs.length > 0) {
      const target = untitledInputs[untitledInputs.length - 1];
      await target.click();
      await target.fill(title);
      console.log(`✅ ${title} (via untitled input)`);
      return;
    }
    
    // Try: find all visible textareas, the last one should be the new question
    const textareas = await page.locator('textarea').all();
    console.log(`Found ${textareas.length} textareas`);
    
    // Try using evaluate to directly manipulate the DOM
    await page.evaluate((qTitle) => {
      // Find the last question card and set its title
      const inputs = document.querySelectorAll('[data-params] input[type="text"], [data-params] textarea');
      if (inputs.length > 0) {
        const last = inputs[inputs.length - 1];
        last.focus();
        last.value = qTitle;
        last.dispatchEvent(new Event('input', { bubbles: true }));
        last.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, title);
    
    await page.waitForTimeout(500);
    
    // Fallback: just type it
    await page.keyboard.type(title);
    console.log(`✅ ${title} (via keyboard)`);
  }
  
  await addQuestion('휴대전화번호');
  await addQuestion('트위터(X) 아이디');
  await addQuestion('유튜브 닉네임');
  
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'form_result.png', fullPage: true });
  console.log('🎉 DONE - screenshot saved');
  
  await page.close();
  browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
