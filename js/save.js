/**
 * 桌面修仙 · 存档系统
 * @trace MECH-007, MECH-017
 * localStorage 存档/读档（原子写入+备份）
 * JSON 格式与 Unity SaveData.cs 兼容
 */

const SaveSystem = {
  SAVE_KEY: 'desktop_xianxia_save',
  BACKUP_KEY: 'desktop_xianxia_backup_',
  WRITER_KEY: 'desktop_xianxia_writer',   // 最近一次写入的标签页标识
  MAX_BACKUPS: 3,
  VERSION: 1,
  _backupSlot: 0,
  // 每个标签页一个随机 id：多开时靠它判断"这次存档是不是别人写的"
  _tabId: Math.random().toString(36).slice(2) + Date.now().toString(36),
  _autoSaveDisabled: false,

  /**
   * 数值字段注册表。
   *
   * 为什么要有这张表：数值字段一旦读到脏值（字符串、null、NaN），
   * 就会沿着计算链一路污染。例如 lastSaveTicks 为 "abc" 时，
   * 离线结算会算出 NaN 修为，玩家的修为条永久卡死在 NaN，再也无法突破。
   * 逐个 if 打补丁既漏又难维护，所以统一登记、统一清洗。
   *
   * 新增数值字段时必须在这里登记，audit 的 P 组会检查覆盖率。
   * [最小值, 最大值, 默认值, 'int'|'num']
   */
  FIELDS: {
    lastSaveTicks:       [0, 4e12, 0, 'int'],
    dao:                 [0, 1e9, 0, 'int'],
    rebirths:            [0, 1e6, 0, 'int'],
    realm:               [1, 6, 1, 'int'],
    level:               [1, 9, 1, 'int'],
    cultivation:         [0, 1e12, 0, 'num'],
    bufferedCultivation: [0, 1e12, 0, 'num'],
    totalCultivation:    [0, 1e15, 0, 'num'],
    spiritSense:         [1, 1e9, 10, 'int'],
    health:              [1, 1e9, 100, 'int'],
    mana:                [0, 1e9, 50, 'int'],
    pillBoostRemaining:  [0, 1e6, 0, 'num'],
    stone:               [0, 999999, 50, 'int'],
    herb:                [0, 999, 10, 'int'],
    ore:                 [0, 999, 0, 'int'],
    dew:                 [0, 999, 0, 'int'],
    cultivationPill:     [0, 999, 0, 'int'],
    breakthroughPill:    [0, 999, 1, 'int'],
    unlockedPlots:       [3, 8, 3, 'int'],
    injuryUntil:         [0, 4e12, 0, 'num'],
  },

  /** 把任意输入压成一个有限的、在范围内的数字 */
  _sanitizeNum(value, spec) {
    const [min, max, def, kind] = spec;
    const n = Number(value);
    if (!Number.isFinite(n)) return def;      // NaN / Infinity / null / 'abc' 全部回落到默认值
    const clamped = Math.min(max, Math.max(min, n));
    return kind === 'int' ? Math.floor(clamped) : clamped;
  },

  /** 创建默认存档 */
  createDefault() {
    return {
      version: this.VERSION,
      timestamp: new Date().toISOString(),
      lastSaveTicks: Date.now(),
      // 轮回
      dao: 0,                 // 道行（永久）
      rebirths: 0,            // 轮回次数
      totalCultivation: 0,    // 本轮累计修为（用于结算道行）

      // 修为
      realm: 1,
      level: 1,
      cultivation: 0,
      bufferedCultivation: 0,
      spiritSense: 10,
      health: 100,
      mana: 50,
      pillBoost: false,
      pillBoostRemaining: 0,
      // 资源
      stone: 50,
      herb: 10,
      ore: 0,
      dew: 0,
      cultivationPill: 0,
      breakthroughPill: 1,   // 师父留下的最后一颗，够第一次突破
      // 种植
      unlockedPlots: GameConfig.startingPlots,
      plots: Array(GameConfig.maxPlots).fill(null).map(() => ({
        state: 'empty',
        cropId: null,
        growthProgress: 0,
        growthTime: 0,
        watered: false,
      })),
      // 炼丹队列
      craftingQueue: [],
      // 伤势（秘境重伤后生效，降低修炼速率）
      injuryUntil: 0,
      // 宗门（MECH-021）
      sect: {
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
      },
      // 弟子（MECH-023）
      disciples: [],
      // 秘境（MECH-022）
      delve: {
        active: false,
        tier: 1,
        floor: 0,
        hp: 0,
        hpMax: 1,
        taint: 0,
        loot: {},
        doors: [],
        log: [],
        bestFloor: 0,
        runs: 0,
        deaths: 0,
      },
    };
  },

  /** 保存（原子写入） */
  save(gameState) {
    try {
      gameState.timestamp = new Date().toISOString();
      gameState.lastSaveTicks = Date.now();
      const json = JSON.stringify(gameState);

      // 原子写入：先写临时键，再替换
      const tmpKey = this.SAVE_KEY + '_tmp';
      localStorage.setItem(tmpKey, json);
      localStorage.setItem(this.SAVE_KEY, json);
      localStorage.removeItem(tmpKey);

      // 备份
      this._createBackup(json);

      // 标记写入者：另一个标签页靠 storage 事件发现冲突
      try { localStorage.setItem(this.WRITER_KEY, this._tabId); } catch (e) { /* ignore */ }

      return true;
    } catch (e) {
      console.error('[SaveSystem] Save failed:', e);
      return false;
    }
  },

  /** 读取 */
  load() {
    try {
      const json = localStorage.getItem(this.SAVE_KEY);
      if (!json) return null;

      const data = JSON.parse(json);
      if (!data) return this._loadFromBackup();
      if (data.version !== this.VERSION) {
        // 旧实现：版本号不一致直接丢弃并回退备份，没有迁移路径 —— 一次版本升级
        // 就可能让所有玩家进度归零。改为先尝试迁移。
        const migrated = this.migrate(data);
        if (!migrated) {
          console.warn('[SaveSystem] Unmigratable save, trying backup');
          return this._loadFromBackup();
        }
        console.info(`[SaveSystem] Migrated save v${data.version} → v${this.VERSION}`);
        return migrated;
      }
      return this._ensureShape(data);
    } catch (e) {
      console.error('[SaveSystem] Load failed:', e);
      return this._loadFromBackup();
    }
  },

  /**
   * 把任意历史版本补齐成当前结构。
   * 返回 null 表示无法识别。
   */
  migrate(data) {
    if (!data || typeof data !== 'object') return null;
    if (typeof data.realm !== 'number' || typeof data.level !== 'number') return null;

    const v = typeof data.version === 'number' ? data.version : 0;
    if (v > this.VERSION) return null;   // 未来版本的存档不强行降级

    const base = this.createDefault();
    const merged = { ...base, ...data, version: this.VERSION };
    return this._ensureShape(merged);
  },

  /** 结构兜底：字段缺失或类型不对时补默认值，避免读到脏档后整局崩溃 */
  _ensureShape(data) {
    const base = this.createDefault();
    const out = { ...base, ...data };
    out.version = this.VERSION;   // 迁移完成后统一标记为当前版本

    // 第一遍：所有登记在册的数值字段统一清洗（缺失/NaN/字符串/越界一次解决）
    for (const key of Object.keys(this.FIELDS)) {
      out[key] = this._sanitizeNum(out[key], this.FIELDS[key]);
    }

    // 第二遍：结构型字段（数组/对象）单独处理
    out.pillBoost = !!out.pillBoost;

    // 地块数组必须够长且结构完整，否则 tick 里读 plot.state 会抛错
    if (!Array.isArray(out.plots) || out.plots.length < GameConfig.maxPlots) {
      const plots = Array(GameConfig.maxPlots).fill(null).map((_, i) =>
        out.plots && out.plots[i] ? out.plots[i] : { state: 'empty', cropId: null, growthProgress: 0, growthTime: 0, watered: false }
      );
      out.plots = plots;
    }
    out.plots = out.plots.slice(0, GameConfig.maxPlots).map(p => ({
      state: p && p.state ? p.state : 'empty',
      cropId: p && p.cropId ? p.cropId : null,
      growthProgress: Math.max(0, Number(p && p.growthProgress) || 0),
      growthTime: Math.max(0, Number(p && p.growthTime) || 0),
      watered: !!(p && p.watered),
    }));

    if (!Array.isArray(out.craftingQueue)) out.craftingQueue = [];
    out.craftingQueue = out.craftingQueue
      .filter(j => j && typeof j.recipeId === 'string')
      .slice(0, GameConfig.maxCraftQueue)
      .map(j => ({
        recipeId: j.recipeId,
        timeRemaining: Math.max(0, Number(j.timeRemaining) || 0),
        totalTime: Math.max(1, Number(j.totalTime) || 1),
      }));

    // 伤势时间戳
    out.injuryUntil = Math.max(0, Number(out.injuryUntil) || 0);

    // 宗门结构
    if (!out.sect || typeof out.sect !== 'object') out.sect = { ...base.sect };
    const rawSect = (data && typeof data.sect === 'object' && data.sect) || null;
    const isV1Sect = !!(rawSect && typeof rawSect.schema !== 'number');
    out.sect = { ...base.sect, ...out.sect };
    out.sect.rank = Math.min(Math.max(0, Number(out.sect.rank) || 0), GameConfig.sect.positions.length - 1);
    out.sect.prestige = Math.max(0, Number(out.sect.prestige) || 0);
    if (!out.sect.scriptures || typeof out.sect.scriptures !== 'object') out.sect.scriptures = {};
    if (!Array.isArray(out.sect.graduated)) out.sect.graduated = [];

    // v1 职位体系只有 4 级（外门/内门/真传/执事），新版是 7 级且多了「杂役弟子」垫底，
    // 索引整体 +1。必须在合并默认值之前判断原始存档有没有 schema 字段，
    // 合并之后 base.sect.schema 会把缺失掩盖掉。
    if (isV1Sect) {
      out.sect.rank = Math.min(out.sect.rank + 1, GameConfig.sect.positions.length - 1);
      // 旧档能到的职位不该因为改版而掉级，用声望兜住门槛
      const needGrade = GameConfig.sect.positions[out.sect.rank].grade;
      out.sect.prestige = Math.max(out.sect.prestige, GameConfig.sect.grades[needGrade - 1].prestige);
      out.sect.schema = GameConfig.sect.schema;
    }

    // 弟子阵列：结构兜底交给 DiscipleSystem.ensure 做二次清洗，
    // 这里只保证它是数组，避免读档时 tick 里 .length 报错
    if (!Array.isArray(out.disciples)) out.disciples = [];

    // 秘境结构：进行中的探险也要能续上，否则刷新页面就白丢一次门票
    if (!out.delve || typeof out.delve !== 'object') out.delve = base.delve;
    out.delve = { ...base.delve, ...out.delve };
    if (!out.delve.loot || typeof out.delve.loot !== 'object') out.delve.loot = {};
    if (!Array.isArray(out.delve.doors)) out.delve.doors = [];
    if (!Array.isArray(out.delve.log)) out.delve.log = [];
    // 没有门却标记为进行中，说明存档被截断，直接判为未开始
    if (out.delve.active && out.delve.doors.length === 0) out.delve.active = false;

    return out;
  },

  /** 导出存档为 JSON 文件 */
  exportFile(gameState) {
    try {
      // 宠物 / 功法 / 日常目标存在各自的 localStorage 键里，
      // 原实现只序列化 gameState，导出的备份里没有这三块，
      // 换设备导入后宠物和功法全部丢失。这里一并打包。
      const payload = {
        ...gameState,
        _extras: this._collectExtras(),
      };
      const json = JSON.stringify(payload, null, 2);
      const filename = `desktop_xianxia_${new Date().toISOString().slice(0, 10)}.json`;

      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        // 环境不支持 Blob URL 时，退化为控制台输出，保证按钮不抛异常
        console.warn('[SaveSystem] createObjectURL unavailable, dump to console');
        console.log(json);
        return false;
      }

      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (e) {
      console.error('[SaveSystem] Export failed:', e);
      return false;
    }
  },

  /** 收集主存档之外的附属数据（宠物 / 功法 / 日常） */
  _collectExtras() {
    const extras = {};
    for (const [key, field] of [
      ['dxy_pets', 'pets'],
      ['dxy_techniques', 'techniques'],
      ['dxy_daily_goals', 'daily'],
    ]) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) extras[field] = JSON.parse(raw);
      } catch (e) { /* ignore */ }
    }
    return extras;
  },

  /** 还原附属数据 */
  _restoreExtras(extras) {
    if (!extras || typeof extras !== 'object') return 0;
    let n = 0;
    for (const [key, field] of [
      ['dxy_pets', 'pets'],
      ['dxy_techniques', 'techniques'],
      ['dxy_daily_goals', 'daily'],
    ]) {
      if (extras[field] === undefined) continue;
      try {
        localStorage.setItem(key, JSON.stringify(extras[field]));
        n++;
      } catch (e) { /* ignore */ }
    }
    return n;
  },

  /** 从 JSON 文件导入存档 */
  importFile(file, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || typeof data !== 'object') throw new Error('not an object');

        // 版本迁移：不再因为版本号不同就直接判定"不兼容"
        const migrated = this.migrate(data);
        if (!migrated) {
          callback(null, '存档版本不兼容');
          return;
        }
        // 先还原附属数据，再交给调用方替换主状态
        if (migrated._extras) {
          this._restoreExtras(migrated._extras);
          delete migrated._extras;
        }
        callback(migrated, null);
      } catch (err) {
        callback(null, '存档文件格式错误');
      }
    };
    reader.onerror = () => callback(null, '读取文件失败');
    reader.readAsText(file);
  },

  /**
   * 计算"离开一段时间"的收益（离线结算与切后台补算共用同一套公式）。
   * 抽成公共函数的原因：原实现只有离线走这套逻辑，切后台回来完全不结算，
   * 两处一旦各写一遍就必然漂移，所以统一到一个入口。
   * @param {object} gameState
   * @param {number} seconds 离开的秒数（调用方负责按上限钳制）
   */
  computeAwayGains(gameState, seconds) {
    const rate0 = calcRate(gameState.realm, true, false); // 后台速率
    let rate = rate0;
    if (typeof PetSystem !== 'undefined') rate *= (1 + PetSystem.cultivationRateBonus);
    if (typeof TechniqueSystem !== 'undefined') rate *= (1 + TechniqueSystem.cultivationRateBonus);
    rate *= 1 + (gameState.dao || 0) * GameConfig.rebirth.daoRatePerPoint;
    if (gameState.pillBoost) rate *= GameConfig.pillBoostMult;

    // 灵草按"已开垦地块数"结算，而不是写死起始地块
    const plots = Math.min(
      Math.max(GameConfig.startingPlots, gameState.unlockedPlots || GameConfig.startingPlots),
      GameConfig.maxPlots
    );
    const herbMult = (typeof PetSystem !== 'undefined' ? PetSystem.herbMultiplier : 1)
      * (1 + (typeof TechniqueSystem !== 'undefined' ? TechniqueSystem.herbBonus : 0))
      * (1 + (gameState.dao || 0) * GameConfig.rebirth.daoHerbPerPoint);

    // 弟子产出也必须在离线时结算。
    // 灵田、矿石、凝露都会离线条目里结算，唯独弟子不结算，
    // 相当于"养徒弟只在开着的电脑上才有效"，与放置游戏的核心承诺相悖。
    // 注意：离线期间不计算忠诚流失，避免玩家不在时弟子叛出。
    let discipleContrib = 0;
    let discipleStone = 0;
    if (typeof DiscipleSystem !== 'undefined' && Array.isArray(gameState.disciples)) {
      for (const d of gameState.disciples) {
        if (!d) continue;
        const y = DiscipleSystem.yieldPerMin(d);
        discipleContrib += y.contrib * seconds / 60;
        discipleStone += y.stone * seconds / 60;
      }
    }

    return {
      cultivation: rate * seconds,
      herb: Math.floor(GameConfig.herbPerHourPerPlot * plots * herbMult * seconds / 3600),
      ore: Math.floor(GameConfig.orePerHour * seconds / 3600),
      dew: Math.floor(GameConfig.dewPerHour * seconds / 3600),
      contrib: Math.floor(discipleContrib),
      discipleStone: Math.floor(discipleStone),
      rate,
    };
  },

  /** 计算离线收益 */
  calculateOfflineGains(gameState, currentTime) {
    const lastSave = gameState.lastSaveTicks || 0;

    // 灵龟「离线上限 +2 小时」
    const petCapBonus = (typeof PetSystem !== 'undefined') ? PetSystem.offlineCapBonus : 0;
    const capSeconds = GameConfig.offlineCapSeconds + petCapBonus;

    const rawElapsed = (currentTime - lastSave) / 1000;
    const elapsed = Math.min(rawElapsed, capSeconds);
    if (elapsed < 10) return null; // 不足10秒不计算

    const g = this.computeAwayGains(gameState, elapsed);

    return {
      elapsedSeconds: elapsed,
      cultivation: g.cultivation,
      herb: g.herb,
      ore: g.ore,
      dew: g.dew,
      contrib: g.contrib,
      discipleStone: g.discipleStone,
      capped: rawElapsed > capSeconds,
      capHours: +(capSeconds / 3600).toFixed(1),
    };
  },

  /** 创建备份（顺序轮转，避免 Date.now()%3 反复命中同一槽） */
  _createBackup(json) {
    try {
      this._backupSlot = ((this._backupSlot || 0) + 1) % this.MAX_BACKUPS;
      localStorage.setItem(this.BACKUP_KEY + this._backupSlot, json);
    } catch (e) {
      console.warn('[SaveSystem] Backup failed:', e);
    }
  },

  /** 从备份加载 */
  _loadFromBackup() {
    for (let i = this.MAX_BACKUPS - 1; i >= 0; i--) {
      try {
        const json = localStorage.getItem(this.BACKUP_KEY + i);
        if (json) {
          const data = JSON.parse(json);
          if (data && data.version === this.VERSION) return this._ensureShape(data);
          const migrated = this.migrate(data);
          if (migrated) return migrated;
        }
      } catch (e) { /* continue */ }
    }
    return null;
  },

  /**
   * 监听其它标签页的存档写入。
   * 两个标签页同时开同一份存档时，各自每 60 秒自动存档一次，
   * 后写的会整体覆盖先写的——玩家在 A 页的半小时操作会被 B 页抹掉，且毫无提示。
   * 这里检测到别人写入后，让本页停止自动存档并交给上层提示。
   * @param {function} onConflict 回调，参数为对方 tabId
   */
  watchOtherTabs(onConflict) {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener('storage', (e) => {
      if (e.key !== this.WRITER_KEY || !e.newValue) return;
      if (e.newValue === this._tabId) return;      // 自己写的，忽略
      if (this._autoSaveDisabled) return;          // 已降级，不重复提示
      this._autoSaveDisabled = true;
      if (typeof onConflict === 'function') onConflict(e.newValue);
    });
  },

  /** 手动存档时重新夺回写入权（玩家明确选择在本页继续） */
  reclaimWriter() {
    this._autoSaveDisabled = false;
    try { localStorage.setItem(this.WRITER_KEY, this._tabId); } catch (e) { /* ignore */ }
  },
};
