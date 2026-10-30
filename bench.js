/**
 * 桌面修仙 · UI 刷新基准（受控 A/B 用）
 * 运行：node bench.js [目标目录]
 *   不带参数 → 测当前目录
 *   带目录   → 测指定副本，用于优化前后对比
 *
 * 只测两件确定性的事：
 *   tick()        —— 引擎一帧逻辑
 *   refreshAll()  —— 一次完整 UI 刷新（10Hz 调用）
 * 不计 MutationObserver 开销，避免测量工具本身污染结果。
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dir = process.argv[2] ? path.resolve(process.argv[2]) : __dirname;

const dom = new JSDOM(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), {
  url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
});
const W = dom.window;
const document = W.document;
W.AudioContext = undefined;
W.navigator.vibrate = () => {};

for (const s of ['config.js', 'save.js', 'engine.js', 'features.js', 'systems.js', 'sect.js', 'disciples.js', 'ui.js']) {
  const el = document.createElement('script');
  el.textContent = fs.readFileSync(path.join(dir, 'js', s), 'utf8');
  document.body.appendChild(el);
}

const G = (n) => W.eval(n);
const UI = G('UI');
const GameEngine = G('GameEngine');
const WeatherSystem = G('WeatherSystem');
const SaveSystem = G('SaveSystem');

GameEngine.state = SaveSystem.createDefault();
UI.showTab('cultivation');

// 预热，让 JIT 完成
for (let i = 0; i < 50; i++) {
  GameEngine._lastTick = Date.now() - 100;
  GameEngine.tick();
  WeatherSystem.tick(0.1);
  UI.refreshAll();
}

const bench = (fn, n) => {
  const t = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn();
  return Number(process.hrtime.bigint() - t) / 1e6 / n;
};

const N = 500;
const tickMs = bench(() => {
  GameEngine._lastTick = Date.now() - 100;
  GameEngine.tick();
  WeatherSystem.tick(0.1);
}, N);
const refreshMs = bench(() => UI.refreshAll(), N);

// 10Hz 下的单帧预算占用（一帧 100ms）
const perFrame = (tickMs + refreshMs) * 10;

console.log(JSON.stringify({
  dir: path.basename(dir),
  tickMs: +tickMs.toFixed(4),
  refreshMs: +refreshMs.toFixed(4),
  perSecondMs: +((tickMs + refreshMs) * 10).toFixed(2),
  frameBudgetPct: +perFrame.toFixed(2),
}, null, 2));
