const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:18800');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  
  await page.goto('https://docs.google.com/forms/d/1ogjAxMoOg69zcJdnRjKIR0Ad7AdR2z5FdXlnOpso130/edit', { 
    waitUntil: 'domcontentloaded', timeout: 30000 
  });
  await page.waitForTimeout(6000);

  // Click on card 4 (empty question) using mouse coordinates
  const cardBox = await page.evaluate(() => {
    const cards = document.querySelectorAll('[data-item-id]');
    const card = cards[4];
    card.scrollIntoView({ block: 'center' });
    const r = card.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  
  console.log('Card box:', cardBox);
  await page.waitForTimeout(500);
  
  // Click center of card to select it
  await page.mouse.click(cardBox.x + cardBox.w/2, cardBox.y + cardBox.h/2);
  await page.waitForTimeout(2000);
  
  // Get the delete button position
  const delBox = await page.evaluate(() => {
    const btns = document.querySelectorAll('[data-tooltip="서식 삭제"], [aria-label="서식 삭제"]');
    for (const btn of btns) {
      const r = btn.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    // Try trash icon
    const icons = document.querySelectorAll('[data-tooltip*="삭제"]');
    for (const icon of icons) {
      const r = icon.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { x: r.x, y: r.y, w: r.width, h: r.height, label: icon.getAttribute('data-tooltip') };
    }
    return null;
  });
  
  console.log('Delete button:', delBox);
  
  if (delBox) {
    await page.mouse.click(delBox.x + delBox.w/2, delBox.y + delBox.h/2);
    console.log('✅ Clicked delete at coordinates');
    await page.waitForTimeout(2000);
  } else {
    console.log('Delete button not found, trying screenshot...');
    await page.screenshot({ path: 'form_no_del.png' });
  }

  // Verify via preview
  await page.goto('https://docs.google.com/forms/d/e/1FAIpQLSdvCJj9VFPQiGhRYMkTG-HIxaKv4EHcGfnn589N2bZiiszcMQ/viewform', { 
    waitUntil: 'domcontentloaded', timeout: 20000 
  });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'form_final2.png', fullPage: true });
  console.log('Done');
  
  await page.close();
  browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
