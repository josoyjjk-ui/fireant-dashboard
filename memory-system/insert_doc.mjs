import WebSocket from 'ws';
import { readFileSync } from 'fs';

const DOC_ID = '1qmvLbzAVpcYqQDj4xxufRUWOmh2nAm-JtOm7ZSHPVU4';
const TARGET = '845B3AF7946AEFE272492DB21A4A5C1E';

const rawContent = readFileSync('/Users/fireant/.openclaw/workspace/orderly_activity_plan.md', 'utf-8');

// Plain text version (strip markdown symbols)
const plainText = rawContent
  .replace(/^#{1,3} /gm, '')
  .replace(/\*\*/g, '')
  .replace(/\|[-| ]+\|/g, '')  // table separators
  .replace(/^\|/gm, '')
  .replace(/\|$/gm, '')
  .replace(/^---+$/gm, '---')
  .replace(/- \[ \]/g, '□')
  .trim();

const ws = new WebSocket(`ws://127.0.0.1:18800/devtools/page/${TARGET}`);
let id = 1;

function send(method, params = {}) {
  return new Promise(res => {
    const mid = id++;
    ws.on('message', function h(data) {
      const msg = JSON.parse(data);
      if (msg.id === mid) { ws.off('message', h); res(msg.result); }
    });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

ws.on('open', async () => {
  await new Promise(r => setTimeout(r, 1000));

  const payload = JSON.stringify({
    requests: [{
      insertText: {
        location: { index: 1 },
        text: plainText
      }
    }]
  });

  const script = `
    (async () => {
      const resp = await fetch(
        'https://docs.googleapis.com/v1/documents/${DOC_ID}:batchUpdate',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-AuthUser': '0'
          },
          body: ${JSON.stringify(payload)}
        }
      );
      const text = await resp.text();
      return resp.status + ': ' + text.slice(0, 500);
    })()
  `;

  const r = await send('Runtime.evaluate', {
    expression: script,
    awaitPromise: true,
    returnByValue: true,
    timeout: 15000
  });

  console.log('Result:', r?.result?.value);
  ws.close();
  process.exit(0);
});

ws.on('error', e => { console.error(e.message); process.exit(1); });
