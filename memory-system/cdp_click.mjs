import WebSocket from 'ws';

const TARGET = process.argv[2];
const WS_URL = `ws://127.0.0.1:18800/devtools/page/${TARGET}`;
const ws = new WebSocket(WS_URL);
let id = 1;

function send(method, params = {}) {
  return new Promise((res) => {
    const mid = id++;
    ws.on('message', function h(data) {
      const msg = JSON.parse(data);
      if (msg.id === mid) { ws.off('message', h); res(msg.result); }
    });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

ws.on('open', async () => {
  await new Promise(r => setTimeout(r, 2000));

  // Find TVING 관리 link
  const r = await send('Runtime.evaluate', {
    expression: `(function() {
      var all = document.querySelectorAll('a');
      var links = [];
      for (var l of all) {
        if (l.textContent.trim() === '관리') {
          var li = l.closest('li') || l.parentElement;
          links.push({href: l.href, ctx: li ? li.textContent.slice(0,100) : ''});
        }
      }
      return links;
    })()`,
    returnByValue: true
  });

  const links = r?.result?.value || [];
  console.log('관리 links found:', JSON.stringify(links, null, 2));

  // Find TVING one
  const tvingLink = links.find(l => l.ctx.includes('TVING') || l.ctx.includes('tving'));
  if (tvingLink) {
    console.log('TVING link:', tvingLink.href);
    // Navigate to it
    await send('Page.navigate', { url: tvingLink.href });
    console.log('Navigated to TVING management page');
  } else {
    console.log('TVING link not found, all links:', JSON.stringify(links));
  }

  ws.close();
  process.exit(0);
});
