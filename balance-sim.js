/**
 * 平衡模拟：验证修复后的经济是否可玩
 * 运行：node balance-sim.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 模拟浏览器环境
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
  clear() { this._d = {}; },
};
global.document = {
  addEventListener() {}, getElementById() { return null; },
  querySelectorAll() { return []; }, querySelector() { return null; },
  createElement() { return { style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, appendChild() {} }; },
  hidden: false,
};
global.window = { addEventListener() {} };
global.navigator = { vibrate() {} };
global.AudioContext = undefined;

const load = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
for (const f of ['js/config.js', 'js/save.js', 'js/engine.js', 'js/features.js', 'js/systems.js']) {
  vm.runInThisContext(load(f), { filename: f });
}

const DT = 0.1;
const MINUTES = 30;
const TICKS = Math.round(MINUTES * 60 / DT);
const bestCrop = () => {
  // 选当前买得起里净收益/秒最高的
  let best = null, bestRate = -1;
  for (const c of GameConfig.crops) {
    if (GameEngine.state.herb < c.seedCost) continue;
    const rate = (c.yield - c.seedCost) / c.growthTime;
    if (rate > bestRate) { bestRate = rate; best = c; }
  }
  return best;
};

function run(label, active, trade, dao) {
  localStorage.clear();
  GameEngine.state = SaveSystem.createDefault();
  GameEngine._lastTick = Date.now();
  GameEngine._passive = { dew: 0, ore: 0 };
  GameEngine.state.dao = dao || 0;

  let firstBT = null;
  let craftGuyuan = 0;
  const marks = [];

  const markAt = [300, 900, 1800];
  let markIdx = 0;

  for (let t = 0; t < TICKS; t++) {
    const sec = t * DT;
    // 让 tick 计算出固定步长（否则紧循环里 Date.now() 不前进，dt≈0）
    GameEngine._lastTick = Date.now() - DT * 1000;
    GameEngine.tick();

    // —— 农民行为：空地就种、熟了就收 ——
    for (let i = 0; i < GameConfig.startingPlots; i++) {
      const p = GameEngine.state.plots[i];
      if (p.state === 'ready') GameEngine.harvest(i);
      else if (p.state === 'empty') {
        const c = bestCrop();
        if (c) GameEngine.plant(i, c.id);
      }
    }

    // —— 炼丹：优先固元丹，其次聚气丹 ——
    if (GameEngine.state.craftingQueue.length < GameConfig.maxCraftQueue) {
      const s = GameEngine.state;
      const guyuan = GameConfig.recipes.find(r => r.id === 'pill_guyuan');
      const qiju = GameConfig.recipes.find(r => r.id === 'pill_qiju');
      if (s.herb >= guyuan.herbCost && s.dew >= guyuan.dewCost && s.ore >= guyuan.oreCost) {
        if (GameEngine.startCraft('pill_guyuan')) craftGuyuan++;
      } else if (s.herb >= qiju.herbCost + 5 && s.dew >= qiju.dewCost + 2) {
        // 留出余量给固元丹，避免把材料吃光
        GameEngine.startCraft('pill_qiju');
      }
    }

    // —— 经营玩家：余粮换灵石、攒够就扩地 ——
    if (trade) {
      if (GameEngine.state.herb >= 120) GameEngine.sellOffer(0);
      const cost = GameEngine.nextPlotCost;
      if (cost !== null && GameEngine.state.stone >= cost) GameEngine.buyPlot();
    }

    // —— 主动玩家：每 5 分钟打坐 60 秒 ——
    if (active) {
      const inCycle = (sec % 300);
      if (inCycle < 60 && !GameEngine._isMeditating) GameEngine.startMeditation();
      if (inCycle >= 60 && GameEngine._isMeditating) GameEngine.stopMeditation();
    }

    if (GameEngine.canBreakthrough) {
      const r = GameEngine.tryBreakthrough();
      if (r.success && firstBT === null) firstBT = sec;
    }

    if (markIdx < markAt.length && sec >= markAt[markIdx]) {
      marks.push({ min: Math.round(sec / 60), herb: GameEngine.state.herb, dew: GameEngine.state.dew,
        ore: GameEngine.state.ore, pill: GameEngine.state.breakthroughPill, realm: `${GameEngine.state.realm}-${GameEngine.state.level}` });
      markIdx++;
    }
  }

  const s = GameEngine.state;
  console.log(`\n=== ${label}（${MINUTES} 分钟）===`);
  console.log(`首次突破：${firstBT === null ? '未发生 ✗' : firstBT.toFixed(0) + ' 秒'}`);
  console.log(`炼成固元丹：${craftGuyuan} 颗`);
  console.log(`结束状态：境界 ${s.realm}-${s.level}｜灵田 ${GameEngine.unlockedPlots} 块｜灵石 ${s.stone}｜灵草 ${s.herb}｜凝露 ${s.dew}｜矿石 ${s.ore}｜突破丹 ${s.breakthroughPill}`);
  console.log('时间点   灵草  凝露  矿石  突破丹  境界');
  for (const m of marks) {
    console.log(`${String(m.min).padStart(3)}min ${String(m.herb).padStart(6)}${String(m.dew).padStart(6)}${String(m.ore).padStart(6)}${String(m.pill).padStart(8)}   ${m.realm}`);
  }
  return { firstBT, craftGuyuan, level: s.level, realm: s.realm, plots: GameEngine.unlockedPlots };
}

const idle = run('挂机玩家（只种田炼丹）', false, false);
const act = run('主动玩家（每 5 分钟打坐 1 分钟）', true, false);
const biz = run('经营玩家（卖余粮 + 扩地 + 打坐）', true, true);
const dao25 = run('轮回后（道行 25，其余同经营）', true, true, 25);

console.log('\n' + '='.repeat(52));
const ok = idle.firstBT !== null;
console.log(ok ? '✅ 经济闭环成立：挂机也能推进境界' : '❌ 仍然卡死：需要继续调参');
console.log(`对比：主动 ${act.firstBT?.toFixed(0) ?? '—'}s / 挂机 ${idle.firstBT?.toFixed(0) ?? '—'}s / 经营 ${biz.firstBT?.toFixed(0) ?? '—'}s`);
console.log(`经营玩家 30 分钟：境界 ${biz.realm}-${biz.level}，灵田 ${biz.plots} 块`);
console.log(`道行 25 后 30 分钟：境界 ${dao25.realm}-${dao25.level}，灵田 ${dao25.plots} 块（+${((GameEngine.daoRateMult - 1) * 100).toFixed(0)}% 速率已计入）`);
