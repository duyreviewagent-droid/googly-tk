// Minimal Chrome driver (no puppeteer): open the game headless in real time, run JS in it, optionally screenshot.
// node test/cdp.mjs "query" "js expression (may return a promise)" [timeoutSec] [shot.png] [WxH]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [query = '', expr = 'document.title', tmo = '120', shot = '', size = '1280x800'] = process.argv.slice(2);
const port = 9300 + Math.floor(Math.random() * 500), url = `http://localhost:${process.env.PORT || 8123}/?${query}`;
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dir = `/tmp/claude-501/cdp-${port}`;
const ch = spawn(CH, ['--headless=new', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, `--window-size=${size.replace('x', ',')}`, url], { stdio: 'ignore' });
const done = code => { try { ch.kill('SIGKILL'); } catch { } fs.rmSync(dir, { recursive: true, force: true }); process.exit(code); };
setTimeout(() => { console.log('TIMEOUT'); done(2); }, +tmo * 1000);
let list = null;
for (let i = 0; i < 100 && !list; i++) { await new Promise(r => setTimeout(r, 200)); try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); list = l.find(t => t.type === 'page'); } catch { } }
const ws = new WebSocket(list.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', ev => { const d = JSON.parse(ev.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } if (d.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR', JSON.stringify(d.params.exceptionDetails).slice(0, 600)); if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'log')) console.log('console.' + d.params.type, d.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 400)); });
const call = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await call('Runtime.enable');
await new Promise(r => setTimeout(r, 1500));
const res = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: +tmo * 1000 });
console.log(typeof res.result?.result?.value === 'string' ? res.result.result.value : JSON.stringify(res.result?.result?.value ?? res.result, null, 1));
if (shot) { const s = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(shot, Buffer.from(s.result.data, 'base64')); console.log('wrote', shot); }
done(0);
