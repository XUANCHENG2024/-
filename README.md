# 桌面修仙 · Desktop Xianxia（网页版）

一款 2D 俯视视角的中式修仙放置游戏。开一局、摆一座山峰、让角色在院子里打坐练剑，修为自己会长。
数值与 Unity 版严格一致，可作跨端行为参照。

**纯前端零依赖**：没有构建步骤、没有框架、没有 `npm install` 才能跑——双击 `index.html` 就能玩。

---

## 立刻开始

```bash
# 方式一：直接打开
open index.html          # macOS
start index.html         # Windows

# 方式二：起个静态服务（避免个别浏览器对 file:// 的限制）
python -m http.server 8000
# 然后访问 http://localhost:8000
```

手机上看也一样：布局在 320px–1440px 之间自适应，底部导航、长按手势、触觉反馈都做了适配。

---

## 玩法

| 系统 | 说明 |
|------|------|
| **修炼** | 修为按 `V(R) = V0 × 1.5^(R-1)` 自动累积；境界共 6 大境界 × 9 小阶 |
| **打坐** | 长按开始，倍率 2.0 起手，持续 45 秒坐满可到 4.5 倍 |
| **练剑** | 单击出一剑，**按住连发**；5 秒内不断则连击累积，最高 3 倍 |
| **灵田** | 3 块起，可扩到 8 块；三种灵草生长时间 60/120/240 秒，浇水加速 20% |
| **炼丹** | 聚气丹（服下回复 15% 修为，或转为 1 时辰双倍速率）；破障丹（跨大境界必需） |
| **集市** | 灵石 ↔ 材料双向交易，卖价低于买价，无套利空间 |
| **日常 / 访客 / 宠物 / 功法 / 轮回** | 长线目标、随机事件、被动加成、终局转生（道行提供永久加成） |
| **山峰** | 青云峰 / 落霞峰 / 寒潭峰，各有气候与场景差异 |

角色「沈砚」会随情境说话——突破、下雨、深夜、久无人来访，台词都不一样。

---

## 项目结构

```
.
├── index.html            单页结构 + 33 个内联 SVG 图标
├── css/
│   ├── style.css         设计令牌 / 布局 / 场景 / 动效（约 3900 行）
│   └── textures.css      三张 webp 贴图的 base64 内联（见下）
├── js/
│   ├── config.js         全部可调数值集中在此
│   ├── save.js           存档序列化 / 迁移 / 离线结算
│   ├── engine.js         主循环、修炼、突破、种植、炼丹、集市、轮回
│   ├── features.js       日常目标、访客、音效、触觉、山峰场景、角色台词
│   ├── systems.js        天气、宠物、功法
│   ├── ui.js             渲染与事件委托
│   └── app.js            启动装配
├── test.js               71 项单元测试
├── e2e-test.js           47 项 jsdom 真实点击测试
├── validate.js           20 项数值校验（含跨端一致性）
└── balance-sim.js        30 分钟经济模拟（4 种玩法档位）
```

---

## 跑测试

```bash
npm install        # 只装 jsdom，用于 DOM 测试
npm test           # 71 项单元测试
npm run e2e        # 47 项真实点击测试
npm run validate   # 20 项数值校验
npm run balance    # 经济模拟
```

`e2e-test.js` 用 jsdom 真的派发 `click` / `touchend` 事件，专门覆盖一类问题：
**按钮看着在、点下去没反应**。历史上有过一次全站点击失效，根因是
`.modal-overlay { display: flex }` 覆盖了浏览器默认的 `[hidden] { display: none }`，
三个全屏遮罩永久可见并吞掉了所有点击——所以 `style.css` 里有一条
`[hidden] { display: none !important }`，`e2e-test.js` 第一个用例就在守它。

---

## 几个实现上的取舍

**事件委托 + 数据签名。** 面板内容每 100ms 刷新一次，如果每次都重建 `innerHTML`，
正在按的按钮会被抽走，点击就丢了。所以刷新前先比数据签名，签名不变不重建 DOM；
所有动态按钮统一走 `document` 上的 `data-action` 委托，不逐个 `addEventListener`。

**只写变化的值。** HUD 与修炼面板都有缓存，值没变就不碰 DOM，避免持续触发样式重算。

**数值与 Unity 版对齐。** `validate.js` 里有 8 条跨端断言，直接比对 GDD 推导值。
改任何一个系数，这里会先红。

**贴图为什么是 base64。** GitHub 的 REST 接口传不了二进制，而本项目又希望
「克隆下来就能玩、不依赖任何外部资源」。所以三张 webp 以 base64 内联进
`css/textures.css`，通过 CSS 变量 `--tex-paper` / `--tex-hills-day` / `--tex-hills-night`
被 `style.css` 引用。已校验 base64 解码后与原图 md5 完全一致。

代价是这个文件约 243KB 且不便改图。要换贴图，重跑一次内联即可：

```bash
python -c "
import base64,pathlib
raw=pathlib.Path('assets/tex/paper.webp').read_bytes()
print('url(\"data:image/webp;base64,'+base64.b64encode(raw).decode()+'\")')
"
```

---

## 已知限制

- 存档在 `localStorage`，换浏览器/清缓存即丢；系统面板可导出 JSON 备份
- 访客事件目前 5 位、每人 3 个选项，长时间游玩会重复
- 无服务端，无排行榜，无多人

---

## 许可

个人项目，代码可自由参考。字体与贴图素材请自行确认授权后再商用。
