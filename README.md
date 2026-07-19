# 最后防线

[![CI and GitHub Pages](https://github.com/chenxuan520/last-line/actions/workflows/ci.yml/badge.svg)](https://github.com/chenxuan520/last-line/actions/workflows/ci.yml)

桌面浏览器单人 AI 大逃杀 FPS。每局包含 1 名玩家和 49 名 AI，完整覆盖航线、跳伞、搜集、战斗、缩圈、淘汰和结算。

## 功能

- 2400m × 2400m 小岛；每局由 seed 在全地图不规则生成 8 个命名据点和 8 处野外小聚落，不沿圆周或固定格点排列
- 建筑采用最小间距随机散布，形成密度不同的小镇、路边房和独栋；道路与小地图读取本局实际据点坐标
- 每局额外生成 16 座约 24–42m 高的山峰/山脊，据点优先落在谷地和平缓地带；地面带低成本自然纹路，山脚分布高低错落的树木、灌木和岩石
- 每局生成 24 个权威大岩石掩体，与建筑墙体一样阻挡移动、子弹和 AI 视线；渲染 mesh 不参与玩法判定
- 建筑由带门窗开口的权威墙段组成，可进入、可交火，并通过外置坡道到达屋顶
- 60 秒随机航线、低模运输机与固定尾迹、手动跳伞、适配大地图的滑翔和自动落地；跳伞后仍可抬头观察飞机沿航线离开
- 步枪、冲锋枪、霰弹枪和狙击枪，弹匣容量分别为 45 / 48 / 9 / 8；对应地面弹药堆为两个弹匣，即 90 / 96 / 18 / 16；统一即时命中和固定时间步规则，仅狙击枪支持右键瞄准镜
- 可见曳光、枪口焰、墙地火花、尘土和弹痕反馈；玩家与附近 AI 枪声按武器区分并随距离衰减
- 双主武器槽、弹药、两级护甲/头盔、绷带和急救包
- 死亡与手动丢弃物会在角色周围分散落到权威地面/屋顶支撑面；默认使用现有物品配图作为朝向相机的地面标记，关闭设置可恢复方块，HUD 提示与实际可拾取物保持一致
- 49 名 AI 自主跳伞、搜集、进圈、战斗、换弹和治疗
- AI 在无可见敌人和有效物资时会持续选择圈内可达巡逻点；3 人及以下进入主动终局搜索，受击后立即转向攻击来源，楼上目标会沿坡道追击
- AI 生命值不高于 25 时优先利用权威墙体或岩石脱离交火，切断视线后按玩家相同规则治疗；无药时主动寻找可达医疗物，空弹时优先切换有弹副武器，否则撤退、换弹或搜索兼容弹药
- 首页默认启用“禁用 AI 狙击枪”：AI 不选择、拾取或使用狙击枪与狙击弹，玩家和地图物资生成不受影响；关闭开关可恢复原行为
- AI 按 16 个落区分流，开伞时机带独立随机扰动；保留 240 件基础物资及原类别数量，另追加 10 个绷带/急救包点，各区按 seed 分配 10–20 件基础物资并采用不同间距
- 六阶段安全区、圈外伤害、击杀信息、唯一胜者和无刷新重开；存活少于 5 人时当前收缩速度加倍
- 前两圈保留搜集时间，第三圈起逐段加快等待与收缩，正式对局预算约 13 分 22 秒
- 玩家被淘汰后锁定击杀者的第一人称视角；仅在用户按空格或滚动滚轮时切换其他存活角色，HUD 同步显示当前观察角色的生命和装备
- 固定战术小地图，显示航线、POI、玩家朝向和当前/下一安全区
- 画质、音量、鼠标灵敏度、初始绷带、AI 狙击枪限制和地面物资配图设置，保存到 `localStorage`；新用户默认静音，并默认启用初始绷带、禁用 AI 狙击枪及地面物资配图
- SVG/PNG/WebP/GLB 资源清单、预加载、校验、缓存和失败回退

## 技术栈

- TypeScript、Vite
- Babylon.js、WebGL2
- 原生 HTML/CSS HUD
- Vitest

## 环境

- Node.js 24 或更高版本
- 桌面版 Chrome / Edge，WebGL2

## 本地运行

```bash
npm ci
npm run dev
```

打开终端输出的本地地址，点击“开始游戏”进入对局。

## 操作

| 输入 | 动作 |
| --- | --- |
| `WASD` | 移动 |
| `Shift` | 冲刺 |
| `Space` | 跳伞 / 跳跃；淘汰后切换观战角色 |
| 鼠标左键 | 开火 |
| 鼠标右键 | 狙击枪瞄准镜 |
| `R` | 换弹 |
| `F` | 拾取 |
| `1` / `2` 或鼠标滚轮 | 切换主武器；淘汰后滚轮前后切换观战角色 |
| `Q` | 使用绷带 |
| `H` | 使用急救包 |
| `G` | 丢弃当前武器 |
| 按住 `Tab` | 查看本局排行榜 |

换弹动画由权威换弹进度驱动；移动中滚轮切枪由 Pointer Lock 下的全局滚轮输入处理。
弹匣打空且仍有对应备弹时会自动开始换弹；玩家落地后航线跳伞计数会立即切换为击杀数。

## 验证

```bash
npm run typecheck
npm run test
npm run build
npm run preview
```

`npm run test` 只运行 Vitest 单元与规则集成测试，不使用 Playwright，也不会下载浏览器。浏览器验收使用本机已安装的 Chrome / Edge；测试前请把菜单主音量设为 `0`。

当前回归覆盖固定时间步、三类武器射速与第一/第三人称模型、同时结算公平性、规则射线、可进入建筑与屋顶坡道、背包与治疗、完整缩圈、AI 多 seed 搜集、49 Bot 完整加速局、资源回退、GLB contract 和场景重建释放。

## 架构

```text
src/
├── app/          # 菜单、会话创建、重开和生命周期
├── assets/       # 资源清单、预加载、校验和缓存
├── client/       # Babylon 渲染、音频和原生 HUD
├── config/       # 武器、物品、地图、模式和设置数值
├── controllers/  # 玩家与 AI 的统一指令生产者
├── ai/           # 导航和 AI 决策
└── game/         # 无 DOM/Babylon 依赖的权威规则状态与系统
```

`src/game/` 是权威规则层，只保存可序列化状态并消费统一角色指令。命中、视野、移动、物资和胜负均不依赖 Babylon mesh，素材替换不会改变玩法结果。

更多说明见：

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/asset-manifest.md`](docs/asset-manifest.md)
- [`docs/deployment.md`](docs/deployment.md)
- [`AGENTS.md`](AGENTS.md)

## 在线部署

- GitHub Pages：<https://chenxuan520.github.io/last-line/>
- Cloudflare Pages：<https://last-line.pages.dev/>
- 正式域名：<https://lastline.011203.xyz/>

GitHub Actions 在每次 PR 和 `main` 推送时执行类型检查、Vitest 和生产构建；`main` 通过后自动部署 GitHub Pages。Cloudflare Pages 使用 GitHub App 直接关联同一仓库并自动更新，配置见 [`docs/deployment.md`](docs/deployment.md)。

## 素材替换

所有素材由 `public/assets/asset-manifest.json` 的稳定 ID 引用。SVG、PNG、WebP 或 GLB 加载/解码失败时使用对应 fallback。

角色和武器 GLB 可通过清单元数据设置 `scale`、`offsetX`、`offsetY`、`offsetZ`，并用逗号分隔的 `requiredNodes` 校验必要节点。GLB 只影响视觉，命中盒和玩法数值由规则层固定定义。

## 当前边界

- 仅支持桌面键鼠，不支持移动端和触屏
- 当前为单机 AI 对局，无账号、后端、真人联网和匹配
- 不包含载具、投掷物、枪械配件、复杂弹道和可破坏场景
- 生产构建中的 Babylon/GLTF 按需 chunk 仍较大，但占位素材对局不会加载 GLTF chunk
