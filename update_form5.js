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
    // Click add question button (the + circle icon in floating toolbar)
    const addBtns = await page.locator('[data-tooltip="질문 추가"], [data-tooltip="Add question"]').all();
    if (addBtns.length > 0) {
      await addBtns[0].click();
      console.log('Clicked add button via tooltip');
    } else {
      // Try aria-label
      const ariaBtn = await page.locator('[aria-label="질문 추가"], [aria-label="Add question"]').all();
      if (ariaBtn.length > 0) {
        await ariaBtn[0].click();
        console.log('Clicked add button via aria');
      } else {
        console.log('Trying CSS selector for add button...');
        // The floating action bar typically has icons
        await page.screenshot({ path: `form_no_btn_${title}.png` });
        // Try to find by image/svg icon area
        const allBtns = await page.locator('[role="button"]').all();
        console.log(`Found ${allBtns.length} buttons total`);
        // Print some button texts for debugging
        for (let i = 0; i < Math.min(allBtns.length, 20); i++) {
          const txt = await allBtns[i].getAttribute('aria-label') || await allBtns[i].getAttribute('data-tooltip') || '';
          if (txt) console.log(`  btn ${i}: ${txt}`);
        }
        return false;
      }
    }
    
    await page.waitForTimeout(2000);
    
    // Find the newly added question's title input (usually the last one)
    // Google Forms uses contenteditable divs or textareas
    const qInputs = await page.locator('[aria-label="질문"], [aria-label="Question title"], [data-placeholder="질문"], [placeholder="질문"]').all();
    console.log(`Found ${qInputs.length} question inputs`);
    
    if (qInputs.length > 0) {
      const lastInput = qInputs[qInputs.length - 1];
      await lastInput.click();
      await lastInput.fill(title);
    } else {
      // Try textarea or input that's focused
      const focused = page.locator(':focus');
      await focused.type(title);
    }
    
    await page.waitForTimeout(1000);
    console.log(`✅ Added: ${title}`);
    return true;
  }
  
  const ok1 = await addQuestion('휴대전화번호');
  if (!ok1) {
    console.log('Failed to find add button. Taking debug screenshot...');
    await page.screenshot({ path: 'form_debug.png', fullPage: true });
    await page.close();
    browser.close();
    process.exit(1);
  }
  
  await addQuestion('트위터(X) 아이디');
  await addQuestion('유튜브 닉네임');
  
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'form_result.png', fullPage: true });
  console.log('🎉 DONE');
  
  await page.close();
  browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
