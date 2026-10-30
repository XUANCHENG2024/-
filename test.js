/**
 * 桌面修仙 · 全量自动化测试套件
 * 覆盖：修为/种植/炼丹/打坐/资源/存档/天气/宠物/功法/日常目标/访客
 * 运行：node test.js
 */

// === 加载所有模块 ===
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadFile(f) {
  return fs.readFileSync(path.join(__dirname, f), 'utf8');
}

// 模拟浏览器环境
global.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] || null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = {}; },
};
global.document = {
  addEventListener: () => {},
  getElementById: () => null,
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} }, setAttribute: () => {}, appendChild: () => {} }),
  hidden: false,
};
global.window = {
  // 记录监听器，便于测试 storage / visibilitychange 这类跨标签页行为
  _listeners: {},
  addEventListener(k, fn) { (this._listeners[k] = this._listeners[k] || []).push(fn); },
  removeEventListener(k, fn) {
    const arr = this._listeners[k];
    if (arr) this._listeners[k] = arr.filter(f => f !== fn);
  },
  dispatch(k, e) { (this._listeners[k] || []).forEach(f => f(e)); },
};
global.navigator = { vibrate: () => {} };
global.AudioContext = undefined;

// 用 vm.runInThisContext 加载模块（共享全局作用域）
const context = vm.createContext(global);
vm.runInThisContext(loadFile('js/config.js'), { filename: 'config.js' });
vm.runInThisContext(loadFile('js/save.js'), { filename: 'save.js' });
vm.runInThisContext(loadFile('js/engine.js'), { filename: 'engine.js' });
vm.runInThisContext(loadFile('js/features.js'), { filename: 'features.js' });
vm.runInThisContext(loadFile('js/systems.js'), { filename: 'systems.js' });
vm.runInThisContext(loadFile('js/sect.js'), { filename: 'sect.js' });
vm.runInThisContext(loadFile('js/disciples.js'), { filename: 'disciples.js' });

// === 测试框架 ===
let totalTests = 0, passedTests = 0, failedTests = 0;
const failures = [];

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failedTests++;
    failures.push({ name, error: e.message });
    console.log(`  ❌ ${name} — ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || 'Not equal'}: got ${actual}, expected ${expected}`);
}

function assertClose(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) > tolerance) throw new Error(`${msg || 'Not close'}: got ${actual}, expected ${expected} ±${tolerance}`);
}

function assertThrows(fn, msg) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) throw new Error(msg || 'Expected to throw');
}

// ===========================
// 1. 数值公式（NUM-001~004）
// ===========================
console.log('\n=== 1. 数值公式 ===');

test('Q(R=1,r=1,γ=0.9) = 90', () => assertClose(calcQ(1, 1, 0.9), 90, 0.01));
test('Q(R=6,r=9,γ=1.1) ≈ 5404.16', () => assertClose(calcQ(6, 9, 1.1), 5404.16, 1));
test('Q 始终 > 0', () => {
  for (let R = 1; R <= 6; R++) for (let r = 1; r <= 9; r++) assert(calcQ(R, r, 0.9) > 0);
});
test('V(R=1,bg,no-pill) = 0.3', () => assertClose(calcRate(1, true, false), 0.3, 0.001));
test('V(R=6,fg,pill) ≈ 15.2', () => assertClose(calcRate(6, false, true), 15.2, 0.1));
test('突破属性阈值 R=1', () => {
  const t = getStatThresholds(1);
  assertEq(t.sense, 10); assertEq(t.hp, 100); assertEq(t.mana, 50);
});
test('突破属性阈值 R=3 = R=1 × 1.5²', () => {
  const t = getStatThresholds(3);
  assertEq(t.sense, 23); // round(10 * 2.25) = 23
});

// ===========================
// 2. 修为系统（MECH-002）
// ===========================
console.log('\n=== 2. 修为系统 ===');

test('初始状态：练气1层，修为0', () => {
  GameEngine.state = SaveSystem.createDefault();
  assertEq(GameEngine.state.realm, 1);
  assertEq(GameEngine.state.level, 1);
  assertEq(GameEngine.state.cultivation, 0);
});

test('tick 后修为增长', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine._isBackground = false;
  GameEngine._lastTick = Date.now() - 1000; // 模拟1秒
  GameEngine.tick();
  assert(GameEngine.state.cultivation > 0, 'Cultivation should increase');
});

test('修为不能超过上限', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.cultivation = 999;
  const cap = calcQ(1, 1, 1.0);
  GameEngine._lastTick = Date.now() - 10000;
  GameEngine.tick();
  assert(GameEngine.state.cultivation <= cap + 1, `Cultivation ${GameEngine.state.cultivation} should not exceed cap ${cap}`);
});

test('突破需要修为满', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.cultivation = 0;
  GameEngine.state.breakthroughPill = 1;
  const result = GameEngine.tryBreakthrough();
  assert(!result.success, 'Should fail when cultivation not full');
});

test('小阶突破不需要丹药（只凭修为与属性）', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.level = 3;
  GameEngine.state.cultivation = 999999;
  GameEngine.state.breakthroughPill = 0;
  GameEngine.state.spiritSense = 999;
  GameEngine.state.health = 999;
  GameEngine.state.mana = 999;
  const result = GameEngine.tryBreakthrough();
  assert(result.success, 'Minor breakthrough should not need a pill');
  assertEq(GameEngine.state.level, 4, 'Level should advance');
});

test('跨大境界需要破障丹', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.level = 9;
  GameEngine.state.cultivation = 999999;
  GameEngine.state.breakthroughPill = 0;
  GameEngine.state.spiritSense = 999;
  GameEngine.state.health = 999;
  GameEngine.state.mana = 999;
  const result = GameEngine.tryBreakthrough();
  assert(!result.success, 'Major jump must require a pill');
});

test('突破成功后境界提升', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.cultivation = 999999;
  GameEngine.state.breakthroughPill = 1;
  GameEngine.state.spiritSense = 999;
  GameEngine.state.health = 999;
  GameEngine.state.mana = 999;
  const result = GameEngine.tryBreakthrough();
  assert(result.success, 'Should succeed');
  assertEq(GameEngine.state.level, 2, 'Level should be 2');
  assertEq(GameEngine.state.cultivation, 0, 'Cultivation should reset');
  assertEq(GameEngine.state.breakthroughPill, 1, 'Minor breakthrough keeps the pill');
});

test('练气9层突破后进入筑基', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = 1;
  GameEngine.state.level = 9;
  GameEngine.state.cultivation = 999999;
  GameEngine.state.breakthroughPill = 1;
  GameEngine.state.spiritSense = 999;
  GameEngine.state.health = 999;
  GameEngine.state.mana = 999;
  GameEngine.tryBreakthrough();
  assertEq(GameEngine.state.realm, 2, 'Realm should be 2');
  assertEq(GameEngine.state.level, 1, 'Level should reset to 1');
});

test('渡劫9层钳制不越界', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = 6;
  GameEngine.state.level = 9;
  GameEngine.state.cultivation = 999999;
  GameEngine.state.breakthroughPill = 1;
  GameEngine.state.spiritSense = 99999;
  GameEngine.state.health = 99999;
  GameEngine.state.mana = 99999;
  GameEngine.tryBreakthrough();
  assert(GameEngine.state.realm <= 6, 'Realm should not exceed 6');
});

test('丹药加速生效', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.cultivationPill = 1;
  GameEngine.state.pillBoost = false;
  const ok = GameEngine.activatePillBoost();
  assert(ok, 'Should activate');
  assert(GameEngine.state.pillBoost, 'Pill boost should be active');
  assert(GameEngine.state.pillBoostRemaining > 0, 'Timer should be set');
});

// ===========================
// 3. 种植系统（MECH-003）
// ===========================
console.log('\n=== 3. 种植系统 ===');

test('播种消耗灵草', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 10;
  const before = GameEngine.state.herb;
  GameEngine.plant(0, 'herb_qingling');
  assert(GameEngine.state.herb < before, 'Herb should be consumed');
});

test('播种失败：灵草不足', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 0;
  const ok = GameEngine.plant(0, 'herb_qingling');
  assert(!ok, 'Should fail with insufficient herbs');
});

test('播种失败：地块已占用', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 100;
  GameEngine.plant(0, 'herb_qingling');
  const ok = GameEngine.plant(0, 'herb_ziju');
  assert(!ok, 'Should fail on occupied plot');
});

test('浇水后 growthProgress 增加更快', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 100;
  GameEngine.plant(0, 'herb_qingling');
  const p0 = GameEngine.state.plots[0].growthProgress;
  GameEngine._tickFarming(1.0);
  const progressUnwatered = GameEngine.state.plots[0].growthProgress - p0;

  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 100;
  GameEngine.plant(0, 'herb_qingling');
  GameEngine.water(0);
  const p1 = GameEngine.state.plots[0].growthProgress;
  GameEngine._tickFarming(1.0);
  const progressWatered = GameEngine.state.plots[0].growthProgress - p1;

  assert(progressWatered > progressUnwatered, `Watered (${progressWatered}) should be faster than unwatered (${progressUnwatered})`);
});

test('收获返回灵草', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 100;
  GameEngine.plant(0, 'herb_qingling');
  GameEngine.state.plots[0].state = 'ready'; // 强制成熟
  const before = GameEngine.state.herb;
  const harvested = GameEngine.harvest(0);
  assert(harvested > 0, 'Should harvest something');
  assert(GameEngine.state.herb >= before, 'Herb should not decrease');
});

test('收获后地块重置为空闲', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 100;
  GameEngine.plant(0, 'herb_qingling');
  GameEngine.state.plots[0].state = 'ready';
  GameEngine.harvest(0);
  assertEq(GameEngine.state.plots[0].state, 'empty', 'Plot should be empty after harvest');
});

// ===========================
// 4. 炼丹系统（MECH-004）
// ===========================
console.log('\n=== 4. 炼丹系统 ===');

test('炼丹消耗材料', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 10;
  GameEngine.state.dew = 5;
  const herbBefore = GameEngine.state.herb;
  GameEngine.startCraft('pill_qiju');
  assert(GameEngine.state.herb < herbBefore, 'Herb should be consumed');
});

test('炼丹失败：材料不足', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 0;
  GameEngine.state.dew = 0;
  const ok = GameEngine.startCraft('pill_qiju');
  assert(!ok, 'Should fail with insufficient materials');
});

test('炼丹队列上限', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 999;
  GameEngine.state.dew = 999;
  GameEngine.startCraft('pill_qiju');
  GameEngine.startCraft('pill_qiju');
  GameEngine.startCraft('pill_qiju');
  const ok = GameEngine.startCraft('pill_qiju');
  assert(!ok, 'Should fail when queue is full');
});

test('炼制完成后产出丹药', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 10;
  GameEngine.state.dew = 5;
  GameEngine.startCraft('pill_qiju');
  // 模拟计时器完成
  GameEngine.state.craftingQueue[0].timeRemaining = 0;
  GameEngine._tickAlchemy(0.1);
  assert(GameEngine.state.cultivationPill >= 1, 'Should produce pill');
  assertEq(GameEngine.state.craftingQueue.length, 0, 'Queue should be empty');
});

// ===========================
// 5. 打坐/练剑（MECH-005）
// ===========================
console.log('\n=== 5. 打坐/练剑 ===');

test('打坐开始/停止', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.startMeditation();
  assert(GameEngine._isMeditating, 'Should be meditating');
  GameEngine.stopMeditation();
  assert(!GameEngine._isMeditating, 'Should stop');
});

test('练剑增加修为和连击', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine._swordCombo = 0;
  GameEngine._comboTimer = 0;
  GameEngine.swordStrike();
  assert(GameEngine._swordCombo === 1, 'Combo should be 1');
  assert(GameEngine.state.cultivation > 0, 'Cultivation should increase');
});

test('连击窗口过期后重置', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine._swordCombo = 5;
  GameEngine._comboTimer = 0.01;
  GameEngine._tickMeditation(1.0);
  assertEq(GameEngine._swordCombo, 0, 'Combo should reset');
});

test('练剑收益含功法加成', () => {
  GameEngine.state = SaveSystem.createDefault();
  TechniqueSystem._learned = {};
  const gainNoTech = GameEngine.swordStrike();
  GameEngine.state = SaveSystem.createDefault();
  TechniqueSystem._learned = { 'sword_art': true };
  GameEngine._swordCombo = 0;
  GameEngine._comboTimer = 0;
  const gainWithTech = GameEngine.swordStrike();
  TechniqueSystem._learned = {};
  assert(gainWithTech > gainNoTech, `With tech (${gainWithTech}) should be > without (${gainNoTech})`);
});

// ===========================
// 6. 资源系统（MECH-006）
// ===========================
console.log('\n=== 6. 资源系统 ===');

test('资源不超过硬上限', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 998;
  const added = GameEngine._addResource('herb', 10);
  assert(GameEngine.state.herb <= 999, `Herb ${GameEngine.state.herb} should not exceed 999`);
  assert(added <= 1, `Should only add ${added}`);
});

test('消耗不足时返回 false', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 0;
  // 通过炼丹间接测试
  const ok = GameEngine.startCraft('pill_qiju');
  assert(!ok, 'Should fail');
});

// ===========================
// 7. 存档系统（MECH-007）
// ===========================
console.log('\n=== 7. 存档系统 ===');

test('保存后可读取', () => {
  localStorage.clear();
  const data = SaveSystem.createDefault();
  data.realm = 3;
  data.level = 5;
  SaveSystem.save(data);
  const loaded = SaveSystem.load();
  assert(loaded !== null, 'Should load');
  assertEq(loaded.realm, 3, 'Realm should persist');
  assertEq(loaded.level, 5, 'Level should persist');
});

test('损坏存档回退到备份', () => {
  localStorage.clear();
  const data = SaveSystem.createDefault();
  data.realm = 2;
  SaveSystem.save(data);
  // 破坏主存档
  localStorage.setItem('desktop_xianxia_save', 'invalid json{{{');
  const loaded = SaveSystem.load();
  assert(loaded !== null, 'Should fall back to backup');
});

test('导出格式正确', () => {
  const data = SaveSystem.createDefault();
  const json = JSON.stringify(data);
  const parsed = JSON.parse(json);
  assertEq(parsed.version, SaveSystem.VERSION, 'Version should match');
  assert(parsed.realm !== undefined, 'Should have realm');
  assert(parsed.plots !== undefined, 'Should have plots');
});

test('离线收益计算正确', () => {
  const data = SaveSystem.createDefault();
  data.realm = 1;
  data.lastSaveTicks = Date.now() - 3600000; // 1小时前
  const gains = SaveSystem.calculateOfflineGains(data, Date.now());
  assert(gains !== null, 'Should calculate gains');
  assert(gains.cultivation > 0, 'Should have cultivation gain');
  assert(gains.elapsedSeconds > 3500, 'Should be ~3600s');
});

test('离线收益不超过8小时', () => {
  const data = SaveSystem.createDefault();
  data.lastSaveTicks = Date.now() - 100 * 3600000; // 100小时前
  const gains = SaveSystem.calculateOfflineGains(data, Date.now());
  assert(gains.elapsedSeconds <= 8 * 3600 + 1, `Should cap at 8h, got ${gains.elapsedSeconds}`);
});

// ===========================
// 8. 天气系统（MECH-013）
// ===========================
console.log('\n=== 8. 天气系统 ===');

test('初始化状态合理', () => {
  WeatherSystem.init();
  assert(['day', 'night'].includes(WeatherSystem._timeOfDay), 'Time of day valid');
  assert(['clear', 'rain'].includes(WeatherSystem._weather), 'Weather valid');
});

test('生长倍率正确', () => {
  WeatherSystem._weather = 'rain';
  assertClose(WeatherSystem.growthMultiplier, GameConfig.rainGrowthMult, 0.01);
  WeatherSystem._weather = 'clear';
  WeatherSystem._timeOfDay = 'night';
  assertClose(WeatherSystem.growthMultiplier, GameConfig.nightGrowthMult, 0.01);
  WeatherSystem._timeOfDay = 'day';
  assertClose(WeatherSystem.growthMultiplier, GameConfig.dayGrowthMult, 0.01);
});

test('夜晚修炼效率加成', () => {
  WeatherSystem._timeOfDay = 'night';
  assertClose(WeatherSystem.meditationMultiplier, 1.15, 0.01);
  WeatherSystem._timeOfDay = 'day';
  assertClose(WeatherSystem.meditationMultiplier, 1.0, 0.01);
});

// ===========================
// 9. 宠物系统（MECH-012）
// ===========================
console.log('\n=== 9. 宠物系统 ===');

test('未解锁的宠物不能领养', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = 1;
  PetSystem._owned = {};
  const ok = PetSystem.adopt('little_dog'); // 需要化神(5)
  assert(!ok, 'Should not adopt locked pet');
});

test('已解锁宠物可领养', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = 2;
  PetSystem._owned = {};
  const ok = PetSystem.adopt('spirit_fish'); // 筑基(2)解锁
  assert(ok, 'Should adopt');
  assert(PetSystem._owned['spirit_fish'] !== undefined, 'Should be owned');
});

test('出战宠物提供加成', () => {
  GameEngine.state = SaveSystem.createDefault();
  PetSystem._owned = { 'spirit_fish': { level: 1, active: false } };
  PetSystem._activePet = 'spirit_fish';
  assert(PetSystem.cultivationRateBonus > 0, 'Should have bonus');
  PetSystem._activePet = null;
});

test('宠物升级消耗灵石', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.stone = 1000;
  PetSystem._owned = { 'spirit_fish': { level: 1, active: false } };
  const before = GameEngine.state.stone;
  PetSystem.upgrade('spirit_fish');
  assert(GameEngine.state.stone < before, 'Stone should be consumed');
  assertEq(PetSystem._owned['spirit_fish'].level, 2, 'Level should increase');
});

// ===========================
// 10. 功法系统（MECH-011）
// ===========================
console.log('\n=== 10. 功法系统 ===');

test('未解锁功法不能学习', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = 1;
  GameEngine.state.stone = 99999;
  TechniqueSystem._learned = {};
  const ok = TechniqueSystem.learn('heavenly_dao'); // 需要化神(5)
  assert(!ok, 'Should not learn locked technique');
});

test('灵石不足不能学习', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = 5;
  GameEngine.state.stone = 0;
  TechniqueSystem._learned = {};
  const ok = TechniqueSystem.learn('heavenly_dao');
  assert(!ok, 'Should not learn without stones');
});

test('学习功法消耗灵石并获得加成', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = 1;
  GameEngine.state.stone = 1000;
  TechniqueSystem._learned = {};
  const before = GameEngine.state.stone;
  const ok = TechniqueSystem.learn('breathing_art');
  assert(ok, 'Should learn');
  assert(GameEngine.state.stone < before, 'Stone consumed');
  assert(TechniqueSystem.cultivationRateBonus > 0, 'Should have bonus');
  TechniqueSystem._learned = {};
});

test('功法加成可叠加', () => {
  TechniqueSystem._learned = { 'breathing_art': true, 'spirit_array': true };
  const bonus = TechniqueSystem.cultivationRateBonus;
  TechniqueSystem._learned = {};
  assert(bonus > 0.20, `Stacked bonus (${bonus}) should be > 0.20`);
});

// ===========================
// 11. 日常目标（MECH-010）
// ===========================
console.log('\n=== 11. 日常目标 ===');

test('初始化生成3个目标', () => {
  localStorage.clear();
  DailyGoals._goals = [];
  DailyGoals._lastResetDate = '';
  DailyGoals.init();
  assertEq(DailyGoals.getAll().length, 3, 'Should have 3 goals');
});

test('完成目标后可领取', () => {
  localStorage.clear();
  DailyGoals.init();
  const goals = DailyGoals.getAll();
  goals[0].completed = true;
  goals[0].claimed = false;
  GameEngine.state = SaveSystem.createDefault();
  const before = GameEngine.state.cultivation;
  DailyGoals.claim(0);
  assert(GameEngine.state.cultivation >= before, 'Cultivation should increase');
  assert(goals[0].claimed, 'Should be claimed');
});

test('未完成目标不能领取', () => {
  localStorage.clear();
  DailyGoals.init();
  const goals = DailyGoals.getAll();
  goals[1].completed = false;
  goals[1].claimed = false;
  const ok = DailyGoals.claim(1);
  assert(!ok, 'Should not claim incomplete goal');
});

test('increment 按 key 增加进度', () => {
  localStorage.clear();
  DailyGoals.init();
  const goals = DailyGoals.getAll();
  goals[0].key = 'plant';
  goals[0].target = 3;
  goals[0].progress = 0;
  goals[0].completed = false;
  DailyGoals.increment('plant', 1);
  DailyGoals.increment('plant', 1);
  assert(!goals[0].completed, '2/3 还不应完成');
  DailyGoals.increment('plant', 1);
  assert(goals[0].completed, 'Should be complete after 3 increments');
});

test('回归守卫：按分类名调用不应推进进度', () => {
  // 旧实现用 goal.type 匹配（farming/alchemy/...），而调用方传的是动作名
  // （plant/harvest/...），导致日常目标整体失效。这条用例锁死新契约。
  localStorage.clear();
  DailyGoals.init();
  const goals = DailyGoals.getAll();
  goals[0].key = 'plant';
  goals[0].type = 'farming';
  goals[0].progress = 0;
  goals[0].completed = false;
  DailyGoals.increment('farming', 1);
  assertEq(goals[0].progress, 0, '按 type 名调用不应产生进度');
});

test('任务池每个任务的 key 都能被某个调用方触发', () => {
  localStorage.clear();
  DailyGoals.init();
  const keys = DailyGoals._taskPool.map(t => t.key);
  const appSrc = require('fs').readFileSync(require('path').join(__dirname, 'js', 'app.js'), 'utf8')
    + require('fs').readFileSync(require('path').join(__dirname, 'js', 'ui.js'), 'utf8');
  const missing = keys.filter(k => !appSrc.includes(`increment('${k}'`));
  assertEq(missing.length, 0, `未被任何调用点覆盖的 key: ${missing.join(',')}`);
});


// ===========================
// 12. 访客系统（MECH-014）
// ===========================
console.log('\n=== 12. 访客系统 ===');

test('初始状态无访客', () => {
  VisitorSystem._currentVisitor = null;
  VisitorSystem._visitorCount = 0;
  assert(!VisitorSystem.hasVisitor, 'Should have no visitor');
});

test('选择选项发放奖励', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 100;
  GameEngine.state.stone = 100;
  VisitorSystem._currentVisitor = VisitorSystem._visitors[0].__proto__ === Object.prototype
    ? JSON.parse(JSON.stringify(VisitorSystem._visitors[0]))
    : { ...VisitorSystem._visitors[0], options: [...VisitorSystem._visitors[0].options] };
  const cultBefore = GameEngine.state.cultivation;
  const result = VisitorSystem.chooseOption(0); // 交谈
  assert(result.success, 'Should succeed');
  assert(GameEngine.state.cultivation >= cultBefore, 'Cultivation should increase');
});

test('资源不足时选项失败', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 0;
  GameEngine.state.stone = 0;
  VisitorSystem._currentVisitor = { ...VisitorSystem._visitors[0], options: [...VisitorSystem._visitors[0].options] };
  // 第2个选项是赠礼（需消耗灵草）
  const result = VisitorSystem.chooseOption(1);
  assert(!result || !result.success, 'Should fail with insufficient resources');
});

test('赶走访客', () => {
  VisitorSystem._currentVisitor = { ...VisitorSystem._visitors[0] };
  VisitorSystem.dismiss();
  assert(!VisitorSystem.hasVisitor, 'Visitor should be dismissed');
});

// ===========================
// 12.5 集市与扩地
// ===========================
console.log('\n=== 12.5 集市与扩地 ===');

test('卖出灵草换灵石', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 100;
  GameEngine.state.stone = 50;
  const r = GameEngine.sellOffer(0);          // 卖 灵草×20 → +40
  assert(r.ok, 'Sell should succeed');
  assertEq(GameEngine.state.herb, 80, 'Herb -20');
  assertEq(GameEngine.state.stone, 90, 'Stone +40');
});

test('材料不足卖不出', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 5;
  const r = GameEngine.sellOffer(0);
  assert(!r.ok, 'Should fail without enough herb');
});

test('灵石不足买不了', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.stone = 10;
  const r = GameEngine.buyOffer(0);           // 凝露×5 需 60
  assert(!r.ok, 'Should fail without enough stone');
});

test('买入材料入库', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.stone = 100;
  const dew0 = GameEngine.state.dew;
  const r = GameEngine.buyOffer(0);           // 凝露×5 −60
  assert(r.ok, 'Buy should succeed');
  assertEq(GameEngine.state.stone, 40, 'Stone -60');
  assert(GameEngine.state.dew >= dew0 + 5, 'Dew increased');
});

test('开垦新田：扣灵石并解锁', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.stone = 500;
  const before = GameEngine.unlockedPlots;
  const cost = GameEngine.nextPlotCost;
  const r = GameEngine.buyPlot();
  assert(r.ok, 'Expand should succeed');
  assertEq(GameEngine.unlockedPlots, before + 1, 'Plot unlocked');
  assertEq(GameEngine.state.stone, 500 - cost, 'Stone deducted');
});

test('开垦到上限后拒绝', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.stone = 99999;
  GameEngine.state.unlockedPlots = GameConfig.maxPlots;
  const r = GameEngine.buyPlot();
  assert(!r.ok, 'Should refuse when maxed');
});

test('一键收获收齐成熟地块', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 100;
  GameEngine.plant(0, 'herb_qingling');
  GameEngine.plant(1, 'herb_qingling');
  GameEngine.state.plots[0].state = 'ready';
  GameEngine.state.plots[1].state = 'ready';
  const r = GameEngine.harvestAll();
  assertEq(r.count, 2, 'Should harvest 2 plots');
  assert(r.total > 0, 'Yield should be positive');
  assertEq(GameEngine.state.plots[0].state, 'empty', 'Plot 0 reset');
});

// ===========================
// 12.6 轮回（转生）
// ===========================
console.log('\n=== 12.6 轮回 ===');

test('未圆满不能轮回', () => {
  GameEngine.state = SaveSystem.createDefault();
  const r = GameEngine.rebirth();
  assert(!r.ok, 'Should refuse before 渡劫 9 层');
});

test('圆满轮回：得道行、境界重置', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = 6;
  GameEngine.state.level = 9;
  GameEngine.state.cultivation = 999999;
  GameEngine.state.totalCultivation = 66850;
  GameEngine.state.herb = 500;
  const gain = GameEngine.rebirthDaoGain;
  assert(gain > 0, 'Dao gain should be positive');
  const r = GameEngine.rebirth();
  assert(r.ok, 'Rebirth should succeed');
  assertEq(GameEngine.state.realm, 1, 'Realm reset');
  assertEq(GameEngine.state.level, 1, 'Level reset');
  assertEq(GameEngine.state.dao, gain, 'Dao granted');
  assertEq(GameEngine.state.rebirths, 1, 'Rebirth counted');
  assertEq(GameEngine.state.totalCultivation, 0, 'Run counter reset');
  assert(GameEngine.state.herb <= 10, 'Resources reset');
});

test('道行提供永久加成', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.dao = 50;
  assertClose(GameEngine.daoRateMult, 1.5, 0.001, 'Rate +50%');
  assertClose(GameEngine.daoHerbMult, 1.25, 0.001, 'Herb +25%');
});

test('轮回保留功法（外部存档不重置）', () => {
  TechniqueSystem._learned = { breathing_art: true };
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = 6;
  GameEngine.state.level = 9;
  GameEngine.state.cultivation = 999999;
  GameEngine.rebirth();
  assert(TechniqueSystem._learned.breathing_art === true, 'Techniques survive rebirth');
  TechniqueSystem._learned = {};
});

// ===========================
// 13. 集成测试
// ===========================
console.log('\n=== 13. 集成测试 ===');

test('完整修炼流程：种→炼→坐→突', () => {
  // 重置
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 100;
  GameEngine.state.dew = 50;
  GameEngine.state.breakthroughPill = 0;
  GameEngine.state.cultivation = 0;

  // 1. 种植
  assert(GameEngine.plant(0, 'herb_qingling'), 'Plant should succeed');

  // 2. 炼丹（聚气丹）
  assert(GameEngine.startCraft('pill_qiju'), 'Craft should succeed');

  // 3. 模拟炼制完成
  GameEngine.state.craftingQueue[0].timeRemaining = 0;
  GameEngine._tickAlchemy(0.1);
  assert(GameEngine.state.cultivationPill >= 1, 'Should have pill');

  // 4. 使用丹药
  GameEngine.useCultivationPill();

  // 5. 打坐
  GameEngine.startMeditation();
  GameEngine._tickMeditation(5.0);
  GameEngine.stopMeditation();

  // 6. 修为应该增长
  assert(GameEngine.state.cultivation > 0, 'Cultivation should grow');
});

test('存档→读档→状态一致', () => {
  localStorage.clear();
  const data = SaveSystem.createDefault();
  data.realm = 3;
  data.level = 7;
  data.cultivation = 555;
  data.herb = 42;
  SaveSystem.save(data);

  const loaded = SaveSystem.load();
  assertEq(loaded.realm, 3);
  assertEq(loaded.level, 7);
  assertEq(loaded.cultivation, 555);
  assertEq(loaded.herb, 42);
});

test('宠物+功法加成叠加后修为速率提升', () => {
  GameEngine.state = SaveSystem.createDefault();
  const baseRate = calcRate(1, false, false);

  // 启用宠物+功法
  PetSystem._owned = { 'spirit_fish': { level: 1, active: true } };
  PetSystem._activePet = 'spirit_fish';
  TechniqueSystem._learned = { 'breathing_art': true };

  const boostedRate = calcRate(1, false, false)
    * (1 + PetSystem.cultivationRateBonus)
    * (1 + TechniqueSystem.cultivationRateBonus);

  assert(boostedRate > baseRate, `Boosted (${boostedRate}) should be > base (${baseRate})`);

  // 清理
  PetSystem._owned = {};
  PetSystem._activePet = null;
  TechniqueSystem._learned = {};
});

// ===========================
// 14. 加成兑现与系统一致性（本轮优化新增）
// ===========================
console.log('\n=== 14. 加成兑现与系统一致性 ===');

test('炼丹心法确实缩短炼制时间', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.herb = 999; GameEngine.state.dew = 999; GameEngine.state.ore = 999;
  TechniqueSystem._learned = {};
  GameEngine.startCraft('pill_qiju');
  const slow = GameEngine.state.craftingQueue[0].timeRemaining;
  GameEngine.state.craftingQueue = [];

  TechniqueSystem._learned = { alchemy_heart: true };  // +25% 速度
  GameEngine.startCraft('pill_qiju');
  const fast = GameEngine.state.craftingQueue[0].timeRemaining;
  TechniqueSystem._learned = {};
  assert(fast < slow, `学习心法后应更快：${fast} < ${slow}`);
  assertClose(fast, slow * 0.75, 0.01);
});

test('天道功让破障丹有几率不被消耗', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = 2;
  GameEngine.state.level = 9;
  GameEngine.state.cultivation = calcQ(2, 9, 1.0);
  GameEngine.state.spiritSense = 999; GameEngine.state.health = 9999; GameEngine.state.mana = 9999;
  GameEngine.state.breakthroughPill = 1;
  TechniqueSystem._learned = { heavenly_dao: true };   // 破障丹 50% 不消耗

  const origRandom = Math.random;
  Math.random = () => 0.1;    // 强制落进 50% 折扣区间
  const r = GameEngine.tryBreakthrough();
  Math.random = origRandom;
  TechniqueSystem._learned = {};

  assert(r.success, '应突破成功');
  assertEq(GameEngine.state.breakthroughPill, 1, '丹药应被保留');
  assert(r.pillSaved, '返回值应标记丹药被保留');
});

test('未学天道功时破障丹照常消耗', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = 2;
  GameEngine.state.level = 9;
  GameEngine.state.cultivation = calcQ(2, 9, 1.0);
  GameEngine.state.spiritSense = 999; GameEngine.state.health = 9999; GameEngine.state.mana = 9999;
  GameEngine.state.breakthroughPill = 1;
  TechniqueSystem._learned = {};
  GameEngine.tryBreakthrough();
  assertEq(GameEngine.state.breakthroughPill, 0, '应消耗 1 颗');
});

test('灵龟提升离线结算上限', () => {
  const st = SaveSystem.createDefault();
  st.lastSaveTicks = Date.now() - (GameConfig.offlineCapSeconds + 3600) * 1000; // 超出 8h 上限 1 小时
  PetSystem._owned = {};
  PetSystem._activePet = null;
  const without = SaveSystem.calculateOfflineGains(st, Date.now());

  PetSystem._owned = { spirit_turtle: { level: 1, active: true } };
  PetSystem._activePet = 'spirit_turtle';
  const withPet = SaveSystem.calculateOfflineGains(st, Date.now());
  PetSystem._owned = {}; PetSystem._activePet = null;

  assert(withPet.elapsedSeconds > without.elapsedSeconds,
    `带灵龟应结算更久：${withPet.elapsedSeconds} > ${without.elapsedSeconds}`);
});

test('离线灵草随已开垦地块数增长', () => {
  const mk = (plots) => {
    const st = SaveSystem.createDefault();
    st.unlockedPlots = plots;
    st.lastSaveTicks = Date.now() - 3600 * 1000;
    return SaveSystem.calculateOfflineGains(st, Date.now()).herb;
  };
  const h3 = mk(3), h8 = mk(8);
  assert(h8 > h3 * 2, `8 块地应明显多于 3 块：${h8} vs ${h3}`);
});

test('导出存档包含宠物与功法', () => {
  localStorage.setItem('dxy_pets', JSON.stringify({ owned: { spirit_fish: { level: 2 } }, activePet: 'spirit_fish' }));
  localStorage.setItem('dxy_techniques', JSON.stringify({ breathing_art: true }));
  const extras = SaveSystem._collectExtras();
  localStorage.removeItem('dxy_pets');
  localStorage.removeItem('dxy_techniques');
  assert(extras.pets && extras.pets.activePet === 'spirit_fish', '应打包宠物');
  assert(extras.techniques && extras.techniques.breathing_art, '应打包功法');
});

test('附属数据可被还原', () => {
  const n = SaveSystem._restoreExtras({
    pets: { owned: { little_dog: { level: 1 } }, activePet: 'little_dog' },
    techniques: { sword_art: true },
  });
  assertEq(n, 2, '应还原 2 项');
  assert(localStorage.getItem('dxy_pets') !== null, '宠物应写回');
  localStorage.removeItem('dxy_pets');
  localStorage.removeItem('dxy_techniques');
});

test('游戏内时钟：1 现实秒 = 1 游戏分钟', () => {
  WeatherSystem._gameHour = 12;
  WeatherSystem._gameMinute = 0;
  WeatherSystem.tick(1.0);          // 1 秒
  assertClose(WeatherSystem._gameMinute, 1.0, 0.001);
});

test('事件派发：单个监听器抛错不影响其它监听器', () => {
  let reached = 0;
  const bad = () => { throw new Error('boom'); };
  const good = () => { reached++; };
  GameEngine.on('__audit_test', bad);
  GameEngine.on('__audit_test', good);
  const origError = console.error;
  console.error = () => {};
  GameEngine._emit('__audit_test', 1);
  console.error = origError;
  GameEngine.off('__audit_test');
  assertEq(reached, 1, '第二个监听器仍应执行');
});

test('突破后溢出缓冲结转到新层', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.cultivation = calcQ(1, 1, 1.0);
  GameEngine.state.bufferedCultivation = 15;
  GameEngine.tryBreakthrough();
  assert(GameEngine.state.cultivation > 0, `应结转部分修为，实际 ${GameEngine.state.cultivation}`);
  assert(GameEngine.state.cultivation <= calcQ(1, 2, 1.0) * 0.2 + 0.001, '结转量不超过新层上限 20%');
});

test('存档版本升级后可迁移而非丢弃', () => {
  const old = SaveSystem.createDefault();
  old.version = 0;
  old.realm = 3;
  old.level = 4;
  const migrated = SaveSystem.migrate(old);
  assert(migrated, '旧版本应可迁移');
  assertEq(migrated.realm, 3, '境界应保留');
  assertEq(migrated.version, SaveSystem.VERSION, '应标记为当前版本');
});

test('脏档缺字段时补默认值而不是崩溃', () => {
  const dirty = { version: SaveSystem.VERSION, realm: 2, level: 3 }; // 缺 plots / craftingQueue 等
  const fixed = SaveSystem._ensureShape(dirty);
  assertEq(fixed.plots.length, GameConfig.maxPlots, '地块数组应补齐');
  assert(Array.isArray(fixed.craftingQueue), '炼丹队列应为数组');
  assertEq(fixed.herb, 10, '缺失资源应回落到默认值');
});

// ===========================
// 15. 时间连续性（放置游戏的核心承诺）
// ===========================
console.log('\n=== 15. 时间连续性与多标签页 ===');

test('切后台 10 分钟回来会补算收益', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = 6;
  GameEngine.state.level = 1;
  GameEngine.state.cultivation = 0;
  GameEngine._lastTick = Date.now();

  GameEngine._setBackground(true);
  GameEngine._lastTick = Date.now() - 600 * 1000;  // 期间没有任何 tick
  GameEngine._setBackground(false);

  const should = calcRate(6, false, false) * GameConfig.bgRateMult * 600;
  const got = GameEngine.state.cultivation;
  assert(got > should * 0.95, `应接近后台收益 ${should.toFixed(0)}，实际 ${got.toFixed(0)}`);
});

test('页面被冻结（无 visibilitychange）也能补算', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = 6;
  GameEngine.state.level = 1;
  GameEngine.state.cultivation = 0;
  GameEngine._lastTick = Date.now() - 600 * 1000;   // 上一次 tick 在十分钟前

  GameEngine.tick();   // dt 会被判为超时，走离场结算

  const should = calcRate(6, false, false) * GameConfig.bgRateMult * 600;
  assert(GameEngine.state.cultivation > should * 0.95,
    `冻结恢复应补算 ${should.toFixed(0)}，实际 ${GameEngine.state.cultivation.toFixed(0)}`);
});

test('补算受离线结算上限约束', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = 6;
  GameEngine.state.level = 1;
  GameEngine.state.cultivation = 0;
  // 离开 30 小时，远超 8 小时上限
  GameEngine._lastTick = Date.now() - 30 * 3600 * 1000;
  const summary = GameEngine.catchUpAway();
  assert(summary, '应返回补算摘要');
  assertEq(Math.round(summary.seconds), GameConfig.offlineCapSeconds, '应被钳到离线上限');
  assert(summary.capped, '应标记为已达上限');
});

test('不足 10 秒的离开不触发补算', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine._lastTick = Date.now() - 5 * 1000;
  const summary = GameEngine.catchUpAway();
  assertEq(summary, null, '5 秒不应补算');
});

test('补算与累计修为同步累加', () => {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = 6;
  GameEngine.state.level = 1;
  GameEngine.state.cultivation = 0;
  GameEngine.state.totalCultivation = 0;
  GameEngine._lastTick = Date.now() - 120 * 1000;
  const before = GameEngine.state.totalCultivation;
  GameEngine.catchUpAway();
  assert(GameEngine.state.totalCultivation > before, '轮回统计应包含补算部分');
});

test('另一个标签页写入后本页停止自动存档', () => {
  let notified = 0;
  SaveSystem._autoSaveDisabled = false;
  SaveSystem.watchOtherTabs(() => { notified++; });
  global.window.dispatch('storage', { key: SaveSystem.WRITER_KEY, newValue: 'another-tab' });
  assert(SaveSystem._autoSaveDisabled, '应降级为不自动存档');
  assertEq(notified, 1, '应通知一次');
  // 重复事件不应反复提示
  global.window.dispatch('storage', { key: SaveSystem.WRITER_KEY, newValue: 'another-tab' });
  assertEq(notified, 1, '只提示一次');
});

test('自己的写入不触发冲突', () => {
  SaveSystem._autoSaveDisabled = false;
  let notified = 0;
  SaveSystem.watchOtherTabs(() => { notified++; });
  global.window.dispatch('storage', { key: SaveSystem.WRITER_KEY, newValue: SaveSystem._tabId });
  assert(!SaveSystem._autoSaveDisabled, '自己的写入不应降级');
  assertEq(notified, 0, '不应通知');
});

test('手动存档重新夺回写入权', () => {
  SaveSystem._autoSaveDisabled = true;
  SaveSystem.reclaimWriter();
  assert(!SaveSystem._autoSaveDisabled, '应恢复自动存档');
  assertEq(localStorage.getItem(SaveSystem.WRITER_KEY), SaveSystem._tabId, '写入者应改回本页');
});

// ===========================
// 16. 宗门与秘境（MECH-021 / MECH-022）
// ===========================
console.log('\n=== 16. 宗门与秘境 ===');

function freshSectState(realm) {
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = realm || 2;
  GameEngine.state.level = 1;
  GameEngine.state.stone = 5000;
  GameEngine.state.spiritSense = 15;
  GameEngine.state.mana = 200;
  GameEngine.state.health = 100;
  GameEngine.state.cultivation = 0;
  SectSystem.ensure();
  DelveSystem.ensure();
}

test('未达筑基不能入宗', () => {
  freshSectState(1);
  assert(!SectSystem.canJoin, '练气期不应可入宗');
  const r = SectSystem.join();
  assert(!r.ok, '应拒绝入宗');
});

test('筑基后可入宗，职位为杂役弟子', () => {
  freshSectState(2);
  assert(SectSystem.canJoin, '筑基应可入宗');
  const r = SectSystem.join();
  assert(r.ok, '入宗应成功');
  assertEq(SectSystem.rankDef.name, '杂役弟子');
  assertEq(SectSystem.maxTier, 1, '外门只能进第 1 层秘境');
});

test('供奉扣灵石、加贡献', () => {
  freshSectState(2);
  SectSystem.join();
  const stone0 = GameEngine.state.stone;
  const r = SectSystem.offer(1);
  assert(r.ok, '供奉应成功');
  assertEq(GameEngine.state.stone, stone0 - GameConfig.sect.offeringStone, '应扣灵石');
  assertEq(SectSystem.data.contrib, GameConfig.sect.offeringContrib, '应加贡献');
});

test('供奉有每日贡献上限', () => {
  freshSectState(2);
  SectSystem.join();
  const cap = GameConfig.sect.dailyContribCap;
  const times = Math.ceil(cap / GameConfig.sect.offeringContrib) + 3;
  for (let i = 0; i < times; i++) SectSystem.offer(1);
  assert(SectSystem.data.contribToday <= cap, `今日贡献不应超过 ${cap}，实际 ${SectSystem.data.contribToday}`);
});

test('贡献达标自动晋升并解锁更深秘境', () => {
  freshSectState(2);
  SectSystem.join();
  SectSystem.data.contrib = 0;
  // 直接给够贡献再走一次供奉触发晋升判定
  SectSystem.data.prestige = 9999;   // 先让宗门等级够格
  SectSystem.data.contrib = GameConfig.sect.positions[3].contrib;
  SectSystem.data.contribToday = 0;
  SectSystem.offer(1);
  assertEq(SectSystem.data.rank, 3, '应晋升到真传弟子');
  assertEq(SectSystem.maxTier, 3, '真传可进第 3 层');
});

test('每日可领秘境令，且一天只能领一次', () => {
  freshSectState(2);
  SectSystem.join();
  const r1 = SectSystem.claimDailyTokens();
  assert(r1.ok, '首次领取应成功');
  assertEq(SectSystem.data.tokens, SectSystem.rankDef.tokens);
  const r2 = SectSystem.claimDailyTokens();
  assert(!r2.ok, '同日重复领取应被拒');
});

test('无秘境令不能进入', () => {
  freshSectState(2);
  SectSystem.join();
  SectSystem.data.tokens = 0;
  const r = DelveSystem.enter(1);
  assert(!r.ok, '无令应拒绝');
  assert(/秘境令/.test(r.msg), `提示应提到秘境令，实际：${r.msg}`);
});

test('进入秘境扣令并初始化局内状态', () => {
  freshSectState(2);
  SectSystem.join();
  SectSystem.data.tokens = 2;
  const r = DelveSystem.enter(1);
  assert(r.ok, '应成功进入');
  assertEq(SectSystem.data.tokens, 1, '应扣 1 枚令');
  assert(DelveSystem.active, '应处于探索中');
  assertEq(DelveSystem.data.floor, 1, '从第 1 层开始');
  assertEq(DelveSystem.data.doors.length, 3, '应有三个门可选');
  assertEq(DelveSystem.data.hp, GameEngine.state.health, '气血应满');
});

test('三个门的类型互不相同（可读的随机性）', () => {
  freshSectState(2);
  SectSystem.join();
  SectSystem.data.tokens = 1;
  for (let i = 0; i < 20; i++) {
    DelveSystem.data.active = false;
    DelveSystem.data.tokens = SectSystem.data.tokens;
    SectSystem.data.tokens = 1;
    DelveSystem.enter(1);
    const kinds = DelveSystem.data.doors.map(d => d.kind);
    assertEq(new Set(kinds).size, 3, `三个门应各不相同，实际 ${kinds.join(',')}`);
  }
});

test('灵机门必成并产出战利品', () => {
  freshSectState(2);
  SectSystem.join();
  SectSystem.data.tokens = 1;
  DelveSystem.enter(1);
  const idx = DelveSystem.data.doors.findIndex(d => d.kind === 'spirit');
  const r = DelveSystem.choose(idx);
  assert(r.ok && r.success, '灵机应必定成功');
  const loot = DelveSystem.data.loot;
  assert((loot.stone || 0) > 0, '应获得灵石');
});

test('妖兽门成功率随层数下降', () => {
  freshSectState(2);
  const p1 = DelveSystem.successChance(1, 1, 0);
  const p5 = DelveSystem.successChance(5, 1, 0);
  assert(p1 > p5, `深层成功率应更低：${p1.toFixed(2)} vs ${p5.toFixed(2)}`);
  const pTaint = DelveSystem.successChance(1, 1, 0.3);
  assert(pTaint < p1, '浊气应降低成功率');
});

test('主动撤离：战利品全额入账', () => {
  freshSectState(2);
  SectSystem.join();
  SectSystem.data.tokens = 1;
  DelveSystem.enter(1);
  const idx = DelveSystem.data.doors.findIndex(d => d.kind === 'spirit');
  DelveSystem.choose(idx);
  const bag = { ...DelveSystem.data.loot };
  const stone0 = GameEngine.state.stone;
  const r = DelveSystem.withdraw();
  assert(r.ok, '撤离应成功');
  assertEq(GameEngine.state.stone - stone0, bag.stone || 0, '灵石应全额入账');
  assert(!DelveSystem.active, '应退出探索');
});

test('气血归零 → 重伤：只保一半战利品并留下伤势', () => {
  freshSectState(2);
  SectSystem.join();
  SectSystem.data.tokens = 1;
  DelveSystem.enter(1);
  // 先把战利品堆起来
  DelveSystem.data.loot = { stone: 100 };
  DelveSystem.data.hp = 1;

  const origRandom = Math.random;
  Math.random = () => 0.99;              // 强制失败
  const idx = DelveSystem.data.doors.findIndex(d => d.kind === 'beast');
  const stone0 = GameEngine.state.stone;
  const r = DelveSystem.choose(idx >= 0 ? idx : 0);
  Math.random = origRandom;

  assert(r.maimed, '应变判定为重伤');
  assert(!DelveSystem.active, '应退出探索');
  assertEq(GameEngine.state.stone - stone0, 50, '应只带回一半');
  assert(DelveSystem.hasInjury(), '应留下伤势');
});

test('伤势降低修炼速率，疗伤可清除', () => {
  freshSectState(2);
  GameEngine.state.stone = 5000;
  GameEngine.state.injuryUntil = Date.now() + 600 * 1000;
  assert(DelveSystem.hasInjury(), '应有伤势');
  assertClose(DelveSystem.ratePenalty, 1 - GameConfig.delve.injuryRatePenalty, 0.001);

  const stone0 = GameEngine.state.stone;
  const r = DelveSystem.heal();
  assert(r.ok, '疗伤应成功');
  assert(!DelveSystem.hasInjury(), '伤势应清除');
  assertEq(GameEngine.state.stone, stone0 - GameConfig.sect.healCostStone, '应扣灵石');
});

test('走完全部层数自动结算', () => {
  freshSectState(2);
  SectSystem.join();
  SectSystem.data.tokens = 1;
  DelveSystem.enter(1);
  const tier = GameConfig.delve.tiers[0];

  // 一路选灵机（必成、不掉血），直到走完
  for (let guard = 0; guard < 20 && DelveSystem.active; guard++) {
    const idx = DelveSystem.data.doors.findIndex(d => d.kind === 'spirit');
    DelveSystem.choose(idx >= 0 ? idx : 0);
  }
  assert(!DelveSystem.active, '应已结算');
  assert(DelveSystem.data.bestFloor >= tier.floors, '最深记录应达末层');
});

test('秘境产出折算宗门贡献', () => {
  freshSectState(2);
  SectSystem.join();
  SectSystem.data.tokens = 1;
  DelveSystem.enter(1);
  const c0 = SectSystem.data.contrib;
  const idx = DelveSystem.data.doors.findIndex(d => d.kind === 'spirit');
  DelveSystem.choose(idx);
  DelveSystem.withdraw();
  assert(SectSystem.data.contrib > c0, '应获得贡献');
});

test('进行中的秘境可从存档恢复', () => {
  freshSectState(2);
  SectSystem.join();
  SectSystem.data.tokens = 1;
  DelveSystem.enter(1);
  const snapshot = JSON.parse(JSON.stringify(GameEngine.state));
  const restored = SaveSystem._ensureShape(snapshot);
  assert(restored.delve.active, '进行中状态应保留');
  assertEq(restored.delve.doors.length, 3, '门选项应保留');
});

test('存档里 active 但没有门 → 判定为未开始', () => {
  const dirty = SaveSystem.createDefault();
  dirty.delve.active = true;
  dirty.delve.doors = [];
  const fixed = SaveSystem._ensureShape(dirty);
  assert(!fixed.delve.active, '应修正为未开始，避免卡死在空秘境');
});

test('职位不足时无法进入高层秘境', () => {
  freshSectState(2);
  SectSystem.join();
  SectSystem.data.tokens = 5;
  SectSystem.data.rank = 0;
  const r = DelveSystem.enter(3);
  assert(!r.ok, '杂役弟子不应能进第 3 层');
});

test('同门榜包含自己且按分数排序', () => {
  freshSectState(2);
  SectSystem.join();
  DelveSystem.data.bestFloor = 6;
  const board = SectSystem.board;
  assert(board.some(r => r.self), '榜单应包含自己');
  for (let i = 1; i < board.length; i++) {
    assert(board[i - 1].score >= board[i].score, '应按分数降序');
  }
});

// ===========================
// 17. 宗门等级 · 职位 · 收徒（MECH-021 / MECH-023）
// ===========================
console.log('\n=== 17. 宗门等级与收徒 ===');

function freshSect2(opts) {
  const o = opts || {};
  GameEngine.state = SaveSystem.createDefault();
  GameEngine.state.realm = o.realm || 3;
  GameEngine.state.level = 1;
  GameEngine.state.stone = o.stone === undefined ? 20000 : o.stone;
  GameEngine.state.spiritSense = 30;
  GameEngine.state.mana = 200;
  GameEngine.state.health = 200;
  GameEngine.state.cultivation = 0;
  SectSystem.ensure();
  DiscipleSystem.ensure();
  if (o.join !== false) SectSystem.join();
  if (o.contrib !== undefined) SectSystem.data.contrib = o.contrib;
  if (o.prestige !== undefined) SectSystem.data.prestige = o.prestige;
  if (o.rank !== undefined) SectSystem.data.rank = o.rank;
  return GameEngine.state;
}

test('入宗即为杂役弟子，且无收徒名额', () => {
  freshSect2();
  assertEq(SectSystem.rankDef.name, '杂役弟子');
  assertEq(SectSystem.discipleSlots, 0);
  const r = DiscipleSystem.canRecruit;
  assert(!r.ok, '杂役弟子不应能收徒');
});

test('职位晋升需同时满足贡献与宗门等级', () => {
  freshSect2({ contrib: 99999, prestige: 0 });
  const before = SectSystem.data.rank;
  assert(before <= 1, `宗门等级不足时不应越级，实际 rank=${before}`);

  freshSect2({ contrib: 99999, prestige: 99999 });
  SectSystem._refreshRank();
  assertEq(SectSystem.data.rank, GameConfig.sect.positions.length - 1, '两项都满足应到顶');
});

test('宗门等级由声望决定', () => {
  freshSect2({ prestige: 0 });
  assertEq(SectSystem.grade, 1);
  SectSystem.data.prestige = 300;
  assertEq(SectSystem.grade, 2);
  SectSystem.data.prestige = 4000;
  assertEq(SectSystem.grade, 5);
});

test('职位越高：日令越多、供奉越便宜', () => {
  freshSect2();
  const low = { tokens: SectSystem.rankDef.tokens, cost: SectSystem.offeringCost };
  SectSystem.data.prestige = 99999;
  SectSystem.data.contrib = 99999;
  SectSystem._refreshRank();
  const high = { tokens: SectSystem.rankDef.tokens, cost: SectSystem.offeringCost };
  assert(high.tokens > low.tokens, `高职位日令应更多：${low.tokens} → ${high.tokens}`);
  assert(high.cost < low.cost, `高职位供奉应更便宜：${low.cost} → ${high.cost}`);
});

test('掌门月例每日只能领一次', () => {
  freshSect2();
  const c0 = SectSystem.data.contrib;
  const p0 = SectSystem.data.prestige;
  const r1 = SectSystem.takeTask();
  assert(r1.ok, '首次应可领');
  assert(SectSystem.data.contrib > c0, '应加贡献');
  assert(SectSystem.data.prestige > p0, '应加声望');
  const r2 = SectSystem.takeTask();
  assert(!r2.ok, '同日重复领取应被拒');
});

test('传功长老：宗门等级不足时无法换功法', () => {
  freshSect2({ contrib: 9999, prestige: 0 });
  const s = GameConfig.sect.scriptures[0];
  const r = SectSystem.buyScripture(s.id);
  assert(!r.ok, '宗门等级不足应被拒');
  assert(/宗门/.test(r.msg), `提示应提到宗门等级，实际：${r.msg}`);
});

test('传功长老：条件满足后可习得宗门功法', () => {
  freshSect2({ contrib: 9999, prestige: 99999 });
  SectSystem._refreshRank();
  const s = GameConfig.sect.scriptures[0];
  const stone0 = GameEngine.state.stone;
  const r = SectSystem.buyScripture(s.id);
  assert(r.ok, `应可换：${r.msg || ''}`);
  assertEq(GameEngine.state.stone, stone0 - s.cost, '应扣灵石');
  assert(TechniqueSystem._learned[s.id], '应并入功法系统');
  TechniqueSystem._learned = {};
});

test('真传弟子起方可收徒，且受名额限制', () => {
  freshSect2({ contrib: 1500, prestige: 4000 });
  SectSystem._refreshRank();
  assertEq(SectSystem.rankDef.name, '真传弟子');
  assertEq(SectSystem.discipleSlots, 1);

  const r = DiscipleSystem.recruit();
  assert(r.ok, '应可收徒');
  assertEq(DiscipleSystem.count, 1);

  const r2 = DiscipleSystem.canRecruit;
  assert(!r2.ok, '名额已满应被拒');
});

test('收徒消耗灵石与贡献', () => {
  freshSect2({ contrib: 2000, prestige: 4000 });
  SectSystem._refreshRank();
  const stone0 = GameEngine.state.stone;
  const c0 = SectSystem.data.contrib;
  DiscipleSystem.recruit();
  assertEq(GameEngine.state.stone, stone0 - GameConfig.disciple.recruitStone);
  assertEq(SectSystem.data.contrib, c0 - GameConfig.disciple.recruitContrib);
});

test('弟子随时间增长修为', () => {
  freshSect2({ contrib: 2000, prestige: 4000 });
  SectSystem._refreshRank();
  DiscipleSystem.recruit();
  const d = DiscipleSystem.list[0];
  const c0 = d.cultivation;
  DiscipleSystem.tick(60 * 5);   // 5 分钟
  assert(d.cultivation > c0, `修为应增长：${c0} → ${d.cultivation}`);
});

test('指点提升忠诚但消耗灵石', () => {
  freshSect2({ contrib: 2000, prestige: 4000 });
  SectSystem._refreshRank();
  DiscipleSystem.recruit();
  const d = DiscipleSystem.list[0];
  d.loyalty = 30;
  const stone0 = GameEngine.state.stone;
  const r = DiscipleSystem.advise(d.id);
  assert(r.ok, '指点应成功');
  assert(d.loyalty > 30, '忠诚应提升');
  assertEq(GameEngine.state.stone, stone0 - GameConfig.disciple.adviseStone);
});

test('传功消耗自身修为换弟子进度', () => {
  freshSect2({ contrib: 2000, prestige: 4000 });
  SectSystem._refreshRank();
  DiscipleSystem.recruit();
  const d = DiscipleSystem.list[0];
  const cap = calcQ(GameEngine.state.realm, GameEngine.state.level, 1.0);
  GameEngine.state.cultivation = cap;
  const c0 = d.cultivation;
  const r = DiscipleSystem.impart(d.id);
  assert(r.ok, `传功应成功：${r.msg || ''}`);
  assert(GameEngine.state.cultivation < cap, '应消耗自身修为');
  assert(d.cultivation > c0, '弟子修为应提升');
});

test('修为不足时不能传功', () => {
  freshSect2({ contrib: 2000, prestige: 4000 });
  SectSystem._refreshRank();
  DiscipleSystem.recruit();
  GameEngine.state.cultivation = 0;
  const r = DiscipleSystem.impart(DiscipleSystem.list[0].id);
  assert(!r.ok, '修为为 0 时不应能传功');
});

test('教习磨资质每日一次', () => {
  freshSect2({ contrib: 2000, prestige: 4000 });
  SectSystem._refreshRank();
  DiscipleSystem.recruit();
  const d = DiscipleSystem.list[0];
  d.aptitude = 2;
  const r1 = DiscipleSystem.train(d.id);
  assert(r1.ok, '首次应可磨');
  assertEq(d.aptitude, 3, '资质应 +1');
  const r2 = DiscipleSystem.train(d.id);
  assert(!r2.ok, '同日重复磨应被拒');
});

test('修为满可升亲传，亲传出师给声望与贡献', () => {
  freshSect2({ contrib: 2000, prestige: 4000 });
  SectSystem._refreshRank();
  DiscipleSystem.recruit();
  const d = DiscipleSystem.list[0];
  d.cultivation = 100;

  const pro = DiscipleSystem.canPromote(d.id);
  assert(pro.ok && pro.next === 1, '应可升亲传');
  const r1 = DiscipleSystem.promote(d.id);
  assert(r1.ok && r1.stage === 1, '应升为亲传');
  assertEq(d.stage, 1);

  d.cultivation = 100;
  const p0 = SectSystem.data.prestige;
  const c0 = SectSystem.data.contrib;
  const r2 = DiscipleSystem.promote(d.id);
  assert(r2.ok && r2.stage === 2, '应出师');
  assert(SectSystem.data.prestige > p0, '应加声望');
  assert(SectSystem.data.contrib > c0, '应加贡献');
  assertEq(DiscipleSystem.count, 0, '出师后应移出师门名录');
  assert(SectSystem.data.graduated.some(x => x.name === d.name), '应记入门下名录');
});

test('忠诚过低会叛出师门', () => {
  freshSect2({ contrib: 2000, prestige: 4000 });
  SectSystem._refreshRank();
  DiscipleSystem.recruit();
  const d = DiscipleSystem.list[0];
  d.loyalty = 0;

  const origRandom = Math.random;
  Math.random = () => 0;                 // 强制触发叛出判定
  DiscipleSystem.tick(60 * 60);          // 跑 1 小时
  Math.random = origRandom;

  assertEq(DiscipleSystem.count, 0, '应叛出');
});

test('旧档职位索引迁移：外门 → 新体系外门', () => {
  const old = SaveSystem.createDefault();
  old.sect.joined = true;
  old.sect.rank = 0;            // 旧体系 0 = 外门弟子
  delete old.sect.schema;       // 模拟 v1 存档（无 schema 字段）
  delete old.sect.prestige;
  GameEngine.state = SaveSystem._ensureShape(old);
  const d = SectSystem.ensure();
  assertEq(d.rank, 1, '旧「外门」应迁到新索引 1');
  assertEq(SectSystem.rankDef.name, '外门弟子');
  assertEq(d.schema, GameConfig.sect.schema, '应标记为新 schema');
});

test('弟子产出贡献与灵石', () => {
  freshSect2({ contrib: 2000, prestige: 4000 });
  SectSystem._refreshRank();
  DiscipleSystem.recruit();
  const d = DiscipleSystem.list[0];
  d.aptitude = 5;
  d.loyalty = 80;
  const c0 = SectSystem.data.contrib;
  const s0 = GameEngine.state.stone;
  DiscipleSystem.tick(60 * 30);   // 30 分钟
  assert(SectSystem.data.contrib > c0, '应产出贡献');
  assert(GameEngine.state.stone > s0, '应产出灵石');
});

// ===========================
// 测试报告
// ===========================
console.log('\n' + '='.repeat(50));
console.log(`测试报告：${passedTests}/${totalTests} 通过，${failedTests} 失败`);
if (failedTests > 0) {
  console.log('\n失败详情：');
  failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.error}`));
}
console.log('='.repeat(50));

process.exit(failedTests > 0 ? 1 : 0);
