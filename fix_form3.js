const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:18800');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  
  await page.goto('https://docs.google.com/forms/d/1ogjAxMoOg69zcJdnRjKIR0Ad7AdR2z5FdXlnOpso130/edit', { 
    waitUntil: 'domcontentloaded', timeout: 30000 
  });
  await page.waitForTimeout(6000);

  // The editor has 9 real question cards (indices 0-8)
  // Cards 9-16 are preview/response duplicates, not real
  // We need to delete:
  //   - Card 1 (duplicate 휴대전화번호, first one card 0 might be the email auto-field)
  //   - Card 4 (empty question with just "질문")
  
  // Actually let me re-examine. Card 0 has id=-1 which is the email collection.
  // So the real questions start from card 1.
  // We want: 휴대전화번호, 트위터, 유튜브, 텔레그램, 참여조건, BlockStreet질문, NFT지갑
  // Card 4 (id=476845899) = empty "질문" = DELETE THIS
  
  // Click card 4 to select it
  await page.evaluate(() => {
    const cards = document.querySelectorAll('[data-item-id]');
    // Card 4 = the empty question
    const card = cards[4];
    card.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(1000);
  
  // Click directly on the card using coordinates
  const card4 = page.locator('[data-item-id="476845899"]').first();
  const box = await card4.boundingBox();
  if (box) {
    console.log(`Card 4 box: ${JSON.stringify(box)}`);
    // Click center of card
    await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
    await page.waitForTimeout(2000);
    
    // Take screenshot to see the selected state
    await page.screenshot({ path: 'form_selected.png' });
    
    // Now look for the visible trash icon
    const allBtns = await page.locator('[role="button"], button').all();
    for (const btn of allBtns) {
      const visible = await btn.isVisible().catch(() => false);
      if (!visible) continue;
      const tooltip = await btn.getAttribute('data-tooltip').catch(() => null);
      const ariaLabel = await btn.getAttribute('aria-label').catch(() => null);
      const label = tooltip || ariaLabel || '';
      if (label.includes('삭제') || label.includes('Delete') || label.includes('휴지통') || label.includes('Trash') || label.includes('Remove')) {
        console.log(`Found delete btn: "${label}"`);
        await btn.click();
        console.log('✅ Clicked delete');
        break;
      }
    }
  } else {
    console.log('Card 4 not found in viewport');
  }
  
  await page.waitForTimeout(3000);
  
  // Verify by checking the preview
  await page.goto('https://docs.google.com/forms/d/e/1FAIpQLSdvCJj9VFPQiGhRYMkTG-HIxaKv4EHcGfnn589N2bZiiszcMQ/viewform', { 
    waitUntil: 'domcontentloaded', timeout: 20000 
  });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'form_final.png', fullPage: true });
  console.log('Final preview saved');
  
  await page.close();
  browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
