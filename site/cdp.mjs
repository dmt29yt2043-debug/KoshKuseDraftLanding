// Минимальный драйвер Chrome через DevTools Protocol (без зависимостей, Node 22+).
// Использование: node cdp.mjs plan.json
// plan: {"steps":[{"viewport":{"w":390,"h":844,"dpr":2,"mobile":true}},
//                 {"goto":"file:///…/index.html?site&nointro"},{"wait":1500},
//                 {"scroll":800},{"wait":1200},{"shot":"out.png","full":false},
//                 {"eval":"document.title","label":"title"},{"click":"#burger"}]}
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const plan = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const port = 9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(process.env.CDP_TMP || tmpdir(), 'kkcdp-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(path, method = 'GET') {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}${path}`, { method }); if (r.ok) return r.json(); } catch {}
    await sleep(150);
  }
  throw new Error('Chrome не ответил на ' + path);
}

const results = {};
let ws, id = 0;
const pending = new Map();
const events = [];
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}

try {
  await getJSON('/json/version');
  const tabs = await getJSON('/json/list');
  const page = tabs.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method) events.push(m);
  });
  await send('Page.enable'); await send('Runtime.enable');
  const consoleErr = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') consoleErr.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErr.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  let vp = { w: 390, h: 844, dpr: 2, mobile: true };
  for (const st of plan.steps) {
    if (st.viewport) {
      vp = { ...vp, ...st.viewport };
      await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: !!vp.mobile, screenWidth: vp.w, screenHeight: vp.h });
      await send('Emulation.setTouchEmulationEnabled', vp.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      if (st.viewport.reduced !== undefined) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: st.viewport.reduced ? 'reduce' : 'no-preference' }] });
    }
    if (st.nojs) await send('Emulation.setScriptExecutionDisabled', { value: true });
    // медленная сеть: {"throttle":{"latency":400,"down":400,"up":200}} — задержка в мс, скорость в кбит/с, без кэша
    if (st.throttle) {
      await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
      await send('Network.emulateNetworkConditions', { offline: false, latency: st.throttle.latency, downloadThroughput: st.throttle.down * 128, uploadThroughput: (st.throttle.up || st.throttle.down) * 128 });
    }
    if (st.goto) {
      await send('Page.navigate', { url: st.goto });
      // nowait — не ждать загрузки страницы (чтобы снимать кадры во время загрузки)
      for (let i = 0; i < (st.nowait ? 0 : 100); i++) { if (events.some(e => e.method === 'Page.loadEventFired')) break; await sleep(100); }
      events.length = 0;
    }
    if (st.wait) await sleep(st.wait);
    if (st.scroll !== undefined) {
      const el = st.scroller ? `document.querySelector(${JSON.stringify(st.scroller)})` : 'null';
      await send('Runtime.evaluate', { expression: `(function(){var s=${el};if(s){s.scrollTo({top:${st.scroll},behavior:'instant'})}else{window.scrollTo({top:${st.scroll},behavior:'instant'})}})()` });
    }
    if (st.click) await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(st.click)}).click()` });
    // настоящие касания (нужен viewport.mobile): tap / swipe / key / type
    //   {"tap":[x,y]}  {"swipe":{"x":200,"y":500,"dx":-240,"dy":0,"steps":12,"ms":260}}
    //   {"key":"Escape"|"Tab"|"Enter"}  {"type":"текст"} (в элемент с фокусом)
    if (st.tap) {
      const [x, y] = st.tap;
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await sleep(40);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    if (st.swipe) {
      const { x, y, dx = 0, dy = 0, steps = 12, ms = 260 } = st.swipe;
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, e = 1 - Math.pow(1 - t, 2);
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * e, y: y + dy * e }] });
        await sleep(ms / steps);
      }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    if (st.key) {
      const map = { Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 } };
      const k = map[st.key] || { key: st.key, code: st.key };
      const mods = st.shift ? 8 : 0;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: mods, ...k });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: mods, ...k });
    }
    if (st.type) await send('Input.insertText', { text: st.type });
    if (st.eval) {
      const r = await send('Runtime.evaluate', { expression: st.eval, returnByValue: true, awaitPromise: true });
      results[st.label || `eval${Object.keys(results).length}`] = r.result?.value ?? r.exceptionDetails?.text;
    }
    if (st.shot) {
      const params = { format: 'png' };
      if (st.full) {
        const m = await send('Page.getLayoutMetrics');
        const h = Math.ceil(m.cssContentSize.height);
        params.captureBeyondViewport = true;
        params.clip = { x: 0, y: 0, width: vp.w, height: Math.min(h, st.maxH || 16000), scale: 1 };
      }
      const r = await send('Page.captureScreenshot', params);
      writeFileSync(st.shot, Buffer.from(r.data, 'base64'));
      results[st.shot] = 'ok';
    }
  }
  results.__errors = consoleErr;
  console.log(JSON.stringify(results, null, 1));
} catch (e) {
  console.error('CDP ошибка:', e.message);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill('SIGKILL');
}
