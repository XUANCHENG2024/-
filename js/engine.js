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
    const dt = Math.min((now - this._lastTick) / 1000, 5); // 钳制最大间隔
    this._lastTick = now;

    this._tickCultivation(dt);
    this._tickCollection(dt);
    this._tickFarming(dt);
    this._tickAlchemy(dt);
    this._tickMeditation(dt);

    // 自动存档（60秒）
    this._autoSaveTimer += dt;
    if (this._autoSaveTimer >= 60) {
      this._autoSaveTimer = 0;
      SaveSystem.save(this.state);
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
    if (isMajorJump) {
      if (this.state.breakthroughPill < 1) {
        return { success: false, reason: '跨大境界需破障丹，丹药不足' };
      }
      this.state.breakthroughPill--;
    }

    // 执行突破
    this.state.cultivation = 0;
    this.state.bufferedCultivation = 0;

    this.state.level++;
    if (this.state.level > 9) {
      this.state.level = 1;
      this.state.realm = Math.min(this.state.realm + 1, 6);
    }

    // 属性成长
    const mult = GameConfig.statGrowthPerRealm;
    this.state.spiritSense = Math.round(this.state.spiritSense * mult);
    this.state.health = Math.round(this.state.health * mult);
    this.state.mana = Math.round(this.state.mana * mult);

    this._emit('breakthroughSuccess', { realm: this.state.realm, level: this.state.level });
    return { success: true };
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

    this.state.craftingQueue.push({
      recipeId: recipeId,
      timeRemaining: recipe.craftTime,
      totalTime: recipe.craftTime,
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
    this._emit('craftingCompleted', recipe.recipeId);
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
        const baseGain = this.state.pillBoost ? 2 : 1;
        const extra = baseGain * (mult - 1) * dt;
        this.state.cultivation = Math.min(
          this.state.cultivation + extra,
          calcQ(this.state.realm, this.state.level, 1.0)
        );
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
    let gain = GameConfig.swordBaseGain * comboMult;

    // 功法练剑加成
    if (typeof TechniqueSystem !== 'undefined') {
      gain *= (1 + TechniqueSystem.swordGainBonus);
    }

    const cap = calcQ(this.state.realm, this.state.level, 1.0);
    this.state.cultivation = Math.min(this.state.cultivation + gain, cap);

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
      this._emit('foregroundReturn', Date.now());
    }
    this._emit('backgroundChanged', isBg);
  },

  // === 事件系统 ===

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  },

  _emit(event, data) {
    const handlers = this._listeners[event];
    if (handlers) {
      handlers.forEach(fn => fn(data));
    }
  },
};
