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

for (const s of ['config.js', 'save.js', 'engine.js', 'features.js', 'systems.js', 'sect.js', 'disciples.js', 'ui.js']) {
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
const SectSystem = G('SectSystem');
const DelveSystem = G('DelveSystem');
const DiscipleSystem = G('DiscipleSystem');
const calcQ = G('calcQ');
const getStatThresholds = G('getStatThresholds');
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

// ============================================================
// G. 时间连续性（放置游戏的核心承诺：离开也在长）
// ============================================================
log('\n═══ G · 时间连续性 ═══');

// G1 端到端：切后台 10 分钟再回来（真实用户流程：hidden → visible → 补算 → 继续 tick）
// 放在渡劫期测，避免被 100 点的低境界上限截断
const AWAY_REALM = 6;
{
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = AWAY_REALM;
  GameEngine.state.level = 1;
  GameEngine.state.cultivation = 0;
  GameEngine._lastTick = Date.now();

  GameEngine._setBackground(true);                 // 隐藏
  GameEngine._lastTick = Date.now() - 600 * 1000; // 期间没有任何 tick
  GameEngine._setBackground(false);               // 回到前台
  GameEngine.tick();                              // 循环恢复第一帧

  const got = GameEngine.state.cultivation;
  const should = calcRate(AWAY_REALM, false, false) * GameConfig.bgRateMult * 600;
  R.awayKeep = +(got / should * 100).toFixed(1);
  log(`  G1 切后台 10 分钟（端到端）：实得 ${got.toFixed(0)} 点 / 应得 ${should.toFixed(0)} 点 → 保留 ${R.awayKeep}%`);
}

// G1b 极端情况：浏览器根本没有派发 visibilitychange，只是把 rAF 停了
// 此时只能靠 dt 钳制，收益会大量丢失——属于无法完全消除的残余风险，单独记录。
{
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = AWAY_REALM;
  GameEngine.state.level = 1;
  GameEngine.state.cultivation = 0;
  GameEngine._lastTick = Date.now() - 600 * 1000;
  GameEngine.tick();
  const got = GameEngine.state.cultivation;
  const should = calcRate(AWAY_REALM, false, false) * GameConfig.bgRateMult * 600;
  R.awayKeepNoEvent = +(got / should * 100).toFixed(1);
  log(`  G1b 无 visibilitychange 事件（仅 dt 钳制）：保留 ${R.awayKeepNoEvent}% —— 残余风险`);
}

// G2 回前台是否有补算
{
  GameEngine.state = SaveSystem.createDefault();
  GameEngine._lastTick = Date.now() - 300 * 1000;
  GameEngine._setBackground(true);
  const before = GameEngine.state.cultivation;
  GameEngine._setBackground(false);          // 回前台
  const caught = GameEngine.state.cultivation - before;
  R.hasCatchUp = caught > 1;
  log(`  G2 后台→前台补算量：${caught.toFixed(2)} 点 → ${R.hasCatchUp ? '有补算' : '无补算'}`);
}

// G3 隐藏时是否落盘（移动端常直接杀进程，beforeunload 不一定触发）
{
  const appSrc = CODE['app.js'];
  R.saveOnHidden = /visibilitychange[\s\S]{0,400}SaveSystem\.save/.test(appSrc);
  R.saveOnUnload = /beforeunload/.test(appSrc);
  log(`  G3 隐藏时存档：${R.saveOnHidden ? '有' : '无'} · 卸载时存档：${R.saveOnUnload ? '有' : '无'}`);
}

// G4 重载后的离线结算（对照组，这条本来就完整）
{
  const st = SaveSystem.createDefault();
  st.lastSaveTicks = Date.now() - 600 * 1000;
  const off = SaveSystem.calculateOfflineGains(st, Date.now());
  R.reloadKeep = +(off.cultivation / (calcRate(1, false, false) * GameConfig.bgRateMult * 600) * 100).toFixed(1);
  log(`  G4 关闭重开 10 分钟：保留 ${R.reloadKeep}%（对照组）`);
}

// ============================================================
// H. 经济约束力
// ============================================================
log('\n═══ H · 经济约束力 ═══');
{
  const plotSink = GameConfig.plotCosts.reduce((a, b) => a + b, 0);

  let techSink = 0;
  for (const m of CODE['systems.js'].matchAll(/cost:\s*(\d+)/g)) techSink += Number(m[1]);

  // 宠物升级：upgradeCost × level，1..maxLevel-1 次
  let petSink = 0;
  const petRe = /upgradeCost:\s*(\d+),[\s\S]{0,40}?maxLevel:\s*(\d+)/g;
  let pm;
  while ((pm = petRe.exec(CODE['systems.js'])) !== null) {
    const base = Number(pm[1]), max = Number(pm[2]);
    for (let lv = 1; lv < max; lv++) petSink += base * lv;
  }

  const totalSink = plotSink + techSink + petSink;

  // 稳态收入：灵草净产 → 灵石
  const c0 = GameConfig.crops[0];
  const herbPerHourPerPlot = (c0.yield - c0.seedCost) / c0.growthTime * 3600;
  const sellOffer0 = GameConfig.shop.sell.find(s => s.id === 'herb');
  const stonePerHerb = sellOffer0.price / sellOffer0.amount;
  const income3 = herbPerHourPerPlot * GameConfig.startingPlots * stonePerHerb;
  const income8 = herbPerHourPerPlot * GameConfig.maxPlots * stonePerHerb;

  R.economy = {
    totalSink, plotSink, techSink, petSink,
    incomePerHour3Plots: Math.round(income3),
    incomePerHour8Plots: Math.round(income8),
    hoursToBuyAll3: +(totalSink / income3).toFixed(1),
    hoursToBuyAll8: +(totalSink / income8).toFixed(1),
  };
  log(`  灵石沉没口合计：${totalSink}（扩地 ${plotSink} + 功法 ${techSink} + 宠物 ${petSink}）`);
  log(`  稳态收入：3 块地 ${Math.round(income3)}/h · 8 块地 ${Math.round(income8)}/h`);
  log(`  买完全部需：${(totalSink / income3).toFixed(1)}h（3 块地）/ ${(totalSink / income8).toFixed(1)}h（8 块地）`);
  log(`  买完之后：无任何灵石消耗口`);
}


// ============================================================
// I. 多标签页并发
// ============================================================

log('\n═══ I · 多标签页并发 ═══');
{
  const appSrc = CODE['app.js'] + CODE['ui.js'] + CODE['save.js'];
  R.hasStorageListener = /addEventListener\('storage'/.test(appSrc);
  R.hasSingleTabLock = /BroadcastChannel|navigator\.locks/.test(appSrc);
  log(`  跨标签页监听(storage)：${R.hasStorageListener ? '有' : '无'}`);
  log(`  单写者锁：${R.hasSingleTabLock ? '有' : '无（两个标签页会互相覆盖存档）'}`);
  log(`  自动存档间隔 60s → 冲突时最多丢失 60 秒操作`);
}



// ============================================================
// J. 奖励尺度一致性（绝对点数额度会随境界漂移）
// ============================================================
log('\n═══ J · 奖励尺度一致性 ═══');
{
  // 访客修为奖励是写死的绝对点数，看看它相对当前层上限是多少
  const visitorPts = [];
  const re = /reward:\s*\{\s*cultivation:\s*(\d+)\s*\}/g;
  let m;
  while ((m = re.exec(CODE['features.js'])) !== null) visitorPts.push(Number(m[1]));
  const uniqPts = [...new Set(visitorPts)].sort((a, b) => a - b);

  const rows = [];
  for (const pts of uniqPts) {
    const pct = [];
    for (let r = 1; r <= 6; r++) {
      const cap = calcQ(r, 1, 1.0);
      // 实际发放量 = min(基值 × η(R), 上限半层)，与 features.js 保持一致
      const gain = Math.min(pts * Math.pow(GameConfig.realmRateMult, r - 1), cap * 0.5);
      pct.push(+(gain / cap * 100).toFixed(1));
    }
    rows.push({ pts, pct });
  }
  R.visitorScale = rows;
  const maxPts = uniqPts[uniqPts.length - 1];
  const top = rows.find(x => x.pts === maxPts);
  log(`  访客最高修为奖励 ${maxPts} 点，实际发放占各境界首层上限：${top.pct.map((p, i) => `R${i + 1} ${p}%`).join(' ')}`);
  log(`    → 同一份奖励在 R1 相当于 ${top.pct[0]}% 一层，在 R6 为 ${top.pct[5]}%`);

  // 日常目标奖励同样写死基值，同样按 η(R) 缩放
  const dailyPts = [...CODE['features.js'].matchAll(/reward:\s*(\d+),/g)].map(x => Number(x[1]));
  const dMax = Math.max(...dailyPts);
  const dPct = [];
  for (let r = 1; r <= 6; r++) {
    const cap = calcQ(r, 1, 1.0);
    const gain = Math.min(dMax * Math.pow(GameConfig.realmRateMult, r - 1), cap * 0.5);
    dPct.push(+(gain / cap * 100).toFixed(1));
  }
  R.dailyScale = { max: dMax, pct: dPct };
  log(`  日常最高奖励 ${dMax} 点，实际发放占比：${dPct.map((p, i) => `R${i + 1} ${p}%`).join(' ')}`);

  // 聚气丹是按比例的，作为"正确做法"的对照
  const pillPct = +(GameConfig.pillInstantPct * 100).toFixed(0);
  log(`  聚气丹按比例结算：各境界恒为 ${pillPct}%（对照）`);
}

// ============================================================
// K. 音效资源
// ============================================================
log('\n═══ K · 音频资源 ═══');
{
  const noiseCached = /_noiseBuffer|_noiseCache/.test(CODE['features.js']);
  const disconnects = /\.disconnect\(\)/.test(CODE['features.js']);
  R.audioNoiseCached = noiseCached;
  R.audioDisconnects = disconnects;
  log(`  白噪声缓冲复用：${noiseCached ? '有' : '无（每次出剑新建 AudioBuffer）'}`);
  log(`  节点播后断开：${disconnects ? '有' : '无（连发时节点积压）'}`);
}
// ============================================================
// L. 宗门 · 秘境（MECH-021 / MECH-022）
// ============================================================
log('\n═══ L · 宗门与秘境 ═══');
{
  const sectCfg = GameConfig.sect;

  // L1 宗门是否构成真实的灵石消耗口
  const dailyStoneSink = (sectCfg.dailyContribCap / sectCfg.offeringContrib) * sectCfg.offeringStone;
  R.sectDailySink = dailyStoneSink;
  const herbPerHour = (GameConfig.crops[0].yield - GameConfig.crops[0].seedCost) / GameConfig.crops[0].growthTime * 3600;
  const stonePerHour = herbPerHour * GameConfig.maxPlots * (GameConfig.shop.sell[0].price / GameConfig.shop.sell[0].amount);
  R.sectSinkHours = +(dailyStoneSink / stonePerHour).toFixed(2);
  log(`  宗门每日供奉上限可吸灵石 ${dailyStoneSink}（≈满级灵田 ${R.sectSinkHours} 小时的产出）`);

  // L2 各境界 × 各层级的硬闯成功率，找出"永远打不过"或"永远无风险"的死区
  const grid = [];
  for (let r = 1; r <= 6; r++) {
    const st = SaveSystem.createDefault();
    st.realm = r;
    const th = getStatThresholds(r);
    st.spiritSense = th.sense;
    st.health = th.hp;
    st.mana = th.mana;
    GameEngine.state = st;
    const row = { realm: r, power: DelveSystem.power, tiers: [], raw: [] };
    for (const t of GameConfig.delve.tiers) {
      const pMid = DelveSystem.successChance(Math.ceil(t.floors / 2), t.id, 0.15);
      const pEnd = DelveSystem.successChance(t.floors, t.id, GameConfig.delve.taintCap * 0.6);
      row.tiers.push(`${t.name.slice(0, 2)} ${Math.round(pMid * 100)}%/${Math.round(pEnd * 100)}%`);
      row.raw.push([pMid, pEnd]);
    }
    grid.push(row);
  }
  R.delveGrid = grid;
  log('  硬闯成功率（中层 / 末层）：');
  grid.forEach(g => log(`    R${g.realm} 战力${String(g.power).padStart(4)}  ${g.tiers.join('  ')}`));

  let dead = 0, trivial = 0;
  grid.forEach(g => {
    for (const pair of g.raw) {
      if (pair.every(n => n <= 0.15 + 1e-9)) dead++;
      if (pair.every(n => n >= 0.95 - 1e-9)) trivial++;
    }
  });
  R.delveDeadCells = dead;
  R.delveTrivialCells = trivial;
  log(`  死区（成功率恒 ≤15%）：${dead} 格 · 无风险（恒 ≥95%）：${trivial} 格`);

  // L3 伤势是否真的影响修炼速率
  const st2 = SaveSystem.createDefault();
  st2.realm = 3;
  GameEngine.state = st2;
  const normalPenalty = DelveSystem.ratePenalty;
  st2.injuryUntil = Date.now() + 60 * 1000;
  const injuredPenalty = DelveSystem.ratePenalty;
  R.injuryWorks = normalPenalty > injuredPenalty;
  log(`  伤势对修炼速率：正常 x${normalPenalty} → 受伤 x${injuredPenalty} ${R.injuryWorks ? '（生效）' : '（未生效）'}`);
  st2.injuryUntil = 0;

  // L4 秘境单局收益折算成"多少分钟灵田收入"
  const tier1 = GameConfig.delve.tiers[0];
  const runStone = Array.from({ length: tier1.floors }, (_, i) =>
    GameConfig.delve.baseStone * tier1.rewardMult * (1 + GameConfig.delve.floorGrow * i)
  ).reduce((a, b) => a + b, 0) * 0.85;
  R.delveRunStone = Math.round(runStone);
  R.delveRunMinutes = +(runStone / stonePerHour * 60).toFixed(1);
  log(`  荒尘秘境满层约 ${Math.round(runStone)} 灵石 ≈ ${(runStone / stonePerHour * 60).toFixed(1)} 分钟满级灵田收入（每日 3 枚令）`);

  // L5 存档自愈
  const dirty = SaveSystem.createDefault();
  dirty.delve.active = true;
  dirty.delve.doors = [];
  const fixed = SaveSystem._ensureShape(dirty);
  R.delveSaveSanitized = !fixed.delve.active;
  log(`  存档自愈（active 但无门 → 置为未开始）：${R.delveSaveSanitized ? '有' : '无'}`);
}

// ============================================================
// M. 宗门阶层体系（MECH-021 扩展 / MECH-023）
// ============================================================
log('\n=== M · 宗门阶层与收徒 ===');
{
  const pos = GameConfig.sect.positions;
  const grades = GameConfig.sect.grades;

  // M1 职位表必须单调：贡献递增，权限不倒退
  const bad = [];
  for (let i = 1; i < pos.length; i++) {
    const a = pos[i - 1], b = pos[i];
    if (b.contrib <= a.contrib) bad.push(`${b.name} 贡献未递增`);
    if (b.tier < a.tier) bad.push(`${b.name} 秘境层级倒退`);
    if (b.tokens < a.tokens) bad.push(`${b.name} 日令减少`);
    if (b.slots < a.slots) bad.push(`${b.name} 收徒名额减少`);
    if (b.offeringMult > a.offeringMult) bad.push(`${b.name} 供奉变贵`);
    if (b.grade < a.grade) bad.push(`${b.name} 宗门等级要求倒退`);
  }
  R.positionMonotonic = bad.length === 0;
  log(`  职位表单调性：${bad.length ? '异常 → ' + bad.join('；') : '正常（贡献递增、权限不倒退）'}`);

  // M2 宗门等级门槛是否可达：算每天能拿多少声望
  const task = GameConfig.sect.sectTask;
  const dailyPrestige = task.prestige + Math.floor(GameConfig.sect.dailyContribCap / 2);
  R.dailyPrestige = dailyPrestige;
  const needForGrade4 = grades[3].prestige;
  R.daysToGrade4 = Math.ceil(needForGrade4 / dailyPrestige);
  log(`  每日声望上限约 ${dailyPrestige}（月例 ${task.prestige} + 供奉折算 ${Math.floor(GameConfig.sect.dailyContribCap / 2)}）`);
  log(`  升到「${grades[3].name}」需 ${needForGrade4} 声望 → 约 ${R.daysToGrade4} 天（不含秘境与出师）`);

  // M3 收徒经济：养一名弟子到出师的总投入 vs 总回报
  const dc = GameConfig.disciple;
  const apt = 3;                                    // 取中品作代表
  const naturalPerMin = dc.growthBase * apt;
  const minutesNatural = dc.graduateCultivation / naturalPerMin;
  // 传功次数：0->100 按每次 +25，亲传后从 60 再推
  const impartsFirst = Math.ceil(dc.graduateCultivation / dc.impartGain);
  const costPerImpart = 0.12;                       // 按当前层上限的比例，随境界折算
  R.disciple = {
    naturalMinutes: Math.round(minutesNatural),
    imparts: impartsFirst,
    recruitStone: dc.recruitStone,
    graduateContrib: dc.graduateContrib,
    graduatePrestige: dc.graduatePrestige,
  };
  log(`  弟子自然成长到出师约需 ${Math.round(minutesNatural)} 分钟（资质中品，不吃传功）`);
  log(`  若全靠传功：约 ${impartsFirst} 次，合计消耗自身修为约 ${(impartsFirst * costPerImpart * 100).toFixed(0)}% 层上限`);

  // 弟子产出：每天能给多少贡献
  const yieldContribPerMin = dc.yieldContribPerMin * apt;
  R.discipleYieldPerDay = Math.round(yieldContribPerMin * 60 * 24);
  log(`  单个弟子满勤产出约 ${R.discipleYieldPerDay} 贡献/天（资质中品、无阶段加成）`);

  // M4 忠诚维护成本
  const decayPerHour = dc.loyaltyDecayPerMin * 60;
  const advisePerHour = dc.adviseLoyalty;
  const stonePerHour = (decayPerHour / advisePerHour) * dc.adviseStone;
  R.loyaltyUpkeepStonePerHour = +stonePerHour.toFixed(1);
  log(`  忠诚每小时流失 ${decayPerHour.toFixed(1)} → 维持忠诚约需 ${stonePerHour.toFixed(1)} 灵石/小时`);

  // M5 收徒名额与职位是否匹配（真传之前 slots 必须为 0）
  const earlySlots = pos.filter(p => p.contrib < pos[GameConfig.disciple.unlockRank].contrib)
    .reduce((a, p) => a + p.slots, 0);
  R.slotGateOk = earlySlots === 0 && pos[GameConfig.disciple.unlockRank].slots > 0;
  log(`  收徒门槛：真传之前名额合计 ${earlySlots} → ${R.slotGateOk ? '符合预期' : '异常'}`);
}

// ============================================================
// N. 跨系统一致性（轮回 / 离线 / 每日重置）
// ============================================================
log('\n=== N · 跨系统一致性 ===');
{
  // N1 轮回保留矩阵：文档承诺保留的东西，轮回后必须还在
  const st = SaveSystem.createDefault();
  st.realm = 6; st.level = 9;
  st.stone = 50000; st.spiritSense = 99; st.mana = 999; st.health = 999;
  st.cultivation = calcQ(6, 9, 1.0);
  st.totalCultivation = 70000;
  GameEngine.state = st;
  SectSystem.ensure(); DiscipleSystem.ensure();
  SectSystem.join();
  SectSystem.data.contrib = 4000;
  SectSystem.data.prestige = 2500;
  SectSystem._refreshRank();
  DiscipleSystem.recruit();

  const before = {
    joined: SectSystem.data.joined,
    grade: SectSystem.grade,
    rank: SectSystem.data.rank,
    contrib: SectSystem.data.contrib,
    prestige: SectSystem.data.prestige,
    disciples: DiscipleSystem.count,
  };

  GameEngine.rebirth();

  const after = {
    joined: SectSystem.data.joined,
    grade: SectSystem.grade,
    rank: SectSystem.data.rank,
    contrib: SectSystem.data.contrib,
    prestige: SectSystem.data.prestige,
    disciples: DiscipleSystem.count,
  };

  const lost = [];
  if (before.joined && !after.joined) lost.push('宗门身份');
  if (before.rank > after.rank) lost.push(`职位 ${before.rank}→${after.rank}`);
  if (before.prestige > 0 && after.prestige === 0) lost.push('宗门声望');
  if (before.contrib > 0 && after.contrib === 0) lost.push('宗门贡献');
  if (before.disciples > 0 && after.disciples === 0) lost.push('弟子');

  R.rebirthKeeps = { before, after, lost };
  R.rebirthKeepsAll = lost.length === 0;
  log(`  轮回保留：${lost.length === 0 ? '完整' : '丢失 → ' + lost.join('、')}`);
  log(`    轮前 等级${before.grade}/职位${before.rank}/声望${before.prestige}/弟子${before.disciples}`);
  log(`    轮后 等级${after.grade}/职位${after.rank}/声望${after.prestige}/弟子${after.disciples}`);

  // N2 离线收益来源覆盖：逐个来源比对"在线有 / 离线有"
  const st2 = SaveSystem.createDefault();
  st2.realm = 3; st2.level = 1;
  st2.stone = 5000;
  st2.unlockedPlots = 8;
  st2.lastSaveTicks = Date.now() - 3600 * 1000;
  GameEngine.state = st2;
  SectSystem.ensure(); DiscipleSystem.ensure();
  SectSystem.join();
  SectSystem.data.contrib = 2000;
  SectSystem.data.prestige = 999;
  SectSystem._refreshRank();
  DiscipleSystem.recruit();
  const d = DiscipleSystem.list[0];
  d.aptitude = 5; d.loyalty = 80;

  // 在线 1 小时的贡献产出
  const contrib0 = SectSystem.data.contrib;
  DiscipleSystem.tick(3600);
  const onlineContrib = SectSystem.data.contrib - contrib0;

  // 离线 1 小时的结算内容
  const st3 = SaveSystem.createDefault();
  st3.realm = 3; st3.level = 1; st3.unlockedPlots = 8;
  st3.lastSaveTicks = Date.now() - 3600 * 1000;
  st3.sect.joined = true;
  st3.sect.rank = 3;
  st3.sect.prestige = 999;
  st3.disciples = [JSON.parse(JSON.stringify(d))];
  const off = SaveSystem.calculateOfflineGains(st3, Date.now());

  R.offlineCoverage = {
    cultivation: true,
    herb: off && off.herb > 0,
    ore: off && off.ore > 0,
    dew: off && off.dew > 0,
    stoneFromDisciples: !!(off && off.discipleStone > 0),
    contribFromDisciples: !!(off && off.contrib > 0),
  };
  const missing = Object.entries(R.offlineCoverage).filter(([, v]) => !v).map(([k]) => k);
  R.offlineMissing = missing;
  log(`  离线收益覆盖：${missing.length === 0 ? '完整' : '缺 → ' + missing.join('、')}`);
  log(`    在线 1 小时弟子产出贡献 ${onlineContrib}，离线结算中该项为 ${R.offlineCoverage.contribFromDisciples ? '有' : '无'}`);

  // N3 每日重置：跨天后令牌与贡献额度应清零
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = 2;          // join 需要筑基
  SectSystem.ensure(); SectSystem.join();
  SectSystem.data.tokenDate = '2000-01-01';
  SectSystem.data.contribDate = '2000-01-01';
  SectSystem.data.contribToday = 300;
  R.dailyResetOk = SectSystem.canClaimTokensToday() === true;
  log(`  跨天重置：令牌可再领=${SectSystem.canClaimTokensToday() ? '是' : '否'}，贡献额度可再刷=${(function () {
    SectSystem.offer(1);
    return SectSystem.data.contribToday < 310;
  })() ? '是' : '否'}`);

  // N4 职位与宗门等级的一致性：声望被清后是否会掉级
  GameEngine.state = SaveSystem.createDefault();
  SectSystem.ensure(); SectSystem.join();
  SectSystem.data.contrib = 4000;
  SectSystem.data.prestige = 2500;
  SectSystem._refreshRank();
  const highRank = SectSystem.data.rank;
  SectSystem.data.prestige = 0;
  SectSystem._refreshRank();
  R.rankDriftsWithPrestige = SectSystem.data.rank < highRank;
  log(`  声望归零后职位：${highRank} → ${SectSystem.data.rank}${R.rankDriftsWithPrestige ? '（会掉级）' : '（不掉级）'}`);
}

// ============================================================
// O. 运行韧性（异常边界 / 存档体积 / 时钟异常 / 长会话）
// ============================================================
log('\n=== O · 运行韧性 ===');
{
  const appSrc = CODE['app.js'];

  // O1 主循环异常边界：rAF 必须无条件续帧
  const hasTry = /function gameLoop\(timestamp\)\s*\{[\s\S]*?try\s*\{/.test(appSrc);
  const rafInFinally = /finally\s*\{[\s\S]{0,120}requestAnimationFrame\(gameLoop\)/.test(appSrc);
  R.loopGuarded = hasTry && rafInFinally;
  log(`  主循环异常边界：${hasTry ? '有 try' : '无 try'} · rAF 在 finally：${rafInFinally ? '是' : '否'} → ${R.loopGuarded ? '安全' : '一次异常即永久定格'}`);

  // O2 双启动保护
  R.bootGuard = /__dxBooted/.test(appSrc);
  log(`  双启动保护：${R.bootGuard ? '有' : '无（重复引入脚本会跑两个主循环，双倍速）'}`);

  // O3 存档体积与配额占用
  const big = SaveSystem.createDefault();
  big.realm = 6; big.level = 9;
  big.unlockedPlots = 8;
  big.plots = Array.from({ length: 8 }, () => ({
    state: 'growing', cropId: 'herb_binglian', growthProgress: 123.4, growthTime: 240, watered: true,
  }));
  big.craftingQueue = Array.from({ length: 3 }, () => ({ recipeId: 'pill_xuanyuan', timeRemaining: 300, totalTime: 600 }));
  big.sect.joined = true; big.sect.rank = 6; big.sect.prestige = 9999; big.sect.contrib = 12345;
  big.disciples = Array.from({ length: 5 }, (_, i) => ({
    id: `dis_${i}`, name: `林稚川${i}`, aptitude: 5, cultivation: 99.5, loyalty: 88, stage: 1,
    trainedDate: 'Sat Oct 31 2026', joinedAt: Date.now(),
  }));
  const json = JSON.stringify(big);
  R.saveBytes = json.length;
  R.saveQuotaPct = +(json.length / (5 * 1024 * 1024) * 100).toFixed(2);
  log(`  满配存档体积：${(json.length / 1024).toFixed(1)} KB（占 5MB 配额的 ${R.saveQuotaPct}%）`);

  // O4 时钟异常：lastSave 落在未来 / 大幅回拨
  const future = SaveSystem.createDefault();
  future.lastSaveTicks = Date.now() + 3600 * 1000;   // 存档时间在未来（用户改过系统时间）
  let futureOk = true, futureGain = null;
  try { futureGain = SaveSystem.calculateOfflineGains(future, Date.now()); } catch (e) { futureOk = false; }
  R.clockFutureSafe = futureOk && futureGain === null;
  log(`  存档时间在未来：${futureOk ? (futureGain === null ? '不结算（安全）' : `结算了 ${Math.round(futureGain.elapsedSeconds)}s（可疑）`) : '抛异常'}`);

  const far = SaveSystem.createDefault();
  far.lastSaveTicks = Date.now() - 400 * 24 * 3600 * 1000;   // 放置 400 天
  const farGain = SaveSystem.calculateOfflineGains(far, Date.now());
  R.clockFarCapped = farGain && farGain.elapsedSeconds <= GameConfig.offlineCapSeconds + 7200;
  log(`  放置 400 天：结算 ${Math.round(farGain.elapsedSeconds / 3600)} 小时 → ${R.clockFarCapped ? '已按上限钳制' : '未钳制（可被改时钟刷收益）'}`);

  // O5 经济：新系统加入后灵石是否仍有沉淀
  const plotSink = GameConfig.plotCosts.reduce((a, b) => a + b, 0);
  let techSink = 0;
  for (const m of CODE['systems.js'].matchAll(/cost:\s*(\d+)/g)) techSink += Number(m[1]);
  let petSink = 0;
  const petRe = /upgradeCost:\s*(\d+),[\s\S]{0,40}?maxLevel:\s*(\d+)/g;
  let pm;
  while ((pm = petRe.exec(CODE['systems.js'])) !== null) {
    for (let lv = 1; lv < Number(pm[2]); lv++) petSink += Number(pm[1]) * lv;
  }
  const scriptureSink = GameConfig.sect.scriptures.reduce((a, s) => a + s.cost, 0);
  const sectDailySink = (GameConfig.sect.dailyContribCap / GameConfig.sect.offeringContrib) * GameConfig.sect.offeringStone;
  const totalOnce = plotSink + techSink + petSink + scriptureSink;

  const c0 = GameConfig.crops[0];
  const herbPerHour = (c0.yield - c0.seedCost) / c0.growthTime * 3600;
  const stonePerHour = herbPerHour * GameConfig.maxPlots * (GameConfig.shop.sell[0].price / GameConfig.shop.sell[0].amount);

  R.sinks = {
    oneTimeTotal: totalOnce,
    plotSink, techSink, petSink, scriptureSink,
    dailySectSink: sectDailySink,
    stonePerHour: Math.round(stonePerHour),
  };
  log(`  灵石一次性沉没口合计：${totalOnce}（扩地 ${plotSink} / 功法 ${techSink} / 宠物 ${petSink} / 宗门功法 ${scriptureSink}）`);
  log(`  持续沉没口：宗门供奉 ${sectDailySink}/日 ≈ ${(sectDailySink / stonePerHour).toFixed(1)} 小时灵田产出`);
  log(`  稳态收入 ${Math.round(stonePerHour)}/h → 买完全部一次性内容需 ${(totalOnce / stonePerHour).toFixed(1)} 小时`);
}

// ============================================================
// P. 存档字段治理（覆盖率 / 脏值 fuzz / 版本演进）
// ============================================================
log('\n=== P · 存档字段治理 ===');
{
  const base = SaveSystem.createDefault();
  const topKeys = Object.keys(base);
  const numericKeys = Object.keys(SaveSystem.FIELDS);
  const structural = new Set(['version', 'timestamp', 'pillBoost', 'plots', 'craftingQueue', 'sect', 'delve', 'disciples']);

  // P1 覆盖率：顶层字段必须被登记（数值表 or 结构白名单）
  const uncovered = topKeys.filter(k => !numericKeys.includes(k) && !structural.has(k));
  R.saveFieldsCovered = uncovered.length === 0;
  log(`  字段登记覆盖率：${topKeys.length - uncovered.length}/${topKeys.length}${uncovered.length ? ' · 未登记 → ' + uncovered.join('、') : ''}`);

  // P2 脏值 fuzz：每个数值字段注入 9 种脏值，清洗后必须仍是有限数
  const dirty = [null, undefined, 'abc', NaN, Infinity, -Infinity, -1, 1e20, {}];
  const failures = [];
  for (const key of numericKeys) {
    for (const v of dirty) {
      let fixed;
      try {
        const st = SaveSystem.createDefault();
        st[key] = v;
        fixed = SaveSystem._ensureShape(st);
      } catch (e) {
        failures.push(`${key}=${String(v)} 抛异常`);
        continue;
      }
      if (!Number.isFinite(fixed[key])) failures.push(`${key}=${String(v)} → ${String(fixed[key])}`);
    }
  }
  R.saveFuzzFailures = failures.length;
  log(`  脏值 fuzz：${numericKeys.length} 字段 × ${dirty.length} 种输入 = ${numericKeys.length * dirty.length} 例，失败 ${failures.length} 例`);
  failures.slice(0, 4).forEach(f => log(`    × ${f}`));

  // P3 整体状态无 NaN：清洗后整份存档序列化不应出现 NaN
  const probe = SaveSystem.createDefault();
  for (const key of numericKeys) probe[key] = 'x';
  const fixedAll = SaveSystem._ensureShape(probe);
  const hasNaN = Object.keys(SaveSystem.FIELDS).some(k => !Number.isFinite(fixedAll[k]));
  R.saveNoNaN = !hasNaN;
  log(`  全字段注入脏值后：${hasNaN ? '仍有非有限数' : '全部回落为有限数'}`);

  // P4 版本演进：版本号不一致时应走迁移而不是丢弃
  const oldSave = SaveSystem.createDefault();
  oldSave.version = 0;
  const migrated = SaveSystem.migrate(oldSave);
  R.saveMigratesForward = !!migrated && migrated.version === SaveSystem.VERSION;
  log(`  旧版本存档迁移：${R.saveMigratesForward ? '可迁移并升版' : '失败'}`);

  // P5 未来版本存档：不强行降级，避免把新档读成旧结构
  const futureSave = SaveSystem.createDefault();
  futureSave.version = SaveSystem.VERSION + 5;
  R.saveRejectsFuture = SaveSystem.migrate(futureSave) === null;
  log(`  未来版本存档：${R.saveRejectsFuture ? '拒绝降级（安全）' : '被强行读入（有风险）'}`);
}
