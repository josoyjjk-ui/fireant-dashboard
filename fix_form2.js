const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:18800');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  
  await page.goto('https://docs.google.com/forms/d/1ogjAxMoOg69zcJdnRjKIR0Ad7AdR2z5FdXlnOpso130/edit', { 
    waitUntil: 'domcontentloaded', timeout: 30000 
  });
  await page.waitForTimeout(6000);
  
  // Delete items one at a time by scrolling to them and clicking
  // Strategy: click on a card, then use the trash icon that appears
  
  async function deleteQuestionByScrolling(cardIndex) {
    // Scroll the card into view and click it
    const result = await page.evaluate(async (idx) => {
      const cards = document.querySelectorAll('[data-item-id]');
      if (idx >= cards.length) return { error: 'index out of range', total: cards.length };
      
      const card = cards[idx];
      card.scrollIntoView({ behavior: 'instant', block: 'center' });
      
      // Wait a bit
      await new Promise(r => setTimeout(r, 500));
      
      // Click the card to select it
      card.click();
      
      return { 
        itemId: card.getAttribute('data-item-id'),
        text: card.textContent.substring(0, 50)
      };
    }, cardIndex);
    
    console.log(`Selected card ${cardIndex}:`, JSON.stringify(result));
    await page.waitForTimeout(1500);
    
    // Now find and click the trash/delete button
    const trashBtn = page.locator('[data-tooltip="삭제"], [data-tooltip="Delete"], [aria-label="삭제"], [aria-label="Delete question"]');
    const count = await trashBtn.count();
    console.log(`Found ${count} delete buttons`);
    
    if (count > 0) {
      // Click the visible one
      for (let i = 0; i < count; i++) {
        if (await trashBtn.nth(i).isVisible()) {
          await trashBtn.nth(i).click();
          console.log(`✅ Deleted card ${cardIndex}`);
          await page.waitForTimeout(2000);
          return true;
        }
      }
    }
    
    // Try keyboard shortcut
    console.log('Trying Ctrl+D or other shortcut...');
    return false;
  }
  
  // First, let's see what we have now
  const allCards = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-item-id]')).map((c, i) => ({
      idx: i,
      id: c.getAttribute('data-item-id'),
      text: c.textContent.substring(0, 40).replace(/\s+/g, ' ').trim()
    }));
  });
  console.log('All cards:', JSON.stringify(allCards, null, 2));
  
  // Identify which to delete (duplicates and empty)
  // We want to keep: 휴대전화번호(first), 트위터(first), 유튜브(first), 텔레그램, 참여조건, Block Street질문, NFT지갑
  // Delete: duplicate 휴대전화번호, duplicate 트위터, duplicate 유튜브, empty "옵션1"
  
  // Delete from bottom up to preserve indices
  const toDelete = [];
  const seen = new Set();
  for (let i = 0; i < allCards.length; i++) {
    const t = allCards[i].text;
    if (t.includes('옵션 1') && !t.includes('휴대') && !t.includes('트위터') && !t.includes('유튜브') && !t.includes('텔레그램')) {
      toDelete.push(i);
    } else {
      const key = t.substring(0, 15);
      if (seen.has(key)) {
        toDelete.push(i);
      }
      seen.add(key);
    }
  }
  
  console.log(`Cards to delete (indices): ${toDelete}`);
  
  // Delete from bottom to top
  for (const idx of toDelete.reverse()) {
    const ok = await deleteQuestionByScrolling(idx);
    if (!ok) console.log(`Failed to delete card ${idx}`);
  }
  
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'form_cleaned.png', fullPage: true });
  console.log('🎉 Cleanup done');
  
  await page.close();
  browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
