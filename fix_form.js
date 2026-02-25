const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:18800');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  
  await page.goto('https://docs.google.com/forms/d/1ogjAxMoOg69zcJdnRjKIR0Ad7AdR2z5FdXlnOpso130/edit', { 
    waitUntil: 'domcontentloaded', timeout: 30000 
  });
  await page.waitForTimeout(6000);
  
  // Find and click the untitled/empty question to select it, then delete
  // First, scroll down to find it and click on it
  // The untitled question should be the 5th item (index 4, after email + 3 new ones)
  
  // Get all question cards
  const cards = await page.locator('[data-item-id]').all();
  console.log(`Found ${cards.length} question cards`);
  
  // Click on each card to find the untitled one
  for (let i = 0; i < cards.length; i++) {
    const text = await cards[i].textContent();
    const short = text.substring(0, 80).replace(/\s+/g, ' ').trim();
    console.log(`Card ${i}: ${short}`);
    
    // Check if it's the empty/untitled question (has "옵션 1" or "제목 없는 질문" and no real title)
    if ((text.includes('옵션 1') || text.includes('Option 1') || text.includes('제목 없는 질문') || text.includes('Untitled')) 
        && !text.includes('휴대전화') && !text.includes('트위터') && !text.includes('유튜브')
        && !text.includes('텔레그램') && !text.includes('Block Street') && !text.includes('NFT')
        && !text.includes('참여 조건')) {
      console.log(`>>> Deleting card ${i}`);
      await cards[i].click();
      await page.waitForTimeout(1000);
      
      // Click the 3-dot menu or trash icon on the selected card
      // Look for delete button within the card or nearby
      const trashBtn = page.locator('[data-tooltip="삭제"], [data-tooltip="Delete"], [aria-label="삭제"], [aria-label="Delete"]').first();
      if (await trashBtn.count() > 0) {
        await trashBtn.click();
        console.log('Deleted via trash button');
      } else {
        // Try the 3-dot menu
        const moreBtn = page.locator('[aria-label="더보기"], [aria-label="More options"]').last();
        if (await moreBtn.count() > 0) {
          await moreBtn.click();
          await page.waitForTimeout(500);
          const deleteOption = page.locator('text=삭제, text=Delete').first();
          await deleteOption.click();
          console.log('Deleted via menu');
        }
      }
      await page.waitForTimeout(1000);
      break;
    }
  }
  
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'form_fixed.png', fullPage: true });
  console.log('Done');
  
  await page.close();
  browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
