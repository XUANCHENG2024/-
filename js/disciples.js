/**
 * 桌面修仙 · 收徒与师徒（MECH-023）
 *
 * 定位
 * ----------
 * 宗门把"个人变强"扩展成"带一脉"。弟子是**持续产出**（贡献、灵石）与
 * **宗门声望**的来源，也是玩家第一次拥有"要照看的人"。
 *
 * 设计要点
 * ----------
 * 1. 弟子不会自己变强到出师——必须玩家「传功」（消耗自身修为）推动，
 *    这让"收徒"和"修炼"两个系统产生真实取舍。
 * 2. 忠诚会自然流失，「指点」花灵石维持。长期不管会叛出师门，
 *    损失投入但不毁档（放置游戏不能给毁灭性惩罚）。
 * 3. 出师给宗门声望，把单个弟子接回「宗门等级—职位」那条主线，
 *    而不是开一条平行的独立养成线。
 */

const DiscipleSystem = {
  _loyaltyCarry: 0,   // 忠诚流失的小数余量
  _yieldCarry: 0,     // 产出的小数余量

  ensure() {
    const s = GameEngine.state;
    if (!Array.isArray(s.disciples)) s.disciples = [];
    // 就地清洗：必须保持对象引用不变。
    // 早期版本用 map 生成新对象，导致拿到的是副本，改修为一律改不回去。
    const cleaned = [];
    for (let i = 0; i < s.disciples.length; i++) {
      const d = s.disciples[i];
      if (!d || typeof d !== 'object') continue;
      if (!d.id) d.id = `dis_${i}_${Math.random().toString(36).slice(2, 7)}`;
      if (!d.name) d.name = '无名';
      // 注意：不能用 Number(x) || 默认值 —— 忠诚/修为为 0 时会被当成 falsy 重置，
      // 曾导致"忠诚 0 的弟子每帧被修回 60"，叛出机制永远不触发。
      const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);
      d.aptitude = Math.min(5, Math.max(1, num(d.aptitude, 1)));
      d.cultivation = Math.min(100, Math.max(0, num(d.cultivation, 0)));
      d.loyalty = Math.min(100, Math.max(0, num(d.loyalty, 60)));
      d.stage = Math.min(2, Math.max(0, num(d.stage, 0)));
      if (!d.trainedDate) d.trainedDate = '';
      d.joinedAt = Number(d.joinedAt) || Date.now();
      cleaned.push(d);
    }
    if (cleaned.length !== s.disciples.length) s.disciples = cleaned;
    return s.disciples;
  },

  get cfg() { return GameConfig.disciple; },
  get list() { return this.ensure(); },

  get count() { return this.ensure().length; },

  get slots() { return SectSystem.discipleSlots; },

  get canRecruit() {
    if (!SectSystem.data.joined) return { ok: false, msg: '尚未入宗' };
    if (SectSystem.data.rank < this.cfg.unlockRank) {
      return { ok: false, msg: `需${GameConfig.sect.positions[this.cfg.unlockRank].name}方可收徒` };
    }
    if (this.count >= this.slots) return { ok: false, msg: `门下已满（${this.count}/${this.slots}）` };
    if (GameEngine.state.stone < this.cfg.recruitStone) return { ok: false, msg: `灵石不足（需 ${this.cfg.recruitStone}）` };
    if (SectSystem.data.contrib < this.cfg.recruitContrib) return { ok: false, msg: `贡献不足（需 ${this.cfg.recruitContrib}）` };
    return { ok: true };
  },

  /** 随机生成一名弟子的姓名（本地随机，无外部依赖） */
  _rollName() {
    const c = this.cfg;
    for (let i = 0; i < 20; i++) {
      const name = c.surnames[Math.floor(Math.random() * c.surnames.length)]
        + c.givenNames[Math.floor(Math.random() * c.givenNames.length)];
      if (!this.list.some(d => d.name === name)) return name;
    }
    return c.surnames[0] + c.givenNames[0] + '（同名）';
  },

  /** 资质：下品最常见，天灵根极稀有 */
  _rollAptitude() {
    const r = Math.random();
    if (r < 0.40) return 1;
    if (r < 0.72) return 2;
    if (r < 0.90) return 3;
    if (r < 0.98) return 4;
    return 5;
  },

  /** 收徒 */
  recruit() {
    const check = this.canRecruit;
    if (!check.ok) return check;

    const s = GameEngine.state;
    s.stone -= this.cfg.recruitStone;
    SectSystem.data.contrib -= this.cfg.recruitContrib;

    const d = {
      id: `dis_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: this._rollName(),
      aptitude: this._rollAptitude(),
      cultivation: 0,
      loyalty: 55 + Math.floor(Math.random() * 20),   // 55–74，需要玩家经营
      stage: 0,
      trainedDate: '',
      joinedAt: Date.now(),
    };
    this.list.push(d);
    return { ok: true, disciple: d };
  },

  /** 弟子每分钟的修为增长（受资质与阶段影响） */
  growthPerMin(d) {
    return this.cfg.growthBase * d.aptitude * (1 + 0.4 * d.stage);
  },

  /** 弟子每分钟产出 */
  yieldPerMin(d) {
    const scale = d.aptitude * (1 + 0.5 * d.stage) * (d.loyalty >= 40 ? 1 : 0.4);
    return {
      contrib: this.cfg.yieldContribPerMin * scale * 0.6,
      stone: this.cfg.yieldStonePerMin * scale * 0.4,
    };
  },

  /** 每帧推进：修为增长、忠诚流失、产出、叛出判定 */
  tick(dt) {
    const list = this.ensure();
    if (!list.length) return;

    const minutes = dt / 60;
    let contribSum = 0;
    let stoneSum = 0;

    // 忠诚流失用余量累积，避免每帧都在浮点上打转
    this._loyaltyCarry += this.cfg.loyaltyDecayPerMin * minutes;
    if (this._loyaltyCarry >= 1) {
      const drop = Math.floor(this._loyaltyCarry);
      this._loyaltyCarry -= drop;
      for (const d of list) d.loyalty = Math.max(0, d.loyalty - drop);
    }

    for (const d of list) {
      // 修为自然增长
      d.cultivation = Math.min(100, d.cultivation + this.growthPerMin(d) * minutes);

      // 产出
      const y = this.yieldPerMin(d);
      contribSum += y.contrib * minutes;
      stoneSum += y.stone * minutes;

      // 忠诚过低有叛出风险（按分钟折算概率）
      if (d.loyalty < this.cfg.loyaltyWarning) {
        const p = this.cfg.betrayChancePerMin * minutes;
        if (Math.random() < p) {
          this._betray(d);
        }
      }
    }

    // 产出结算（贡献走整数，灵石走游戏内资源上限）
    if (contribSum > 0 || stoneSum > 0) {
      this._yieldCarry += contribSum;
      if (this._yieldCarry >= 1) {
        const gain = Math.floor(this._yieldCarry);
        this._yieldCarry -= gain;
        if (SectSystem.data.joined) {
          SectSystem.data.contrib += gain;
          SectSystem._refreshRank();
        }
      }
      if (stoneSum >= 0.01) {
        const st = GameEngine.state;
        st.stone = Math.min(GameConfig.stoneHardCap, (st.stone || 0) + stoneSum);
      }
    }
  },

  /** 叛出师门：移除弟子并留下记录 */
  _betray(d) {
    const list = this.ensure();
    const i = list.findIndex(x => x.id === d.id);
    if (i >= 0) list.splice(i, 1);
    GameEngine._emit('discipleBetrayed', { name: d.name });
  },

  /** 指点：花灵石维持忠诚，少量推进修为 */
  advise(id) {
    const d = this.ensure().find(x => x.id === id);
    if (!d) return { ok: false, msg: '无此弟子' };
    const cost = this.cfg.adviseStone;
    if (GameEngine.state.stone < cost) return { ok: false, msg: '灵石不足' };

    GameEngine.state.stone -= cost;
    d.loyalty = Math.min(100, d.loyalty + this.cfg.adviseLoyalty);
    d.cultivation = Math.min(100, d.cultivation + this.cfg.adviseCultivation);
    return { ok: true, loyalty: d.loyalty };
  },

  /** 传功：以自身修为喂弟子，大幅推进修为与忠诚 */
  canImpart() {
    if (!this.ensure().length) return { ok: false, msg: '门下无弟子' };
    const s = GameEngine.state;
    const cap = calcQ(s.realm, s.level, 1.0);
    const cost = cap * this.cfg.impartCultivationPct;
    if (s.cultivation < cost) return { ok: false, msg: `自身修为不足（需 ${Math.ceil(cost)}）` };
    return { ok: true, cost };
  },

  impart(id) {
    const d = this.ensure().find(x => x.id === id);
    if (!d) return { ok: false, msg: '无此弟子' };
    const check = this.canImpart();
    if (!check.ok) return check;

    const s = GameEngine.state;
    s.cultivation = Math.max(0, s.cultivation - check.cost);
    d.cultivation = Math.min(100, d.cultivation + this.cfg.impartGain);
    d.loyalty = Math.min(100, d.loyalty + this.cfg.impartLoyalty);
    return { ok: true, cost: check.cost, cultivation: d.cultivation };
  },

  /** 教习处磨资质：每名弟子每日一次 */
  canTrain(id) {
    const d = this.ensure().find(x => x.id === id);
    if (!d) return { ok: false, msg: '无此弟子' };
    if (d.aptitude >= 5) return { ok: false, msg: '资质已至天灵根' };
    if (d.trainedDate === new Date().toDateString()) return { ok: false, msg: '今日已磨过' };
    // 磨资质的价目挂在宗门（教习）名下，不在弟子配置里
    if (GameEngine.state.stone < GameConfig.sect.train.stone) return { ok: false, msg: '灵石不足' };
    return { ok: true };
  },

  train(id) {
    const check = this.canTrain(id);
    if (!check.ok) return check;
    const d = this.ensure().find(x => x.id === id);
    GameEngine.state.stone -= GameConfig.sect.train.stone;
    d.aptitude = Math.min(5, d.aptitude + GameConfig.sect.train.aptitudeUp);
    d.loyalty = Math.min(100, d.loyalty + GameConfig.sect.train.loyaltyUp);
    d.trainedDate = new Date().toDateString();
    return { ok: true, aptitude: d.aptitude };
  },

  /** 传功晋级：修为满且忠诚够，可升为亲传；亲传满修为可出师 */
  canPromote(id) {
    const d = this.ensure().find(x => x.id === id);
    if (!d) return { ok: false, msg: '无此弟子' };
    if (d.cultivation < this.cfg.graduateCultivation) {
      return { ok: false, msg: `修为未足（${Math.floor(d.cultivation)}/100）` };
    }
    if (d.stage === 0) return { ok: true, next: 1, label: '升为亲传' };
    if (d.stage === 1) return { ok: true, next: 2, label: '允许出师' };
    return { ok: false, msg: '已出师' };
  },

  promote(id) {
    const check = this.canPromote(id);
    if (!check.ok) return check;
    const d = this.ensure().find(x => x.id === id);

    if (check.next === 1) {
      d.stage = 1;
      d.cultivation = 60;      // 亲传重新积累，出师需要再养一轮
      return { ok: true, stage: 1 };
    }

    // 出师：移出师门名录，记入宗门「门下」，给声望与贡献
    const list = this.ensure();
    const i = list.findIndex(x => x.id === id);
    if (i >= 0) list.splice(i, 1);
    const sect = SectSystem.data;
    if (!Array.isArray(sect.graduated)) sect.graduated = [];
    sect.graduated.push({ name: d.name, aptitude: d.aptitude, at: Date.now() });
    sect.contrib += this.cfg.graduateContrib;
    SectSystem.addPrestige(this.cfg.graduatePrestige);
    SectSystem._refreshRank();

    return {
      ok: true, stage: 2, name: d.name,
      prestige: this.cfg.graduatePrestige, contrib: this.cfg.graduateContrib,
    };
  },

  /** 资质品阶名 */
  aptitudeName(a) {
    return this.cfg.aptitudeNames[Math.min(a, 5) - 1];
  },

  /** 阶段名 */
  stageName(s) {
    return ['记名弟子', '亲传弟子', '已出师'][s] || '记名弟子';
  },
};
