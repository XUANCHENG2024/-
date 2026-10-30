/**
 * 桌面修仙 · 存档系统
 * @trace MECH-007, MECH-017
 * localStorage 存档/读档（原子写入+备份）
 * JSON 格式与 Unity SaveData.cs 兼容
 */

const SaveSystem = {
  SAVE_KEY: 'desktop_xianxia_save',
  BACKUP_KEY: 'desktop_xianxia_backup_',
  MAX_BACKUPS: 3,
  VERSION: 1,

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
      if (!data || data.version !== this.VERSION) {
        console.warn('[SaveSystem] Version mismatch, trying backup');
        return this._loadFromBackup();
      }
      return data;
    } catch (e) {
      console.error('[SaveSystem] Load failed:', e);
      return this._loadFromBackup();
    }
  },

  /** 导出存档为 JSON 文件 */
  exportFile(gameState) {
    try {
      const json = JSON.stringify(gameState, null, 2);
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

  /** 从 JSON 文件导入存档 */
  importFile(file, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data && data.version === this.VERSION) {
          callback(data);
        } else {
          alert('存档版本不兼容');
        }
      } catch (err) {
        alert('存档文件格式错误');
      }
    };
    reader.readAsText(file);
  },

  /** 计算离线收益 */
  calculateOfflineGains(gameState, currentTime) {
    const lastSave = gameState.lastSaveTicks || 0;
    const elapsed = Math.min((currentTime - lastSave) / 1000, GameConfig.offlineCapSeconds);
    if (elapsed < 10) return null; // 不足10秒不计算

    const R = gameState.realm;
    const rate = calcRate(R, true, false); // 后台速率
    const cultivationGain = rate * elapsed;

    // 资源产出（灵草/矿石/凝露被动产出）
    const herbGain = Math.floor(GameConfig.herbPerHourPerPlot * GameConfig.startingPlots * elapsed / 3600);
    const oreGain = Math.floor(GameConfig.orePerHour * elapsed / 3600);
    const dewGain = Math.floor(GameConfig.dewPerHour * elapsed / 3600);

    return {
      elapsedSeconds: elapsed,
      cultivation: cultivationGain,
      herb: herbGain,
      ore: oreGain,
      dew: dewGain,
    };
  },

  /** 创建备份 */
  _createBackup(json) {
    try {
      const backupIndex = (Date.now() % this.MAX_BACKUPS);
      localStorage.setItem(this.BACKUP_KEY + backupIndex, json);
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
          if (data && data.version === this.VERSION) return data;
        }
      } catch (e) { /* continue */ }
    }
    return null;
  },
};
