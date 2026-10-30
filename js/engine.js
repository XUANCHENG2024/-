/**
 * 桌面修仙 · 核心游戏引擎
 * @trace MECH-001, MECH-002, MECH-003, MECH-004, MECH-005, MECH-006, MECH-008, MECH-017
 * 与 Unity 版 CultivationSystem/FarmingSystem/AlchemySystem/MeditationSystem/ResourceSystem 对齐
 */

const GameEngine = {
  // === 状态 ===
  state: null,
  _lastTick: 0,
  _isBackground: false,
  _meditateTimer: 0,
  _isMeditating: false,
  _swordCombo: 0,
  _depth: 0,        // 入定深度 0..1（坐得越久越高）
  _comboTimer: 0,
  _autoSaveTimer: 0,
  _passive: { dew: 0, ore: 0 },   // 被动采集的小数余量
  _listeners: {},

  // === 初始化 ===
  init() {
    // 加载存档或创建默认
    this.state = SaveSystem.load() || SaveSystem.createDefault();
    this._lastTick = Date.now();

    // Page Visibility API — 后台模式
    document.addEventListener('visibilitychange', () => {
      this._setBackground(document.hidden);
    });

    console.log(`[GameEngine] Initialized: Realm=${this.state.realm} Level=${this.state.level}`);
    return this.state;
  },

  // === 主循环（由 app.js 调用）===
  tick() {
    const now = Date.now();
    let dt = (now - this._lastTick) / 1000;

    // 超过 10 秒没有跑过 tick，说明页面被冻结/休眠过（且不一定派发 visibilitychange）。
    // 此时按"离场结算"补算，而不是只按钳制后的 5 秒算 —— 否则放置游戏最核心的
    // "离开也在长"会在这些场景下静默失效。
    if (dt > 10) {
      this.catchUpAway();   // 内部会把 _lastTick 拨到当下
      dt = 0;
    } else {
      this._lastTick = now;
      dt = Math.min(dt, 5); // 正常帧间隔钳制，防止一次跳太多
    }

    if (dt > 0) {
      this._tickCultivation(dt);
      this._tickCollection(dt);
      this._tickFarming(dt);
      this._tickAlchemy(dt);
      this._tickMeditation(dt);

      // 自动存档（60秒）
      // 检测到另一个标签页在写同一份存档时停手，避免互相覆盖
      this._autoSaveTimer += dt;
      if (this._autoSaveTimer >= 60) {
        this._autoSaveTimer = 0;
        if (!SaveSystem._autoSaveDisabled) SaveSystem.save(this.state);
      }
    }

    this._emit('tick', dt);
  },

  // === S1: 修为积累与突破（MECH-002）===

  _tickCultivation(dt) {
    // 丹药计时
    if (this.state.pillBoost) {
      this.state.pillBoostRemaining -= dt;
      if (this.state.pillBoostRemaining <= 0) {
        this.state.pillBoost = false;
        this.state.pillBoostRemaining = 0;
      }
    }

    // 修为积累（含宠物+功法加成）
    let rate = calcRate(this.state.realm, this._isBackground, this.state.pillBoost);
    // 宠物加成
    if (typeof PetSystem !== 'undefined') rate *= (1 + PetSystem.cultivationRateBonus);
    // 功法加成
    if (typeof TechniqueSystem !== 'undefined') rate *= (1 + TechniqueSystem.cultivationRateBonus);
    // 天气加成（夜晚修炼效率+15%）
    if (typeof WeatherSystem !== 'undefined') rate *= WeatherSystem.meditationMultiplier;

    rate *= this.daoRateMult;
    this.state.cultivation += rate * dt;
    this.state.totalCultivation = (this.state.totalCultivation || 0) + rate * dt;

    // 达到上限
    const cap = calcQ(this.state.realm, this.state.level, 1.0);
    if (this.state.cultivation >= cap) {
      const overflow = this.state.cultivation - cap;
      const maxBuffer = cap * 0.2;
      this.state.bufferedCultivation = Math.min(this.state.bufferedCultivation + overflow, maxBuffer);
      this.state.cultivation = cap;
    }

    this._emit('cultivationChanged', { current: this.state.cultivation, max: cap });
  },

  get canBreakthrough() {
    return this.state.cultivation >= calcQ(this.state.realm, this.state.level, 1.0);
  },

  tryBreakthrough() {
    if (!this.canBreakthrough) return { success: false, reason: '修为未达上限' };

    const thresholds = getStatThresholds(this.state.realm);
    if (this.state.spiritSense < thresholds.sense ||
        this.state.health < thresholds.hp ||
        this.state.mana < thresholds.mana) {
      return {
        success: false,
        reason: `属性不足（需 神识${thresholds.sense}/血量${thresholds.hp}/法力${thresholds.mana}）`
      };
    }

    // 小阶突破只凭修为与属性；跨大境界才消耗破障丹
    const isMajorJump = this.state.level >= 9;
    let pillSaved = false;
    if (isMajorJump) {
      if (this.state.breakthroughPill < 1) {
        return { success: false, reason: '跨大境界需破障丹，丹药不足' };
      }
      // 天道功「破障丹有一半几率不被消耗」——原实现里 breakthroughDiscount
      // 只写在数据里、从未被读取，等于该功法的核心卖点是假的。
      const discount = (typeof TechniqueSystem !== 'undefined')
        ? (TechniqueSystem.bonuses.breakthroughDiscount || 0)
        : 0;
      pillSaved = discount > 0 && Math.random() < discount;
      if (!pillSaved) this.state.breakthroughPill--;
    }

    // 执行突破
    // 溢出缓冲不再直接丢弃：上限内结转到新一层，避免挂机满仓后突破归零的挫败感
    const carryOver = this.state.bufferedCultivation || 0;
    this.state.cultivation = 0;
    this.state.bufferedCultivation = 0;

    this.state.level++;
    if (this.state.level > 9) {
      this.state.level = 1;
      this.state.realm = Math.min(this.state.realm + 1, 6);
    }
    // 结转量不得超过新层上限的 20%
    if (carryOver > 0) {
      this.state.cultivation = Math.min(carryOver, calcQ(this.state.realm, this.state.level, 1.0) * 0.2);
    }

    // 属性成长
    const mult = GameConfig.statGrowthPerRealm;
    this.state.spiritSense = Math.round(this.state.spiritSense * mult);
    this.state.health = Math.round(this.state.health * mult);
    this.state.mana = Math.round(this.state.mana * mult);

    this._emit('breakthroughSuccess', { realm: this.state.realm, level: this.state.level, pillSaved });
    return { success: true, pillSaved };
  },

  // 服丹：按当前层上限的百分比回复，避免后期 50 点完全失效
  useCultivationPill() {
    if (this.state.cultivationPill < 1) return false;
    const cap = calcQ(this.state.realm, this.state.level, 1.0);
    if (this.state.cultivation >= cap) return false;
    this.state.cultivationPill--;
    const gain = Math.max(1, Math.ceil(cap * GameConfig.pillInstantPct));
    this.state.cultivation = Math.min(this.state.cultivation + gain, cap);
    return true;
  },

  activatePillBoost() {
    if (this.state.cultivationPill < 1) return false;
    if (this.state.pillBoost) return false; // 已在加持中，不重复扣丹
    this.state.cultivationPill--;
    this.state.pillBoost = true;
    this.state.pillBoostRemaining = GameConfig.pillDuration;
    return true;
  },

  // === S8: 被动采集（凝露 / 矿石）===
  // 此前只有离线结算会产出，在线永远拿不到凝露，导致炼丹链断裂
  _tickCollection(dt) {
    const rain = (typeof WeatherSystem !== 'undefined' && WeatherSystem.isRain)
      ? GameConfig.dewRainMult : 1;
    const night = (typeof WeatherSystem !== 'undefined' && WeatherSystem.isNight)
      ? GameConfig.oreNightMult : 1;

    this._passive.dew += (GameConfig.dewPerHour / 3600) * rain * dt;
    this._passive.ore += (GameConfig.orePerHour / 3600) * night * dt;

    if (this._passive.dew >= 1) {
      const n = Math.floor(this._passive.dew);
      this._passive.dew -= n;
      this._addResource('dew', n);
    }
    if (this._passive.ore >= 1) {
      const n = Math.floor(this._passive.ore);
      this._passive.ore -= n;
      this._addResource('ore', n);
    }
  },

  // === S2: 灵田种植（MECH-003）===

  /** 已解锁地块数（旧存档无此字段时回落到初始值） */
  get unlockedPlots() {
    const n = this.state.unlockedPlots;
    return Math.min(Math.max(n || GameConfig.startingPlots, GameConfig.startingPlots), GameConfig.maxPlots);
  },

  /** 下一块地的价格；已满返回 null */
  get nextPlotCost() {
    const idx = this.unlockedPlots - GameConfig.startingPlots;
    return idx < GameConfig.plotCosts.length ? GameConfig.plotCosts[idx] : null;
  },

  /** 买地 */
  buyPlot() {
    const cost = this.nextPlotCost;
    if (cost === null) return { ok: false, msg: '灵田已开满' };
    if (this.state.stone < cost) return { ok: false, msg: '灵石不足' };
    this.state.stone -= cost;
    this.state.unlockedPlots = this.unlockedPlots + 1;
    this._emit('notification', `开垦成功，共 ${this.state.unlockedPlots} 块灵田`);
    return { ok: true };
  },

  _tickFarming(dt) {
    // 天气影响生长速度
    const timeMult = (typeof WeatherSystem !== 'undefined')
      ? WeatherSystem.growthMultiplier
      : GameConfig.dayGrowthMult;

    for (let i = 0; i < this.unlockedPlots; i++) {
      const plot = this.state.plots[i];
      if (plot.state !== 'growing') continue;

      const speedMult = plot.watered ? (1 + GameConfig.waterSpeedBonus) : 1;
      plot.growthProgress += dt * timeMult * speedMult;

      if (plot.growthProgress >= plot.growthTime) {
        plot.state = 'ready';
        this._emit('plotReady', i);
      }
    }
  },

  plant(plotIndex, cropId) {
    const plot = this.state.plots[plotIndex];
    if (!plot || plot.state !== 'empty') return false;

    const crop = GameConfig.crops.find(c => c.id === cropId);
    if (!crop) return false;

    if (this.state.herb < crop.seedCost) {
      this._emit('notification', '灵草不足，无法播种');
      return false;
    }

    this.state.herb -= crop.seedCost;
    plot.state = 'growing';
    plot.cropId = cropId;
    plot.growthProgress = 0;
    plot.growthTime = crop.growthTime;
    plot.watered = false;

    this._emit('plotPlanted', plotIndex);
    return true;
  },

  water(plotIndex) {
    const plot = this.state.plots[plotIndex];
    if (!plot || plot.state !== 'growing' || plot.watered) return false;
    plot.watered = true;
    return true;
  },

  harvest(plotIndex) {
    const plot = this.state.plots[plotIndex];
    if (!plot || plot.state !== 'ready') return 0;

    const crop = GameConfig.crops.find(c => c.id === plot.cropId);
    let yieldAmount = crop ? crop.yield : 1;

    // 宠物灵草加成
    if (typeof PetSystem !== 'undefined') {
      yieldAmount = Math.round(yieldAmount * PetSystem.herbMultiplier);
    }
    // 功法灵草加成
    if (typeof TechniqueSystem !== 'undefined') {
      yieldAmount = Math.round(yieldAmount * (1 + TechniqueSystem.herbBonus));
    }

    yieldAmount = Math.max(1, Math.round(yieldAmount * this.daoHerbMult));
    const added = this._addResource('herb', yieldAmount);

    // 重置地块
    plot.state = 'empty';
    plot.cropId = null;
    plot.growthProgress = 0;
    plot.watered = false;

    this._emit('plotHarvested', plotIndex);
    return added;
  },

  // === S3: 炼丹（MECH-004）===

  _tickAlchemy(dt) {
    for (let i = this.state.craftingQueue.length - 1; i >= 0; i--) {
      const job = this.state.craftingQueue[i];
      job.timeRemaining -= dt;
      if (job.timeRemaining <= 0) {
        this._completeCraft(job);
        this.state.craftingQueue.splice(i, 1);
      }
    }
  },

  startCraft(recipeId) {
    if (this.state.craftingQueue.length >= GameConfig.maxCraftQueue) {
      this._emit('notification', '炼丹队列已满');
      return false;
    }

    const recipe = GameConfig.recipes.find(r => r.id === recipeId);
    if (!recipe) return false;

    if (this.state.herb < recipe.herbCost ||
        this.state.dew < recipe.dewCost ||
        (recipe.oreCost > 0 && this.state.ore < recipe.oreCost)) {
      this._emit('notification', '炼丹材料不足');
      return false;
    }

    this.state.herb -= recipe.herbCost;
    this.state.dew -= recipe.dewCost;
    if (recipe.oreCost > 0) this.state.ore -= recipe.oreCost;

    // 炼丹心法「炼丹速度 +25%」——原实现直接取 recipe.craftTime，
    // craftSpeedBonus 从未参与计算，等于该功法只加了个不存在的说明。
    const speedBonus = (typeof TechniqueSystem !== 'undefined')
      ? TechniqueSystem.craftSpeedBonus : 0;
    const actualTime = Math.max(1, recipe.craftTime * (1 - Math.min(speedBonus, 0.8)));

    this.state.craftingQueue.push({
      recipeId: recipeId,
      timeRemaining: actualTime,
      totalTime: actualTime,
    });

    this._emit('craftingStarted', recipeId);
    return true;
  },

  accelerateCraft(recipeId) {
    const job = this.state.craftingQueue.find(j => j.recipeId === recipeId);
    if (!job) return false;
    const recipe = GameConfig.recipes.find(r => r.id === recipeId);
    if (!recipe) return false;

    if (this.state.dew < 1) return false;
    this.state.dew--;
    job.timeRemaining *= (1 - recipe.accelerateRatio);
    return true;
  },

  _completeCraft(job) {
    const recipe = GameConfig.recipes.find(r => r.id === job.recipeId);
    if (!recipe) return;

    this._addResource(recipe.result, recipe.amount);
    // 原实现传的是 recipe.recipeId（该字段不存在），监听方拿到的一直是 undefined
    this._emit('craftingCompleted', recipe.id);
  },

  // === S4: 打坐/练剑（MECH-005）===

  _tickMeditation(dt) {
    // 打坐加速
    if (this._isMeditating) {
      this._meditateTimer += dt;
      if (this._meditateTimer >= GameConfig.maxMeditationSeconds) {
        this.stopMeditation();
        this._emit('notification', '打坐时间过长，自动停止');
      } else {
        // 入定渐深：2.0 → 4.5 倍（45 秒坐满）
        this._depth = Math.min(1, this._depth + dt / GameConfig.meditateDepthSeconds);
        const mult = GameConfig.meditateActiveMult + GameConfig.meditateDepthBonus * this._depth;

        // 必须在"当前实际速率"上做乘法，而不是加一个每题 1 点/秒的常数。
        // 原实现：extra = 1 × (mult-1) × dt，境界越高基础速率越大，
        // 这份固定加成就越被稀释 —— 到渡劫期宣称的 ×4.5 实际只剩 ×1.46。
        let rate = calcRate(this.state.realm, this._isBackground, this.state.pillBoost);
        if (typeof PetSystem !== 'undefined') rate *= (1 + PetSystem.cultivationRateBonus);
        if (typeof TechniqueSystem !== 'undefined') rate *= (1 + TechniqueSystem.cultivationRateBonus);
        if (typeof WeatherSystem !== 'undefined') rate *= WeatherSystem.meditationMultiplier;
        rate *= this.daoRateMult;

        const extra = rate * (mult - 1) * dt;
        const cap = calcQ(this.state.realm, this.state.level, 1.0);
        const room = cap - this.state.cultivation;
        if (room > 0) {
          const gained = Math.min(extra, room);
          this.state.cultivation += gained;
          this.state.totalCultivation = (this.state.totalCultivation || 0) + gained;
        }
      }
    }

    // 练剑连击计时
    if (this._swordCombo > 0) {
      this._comboTimer -= dt;
      if (this._comboTimer <= 0) {
        this._swordCombo = 0;
        this._emit('comboChanged', 0);
      }
    }
  },

  startMeditation() {
    if (this._isMeditating) return;
    this._isMeditating = true;
    this._meditateTimer = 0;
    this._emit('meditationChanged', true);
  },

  stopMeditation() {
    if (!this._isMeditating) return;
    this._isMeditating = false;
    this._depth = 0;
    this._emit('meditationChanged', false);
  },

  /** 当前打坐倍率（2.0 起手 → 4.5 入定满） */
  get meditateMultiplier() {
    return GameConfig.meditateActiveMult + GameConfig.meditateDepthBonus * this._depth;
  },

  swordStrike() {
    this._swordCombo++;
    this._comboTimer = GameConfig.swordComboWindow;

    const comboMult = 1 + Math.min(
      this._swordCombo * GameConfig.swordComboIncrement,
      GameConfig.swordComboMaxMult - 1
    );

    // 收益 = 当前修炼速率 × 每次出剑折算的秒数 × 连击倍率。
    // 原实现用固定点数（3 点/剑）叠加按住连发（5 剑/秒），实际 DPS 达 45 倍挂机速率，
    // 使灵田/炼丹/打坐全部失去意义；且境界越高固定点数占比越低，收益结构前后矛盾。
    // 改为速率折算后，练剑恒为约 9 倍挂机速率，与打坐（4.5 倍）形成"要动手 vs 挂着"的选择。
    let rate = calcRate(this.state.realm, this._isBackground, this.state.pillBoost);
    if (typeof PetSystem !== 'undefined') rate *= (1 + PetSystem.cultivationRateBonus);
    if (typeof TechniqueSystem !== 'undefined') rate *= (1 + TechniqueSystem.cultivationRateBonus);
    if (typeof WeatherSystem !== 'undefined') rate *= WeatherSystem.meditationMultiplier;
    rate *= this.daoRateMult;

    let gain = rate * GameConfig.swordStrikeSeconds * comboMult;

    // 御剑术：练剑收益额外加成
    if (typeof TechniqueSystem !== 'undefined') {
      gain *= (1 + TechniqueSystem.swordGainBonus);
    }

    const cap = calcQ(this.state.realm, this.state.level, 1.0);
    const room = Math.max(0, cap - this.state.cultivation);
    const actual = Math.min(gain, room);
    this.state.cultivation += actual;
    this.state.totalCultivation = (this.state.totalCultivation || 0) + actual;

    this._emit('comboChanged', this._swordCombo);
    return gain;
  },

  // === 轮回（转生，终局循环）===

  /** 道行带来的修炼速率倍率 */
  get daoRateMult() {
    return 1 + (this.state.dao || 0) * GameConfig.rebirth.daoRatePerPoint;
  },

  /** 道行带来的灵草产出倍率 */
  get daoHerbMult() {
    return 1 + (this.state.dao || 0) * GameConfig.rebirth.daoHerbPerPoint;
  },

  /** 是否已到渡劫 9 层且修为圆满 */
  get canRebirth() {
    return this.state.realm >= 6 && this.state.level >= 9 && this.canBreakthrough;
  },

  /** 本次轮回可得道行 */
  get rebirthDaoGain() {
    const total = this.state.totalCultivation || 0;
    const g = Math.floor(Math.sqrt(total / GameConfig.rebirth.divisor));
    return Math.max(GameConfig.rebirth.minDao, g);
  },

  /** 入轮回：重置境界与资源，保留道行、功法、宠物 */
  rebirth() {
    if (!this.canRebirth) return { ok: false, msg: '尚未圆满（需渡劫 9 层且修为满）' };

    const gain = this.rebirthDaoGain;
    const dao = (this.state.dao || 0) + gain;
    const n = (this.state.rebirths || 0) + 1;

    this.state = SaveSystem.createDefault();
    this.state.dao = dao;
    this.state.rebirths = n;
    this._passive = { dew: 0, ore: 0 };

    this._emit('rebirth', { gain, dao, times: n });
    return { ok: true, gain, dao };
  },

  // === S5: 资源管理（MECH-006, NUM-003）===

  _addResource(type, amount) {
    if (amount <= 0) return 0;
    const cap = type === 'stone' ? GameConfig.stoneHardCap : GameConfig.resourceHardCap;
    const current = this.state[type] || 0;
    const canAdd = Math.min(amount, cap - current);
    if (canAdd <= 0) {
      this._emit('resourceFull', type);
      return 0;
    }
    this.state[type] = current + canAdd;
    return canAdd;
  },

  /** 集市卖出：换取灵石 */
  sellOffer(index) {
    const offer = GameConfig.shop.sell[index];
    if (!offer) return { ok: false, msg: '无此货品' };
    if ((this.state[offer.id] || 0) < offer.amount) return { ok: false, msg: '材料不足' };
    this.state[offer.id] -= offer.amount;
    this._addResource('stone', offer.price);
    this._emit('notification', `卖出 ${offer.name}×${offer.amount}，得灵石 ${offer.price}`);
    return { ok: true };
  },

  /** 集市买入 */
  buyOffer(index) {
    const offer = GameConfig.shop.buy[index];
    if (!offer) return { ok: false, msg: '无此货品' };
    if (this.state.stone < offer.price) return { ok: false, msg: '灵石不足' };
    this.state.stone -= offer.price;
    this._addResource(offer.id, offer.amount);
    this._emit('notification', `买入 ${offer.name}×${offer.amount}`);
    return { ok: true };
  },

  /** 一键收获所有成熟地块 */
  harvestAll() {
    let total = 0, count = 0;
    for (let i = 0; i < this.unlockedPlots; i++) {
      if (this.state.plots[i].state === 'ready') {
        total += this.harvest(i);
        count++;
      }
    }
    return { total, count };
  },

  // === S16: 后台模式（MECH-008）===

  _setBackground(isBg) {
    if (this._isBackground === isBg) return;
    this._isBackground = isBg;

    if (isBg) {
      console.log('[GameEngine] Background mode ON');
    } else {
      console.log('[GameEngine] Background mode OFF');
      // 回到前台先补算，再让循环继续。
      // 原实现只发一个 foregroundReturn 事件，没人订阅，于是切标签页
      // 10 分钟只结算 5 秒（dt 被钳制），一个放置游戏却"离开不长"。
      const summary = this.catchUpAway();
      this._emit('foregroundReturn', { at: Date.now(), away: summary });
    }
    this._emit('backgroundChanged', isBg);
  },

  /**
   * 补算"离开期间"的收益。
   * 以 _lastTick 为基准：rAF 停止时它停在隐藏前最后一帧，差值就是真实离开时长；
   * 若浏览器仍在低频跑帧（每次 dt 已钳到 5 秒并已结算过），差值自然很小，不会重复计入。
   * @returns {object|null} 补算摘要，不足 10 秒或无收益时返回 null
   */
  catchUpAway() {
    const now = Date.now();
    const gapSeconds = (now - this._lastTick) / 1000;

    // 无论是否补算，都要把基准拨到当下，避免下一帧 dt 再次变大
    this._lastTick = now;

    if (!(gapSeconds >= 10)) return null;

    const petCapBonus = (typeof PetSystem !== 'undefined') ? PetSystem.offlineCapBonus : 0;
    const capSeconds = GameConfig.offlineCapSeconds + petCapBonus;
    const seconds = Math.min(gapSeconds, capSeconds);

    const g = SaveSystem.computeAwayGains(this.state, seconds);

    const cap = calcQ(this.state.realm, this.state.level, 1.0);
    const before = this.state.cultivation;
    this.state.cultivation = Math.min(cap, this.state.cultivation + g.cultivation);
    const actualCultivation = this.state.cultivation - before;
    this.state.totalCultivation = (this.state.totalCultivation || 0) + actualCultivation;

    this.state.herb = Math.min(GameConfig.resourceHardCap, (this.state.herb || 0) + g.herb);
    this.state.ore = Math.min(GameConfig.resourceHardCap, (this.state.ore || 0) + g.ore);
    this.state.dew = Math.min(GameConfig.resourceHardCap, (this.state.dew || 0) + g.dew);

    const summary = {
      seconds,
      cultivation: actualCultivation,
      herb: g.herb,
      ore: g.ore,
      dew: g.dew,
      capped: gapSeconds > capSeconds,
    };
    this._emit('awayGains', summary);
    return summary;
  },

  // === 事件系统 ===

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  },

  off(event, callback) {
    const arr = this._listeners[event];
    if (!arr) return;
    if (!callback) { delete this._listeners[event]; return; }
    const i = arr.indexOf(callback);
    if (i >= 0) arr.splice(i, 1);
  },

  _emit(event, data) {
    const handlers = this._listeners[event];
    if (!handlers) return;
    // 逐个隔离：某个监听器抛错不应该让后续监听器（存档、UI、音效）全部静默失效。
    // 原实现直接 forEach，一处异常会吞掉整条派发链。
    for (let i = 0; i < handlers.length; i++) {
      try {
        handlers[i](data);
      } catch (err) {
        console.error(`[GameEngine] listener error on "${event}":`, err);
      }
    }
  },
};
