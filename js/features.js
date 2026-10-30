/**
 * 桌面修仙 · P1 特色系统
 * @trace MECH-009, MECH-010, MECH-013, MECH-014, AUD-002
 * 日常目标（S9）+ 访客系统（S13）+ 音效反馈 + 触觉反馈
 */

// ============================
// 日常目标系统（S9 / MECH-010）
// ============================
const DailyGoals = {
  _goals: [],
  _lastResetDate: '',

  // 任务池（4 类）
  _taskPool: [
    { id: 'plant_3',       type: 'farming',    name: '种植 3 株灵草',       target: 3,    reward: 20, icon: '🌱' },
    { id: 'harvest_3',     type: 'farming',    name: '收获 3 株灵草',       target: 3,    reward: 30, icon: '🌾' },
    { id: 'craft_1',       type: 'alchemy',    name: '炼制 1 炉丹药',       target: 1,    reward: 50, icon: '🔥' },
    { id: 'meditate_5',    type: 'cultivation', name: '打坐累计 5 分钟',    target: 300,  reward: 40, icon: '🧘', unit: '秒' },
    { id: 'sword_10',      type: 'cultivation', name: '练剑 10 次',         target: 10,   reward: 30, icon: '⚔️' },
    { id: 'breakthrough_1', type: 'cultivation', name: '突破 1 次',          target: 1,    reward: 100, icon: '⚡' },
    { id: 'sell_5',        type: 'economy',    name: '出售 5 份材料',       target: 5,    reward: 25, icon: '💰' },
    { id: 'collect_10',    type: 'economy',    name: '累计获得 10 灵石',   target: 10,   reward: 15, icon: '💎' },
  ],

  init() {
    // 检查是否需要刷新
    const today = new Date().toDateString();
    const saved = this._load();
    if (!saved || saved.date !== today) {
      this._reset(today);
    } else {
      this._goals = saved.goals;
      this._lastResetDate = saved.date;
    }
  },

  _reset(date) {
    // 从任务池随机抽 3 个
    const shuffled = [...this._taskPool].sort(() => Math.random() - 0.5);
    this._goals = shuffled.slice(0, 3).map(g => ({
      ...g,
      progress: 0,
      completed: false,
      claimed: false,
    }));
    this._lastResetDate = date;
    this._save();
    console.log('[DailyGoals] Reset for ' + date);
  },

  /** 记录进度 */
  increment(taskType, amount) {
    amount = amount || 1;
    this._goals.forEach(goal => {
      if (goal.type === taskType && !goal.completed) {
        goal.progress = Math.min(goal.progress + amount, goal.target);
        if (goal.progress >= goal.target) {
          goal.completed = true;
          GameEngine._emit('notification', `日常目标完成：${goal.name}`);
        }
      }
    });
    this._save();
  },

  /** 领取奖励 */
  claim(goalIndex) {
    const goal = this._goals[goalIndex];
    if (!goal || !goal.completed || goal.claimed) return false;
    goal.claimed = true;

    // 奖励修为
    const state = GameEngine.state;
    const cap = calcQ(state.realm, state.level, 1.0);
    state.cultivation = Math.min(state.cultivation + goal.reward, cap);

    this._save();
    return true;
  },

  /** 获取当前所有目标 */
  getAll() {
    return this._goals;
  },

  /** 已完成未领取数量 */
  get claimableCount() {
    return this._goals.filter(g => g.completed && !g.claimed).length;
  },

  _save() {
    try {
      localStorage.setItem('dxy_daily_goals', JSON.stringify({
        date: this._lastResetDate,
        goals: this._goals,
      }));
    } catch (e) { /* ignore */ }
  },

  _load() {
    try {
      const json = localStorage.getItem('dxy_daily_goals');
      return json ? JSON.parse(json) : null;
    } catch (e) { return null; }
  },
};

// ============================
// 访客系统（S13 / MECH-014）
// ============================
const VisitorSystem = {
  _currentVisitor: null,
  _lastVisitorDate: '',
  _visitorCount: 0,

  // 访客池
  _visitors: [
    {
      id: 'wandering_daoist',
      name: '云游道人',
      icon: '🧙',
      greeting: '道友有礼了，贫道云游至此，可否讨杯灵茶？',
      options: [
        { label: '交谈', action: 'talk', reward: { cultivation: 20 }, response: '修仙之道，贵在坚持。赠你几句心得。' },
        { label: '赠礼（-5灵草）', action: 'gift', cost: { herb: 5 }, reward: { dew: 3 }, response: '多谢道友！这几滴凝露聊表心意。' },
        { label: '买卖', action: 'trade', reward: { herb: 10 }, response: '贫道这里有些灵草，你且收下。' },
      ],
    },
    {
      id: 'sword_maiden',
      name: '剑修少女',
      icon: '👧',
      greeting: '哼！本姑娘路过此地，看你这小院倒也雅致。',
      options: [
        { label: '交谈', action: 'talk', reward: { cultivation: 30 }, response: '剑道无捷径，唯勤练尔。' },
        { label: '切磋练剑', action: 'spar', reward: { cultivation: 50 }, response: '你的剑法还需磨练，但根基不错！' },
        { label: '赠礼（-3灵草）', action: 'gift', cost: { herb: 3 }, reward: { stone: 20 }, response: '算你识趣！这些灵石拿去买糖吃。' },
      ],
    },
    {
      id: 'merchant',
      name: '行商老者',
      icon: '👴',
      greeting: '小友，老朽走南闯北，带了些稀罕物件，可要看看？',
      options: [
        { label: '交谈', action: 'talk', reward: { cultivation: 15 }, response: '生意人嘛，和气生财。' },
        { label: '购买矿石（-20灵石）', action: 'buy', cost: { stone: 20 }, reward: { ore: 5 }, response: '好嘞！矿石给你包好了。' },
        { label: '出售灵草（-10灵草）', action: 'sell', cost: { herb: 10 }, reward: { stone: 25 }, response: '灵草成色不错，这是你的灵石。' },
      ],
    },
    {
      id: 'pet_seller',
      name: '灵宠贩子',
      icon: '🐾',
      greeting: '客官！新到的灵宠，要不要瞅瞅？',
      options: [
        { label: '交谈', action: 'talk', reward: { cultivation: 10 }, response: '养个灵宠，修仙不寂寞！' },
        { label: '买灵鱼（-30灵石）', action: 'buy', cost: { stone: 30 }, reward: { cultivation: 80 }, response: '灵鱼入水，灵气自生！修为+80！' },
        { label: '看看就好', action: 'decline', reward: {}, response: '下次再来啊！' },
      ],
    },
    {
      id: 'senior_elder',
      name: '宗门长老',
      icon: '👨‍🦳',
      greeting: '小辈，老夫观你骨骼清奇，可愿听老夫指点一二？',
      options: [
        { label: '聆听教诲', action: 'talk', reward: { cultivation: 100 }, response: '天地灵气，万物有道。记住，修仙修的是心！修为+100！' },
        { label: '献上灵草（-8灵草）', action: 'gift', cost: { herb: 8 }, reward: { breakthroughPill: 1 }, response: '有心了。这枚突破丹送你，助你一臂之力。' },
        {label: '恭敬送别', action: 'decline', reward: {}, response: '后会有期。' },
      ],
    },
  ],

  init() {
    this._lastVisitorDate = localStorage.getItem('dxy_last_visitor_date') || '';
  },

  /** 尝试触发访客（每次 tick 调用） */
  trySpawn() {
    const today = new Date().toDateString();

    // 每日限 2 次
    if (this._lastVisitorDate !== today) {
      this._lastVisitorDate = today;
      this._visitorCount = 0;
      localStorage.setItem('dxy_last_visitor_date', today);
    }

    if (this._visitorCount >= 2) return null;
    if (this._currentVisitor) return null;

    // 随机概率（每次 tick 约 0.5%，平均每 ~3 分钟尝试）
    if (Math.random() > 0.01) return null;

    // 随机选一个访客
    const visitor = this._visitors[Math.floor(Math.random() * this._visitors.length)];
    this._currentVisitor = { ...visitor };
    this._visitorCount++;

    // 记录「真实到访时刻」，供角色台词判断冷清天数
    try { localStorage.setItem('dxy_last_visit_at', String(Date.now())); } catch (e) { /* ignore */ }

    return this._currentVisitor;
  },

  /** 选择访客选项 */
  chooseOption(optionIndex) {
    if (!this._currentVisitor) return null;

    const option = this._currentVisitor.options[optionIndex];
    if (!option) return null;

    const state = GameEngine.state;

    // 检查消耗
    if (option.cost) {
      for (const [res, amount] of Object.entries(option.cost)) {
        if ((state[res] || 0) < amount) {
          return { success: false, message: '资源不足' };
        }
      }
      // 扣除消耗
      for (const [res, amount] of Object.entries(option.cost)) {
        state[res] -= amount;
      }
    }

    // 发放奖励
    if (option.reward) {
      for (const [res, amount] of Object.entries(option.reward)) {
        if (res === 'cultivation') {
          const cap = calcQ(state.realm, state.level, 1.0);
          state.cultivation = Math.min(state.cultivation + amount, cap);
        } else {
          state[res] = (state[res] || 0) + amount;
        }
      }
    }

    const response = option.response;
    this._currentVisitor = null;
    return { success: true, message: response };
  },

  /** 赶走访客 */
  dismiss() {
    this._currentVisitor = null;
  },

  get hasVisitor() {
    return this._currentVisitor !== null;
  },

  get current() {
    return this._currentVisitor;
  },
};

// ============================
// 音效系统（AUD-002 / Web Audio API）
// ============================
const SoundFX = {
  _ctx: null,
  _enabled: true,

  init() {
    // 延迟创建 AudioContext（需要用户手势）
    document.addEventListener('click', () => this._ensureContext(), { once: true });
    document.addEventListener('touchstart', () => this._ensureContext(), { once: true });
  },

  _ensureContext() {
    if (!this._ctx) {
      try {
        this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        this._enabled = false;
      }
    }
    if (this._ctx && this._ctx.state === 'suspended') {
      this._ctx.resume();
    }
  },

  /** 播放合成音效（无需音频文件） */
  play(type) {
    if (!this._enabled || !this._ctx) return;

    const ctx = this._ctx;
    const now = ctx.currentTime;

    switch (type) {
      case 'click':
        this._beep(ctx, now, 800, 0.05, 'sine', 0.15);
        break;
      case 'harvest':
        this._beep(ctx, now, 523, 0.08, 'sine', 0.2);
        this._beep(ctx, now + 0.08, 659, 0.08, 'sine', 0.2);
        this._beep(ctx, now + 0.16, 784, 0.12, 'sine', 0.2);
        break;
      case 'craft_done':
        this._beep(ctx, now, 440, 0.1, 'triangle', 0.2);
        this._beep(ctx, now + 0.1, 554, 0.1, 'triangle', 0.2);
        this._beep(ctx, now + 0.2, 659, 0.15, 'triangle', 0.25);
        break;
      case 'breakthrough':
        this._beep(ctx, now, 261, 0.15, 'triangle', 0.3);
        this._beep(ctx, now + 0.15, 329, 0.15, 'triangle', 0.3);
        this._beep(ctx, now + 0.3, 392, 0.15, 'triangle', 0.3);
        this._beep(ctx, now + 0.45, 523, 0.3, 'triangle', 0.35);
        this._beep(ctx, now + 0.6, 659, 0.4, 'triangle', 0.3);
        break;
      case 'sword':
        this._noise(ctx, now, 0.04, 0.1);
        this._beep(ctx, now, 200 + Math.random() * 400, 0.03, 'sawtooth', 0.08);
        break;
      case 'deny':
        this._beep(ctx, now, 200, 0.15, 'square', 0.1);
        this._beep(ctx, now + 0.15, 150, 0.2, 'square', 0.1);
        break;
      case 'visitor':
        this._beep(ctx, now, 660, 0.08, 'sine', 0.15);
        this._beep(ctx, now + 0.1, 880, 0.12, 'sine', 0.15);
        break;
      case 'notification':
        this._beep(ctx, now, 880, 0.06, 'sine', 0.12);
        break;
      case 'meditate':
        this._beep(ctx, now, 220, 0.3, 'sine', 0.06);
        break;
    }
  },

  _beep(ctx, time, freq, duration, waveType, volume) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = waveType || 'sine';
    osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(volume || 0.2, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  },

  _noise(ctx, time, duration, volume) {
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume || 0.1;
    source.connect(gain).connect(ctx.destination);
    source.start(time);
  },
};

// ============================
// 触觉反馈
// ============================
const Haptic = {
  vibrate(pattern) {
    if (navigator.vibrate) {
      navigator.vibrate(pattern || 10);
    }
  },
  light() { this.vibrate(8); },
  medium() { this.vibrate(18); },
  heavy() { this.vibrate([30, 20, 30]); },
  success() { this.vibrate([15, 30, 15]); },
};

// ============================
// 俯视场景：山峰切换 + 人物走动（纯表现层）
// ============================
const PeakScene = {
  PEAKS: {
    qingyun: { name: '青云峰', flavor: '松风入定 · 灵气清正' },
    luoxia:  { name: '落霞峰', flavor: '枫火映丹 · 火候易成' },
    hantan:  { name: '寒潭峰', flavor: '潭寒凝露 · 静心易得' },
  },
  KEY: 'dxy_peak',

  init() {
    const scene = document.getElementById('yard-scene');
    if (!scene) return;
    this._scene = scene;

    // 恢复上次选择
    let saved = null;
    try { saved = localStorage.getItem(this.KEY); } catch (e) { /* ignore */ }
    if (saved && this.PEAKS[saved]) {
      this.apply(saved, false);
    }

    // 峰切换
    document.querySelectorAll('.peak-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.apply(btn.dataset.peak, true);
        if (typeof SoundFX !== 'undefined') SoundFX.play('click');
      });
    });

    // 点击空地让修士走过去（点到交互物不移动）
    scene.addEventListener('click', (e) => {
      if (e.target.closest('[data-action], .plot, .character, .meditation-pad, .sword-dummy, .furnace, .peak-bar')) return;
      this.moveTo(e);
    });
  },

  apply(id, persist) {
    const peak = this.PEAKS[id];
    if (!peak || !this._scene) return;

    this._scene.dataset.peak = id;

    document.querySelectorAll('.peak-btn').forEach(btn => {
      const on = btn.dataset.peak === id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    const nameEl = document.getElementById('peak-name');
    const flavorEl = document.getElementById('peak-flavor');
    if (nameEl) nameEl.textContent = peak.name;
    if (flavorEl) flavorEl.textContent = peak.flavor;

    if (persist) {
      try { localStorage.setItem(this.KEY, id); } catch (e) { /* ignore */ }
      if (typeof CharacterVoice !== 'undefined') CharacterVoice.say('peak', 120);
    }
  },

  moveTo(e) {
    const scene = this._scene;
    const ch = document.getElementById('character');
    if (!scene || !ch) return;

    const r = scene.getBoundingClientRect();
    if (!r.width || !r.height) return;

    // 夹在场景安全区内，避免走到边角外
    const px = ((e.clientX - r.left) / r.width) * 100;
    const py = ((e.clientY - r.top) / r.height) * 100;
    ch.style.left = Math.min(92, Math.max(8, px)) + '%';
    ch.style.top = Math.min(90, Math.max(12, py)) + '%';
  },
};

// ============================
// 角色「沈砚」：心绪与台词（纯表现层）
// 设定见 docs/character-shenyan.md
// ============================
const CharacterVoice = {
  LINES: {
    enter:        ['……回来了。', '灶上水还温着。'],
    back:         ['你走了些时日。', '院子我自己扫的。'],
    breakthrough: ['嗯。还能再撑一阵。', '师父若在，大约会点个头。'],
    craftDone:    ['火候到了。', '这一炉，成了。'],
    pill:         ['苦。含一会儿再咽。', '……这丹药，一年比一年贵。'],
    boost:        ['借药力冲一程。', '撑过一个时辰就好。'],
    sit:          ['……', '坐一会儿。'],
    stand:        ['腿麻了。'],
    night:        ['今夜星子清。', '该添灯了。'],
    rain:         ['雨打瓦，好听。'],
    peak:         ['这里风大。', '换个地方坐坐。'],
    lack:         ['不够。再等等。'],
    harvest:      ['今日有收成。'],
    lonely:       ['……许久没人来了。', '门环都落灰了。'],
    rebirth:      ['……又回到这里。', '从头再来，也无妨。'],
  },
  MOODS: { sit: '入定', craft: '候火', night: '观星', idle: '静修' },

  el: null,
  charEl: null,
  moodEl: null,
  _lastPick: {},
  _hideTimer: null,
  _mood: 'idle',
  _saidLonely: false,
  _lastCheck: 0,

  init() {
    this.charEl = document.getElementById('character');
    this.el = document.getElementById('char-bubble');
    this.moodEl = this.charEl ? this.charEl.querySelector('.char-mood') : null;
    if (this.charEl && this.moodEl) this.setMood('idle');
  },

  /** 说一句（同一情境避免连续重复） */
  say(key, delay) {
    const pool = this.LINES[key];
    if (!pool || !this.el) return;

    const fire = () => {
      // 挑一句与上次不同的
      let pick = pool[Math.floor(Math.random() * pool.length)];
      if (pool.length > 1 && pick === this._lastPick[key]) {
        pick = pool[(pool.indexOf(pick) + 1) % pool.length];
      }
      this._lastPick[key] = pick;

      this.el.textContent = pick;
      this.el.hidden = false;
      // 强制重排，让过渡生效
      void this.el.offsetWidth;
      this.el.classList.add('show');

      clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => {
        this.el.classList.remove('show');
        setTimeout(() => { this.el.hidden = true; }, 260);
      }, 3400);
    };

    if (delay) setTimeout(fire, delay);
    else fire();
  },

  setMood(mood) {
    if (!this.MOODS[mood]) return;
    this._mood = mood;
    if (this.moodEl) this.moodEl.textContent = this.MOODS[mood];
    if (this.charEl) this.charEl.dataset.mood = this.MOODS[mood];
  },

  /** 依当前状态推断心绪（每帧调用，仅在变化时写 DOM） */
  tick() {
    if (typeof GameEngine === 'undefined' || !GameEngine.state) return;

    let next = 'idle';
    if (GameEngine._isMeditating) next = 'sit';
    else if (GameEngine.state.craftingQueue && GameEngine.state.craftingQueue.length > 0) next = 'craft';
    else if (typeof WeatherSystem !== 'undefined' && WeatherSystem.isNight) next = 'night';

    if (next !== this._mood) this.setMood(next);

    // 每 20 秒检查一次「久无访客」（整局只说一次）
    const now = Date.now();
    if (now - this._lastCheck > 20000) {
      this._lastCheck = now;
      this._checkLonely();
    }
  },

  /** 夜里、且已连续两日无人到访时，低声一句 */
  _checkLonely() {
    if (this._saidLonely) return;
    if (typeof WeatherSystem === 'undefined' || !WeatherSystem.isNight) return;

    let stamp = null;
    try { stamp = localStorage.getItem('dxy_last_visit_at'); } catch (e) { return; }
    if (!stamp) return;                       // 从未有访客过：不念叨

    const days = (Date.now() - Number(stamp)) / 86400000;
    if (days >= 2) {
      this.say('lonely', 800);
      this._saidLonely = true;
    }
  },
};
