const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  console.log('Connected');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  
  await page.goto('https://docs.google.com/forms/d/1ogjAxMoOg69zcJdnRjKIR0Ad7AdR2z5FdXlnOpso130/edit', { 
    waitUntil: 'domcontentloaded', timeout: 30000 
  });
  await page.waitForTimeout(8000);
  
  const url = page.url();
  console.log('URL:', url);
  
  if (url.includes('edit_requested') || url.includes('accounts.google.com')) {
    console.log('NOT LOGGED IN');
    await page.close();
    browser.close();
    process.exit(1);
  }

  // List all cards
  const cards = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-item-id]')).slice(0, 15).map((c, i) => ({
      idx: i, id: c.getAttribute('data-item-id'),
      text: c.textContent.substring(0, 60).replace(/\s+/g, ' ').trim()
    }));
  });
  
  console.log(`Found ${cards.length} cards`);
  cards.forEach(c => console.log(`  ${c.idx}: ${c.text}`));
  
  // Find empty question
  let targetIdx = -1;
  for (const c of cards) {
    const t = c.text;
    if (!t.includes('휴대전화') && !t.includes('트위터') && !t.includes('유튜브')
        && !t.includes('텔레그램') && !t.includes('NFT') && !t.includes('참여 조건')
        && !t.includes('Block Street') && !t.includes('이메일')
        && (t.includes('옵션') || t.includes('질문*질문') || (t.includes('질문') && t.length < 30))) {
      targetIdx = c.idx;
      break;
    }
  }
  
  if (targetIdx === -1) {
    console.log('✅ No empty question - form is clean!');
    await page.close();
    browser.close();
    return;
  }
  
  console.log(`\nDeleting card ${targetIdx}...`);
  
  // Click the card center
  const box = await page.evaluate((idx) => {
    const card = document.querySelectorAll('[data-item-id]')[idx];
    card.scrollIntoView({ block: 'center' });
    const r = card.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + 30 }; // Click near top of card
  }, targetIdx);
  
  await page.waitForTimeout(500);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(2500);
  
  // Look for visible delete button - try scrolling card bottom into view
  await page.evaluate((idx) => {
    const card = document.querySelectorAll('[data-item-id]')[idx];
    const r = card.getBoundingClientRect();
    // Scroll so the bottom of the card + some space is visible
    window.scrollBy(0, r.bottom - window.innerHeight + 200);
  }, targetIdx);
  await page.waitForTimeout(1000);
  
  // Find delete button that's visible
  const delInfo = await page.evaluate(() => {
    const btns = document.querySelectorAll('[data-tooltip*="삭제"], [aria-label*="삭제"]');
    const results = [];
    for (const btn of btns) {
      const r = btn.getBoundingClientRect();
      results.push({
        label: btn.getAttribute('data-tooltip') || btn.getAttribute('aria-label'),
        x: r.x + r.width/2, y: r.y + r.height/2,
        w: r.width, h: r.height,
        visible: r.y > 0 && r.y < window.innerHeight && r.width > 0
      });
    }
    return results;
  });
  
  console.log('Delete buttons:', JSON.stringify(delInfo));
  
  const visibleDel = delInfo.find(d => d.visible && d.label === '서식 삭제');
  if (visibleDel) {
    await page.mouse.click(visibleDel.x, visibleDel.y);
    console.log('✅ Deleted!');
  } else {
    // Try force clicking any 서식 삭제 button
    const anyDel = delInfo.find(d => d.label === '서식 삭제');
    if (anyDel) {
      // Scroll it into view first
      await page.evaluate((label) => {
        const btn = document.querySelector(`[data-tooltip="${label}"]`);
        if (btn) btn.scrollIntoView({ block: 'center' });
      }, '서식 삭제');
      await page.waitForTimeout(500);
      
      const newCoords = await page.evaluate(() => {
        const btn = document.querySelector('[data-tooltip="서식 삭제"]');
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { x: r.x + r.width/2, y: r.y + r.height/2 };
      });
      
      if (newCoords) {
        await page.mouse.click(newCoords.x, newCoords.y);
        console.log('✅ Deleted (after scroll)!');
      }
    }
  }
  
  await page.waitForTimeout(2000);
  
  // Verify via preview
  await page.goto('https://docs.google.com/forms/d/e/1FAIpQLSdvCJj9VFPQiGhRYMkTG-HIxaKv4EHcGfnn589N2bZiiszcMQ/viewform', {
    waitUntil: 'domcontentloaded', timeout: 20000
  });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'form_verified.png', fullPage: true });
  console.log('Preview screenshot saved');
  
  await page.close();
  browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
