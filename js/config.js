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
  resourceHardCap: 999, // 单一资源上限（超出部分丢弃并提示）
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

  // === 掉率 ===
  // 说明：访客的实际产出写在 VisitorSystem._visitors[].options[].reward 里（固定值，
  // 便于玩家在选项上看到"给什么、换什么"）。这里原先保留的 visitorDropRates 概率表
  // 从未被任何代码读取，已移除，避免调数值时误以为改它有用。

  // === 后台模式（MECH-008）===
  offlineCapSeconds: 8 * 3600, // 离线结算上限 8 小时（灵龟可再加 2 小时）

  // === 轮回（转生）===
  // 渡劫 9 层且修为圆满后可入轮回：重置境界与资源，换永久「道行」
  // 道行 = floor(sqrt(本轮累计修为 / 100))，每点 +1% 修炼速率、+0.5% 灵草产出
  rebirth: {
    daoRatePerPoint: 0.01,
    daoHerbPerPoint: 0.005,
    minDao: 1,
    divisor: 100,
  },

  // === 宗门（MECH-021）===
  // 定位：长线 meta 层。三层结构——
  //   宗门等级（全宗声望决定）→ 决定职位上限与山门气象
  //   职位层级（个人贡献决定，受宗门等级卡口）→ 决定权限：秘境准入 / 日令 / 收徒名额
  //   NPC 职位（掌门、传功长老、教习、执事）→ 各管一摊具体职能
  // 同时它仍是灵石的长效消耗口（供奉）。
  sect: {
    joinRealm: 2,               // 筑基方可入宗
    schema: 2,                  // 职位体系版本，用于旧档迁移

    // 宗门等级：由全宗「声望」推动。声望来自供奉、秘境、弟子出师、宗门任务。
    grades: [
      { id: 1, name: '末流小宗', prestige: 0,     desc: '山门三间，弟子十余人' },
      { id: 2, name: '三流宗门', prestige: 300,   desc: '有护山大阵，可开秘境' },
      { id: 3, name: '二流宗门', prestige: 900,   desc: '长老坐镇，收徒成制' },
      { id: 4, name: '一流宗门', prestige: 2000,  desc: '与大宗往来，秘境丰厚' },
      { id: 5, name: '顶级圣地', prestige: 4000,  desc: '天下知名，弟子出师即为一方人物' },
    ],

    // 职位层级：参照修仙小说门规。contrib = 个人累计贡献门槛；
    // grade = 所需宗门等级（个人再强，宗门不够格也坐不上这个位子）
    positions: [
      { id: 0, name: '杂役弟子', contrib: 0,     grade: 1, tier: 1, tokens: 1, slots: 0, offeringMult: 1.00,
        duty: '洒扫山门、照看灵田，无权无俸', right: '秘境一层' },
      { id: 1, name: '外门弟子', contrib: 100,   grade: 1, tier: 1, tokens: 2, slots: 0, offeringMult: 1.00,
        duty: '完成宗门任务换取修行资源', right: '秘境一层 · 日令二枚' },
      { id: 2, name: '内门弟子', contrib: 300,   grade: 1, tier: 2, tokens: 3, slots: 0, offeringMult: 1.00,
        duty: '入内门听讲，可借阅低阶功法', right: '秘境二层 · 日令三枚' },
      { id: 3, name: '真传弟子', contrib: 800,   grade: 2, tier: 3, tokens: 4, slots: 1, offeringMult: 0.95,
        duty: '承长老衣钵，代师授业', right: '秘境三层 · 可收徒一名' },
      { id: 4, name: '执事', contrib: 3000,      grade: 2, tier: 3, tokens: 5, slots: 2, offeringMult: 0.90,
        duty: '掌宗门庶务，经手供奉与令牌', right: '秘境三层 · 可收徒二名 · 供奉九折' },
      { id: 5, name: '长老', contrib: 6000,      grade: 3, tier: 4, tokens: 6, slots: 3, offeringMult: 0.85,
        duty: '坐镇一堂，可开秘境予门下弟子', right: '秘境四层 · 可收徒三名 · 供奉八五折' },
      { id: 6, name: '太上长老', contrib: 7000,  grade: 4, tier: 4, tokens: 8, slots: 5, offeringMult: 0.75,
        duty: '不理庶务，唯宗门存亡之际出手', right: '秘境四层 · 可收徒五名 · 供奉七五折' },
    ],

    // NPC 职位：各管一摊，玩家可直接与其交互
    npcPosts: [
      { id: 'master',  name: '掌门',     npc: '玄诚子', title: '掌门',     action: 'sect-task',
        line: '宗门每月有例，做完来领赏。' },
      { id: 'elder',   name: '传功长老', npc: '苏玉衡', title: '传功长老', action: 'sect-scripture',
        line: '功法在此，贡献够了便传你。' },
      { id: 'teacher', name: '教习',     npc: '白十一', title: '教习',     action: 'sect-train',
        line: '徒弟资质不行，我可以磨。灵石你出。' },
      { id: 'steward', name: '执事',     npc: '陈敬',   title: '执事',     action: 'sect-offer',
        line: '供奉、令牌，都在我这儿办。' },
    ],

    offeringStone: 100,         // 供奉：投入灵石换贡献（实际消耗按职位打折）
    offeringContrib: 10,
    dailyContribCap: 300,       // 每日贡献上限，防止无限刷
    tokenCostContrib: 40,       // 额外兑换 1 张秘境令
    healCostStone: 120,         // 疗伤消耗

    // 掌门处「宗门月例」：每日可领一次
    sectTask: { contrib: 40, prestige: 30, cooldownHours: 24 },

    // 传功长老处可换的宗门功法（并入 TechniqueSystem）
    scriptures: [
      { id: 'sect_qingyun', name: '青云剑典', cost: 900,  contrib: 400, grade: 2, desc: '宗门根本剑典，练剑收益提升' },
      { id: 'sect_zhenshan', name: '镇山诀',  cost: 1800, contrib: 900, grade: 3, desc: '镇山之学，修为积累与体魄俱增' },
    ],

    // 教习磨资质：每名弟子每日一次
    train: { stone: 150, aptitudeUp: 1, loyaltyUp: 8 },
  },

  // === 收徒（MECH-023）===
  // 定位：把"个人变强"扩展成"带一脉"。弟子是持续产出与声望来源，
  // 但需要盯着——忠诚会自然流失，长期不管会叛出师门。
  disciple: {
    unlockRank: 3,              // 真传弟子起可收徒
    recruitStone: 300,
    recruitContrib: 20,

    // 弟子成长：修为按资质累积，满 100 可传功进阶
    growthBase: 0.06,           // 每分钟基础修为增长（再乘资质）
    loyaltyDecayPerMin: 0.1,    // 忠诚自然流失
    loyaltyWarning: 20,         // 低于此值有叛出风险
    betrayChancePerMin: 0.004,  // 忠诚过低时每分钟叛出概率

    // 指点：花灵石提忠诚，少量加修为
    adviseStone: 50,
    adviseLoyalty: 15,
    adviseCultivation: 6,

    // 传功：以自身修为喂弟子，大幅推进并加忠诚
    impartCultivationPct: 0.12, // 消耗当前层上限的 12%
    impartGain: 25,             // 弟子修为 +25
    impartLoyalty: 20,

    // 产出：按资质与阶段折算贡献 / 灵石（每分钟）
    yieldContribPerMin: 0.02,
    yieldStonePerMin: 0.12,

    // 出师
    graduateCultivation: 100,
    graduatePrestige: 50,
    graduateContrib: 120,

    // 姓名池（姓 + 名），随机组合，纯本地
    surnames: ['林', '苏', '顾', '陆', '谢', '裴', '沈', '崔', '薛', '阮'],
    givenNames: ['稚川', '青梧', '怀瑾', '照野', '知白', '晏如', '清晏', '望舒', '寒山', '拾遗', '归尘', '砚秋'],
    aptitudeNames: ['下品', '中品', '上品', '极品', '天灵根'],
  },

  // === 秘境（MECH-022）===
  // 定位：单局 roguelike 探险。"探—战—撤"闭环，压力（浊气）随层数递增，
  // 玩家自己决定何时收手；战力判定复用神识/法力，让突破的属性有了第二个用途。
  delve: {
    entryRealm: 2,
    tiers: [
      { id: 1, name: '荒尘秘境', desc: '上古宗门试炼场，荒草掩道', threatBase: 16,  rewardMult: 1.0,  floors: 6 },
      { id: 2, name: '古墟秘境', desc: '断壁残垣间仍有灵机未散',   threatBase: 22,  rewardMult: 2.2,  floors: 7 },
      { id: 3, name: '神墟秘境', desc: '神纹未朽，法则压制极强',   threatBase: 32, rewardMult: 5.0,  floors: 8 },
      { id: 4, name: '洪荒禁地', desc: '宗门明令禁止弟子独入',     threatBase: 40, rewardMult: 11.0, floors: 9 },
    ],
    threatPerFloor: 0.35,       // 每深一层，威胁按此系数递增
    taintPerFloor: 0.03,        // 每层累积浊气（直接扣成功率）
    taintCap: 0.45,
    successMin: 0.15,
    successMax: 0.95,
    hpLossSuccess: 0.06,        // 成功：损失最大气血的 6%
    hpLossFail: 0.22,           // 失败：22%
    deathLootKeep: 0.5,         // 重伤时保留一半战利品
    injurySeconds: 600,         // 伤势持续 10 分钟
    injuryRatePenalty: 0.25,    // 期间修炼速率 -25%
    baseStone: 30,              // 单层基础灵石
    floorGrow: 0.20,            // 每层收益递增
    contribPerFloor: 6,         // 每层折算宗门贡献
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
  // 收益不再用固定点数，而是"当前修炼速率 × 每次出剑折算的秒数"，
  // 与打坐同单位（都表示为挂机速率的倍数），避免境界越高练剑越鸡肋。
  // 折算比：swordStrikeSeconds × (1/间隔) × 连击上限
  //         = 0.4 × 5 × 3 ≈ 6 倍挂机速率（打坐 60 秒循环均值约 2.9 倍）
  swordStrikeSeconds: 0.4,
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
  // gamma 是动态修正项，必须夹在 [gammaMin, gammaMax] 内，
  // 否则外部传错一个系数就会让整条成长曲线失准。
  const g = Math.min(Math.max(gamma || 1.0, GameConfig.gammaMin), GameConfig.gammaMax);
  return GameConfig.Q0
    * Math.pow(1 + GameConfig.alpha, R - 1)
    * (1 + GameConfig.beta * (r - 1))
    * g;
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
