const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:18800');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  
  await page.goto('https://docs.google.com/forms/d/1ogjAxMoOg69zcJdnRjKIR0Ad7AdR2z5FdXlnOpso130/edit', { 
    waitUntil: 'domcontentloaded', timeout: 30000 
  });
  await page.waitForTimeout(6000);

  // Card index 4 (id=476845899) is the empty question - need to click it first, then delete
  // Use evaluate to directly dispatch click and then find delete button
  
  // Step 1: Click the card to select it
  await page.evaluate(() => {
    const cards = document.querySelectorAll('[data-item-id]');
    const card = cards[4]; // The empty question
    card.scrollIntoView({ block: 'center' });
    // Simulate a real click on the card
    const rect = card.getBoundingClientRect();
    const evt = new MouseEvent('mousedown', { bubbles: true, clientX: rect.x + rect.width/2, clientY: rect.y + rect.height/2 });
    card.dispatchEvent(evt);
    const evt2 = new MouseEvent('mouseup', { bubbles: true, clientX: rect.x + rect.width/2, clientY: rect.y + rect.height/2 });
    card.dispatchEvent(evt2);
    const evt3 = new MouseEvent('click', { bubbles: true, clientX: rect.x + rect.width/2, clientY: rect.y + rect.height/2 });
    card.dispatchEvent(evt3);
  });
  await page.waitForTimeout(2000);
  
  // Step 2: Find and click delete using evaluate + dispatchEvent
  const deleted = await page.evaluate(() => {
    const btn = document.querySelector('[data-tooltip="서식 삭제"], [aria-label="서식 삭제"]');
    if (!btn) return 'no button found';
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return 'clicked';
  });
  console.log('Delete result:', deleted);
  await page.waitForTimeout(3000);

  // Verify
  const cards = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-item-id]')).slice(0, 10).map((c, i) => 
      `${i}: [${c.getAttribute('data-item-id')}] ${c.textContent.substring(0, 25).replace(/\s+/g, ' ')}`
    );
  });
  console.log(cards.join('\n'));
  
  await page.close();
  browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
