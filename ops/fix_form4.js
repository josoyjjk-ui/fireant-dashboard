const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:18800');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  
  await page.goto('https://docs.google.com/forms/d/1ogjAxMoOg69zcJdnRjKIR0Ad7AdR2z5FdXlnOpso130/edit', { 
    waitUntil: 'domcontentloaded', timeout: 30000 
  });
  await page.waitForTimeout(6000);

  // Click on the empty question card (card 4, id=476845899) to select it
  const card = page.locator('[data-item-id="476845899"]').first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await card.click({ force: true });
  await page.waitForTimeout(2000);
  
  // Now click the delete button with force
  const deleteBtn = page.locator('[data-tooltip="서식 삭제"], [aria-label="서식 삭제"]').first();
  await deleteBtn.click({ force: true });
  console.log('✅ Deleted empty question');
  await page.waitForTimeout(2000);

  // Now check if there's still a duplicate 휴대전화번호
  // Card 0 has id=-1 which is the email auto-collection, not a real duplicate
  // The form should now be: email(auto), 휴대전화번호, 트위터, 유튜브, 텔레그램, 참여조건, BlockStreet질문, NFT지갑
  
  // Verify
  const remaining = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-item-id]')).slice(0, 10).map((c, i) => ({
      idx: i, id: c.getAttribute('data-item-id'), 
      text: c.textContent.substring(0, 30).replace(/\s+/g, ' ').trim()
    }));
  });
  console.log('Remaining cards:', JSON.stringify(remaining));
  
  // Check preview
  await page.goto('https://docs.google.com/forms/d/e/1FAIpQLSdvCJj9VFPQiGhRYMkTG-HIxaKv4EHcGfnn589N2bZiiszcMQ/viewform', { 
    waitUntil: 'domcontentloaded', timeout: 20000 
  });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'form_final.png', fullPage: true });
  console.log('Preview saved');
  
  await page.close();
  browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
