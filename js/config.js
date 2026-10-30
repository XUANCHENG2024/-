/**
 * 桌面修仙 · 数值配置
 * @trace NUM-001, NUM-002, NUM-003, NUM-004
 * 公式与 Unity CultivationConfig.cs 完全一致
 * Q(R,r) = Q0 × (1+α)^(R-1) × [1+β×(r-1)] × γ(R,r)
 * V(R,mode) = V0 × η(R) × mode_mult × pill_mult
 */

const GameConfig = {
  // === 修为需求公式 Q(R,r)（NUM-001）===
  Q0: 100,             // 练气1层基础需求（点）
  alpha: 0.8,          // 大境界跃迁系数
  beta: 0.2,           // 小阶递增斜率
  gammaMin: 0.9,       // 动态修正下限
  gammaMax: 1.1,       // 动态修正上限

  // === 修为积累速率 V(R,mode)（NUM-002）===
  V0: 1.0,             // 基础速率（点/秒）
  realmRateMult: 1.5,  // 境界倍率基数 η(R)=1.5^(R-1)
  bgRateMult: 0.3,     // 后台模式倍率
  pillBoostMult: 2.0,  // 丹药加速倍率
  pillDuration: 3600,  // 丹药持续时间（秒）
  pillInstantPct: 0.15, // 聚气丹：立即回复当前层修为上限的 15%（按比例，后期不失效）

  // === 突破属性阈值 ===
  spiritSenseBase: 10,
  healthBase: 100,
  manaBase: 50,
  statGrowthPerRealm: 1.5,

  // === 经济三件套（NUM-003）===
  herbPerHourPerPlot: 120,   // 离线估算：单地块每小时净产草（对齐在线约 180/h 的保守值）
  orePerHour: 6,
  dewPerHour: 6,        // 在线被动累积（雨天 ×2）
  dewRainMult: 2,       // 雨天凝露翻倍（呼应天气系统）
  oreNightMult: 1.2,    // 夜间矿石略增
  herbSellPrice: 2,
  herbSoftCap: 200,
  oreSoftCap: 100,
  dewSoftCap: 50,
  resourceHardCap: 999,
  stoneHardCap: 999999,

  // === 种植（MECH-003）===
  maxPlots: 8,
  startingPlots: 3,
  waterSpeedBonus: 0.2,
  dayGrowthMult: 1.0,
  nightGrowthMult: 0.7,
  rainGrowthMult: 1.3,

  // === 集市（灵石 ↔ 材料）===
  // 卖出单价低于买入单价，杜绝"低买高卖"套利
  shop: {
    sell: [
      { id: 'herb', name: '灵草', amount: 20, price: 40 },
      { id: 'ore',  name: '矿石', amount: 10, price: 40 },
      { id: 'dew',  name: '凝露', amount: 5,  price: 30 },
    ],
    buy: [
      { id: 'dew', name: '凝露', amount: 5, price: 60 },
      { id: 'ore', name: '矿石', amount: 5, price: 40 },
    ],
  },

  // 扩地价格：第 4~8 块（灵石）
  plotCosts: [80, 160, 320, 640, 1280],

  // === 炼丹（MECH-004）===
  maxCraftQueue: 3,

  // === 掉率（NUM-004）===
  visitorDropRates: {
    herb_seed: { rate: 0.45, pity: 0 },
    dew:       { rate: 0.30, pity: 0 },
    ore:       { rate: 0.15, pity: 8 },
    breakthrough_pill: { rate: 0.03, pity: 30 },
  },

  // === 后台模式（MECH-008）===
  bgTargetFps: 1,
  offlineCapSeconds: 8 * 3600, // 8小时

  // === 轮回（转生）===
  // 渡劫 9 层且修为圆满后可入轮回：重置境界与资源，换永久「道行」
  // 道行 = floor(sqrt(本轮累计修为 / 100))，每点 +1% 修炼速率、+0.5% 灵草产出
  rebirth: {
    daoRatePerPoint: 0.01,
    daoHerbPerPoint: 0.005,
    minDao: 1,
    divisor: 100,
  },

  // === 境界名称 ===
  realmNames: ['练气', '筑基', '金丹', '元婴', '化神', '渡劫'],

  // === 作物定义 ===
  // 净收益设计：每轮净赚 = yield - seedCost（3 / 6 / 13）
  // 长周期作物单轮收益更高，鼓励扩地而非刷短周期
  crops: [
    { id: 'herb_qingling', name: '青灵草', growthTime: 60,  yield: 8,  seedCost: 5 },
    { id: 'herb_ziju',     name: '紫菊草', growthTime: 120, yield: 14, seedCost: 8 },
    { id: 'herb_binglian', name: '冰莲草', growthTime: 240, yield: 28, seedCost: 15 },
  ],

  // === 炼丹配方 ===
  recipes: [
    {
      id: 'pill_qiju', name: '聚气丹', result: 'cultivationPill', amount: 1,
      herbCost: 5, dewCost: 1, oreCost: 0, craftTime: 30, accelerateRatio: 0.5
    },
    {
      id: 'pill_guyuan', name: '固元丹', result: 'breakthroughPill', amount: 1,
      herbCost: 10, dewCost: 2, oreCost: 1, craftTime: 300, accelerateRatio: 0.5
    },
    {
      id: 'pill_xuanyuan', name: '玄元破障丹', result: 'breakthroughPill', amount: 1,
      herbCost: 20, dewCost: 5, oreCost: 3, craftTime: 600, accelerateRatio: 0.5
    },
  ],

  // === 练剑参数（MECH-005）===
  swordBaseGain: 3,
  swordComboWindow: 5,
  swordComboIncrement: 0.1,
  swordComboMaxMult: 3.0,
  swordHoldDelay: 380,     // 按住多久后开始连发（毫秒）
  swordHoldInterval: 200,  // 连发间隔（毫秒），与 5s 连击窗口配合可维持连击
  meditateActiveMult: 2.0,     // 起手倍率
  meditateDepthBonus: 2.5,     // 入定满时额外倍率（2.0 → 4.5）
  meditateDepthSeconds: 45,    // 入定满所需秒数
  maxMeditationSeconds: 60,
};

/**
 * 计算修为需求 Q(R,r)（NUM-001）
 * @param {number} R 大境界 1-6
 * @param {number} r 小阶 1-9
 * @param {number} gamma 动态修正 0.9-1.1
 * @returns {number} 修为需求点数
 */
function calcQ(R, r, gamma) {
  gamma = gamma || 1.0;
  return GameConfig.Q0
    * Math.pow(1 + GameConfig.alpha, R - 1)
    * (1 + GameConfig.beta * (r - 1))
    * gamma;
}

/**
 * 计算修为积累速率 V(R,mode)（NUM-002）
 * @param {number} R 大境界 1-6
 * @param {boolean} isBackground 是否后台
 * @param {boolean} hasPill 是否有丹药加速
 * @returns {number} 修为点/秒
 */
function calcRate(R, isBackground, hasPill) {
  const eta = Math.pow(GameConfig.realmRateMult, R - 1);
  const mode = isBackground ? GameConfig.bgRateMult : 1.0;
  const pill = hasPill ? GameConfig.pillBoostMult : 1.0;
  return GameConfig.V0 * eta * mode * pill;
}

/**
 * 获取突破属性阈值
 */
function getStatThresholds(R) {
  const mult = Math.pow(GameConfig.statGrowthPerRealm, R - 1);
  return {
    sense: Math.round(GameConfig.spiritSenseBase * mult),
    hp: Math.round(GameConfig.healthBase * mult),
    mana: Math.round(GameConfig.manaBase * mult),
  };
}
