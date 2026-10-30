/**
 * 桌面修仙 · 应用入口
 * @trace MECH-001, MECH-009, MECH-010, MECH-013, MECH-014
 * 初始化引擎/日常目标/访客/音效，启动主循环，处理离线收益
 */

(function() {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
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
    const LOGIC_INTERVAL = 100;
    const VISITOR_CHECK_INTERVAL = 5000; // 每5秒检测一次访客

    function gameLoop(timestamp) {
      if (timestamp - lastLogicTick >= LOGIC_INTERVAL) {
        const dt = 0.1;
        GameEngine.tick();
        WeatherSystem.tick(dt);

        // 日常目标进度跟踪
        if (GameEngine._isMeditating) {
          DailyGoals.increment('meditate', 0.1);
        }

        // 访客检测（低频，受宠物加成影响）
        if (timestamp - lastVisitorCheck >= VISITOR_CHECK_INTERVAL) {
          lastVisitorCheck = timestamp;
          UI._checkVisitor();
        }

        // 角色心绪：已通过 GameEngine.on('tick') 订阅，此处不再重复调用
        // 标签页隐藏时不刷新 UI（省电，也让后台更安静）
        if (!document.hidden) UI.refreshAll();
        lastLogicTick = timestamp;
      }
      requestAnimationFrame(gameLoop);
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

    // 8. 页面卸载前保存
    window.addEventListener('beforeunload', () => {
      SaveSystem.save(GameEngine.state);
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
