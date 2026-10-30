/**
 * 桌面修仙 · P1 进阶系统
 * @trace MECH-011, MECH-012, MECH-013
 * 昼夜天气（S12）+ 宠物系统（S11）+ 功法系统（S10）
 */

// ============================
// 昼夜天气系统（S12 / MECH-013）
// ============================
const WeatherSystem = {
  // 当前天气状态
  _timeOfDay: 'day',    // day / night
  _weather: 'clear',    // clear / rain
  _lastHourChecked: -1,

  // 游戏时间（加速：1 游戏日 = 24 分钟现实时间）
  _gameHour: 12,
  _gameMinute: 0,
  _timeScale: 60, // 1 秒现实 = 1 分钟游戏 → 24 分钟 = 1 游戏日

  init() {
    // 用真实时间初始化
    const now = new Date();
    this._gameHour = now.getHours();
    this._gameMinute = now.getMinutes();
    this._updateTimeOfDay();
    this._rollWeather();
    console.log(`[Weather] Init: ${this._timeOfDay}, ${this._weather}, ${this._gameHour}:${this._gameMinute}`);
  },

  tick(dt) {
    // 更新游戏时间
    this._gameMinute += dt * (60 / this._timeScale) * 60; // 每秒增加的游戏分钟数
    while (this._gameMinute >= 60) {
      this._gameMinute -= 60;
      this._gameHour++;
      if (this._gameHour >= 24) {
        this._gameHour = 0;
        // 新的一天：重新随机天气
        this._rollWeather();
      }
      // 每小时检查昼夜切换
      this._updateTimeOfDay();
    }
  },

  _updateTimeOfDay() {
    const hour = this._gameHour;
    const prev = this._timeOfDay;
    this._timeOfDay = (hour >= 6 && hour < 18) ? 'day' : 'night';
    if (prev !== this._timeOfDay) {
      console.log(`[Weather] Time change: ${this._timeOfDay}`);
      GameEngine._emit?.('timeOfDayChanged', this._timeOfDay);
    }
  },

  _rollWeather() {
    // 30% 概率下雨
    this._weather = Math.random() < 0.3 ? 'rain' : 'clear';
  },

  /** 获取灵田生长速度倍率 */
  get growthMultiplier() {
    if (this._weather === 'rain') return GameConfig.rainGrowthMult;
    return this._timeOfDay === 'night' ? GameConfig.nightGrowthMult : GameConfig.dayGrowthMult;
  },

  /** 获取修炼效率倍率（夜晚略有加成） */
  get meditationMultiplier() {
    return this._timeOfDay === 'night' ? 1.15 : 1.0;
  },

  /** 是否夜晚 */
  get isNight() { return this._timeOfDay === 'night'; },

  /** 是否雨天 */
  get isRain() { return this._weather === 'rain'; },

  /** 当前天气描述 */
  get description() {
    const timeDesc = this.isNight ? '🌙 夜晚' : '☀️ 白天';
    const weatherDesc = this.isRain ? '🌧 雨天' : '🌤 晴天';
    return `${timeDesc} · ${weatherDesc}`;
  },

  /** 时间字符串 */
  get timeString() {
    return `${String(Math.floor(this._gameHour)).padStart(2, '0')}:${String(Math.floor(this._gameMinute)).padStart(2, '0')}`;
  },
};

// ============================
// 宠物系统（S11 / MECH-012）
// ============================
const PetSystem = {
  _owned: {},     // { petId: { level, active } }
  _activePet: null,

  // 宠物定义
  _pets: [
    {
      id: 'spirit_fish', name: '灵鱼', icon: '🐟',
      description: '灵池中的锦鲤，灵气充沛',
      unlockRealm: 2, // 筑基解锁
      bonuses: { cultivationRate: 0.10 }, // +10% 修为速率
      upgradeCost: 100, // 每级灵石
      maxLevel: 5,
    },
    {
      id: 'spirit_turtle', name: '灵龟', icon: '🐢',
      description: '长寿灵龟，延缓时间流逝',
      unlockRealm: 3, // 金丹解锁
      bonuses: { offlineCap: 7200 }, // +2小时离线上限
      upgradeCost: 200,
      maxLevel: 5,
    },
    {
      id: 'spirit_chicken', name: '灵鸡', icon: '🐔',
      description: '每日产灵蛋，灵田增产',
      unlockRealm: 4, // 元婴解锁
      bonuses: { herbBonus: 0.20 }, // +20% 灵草收获
      upgradeCost: 300,
      maxLevel: 5,
    },
    {
      id: 'little_dog', name: '小黄狗', icon: '🐕',
      description: '忠诚伙伴，引更多访客',
      unlockRealm: 5, // 化神解锁
      bonuses: { visitorRate: 0.50 }, // +50% 访客出现频率
      upgradeCost: 500,
      maxLevel: 5,
    },
  ],

  init() {
    const saved = this._load();
    if (saved) {
      this._owned = saved.owned || {};
      this._activePet = saved.activePet || null;
    }
    console.log('[Pet] Initialized, owned:', Object.keys(this._owned).length);
  },

  /** 获取宠物列表（含解锁状态） */
  getAll() {
    const state = GameEngine.state;
    return this._pets.map(pet => ({
      ...pet,
      isUnlocked: state.realm >= pet.unlockRealm,
      isOwned: !!this._owned[pet.id],
      level: this._owned[pet.id]?.level || 0,
      isActive: this._activePet === pet.id,
    }));
  },

  /** 领养宠物 */
  adopt(petId) {
    const pet = this._pets.find(p => p.id === petId);
    if (!pet) return false;

    const state = GameEngine.state;
    if (state.realm < pet.unlockRealm) return false;
    if (this._owned[petId]) return false;

    this._owned[petId] = { level: 1, active: false };
    this._save();
    return true;
  },

  /** 升级宠物 */
  upgrade(petId) {
    const entry = this._owned[petId];
    const pet = this._pets.find(p => p.id === petId);
    if (!entry || !pet) return false;
    if (entry.level >= pet.maxLevel) return false;

    const cost = pet.upgradeCost * entry.level;
    if (GameEngine.state.stone < cost) return false;

    GameEngine.state.stone -= cost;
    entry.level++;
    this._save();
    return true;
  },

  /** 切换出战宠物 */
  setActive(petId) {
    if (!this._owned[petId]) return false;
    this._activePet = petId;
    this._save();
    return true;
  },

  /** 获取当前出战宠物的加成 */
  get activeBonuses() {
    if (!this._activePet) return {};
    const pet = this._pets.find(p => p.id === this._activePet);
    const entry = this._owned[this._activePet];
    if (!pet || !entry) return {};

    // 加成随等级缩放
    const scale = 1 + (entry.level - 1) * 0.2;
    const bonuses = {};
    for (const [key, val] of Object.entries(pet.bonuses)) {
      bonuses[key] = val * scale;
    }
    return bonuses;
  },

  /** 获取灵草收获加成 */
  get herbMultiplier() {
    return 1 + (this.activeBonuses.herbBonus || 0);
  },

  /** 获取修为速率加成 */
  get cultivationRateBonus() {
    return this.activeBonuses.cultivationRate || 0;
  },

  /** 获取离线上限加成（秒） */
  get offlineCapBonus() {
    return this.activeBonuses.offlineCap || 0;
  },

  /** 获取访客频率加成 */
  get visitorRateBonus() {
    return this.activeBonuses.visitorRate || 0;
  },

  _save() {
    try {
      localStorage.setItem('dxy_pets', JSON.stringify({
        owned: this._owned,
        activePet: this._activePet,
      }));
    } catch (e) { /* ignore */ }
  },

  _load() {
    try {
      const json = localStorage.getItem('dxy_pets');
      return json ? JSON.parse(json) : null;
    } catch (e) { return null; }
  },
};

// ============================
// 功法系统（S10 / MECH-011）
// ============================
const TechniqueSystem = {
  _learned: {}, // { techniqueId: true }

  // 功法定义
  _techniques: [
    {
      id: 'breathing_art', name: '吐纳诀', icon: '🌬️',
      description: '基础吐纳之法，提升修为积累速度',
      cost: 50, // 灵石
      unlockRealm: 1,
      bonuses: { cultivationRate: 0.15 },
    },
    {
      id: 'sword_art', name: '御剑术', icon: '🗡️',
      description: '御剑千里，练剑效果大增',
      cost: 150,
      unlockRealm: 2,
      bonuses: { swordGain: 0.30 },
    },
    {
      id: 'alchemy_heart', name: '炼丹心法', icon: '💫',
      description: '丹道心法，炼丹速度加快',
      cost: 300,
      unlockRealm: 3,
      bonuses: { craftSpeed: 0.25 },
    },
    {
      id: 'spirit_array', name: '聚灵阵', icon: '⭐',
      description: '汇聚天地灵气，全面提升修炼',
      cost: 500,
      unlockRealm: 4,
      bonuses: { cultivationRate: 0.10, herbBonus: 0.15, swordGain: 0.10 },
    },
    {
      id: 'heavenly_dao', name: '天道功', icon: '🌈',
      description: '传说中的至高功法，突破概率大增',
      cost: 1000,
      unlockRealm: 5,
      bonuses: { cultivationRate: 0.20, breakthroughDiscount: 0.5 },
    },
  ],

  init() {
    const saved = this._load();
    if (saved) this._learned = saved;
    console.log('[Technique] Initialized, learned:', Object.keys(this._learned).length);
  },

  /** 获取所有功法（含学习状态） */
  getAll() {
    const state = GameEngine.state;
    return this._techniques.map(tech => ({
      ...tech,
      isUnlocked: state.realm >= tech.unlockRealm,
      isLearned: !!this._learned[tech.id],
      canAfford: state.stone >= tech.cost,
    }));
  },

  /** 学习功法 */
  learn(techniqueId) {
    const tech = this._techniques.find(t => t.id === techniqueId);
    if (!tech) return false;
    if (this._learned[techniqueId]) return false;

    const state = GameEngine.state;
    if (state.realm < tech.unlockRealm) return false;
    if (state.stone < tech.cost) return false;

    state.stone -= tech.cost;
    this._learned[techniqueId] = true;
    this._save();
    return true;
  },

  /** 获取已学功法的总加成 */
  get bonuses() {
    const total = {};
    for (const [id] of Object.entries(this._learned)) {
      const tech = this._techniques.find(t => t.id === id);
      if (!tech) continue;
      for (const [key, val] of Object.entries(tech.bonuses)) {
        total[key] = (total[key] || 0) + val;
      }
    }
    return total;
  },

  /** 修为速率加成 */
  get cultivationRateBonus() {
    return this.bonuses.cultivationRate || 0;
  },

  /** 练剑收益加成 */
  get swordGainBonus() {
    return this.bonuses.swordGain || 0;
  },

  /** 炼丹速度加成 */
  get craftSpeedBonus() {
    return this.bonuses.craftSpeed || 0;
  },

  /** 灵草收获加成 */
  get herbBonus() {
    return this.bonuses.herbBonus || 0;
  },

  _save() {
    try {
      localStorage.setItem('dxy_techniques', JSON.stringify(this._learned));
    } catch (e) { /* ignore */ }
  },

  _load() {
    try {
      const json = localStorage.getItem('dxy_techniques');
      return json ? JSON.parse(json) : null;
    } catch (e) { return null; }
  },
};
