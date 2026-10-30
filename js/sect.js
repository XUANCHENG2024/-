/**
 * 桌面修仙 · 宗门与秘境（MECH-021 / MECH-022）
 *
 * 设计定位
 * ----------
 * 宗门是**长线 meta 层**：入宗需要筑基，之后靠每日供奉累积贡献升职位，
 * 职位决定能进哪一层秘境。它同时补上一个经济缺口——后期灵石本来无处可花。
 *
 * 秘境是**单局 roguelike**：一局是一次"探—战—撤"的短循环。
 * 每前进一层浊气就上涨，成功率下降；玩家可以随时撤离保住战利品，
 * 也可以赌更深一层。气血归零＝重伤，只保住一半战利品并留下伤势。
 *
 * 为什么这样设计（调研结论）
 * ----------
 * 1. "搜—打—撤"比"打通全图才算赢"更适合桌面/放置场景：一局 1–2 分钟，
 *    随时可中断，失败也不沉重。（参考《咻咻勇者》的主动撤离 + 阴气值压力）
 * 2. 房间类型必须**可读**：三个门直接给出类型、风险星级与预期收益，
 *    玩家能预判，输了也认。（参考 roguelike 设计中的 "readable randomness"）
 * 3. 战力复用既有的神识/法力，让突破带来的属性成长有了第二个用途，
 *    而不是只在突破那一刻校验一次。
 */

// ============================
// 宗门
// ============================
const SectSystem = {
  /** 确保状态结构存在（旧存档没有 sect 字段） */
  ensure() {
    const s = GameEngine.state;
    if (!s.sect || typeof s.sect !== 'object') {
      s.sect = {
        joined: false,
        contrib: 0,
        rank: 0,
        prestige: 0,
        tokens: 0,
        tokenDate: '',
        contribDate: '',
        contribToday: 0,
        offeringCount: 0,
        schema: GameConfig.sect.schema,
        taskDate: '',
        scriptures: {},
        graduated: [],
      };
    }
    const d = s.sect;
    if (typeof d.contrib !== 'number') d.contrib = 0;
    if (typeof d.rank !== 'number') d.rank = 0;
    if (typeof d.tokens !== 'number') d.tokens = 0;
    if (typeof d.prestige !== 'number') d.prestige = 0;
    d.joined = !!d.joined;

    // 旧档迁移：v1 只有 4 级职位（外门/内门/真传/执事），
    // 新版是 7 级且多了「杂役弟子」垫底，索引整体 +1。
    // 不迁移会让老玩家从「外门」直接掉成「杂役」。
    if (d.schema !== GameConfig.sect.schema) {
      if (typeof d.schema !== 'number') {
        d.rank = Math.min(d.rank + 1, GameConfig.sect.positions.length - 1);
        // 旧档已解锁的秘境层级不能因为改版而丢失，用声望兜住
        const maxTier = GameConfig.sect.positions[d.rank].tier;
        const needGrade = GameConfig.sect.positions[d.rank].grade;
        d.prestige = Math.max(d.prestige, GameConfig.sect.grades[needGrade - 1].prestige);
        d.tokens = typeof d.tokens === 'number' ? d.tokens : 0;
      }
      d.schema = GameConfig.sect.schema;
    }

    if (!d.scriptures || typeof d.scriptures !== 'object') d.scriptures = {};
    if (!Array.isArray(d.graduated)) d.graduated = [];
    if (typeof d.taskDate !== 'string') d.taskDate = '';
    return d;
  },

  get data() { return this.ensure(); },

  get cfg() { return GameConfig.sect; },

  /** 当前职位定义 */
  get rankDef() {
    const r = this.data.rank;
    return this.cfg.positions[Math.min(r, this.cfg.positions.length - 1)];
  },

  /** 别名：语义上更准确 */
  get positionDef() { return this.rankDef; },

  /** 宗门等级定义 */
  get gradeDef() {
    const p = this.data.prestige || 0;
    let g = this.cfg.grades[0];
    for (const item of this.cfg.grades) if (p >= item.prestige) g = item;
    return g;
  },

  get grade() { return this.gradeDef.id; },

  /** 距离下一宗门等级还差多少声望 */
  get nextGradeNeed() {
    const next = this.cfg.grades[this.gradeDef.id];
    if (!next) return null;
    return Math.max(0, next.prestige - (this.data.prestige || 0));
  },

  /** 增加宗门声望（供奉、秘境、弟子出师、宗门任务都会调用） */
  addPrestige(n) {
    if (!(n > 0)) return 0;
    this.data.prestige += n;
    return n;
  },

  /** 可进入的最高秘境层级 */
  get maxTier() {
    return this.data.joined ? this.rankDef.tier : 0;
  },

  /** 收徒名额上限 */
  get discipleSlots() {
    return this.data.joined ? this.rankDef.slots : 0;
  },

  /** 供奉实际单价（职位越高越便宜） */
  get offeringCost() {
    return Math.round(this.cfg.offeringStone * (this.rankDef.offeringMult || 1));
  },

  get canJoin() {
    return !this.data.joined && GameEngine.state.realm >= this.cfg.joinRealm;
  },

  /** 入宗 */
  join() {
    if (!this.canJoin) return { ok: false, msg: '需筑基以上方可入宗' };
    this.data.joined = true;
    this.data.rank = 0;
    this._rollDay();
    return { ok: true };
  },

  /** 跨天重置每日额度 */
  _rollDay() {
    const d = this.data;
    const today = new Date().toDateString();
    if (d.contribDate !== today) {
      d.contribDate = today;
      d.contribToday = 0;
    }
    return today;
  },

  /** 今日剩余可领秘境令（按日期一次性发放） */
  canClaimTokensToday() {
    const d = this.data;
    return d.joined && d.tokenDate !== new Date().toDateString();
  },

  /** 领取每日秘境令（数量随职位提升） */
  claimDailyTokens() {
    if (!this.data.joined) return { ok: false, msg: '尚未入宗' };
    if (!this.canClaimTokensToday()) return { ok: false, msg: '今日已领过' };

    const amount = this.rankDef.tokens;
    this.data.tokenDate = new Date().toDateString();
    this.data.tokens += amount;
    return { ok: true, amount };
  },

  /** 供奉：投入灵石换贡献（有每日上限，单价随职位打折） */
  offer(times) {
    const n = Math.max(1, Math.floor(times || 1));
    const d = this.data;
    if (!d.joined) return { ok: false, msg: '尚未入宗' };

    this._rollDay();
    const room = this.cfg.dailyContribCap - d.contribToday;
    if (room <= 0) return { ok: false, msg: '今日贡献已满' };

    const unit = this.offeringCost;
    const cost = unit * n;
    if (GameEngine.state.stone < cost) return { ok: false, msg: '灵石不足' };

    GameEngine.state.stone -= cost;
    const gain = Math.min(this.cfg.offeringContrib * n, room);
    d.contrib += gain;
    d.contribToday += gain;
    d.offeringCount += n;
    // 供奉同时推动宗门声望（全宗受益）
    this.addPrestige(Math.floor(gain / 2));

    const before = d.rank;
    this._refreshRank();
    const promoted = d.rank > before ? this.rankDef : null;

    return { ok: true, contrib: gain, promoted, rank: d.rank, cost };
  },

  /** 依据贡献与宗门等级刷新职位（两者都要满足） */
  _refreshRank() {
    const d = this.data;
    const grade = this.grade;
    for (let i = this.cfg.positions.length - 1; i >= 0; i--) {
      const p = this.cfg.positions[i];
      if (d.contrib >= p.contrib && grade >= p.grade) { d.rank = i; return d.rank; }
    }
    d.rank = 0;
    return 0;
  },

  /** 贡献兑换秘境令 */
  buyToken() {
    const d = this.data;
    if (!d.joined) return { ok: false, msg: '尚未入宗' };
    if (d.contrib < this.cfg.tokenCostContrib) return { ok: false, msg: '贡献不足' };
    d.contrib -= this.cfg.tokenCostContrib;
    d.tokens += 1;
    return { ok: true };
  },

  /** 距离下一职位的贡献差（若卡在宗门等级上会明确告知） */
  get nextRankNeed() {
    const d = this.data;
    const next = this.cfg.positions[d.rank + 1];
    if (!next) return null;
    return {
      name: next.name,
      contrib: Math.max(0, next.contrib - d.contrib),
      grade: Math.max(0, next.grade - this.grade),
      gradeName: next.grade > this.grade ? this.cfg.grades[next.grade - 1].name : null,
    };
  },

  // ============================
  // NPC 职位
  // ============================

  /** 掌门：宗门月例，每日可领一次 */
  canTakeTask() {
    const d = this.data;
    return d.joined && d.taskDate !== new Date().toDateString();
  },

  takeTask() {
    const d = this.data;
    if (!d.joined) return { ok: false, msg: '尚未入宗' };
    if (!this.canTakeTask()) return { ok: false, msg: '今日已领过月例' };

    d.taskDate = new Date().toDateString();
    const { contrib, prestige } = this.cfg.sectTask;
    d.contrib += contrib;
    this.addPrestige(prestige);
    const before = d.rank;
    this._refreshRank();

    return { ok: true, contrib, prestige, promoted: d.rank > before ? this.rankDef : null };
  },

  /** 传功长老：兑换宗门功法 */
  canBuyScripture(id) {
    const s = this.cfg.scriptures.find(x => x.id === id);
    if (!s) return { ok: false, msg: '无此功法' };
    const d = this.data;
    if (!d.joined) return { ok: false, msg: '尚未入宗' };
    if (d.scriptures[id]) return { ok: false, msg: '已习得' };
    if (this.grade < s.grade) return { ok: false, msg: `需宗门升至${this.cfg.grades[s.grade - 1].name}` };
    if (d.contrib < s.contrib) return { ok: false, msg: `贡献不足（需 ${s.contrib}）` };
    if (GameEngine.state.stone < s.cost) return { ok: false, msg: `灵石不足（需 ${s.cost}）` };
    return { ok: true };
  },

  buyScripture(id) {
    const check = this.canBuyScripture(id);
    if (!check.ok) return check;
    const s = this.cfg.scriptures.find(x => x.id === id);
    const d = this.data;
    GameEngine.state.stone -= s.cost;
    d.contrib -= s.contrib;
    d.scriptures[id] = true;
    // 并入功法系统，享受其加成
    if (typeof TechniqueSystem !== 'undefined') {
      TechniqueSystem._learned[id] = true;
      TechniqueSystem._save();
    }
    return { ok: true, scripture: s };
  },

  /** 宗门功法列表（含可否购买） */
  get scriptureList() {
    return this.cfg.scriptures.map(s => ({
      ...s,
      learned: !!this.data.scriptures[s.id],
      check: this.canBuyScripture(s.id),
    }));
  },

  /** 宗门同门榜（本地模拟：无服务器，仅作宗门氛围与自我对照） */
  get board() {
    const seed = this._daySeed();
    const names = ['明尘', '李扶疏', '沈无咎', '裴照', '何长白'];
    const rows = names.map((name, i) => {
      const base = 2 + ((seed * (i + 3)) % 7);       // 2..8
      return { name, score: base + Math.floor(GameEngine.state.realm / 2) };
    });
    const mine = GameEngine.state.delve ? (GameEngine.state.delve.bestFloor || 0) : 0;
    rows.push({ name: '你', score: mine, self: true });
    rows.sort((a, b) => b.score - a.score);
    return rows;
  },

  _daySeed() {
    const t = new Date();
    return t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate();
  },
};

// ============================
// 秘境探险
// ============================
const DelveSystem = {
  /** 门类型：可读的随机性——玩家一眼能判断风险与收益 */
  _doorKinds: [
    {
      kind: 'beast', name: '妖兽盘踞', icon: '⚔', risk: 3,
      desc: '有妖兽守着一份机缘，硬闯要看战力',
    },
    {
      kind: 'spirit', name: '灵机流转', icon: '✦', risk: 1,
      desc: '天地灵气汇聚之处，可安稳取一些',
    },
    {
      kind: 'trove', name: '秘藏封禁', icon: '◈', risk: 2,
      desc: '封禁未破，解阵需要消耗法力',
    },
  ],

  /** 确保存档结构 */
  ensure() {
    const s = GameEngine.state;
    if (!s.delve || typeof s.delve !== 'object') {
      s.delve = {
        active: false, tier: 1, floor: 0, hp: 0, hpMax: 1,
        taint: 0, loot: {}, doors: [], log: [],
        bestFloor: 0, runs: 0, deaths: 0,
      };
    }
    const d = s.delve;
    if (!d.loot || typeof d.loot !== 'object') d.loot = {};
    if (!Array.isArray(d.doors)) d.doors = [];
    if (!Array.isArray(d.log)) d.log = [];
    for (const k of ['bestFloor', 'runs', 'deaths', 'floor']) {
      if (typeof d[k] !== 'number') d[k] = 0;
    }
    return d;
  },

  get data() { return this.ensure(); },
  get cfg() { return GameConfig.delve; },
  get active() { return this.data.active; },

  /** 战力：复用神识与法力，让突破属性有第二个用途 */
  get power() {
    const s = GameEngine.state;
    return Math.round(s.spiritSense * 2 + s.mana * 0.5 + (s.realm - 1) * 12);
  },

  /** 某层某类门的威胁值 */
  threatAt(floor, tierId) {
    const tier = this.cfg.tiers.find(t => t.id === tierId) || this.cfg.tiers[0];
    return Math.round(tier.threatBase * (1 + this.cfg.threatPerFloor * (floor - 1)));
  },

  /** 成功率（含浊气惩罚） */
  successChance(floor, tierId, taint) {
    const threat = this.threatAt(floor, tierId);
    const p = this.power / (this.power + threat) - (taint || 0);
    return Math.min(this.cfg.successMax, Math.max(this.cfg.successMin, p));
  },

  /** 前置检查 */
  canEnter(tierId) {
    const s = GameEngine.state;
    if (this.data.active) return { ok: false, msg: '已在秘境之中' };
    if (!SectSystem.data.joined) return { ok: false, msg: '需先入宗门' };
    if (s.realm < this.cfg.entryRealm) return { ok: false, msg: `需筑基以上（当前 ${GameConfig.realmNames[s.realm - 1]}）` };
    if (tierId > SectSystem.maxTier) return { ok: false, msg: '职位不足，无法进入此层秘境' };
    // 秘境令存在宗门数据里，不在 delve 上——写错对象会让校验形同虚设
    if (SectSystem.data.tokens < 1) return { ok: false, msg: '秘境令不足' };
    if (this.hasInjury()) return { ok: false, msg: '伤势未愈，不宜再入秘境' };
    return { ok: true };
  },

  /** 伤势是否仍在生效 */
  hasInjury() {
    const s = GameEngine.state;
    return (s.injuryUntil || 0) > Date.now();
  },

  get injurySecondsLeft() {
    const s = GameEngine.state;
    return Math.max(0, Math.ceil(((s.injuryUntil || 0) - Date.now()) / 1000));
  },

  /** 修炼速率惩罚（伤势生效时） */
  get ratePenalty() {
    return this.hasInjury() ? (1 - this.cfg.injuryRatePenalty) : 1;
  },

  /** 进入秘境 */
  enter(tierId) {
    const check = this.canEnter(tierId);
    if (!check.ok) return check;

    const d = this.data;
    const tier = this.cfg.tiers.find(t => t.id === tierId);
    if (!tier) return { ok: false, msg: '无此秘境' };

    SectSystem.data.tokens -= 1;

    d.active = true;
    d.tier = tierId;
    d.floor = 1;
    d.hpMax = GameEngine.state.health;
    d.hp = d.hpMax;
    d.taint = 0;
    d.loot = {};
    d.log = [];
    d.doors = this._rollDoors(1, tierId);
    d.runs++;

    return { ok: true, tier };
  },

  /** 生成三个门（类型互不重复，玩家总能做出有意义的选择） */
  _rollDoors(floor, tierId) {
    const pool = [...this._doorKinds];
    // 洗牌后取前三个，保证三个门类型各异
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 3).map(k => {
      const reward = this._rewardFor(k.kind, floor, tierId);
      return {
        kind: k.kind,
        name: k.name,
        icon: k.icon,
        risk: k.risk,
        desc: k.desc,
        preview: reward.label,
        threat: this.threatAt(floor, tierId),
        manaCost: k.kind === 'trove' ? Math.ceil(GameEngine.state.mana * 0.15) : 0,
      };
    });
  },

  /** 单层收益：随层数与层级递增 */
  _rewardFor(kind, floor, tierId) {
    const tier = this.cfg.tiers.find(t => t.id === tierId) || this.cfg.tiers[0];
    const grow = 1 + this.cfg.floorGrow * (floor - 1);
    const base = this.cfg.baseStone * tier.rewardMult * grow;
    const mult = kind === 'beast' ? 1.6 : (kind === 'trove' ? 2.4 : 0.7);

    const stone = Math.round(base * mult);
    const herb = Math.round(base * mult * 0.5);
    const out = { stone, herb };
    // 深层可能带出凝露/矿石/丹药
    if (floor >= 2) { out.dew = 1 + Math.floor(floor / 3); out.ore = 1 + Math.floor(floor / 4); }
    if (kind === 'trove' && floor >= 3) out.breakthroughPill = 1;

    const label = `灵石+${stone} 灵草+${herb}`;
    return { ...out, label };
  },

  /** 选择一道门 */
  choose(doorIndex) {
    const d = this.data;
    if (!d.active) return { ok: false, msg: '不在秘境中' };

    const door = d.doors[doorIndex];
    if (!door) return { ok: false, msg: '无此门' };

    const s = GameEngine.state;
    const cfg = this.cfg;

    // 秘藏需要法力解阵
    if (door.manaCost > 0 && s.mana < door.manaCost) {
      return { ok: false, msg: `法力不足（需 ${door.manaCost}）` };
    }

    let success;
    let hpLoss;
    let text;

    if (door.kind === 'spirit') {
      // 灵机：必成，但收益最低，且浊气略增
      success = true;
      hpLoss = 0;
      text = '你循着灵气而行，安稳取了一份。';
    } else if (door.kind === 'beast') {
      const p = this.successChance(d.floor, d.tier, d.taint);
      success = Math.random() < p;
      hpLoss = success ? d.hpMax * cfg.hpLossSuccess : d.hpMax * cfg.hpLossFail;
      text = success
        ? '妖兽伏诛，你取走了它守着的机缘。'
        : '妖兽凶悍，你带伤退了回来。';
    } else {
      // 秘藏：消耗法力，成功率受浊气影响更大
      s.mana -= door.manaCost;
      const p = Math.min(cfg.successMax, Math.max(cfg.successMin, 0.72 - d.taint));
      success = Math.random() < p;
      hpLoss = success ? d.hpMax * cfg.hpLossSuccess : d.hpMax * cfg.hpLossFail;
      text = success ? '封禁解开，秘藏尽入囊中。' : '禁制反噬，你被震得气血翻涌。';
    }

    if (success) {
      this._collect(door.kind, d.floor, d.tier);
    } else {
      d.taint = Math.min(cfg.taintCap, d.taint + 0.05);
    }

    d.hp = Math.max(0, d.hp - hpLoss);
    d.taint = Math.min(cfg.taintCap, d.taint + cfg.taintPerFloor);
    d.log.unshift({ floor: d.floor, success, text });

    // 气血归零 → 重伤
    if (d.hp <= 0) {
      return this._maimed(text);
    }

    // 层级走完 → 自动圆满
    const tier = cfg.tiers.find(t => t.id === d.tier);
    if (d.floor >= tier.floors) {
      return this._extract(true);
    }

    d.floor++;
    d.doors = this._rollDoors(d.floor, d.tier);
    return { ok: true, success, text, floor: d.floor };
  },

  /** 把收益写进临时背包（撤离时才真正入账） */
  _collect(kind, floor, tierId) {
    const r = this._rewardFor(kind, floor, tierId);
    const loot = this.data.loot;
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'number') loot[k] = (loot[k] || 0) + v;
    }
  },

  /** 主动撤离 */
  withdraw() {
    if (!this.data.active) return { ok: false, msg: '不在秘境中' };
    return this._extract(false);
  },

  /** 结算：主动撤离与走完全层都保留全部战利品，差别只在"圆满"标记 */
  _extract(cleared) {
    const d = this.data;
    const applied = this._applyLoot(d.loot, 1);

    d.bestFloor = Math.max(d.bestFloor, d.floor);
    d.active = false;
    d.doors = [];
    d.loot = {};

    return { ok: true, cleared, floor: d.floor, loot: applied, depth: d.floor };
  },

  /** 重伤：只保留一半战利品，留下伤势 */
  _maimed(text) {
    const d = this.data;
    const cfg = this.cfg;
    const s = GameEngine.state;
    const applied = this._applyLoot(d.loot, cfg.deathLootKeep);
    s.injuryUntil = Date.now() + cfg.injurySeconds * 1000;
    d.deaths++;
    d.bestFloor = Math.max(d.bestFloor, d.floor);
    d.active = false;
    d.doors = [];
    d.loot = {};

    return {
      ok: true, maimed: true, text,
      floor: d.floor, loot: applied,
      injurySeconds: cfg.injurySeconds,
    };
  },

  /** 战利品入账（含资源上限与宗门贡献） */
  _applyLoot(loot, keepRatio) {
    const s = GameEngine.state;
    const out = {};
    for (const [k, v] of Object.entries(loot || {})) {
      const amount = Math.max(0, Math.floor(v * keepRatio));
      if (!amount) continue;
      if (k === 'breakthroughPill' || k === 'cultivationPill') {
        s[k] = (s[k] || 0) + amount;
        out[k] = amount;
      } else {
        const cap = k === 'stone' ? GameConfig.stoneHardCap : GameConfig.resourceHardCap;
        const cur = s[k] || 0;
        const can = Math.min(amount, cap - cur);
        if (can > 0) { s[k] = cur + can; out[k] = can; }
      }
    }
    // 秘境产出折算宗门贡献，形成"宗门—秘境"闭环
    const floorBonus = Math.floor((this.data.floor || 0) * this.cfg.contribPerFloor * (keepRatio >= 1 ? 1 : 0.5));
    if (floorBonus > 0 && SectSystem.data.joined) {
      SectSystem.data.contrib += floorBonus;
      // 秘境探索同样给宗门涨声望（每层 2 点，重伤减半）
      SectSystem.addPrestige(Math.round((this.data.floor || 0) * 3 * keepRatio));
      out.contrib = floorBonus;
      SectSystem._refreshRank();
    }
    return out;
  },

  /** 疗伤 */
  heal() {
    const s = GameEngine.state;
    if (!this.hasInjury()) return { ok: false, msg: '并无伤势' };
    const cost = GameConfig.sect.healCostStone;
    if (s.stone < cost) return { ok: false, msg: '灵石不足' };
    s.stone -= cost;
    s.injuryUntil = 0;
    return { ok: true };
  },

  /** 本局概况（供 UI） */
  get snapshot() {
    const d = this.data;
    const tier = this.cfg.tiers.find(t => t.id === d.tier) || this.cfg.tiers[0];
    return {
      active: d.active,
      tier,
      floor: d.floor,
      floors: tier.floors,
      hp: Math.round(d.hp),
      hpMax: Math.round(d.hpMax),
      taint: d.taint,
      success: this.successChance(d.floor, d.tier, d.taint),
      loot: { ...d.loot },
      doors: d.doors,
      log: d.log.slice(0, 4),
      power: this.power,
      threat: this.threatAt(d.floor, d.tier),
    };
  },
};
