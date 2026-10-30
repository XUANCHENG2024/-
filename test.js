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
global.window = { addEventListener: () => {} };
global.navigator = { vibrate: () => {} };
global.AudioContext = undefined;

// 用 vm.runInThisContext 加载模块（共享全局作用域）
const context = vm.createContext(global);
vm.runInThisContext(loadFile('js/config.js'), { filename: 'config.js' });
vm.runInThisContext(loadFile('js/save.js'), { filename: 'save.js' });
vm.runInThisContext(loadFile('js/engine.js'), { filename: 'engine.js' });
vm.runInThisContext(loadFile('js/features.js'), { filename: 'features.js' });
vm.runInThisContext(loadFile('js/systems.js'), { filename: 'systems.js' });

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

test('increment 增加进度', () => {
  localStorage.clear();
  DailyGoals.init();
  const goals = DailyGoals.getAll();
  goals[0].type = 'farming';
  goals[0].target = 3;
  goals[0].progress = 0;
  goals[0].completed = false;
  DailyGoals.increment('farming', 1);
  DailyGoals.increment('farming', 1);
  DailyGoals.increment('farming', 1);
  assert(goals[0].completed, 'Should be complete after 3 increments');
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
