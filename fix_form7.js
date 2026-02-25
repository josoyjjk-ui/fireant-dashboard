const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18800');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  
  await page.goto('https://docs.google.com/forms/d/1ogjAxMoOg69zcJdnRjKIR0Ad7AdR2z5FdXlnOpso130/edit', { 
    waitUntil: 'domcontentloaded', timeout: 30000 
  });
  await page.waitForTimeout(6000);

  // Find the empty/untitled question and click it, then delete via keyboard
  // First identify it
  const cardInfo = await page.evaluate(() => {
    const cards = document.querySelectorAll('[data-item-id]');
    const results = [];
    for (let i = 0; i < Math.min(cards.length, 15); i++) {
      const t = cards[i].textContent.substring(0, 50).replace(/\s+/g, ' ').trim();
      results.push({ idx: i, id: cards[i].getAttribute('data-item-id'), text: t });
    }
    return results;
  });
  console.log('Cards:', JSON.stringify(cardInfo));
  
  // Find the empty one (contains "옵션 1" or just "질문" without a real title)
  let targetIdx = -1;
  for (const c of cardInfo) {
    if ((c.text.includes('옵션 1') || (c.text.match(/^[\s불개미]*질문\*질문/) && !c.text.includes('Block Street')))
        && !c.text.includes('휴대전화') && !c.text.includes('트위터') && !c.text.includes('유튜브')
        && !c.text.includes('텔레그램') && !c.text.includes('NFT') && !c.text.includes('참여 조건')) {
      targetIdx = c.idx;
      break;
    }
  }
  
  if (targetIdx === -1) {
    console.log('No empty question found - already clean!');
    await page.close();
    browser.close();
    return;
  }
  
  console.log(`Target card index: ${targetIdx}`);
  
  // Scroll to and click the card
  const box = await page.evaluate((idx) => {
    const cards = document.querySelectorAll('[data-item-id]');
    const card = cards[idx];
    card.scrollIntoView({ block: 'center' });
    const r = card.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  }, targetIdx);
  
  await page.waitForTimeout(500);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(2000);
  
  // Get delete button coordinates
  const delCoords = await page.evaluate(() => {
    // Look for all visible delete-like buttons
    const candidates = document.querySelectorAll('[data-tooltip*="삭제"], [aria-label*="삭제"], [data-tooltip*="Delete"], [aria-label*="Delete"]');
    for (const btn of candidates) {
      const r = btn.getBoundingClientRect();
      // Must be on screen (positive y) and visible size
      if (r.width > 10 && r.height > 10 && r.y > 0 && r.y < window.innerHeight) {
        return { x: r.x + r.width/2, y: r.y + r.height/2, label: btn.getAttribute('data-tooltip') || btn.getAttribute('aria-label') };
      }
    }
    return null;
  });
  
  if (delCoords) {
    console.log(`Delete button found: ${delCoords.label} at (${delCoords.x}, ${delCoords.y})`);
    await page.mouse.click(delCoords.x, delCoords.y);
    console.log('✅ Deleted');
  } else {
    console.log('Delete button not on screen, trying to find trash icon in card footer...');
    // The delete icon appears at bottom of selected card. Scroll down a bit and retry.
    await page.evaluate((idx) => {
      const cards = document.querySelectorAll('[data-item-id]');
      const card = cards[idx];
      // Scroll so bottom of card is visible
      const r = card.getBoundingClientRect();
      window.scrollBy(0, r.bottom - window.innerHeight + 100);
    }, targetIdx);
    await page.waitForTimeout(1000);
    
    const delCoords2 = await page.evaluate(() => {
      const candidates = document.querySelectorAll('[data-tooltip*="삭제"], [aria-label*="삭제"]');
      for (const btn of candidates) {
        const r = btn.getBoundingClientRect();
        if (r.width > 10 && r.height > 10 && r.y > 0 && r.y < window.innerHeight) {
          return { x: r.x + r.width/2, y: r.y + r.height/2, label: btn.getAttribute('data-tooltip') || btn.getAttribute('aria-label') };
        }
      }
      return null;
    });
    
    if (delCoords2) {
      await page.mouse.click(delCoords2.x, delCoords2.y);
      console.log('✅ Deleted (after scroll)');
    } else {
      console.log('❌ Still cannot find visible delete button');
    }
  }
  
  await page.waitForTimeout(2000);
  
  // Verify via preview
  await page.goto('https://docs.google.com/forms/d/e/1FAIpQLSdvCJj9VFPQiGhRYMkTG-HIxaKv4EHcGfnn589N2bZiiszcMQ/viewform', { 
    waitUntil: 'domcontentloaded', timeout: 20000 
  });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'form_verified.png', fullPage: true });
  console.log('Verification screenshot saved');
  
  await page.close();
  browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
