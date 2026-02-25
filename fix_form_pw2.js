const { chromium } = require('playwright');

(async () => {
  // Use actual Chrome profile directory
  const userDataDir = process.env.HOME + '/Library/Application Support/Google/Chrome';
  
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--disable-gpu', '--no-sandbox'],
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
    await page.screenshot({ path: 'form_nologin.png' });
    await context.close();
    process.exit(1);
  }
  
  console.log('LOGGED IN - proceeding to fix');
  
  // Find and delete empty question
  const cardInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-item-id]')).slice(0, 12).map((c, i) => ({
      idx: i, id: c.getAttribute('data-item-id'),
      text: c.textContent.substring(0, 50).replace(/\s+/g, ' ').trim()
    }));
  });
  console.log('Cards:', cardInfo.length);
  
  let targetIdx = -1;
  for (const c of cardInfo) {
    const t = c.text;
    if ((t.includes('옵션 1') || (t.includes('질문*질문*') && !t.includes('Block Street')))
        && !t.includes('휴대전화') && !t.includes('트위터') && !t.includes('유튜브')
        && !t.includes('텔레그램') && !t.includes('NFT') && !t.includes('참여')) {
      targetIdx = c.idx;
      console.log(`Found empty card at ${c.idx}: ${t}`);
      break;
    }
  }
  
  if (targetIdx === -1) {
    console.log('✅ Form is already clean!');
    await context.close();
    return;
  }
  
  // Click the card
  await page.evaluate((idx) => {
    const card = document.querySelectorAll('[data-item-id]')[idx];
    card.scrollIntoView({ block: 'center' });
  }, targetIdx);
  await page.waitForTimeout(500);
  
  const box = await page.evaluate((idx) => {
    const r = document.querySelectorAll('[data-item-id]')[idx].getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  }, targetIdx);
  
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(2000);
  
  // Delete
  const delBox = await page.evaluate(() => {
    for (const btn of document.querySelectorAll('[data-tooltip*="삭제"]')) {
      const r = btn.getBoundingClientRect();
      if (r.width > 5 && r.height > 5 && r.y > 0 && r.y < window.innerHeight)
        return { x: r.x + r.width/2, y: r.y + r.height/2, t: btn.getAttribute('data-tooltip') };
    }
    return null;
  });
  
  if (delBox) {
    await page.mouse.click(delBox.x, delBox.y);
    console.log('✅ Deleted:', delBox.t);
  }
  
  await page.waitForTimeout(2000);
  
  // Preview verify
  await page.goto('https://docs.google.com/forms/d/e/1FAIpQLSdvCJj9VFPQiGhRYMkTG-HIxaKv4EHcGfnn589N2bZiiszcMQ/viewform', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'form_verified.png', fullPage: true });
  console.log('Done - preview saved');
  
  await context.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
