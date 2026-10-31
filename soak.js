/**
 * 桌面修仙 · 长稳测试（真实浏览器 + CDP）
 *
 * 与 smoke.html 的分工：
 *   smoke  = 冒烟，虚拟时间快进，验证"功能跑得通"
 *   soak   = 长稳，挂着跑一段时间，验证"挂久了会不会烂"
 *
 * 重要前提（本机实测结论，不是猜测）
 * ------------------------------------------------
 * 无头 Edge 在该版本下**不为页面产生合成帧**：
 *   headless=new   3 秒 1 帧
 *   headless=old   3 秒 1 帧
 *   screencast     3 秒 1 帧
 *   虚拟时间推进    3 秒 1 帧
 * 即 requestAnimationFrame 在无头下几乎不跑，游戏主循环会停摆。
 * 所以提供两种模式并如实标注各自测的是什么：
 *
 *   --headful   开真实窗口跑真 rAF。真实帧率与真实内存曲线（推荐）。
 *   （默认）     无头 + 测试端 setInterval 驱动 tick。
 *                只用于查内存/节点/状态泄漏，**不代表真实帧率**。
 *
 * 用法：
 *   node soak.js --minutes 5 --headful
 *   node soak.js --minutes 5
 *   node soak.js --minutes 5 --interval 15
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const ROOT = __dirname;
const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const argOf = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const MINUTES = Number(argOf('--minutes', 3));
const INTERVAL_S = Number(argOf('--interval', 10));
const HEADFUL = has('--headful');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function findBrowser() {
  const list = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  return list.find(p => fs.existsSync(p)) || null;
}

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* retry */ }
    await sleep(200);
  }
  throw new Error(`等待超时：${label}`);
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    server.__port = server.address().port;
    resolve(server);
  }));
}

function connectCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('CDP 连接失败'));
  });
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  return {
    ready,
    send(method, params) {
      const msgId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
      });
    },
    close() { try { ws.close(); } catch (e) { /* ignore */ } },
  };
}

async function main() {
  const browser = findBrowser();
  if (!browser) { console.error('未找到 Edge / Chrome'); process.exit(1); }

  console.log(`浏览器：${browser}`);
  console.log(`模式：${HEADFUL ? '真实窗口（真 rAF，需保持窗口在前台）' : '无头 + 测试端驱动（仅查泄漏）'}`);
  console.log(`时长：${MINUTES} 分钟，采样间隔 ${INTERVAL_S}s\n`);

  const server = await startStaticServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dx-soak-'));
  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-precise-memory-info',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    // 窗口被遮挡时 Chromium 会降频 rAF，长稳必须关掉，否则测到的是节流后的假数据
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--window-size=1200,900',
  ];
  if (!HEADFUL) args.unshift('--headless=new');

  const child = spawn(browser, args, { stdio: 'ignore' });

  let cdp = null;
  const cleanup = () => {
    if (cdp) cdp.close();
    try { child.kill(); } catch (e) { /* ignore */ }
    try { server.close(); } catch (e) { /* ignore */ }
  };
  process.on('SIGINT', () => { cleanup(); process.exit(0); });

  try {
    const cdpPort = await waitFor(async () => {
      const f = path.join(profile, 'DevToolsActivePort');
      if (!fs.existsSync(f)) return null;
      const n = parseInt(fs.readFileSync(f, 'utf8').split('\n')[0], 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    }, 20000, 'DevToolsActivePort');

    const targets = await waitFor(async () => {
      const r = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      const list = await r.json();
      return list.find(t => t.type === 'page') ? list : null;
    }, 20000, 'CDP 页面目标');

    const page = targets.find(t => t.type === 'page');
    cdp = connectCDP(page.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.__port}/index.html` });

    await waitFor(async () => {
      const r = await cdp.send('Runtime.evaluate', {
        // GameEngine 是 const 全局词法绑定，不挂在 window 上
        expression: "(typeof GameEngine !== 'undefined') && !!GameEngine.state",
        returnByValue: true,
      });
      return r.result.value === true;
    }, 15000, '游戏初始化');
    await sleep(1500);

    const injectExpr = `(function(){
      if (window.__soak) return 'already';
      window.__soak = { ticks: 0, errors: 0 };
      var orig = GameEngine.tick.bind(GameEngine);
      GameEngine.tick = function(){ window.__soak.ticks++; return orig(); };
      window.addEventListener('error', function(){ window.__soak.errors++; });
      if (${HEADFUL ? 'false' : 'true'}) {
        setInterval(function(){
          try {
            GameEngine.tick();
            if (typeof WeatherSystem !== 'undefined') WeatherSystem.tick(0.1);
            if (!document.hidden) UI.refreshAll();
          } catch (e) { window.__soak.errors++; }
        }, 100);
      }
      return 'ok';
    })()`;

    const inject = await cdp.send('Runtime.evaluate', { expression: injectExpr, returnByValue: true });
    if (inject.result.value !== 'ok') console.log(`注入：${inject.result.value}`);

    const sampleExpr = `JSON.stringify({
      heap: performance.memory ? performance.memory.usedJSHeapSize : 0,
      nodes: document.querySelectorAll('*').length,
      ticks: window.__soak.ticks,
      errors: window.__soak.errors,
      realm: GameEngine.state.realm,
      cultivation: Math.round(GameEngine.state.cultivation),
      banner: !!document.getElementById('fatal-banner')
    })`;

    const rows = [];
    const total = Math.max(1, Math.round(MINUTES * 60 / INTERVAL_S));
    console.log('  时间   堆(MB)   节点   tick  tick/s  修为  错误');
    console.log('  ' + '-'.repeat(54));

    let prev = null;
    for (let i = 0; i <= total; i++) {
      const r = await cdp.send('Runtime.evaluate', { expression: sampleExpr, returnByValue: true });
      const d = JSON.parse(r.result.value);
      const rate = prev ? (d.ticks - prev.ticks) / INTERVAL_S : 0;
      rows.push({ ...d, at: i * INTERVAL_S, rate });
      console.log(
        `  ${String(i * INTERVAL_S).padStart(4)}s  ${(d.heap / 1048576).toFixed(2).padStart(6)}  ` +
        `${String(d.nodes).padStart(5)}  ${String(d.ticks).padStart(6)}  ${rate.toFixed(1).padStart(5)}  ` +
        `${String(d.cultivation).padStart(4)}  ${String(d.errors).padStart(4)}` +
        (d.banner ? '  WARN' : '')
      );
      prev = d;
      if (i < total) await sleep(INTERVAL_S * 1000);
    }

    const warm = rows.slice(Math.floor(rows.length / 4));
    const first = warm[0];
    const last = warm[warm.length - 1];
    // 用前后半段均值比较，避免撞上 GC 锯齿导致误判
    const half = Math.max(1, Math.floor(warm.length / 2));
    const avg = (arr) => arr.reduce((a, b) => a + b.heap, 0) / Math.max(1, arr.length);
    const heapFirstHalf = avg(warm.slice(0, half)) / 1048576;
    const heapSecondHalf = avg(warm.slice(half)) / 1048576;
    const heapGrowMB = heapSecondHalf - heapFirstHalf;
    const nodeGrow = last.nodes - first.nodes;
    const tickRate = (last.ticks - first.ticks) / Math.max(1, last.at - first.at);
    const spanMin = Math.max(0.01, (last.at - first.at) / 60);

    console.log(`\n  -- 判定（跳过预热，观察 ${spanMin.toFixed(1)} 分钟）--`);
    console.log(`  堆均值：前半 ${heapFirstHalf.toFixed(2)} MB → 后半 ${heapSecondHalf.toFixed(2)} MB` +
      `（${heapGrowMB >= 0 ? '+' : ''}${heapGrowMB.toFixed(2)} MB）`);
    console.log(`  节点增长：${nodeGrow >= 0 ? '+' : ''}${nodeGrow}`);
    console.log(`  tick 频率：${tickRate.toFixed(2)} 次/秒${HEADFUL ? '（真 rAF，设计值 10）' : '（测试端驱动）'}`);
    console.log(`  运行时错误：${last.errors}`);

    const problems = [];
    if (last.errors > 0) problems.push(`出现 ${last.errors} 次运行时错误`);
    if (last.banner) problems.push('出现异常降级横幅');
    if (nodeGrow > 200) problems.push(`节点持续增长 ${nodeGrow}（疑似泄漏）`);
    if (heapGrowMB > 0.5) problems.push(`堆均值上升 ${heapGrowMB.toFixed(2)} MB（疑似泄漏）`);
    // headful 下窗口一旦被遮挡/最小化，Chromium 就会把 rAF 降到 0，
    // 这是测量环境问题而非游戏问题，所以只提示、不计入失败项。
    const throttled = HEADFUL && tickRate < 8;

    if (throttled) {
      console.log('\n  注意：真实帧率偏低，通常是窗口被遮挡或最小化导致 Chromium 节流。');
      console.log('       请把浏览器窗口切到前台后重跑 --headful，否则帧率数据不可信。');
    }
    console.log('\n  ' + (problems.length === 0
      ? 'PASS 长稳通过：无泄漏迹象、无异常'
      : 'WARN 发现问题：\n    - ' + problems.join('\n    - ')));
  } finally {
    cleanup();
  }
}

main().catch(e => { console.error('长稳测试失败：', e.message); process.exit(1); });
