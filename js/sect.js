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
        tokens: 0,
        tokenDate: '',
        contribDate: '',
        contribToday: 0,
        offeringCount: 0,
      };
    }
    const d = s.sect;
    if (typeof d.contrib !== 'number') d.contrib = 0;
    if (typeof d.rank !== 'number') d.rank = 0;
    if (typeof d.tokens !== 'number') d.tokens = 0;
    d.joined = !!d.joined;
    return d;
  },

  get data() { return this.ensure(); },

  get cfg() { return GameConfig.sect; },

  /** 当前职位定义 */
  get rankDef() {
    const r = this.data.rank;
    return this.cfg.ranks[Math.min(r, this.cfg.ranks.length - 1)];
  },

  /** 可进入的最高秘境层级 */
  get maxTier() {
    return this.data.joined ? this.rankDef.tier : 0;
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

  /** 领取每日秘境令 */
  claimDailyTokens() {
    if (!this.data.joined) return { ok: false, msg: '尚未入宗' };
    if (!this.canClaimTokensToday()) return { ok: false, msg: '今日已领过' };

    this.data.tokenDate = new Date().toDateString();
    this.data.tokens += this.cfg.tokenDaily;
    return { ok: true, amount: this.cfg.tokenDaily };
  },

  /** 供奉：投入灵石换贡献（有每日上限） */
  offer(times) {
    const n = Math.max(1, Math.floor(times || 1));
    const d = this.data;
    if (!d.joined) return { ok: false, msg: '尚未入宗' };

    this._rollDay();
    const room = this.cfg.dailyContribCap - d.contribToday;
    if (room <= 0) return { ok: false, msg: '今日贡献已满' };

    const cost = this.cfg.offeringStone * n;
    if (GameEngine.state.stone < cost) return { ok: false, msg: '灵石不足' };

    GameEngine.state.stone -= cost;
    const gain = Math.min(this.cfg.offeringContrib * n, room);
    d.contrib += gain;
    d.contribToday += gain;
    d.offeringCount += n;

    // 职位晋升：达到阈值自动升
    const before = d.rank;
    for (let i = this.cfg.ranks.length - 1; i >= 0; i--) {
      if (d.contrib >= this.cfg.ranks[i].contrib) { d.rank = i; break; }
    }
    const promoted = d.rank > before ? this.rankDef : null;

    return { ok: true, contrib: gain, promoted, rank: d.rank };
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

  /** 距离下一职位的贡献差 */
  get nextRankNeed() {
    const d = this.data;
    const next = this.cfg.ranks[d.rank + 1];
    if (!next) return null;
    return Math.max(0, next.contrib - d.contrib);
  },

  /** 宗门同门榜（本地模拟：无服务器，仅作宗门氛围与自我对照） */
  get board() {
    // 用日期做种子，保证同一天内榜单稳定，不会每次刷新乱跳
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
      out.contrib = floorBonus;
      // 贡献变化可能触发晋升
      const d2 = SectSystem.data;
      for (let i = GameConfig.sect.ranks.length - 1; i >= 0; i--) {
        if (d2.contrib >= GameConfig.sect.ranks[i].contrib) { d2.rank = Math.max(d2.rank, i); break; }
      }
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
