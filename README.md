# 最后防线

[![CI and GitHub Pages](https://github.com/chenxuan520/last-line/actions/workflows/ci.yml/badge.svg)](https://github.com/chenxuan520/last-line/actions/workflows/ci.yml)

浏览器大逃杀 FPS。桌面端支持键鼠，手机端支持横屏触控；单机模式包含 1 名玩家和 49 名 AI，联机模式支持 2–10 名真人并由 AI 补满 50 人，完整覆盖航线、跳伞、搜集、战斗、缩圈、淘汰和结算。

## 功能

- 2400m × 2400m 小岛；每局由 seed 在全地图不规则生成 8 个命名据点和 8 处野外小聚落，不沿圆周或固定格点排列
- 建筑采用最小间距随机散布，主城、野外聚落和路边院落均提高生成密度；道路与小地图读取本局实际据点坐标
- 每局额外生成 16 座约 24–42m 高的山峰/山脊，据点优先落在谷地和平缓地带；自然物密度提高到 384 棵树、180 处灌木和 96 组装饰岩石，其中大量树石专门聚簇在山坡
- 每局生成 64 个权威大岩石、96 段栅栏和 72 组草堆掩体，与建筑墙体一样阻挡移动、子弹和 AI 视线；渲染 mesh 不参与玩法判定
- 约 20% 建筑按 seed 升级为可完整进入的 2–3 层大楼，逐层窗口、楼板、内部板式楼梯和屋顶均参与移动、子弹、AI 视线与导航；单层和多层窗户都可双向跳入/跳出，其余单层建筑继续使用外置屋顶坡道
- 每局从现有建筑中按 seed 选择一栋两层白色医院，外墙带医疗十字并在小地图标记；一楼固定调拨 1 个急救包点和 1 个绷带点（2 条），不增加本局物资总量
- 60 秒随机航线、低模运输机与固定尾迹、手动跳伞、适配大地图的滑翔和自动落地；跳伞后仍可抬头观察飞机沿航线离开
- 步枪、冲锋枪、霰弹枪和狙击枪，弹匣容量分别为 45 / 48 / 9 / 8；对应地面弹药堆为两个弹匣，即 90 / 96 / 18 / 16；统一即时命中和固定时间步规则，仅狙击枪支持右键瞄准镜
- 可见曳光、枪口焰、墙地火花、尘土和弹痕反馈；玩家与附近 AI 枪声按武器区分并随距离衰减
- 双主武器槽、弹药、两级护甲/头盔、绷带和急救包
- 地面物资默认使用有界复用的低模三维枪械、弹药箱、医疗和装备模型；可在首页关闭并恢复经典方块标记，HUD 继续使用物品图片
- 死亡与手动丢弃物会在角色周围分散落到权威地面/屋顶支撑面；HUD 提示与实际可拾取物保持一致
- 49 名 AI 自主跳伞、搜集、进圈、战斗、换弹和治疗
- 独立联机入口支持快速匹配、公开房间列表、公开建房、私人房间码、准备/倒计时和断线重连；现有单机入口不连接服务器
- 联机后端可选择 Cloudflare Durable Objects 或单机自托管 Node.js + SQLite；两种模式复用同一协议、账号/房间逻辑和 30 Hz 权威规则，浏览器只发送 `ActorCommand` 并进行本地移动预测与远端插值
- 联机客户端按快照 tick gap 对远端位置做 120–250ms 展示层平滑，本地预测校正只衰减视觉 offset；重新可见、生死/部署切换及超出当前移动预算的权威传送立即对齐。服务端追 tick 时抑制短时间 snapshot 连发，避免客户端合并后出现大跨度瞬移
- 管理员可切换游客准入或强制注册登录；账号模式使用 HttpOnly Refresh Cookie，并在 Access Token 到期前自动续期
- Worker 同源管理终端使用唯一管理员账号，可查看玩家账号和在线房间、禁用/恢复账号、撤销会话及强制关闭异常房间
- AI 在无可见敌人和有效物资时会持续选择圈内可达巡逻点；3 人及以下进入主动终局搜索，受击后立即转向攻击来源，楼上目标会沿坡道追击
- AI 在建筑内需要跑毒时会优先经正门退出；zone path 失败会清除旧战斗/搜集路径，避免在房间内反复左右移动直到毒死
- AI 使用常数开销的活性监控；原地小范围停留达到 45 秒或 8 秒内连续左右反向 6 次时，清理旧路径并强制选择新的圈内可达目标
- AI 生命值不高于 25 时优先利用权威墙体或岩石脱离交火，切断视线后按玩家相同规则治疗；无药时主动寻找可达医疗物，空弹时优先切换有弹副武器，否则撤退、换弹或搜索兼容弹药
- 首页默认启用“禁用 AI 狙击枪”：AI 不选择、拾取或使用狙击枪与狙击弹，玩家和地图物资生成不受影响；关闭开关可恢复原行为
- AI 按 16 个落区分流，开伞时机带独立随机扰动；保留 240 件基础物资及原类别数量，另追加 10 个绷带/急救包点，各区按 seed 分配 10–20 件基础物资并采用不同间距
- 六阶段安全区、圈外伤害、击杀信息、唯一胜者和无刷新重开；存活少于 5 人时当前收缩速度加倍
- 首圈等待/收缩为 120/60 秒，第二圈为 90/55 秒，第三圈起继续逐段加快，正式对局预算约 10 分 07 秒
- 玩家被淘汰后锁定击杀者的第一人称视角；仅在用户按空格或滚动滚轮时切换其他存活角色，HUD 同步显示当前观察角色的生命和装备
- 固定战术小地图，显示航线、POI、玩家朝向和当前/下一安全区
- 画质、音量、视角灵敏度、初始绷带、AI 狙击枪限制和三维物资设置，保存到 `localStorage`；新用户默认静音，并默认启用初始绷带、禁用 AI 狙击枪及三维物资
- SVG/PNG/WebP/GLB 资源清单、预加载、校验、缓存和失败回退

## 技术栈

- TypeScript、Vite
- Babylon.js、WebGL2
- 原生 HTML/CSS HUD
- Vitest
- Cloudflare Workers / Durable Objects，或 Node.js / SQLite；两种后端共用 WebSocket 协议

## 环境

- Node.js 24 或更高版本
- 桌面版 Chrome / Edge，或支持 WebGL2、Pointer Events 的手机浏览器

## 本地运行

```bash
npm ci
npm run dev
```

打开终端输出的本地地址，点击“开始游戏”进入对局。手机可浏览竖屏菜单，对局时需旋转至横屏。

本地联机需要第二个终端运行：

```bash
npm run dev:worker
```

本地主机自动连接 `http://127.0.0.1:8787`；正式联机站通过 `VITE_MULTIPLAYER_ENABLED=true` 和 `VITE_MULTIPLAYER_URL` 指定 Worker。GitHub Pages 构建固定关闭该开关并隐藏联机入口。

也可以运行完全本地的全栈自托管后端。它同时提供静态页面、API、WebSocket 和管理端，数据只写入本地 SQLite：

```bash
cp .env.standalone.example .env.standalone
# 修改 SERVER_PUBLIC_ORIGIN 和 ADMIN_BOOTSTRAP_TOKEN
npm run build:standalone
npm run start:server
```

自托管静态构建使用 `VITE_MULTIPLAYER_URL=same-origin`，不需要把服务器域名编译进前端。生产环境应把 Node 服务放在支持 WebSocket 的 HTTPS 反向代理后；Docker Compose、备份和变量说明见 [`docs/deployment.md`](docs/deployment.md)。

`npm run dev:worker` 与 `npm run dev:server` 是两种后端实现，默认都监听 8787，不应同时启动。Cloudflare 与 standalone 数据彼此独立，切换服务地址不会自动迁移账号或活动房间。

## 操作

| 输入 | 动作 |
| --- | --- |
| `WASD` | 移动 |
| `Shift` | 冲刺 |
| `Space` | 跳伞 / 约 1.7m 高跳跃；淘汰后切换观战角色 |
| 鼠标左键 | 开火 |
| 鼠标右键 | 狙击枪瞄准镜 |
| `R` | 换弹 |
| `F` | 拾取 |
| `1` / `2` 或鼠标滚轮 | 切换主武器；淘汰后滚轮前后切换观战角色 |
| `Q` | 使用绷带 |
| `H` | 使用急救包 |
| `G` | 丢弃当前武器 |
| 按住 `Tab` | 查看本局排行榜 |

手机横屏使用左侧摇杆移动，右侧空白区域滑动视角；屏幕按钮提供开火、瞄准、跳跃、拾取、换弹、切枪、绷带、急救包和暂停。淘汰后使用结果卡左右箭头切换观察目标。

换弹动画由权威换弹进度驱动；移动中滚轮切枪由 Pointer Lock 下的全局滚轮输入处理。
弹匣打空且仍有对应备弹时会自动开始换弹；玩家落地后航线跳伞计数会立即切换为击杀数。

## 验证

```bash
npm run typecheck
npm run test
npm run build
npm run build:worker
npm run preview
```

`npm run test` 只运行 Vitest 单元与规则集成测试，不使用 Playwright，也不会下载浏览器。浏览器验收使用本机已安装的 Chrome / Edge；手机布局可通过设备模拟复验，多指 pointer capture 最终仍应在真实触屏设备确认。测试前请把菜单主音量设为 `0`。

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
├── network/      # 共享协议、浏览器 WebSocket 和重连
├── server/       # 无 Cloudflare 依赖的联机权威房间运行时
└── game/         # 无 DOM/Babylon 依赖的权威规则状态与系统
worker/           # Cloudflare 大厅与比赛 Durable Objects
standalone/       # Node HTTP/WebSocket、本地 SQLite、alarm 与静态站适配
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
- 联机服务：<https://lastlinep2p.011203.xyz/health>
- 管理终端：<https://lastlinep2p.011203.xyz/admin>

GitHub Actions 在每次 PR 和 `main` 推送时执行应用、Worker、standalone 类型检查与 Vitest，以及静态生产构建、Worker dry-run 和 Node server bundle；`main` 通过后自动部署 GitHub Pages。Cloudflare Pages 和 `lastlinep2p` Worker 分别使用 Git 集成部署；自托管版独立使用本地数据，不与 Cloudflare 同步，配置见 [`docs/deployment.md`](docs/deployment.md)。

## 素材替换

所有素材由 `public/assets/asset-manifest.json` 的稳定 ID 引用。SVG、PNG、WebP 或 GLB 加载/解码失败时使用对应 fallback。

角色和武器 GLB 可通过清单元数据设置 `scale`、`offsetX`、`offsetY`、`offsetZ`，并用逗号分隔的 `requiredNodes` 校验必要节点。GLB 只影响视觉，命中盒和玩法数值由规则层固定定义。

## 当前边界

- 手机对局仅支持横屏；竖屏会暂停单机输入，联机服务器仍继续推进
- 联机支持游客和持久玩家账号两种准入模式，由管理员全局开关控制；暂不提供好友、排行榜或赛季数据
- 自托管第一版只支持单服务器、单 Node.js 进程；不支持多进程集群或与 Cloudflare 双向同步数据
- 不包含载具、投掷物、枪械配件、复杂弹道和可破坏场景
- 生产构建中的 Babylon/GLTF 按需 chunk 仍较大，但占位素材对局不会加载 GLTF chunk
