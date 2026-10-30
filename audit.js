/**
 * 桌面修仙 · 全面诊断脚本（可重复运行，用于优化前后对比）
 * 运行：node audit.js            → 打印报告
 *       node audit.js --json     → 输出 JSON 供脚本比对
 *
 * 覆盖六个维度：
 *   A 玩法机制   — 加成是否真的生效、目标是否可完成、事件是否有人监听
 *   B 数值平衡   — 成长曲线、主动/被动收益比、冥想实际倍率
 *   C 经济系统   — 产出/消耗闭环、套利空间、离线与在线是否一致
 *   D 交互体验   — 反馈缺口（成熟/满仓/失败是否有提示）
 *   E 性能       — DOM 变更次数、强制重排、节点泄漏、UI 单帧耗时
 *   F 健壮性     — 存档完整性、异常隔离、越界输入
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const JSON_MODE = process.argv.includes('--json');
const out = [];
const log = (s = '') => { if (!JSON_MODE) console.log(s); else out.push(s); };

// ============================================================
// 0. 装载环境
// ============================================================
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
const W = dom.window;
const document = W.document;

W.AudioContext = undefined;
W.navigator.vibrate = () => {};

for (const s of ['config.js', 'save.js', 'engine.js', 'features.js', 'systems.js', 'ui.js']) {
  const el = document.createElement('script');
  el.textContent = fs.readFileSync(path.join(__dirname, 'js', s), 'utf8');
  document.body.appendChild(el);
}

const G = (n) => W.eval(n);
const GameEngine = G('GameEngine');
const SaveSystem = G('SaveSystem');
const UI = G('UI');
const DailyGoals = G('DailyGoals');
const VisitorSystem = G('VisitorSystem');
const PetSystem = G('PetSystem');
const TechniqueSystem = G('TechniqueSystem');
const WeatherSystem = G('WeatherSystem');
const calcQ = G('calcQ');
const calcRate = G('calcRate');
const GameConfig = G('GameConfig');

const R = {};   // 结果集
const SRC = {};
for (const f of ['config.js', 'engine.js', 'features.js', 'systems.js', 'save.js', 'ui.js', 'app.js']) {
  SRC[f] = fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');
}
// 静态检查必须剥离注释：否则"注释里提到某个写法"会被误判成代码里存在该写法。
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const CODE = {};
for (const k of Object.keys(SRC)) CODE[k] = stripComments(SRC[k]);
const ALL = Object.values(CODE).join('\n');

// ============================================================
// A. 玩法机制完整性
// ============================================================
log('\n═══ A · 玩法机制完整性 ═══');

// A1 已定义但从未被消费的加成
// 判据：必须在"逻辑层"（engine/app）被真正读取或通过 getter 调用。
// 仅在 ui.js 里被读出来拼文案 **不算生效** —— 那是"宣传了但没实现"，
// 比静默失效更严重：界面对玩家做了明确承诺。
const bonusKeys = [...ALL.matchAll(/bonuses:\s*\{([^}]+)\}/g)]
  .flatMap(m => m[1].split(',').map(x => x.split(':')[0].trim()))
  .filter(Boolean);
const uniqueBonus = [...new Set(bonusKeys)];

const logicSrc = CODE['engine.js'] + CODE['app.js'] + CODE['save.js'] + CODE['features.js'];  // 逻辑层
const uiSrc = CODE['ui.js'];

const getterName = (k) => (k.endsWith('Bonus') ? k : k + 'Bonus');
const deadBonus = uniqueBonus.filter(k => {
  const direct = logicSrc.includes(`bonuses.${k}`) || logicSrc.includes(`bonuses['${k}']`);
  const viaGetter = logicSrc.includes(getterName(k));
  return !direct && !viaGetter;
});
const advertisedButDead = deadBonus.filter(k => uiSrc.includes(`bonuses.${k}`));
R.deadBonuses = deadBonus;
R.advertisedButDead = advertisedButDead;
log(`  加成字段共 ${uniqueBonus.length} 个，逻辑层未应用：${deadBonus.length} 个`);
if (deadBonus.length) log(`    → ${deadBonus.join(', ')}`);
log(`  其中界面已明示文案、实际不生效：${advertisedButDead.length} 个${advertisedButDead.length ? ' → ' + advertisedButDead.join(', ') : ''}`);

// A1b 配置项是否被真正使用（config 里定义但无人读取 = 假参数）
// 注意：calcQ/calcRate/getStatThresholds 的函数体读的是同名局部引用，要算已使用
const configBody = CODE['config.js'];
const configFnPart = configBody.slice(configBody.indexOf('function calcQ'));
const topKeys = [...configBody.matchAll(/^  ([a-zA-Z][a-zA-Z0-9]*):/gm)].map(m => m[1]);
const cfgConsumers = CODE['engine.js'] + CODE['features.js'] + CODE['systems.js'] + CODE['save.js'] + CODE['ui.js'] + CODE['app.js'];
const deadConfig = topKeys.filter(k => {
  const inConsumers = new RegExp(`(GameConfig\\.)?${k}\\b`).test(cfgConsumers);
  const inConfigFns = new RegExp(`GameConfig\\.${k}\\b`).test(configFnPart);
  return !inConsumers && !inConfigFns;
});
R.deadConfig = deadConfig;
log(`  配置项 ${topKeys.length} 个，无人读取：${deadConfig.length} 个${deadConfig.length ? ' → ' + deadConfig.join(', ') : ''}`);

// A2 日常目标：进度上报的 key 能否命中任务池
const poolKeys = [...CODE['features.js'].matchAll(/key:\s*'(\w+)'/g)].map(m => m[1]);
const incCalls = [...(CODE['app.js'] + CODE['ui.js']).matchAll(/DailyGoals\.increment\('(\w+)'/g)].map(m => m[1]);
const unmatched = [...new Set(incCalls)].filter(t => !poolKeys.includes(t));
R.dailyUnmatched = unmatched;
R.dailyPoolKeys = poolKeys;
log(`  任务池 key：${poolKeys.join('/')}`);
log(`  实际上报：${[...new Set(incCalls)].join('/')}`);
log(`  命中不了任务池的调用：${unmatched.length} 个 → ${unmatched.join(', ') || '无'}`);

// 未被任何调用点覆盖的 key（有任务但永远无法完成）
const uncovered = poolKeys.filter(k => !incCalls.includes(k));
R.dailyUncovered = uncovered;
log(`  永远无法完成的任务：${uncovered.length} 个 → ${uncovered.join(', ') || '无'}`);

// 动态验证：种一株能否推进「种植N株」
const plantGoal = DailyGoals._taskPool.find(t => t.key === 'plant');
DailyGoals._goals = [{ ...plantGoal, progress: 0, completed: false, claimed: false }];
DailyGoals.increment('plant', 1);
R.dailyPlantProgress = DailyGoals._goals[0].progress;
log(`  实测：种一株后「${plantGoal.name}」进度 = ${R.dailyPlantProgress}（期望 1）`);

// A3 发射了但无人监听的事件
const emitted = [...new Set([...ALL.matchAll(/_emit\('(\w+)'/g)].map(m => m[1]))];
const subscribed = [...new Set([...ALL.matchAll(/GameEngine\.on\('(\w+)'/g)].map(m => m[1]))];
const orphan = emitted.filter(e => !subscribed.includes(e));
R.orphanEvents = orphan;
log(`  发射事件 ${emitted.length} 个，无订阅者：${orphan.join(', ') || '无'}`);

// A4 事件派发是否隔离异常
const hasTryCatchInEmit = /_emit\s*\([^)]*\)\s*\{[\s\S]{0,600}?try\s*\{/.test(CODE['engine.js']);
R.emitIsolated = hasTryCatchInEmit;
log(`  事件派发异常隔离：${hasTryCatchInEmit ? '有' : '无（单个监听器抛错会中断后续派发）'}`);

// ============================================================
// B. 数值平衡
// ============================================================
log('\n═══ B · 数值平衡 ═══');

// B1 纯挂机到渡劫9层所需时间
let totalSec = 0;
const perRealm = [];
for (let r = 1; r <= 6; r++) {
  let realmSum = 0;
  for (let lv = 1; lv <= 9; lv++) realmSum += calcQ(r, lv, 1.0) / calcRate(r, false, false);
  perRealm.push(realmSum);
  totalSec += realmSum;
}
R.timeToMaxHours = totalSec / 3600;
R.timePerRealmMin = perRealm.map(s => +(s / 60).toFixed(1));
log(`  纯挂机通关（1→渡劫9）：${(totalSec / 3600).toFixed(2)} 小时`);
log(`  各大境界耗时(分钟)：${R.timePerRealmMin.join(' / ')}`);

// B2 冥想实际倍率 —— 直接实测引擎行为，不重算公式（公式会随实现漂移）
const medRows = [];
for (let r = 1; r <= 6; r++) {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = r;
  GameEngine.state.level = 1;
  GameEngine.state.cultivation = 0;
  const base = calcRate(r, false, false);   // 纯挂机速率（点/秒）

  // 坐满入定后用极小步长测 1 秒内的增量
  GameEngine._isMeditating = true;
  GameEngine._depth = 1;
  GameEngine._meditateTimer = 0;
  const before = GameEngine.state.cultivation;
  GameEngine._tickCultivation(1.0);   // 被动部分
  GameEngine._tickMeditation(1.0);    // 打坐加成部分
  const gained = GameEngine.state.cultivation - before;
  GameEngine._isMeditating = false;

  medRows.push({ realm: r, base: +base.toFixed(2), actual: +(gained / base).toFixed(2) });
}
R.meditationByRealm = medRows;
log(`  冥想实测总倍率（相对纯挂机）：${medRows.map(x => `R${x.realm}=×${x.actual}`).join(' ')}`);
const medSpread = Math.max(...medRows.map(x => x.actual)) - Math.min(...medRows.map(x => x.actual));
log(`    → 各境界倍率极差 ${medSpread.toFixed(2)}（越小说明不随境界衰减）`);

// B3 练剑实测 DPS（按住连发的最坏情况）
GameEngine.state = SaveSystem.createDefault();
GameEngine._swordCombo = 0;
const strikes = 20;
let swordTotal = 0;
for (let i = 0; i < strikes; i++) swordTotal += GameEngine.swordStrike();
const strikesPerSec = 1000 / GameConfig.swordHoldInterval;
R.rates = {
  idle: calcRate(1, false, false),
  swordDps: +(swordTotal / strikes * strikesPerSec).toFixed(1),
  swordsPerSec: strikesPerSec,
};
R.swordRatio = +(R.rates.swordDps / R.rates.idle).toFixed(1);
log(`  R1 练剑全程连击 DPS ≈ ${R.rates.swordDps}/秒（${strikesPerSec} 剑/秒），为挂机的 ${R.swordRatio} 倍`);
log(`  对比：冥想满入定 ${medRows[0].actual} 倍 / 挂机 1 倍`);

// B2b 可持续冥想倍率：打坐 60 秒会被强制中断、入定清零，
// 所以「峰值 ×4.5」不是玩家实际长时间能拿到的收益，需要按整个循环取均值。
{
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.cultivation = 0;
  const baseRate = calcRate(1, false, false);
  GameEngine._isMeditating = true;
  GameEngine._depth = 0;
  GameEngine._meditateTimer = 0;
  let total = 0, steps = 0;
  const STEP = 0.1;
  for (let t = 0; t < GameConfig.maxMeditationSeconds - STEP; t += STEP) {
    const b = GameEngine.state.cultivation;
    GameEngine._tickCultivation(STEP);
    GameEngine._tickMeditation(STEP);
    total += GameEngine.state.cultivation - b;
    steps++;
    if (GameEngine.state.cultivation >= calcQ(1, 1, 1.0) - 1) break; // 别把上限算进去
  }
  GameEngine._isMeditating = false;
  R.meditationSustainable = +(total / (steps * STEP) / baseRate).toFixed(2);
  log(`  可持续冥想倍率（60 秒循环均值）：×${R.meditationSustainable}`);
}

// B4 突破溢出缓冲是否被消费（读到了并结转才算生效，只清零等于丢弃）
const btBody = CODE['engine.js'].split('tryBreakthrough')[1]?.slice(0, 2000) || '';
const bufferWritten = /bufferedCultivation\s*\+=|bufferedCultivation\s*=\s*Math\.min/.test(CODE['engine.js']);
const bufferRead = /(carryOver|carry)\s*=\s*this\.state\.bufferedCultivation|Math\.min\(this\.state\.bufferedCultivation/.test(btBody);
R.bufferDiscarded = /bufferedCultivation\s*=\s*0/.test(btBody) && !bufferRead;
log(`  修为溢出缓冲：写入=${bufferWritten ? '有' : '无'}，突破时结转=${bufferRead ? '有' : '无（缓冲形同虚设）'}`);

// ============================================================
// C. 经济系统
// ============================================================
log('\n═══ C · 经济系统 ═══');

// C1 集市套利
let arbitrage = [];
for (const sell of GameConfig.shop.sell) {
  const buy = GameConfig.shop.buy.find(b => b.id === sell.id);
  if (!buy) continue;
  const sellUnit = sell.price / sell.amount;
  const buyUnit = buy.price / buy.amount;
  arbitrage.push({ id: sell.id, sellUnit, buyUnit, ok: buyUnit > sellUnit });
}
R.arbitrage = arbitrage;
log(`  集市单价（卖→买）：${arbitrage.map(a => `${a.id} ${a.sellUnit.toFixed(1)}→${a.buyUnit.toFixed(1)}${a.ok ? ' ✅' : ' ❌套利'}`).join(' · ')}`);

// C2 作物单位时间净收益
const cropRows = GameConfig.crops.map(c => ({
  name: c.name,
  net: c.yield - c.seedCost,
  perHour: +(((c.yield - c.seedCost) / c.growthTime) * 3600).toFixed(1),
}));
R.crops = cropRows;
log(`  作物净收益(株/小时)：${cropRows.map(c => `${c.name} ${c.perHour}`).join(' · ')}`);

// C3 离线 vs 在线
const st = SaveSystem.createDefault();
st.lastSaveTicks = Date.now() - 3600 * 1000;
const off = SaveSystem.calculateOfflineGains(st, Date.now());
const onlineRate = calcRate(1, false, false);
R.offline = {
  cultivationPerHour: Math.round(off.cultivation),
  onlinePerHour: Math.round(onlineRate * 3600),
  herbPerHour: off.herb,
  plotsUsed: GameConfig.startingPlots,
};
log(`  离线/在线修为比：${(off.cultivation / (onlineRate * 3600) * 100).toFixed(1)}%（bgRateMult=${GameConfig.bgRateMult}，理论 ${(GameConfig.bgRateMult * 100).toFixed(0)}%）`);

// 离线灵草是否随已开垦地块增长
const st8 = SaveSystem.createDefault();
st8.unlockedPlots = 8;
st8.lastSaveTicks = Date.now() - 3600 * 1000;
const off8 = SaveSystem.calculateOfflineGains(st8, Date.now());
R.offlineHerbScaling = { plots3: off.herb, plots8: off8.herb, scales: off8.herb !== off.herb };
log(`  离线灵草：3 块地 ${off.herb} · 8 块地 ${off8.herb} → ${off8.herb === off.herb ? '❌ 不随地块数增长（写死起始地块）' : '✅ 随地块增长'}`);

// C4 存档导出是否包含宠物/功法
const exportSrc = CODE['save.js'].split('exportFile(')[1]?.slice(0, 1500) || '';
R.exportIncludesPets = /dxy_pets|PetSystem|_collectExtras/.test(exportSrc);
R.exportIncludesTech = /dxy_techniques|TechniqueSystem|_collectExtras/.test(exportSrc);
log(`  导出存档是否含宠物/功法：宠物=${R.exportIncludesPets ? '是' : '否'}，功法=${R.exportIncludesTech ? '是' : '否'}`);

// ============================================================
// D. 交互反馈缺口
// ============================================================
log('\n═══ D · 交互反馈 ═══');
// 只把"玩家能感知到的状态变化"算作反馈点；craftingStarted 之类内部流程事件
// 已有 toast 覆盖，不算缺口。
const feedback = {
  cropReady: orphan.includes('plotReady'),
  resourceFull: orphan.includes('resourceFull'),
};
R.feedbackGaps = Object.entries(feedback).filter(([, v]) => v).map(([k]) => k);
log(`  无反馈的关键节点：${R.feedbackGaps.join(', ') || '无'}`);

// ============================================================
// E. 性能
// ============================================================
log('\n═══ E · 性能（模拟 30 秒正常游玩）═══');

GameEngine.state = SaveSystem.createDefault();
GameEngine.state.herb = 100;
GameEngine.state.dew = 30;
GameEngine.state.ore = 20;
GameEngine.state.unlockedPlots = 5;
for (let i = 0; i < 5; i++) GameEngine.plant(i, 'herb_qingling');
UI._hudCache = {}; UI._cvCache = {};
UI.showTab('cultivation');

let mutations = 0;
const mo = new W.MutationObserver(recs => { mutations += recs.length; });
mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });

let reflows = 0;
const patchReflow = (proto, prop) => {
  const orig = Object.getOwnPropertyDescriptor(proto, prop);
  if (!orig) return;
  Object.defineProperty(proto, prop, {
    configurable: true,
    get() { reflows++; return orig.get ? orig.get.call(this) : 0; },
    set: orig.set,
  });
};
patchReflow(W.HTMLElement.prototype, 'offsetWidth');
patchReflow(W.HTMLElement.prototype, 'offsetHeight');
const origGBCR = W.Element.prototype.getBoundingClientRect;
W.Element.prototype.getBoundingClientRect = function () { reflows++; return origGBCR.call(this); };

const nodesBefore = document.querySelectorAll('*').length;
const TICKS = 300;               // 30 秒 × 10Hz
const t0 = process.hrtime.bigint();
for (let i = 0; i < TICKS; i++) {
  GameEngine._lastTick = Date.now() - 100;
  GameEngine.tick();
  WeatherSystem.tick(0.1);
  UI.refreshAll();
}
const t1 = process.hrtime.bigint();
mutations += mo.takeRecords().length;   // 回调是异步的，必须同步取回队列
const nodesAfter = document.querySelectorAll('*').length;

const uiMs = Number(t1 - t0) / 1e6;
R.perf = {
  ticks: TICKS,
  mutations,
  mutationsPerSec: +(mutations / (TICKS * 0.1)).toFixed(1),
  reflows,
  reflowsPerTick: +(reflows / TICKS).toFixed(2),
  nodeGrowth: nodesAfter - nodesBefore,
  uiMsTotal: +uiMs.toFixed(1),
  uiMsPerTick: +(uiMs / TICKS).toFixed(3),
};
log(`  DOM 变更：${mutations} 次 / 30 秒（${R.perf.mutationsPerSec}/秒）`);
log(`  强制重排：${reflows} 次（${R.perf.reflowsPerTick} 次/tick）`);
log(`  节点数变化：${nodesBefore} → ${nodesAfter}（${R.perf.nodeGrowth >= 0 ? '+' : ''}${R.perf.nodeGrowth}）`);
log(`  UI 刷新耗时：${R.perf.uiMsTotal}ms / 300 tick（${R.perf.uiMsPerTick} ms/tick）`);

// E2 长跑节点泄漏（模拟 10 分钟）
const n0 = document.querySelectorAll('*').length;
GameEngine.state.plots.forEach(p => { if (p.state === 'empty') p.state = 'ready'; });
for (let i = 0; i < 600; i++) {
  GameEngine._lastTick = Date.now() - 100;
  GameEngine.tick();
  UI.refreshAll(true);   // 强制全量重建，最容易暴露泄漏
}
R.perf.leakNodes = document.querySelectorAll('*').length - n0;
log(`  10 分钟强制全量重建后节点增量：${R.perf.leakNodes >= 0 ? '+' : ''}${R.perf.leakNodes}`);

// ============================================================
// F. 健壮性
// ============================================================
log('\n═══ F · 健壮性 ═══');

// F1 越界 / 异常输入
const cases = [
  ['plant(-1)', () => GameEngine.plant(-1, 'herb_qingling')],
  ['plant(99)', () => GameEngine.plant(99, 'herb_qingling')],
  ['plant(0,"不存在")', () => GameEngine.plant(0, 'nope')],
  ['water(99)', () => GameEngine.water(99)],
  ['harvest(99)', () => GameEngine.harvest(99)],
  ['sellOffer(99)', () => GameEngine.sellOffer(99)],
  ['buyOffer(-5)', () => GameEngine.buyOffer(-5)],
  ['useCultivationPill(空)', () => GameEngine.useCultivationPill()],
  ['tryBreakthrough(满属性)', () => { GameEngine.state.cultivation = 1e9; return GameEngine.tryBreakthrough(); }],
  ['rebirth(未圆满)', () => GameEngine.rebirth()],
];
let survived = 0;
const thrown = [];
for (const [name, fn] of cases) {
  try { fn(); survived++; } catch (e) { thrown.push(`${name}: ${e.message}`); }
}
R.robustness = { total: cases.length, survived, thrown };
log(`  越界/异常调用 ${cases.length} 例，未抛异常 ${survived} 例`);
if (thrown.length) thrown.forEach(t => log(`    ❌ ${t}`));

// F2 存档版本不匹配的降级行为
const loadSrc = CODE['save.js'].split('load()')[1]?.slice(0, 900) || '';
R.saveMigrates = /migrat|upgrade|_migrate/i.test(loadSrc);
log(`  存档版本迁移：${R.saveMigrates ? '有' : '无（版本号一改，旧档直接丢弃）'}`);

// F3 备份槽轮转
R.backupRotation = /Date\.now\(\)\s*%/.test(CODE['save.js']);
log(`  备份轮转方式：${R.backupRotation ? 'Date.now()%3（易重复覆盖同一槽）' : '顺序轮转'}`);

// ============================================================
// 汇总
// ============================================================
const p0 = [];
const p1 = [];
const p2 = [];
if (R.dailyUnmatched.length || R.dailyUncovered.length) p0.push(`日常目标无法推进（未命中 ${R.dailyUnmatched.length} 处，无入口 ${R.dailyUncovered.length} 个）`);
if (R.deadBonuses.length) p0.push(`${R.deadBonuses.length} 个付费加成从未生效`);
if (!R.exportIncludesPets || !R.exportIncludesTech) p0.push('导出存档丢失宠物/功法');
if (R.offlineHerbScaling && !R.offlineHerbScaling.scales) p1.push('离线灵草不随地块数增长');
if (R.meditationByRealm && (Math.max(...R.meditationByRealm.map(x => x.actual)) - Math.min(...R.meditationByRealm.map(x => x.actual))) > 0.5) {
  p1.push('冥想倍率随境界衰减');
}
if (R.swordRatio && R.swordRatio > 20) p1.push(`练剑收益为挂机 ${R.swordRatio} 倍，挤压其他玩法`);
if (R.bufferDiscarded) p1.push('修为溢出缓冲被直接丢弃');
if (R.perf && R.perf.mutationsPerSec > 20) p1.push(`DOM 变更 ${R.perf.mutationsPerSec}/秒，偏高`);
if (R.feedbackGaps && R.feedbackGaps.length) p2.push(`关键节点无反馈：${R.feedbackGaps.join('/')}`);
if (!R.saveMigrates) p2.push('无存档版本迁移');
if (R.backupRotation) p2.push('备份槽位轮转不均');

R.summary = { p0, p1, p2 };
log('\n═══ 分级汇总 ═══');
log(`  P0 阻断：${p0.length}`);
p0.forEach(x => log(`    · ${x}`));
log(`  P1 重要：${p1.length}`);
p1.forEach(x => log(`    · ${x}`));
log(`  P2 改进：${p2.length}`);
p2.forEach(x => log(`    · ${x}`));

if (JSON_MODE) {
  console.log(JSON.stringify(R, null, 2));
} else {
  fs.writeFileSync(path.join(__dirname, 'audit-report.json'), JSON.stringify(R, null, 2));
  console.log('\n结果已写入 audit-report.json');
}

// ============================================================
// E3. DOM 变更热点（定位是哪些元素在抖）
// ============================================================
if (!JSON_MODE) {
  const hot = {};
  const mo2 = new W.MutationObserver(recs => {
    for (const r of recs) {
      let key;
      if (r.type === 'attributes') key = `attr:${r.attributeName}@${r.target.id || r.target.className || r.target.nodeName}`;
      else if (r.type === 'characterData') key = `text@${r.target.parentElement?.id || r.target.parentElement?.className || '?'}`;
      else key = `child@${r.target.id || r.target.className || r.target.nodeName}`;
      hot[key] = (hot[key] || 0) + 1;
    }
  });
  mo2.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  for (let i = 0; i < 100; i++) {
    GameEngine._lastTick = Date.now() - 100;
    GameEngine.tick();
    WeatherSystem.tick(0.1);
    UI.refreshAll();
  }
  const recs = mo2.takeRecords();
  for (const r of recs) {
    let key;
    if (r.type === 'attributes') key = `attr:${r.attributeName}@${r.target.id || r.target.className || r.target.nodeName}`;
    else if (r.type === 'characterData') key = `text@${r.target.parentElement?.id || r.target.parentElement?.className || '?'}`;
    else key = `child@${r.target.id || r.target.className || r.target.nodeName}`;
    hot[key] = (hot[key] || 0) + 1;
  }
  mo2.disconnect();
  const top = Object.entries(hot).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log('\n  DOM 变更热点（100 tick 采样，Top10）：');
  top.forEach(([k, v]) => console.log(`    ${String(v).padStart(4)}×  ${k}`));
}
