const { chromium } = require('playwright');

(async () => {
  // Use persistent context with Chrome channel to get Google cookies
  const context = await chromium.launchPersistentContext('/tmp/chrome-debug-profile', {
    headless: false,
    channel: 'chrome',
    args: ['--disable-gpu'],
  });
  
  const page = context.pages()[0] || await context.newPage();
  
  await page.goto('https://docs.google.com/forms/d/1ogjAxMoOg69zcJdnRjKIR0Ad7AdR2z5FdXlnOpso130/edit', { 
    waitUntil: 'domcontentloaded', timeout: 30000 
  });
  await page.waitForTimeout(6000);
  
  const url = page.url();
  console.log('URL:', url);
  
  if (url.includes('edit_requested') || url.includes('accounts.google.com')) {
    console.log('NOT LOGGED IN');
    await context.close();
    process.exit(1);
  }
  
  // Find empty question
  const cardInfo = await page.evaluate(() => {
    const cards = document.querySelectorAll('[data-item-id]');
    return Array.from(cards).slice(0, 12).map((c, i) => ({
      idx: i, id: c.getAttribute('data-item-id'),
      text: c.textContent.substring(0, 50).replace(/\s+/g, ' ').trim()
    }));
  });
  console.log('Cards:', JSON.stringify(cardInfo, null, 1));
  
  let targetIdx = -1;
  for (const c of cardInfo) {
    if ((c.text.includes('옵션 1') || (c.text.startsWith('불개미') && c.text.includes('질문*질문*')))
        && !c.text.includes('휴대전화') && !c.text.includes('트위터') && !c.text.includes('유튜브')
        && !c.text.includes('텔레그램') && !c.text.includes('NFT') && !c.text.includes('참여')
        && !c.text.includes('Block Street')) {
      targetIdx = c.idx;
      break;
    }
  }
  
  if (targetIdx === -1) {
    console.log('✅ No empty question found - form is clean!');
    // Verify preview
    await page.goto('https://docs.google.com/forms/d/e/1FAIpQLSdvCJj9VFPQiGhRYMkTG-HIxaKv4EHcGfnn589N2bZiiszcMQ/viewform', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'form_verified.png', fullPage: true });
    await context.close();
    return;
  }
  
  console.log(`Deleting card ${targetIdx}...`);
  
  // Click on the card
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
  
  // Find visible delete button
  const delCoords = await page.evaluate(() => {
    const btns = document.querySelectorAll('[data-tooltip*="삭제"], [aria-label*="삭제"]');
    for (const btn of btns) {
      const r = btn.getBoundingClientRect();
      if (r.width > 10 && r.height > 10 && r.y > 0 && r.y < window.innerHeight) {
        return { x: r.x + r.width/2, y: r.y + r.height/2, label: btn.getAttribute('data-tooltip') };
      }
    }
    return null;
  });
  
  if (delCoords) {
    console.log(`Found: ${delCoords.label}`);
    await page.mouse.click(delCoords.x, delCoords.y);
    console.log('✅ Deleted!');
  } else {
    // Force click using evaluate
    await page.evaluate(() => {
      const btn = document.querySelector('[data-tooltip="서식 삭제"]');
      if (btn) btn.click();
    });
    console.log('✅ Force deleted via JS');
  }
  
  await page.waitForTimeout(2000);
  
  // Verify
  await page.goto('https://docs.google.com/forms/d/e/1FAIpQLSdvCJj9VFPQiGhRYMkTG-HIxaKv4EHcGfnn589N2bZiiszcMQ/viewform', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'form_verified.png', fullPage: true });
  console.log('Preview saved');
  
  await context.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
