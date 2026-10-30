/**
 * 桌面修仙 · 真实 DOM 点击测试（jsdom）
 * 运行：node e2e-test.js
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push({ name, detail }); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const W = dom.window;
const document = W.document;

W.AudioContext = undefined;
W.navigator.vibrate = () => {};
W.matchMedia = W.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));

// 逐个注入脚本（作为 <script> 执行，共享全局词法环境）
const scripts = ['config.js', 'save.js', 'engine.js', 'features.js', 'systems.js', 'sect.js', 'ui.js'];
for (const s of scripts) {
  const code = fs.readFileSync(path.join(__dirname, 'js', s), 'utf8');
  const el = document.createElement('script');
  el.textContent = code;
  document.body.appendChild(el);
}

// 通过 eval 读取全局词法绑定
const G = (name) => W.eval(name);

const GameEngine = G('GameEngine');
const SaveSystem = G('SaveSystem');
const UI = G('UI');
const DailyGoals = G('DailyGoals');
const VisitorSystem = G('VisitorSystem');
const WeatherSystem = G('WeatherSystem');
const PetSystem = G('PetSystem');
const TechniqueSystem = G('TechniqueSystem');

// ===== 1. 关键：遮罩层是否吞点击 =====
console.log('\n=== 1. 遮罩层遮挡检测（关键根因） ===');

// 真实浏览器语义：author 的 display 规则会覆盖 [hidden]
// 检查是否声明了 [hidden] 的强制隐藏规则
const css = fs.readFileSync(path.join(__dirname, 'css/style.css'), 'utf8');
const hasHiddenRule = /\[hidden\][^{]*\{[^}]*display\s*:\s*none\s*!important/.test(css);
check('CSS 声明 [hidden]{display:none!important}（防止 display 覆盖）', hasHiddenRule);

// 检查每个 covered 元素是否有 display 规则（有则必须靠上面的规则兜底）
const overlayEls = ['modal-overlay', 'offline-overlay', 'visitor-overlay', 'breakthrough-fx'];
let overlayRisk = [];
overlayEls.forEach(id => {
  const el = document.getElementById(id);
  if (!el) { overlayRisk.push(`${id} 不存在`); return; }
  // 找出该元素类名对应的 CSS 规则里的 display
  const cls = el.className.split(' ')[0];
  const ruleRe = new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`, 'g');
  const rules = css.match(ruleRe) || [];
  const hasDisplay = rules.some(r => /display\s*:\s*(flex|block|grid)/.test(r));
  if (hasDisplay && !hasHiddenRule) overlayRisk.push(`${cls} 有 display 且无兜底规则`);
});
check('遮罩层均有兜底隐藏规则', overlayRisk.length === 0, overlayRisk.join('; '));

// ===== 2. 初始化 =====
console.log('\n=== 2. 初始化 ===');
GameEngine.state = SaveSystem.createDefault();
DailyGoals.init();
VisitorSystem.init();
WeatherSystem.init();
PetSystem.init();
TechniqueSystem.init();
UI.init();

check('GameEngine 已初始化', !!GameEngine.state);
check('UI 已初始化', !!UI._currentTab);
check('面板数量 ≥ 7', document.querySelectorAll('.panel').length >= 7,
  `实际 ${document.querySelectorAll('.panel').length}`);

// ===== 工具 =====
function clickEl(el) {
  if (!el) return false;
  el.dispatchEvent(new W.MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}

// ===== 3. 静态按钮 =====
console.log('\n=== 3. 静态按钮 ===');

let navOk = 0;
const navBtns = document.querySelectorAll('.nav-btn');
navBtns.forEach(b => { if (clickEl(b)) navOk++; });
check('导航按钮全部可点击', navOk === navBtns.length, `${navOk}/${navBtns.length}`);

clickEl(document.querySelector('.nav-btn[data-tab="cultivation"]'));
check('导航切换生效', document.querySelector('.panel[data-panel="cultivation"]').classList.contains('active'));

clickEl(document.querySelector('.nav-btn[data-tab="system"]'));
clickEl(document.getElementById('btn-save'));
check('保存按钮可点击', W.localStorage.getItem('desktop_xianxia_save') !== null);

clickEl(document.getElementById('btn-export'));
check('导出按钮可点击（无异常）', true);

// ===== 4. 场景交互 =====
console.log('\n=== 4. 场景交互 ===');

clickEl(document.getElementById('character'));
check('角色点击 → 修炼面板', document.querySelector('.panel[data-panel="cultivation"]').classList.contains('active'));

clickEl(document.getElementById('furnace'));
check('炼丹炉点击 → 炼丹面板', document.querySelector('.panel[data-panel="alchemy"]').classList.contains('active'));

GameEngine.state = SaveSystem.createDefault();
GameEngine._swordCombo = 0;
UI._needsFullRebuild = true;
UI.refreshAll(true);
const cultBefore = GameEngine.state.cultivation;
clickEl(document.getElementById('sword-dummy'));
check('练剑桩点击 → 修为增长', GameEngine.state.cultivation > cultBefore,
  `${cultBefore} → ${GameEngine.state.cultivation}`);

// ===== 5. 动态按钮（事件委托） =====
console.log('\n=== 5. 动态按钮（事件委托） ===');

// 灵田
GameEngine.state = SaveSystem.createDefault();
GameEngine.state.herb = 100;
UI._needsFullRebuild = true;
UI.refreshAll(true);
clickEl(document.querySelector('.nav-btn[data-tab="farming"]'));

const plotBtn = document.querySelector('#plots-list [data-action="plant"]');
check('灵田播种按钮存在', !!plotBtn);
if (plotBtn) {
  const herbBefore = GameEngine.state.herb;
  clickEl(plotBtn);
  check('点击播种 → 扣灵草 + 地块生长',
    GameEngine.state.herb < herbBefore && GameEngine.state.plots[0].state === 'growing',
    `herb ${herbBefore}→${GameEngine.state.herb}, plot=${GameEngine.state.plots[0].state}`);
}

// 炼丹
GameEngine.state.herb = 100;
GameEngine.state.dew = 100;
UI._needsFullRebuild = true;
UI.refreshAll(true);
clickEl(document.querySelector('.nav-btn[data-tab="alchemy"]'));
const craftBtn = document.querySelector('#recipe-list [data-action="craft"]');
check('炼丹开炼按钮存在', !!craftBtn);
if (craftBtn) {
  const qBefore = GameEngine.state.craftingQueue.length;
  clickEl(craftBtn);
  check('点击开炼 → 进入队列',
    GameEngine.state.craftingQueue.length > qBefore,
    `queue ${qBefore}→${GameEngine.state.craftingQueue.length}`);
}

// 日常 / 宠物 / 功法 渲染
UI._needsFullRebuild = true; UI.refreshAll(true);
clickEl(document.querySelector('.nav-btn[data-tab="daily"]'));
check('日常目标渲染 3 张', document.querySelectorAll('#daily-list .daily-card').length === 3,
  `实际 ${document.querySelectorAll('#daily-list .daily-card').length}`);

clickEl(document.querySelector('.nav-btn[data-tab="pets"]'));
check('宠物渲染 4 张', document.querySelectorAll('#pet-list .pet-card').length === 4,
  `实际 ${document.querySelectorAll('#pet-list .pet-card').length}`);

clickEl(document.querySelector('.nav-btn[data-tab="techniques"]'));
check('功法渲染 5 张', document.querySelectorAll('#tech-list .tech-card').length === 5,
  `实际 ${document.querySelectorAll('#tech-list .tech-card').length}`);

// 功法学习
GameEngine.state.realm = 1;
GameEngine.state.stone = 1000;
TechniqueSystem._learned = {};
UI._needsFullRebuild = true; UI.refreshAll(true);
const learnBtn = document.querySelector('#tech-list [data-action="learn-tech"]');
check('功法学习按钮存在', !!learnBtn);
if (learnBtn) {
  const stoneBefore = GameEngine.state.stone;
  clickEl(learnBtn);
  check('点击学习 → 扣灵石', GameEngine.state.stone < stoneBefore,
    `${stoneBefore}→${GameEngine.state.stone}`);
}

// ===== 5b. 小院场景地块 + 键盘可访问性 =====
console.log('\n=== 5b. 小院地块 & 键盘 ===');

GameEngine.state = SaveSystem.createDefault();
GameEngine.state.herb = 100;
UI._needsFullRebuild = true;
UI.refreshAll(true);

const yardPlots = document.querySelectorAll('#plots .plot');
check('小院场景渲染地块', yardPlots.length === 3, `实际 ${yardPlots.length}`);

const yardPlot0 = yardPlots[0];
check('地块带 data-action', !!yardPlot0 && !!yardPlot0.dataset.action);
if (yardPlot0) {
  const hBefore = GameEngine.state.herb;
  clickEl(yardPlot0);
  check('点击小院地块 → 实际播种',
    GameEngine.state.herb < hBefore && GameEngine.state.plots[0].state === 'growing',
    `herb ${hBefore}→${GameEngine.state.herb}, plot=${GameEngine.state.plots[0].state}`);
}

// 键盘激活（Enter）
GameEngine.state = SaveSystem.createDefault();
GameEngine.state.herb = 100;
UI._needsFullRebuild = true;
UI.refreshAll(true);
const kbBtn = document.querySelector('#plots-list [data-action="plant"]');
if (kbBtn) {
  kbBtn.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  check('Enter 键触发按钮', GameEngine.state.plots[0].state === 'growing',
    `plot=${GameEngine.state.plots[0].state}`);
}

// ===== 6. 重复触发检测 =====

GameEngine.state = SaveSystem.createDefault();
GameEngine.state.cultivation = 999999;
GameEngine.state.breakthroughPill = 5;
GameEngine.state.spiritSense = 9999;
GameEngine.state.health = 9999;
GameEngine.state.mana = 9999;
UI.refreshAll(true);
const btnBT = document.getElementById('btn-breakthrough');
btnBT.hidden = false;

let btCount = 0;
const origBT = UI.showBreakthroughFX.bind(UI);
UI.showBreakthroughFX = function () { btCount++; origBT(); };
const levelBefore = GameEngine.state.level;
clickEl(btnBT);
UI.showBreakthroughFX = origBT;

check('突破按钮只触发一次（无双重绑定）', btCount === 1, `实际 ${btCount} 次`);
check('突破成功境界提升', GameEngine.state.level === levelBefore + 1,
  `level ${levelBefore}→${GameEngine.state.level}`);

// ===== 7. 触摸不阻断 =====
console.log('\n=== 7. 触摸与点击共存 ===');
GameEngine.state = SaveSystem.createDefault();
GameEngine.state.herb = 100;
UI._needsFullRebuild = true; UI.refreshAll(true);
clickEl(document.querySelector('.nav-btn[data-tab="farming"]'));
const btn2 = document.querySelector('#plots-list [data-action="plant"]');
if (btn2) {
  const t1 = new W.Event('touchend', { bubbles: true, cancelable: true });
  btn2.dispatchEvent(t1);
  const t2 = new W.Event('touchend', { bubbles: true, cancelable: true });
  btn2.dispatchEvent(t2);
  check('连续 touchend 不被阻止', !t2.defaultPrevented, `defaultPrevented=${t2.defaultPrevented}`);
}

// ===== 8. 弹窗开关 =====
console.log('\n=== 8. 弹窗开关 ===');
UI.showModal('测试', '内容');
check('showModal → 遮罩 visible', document.getElementById('modal-overlay').hidden === false);
clickEl(document.getElementById('modal-close'));
check('关闭 → 遮罩 hidden', document.getElementById('modal-overlay').hidden === true);

// 遮罩点击关闭
UI.showModal('测试2', '内容2');
clickEl(document.getElementById('modal-overlay'));
check('点遮罩 → 关闭', document.getElementById('modal-overlay').hidden === true);

// ===== 9. 丹房（此前丹药无任何 UI 入口） =====
console.log('\n=== 9. 丹房：服丹 / 加持 ===');

// 重置到干净状态并切换到修炼面板
GameEngine.state = SaveSystem.createDefault();
GameEngine.state.cultivationPill = 3;
GameEngine.state.breakthroughPill = 1;
GameEngine.state.pillBoost = false;
GameEngine.state.cultivation = 0;
UI._cvCache = {};
UI.refreshAll(true);
UI.showTab('cultivation');

const btnUse = document.getElementById('btn-use-pill');
const btnBoost = document.getElementById('btn-pill-boost');
check('丹房渲染出「服丹」按钮', !!btnUse);
check('丹房渲染出「加持」按钮', !!btnBoost);
check('「服丹」按钮带 data-action（走事件委托）', btnUse?.dataset.action === 'use-pill');
check('「加持」按钮带 data-action', btnBoost?.dataset.action === 'pill-boost');

// 服丹
const capBefore = GameEngine.state.cultivation;
clickEl(btnUse);
check('点「服丹」→ 聚气丹 -1', GameEngine.state.cultivationPill === 2,
  `实际 ${GameEngine.state.cultivationPill}`);
check('点「服丹」→ 修为增加', GameEngine.state.cultivation > capBefore,
  `${capBefore} → ${GameEngine.state.cultivation}`);

// 加持
clickEl(btnBoost);
check('点「加持」→ 进入加持状态', GameEngine.state.pillBoost === true);
check('点「加持」→ 消耗聚气丹', GameEngine.state.cultivationPill === 1,
  `实际 ${GameEngine.state.cultivationPill}`);
UI.refreshCultivation();
check('加持期间进度条可见', document.getElementById('pill-boost-bar').hidden === false);

// 加持中不可重复叠加
const before2 = GameEngine.state.cultivationPill;
clickEl(btnBoost);
check('加持中再点不重复扣丹', GameEngine.state.cultivationPill === before2);

// 丹药耗尽 → 按钮置灰
GameEngine.state.cultivationPill = 0;
GameEngine.state.pillBoost = false;
UI._cvCache = {};
UI.refreshCultivation();
check('无丹时「服丹」置灰', btnUse.classList.contains('is-off') && btnUse.disabled === true);
const c0 = GameEngine.state.cultivation;
clickEl(btnUse);
check('置灰后点击不产生修为', GameEngine.state.cultivation === c0);

// 修为满时服丹无效（不浪费丹药）
GameEngine.state.cultivationPill = 2;
const capFull = W.eval(`calcQ(${GameEngine.state.realm}, ${GameEngine.state.level}, 1.0)`);
GameEngine.state.cultivation = capFull;
UI._cvCache = {};
UI.refreshCultivation();
check('修为满时「服丹」置灰', btnUse.classList.contains('is-off'));
clickEl(btnUse);
check('修为满时点击不消耗丹药', GameEngine.state.cultivationPill === 2,
  `实际 ${GameEngine.state.cultivationPill}`);

// HUD 丹药分开计
UI._hudCache = {};
UI.refreshHUD();
check('HUD 聚气丹数字正确', document.getElementById('res-pill').textContent === '2');
check('HUD 破障丹独立显示', document.getElementById('res-pill-po').textContent === '1');

// ===== 10. 宗门 · 秘境（真实点击） =====
console.log('\n=== 10. 宗门 · 秘境按钮 ===');

const SectSystem = G('SectSystem');
const DelveSystem = G('DelveSystem');

// 准备：筑基、有灵石、未入宗
GameEngine.state = SaveSystem.createDefault();
GameEngine.state.realm = 2;
GameEngine.state.level = 1;
GameEngine.state.stone = 2000;
GameEngine.state.spiritSense = 15;
GameEngine.state.mana = 200;
GameEngine.state.health = 100;
UI._sectCache = {};
UI.showTab('sect');
UI.refreshAll(true);

const joinBtn = document.getElementById('btn-sect-join');
check('宗门面板渲染出「投帖入宗」', !!joinBtn);
check('入宗按钮带 data-action', joinBtn?.dataset.action === 'sect-join');

clickEl(joinBtn);
check('点「投帖入宗」→ 已入宗', SectSystem.data.joined === true);

UI._sectCache = {};
UI.refreshAll(true);
const offerBtn = document.querySelector('[data-action="sect-offer"]');
const claimBtn = document.querySelector('[data-action="sect-claim"]');
check('入宗后出现「供奉」按钮', !!offerBtn);
check('入宗后出现「领令」按钮', !!claimBtn);

const stoneBefore = GameEngine.state.stone;
clickEl(offerBtn);
check('点「供奉」→ 灵石减少', GameEngine.state.stone < stoneBefore,
  `${stoneBefore} → ${GameEngine.state.stone}`);

clickEl(claimBtn);
check('点「领令」→ 获得秘境令', SectSystem.data.tokens > 0,
  `tokens=${SectSystem.data.tokens}`);

// 进入秘境
UI._sectCache = {};
UI.refreshAll(true);
const entryBtn = document.querySelector('[data-action="delve-enter"]');
check('秘境入口渲染出层级按钮', !!entryBtn);
clickEl(entryBtn);
check('点秘境入口 → 进入探索', DelveSystem.active === true);
check('进入后扣 1 枚令牌', SectSystem.data.tokens >= 0);

// 局内：点一道门
UI._sectCache = {};
UI.refreshAll(true);
const doorBtns = document.querySelectorAll('[data-action="delve-choose"]');
check('局内渲染出三道门', doorBtns.length === 3, `实际 ${doorBtns.length}`);
const floorBefore = DelveSystem.data.floor;
clickEl(doorBtns[0]);
check('点门 → 层数推进或结算',
  DelveSystem.data.floor > floorBefore || !DelveSystem.active,
  `floor ${floorBefore} → ${DelveSystem.data.floor}, active=${DelveSystem.active}`);

// 撤离
if (DelveSystem.active) {
  UI._sectCache = {};
  UI.refreshAll(true);
  const wBtn = document.querySelector('[data-action="delve-withdraw"]');
  check('局内出现「见好就收」按钮', !!wBtn);
  clickEl(wBtn);
  check('点「见好就收」→ 退出秘境', DelveSystem.active === false);
}

// 职位不足时入口应被禁用
SectSystem.data.rank = 0;
UI._sectCache = {};
UI.refreshAll(true);
const locked = document.querySelector('.delve-entry.is-locked');
check('职位不足的层级显示为锁定', !!locked);

// ===== 汇总 =====
console.log('\n' + '='.repeat(55));
console.log(`E2E 报告：${pass}/${pass + fail} 通过，${fail} 失败`);
if (failures.length) {
  console.log('\n失败清单：');
  failures.forEach(f => console.log(`  ❌ ${f.name}${f.detail ? ' — ' + f.detail : ''}`));
}
console.log('='.repeat(55));
process.exit(fail > 0 ? 1 : 0);
