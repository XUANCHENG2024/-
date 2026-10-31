/**
 * 桌面修仙 · 应用入口
 * @trace MECH-001, MECH-009, MECH-010, MECH-013, MECH-014
 * 初始化引擎/日常目标/访客/音效，启动主循环，处理离线收益
 */

(function() {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    // 双启动保护：脚本被重复引入时会出现两个主循环，游戏以双倍速运行且互相抢存档。
    // 这类问题极难从现象上定位，不如在入口直接拦住。
    if (window.__dxBooted) {
      console.warn('[App] 已启动过，忽略重复初始化');
      return;
    }
    window.__dxBooted = true;

    console.log('[App] DesktopXianxia Web v0.2 starting...');

    // 1. 初始化引擎（加载存档）
    const state = GameEngine.init();

    // 2. 初始化 P1 特色系统
    DailyGoals.init();
    VisitorSystem.init();
    SoundFX.init();
    WeatherSystem.init();
    PetSystem.init();
    TechniqueSystem.init();

    // 3. 初始化 UI
    UI.init();
    UI._bindVisitor();

    // 3.1 俯视场景（山峰切换 / 人物走动）
    PeakScene.init();

    // 3.2 角色「沈砚」的心绪与台词
    CharacterVoice.init();

    // 4. 检查离线收益
    const offlineGains = SaveSystem.calculateOfflineGains(state, Date.now());
    if (offlineGains) {
      UI.showOfflineGains(offlineGains);
      CharacterVoice.say('back', 900);
    } else {
      CharacterVoice.say('enter', 700);
    }

    // 5. 首次刷新
    UI.refreshAll();

    // 6. 主循环
    let lastLogicTick = 0;
    let lastVisitorCheck = 0;
    let loopErrors = 0;
    let degraded = false;
    const LOGIC_INTERVAL = 100;
    const DEGRADED_INTERVAL = 1000;   // 连续异常后降速，避免每帧刷错误
    const VISITOR_CHECK_INTERVAL = 5000; // 每5秒检测一次访客

    function gameLoop(timestamp) {
      try {
        const interval = degraded ? DEGRADED_INTERVAL : LOGIC_INTERVAL;
        if (timestamp - lastLogicTick >= interval) {
          const dt = 0.1;
          GameEngine.tick();
          WeatherSystem.tick(dt);

          // 日常目标进度跟踪
          if (GameEngine._isMeditating) {
            DailyGoals.increment('meditate', 0.1);
          }

          // 访客检测（低频，受宠物加成影响）
          if (!degraded && timestamp - lastVisitorCheck >= VISITOR_CHECK_INTERVAL) {
            lastVisitorCheck = timestamp;
            UI._checkVisitor();
          }

          // 角色心绪：已通过 GameEngine.on('tick') 订阅，此处不再重复调用
          // 标签页隐藏时不刷新 UI（省电，也让后台更安静）
          if (!document.hidden) UI.refreshAll();
          lastLogicTick = timestamp;
          if (loopErrors > 0) loopErrors = 0;   // 成功一帧即视为恢复
        }
      } catch (err) {
        // 关键：一帧内的任何异常都不能让循环断掉。
        // 原实现的 requestAnimationFrame 在 try 之外、且在出错点之后，
        // 一旦 tick 里任何子系统抛错，就再也不会续帧 —— 整个游戏永久定格，
        // 没有任何提示，玩家只能刷新，而刷新后往往立刻复现。
        loopErrors++;
        console.error('[App] 主循环异常（已跳过本帧，循环继续）：', err);
        lastLogicTick = timestamp;
        if (loopErrors >= 3 && !degraded) {
          degraded = true;
          UI.showFatalBanner('运行时出现异常，已降速运行以免卡死。可在「系统」里导出存档后刷新页面。');
        }
      } finally {
        // 无论成功与否都必须续帧
        requestAnimationFrame(gameLoop);
      }
    }
    requestAnimationFrame(gameLoop);

    // 6.5 角色台词：按情境触发
    GameEngine.on('tick', () => CharacterVoice.tick());
    GameEngine.on('breakthroughSuccess', () => CharacterVoice.say('breakthrough', 200));
    GameEngine.on('craftingCompleted', () => CharacterVoice.say('craftDone', 200));
    GameEngine.on('meditationChanged', (active) => {
      CharacterVoice.say(active ? 'sit' : 'stand', active ? 300 : 150);
    });
    GameEngine.on('timeOfDayChanged', (t) => {
      if (t === 'night') CharacterVoice.say('night', 400);
    });
    GameEngine.on('plotHarvested', () => {
      if (Math.random() < 0.35) CharacterVoice.say('harvest');
    });
    GameEngine.on('notification', (msg) => {
      if (/不足|不够|已满/.test(String(msg))) CharacterVoice.say('lack');
    });

    // 7. 挂钩游戏事件到日常目标进度
    GameEngine.on('plotPlanted', () => DailyGoals.increment('plant'));
    GameEngine.on('plotHarvested', () => {
      DailyGoals.increment('harvest');
      SoundFX.play('harvest');
      Haptic.light();
    });
    GameEngine.on('craftingCompleted', () => {
      DailyGoals.increment('craft');
      SoundFX.play('craft_done');
      Haptic.success();
    });
    GameEngine.on('breakthroughSuccess', () => {
      DailyGoals.increment('breakthrough');
    });
    // 练剑：剑光弧 + 雨天溅雨 + 一句台词
    let rainSaidAt = 0;
    function playSwordFx() {
      const el = document.getElementById('sword-dummy');
      if (!el) return;
      el.classList.remove('striking', 'splashing');
      void el.offsetWidth;
      el.classList.add('striking');
      const raining = (typeof WeatherSystem !== 'undefined') && WeatherSystem.isRain;
      if (raining) el.classList.add('splashing');

      // 人物身上的剑穗同步抖一下
      const ch = document.getElementById('character');
      if (ch) {
        ch.classList.remove('striking');
        void ch.offsetWidth;
        ch.classList.add('striking');
      }

      clearTimeout(playSwordFx._t);
      playSwordFx._t = setTimeout(() => {
        el.classList.remove('striking', 'splashing');
        if (ch) ch.classList.remove('striking');
      }, 480);

      // 雨天试剑：他只在雨里试剑（设定见角色卡）
      if (raining && Date.now() - rainSaidAt > 60000) {
        rainSaidAt = Date.now();
        CharacterVoice.say('rain', 260);
      }
    }

    GameEngine.on('comboChanged', (combo) => {
      if (combo > 0) {
        DailyGoals.increment('sword');
        SoundFX.play('sword');
        Haptic.light();
        playSwordFx();
      }
    });
    GameEngine.on('meditationChanged', (active) => {
      if (active) SoundFX.play('meditate');
      // 更新角色动画
      const char = document.getElementById('character');
      if (char) char.classList.toggle('meditating', active);
    });
    GameEngine.on('notification', (msg) => {
      UI.showToast(msg);
    });

    // 8.2 多标签页冲突：别人在写同一份存档时降级，避免互相覆盖
    SaveSystem.watchOtherTabs(() => {
      console.warn('[App] 另一个标签页接管了存档，本页已停止自动存档');
      UI.showToast('检测到另一个标签页在运行，本页已停止自动存档');
    });

    // 8.3 弟子叛出必须让玩家知道——否则只会发现"弟子莫名其妙少了一个"
    GameEngine.on('discipleBetrayed', ({ name }) => {
      UI.showToast(`${name} 道心动摇，已叛出师门`);
      SoundFX.play('deny');
      Haptic.heavy();
      UI._sectCache = {};
      UI._needsFullRebuild = true;
      if (typeof CharacterVoice !== 'undefined') CharacterVoice.say('hurt', 300);
    });

    // 8. 页面卸载 / 隐藏前保存
    window.addEventListener('beforeunload', () => {
      SaveSystem.save(GameEngine.state);
    });
    // 移动端常直接杀进程，beforeunload 不一定触发，隐藏时就落一次盘
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) SaveSystem.save(GameEngine.state);
    });

    // 8.1 离开收益提示：切后台回来若结算了可观收益，给一条汇总
    GameEngine.on('awayGains', (g) => {
      if (!g || g.seconds < 60) return;          // 不到 1 分钟不打扰
      const parts = [];
      if (g.cultivation >= 1) parts.push(`修为 +${Math.floor(g.cultivation)}`);
      if (g.herb) parts.push(`灵草 +${g.herb}`);
      if (g.dew) parts.push(`凝露 +${g.dew}`);
      if (!parts.length) return;
      const mins = Math.round(g.seconds / 60);
      const tail = g.capped ? '（已达结算上限）' : '';
      UI.showToast(`离开 ${mins} 分钟，${parts.join(' · ')}${tail}`);
    });

    // 7.5 灵石累计（日常「累计获得灵石」）—— 卖出、访客、奖励都算，统一在这里观察
    let lastStone = GameEngine.state.stone;
    GameEngine.on('tick', () => {
      const now = GameEngine.state.stone;
      if (now > lastStone) DailyGoals.increment('collect', now - lastStone);
      lastStone = now;
    });

    // 7.6 成熟提醒：灵田不在当前标签页时给一次轻提示（20 秒内最多一次）
    let lastReadyToast = 0;
    GameEngine.on('plotReady', () => {
      const now = Date.now();
      if (now - lastReadyToast < 20000) return;
      if (UI._currentTab === 'farming') return;   // 已经看着灵田就不用提醒
      lastReadyToast = now;
      UI.showToast('灵田有作物成熟，可收获');
    });

    // 7.7 仓库满提示（30 秒内最多一次，避免刷屏）
    let lastFullToast = 0;
    GameEngine.on('resourceFull', (type) => {
      const now = Date.now();
      if (now - lastFullToast < 30000) return;
      lastFullToast = now;
      const nameMap = { herb: '灵草', ore: '矿石', dew: '凝露', stone: '灵石' };
      UI.showToast(`${nameMap[type] || '资源'}已达上限，记得兑换或消耗`);
    });

    // 7.8 修为满仓提醒：同一层只提醒一次，避免挂机时反复弹
    let cappedLevelKey = '';
    GameEngine.on('tick', () => {
      const s = GameEngine.state;
      const key = `${s.realm}-${s.level}`;
      if (s.cultivation < calcQ(s.realm, s.level, 1.0)) { cappedLevelKey = ''; return; }
      if (cappedLevelKey === key) return;
      cappedLevelKey = key;
      UI.showToast('修为已满，可以突破了');
    });

    // 9. 移动端手势优化：禁止双击缩放（只对非交互元素生效，不阻断按钮点击）
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      // 只在非交互元素上阻止双击缩放，按钮/链接/输入框不受影响
      const target = e.target;
      const isInteractive = target.closest('button, a, input, select, textarea, [data-action], .nav-btn, .plot, .furnace, .meditation-pad, .sword-dummy, .character');
      if (!isInteractive && now - lastTouchEnd < 300) {
        e.preventDefault();
      }
      lastTouchEnd = now;
    }, { passive: false });

    console.log('[App] Initialization complete. Game loop + P1 features started.');
  });
})();
