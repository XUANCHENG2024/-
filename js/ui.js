/**
 * 桌面修仙 · UI 管理
 * @trace UI-001, UI-002, UI-003, UI-004, UI-005, UI-006, UI-007
 * 移动端响应式 UI 管理，触摸交互优化
 */


// 内容图标的矢量映射：系统/法门/作物用线描，角色与生灵保留插画
const GLYPH = {
  // 日常任务按类别
  farming:     { cls: 'is-farming',     id: 'i-farm' },
  alchemy:     { cls: 'is-alchemy',     id: 'i-alchemy' },
  cultivation: { cls: 'is-cultivation', id: 'i-cultivate' },
  economy:     { cls: 'is-economy',     id: 'i-stone' },
  // 功法
  breathing_art: { cls: '', id: 'i-breath' },
  sword_art:     { cls: '', id: 'i-sword' },
  alchemy_heart: { cls: '', id: 'i-flame' },
  spirit_array:  { cls: '', id: 'i-array' },
  heavenly_dao:  { cls: '', id: 'i-dao' },
};
function glyphSvg(key) {
  const g = GLYPH[key];
  if (!g) return null;
  return `<svg class="ico"><use href="#${g.id}"/></svg>`;
}

const UI = {
  _currentTab: 'cultivation',
  _selectedCrop: null,
  _toastTimer: null,
  _lastRefreshTime: 0,
  _refreshThrottleMs: 250, // 保留字段以兼容旧引用
  _needsFullRebuild: true,
  _sigs: {}, // 各面板数据签名，仅在变化时重建 DOM

  /**
   * 数据签名比对：内容真变化才返回 true（触发重建）
   * 避免每帧重建 innerHTML 导致点击被吞
   */
  _sigChanged(key, sig) {
    if (this._sigs[key] === sig) return false;
    this._sigs[key] = sig;
    return true;
  },

  // === 初始化 ===
  init() {
    this._bindNavigation();
    this._bindHUD();
    this._bindYardScene();
    this._bindFarming();
    this._bindAlchemy();
    this._bindCultivation();
    this._bindSystem();
    this._bindModals();
    this._bindDelegatedEvents(); // 事件委托层

    // 恢复上次停留的面板
    let lastTab = 'cultivation';
    try {
      const saved = localStorage.getItem('dxy_tab');
      if (saved && document.querySelector(`.panel[data-panel="${saved}"]`)) lastTab = saved;
    } catch (e) { /* ignore */ }
    this.showTab(lastTab);

    // 同步导航高亮
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === lastTab);
    });
  },

  // === 导航 ===
  _bindNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.showTab(btn.dataset.tab);
      });
    });
  },

  showTab(tab) {
    this._currentTab = tab;
    try { localStorage.setItem('dxy_tab', tab); } catch (e) { /* ignore */ }
    document.querySelectorAll('.panel').forEach(p => {
      p.classList.toggle('active', p.dataset.panel === tab);
    });
    // 切换时刷新数据
    this.refreshAll();
  },

  // === HUD 更新 ===
  _bindHUD() {
    // 突破按钮统一走事件委托（data-action="breakthrough"），此处不再单独绑定，
    // 避免「id 监听 + 委托」双重触发导致成功后立即弹出"修为未达上限"。
  },

  refreshHUD() {
    const s = GameEngine.state;
    const cap = calcQ(s.realm, s.level, 1.0);
    const pct = Math.min(s.cultivation / cap * 100, 100);
    const cache = this._hudCache || (this._hudCache = {});

    // 只在值变化时写 DOM（每帧调用也不产生无谓的布局失效）
    const setText = (id, val) => {
      if (cache[id] === val) return null;
      cache[id] = val;
      const el = document.getElementById(id);
      if (el) el.textContent = val;
      return el;
    };

    // 境界
    const realmText = `${GameConfig.realmNames[s.realm - 1]} ${s.level}层`;
    setText('hud-realm', realmText);

    // 修为条：宽度用 1 位小数，文本带百分比
    const fillPct = pct.toFixed(1);
    if (cache._fill !== fillPct) {
      cache._fill = fillPct;
      const fill = document.getElementById('cultivation-fill');
      if (fill) fill.style.width = fillPct + '%';
    }
    setText('cultivation-text',
      `${Math.floor(s.cultivation)} / ${Math.floor(cap)} · ${Math.floor(pct)}%`);

    // 突破按钮
    const canBT = GameEngine.canBreakthrough;
    if (cache._canBT !== canBT) {
      cache._canBT = canBT;
      const btn = document.getElementById('btn-breakthrough');
      if (btn) btn.hidden = !canBT;
    }

    // 丹药加持
    if (cache._pill !== s.pillBoost) {
      cache._pill = s.pillBoost;
      const p = document.getElementById('hud-pill-boost');
      if (p) p.hidden = !s.pillBoost;
    }

    // 资源：变化时写值，并让该格轻跳一下
    const bump = (id, val) => {
      const el = setText(id, val);
      if (el && el.parentElement) {
        const chip = el.parentElement;
        chip.classList.remove('bump');
        void chip.offsetWidth;
        chip.classList.add('bump');
      }
    };
    bump('res-stone', s.stone);
    bump('res-herb', s.herb);
    bump('res-ore', s.ore);
    bump('res-dew', s.dew);
    // 丹药分开计：聚气 / 破障（合显会让玩家在突破时无从判断是否有破障丹）
    bump('res-pill', s.cultivationPill || 0);
    bump('res-pill-po', s.breakthroughPill || 0);
  },

  // === 小院场景交互 ===
  _bindYardScene() {
    // 角色点击 → 打开修炼面板
    document.getElementById('character').addEventListener('click', () => {
      this.showTab('cultivation');
    });

    // 炼丹炉 → 打开炼丹面板
    document.getElementById('furnace').addEventListener('click', () => {
      this.showTab('alchemy');
    });

    // 打坐台 → 长按打坐
    const pad = document.getElementById('meditation-pad');
    const startMeditate = (e) => {
      e.preventDefault();
      GameEngine.startMeditation();
    };
    const stopMeditate = () => GameEngine.stopMeditation();

    pad.addEventListener('touchstart', startMeditate, { passive: false });
    pad.addEventListener('touchend', stopMeditate);
    pad.addEventListener('mousedown', startMeditate);
    pad.addEventListener('mouseup', stopMeditate);
    pad.addEventListener('mouseleave', stopMeditate);

    // 练剑桩 → 单击出剑，按住连发
    this._bindStrike(document.getElementById('sword-dummy'));
  },

  /**
   * 统一的「出剑」交互：轻点出一剑，按住 0.38s 后每 0.2s 连发。
   * 场景里的练剑桩与面板里的练剑按钮共用，避免两套绑定逻辑漂移。
   * 连发结束时浏览器仍会补一个 click，用 _strikeSuppress 吞掉，防止多算一剑。
   */
  _bindStrike(el) {
    if (!el || el._strikeBound) return;
    el._strikeBound = true;

    let holdTimer = null;
    let repeatTimer = null;
    let suppressed = false;

    const strike = () => {
      const gain = GameEngine.swordStrike();
      this._showFloatingText(`+${Math.round(gain)}`, el.id || 'sword-dummy');
    };

    const stopRepeat = () => {
      clearTimeout(holdTimer);
      clearInterval(repeatTimer);
      holdTimer = repeatTimer = null;
      el.classList.remove('holding');
    };

    el.addEventListener('click', () => {
      if (suppressed) { suppressed = false; return; }
      strike();
    });

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      stopRepeat();
      holdTimer = setTimeout(() => {
        el.classList.add('holding');
        repeatTimer = setInterval(strike, GameConfig.swordHoldInterval);
        suppressed = true;
      }, GameConfig.swordHoldDelay);
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
      el.addEventListener(ev, stopRepeat));
  },

  // === 灵田面板 ===
  _bindFarming() {
    // 作物选择
    document.querySelectorAll('.crop-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.crop-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this._selectedCrop = btn.dataset.crop;
      });
    });
    // 默认选中第一种
    this._selectedCrop = GameConfig.crops[0].id;
    document.querySelector('.crop-btn')?.classList.add('selected');
  },

  refreshFarming(force) {
    const container = document.getElementById('plots-list');
    if (!container) return;

    // 数据签名：地块状态 + 浇水 + 进度(5%档) + 选中作物
    const sig = GameEngine.state.plots.slice(0, GameEngine.unlockedPlots).map(p =>
      `${p.state}|${p.cropId || ''}|${p.watered ? 1 : 0}|${Math.floor((p.growthProgress / (p.growthTime || 1)) * 20)}`
    ).join(',') + '#' + this._selectedCrop;

    if (!force && !this._sigChanged('farming', sig)) return;

    container.innerHTML = '';

    for (let i = 0; i < GameEngine.unlockedPlots; i++) {
      const plot = GameEngine.state.plots[i];
      const card = document.createElement('div');
      card.className = 'plot-card';

      let stateText = '空闲';
      let progress = 0;
      let btnText = '播种';
      let btnAction = 'plant';

      if (plot.state === 'growing') {
        const crop = GameConfig.crops.find(c => c.id === plot.cropId);
        stateText = `${crop?.name || '生长中'}${plot.watered ? ' · 已浇水' : ''}`;
        progress = plot.growthProgress / plot.growthTime * 100;
        btnText = '浇水';
        btnAction = 'water';
      } else if (plot.state === 'ready') {
        const crop = GameConfig.crops.find(c => c.id === plot.cropId);
        stateText = `${crop?.name || '作物'} 可收获`;
        progress = 100;
        btnText = '收获';
        btnAction = 'harvest';
      }

      card.innerHTML = `
        <div class="plot-name">地块 ${i + 1}</div>
        <div class="plot-state">${stateText}</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
        <button class="btn-action" data-action="${btnAction}" data-index="${i}" style="padding:8px 12px;min-height:40px">${btnText}</button>
      `;
      container.appendChild(card);
    }
  },

  // === 小院场景内的灵田地块（可视区，可直接点击）===
  refreshYardPlots(force) {
    const box = document.getElementById('plots');
    if (!box) return;

    const sig = GameEngine.state.plots.slice(0, GameEngine.unlockedPlots).map(p =>
      `${p.state}|${Math.floor((p.growthProgress / (p.growthTime || 1)) * 20)}`
    ).join(',');

    if (!force && !this._sigChanged('yardPlots', sig)) return;

    box.innerHTML = '';
    for (let i = 0; i < GameEngine.unlockedPlots; i++) {
      const p = GameEngine.state.plots[i];
      const el = document.createElement('div');
      el.className = 'plot ' + p.state;
      const progress = p.state === 'growing'
        ? Math.floor(p.growthProgress / (p.growthTime || 1) * 100)
        : (p.state === 'ready' ? 100 : 0);
      el.innerHTML = `<span>${p.state === 'ready' ? '✨' : (p.state === 'growing' ? '🌱' : '＋')}</span>
        <span class="plot-status">${p.state === 'empty' ? '空地' : progress + '%'}</span>`;
      // 点击：空地→播种；生长中→浇水；成熟→收获
      const act = p.state === 'empty' ? 'plant' : (p.state === 'growing' ? 'water' : 'harvest');
      el.dataset.action = act;
      el.dataset.index = String(i);
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', `地块${i + 1} ${p.state === 'empty' ? '空地' : p.state === 'growing' ? '生长中' : '可收获'}`);
      box.appendChild(el);
    }
  },

  // === 集市（灵石 ↔ 材料 / 开垦）===
  refreshShop(force) {
    const grid = document.getElementById('shop-grid');
    if (!grid) return;

    const st = GameEngine.state;
    // 灵石数字：只在真的变了才写，否则 10Hz 刷新会持续产生字符节点变更
    const stoneEl = document.getElementById('shop-stone');
    if (stoneEl && stoneEl.textContent !== String(st.stone)) stoneEl.textContent = st.stone;

    const sig = [
      st.stone, st.herb, st.ore, st.dew, GameEngine.unlockedPlots,
    ].join('|');
    if (!force && !this._sigChanged('shop', sig)) return;

    const rows = [];

    // 卖出
    GameConfig.shop.sell.forEach((o, i) => {
      const enough = (st[o.id] || 0) >= o.amount;
      rows.push(`
        <button class="shop-row ${enough ? '' : 'is-disabled'}"
                data-action="sell" data-index="${i}" ${enough ? '' : 'disabled'}>
          <span class="shop-name">卖 ${o.name}×${o.amount}</span>
          <span class="shop-price">+${o.price}</span>
        </button>`);
    });

    // 买入
    GameConfig.shop.buy.forEach((o, i) => {
      const afford = st.stone >= o.price;
      rows.push(`
        <button class="shop-row ${afford ? '' : 'is-disabled'}"
                data-action="buy" data-index="${i}" ${afford ? '' : 'disabled'}>
          <span class="shop-name">买 ${o.name}×${o.amount}</span>
          <span class="shop-price">−${o.price}</span>
        </button>`);
    });

    // 开垦
    const cost = GameEngine.nextPlotCost;
    if (cost === null) {
      rows.push(`<div class="shop-row is-done"><span class="shop-name">灵田已开满</span><span class="shop-price">${GameEngine.unlockedPlots}/${GameConfig.maxPlots}</span></div>`);
    } else {
      const afford = st.stone >= cost;
      rows.push(`
        <button class="shop-row shop-row--expand ${afford ? '' : 'is-disabled'}"
                data-action="expand" ${afford ? '' : 'disabled'}>
          <span class="shop-name">开垦第 ${GameEngine.unlockedPlots + 1} 块田</span>
          <span class="shop-price">−${cost}</span>
        </button>`);
    }

    grid.innerHTML = rows.join('');
  },

  // === 炼丹面板 ===
  _bindAlchemy() {
    // 配方按钮在 refreshAlchemy 中动态创建
  },

  refreshAlchemy(force) {
    // 配方列表
    const list = document.getElementById('recipe-list');
    if (!list) return;

    // 签名：队列内容（含剩余秒数取整）+ 材料是否够
    const q = GameEngine.state.craftingQueue;
    const sig = q.map(j => `${j.recipeId}:${Math.ceil(j.timeRemaining)}`).join(',')
      + '#' + (GameEngine.state.herb >= 5 ? 1 : 0) + (GameEngine.state.dew >= 1 ? 1 : 0);

    if (!force && !this._sigChanged('alchemy', sig)) return;

    list.innerHTML = '';

    GameConfig.recipes.forEach(recipe => {
      const card = document.createElement('div');
      card.className = 'recipe-card';

      const costParts = [];
      costParts.push(`<span class="cost"><svg class="ico ico--herb"><use href="#i-herb"/></svg>${recipe.herbCost}</span>`);
      costParts.push(`<span class="cost"><svg class="ico ico--dew"><use href="#i-dew"/></svg>${recipe.dewCost}</span>`);
      if (recipe.oreCost > 0) costParts.push(`<span class="cost"><svg class="ico ico--ore"><use href="#i-ore"/></svg>${recipe.oreCost}</span>`);

      card.innerHTML = `
        <div class="recipe-info">
          <div class="recipe-name">${recipe.name}</div>
          <div class="recipe-cost"><span class="cost-label">材料</span>${costParts.join('')}</div>
          <div class="recipe-time"><svg class="ico"><use href="#i-time"/></svg>${recipe.craftTime} 秒</div>
        </div>
        <button class="btn-craft" data-action="craft" data-id="${recipe.id}">开炼</button>
      `;
      list.appendChild(card);
    });

    // 炼制队列
    const queue = document.getElementById('craft-queue');
    if (!queue) return;
    queue.innerHTML = '';

    if (GameEngine.state.craftingQueue.length > 0) {
      const title = document.createElement('h3');
      title.textContent = '炼制中';
      title.style.margin = '12px 0 8px';
      title.style.fontSize = 'var(--font-sm)';
      queue.appendChild(title);

      GameEngine.state.craftingQueue.forEach(job => {
        const recipe = GameConfig.recipes.find(r => r.id === job.recipeId);
        const item = document.createElement('div');
        item.className = 'craft-item';
        item.innerHTML = `
          <span>${recipe?.name || job.recipeId}</span>
          <span>${Math.ceil(job.timeRemaining)}s</span>
          <button class="btn-craft" data-action="accelerate" data-id="${job.recipeId}" style="padding:4px 8px;font-size:0.75rem;min-height:32px">加速</button>
        `;
        queue.appendChild(item);
      });
    }
  },

  // === 修炼面板 ===
  _bindCultivation() {
    const meditateBtn = document.getElementById('btn-meditate');
    const swordBtn = document.getElementById('btn-sword');

    // 打坐按钮（长按）
    const startMed = (e) => { e.preventDefault(); GameEngine.startMeditation(); };
    const stopMed = () => GameEngine.stopMeditation();
    meditateBtn.addEventListener('touchstart', startMed, { passive: false });
    meditateBtn.addEventListener('touchend', stopMed);
    meditateBtn.addEventListener('mousedown', startMed);
    meditateBtn.addEventListener('mouseup', stopMed);
    meditateBtn.addEventListener('mouseleave', stopMed);

    // 练剑按钮（单击出剑 / 按住连发，与场景练剑桩共用一套逻辑）
    this._bindStrike(swordBtn);
  },

  refreshCultivation() {
    const s = GameEngine.state;
    const cache = this._cvCache || (this._cvCache = {});

    // 只在值变化时写 DOM：此方法每 100ms 被调用一次，无谓写入会持续触发样式重算
    const put = (id, val) => {
      if (cache[id] === val) return;
      cache[id] = val;
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    // 属性
    put('stat-sense', s.spiritSense);
    put('stat-hp', s.health);
    put('stat-mana', s.mana);

    // 突破信息：小阶只需修为与属性，跨大境界才需破障丹
    const thresholds = getStatThresholds(s.realm);
    const canBT = GameEngine.canBreakthrough;
    const needPill = s.level >= 9;
    let reqText;
    if (canBT) {
      const pillPart = needPill
        ? ` · 破障丹 ${s.breakthroughPill}/1${s.breakthroughPill >= 1 ? ' ✓' : ' ✗'}`
        : '';
      reqText = `✅ 修为已满，可突破！需 神识${thresholds.sense} 血量${thresholds.hp} 法力${thresholds.mana}${pillPart}`;
    } else {
      reqText = `还需修为 ${Math.ceil(calcQ(s.realm, s.level, 1.0) - s.cultivation)} 点`;
    }
    put('breakthrough-req', reqText);

    // 丹房：库存 / 按钮可用性 / 加持倒计时
    const cap = calcQ(s.realm, s.level, 1.0);
    const pill = s.cultivationPill || 0;
    put('pill-qiju', pill);
    put('pill-po', s.breakthroughPill || 0);

    const full = s.cultivation >= cap;
    const useHint = full
      ? '修为已满'
      : `+${Math.max(1, Math.ceil(cap * GameConfig.pillInstantPct))} 修为`;
    put('pill-use-hint', useHint);

    const useBtn = document.getElementById('btn-use-pill');
    if (useBtn && cache._useDis !== (pill < 1 || full)) {
      cache._useDis = (pill < 1 || full);
      useBtn.disabled = cache._useDis;
      useBtn.classList.toggle('is-off', cache._useDis);
    }
    const boostBtn = document.getElementById('btn-pill-boost');
    const boostOff = pill < 1 || !!s.pillBoost;
    if (boostBtn && cache._boostDis !== boostOff) {
      cache._boostDis = boostOff;
      boostBtn.disabled = boostOff;
      boostBtn.classList.toggle('is-off', boostOff);
    }

    const bar = document.getElementById('pill-boost-bar');
    if (bar) {
      if (s.pillBoost) {
        const left = Math.max(0, s.pillBoostRemaining || 0);
        const pct2 = (left / GameConfig.pillDuration * 100).toFixed(1);
        const mm = String(Math.floor(left / 60)).padStart(2, '0');
        const ss = String(Math.floor(left % 60)).padStart(2, '0');
        if (cache._boostPct !== pct2) {
          cache._boostPct = pct2;
          const fill = document.getElementById('pill-boost-fill');
          if (fill) fill.style.width = pct2 + '%';
        }
        put('pill-boost-text', `加持中 ×${GameConfig.pillBoostMult} · 余 ${mm}:${ss}`);
        if (bar.hidden) bar.hidden = false;
      } else if (!bar.hidden) {
        bar.hidden = true;
      }
    }

    // 轮回区块（签名门控）
    const dao = GameEngine.state.dao || 0;
    const total = Math.floor((GameEngine.state.totalCultivation || 0) / 10) * 10;
    const canReb = GameEngine.canRebirth;
    const rebSig = `${dao}|${canReb ? 1 : 0}|${total}`;
    if (this._rebSig !== rebSig) {
      this._rebSig = rebSig;
      const daoEl = document.getElementById('dao-value');
      if (daoEl) daoEl.textContent = dao;
      const descEl = document.getElementById('rebirth-desc');
      const btnEl = document.getElementById('btn-rebirth');
      if (descEl) {
        descEl.textContent = canReb
          ? `本次可得道行 +${GameEngine.rebirthDaoGain}（重置境界与资源，保留功法与宠物）`
          : `渡劫 9 层且修为圆满后可入轮回；本轮累计修为 ${total}`;
      }
      if (btnEl) btnEl.hidden = !canReb;
    }

    // 入定倍率：面板内一行 + 人物名牌同步显示（视线不必离开场景）
    const depthEl = document.getElementById('meditate-depth');
    const moodEl = document.querySelector('.char-mood');
    if (GameEngine._isMeditating) {
      const label = `入定 ×${GameEngine.meditateMultiplier.toFixed(1)}`;
      if (depthEl) {
        if (depthEl.hidden) depthEl.hidden = false;       // 写 hidden 前先判，避免无谓的 attribute 变更
        if (depthEl.textContent !== label) depthEl.textContent = label;
      }
      if (moodEl && moodEl.textContent !== label) moodEl.textContent = label;
    } else {
      if (depthEl && !depthEl.hidden) depthEl.hidden = true;
    }

    // 连击显示
    const comboEl = document.getElementById('combo-display');
    const comboCount = document.getElementById('combo-count');
    if (GameEngine._swordCombo > 0) {
      if (comboEl && comboEl.hidden) comboEl.hidden = false;
      if (comboCount && comboCount.textContent !== String(GameEngine._swordCombo)) {
        comboCount.textContent = GameEngine._swordCombo;
      }
    } else {
      if (comboEl && !comboEl.hidden) comboEl.hidden = true;
    }
  },

  // === 系统面板 ===
  _bindSystem() {
    document.getElementById('btn-save').addEventListener('click', () => {
      // 手动存档视为玩家明确选择"以本页为准"，重新夺回写入权
      SaveSystem.reclaimWriter();
      SaveSystem.save(GameEngine.state);
      this.showToast('进度已保存');
    });

    document.getElementById('btn-load').addEventListener('click', () => {
      const data = SaveSystem.load();
      if (data) {
        GameEngine.state = data;
        PetSystem.init();
        TechniqueSystem.init();
        DailyGoals.init();
        this._hudCache = {};
        this._cvCache = {};
        this.showToast('存档已加载');
        this.refreshAll(true);
      } else {
        this.showToast('没有找到存档');
      }
    });

    document.getElementById('btn-export').addEventListener('click', () => {
      SaveSystem.exportFile(GameEngine.state);
      this.showToast('存档已导出');
    });

    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });

    document.getElementById('import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        SaveSystem.importFile(file, (data, err) => {
          e.target.value = '';            // 允许重复选同一个文件
          if (!data) {
            this.showToast(err || '导入失败');
            return;
          }
          GameEngine.state = data;
          // 宠物/功法/日常已由 SaveSystem 写回 localStorage，需重新装载内存态
          PetSystem.init();
          TechniqueSystem.init();
          DailyGoals.init();
          this._hudCache = {};
          this._cvCache = {};
          this.showToast('存档已导入');
          this.refreshAll(true);
        });
      }
    });
  },

  // === 弹窗 ===
  _bindModals() {
    document.getElementById('modal-close').addEventListener('click', () => {
      document.getElementById('modal-overlay').hidden = true;
    });
    // 点击遮罩层关闭弹窗
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        e.currentTarget.hidden = true;
      }
    });

    document.getElementById('offline-close').addEventListener('click', () => {
      this._claimOfflineGains();
      document.getElementById('offline-overlay').hidden = true;
    });
    document.getElementById('offline-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        this._claimOfflineGains();
        e.currentTarget.hidden = true;
      }
    });

    // 访客弹窗遮罩关闭
    document.getElementById('visitor-overlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        VisitorSystem.dismiss();
        e.currentTarget.hidden = true;
      }
    });

    // 访客「送客」按钮（放在此处统一绑定，避免依赖 app.js 的调用顺序）
    document.getElementById('visitor-dismiss')?.addEventListener('click', () => {
      VisitorSystem.dismiss();
      document.getElementById('visitor-overlay').hidden = true;
    });
  },

  // === 事件委托层（核心修复：动态按钮不再逐个绑定）===
  _bindDelegatedEvents() {
    const handleAction = (e, btn) => {
      const action = btn.dataset.action;
      // parseInt(undefined) 返回 NaN，`?? -1` 无法兜住 NaN，需显式判断
      const rawIndex = parseInt(btn.dataset.index, 10);
      const index = Number.isNaN(rawIndex) ? -1 : rawIndex;
      const id = btn.dataset.id || '';

      switch (action) {
        // 灵田
        case 'plant': {
          if (GameEngine.plant(index, this._selectedCrop)) {
            this.showToast('播种成功');
            this._needsFullRebuild = true;
          }
          break;
        }
        case 'water': {
          if (GameEngine.water(index)) {
            this.showToast('已浇水');
            this._needsFullRebuild = true;
          }
          break;
        }
        case 'harvest': {
          const harvested = GameEngine.harvest(index);
          if (harvested > 0) this.showToast(`收获灵草 ×${harvested}`);
          this._needsFullRebuild = true;
          break;
        }

        // 一键收获
        case 'harvest-all': {
          const r = GameEngine.harvestAll();
          if (r.count > 0) {
            this.showToast(`收获 ${r.count} 块地，灵草 +${r.total}`);
            SoundFX.play('harvest'); Haptic.success();
          } else {
            this.showToast('还没成熟的地块');
          }
          this._needsFullRebuild = true;
          break;
        }

        // 集市卖出 / 买入
        case 'sell': {
          const r = GameEngine.sellOffer(index);
          this.showToast(r.ok ? '成交' : r.msg);
          if (r.ok) {
            SoundFX.play('harvest'); Haptic.light();
            DailyGoals.increment('sell');
            this._needsFullRebuild = true;
          }
          break;
        }
        case 'buy': {
          const r = GameEngine.buyOffer(index);
          this.showToast(r.ok ? '已入库' : r.msg);
          if (r.ok) { SoundFX.play('click'); this._needsFullRebuild = true; }
          break;
        }

        // 开垦新田
        case 'expand': {
          const r = GameEngine.buyPlot();
          this.showToast(r.ok ? '开垦成功' : r.msg);
          if (r.ok) { SoundFX.play('craft_done'); Haptic.medium(); this._needsFullRebuild = true; }
          break;
        }

        // 炼丹
        case 'craft': {
          if (GameEngine.startCraft(id)) {
            this.showToast('开始炼制');
            this._needsFullRebuild = true;
          }
          break;
        }
        case 'accelerate': {
          if (GameEngine.accelerateCraft(id)) {
            this.showToast('已加速');
            this._needsFullRebuild = true;
          }
          break;
        }

        // 日常目标
        case 'claim-daily': {
          if (DailyGoals.claim(index)) {
            SoundFX.play('harvest');
            Haptic.success();
            this.showToast('奖励已领取');
            this._needsFullRebuild = true;
          }
          break;
        }

        // 宠物
        case 'adopt-pet': {
          if (PetSystem.adopt(id)) {
            this.showToast(`成功领养！`);
            SoundFX.play('harvest');
            Haptic.success();
            this._needsFullRebuild = true;
          }
          break;
        }
        case 'activate-pet': {
          PetSystem.setActive(id);
          this.showToast('宠物出战！');
          this._needsFullRebuild = true;
          break;
        }
        case 'upgrade-pet': {
          if (PetSystem.upgrade(id)) {
            this.showToast('宠物升级！');
            SoundFX.play('craft_done');
            Haptic.medium();
            this._needsFullRebuild = true;
          }
          break;
        }

        // 功法
        case 'learn-tech': {
          if (TechniqueSystem.learn(id)) {
            this.showToast('学会功法！');
            SoundFX.play('breakthrough');
            Haptic.success();
            this._needsFullRebuild = true;
          }
          break;
        }

        // 访客选项
        case 'visitor-option': {
          const result = VisitorSystem.chooseOption(index);
          if (result && result.success) {
            SoundFX.play('harvest');
            Haptic.success();
            const respEl = document.getElementById('visitor-response');
            if (respEl) {
              respEl.textContent = result.message;
              respEl.hidden = false;
            }
            const optEl = document.getElementById('visitor-options');
            if (optEl) optEl.style.display = 'none';
            setTimeout(() => {
              const overlay = document.getElementById('visitor-overlay');
              if (overlay) overlay.hidden = true;
              this._needsFullRebuild = true;
            }, 2500);
          } else {
            this.showToast(result?.message || '操作失败');
            SoundFX.play('deny');
          }
          break;
        }

        // 入轮回
        case 'rebirth': {
          const r = GameEngine.rebirth();
          if (r.ok) {
            this._hudCache = {};
            this._needsFullRebuild = true;
            this.showToast(`轮回成功，道行 +${r.gain}`);
            SoundFX.play('breakthrough'); Haptic.heavy();
            if (typeof CharacterVoice !== 'undefined') CharacterVoice.say('rebirth', 400);
          } else {
            this.showToast(r.msg);
          }
          break;
        }

        // 丹房：服丹（即时修为）
        case 'use-pill': {
          const cap0 = calcQ(GameEngine.state.realm, GameEngine.state.level, 1.0);
          const before = GameEngine.state.cultivation;
          if (GameEngine.state.cultivation >= cap0) {
            this.showToast('修为已满，先突破');
            SoundFX.play('deny');
            break;
          }
          if (GameEngine.useCultivationPill()) {
            const got = Math.round(GameEngine.state.cultivation - before);
            this.showToast(`服下聚气丹，修为 +${got}`);
            this._showFloatingText(`+${got}`, 'character');
            SoundFX.play('craft_done');
            Haptic.light();
            if (typeof CharacterVoice !== 'undefined') CharacterVoice.say('pill', 150);
            this._hudCache = {};
          } else {
            this.showToast('聚气丹不足');
            SoundFX.play('deny');
          }
          this._needsFullRebuild = true;
          break;
        }

        // 丹房：丹药加持（限时速率翻倍）
        case 'pill-boost': {
          if (GameEngine.state.pillBoost) {
            this.showToast('加持已在进行中');
            break;
          }
          if (GameEngine.activatePillBoost()) {
            this.showToast(`加持生效，修炼速率 ×${GameConfig.pillBoostMult}（1 时辰）`);
            SoundFX.play('breakthrough');
            Haptic.success();
            if (typeof CharacterVoice !== 'undefined') CharacterVoice.say('boost', 150);
            this._hudCache = {};
          } else {
            this.showToast('聚气丹不足');
            SoundFX.play('deny');
          }
          this._needsFullRebuild = true;
          break;
        }

        // 突破
        case 'breakthrough': {
          const btResult = GameEngine.tryBreakthrough();
          if (btResult.success) {
            this.showBreakthroughFX();
            const s = GameEngine.state;
            this.showToast(`突破成功！${GameConfig.realmNames[s.realm - 1]} ${s.level}层`);
          } else {
            this.showToast(btResult.reason);
          }
          this._needsFullRebuild = true;
          break;
        }
      }
    };

    // 鼠标/触摸点击
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      handleAction(e, btn);
    });

    // 键盘可访问性：Enter / Space 触发
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.preventDefault();
      handleAction(e, btn);
    });
  },

  showModal(title, bodyHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-overlay').hidden = false;
  },

  showOfflineGains(gains) {
    if (!gains) return;
    // 180 分钟这种读法不直观，超过 1 小时按 时/分 拆开
    const totalMin = Math.floor(gains.elapsedSeconds / 60);
    const hh = Math.floor(totalMin / 60);
    const mm = totalMin % 60;
    const durationText = hh > 0
      ? `${hh} 小时${mm > 0 ? ` ${mm} 分钟` : ''}`
      : `${mm} 分钟`;
    document.getElementById('offline-time').textContent = durationText;
    const capNote = gains.capped
      ? `<p class="offline-cap-note">已按离线结算上限 ${gains.capHours} 小时封顶</p>`
      : '';
    document.getElementById('offline-gains').innerHTML = `
      <div class="gain-row"><span>修为</span><b>+${Math.floor(gains.cultivation)}</b></div>
      <div class="gain-row"><span>灵草</span><b>+${gains.herb}</b></div>
      <div class="gain-row"><span>矿石</span><b>+${gains.ore}</b></div>
      <div class="gain-row"><span>凝露</span><b>+${gains.dew}</b></div>
      ${capNote}
    `;
    document.getElementById('offline-overlay').hidden = false;
    this._pendingOfflineGains = gains;
  },

  _claimOfflineGains() {
    const gains = this._pendingOfflineGains;
    if (!gains) return;

    const s = GameEngine.state;
    const cap = calcQ(s.realm, s.level, 1.0);
    s.cultivation = Math.min(s.cultivation + gains.cultivation, cap);
    s.herb = Math.min(s.herb + gains.herb, GameConfig.resourceHardCap);
    s.ore = Math.min(s.ore + gains.ore, GameConfig.resourceHardCap);
    s.dew = Math.min(s.dew + gains.dew, GameConfig.resourceHardCap);

    this._pendingOfflineGains = null;
    this.showToast('离线收益已领取');
    this.refreshAll();
  },

  // === 突破特效 ===
  showBreakthroughFX() {
    const fx = document.getElementById('breakthrough-fx');
    fx.hidden = false;
    setTimeout(() => { fx.hidden = true; }, 1200);
  },

  // === Toast ===
  showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.hidden = false;
    // 重新触发动画
    toast.style.animation = 'none';
    toast.offsetHeight; // reflow
    toast.style.animation = '';

    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { toast.hidden = true; }, 2500);
  },

  // === 浮动文字 ===
  _showFloatingText(text, targetId) {
    const target = document.getElementById(targetId);
    if (!target) return;
    const rect = target.getBoundingClientRect();

    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `
      position: fixed; left: ${rect.left + rect.width / 2}px; top: ${rect.top}px;
      color: var(--color-accent); font-weight: 700; font-size: 1.125rem;
      pointer-events: none; z-index: 999;
      animation: float-up 1s ease forwards;
    `;

    // 添加动画
    if (!document.getElementById('float-up-style')) {
      const style = document.createElement('style');
      style.id = 'float-up-style';
      style.textContent = `
        @keyframes float-up {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-40px) scale(1.2); }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  },

  // === 全量刷新 ===
  refreshAll() {
    this.refreshHUD();
    this.refreshFarming();
    this.refreshAlchemy();
    this.refreshCultivation();
  },
};

// ============================
// 日常目标 UI（S9）
// ============================
UI._bindDaily = function() {
  // 已在 init 中注册到 showTab
};

UI.refreshDaily = function(force) {
  const container = document.getElementById('daily-list');
  if (!container) return;

  const cache = this._dailyCache || (this._dailyCache = {});

  // 徽标：只有可领数量变化时才动 DOM
  const claimable = DailyGoals.claimableCount;
  if (cache.claimable !== claimable) {
    cache.claimable = claimable;
    const badge = document.getElementById('daily-badge');
    if (badge) {
      badge.hidden = claimable === 0;
      badge.textContent = claimable;
    }
  }

  // 标题汇总：今日已完成 x/3
  const all0 = DailyGoals.getAll();
  const done = all0.filter(g => g.claimed).length;
  const countText = ` ${done}/${all0.length}`;
  if (cache.countText !== countText) {
    cache.countText = countText;
    const countEl = document.getElementById('daily-count');
    if (countEl) countEl.textContent = countText;
  }

  // 签名：目标进度 + 完成/领取状态
  const sig = DailyGoals.getAll().map(g => `${g.progress}|${g.completed ? 1 : 0}|${g.claimed ? 1 : 0}`).join(',');
  if (!force && !this._sigChanged('daily', sig)) return;

  container.innerHTML = '';

  const goals = DailyGoals.getAll();
  goals.forEach((goal, index) => {
    const card = document.createElement('div');
    card.className = 'daily-card' + (goal.completed ? ' completed' : '');

    const pct = Math.min(goal.progress / goal.target * 100, 100);
    const unit = goal.unit || '次';
    const progressText = goal.completed
      ? '✅ 已完成'
      : `${goal.progress} / ${goal.target} ${unit}`;

    let btnHtml = '<button class="daily-claim-btn" disabled>进行中</button>';
    if (goal.completed && !goal.claimed) {
      btnHtml = `<button class="daily-claim-btn" data-action="claim-daily" data-index="${index}">领取</button>`;
    } else if (goal.claimed) {
      btnHtml = '<button class="daily-claim-btn" disabled>已领</button>';
    }

    const g = GLYPH[goal.type];
    const iconHtml = g
      ? `<svg class="ico"><use href="#${g.id}"/></svg>`
      : '<svg class="ico"><use href="#i-cultivate"/></svg>';
    const iconCls = g ? `daily-icon ${g.cls}` : 'daily-icon';

    card.innerHTML = `
      <div class="${iconCls}">${iconHtml}</div>
      <div class="daily-info">
        <div class="daily-name">${goal.name}</div>
        <div class="daily-progress-text">${progressText} · 奖励：修为+${goal.reward}</div>
        <div class="daily-bar"><div class="daily-bar-fill" style="width:${pct}%"></div></div>
      </div>
      ${btnHtml}
    `;
    container.appendChild(card);
  });
};

// ============================
// 访客 UI（S13）
// ============================
// 送客按钮已在 _bindModals 中统一绑定，此方法保留为空实现以兼容旧调用。
UI._bindVisitor = function() {
  /* no-op: 绑定已收敛到 _bindModals，避免重复绑定 */
};

UI.showVisitor = function(visitor) {
  if (!visitor) return;

  SoundFX.play('visitor');
  Haptic.medium();

  document.getElementById('visitor-icon').textContent = visitor.icon;
  document.getElementById('visitor-name').textContent = visitor.name;
  document.getElementById('visitor-greeting').textContent = visitor.greeting;
  document.getElementById('visitor-response').hidden = true;

  const optionsContainer = document.getElementById('visitor-options');
  optionsContainer.innerHTML = '';

  visitor.options.forEach((option, index) => {
    const btn = document.createElement('button');
    btn.className = 'visitor-option-btn';
    btn.textContent = option.label;
    btn.setAttribute('data-action', 'visitor-option');
    btn.setAttribute('data-index', index);
    optionsContainer.appendChild(btn);
  });

  optionsContainer.style.display = 'flex';
  document.getElementById('visitor-overlay').hidden = false;
};

// ============================
// 在主循环中检测访客
// ============================
UI._checkVisitor = function() {
  const visitor = VisitorSystem.trySpawn();
  if (visitor) {
    this.showVisitor(visitor);
  }
};

// ============================
// showTab（切换面板时强制刷新）
// ============================
const _baseShowTab = UI.showTab;
UI.showTab = function(tab) {
  _baseShowTab.call(this, tab);
  this._needsFullRebuild = true;
  this.refreshAll(true); // 强制重建
};

// ============================
// 音效/触觉 集成到现有交互
// ============================
const _originalToast = UI.showToast;
UI.showToast = function(msg) {
  _originalToast.call(this, msg);
  SoundFX.play('notification');
};

// 在突破时播放特效音
const _originalBT = UI.showBreakthroughFX;
UI.showBreakthroughFX = function() {
  _originalBT.call(this);
  SoundFX.play('breakthrough');
  Haptic.heavy();
};

// ============================
// 宠物 UI（S11）
// ============================
UI.refreshPets = function(force) {
  const container = document.getElementById('pet-list');
  if (!container) return;

  // 签名：拥有/等级/出战 + 境界 + 灵石是否够升级
  const pets = PetSystem.getAll();
  const sig = pets.map(p => `${p.isOwned ? 1 : 0}${p.level}${p.isActive ? 1 : 0}`).join('')
    + '#' + GameEngine.state.realm + '#' + (GameEngine.state.stone >= 100 ? 1 : 0);
  if (!force && !this._sigChanged('pets', sig)) return;

  container.innerHTML = '';

  pets.forEach(pet => {
    const card = document.createElement('div');
    card.className = 'pet-card' +
      (pet.isOwned ? '' : ' locked') +
      (pet.isActive ? ' active-pet' : '');

    let bonusText = '';
    if (pet.bonuses.cultivationRate) bonusText = `修为速率 +${(pet.bonuses.cultivationRate * 100).toFixed(0)}%`;
    else if (pet.bonuses.offlineCap) bonusText = `离线上限 +${pet.bonuses.offlineCap / 3600}h`;
    else if (pet.bonuses.herbBonus) bonusText = `灵草收获 +${(pet.bonuses.herbBonus * 100).toFixed(0)}%`;
    else if (pet.bonuses.visitorRate) bonusText = `访客频率 +${(pet.bonuses.visitorRate * 100).toFixed(0)}%`;

    // 构建按钮 HTML（data-action 委托）
    let btnsHtml = '';
    if (!pet.isOwned && pet.isUnlocked) {
      btnsHtml += `<button class="pet-btn adopt-btn" data-action="adopt-pet" data-id="${pet.id}">领养</button>`;
    }
    if (pet.isOwned && !pet.isActive) {
      btnsHtml += `<button class="pet-btn activate-btn" data-action="activate-pet" data-id="${pet.id}">出战</button>`;
    }
    if (pet.isOwned && pet.level < pet.maxLevel) {
      const cost = pet.upgradeCost * pet.level;
      const disabled = GameEngine.state.stone < cost ? 'disabled' : '';
      btnsHtml += `<button class="pet-btn upgrade-btn" data-action="upgrade-pet" data-id="${pet.id}" ${disabled}>升级 💎${cost}</button>`;
    }

    card.innerHTML = `
      <div class="pet-icon">${pet.icon}</div>
      <div class="pet-info">
        <div class="pet-name">${pet.name} ${pet.isActive ? '⭐出战中' : ''}</div>
        <div class="pet-desc">${pet.description}</div>
        ${pet.isOwned ? `<div class="pet-level">Lv.${pet.level} / ${pet.maxLevel}</div>` : ''}
        <div class="pet-bonus">${bonusText}</div>
        ${!pet.isUnlocked ? `<div class="pet-desc lock-line"><svg class="ico ico--sm"><use href="#i-lock"/></svg>需 ${GameConfig.realmNames[pet.unlockRealm - 1]} 境界解锁</div>` : ''}
      </div>
      <div class="pet-actions">${btnsHtml}</div>
    `;
    container.appendChild(card);
  });
};

// ============================
// 功法 UI（S10）
// ============================
UI.refreshTechniques = function(force) {
  const container = document.getElementById('tech-list');
  if (!container) return;

  // 签名：已学集合 + 境界 + 灵石是否够学
  const learned = Object.keys(TechniqueSystem._learned).sort().join('');
  const sig = learned + '#' + GameEngine.state.realm + '#' + (GameEngine.state.stone >= 50 ? 1 : 0);
  if (!force && !this._sigChanged('techniques', sig)) return;

  container.innerHTML = '';

  const techniques = TechniqueSystem.getAll();
  techniques.forEach(tech => {
    const card = document.createElement('div');
    card.className = 'tech-card' +
      (!tech.isUnlocked ? ' locked' : '') +
      (tech.isLearned ? ' learned' : '');

    const bonusTexts = [];
    if (tech.bonuses.cultivationRate) bonusTexts.push(`修为 +${(tech.bonuses.cultivationRate * 100).toFixed(0)}%`);
    if (tech.bonuses.swordGain) bonusTexts.push(`练剑 +${(tech.bonuses.swordGain * 100).toFixed(0)}%`);
    if (tech.bonuses.craftSpeed) bonusTexts.push(`炼丹 +${(tech.bonuses.craftSpeed * 100).toFixed(0)}%`);
    if (tech.bonuses.herbBonus) bonusTexts.push(`灵草 +${(tech.bonuses.herbBonus * 100).toFixed(0)}%`);

    // 学习按钮（data-action 委托）
    let btnHtml = '';
    if (tech.isUnlocked && !tech.isLearned) {
      const disabled = !tech.canAfford ? 'disabled' : '';
      btnHtml = `<button class="tech-learn-btn" data-action="learn-tech" data-id="${tech.id}" ${disabled}>学习</button>`;
    }

    const techGlyph = glyphSvg(tech.id) || '<svg class="ico"><use href="#i-tech"/></svg>';
    card.innerHTML = `
      <div class="tech-icon">${techGlyph}</div>
      <div class="tech-info">
        <div class="tech-name">${tech.name} ${tech.isLearned ? '✅' : ''}</div>
        <div class="tech-desc">${tech.description}</div>
        <div class="tech-bonuses">${bonusTexts.join(' · ')}</div>
        ${!tech.isUnlocked ? `<div class="tech-desc lock-line"><svg class="ico ico--sm"><use href="#i-lock"/></svg>需 ${GameConfig.realmNames[tech.unlockRealm - 1]} 境界</div>` : ''}
        ${!tech.isLearned && tech.isUnlocked ? `<div class="tech-cost">费用：💎 ${tech.cost} 灵石</div>` : ''}
      </div>
      ${btnHtml}
    `;
    container.appendChild(card);
  });
};

// ============================
// 天气更新
// ============================
UI.refreshWeather = function() {
  // 此方法每 100ms 被调用，签名字符串不变时直接返回，避免无谓的
  // textContent / setAttribute 写入触发样式重算
  const scene = document.getElementById('yard-scene');
  const h = WeatherSystem._gameHour;
  let phase = 'day';
  if (h < 6 || h >= 19) phase = 'night';
  else if (h < 10) phase = 'dawn';
  else if (h >= 17) phase = 'dusk';

  const sig = `${WeatherSystem.timeString}|${WeatherSystem.isNight ? 1 : 0}|${WeatherSystem.isRain ? 1 : 0}|${phase}`;
  if (this._weatherSig === sig) return;
  this._weatherSig = sig;

  // 时间文本
  const timeEl = document.getElementById('weather-time');
  if (timeEl) timeEl.textContent = WeatherSystem.timeString;

  // 日/月图标切换
  const useEl = document.querySelector('#weather-ico use');
  if (useEl) {
    useEl.setAttribute('href', WeatherSystem.isNight ? '#i-moon' : '#i-sun');
  }

  // 场景天空效果
  if (scene) {
    scene.classList.toggle('night', WeatherSystem.isNight);
    scene.classList.toggle('rain', WeatherSystem.isRain);

    // 时辰分段（供三峰气候使用：拂晓 / 白昼 / 黄昏 / 夜）
    if (scene.dataset.phase !== phase) scene.dataset.phase = phase;
  }
};

// ============================
// 统一 refreshAll（签名门控：内容不变则不重建 DOM，杜绝点击被吞）
// ============================
const _baseRefreshAll = UI.refreshAll;
UI.refreshAll = function(force) {
  // 轻量更新（只改文本/样式，不重建节点），每帧都可安全调用
  this.refreshHUD();
  this.refreshCultivation();
  this.refreshWeather();

  // 重面板：仅在数据签名变化或强制时重建
  const rebuild = force || this._needsFullRebuild;
  this._needsFullRebuild = false;

  this.refreshFarming(rebuild);
  this.refreshYardPlots(rebuild);
  this.refreshShop(rebuild);
  this.refreshAlchemy(rebuild);
  this.refreshDaily(rebuild);
  this.refreshPets(rebuild);
  this.refreshTechniques(rebuild);
};
