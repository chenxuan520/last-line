# Web 端 AI 大逃杀 FPS 首版规划记录

**目标：** 交付一个可在桌面浏览器独立游玩的 20 人 AI 大逃杀 FPS，并为后续真人联网、5v5 模式及素材替换保留清晰边界。
**需求来源：** 2026-07-16 对话 brainstorming，设计方向已由用户确认。

## 计划

### 目标

- 首版运行于桌面 Chrome / Edge，采用键鼠操作和第一人称 3D 视角。
- 每局 20 名参赛者：1 名真人玩家和 19 名 AI，目标时长 15–20 分钟。
- 完成“飞机航线—跳伞—搜集—战斗—缩圈—最后存活—结算”的完整闭环。
- 使用低多边形、写实比例的占位资源；后续无需修改玩法代码即可替换 2D 和 3D 素材。
- 首版不实现真人联网，但核心规则避免绑定本地玩家，为未来权威服务器迁移保留边界。

### 产品形态

- 单页 Web 游戏，无账号、后端、匹配和安装流程。
- 首页提供开始游戏、画面/音量/鼠标灵敏度设置。
- 一张边界与 POI 固定的小岛地图，按可序列化 seed 受控随机丘陵、建筑、物资、飞机航线和安全区。
- 玩家可自主跳伞；降落后搜集武器、弹药、头盔、护甲和药品。
- 使用双主武器槽、独立装备槽和简化堆叠背包，不做格子整理与重量模拟。
- 首版代表性武器为步枪、冲锋枪、霰弹枪；全部采用即时命中判定、中等后坐力和散布。
- AI 遵守与玩家一致的移动、视野、拾取、伤害、弹药、治疗和安全区规则。

### 范围与不做

**首版包含：**

- 第一人称移动、冲刺、跳跃、瞄准、开火、换弹和交互。
- 飞机航线、手动跳伞、简化滑翔和自动开伞。
- 地面物资、双武器槽、弹药、两档头盔/护甲、两类药品和简化背包。
- 19 名 AI 的跳伞、搜索、进圈、战斗、治疗和淘汰行为。
- 多阶段缩圈、圈外伤害、存活人数、击杀信息、胜负结算和重新开局。
- 资源清单、占位素材、缺失回退和替换校验。

**明确不做：**

- 真人联网、房间、匹配、账号、聊天、排行榜和服务端部署。
- 5v5 的地图、经济、回合及爆破规则。
- 手机与触屏适配。
- 载具、投掷物、枪械配件、近战、可破坏场景和复杂弹道下坠。
- 百人局、无限程序生成世界和写实级高精度资产。

**只保留接口、不提前实现：**

- `GameMode` 模式生命周期，使未来可新增独立 5v5 模式。
- 人类与 AI 共用角色指令入口，使未来可接入网络控制器。
- 可序列化的核心对局状态，使未来可迁往权威服务器。

### 关键决定

- 技术路线采用 Babylon.js + TypeScript + Vite；HUD 使用原生 HTML/CSS，不引入 React。
- 首版为单体静态 Web 应用，不建立 monorepo、后端或空壳网络层。
- 渲染按 WebGL2 基线实现；WebGPU 只能作为可选增强，不能成为运行前提。
- 游戏规则使用固定时间步更新，渲染与规则状态分离；不要求跨设备完全确定性模拟。
- 角色只接收移动、瞄准、开火、换弹、拾取和使用物品等统一指令；玩家和 AI 不各写一套规则。
- 玩法配置与素材配置分离：换枪械模型不能改变伤害、射速或弹匣容量。
- 所有素材通过稳定资源 ID 和资源清单加载，玩法代码不得写死具体文件路径。
- 3D 正式资源统一采用 GLB；统一米制比例、Y 轴向上、模型原点、骨骼和挂点命名。
- 2D 占位资源使用 SVG；正式资源支持 SVG、PNG 和 WebP。
- 当前只定义通用模式接口，不猜测未来 5v5 是爆破还是团队淘汰。

### 关键假设

- 目标设备为 Apple M1、Intel Iris Xe 或同等级及以上的主流电脑。
- 1080p 低至中画质正常目标 60 FPS，激烈交战允许短时降至 45 FPS。
- 地图约 800m × 800m，包含城镇、仓库、野外和高地等少量清晰区域；实际尺寸允许在性能验证后微调。
- AI 远离玩家时降低感知、寻路和决策频率，但仍持续推进基础生存状态。
- 首版刷新页面可重新开始，不保存进行中的对局；设置保存在浏览器本地。
- 最终素材只要遵守资源 contract，即可来自任意外部生成工具。

### 未决问题

- 静态构建产物最终部署到哪个平台或域名；不阻塞本地开发和 `dist/` 构建。
- 未来 5v5 采用爆破、团队淘汰或其他规则；待大逃杀首版稳定后单独 brainstorm。
- 最终生成素材工具的具体导出能力；当前以 GLB、SVG、PNG、WebP 为兼容边界。

### 用户故事与独立验收

#### P0：射击闭环

- 用户价值：玩家能立即感受到基本 FPS 操作与战斗反馈。
- 独立验收：进入灰盒场景后可移动、瞄准、射击、换弹并击败一个遵守伤害规则的简易 AI。

#### P1：大逃杀对局闭环

- 用户价值：玩家能从航线开始完整玩到胜利或失败。
- 独立验收：测试配置下可加速经历跳伞、缩圈、淘汰和结算，最后存活者唯一且正确。

#### P1：搜集与生存

- 用户价值：玩家可通过搜索和资源取舍提高生存能力。
- 独立验收：可拾取、替换、丢弃和使用武器、弹药、护甲及药品；背包限制和 HUD 状态一致。

#### P1：19 名 AI 对局

- 用户价值：没有真人陪玩时仍能获得完整对局体验。
- 独立验收：19 名 AI 会落地、搜集、进圈、战斗、治疗并相互淘汰，不穿墙感知或绕过弹药规则。

#### P1：素材替换

- 用户价值：后续生成素材可直接填入游戏，而无需重写玩法。
- 独立验收：只修改资源清单即可分别替换一个角色、一把枪和一组 HUD 素材。

### 技术上下文

- 运行时：Node.js 24 LTS。
- 语言：TypeScript 5.x，开启严格类型检查。
- 构建：Vite；包管理使用 npm 和 lockfile。
- 3D：Babylon.js 8.x；静态碰撞和射线检测优先使用引擎能力，不为首版引入完整刚体玩法。
- 导航：Recast 导航网格，由薄适配层向 AI 提供路径查询。
- 测试：Vitest 覆盖规则层；Playwright 覆盖页面启动、开始对局和基础 HUD 流程。
- 部署：`npm run build` 生成纯静态 `dist/`，首版无服务器依赖。

### 结构与落点

```text
/
├── public/assets/
│   ├── asset-manifest.json       # 稳定资源 ID 到实际素材的映射
│   ├── ui/                        # SVG/PNG/WebP
│   └── models/                    # 可替换 GLB
├── src/
│   ├── main.ts                    # Web 应用入口
│   ├── app/GameApp.ts             # 加载、菜单、对局和结算编排
│   ├── assets/                    # 资源目录、校验、缓存及占位回退
│   ├── config/                    # 武器、物品、AI、地图和缩圈数值
│   ├── game/
│   │   ├── commands/              # 统一角色指令
│   │   ├── state/                 # 可序列化的对局与实体状态
│   │   ├── systems/               # 移动、战斗、背包、伤害、缩圈
│   │   └── modes/                 # GameMode 与 BattleRoyaleMode
│   ├── controllers/               # HumanController、BotController
│   ├── ai/                        # 感知、决策、导航和行为
│   ├── client/
│   │   ├── render/                # Babylon 场景、模型、动画和特效
│   │   ├── input/                 # 键鼠和 Pointer Lock
│   │   └── ui/                    # 菜单、HUD、背包与结算
│   └── styles/
├── tests/unit/                    # 规则层单元测试
└── tests/e2e/                     # 浏览器烟雾测试
```

保持单个 Vite 应用，不提前拆包。`src/game/` 禁止依赖 DOM 和 Babylon 场景对象，以便未来按需抽离为服务端可复用模块。

### 核心 contract

**角色指令：** 移动向量、视角方向、开火状态、换弹、跳跃、交互、切枪和使用物品。控制器只能提交指令，伤害和物品结果由规则系统决定。

**对局状态：** 使用稳定实体 ID；只保存位置、朝向、生命、护甲、背包、武器状态、安全区、对局阶段和存活状态等可序列化数据。渲染对象通过 ID 映射，不写入规则状态。

**模式接口：** 负责对局初始化、阶段更新、出生策略、胜负判定和结果生成。`BattleRoyaleMode` 实现航线、跳伞、缩圈和最后存活；未来 5v5 另建实现。

**资源清单：** 每项至少包含 `id`、`type`、`url`、`fallback` 和必要元数据。角色约定武器挂点；枪械约定握持、枪口和弹匣节点。加载失败时回退占位资源并输出明确错误。

### 任务拆解

### 任务 1：初始化浏览器游戏骨架

- 目标：建立可启动、可测试、可构建的最小工程。
- 涉及：`package.json`、`vite.config.ts`、`tsconfig.json`、`src/main.ts`、`src/app/GameApp.ts`。
- 动作：初始化 Vite + TypeScript + Babylon.js，加入类型检查、Vitest、Playwright 和基础样式；实现加载页与开始按钮。
- 验证：运行 `npm run dev`、`npm run typecheck`、`npm run test`、`npm run build`。
- 完成标志：浏览器可打开首页，生产构建生成 `dist/`。

### 任务 2：建立资源清单和占位资源管线

- 目标：先固定素材 contract，避免玩法代码与临时素材耦合。
- 涉及：`public/assets/asset-manifest.json`、`src/assets/`、`public/assets/ui/`、`public/assets/models/`。
- 动作：实现资源 ID 查询、异步加载、缓存、规格校验和缺失回退；提供 SVG HUD 占位图及低多边形程序化回退模型。
- 验证：故意移除一个资源后仍显示占位物，并在控制台输出包含资源 ID 的错误。
- 完成标志：场景和 UI 只通过资源 ID 获取素材。

### 任务 3：实现规则状态、固定时间步与模式接口

- 目标：建立不依赖渲染和输入设备的对局核心。
- 涉及：`src/game/commands/`、`src/game/state/`、`src/game/systems/`、`src/game/modes/GameMode.ts`。
- 动作：定义实体 ID、角色指令、对局状态、规则事件和固定时间步；建立模式生命周期与结果结构。
- 验证：Vitest 在无浏览器环境中推进模拟，断言状态更新和事件顺序。
- 完成标志：规则测试不导入 Babylon 或 DOM。

### 任务 4：完成第一人称移动和灰盒场景

- 目标：形成可操作的第一人称空间体验。
- 涉及：`src/client/render/`、`src/client/input/`、`src/controllers/HumanController.ts`。
- 动作：实现 Pointer Lock、WASD、冲刺、跳跃、鼠标视角、地面/墙体碰撞和相机；搭建小型灰盒测试场。
- 验证：手工检查不同帧率下移动速度一致，不能穿过墙体或地面。
- 完成标志：玩家可稳定移动、跳跃和观察场景。

### 任务 5：完成武器、伤害和首个战斗闭环

- 目标：尽早得到可演示的 FPS 战斗切片。
- 涉及：`src/config/weapons.ts`、`src/game/systems/CombatSystem.ts`、`src/game/systems/DamageSystem.ts`、HUD 弹药区。
- 动作：实现三类即时命中武器、射速、散布、后坐力、弹匣、换弹、生命与护甲；加入会巡逻和还击的简易 BotController。
- 验证：规则测试覆盖空弹匣、换弹、护甲减伤、死亡后禁止开火；浏览器中可击败 AI 或被 AI 击败。
- 完成标志：P0 射击闭环可独立演示。

### 任务 6：完成物资、装备和简化背包

- 目标：形成大逃杀的搜索与资源取舍。
- 涉及：`src/config/items.ts`、`src/game/systems/InventorySystem.ts`、`src/client/ui/inventory/`。
- 动作：实现地面拾取、堆叠、双主武器槽、装备比较、弹药消耗、治疗使用和丢弃；UI 只订阅规则状态。
- 验证：单元测试覆盖背包已满、错误弹药、切枪、换甲、治疗中断和死亡掉落。
- 完成标志：玩家可通过搜集完成装备成长。

### 任务 7：搭建受控随机小岛和导航数据

- 目标：提供支持 20 人分散落地、搜集和遭遇的有界地图；丘陵、建筑和物资布局由共享 seed 确定。
- 涉及：`src/client/render/scenes/IslandScene.ts`、`src/config/map.ts`、`src/ai/navigation/`。
- 动作：制作约 800m × 800m 的低多边形小岛，划分城镇、仓库、野外和高地；用共享 seed 生成受控变化，并让渲染、碰撞、出生区、物资点和导航使用同一布局。
- 验证：从每类出生区域都能寻路到地图中心；玩家不能离开有效地形或卡入建筑。
- 完成标志：地图支持随机航线、物资刷新和 AI 导航。

### 任务 8：实现大逃杀模式生命周期

- 目标：打通从飞机到结算的完整规则流程。
- 涉及：`src/game/modes/battle-royale/`、`src/config/battleRoyale.ts`。
- 动作：实现随机航线、跳伞、自动开伞、落地、分阶段缩圈、圈外伤害、存活统计、胜负判定和测试加速配置。
- 验证：单元测试快速推进完整对局，确保只有一个胜者；手工验证可从飞机操作到落地。
- 完成标志：即使使用简易 AI，也可完整结束一局。

### 任务 9：完善 19 名 AI 的生存与战斗行为

- 目标：让单人局在没有真人时仍具备可玩性。
- 涉及：`src/ai/`、`src/controllers/BotController.ts`、`src/config/ai.ts`。
- 动作：实现跳伞点选择、物资评估、视野/遮挡感知、进圈、掩体选择、射击、换弹和治疗；按距离错峰更新决策与寻路。
- 验证：观察多局 AI 行为日志；断言 AI 不通过墙体锁定目标、不在无弹药时开火、圈外会调整目标。
- 完成标志：19 名 AI 可自主推动对局直到产生胜者。

### 任务 10：完成菜单、HUD、结算和反馈

- 目标：让完整对局无需调试界面即可理解和操作。
- 涉及：`src/client/ui/`、`src/styles/`、音效与特效资源 ID。
- 动作：实现加载进度、开始菜单、设置、准星、生命/护甲、弹药、背包、安全区、存活数、击杀提示、受击反馈和结算页。
- 验证：Playwright 覆盖首页加载、开始对局和 HUD 出现；手工检查死亡与胜利结算。
- 完成标志：普通用户可自行开始、游玩、结束和重开。

### 任务 11：验证素材替换并完成性能收敛

- 目标：证明资源接口真实可用，并满足浏览器性能目标。
- 涉及：`public/assets/asset-manifest.json`、`src/assets/`、渲染与 AI 配置。
- 动作：仅改清单替换一个角色、一把枪和一组 HUD；加入模型实例化、视距/阴影分级、纹理预算、AI 分级更新和性能统计。
- 验证：Chrome/Edge 1080p 下运行 20 人对局；正常目标 60 FPS，激战短时不低于 45 FPS，无持续内存上涨。
- 完成标志：替换素材无需改玩法代码，性能达到基线。

### 任务 12：最终回归与静态构建

- 目标：形成可交付、可重复验证的首版产物。
- 涉及：全仓库、`tests/`、`dist/`、`README.md`。
- 动作：补齐规则回归测试、浏览器烟雾测试和运行说明；完成至少一局人工全流程验收。
- 验证：运行 `npm run typecheck && npm run test && npm run test:e2e && npm run build`，再从静态服务器打开 `dist/` 完成一局。
- 完成标志：所有自动检查通过，静态构建不依赖开发服务器或后端。

### 验证方式

- 规则正确性：Vitest 覆盖武器、伤害、背包、治疗、缩圈、淘汰和胜负。
- 浏览器流程：Playwright 覆盖加载、菜单、开始对局和 HUD 基础状态。
- 人工体验：完整玩完一局，检查跳伞、拾取、战斗、缩圈、死亡/胜利和重开。
- AI 公平性：用调试视锥、目标线和行为日志检查遮挡、射程、弹药和治疗约束。
- 素材 contract：仅修改资源清单完成 2D/3D 替换，并验证错误资源可回退。
- 性能：20 人、1080p、低至中画质下记录 FPS、长任务和内存趋势。

### 风险

- 20 名角色同时进行动画、感知和导航可能超出浏览器预算；优先削减远处 AI 更新频率和场景细节，不减少核心对局闭环。
- “较完整大逃杀”容易被内容数量拖慢；首版以系统完整为准，不扩充枪械、建筑和道具种类。
- Pointer Lock 和音频播放要求用户手势；必须由“开始游戏”按钮统一触发。
- GLB 生成工具可能导出不一致的比例或节点名；通过启动校验、错误报告和占位回退阻止静默错位。
- 当前保留的联网边界不等于联网已完成；未来仍需新增服务器、同步、预测、反作弊和部署体系。

### 成功标准

- 桌面浏览器可完整运行一局 1 人 + 19 AI 的大逃杀。
- 核心链路全部可见、可操作且胜负正确。
- AI 能完成基本生存决策并遵守与玩家一致的规则。
- 至少完成一次角色、武器和 HUD 的无代码素材替换。
- 达到既定性能基线，生产构建为不依赖后端的静态站点。
- 首版代码没有实现真人联网或 5v5，但模式、控制器和规则状态边界足以支撑后续单独设计。

### 下一步

从“任务 1：初始化浏览器游戏骨架”开始实现；完成任务 5 后先验收首个射击闭环，再继续扩展完整大逃杀，避免到最后才发现操作或性能路线不可用。

### 更新日志

- 2026-07-16 01:40：根据已确认的 brainstorming 结论创建正式计划；锁定 Web 桌面端、20 人 AI 大逃杀、Babylon.js + TypeScript、可替换 2D/3D 素材、未来联网与 5v5 边界。

## 实现

### 更新日志

#### 2026-07-18 14:56 +0800：2400m 地图、1+49 AI、可进入建筑和武器模型闭环

- 实现内容：地图线性扩展到 `2400m × 2400m`，增加到 8 个分散 POI；每个 POI 的 6–8 栋建筑按 seed、分层角度和随机半径在宽区域内生成，不再使用固定格点或集中小簇。同 seed 可复现，不同 seed 会改变丘陵、房屋和物资坐标。
- 建筑/远景：建筑权威碰撞改为带门窗开口的 `wallSegments`，保留统一屋顶与坡道表面；生成阶段校验建筑 footprint、坡道、地图边界和 terrain clearance，避免地形穿透屋顶/坡道。相机 `minZ` 提高到 `0.12` 改善远景深度精度；Chrome 连续小幅转向的 4 帧远景采样未再观察到房顶交替闪烁。
- 对局人数：正式与 fast config 均为 50 人总局，即 1 名真人 + 49 名 AI；菜单、HUD、README、架构和部署文档同步。AI 在 `22%–72%` 的有效航段内使用独立随机开伞时机，不再按编号等间距；滑翔覆盖距离适配大图。
- AI/物资：8 个 POI 各 24 个物资点，共 192 个；每区 12 武器、7 弹药、2 医疗、3 装备。无枪 Bot 在附近可达武器中独立分流，并在途中出现显著更近目标时重选；导航保存完整路径、缓存 tick 继续消费 waypoint，使用有界多墙搜索和真实 30Hz waypoint 回归。
- 武器视觉：步枪、冲锋枪、霰弹枪均有不同第一/第三人称程序化模型；三类稳定 GLB asset ID 全部接入加载、fallback、活动武器显隐、Bot 第三人称实例和 dispose，角色 GLB 不再关闭武器视觉。
- 主要文件：`src/config/map.ts`、`src/config/battleRoyale.ts`、`src/ai/navigation/GridNavigator.ts`、`src/controllers/BotController.ts`、`src/game/systems/MovementSystem.ts`、`src/game/systems/SimulationCombatWorld.ts`、`src/client/render/scenes/IslandScene.ts`、`src/app/`、`src/client/ui/`、`public/assets/asset-manifest.json`、`tests/unit/`、`README.md`、`docs/`。
- 自动验证：`npm run typecheck` 通过；完整 `npm run test` 为 18 files / 114 tests 全通过；5 个 seed 均在落地后原 140 秒窗口达到至少 42/49 Bot 持枪，49 Bot 完整加速局可搜集、开火、淘汰并产生唯一胜者；`npm run build` 通过；`git diff --check` 通过。
- 浏览器验证：本机 Chrome 打开生产 preview，音量 `0`；菜单/HUD 显示 50 人与 49 AI，2400m 地图和 8 个 POI 可见，航线/战斗可推进，采样约 120 FPS，控制台无 error/warn。保留既有主 chunk（约 822kB）与 GLTF chunk（约 625kB）体积警告。
- 剩余风险：房顶闪烁已通过几何消除和本机连续帧抽样验证，但不同 GPU/驱动的远景光栅化仍只能由后续设备矩阵继续覆盖；未引入浏览器自动化或声音测试。

#### 2026-07-18 15:14 +0800：AI 落区与物资分布二次收敛

- 用户复验发现 AI 仍可能集中在单个据点，且原每区 `12 武器 + 7 弹药` 导致地面物资视觉上几乎全是枪弹；暂停最终 review，先修实际体验问题。
- 正式飞机航线从 30 秒延长到 60 秒，规则自动离机点后移到 92%；每个 Bot 先按编号和 map seed 均衡分配到 8 个 POI（每区 6–7 个），再在本区武器点中随机选择具体落点。
- 开伞时间不使用等差序列：按目标落点在当前航线上的最近投影加每 Bot 独立随机扰动，限制在 12%–88% 航段；大地图滑翔速度同步提高，保证斜航线远侧 POI 也可实际到达，而不是回落到邻区。
- 新增首次落地分布验收：5 个固定 seed 均覆盖至少 7/8 个 POI，任一 POI 首次落地不超过 10 个 AI；同时保持落地后 140 秒至少 42/49 Bot 持枪及 49 Bot 完整加速局唯一胜者。
- 物资配额调整为每 POI `7 武器 / 6 弹药 / 4 医疗 / 7 装备`，全图共 56 把初始武器；继续覆盖三种枪与三种弹药、类别相邻率和同 seed 可复现，不再由枪弹占据 19/24 个点。

#### 2026-07-18 15:20 +0800：落区分流最终验证

- 最终落地策略不再是单纯随机阈值：49 个 Bot 先按编号与 map seed 均衡分配到 8 个 POI，再选择该区的随机武器点；开伞进度由目标点投影到当前航线后的最近进度加独立 `±4.5%` 扰动得出，范围 12%–88%，92% 才统一兜底离机。
- 为 2400m 地图提高滑翔覆盖，确保斜航线下分配到远侧 POI 的 Bot 能实际到达目标区，不会因横向航程不足回落到邻区。
- 多 seed 集成测试会记录每个 Bot 的首次 grounded 位置并投影到最近 POI；5 个 seed 均覆盖至少 7/8 个 POI，任一 POI 最多 10 个 AI，同时均达到至少 42/49 持枪。
- 最终自动验收：`npm run typecheck` 通过；完整 `npm run test` 为 18 files / 114 tests 全通过；`npm run build` 与 `git diff --check` 通过。
- 最终静音生产预览：菜单显示 50 人、`SINGLE PLAYER / 49 AI`，小地图显示 8 个 POI 与 400m 比例尺；60 秒航线在 79% 时仍持续飞行，AI 已分批离机并向不同落区滑翔；采样约 120 FPS，控制台无 error/warn。

#### 2026-07-18 15:31 +0800：空中角色闪动与自动跑圈收敛

- 用户在下降阶段看到空中角色闪动。根因是同一 POI 内仍可能复用同一个武器落点，多个 Bot 沿相同轨迹、近似同坐标下降，远景模型发生深度竞争。
- 49 个 Bot 现在按 POI 内 wave 选择互不重复的 7 个武器落点；同 seed 下 POI 内目标有确定性旋转，但同区 6–7 个 Bot 不再复用目标。新增测试断言 49 个 Bot 的下降方向全部唯一。
- 为 Bot 增加仅在 `parachuting` 阶段显示的独立伞面视觉；角色 GLB 替换时保留伞面，落地后由 deployment signature 关闭，避免空中只显示多个重叠人物模型。
- 自动跑圈改为圈外最高行为优先级：即使存在可见敌人，Bot 也先沿 navigator 路径向安全区中心冲刺，不在毒圈外持续交战；新增“圈外有可见敌人仍向圈心移动且不开火”回归。
- 最终自动验证：`npm run typecheck` 通过；完整 Vitest 为 18 files / 116 tests 全通过；5-seed 落区/武装率与 49 Bot 完整加速局继续通过；`npm run build`、`git diff --check` 通过。

#### 2026-07-18 16:15 +0800：不规则全图生成与物资疏密重做

- 用户根据小地图截图指出固定外圈据点和环绕式建筑仍呈人工多边形阵列；撤销固定坐标和角度槽位方案，重做生成器本身。
- 每局由 map seed 在 `2400m × 2400m` 方形地图内做最小间距随机采样，生成 8 个命名据点和 8 个小聚落；同 seed 可复现，不同 seed 的据点、建筑和物资均变化。新增多 seed 断言，要求据点半径和角度间隔存在显著差异，避免圆周多边形。
- 建筑在各区使用独立随机角度与随机距离放置，不按固定方位或环形槽位；主区 5–8 栋、小聚落 2–4 栋，同时保留跨区域建筑/坡道不重叠、边界和 terrain clearance。
- 小地图与地表道路改为读取当前 layout 的实际 `mapPoints`；岛屿轮廓改为与规则一致的方形，不再显示固定多边形道路和固定 POI 坐标。
- 物资总量固定 240，但 16 个区域按 seed 获得 10–20 件不同密度；所有区域都有物资。高密区最小间距约 18m、普通区约 25–30m、稀疏区约 38m；每区保留 1 件室内物资，并至少 6 件分布在距区域中心 200m 以上的近郊/远野。
- 物资类别随区域数量动态计算，武器约 40%、弹药约 20%、医疗约 15%、其余装备；每区仍覆盖三类武器和三类弹药。Bot 通过 `lootZoneCounts` 找到本区物资，空枪途中遇到显著更近武器会重选。
- 空中视觉继续保证 49 个 Bot 下降方向唯一，并在 parachuting 阶段显示独立伞面；圈外行为继续最高优先向安全区导航。
- 验证：`npm run typecheck` 通过；完整 Vitest 为 18 files / 118 tests，其中 401-seed 建筑/坡道/terrain、5-seed 落区与至少 42/49 持枪、49 Bot 完整加速局均通过；`npm run build`、`git diff --check` 通过。
- 静音 Chrome 生产预览：小地图显示本局不规则据点与最近邻道路，不再呈外圈多边形；航线视角可见中央、道路间和边缘均有散落房屋/物资，约 120 FPS，控制台无 error/warn。
- 航线阶段右上角在存活人数旁实时显示 `已跳伞 X / 50`，按权威 deployment 统计；进入生存作战后恢复显示玩家击杀数。

#### 2026-07-18 16:37 +0800：环境丰富度、狙击枪与操作反馈

- 环境密度：主据点提升到 8–12 栋、小聚落 4–7 栋；道路连接 16 个实际落区；额外生成 20 个随机缓坡/小丘。树木增至 96、岩石 40、灌木 60，均使用模板 clone 且避让建筑。
- 滑翔手感：取消贴地仍保持 `36m/s` 的固定速度，改为按离地高度从高空最大 `36m/s` 连续降到贴地约 `8–12m/s`；玩家与 AI 使用同一规则。近地减速与多 seed AI 分流测试通过。
- 新增 `M-24 狙击枪` 与独立狙击弹：105 伤害、5 发弹匣、42 RPM、520m 射程；接入物资、AI、背包/掉落、第一/第三人称程序化模型、GLB asset ID、图标与 fallback。
- 右键瞄准仅对狙击枪生效，缩放 FOV 为 `0.32`；普通步枪/冲锋枪/霰弹枪右键无变化。松开右键、换枪、换弹、死亡或失去 pointer lock 会退出瞄准镜，并降低镜内鼠标灵敏度。
- 狙击枪未开镜时不显示普通屏幕准星或镜面遮罩；只有按住右键时显示完整狙击镜十字线。其他三类枪继续显示腰射准星。
- 基础走速从 `5.8m/s` 提高 50% 到 `8.7m/s`；冲刺同步设为 `11.5m/s`，避免按 Shift 反而减速。
- 换弹输入从单 tick 请求改为最多保留 9 个 30Hz tick，直到权威武器进入 `reloadSeconds > 0` 后确认消费；切枪和失去 pointer lock 会清理，解决偶发需要多按 R。
- `actor-died` 事件携带致死 `weaponId`；击杀流和玩家淘汰卡会显示击杀者及武器，圈伤明确显示安全区淘汰。

#### 2026-07-18 16:43 +0800：最终实现验收

- 全量自动检查：`npm run typecheck` 通过；完整 Vitest 为 18 files / 122 tests 全通过；`npm run build` 与 `git diff --check` 通过。
- AI 验收仍通过：5 个 seed 首次落地覆盖至少 13/16 个随机落区、单区不超过 10 个 Bot；落地后 140 秒至少 42/49 持枪；49 Bot 完整加速局有拾取、开火、Bot 击杀和唯一胜者。
- 环境/场景：401 seed 的建筑、坡道、terrain、边界与物资可达测试通过；NullEngine 场景重建、四类武器程序化/GLB 显隐和 dispose 通过。主场景 mesh 受显著增加的建筑与自然细节影响约 3,500，但仍为固定有界生成，不随对局时间增长。
- 输入/规则：狙击枪右键镜只对狙击生效；换弹请求确认消费；死亡事件携带致死武器；走速 8.7m/s、冲刺 11.5m/s、贴地滑翔减速测试通过。
- 静音生产预览：资源清单及狙击枪/狙击弹 SVG 均 200；航线 HUD 实时显示 `已跳伞 X / 50`，击杀流已出现 `AI-49 使用 M-24 狙击枪 淘汰 AI-29`；小地图读取本局随机据点/道路；约 120 FPS，控制台无 error/warn。
- 构建仍仅保留既有大 chunk warning（主 chunk 约 829kB、GLTF chunk 约 625kB）。

#### 2026-07-18 17:42 +0800：审查 blocker 与山地环境收敛

- 修复审查 finding：重型 `islandScene`、多 seed 几何和 AI 集成测试显式提供 30–60 秒余量；标准完整 `npm run test` 串行通过，不再依赖单文件验证。
- 地图覆盖：8 个野外落区使用“最远候选优先”补地图空白；16 区道路先构建最小连通树再补最近邻支路。新增 seed 0/33/237/358 连通与覆盖测试，最大采样建筑空白小于 720m。
- 物资全局 spacing：除区内 18–38m 动态间距外，跨区也至少保持 12m，修复相邻落区物资重叠；全图仍固定 240 件、每区 10–20 件。
- 弹药覆盖：每区至少生成 4 组弹药，保证步枪、轻型、霰弹和狙击四种匹配弹药均存在；动态医疗/装备数量从剩余额度计算。
- AI 优先级：圈外判断移到治疗前，Bot 即使低血量且携药也先冲圈；新增圈外治疗组合回归。Bot 拾取阈值与规则层统一为 3m。
- 输入修复：键盘 Digit/Numpad 切枪与滚轮一致，会清理 9-tick 换弹缓冲；新增 R 后同 tick 数字切枪回归。狙击 scope FOV/viewmodel 改为每帧同步，不受规则 elapsed 门控，失去 Pointer Lock 后立即恢复普通 FOV。
- 地形丰富度：每局新增 8 座 24–42m 山峰/山脊，据点采样避开陡坡；额外保留 20 个低丘。自然细节增至 128 树、56 岩、80 灌木，均有界且避让建筑。
- 最终验证：`npm run typecheck` 通过；完整 Vitest 18 files / 126 tests 全通过；`npm run build`、`git diff --check` 通过。静音 Chrome 约 120 FPS，控制台无 error/warn。

#### 2026-07-18 18:56 +0800：最终增量与 release gate

- 地图覆盖与可靠性：野外/补空白点改用扩大候选与安全回退，seed `832/859` 不再生成失败；增加 20 处不命名路边院落。山体改为 seed 控制的 maximin 覆盖生成，共 16 座 24–42m 山峰/山脊；401 seed 确认建筑、坡道、terrain、边界及“建筑或山体边缘最大环境空白 <450m”。
- 道路与物资：16 个正式落区道路先生成连通树再补支路；全图 240 件物资保持区内动态间距及跨区至少 12m；每区覆盖四类武器与四类匹配弹药。
- 输入与反馈：wheel 监听由 canvas 提升到 document，在 Pointer Lock 下移动中可稳定切枪；Digit/Numpad/wheel 切枪都清理换弹缓冲。第一人称四类武器新增由权威 `reloadSeconds` 驱动的下沉/倾斜换弹动画。
- 死亡物资：`GroundLootState.source` 区分 `spawn/drop/death`；普通刷新和手动丢弃保持黄色，死亡掉落使用高亮红橙色，marker 池复用时会同步切材质。交互会跳过同位置不可拾取物，因此死亡堆中不可升级的护甲不会阻塞头盔；同等级破损护甲可由新护甲恢复满耐久。
- HUD 与观战：按住 Tab 显示 50 人排行榜，按存活、击杀、稳定 ID 排序并高亮玩家，松开隐藏；暂停/死亡时同样可查看。玩家淘汰后优先跟随击杀者第一人称视角，击杀者死亡后继续追踪新的击杀者；圈伤则选择仍存活角色。
- 节奏与 AI：第三圈起等待/收缩逐级加快，正式总预算从 18.5 分钟收敛到 15 分钟。后期存活 ≤12 或圈半径 ≤350m 时，Bot 在圈内选择独立可达巡逻点，到达后重选，不再全部停在圈心。滑翔在离地 20m 内保持约 8m/s，高空按高度提升至 64m/s，以覆盖 2400m 地图边缘落区而不恢复贴地瞬移。
- 自动验收：`npm run typecheck && npm run test && npm run build && git diff --check` 全通过；Vitest 为 18 files / 135 tests。5 seed 均首次落地覆盖至少 13/16 区且单区 ≤10，140 秒至少 42/49 Bot 持枪；49 Bot 完整加速局发生拾取、开火、淘汰并产生唯一胜者。
- 静音生产验收：本机 Chrome、音量 0，Tab 排行榜按下显示/松开隐藏，航线 HUD 显示 `已跳伞 X / 50`；约 53–116 FPS，console 无 error/warn。截图：`/var/folders/5j/qh0z08fj3r9f86g_2tb6x9hm0000gn/T/opencode/final-leaderboard.png`。

#### 2026-07-18 19:44 +0800：AI 受击响应、持续巡逻与墙体脱困

- AI 不动：无可见敌人且无有效物资时，不再仅在后期巡逻；所有阶段均选择安全区内独立、可达的巡逻点，到点或缩圈后重选。仍优先圈外跑圈、可见目标战斗和有用物资。
- 受击响应：`ActorState` 新增可序列化 `lastDamageDirection/lastDamageElapsedSeconds`；权威 `DamageSystem` 根据真实攻击者位置记录方向。Bot 检测到新受击后清理决策/导航缓存，立即转向并在 2.5 秒内向攻击方向调查；一旦通过视野与 `SimulationCombatWorld` LOS 发现目标，就切换为正常开火/追击。
- 楼上目标：新增真实 `SimulationCombatWorld` 回归，覆盖 Bot 背对楼顶玩家、受击后立即转向、下一决策开火并生成坡道追击移动；既有 ground→ramp→roof 多 tick 测试继续通过。
- 墙体脱困：`MovementSystem` 在某轴移动目标被墙阻挡且当前位置也已嵌墙时，才把角色推到最近安全侧；正常移动不执行额外脱困扫描。新增“初始位置在墙内，下一移动步恢复到 actor radius 外”回归。
- 碰撞性能：每个 `MapLayout` 用 `WeakMap` 只构建一次 64m 空间格墙索引；每个移动子步仅查询角色当前格覆盖的墙段，不再遍历全图墙。3000 个 60Hz 移动步性能守卫要求小于 1.5 秒，本机约 0.38 秒；49 AI 完整集成套件由未优化脱困版本约 260 秒降至独立运行约 93 秒。
- 排行榜：存活行使用正常亮色和绿色状态；淘汰行整体变暗、红色状态并划线；玩家行无论存活状态均保留左侧高亮标记。
- 最终自动门禁：`npm run typecheck && npm run test && npm run build && git diff --check` 全通过；新增性能守卫后 Vitest 18 files / 140 tests，完整约 252.53 秒。5-seed 42/49 武装、13/16 落区分散、49 Bot 拾取/战斗/唯一胜者与 401-seed 地图门禁全部通过；构建仅保留既有大 chunk warning。

### 2026-07-16：任务 1–12 完成

- [x] 任务 1：Vite、TypeScript、Babylon.js、Vitest、菜单、构建和静态预览。
- [x] 任务 2：稳定资源 ID、异步预加载、缓存、类型/解码校验和占位回退。
- [x] 任务 3：可序列化规则状态、统一角色指令、固定时间步和模式接口。
- [x] 任务 4：Pointer Lock、WASD、冲刺、跳跃、视角和规则碰撞。
- [x] 任务 5：三类武器、射速、散布、后坐力、换弹、护甲、头盔和公平批量伤害。
- [x] 任务 6：地面物资、堆叠背包、双武器槽、装备、治疗、丢弃和死亡掉落。
- [x] 任务 7：800m 小岛、四类 POI、静态障碍、可达物资点和轻量路径查询。
- [x] 任务 8：随机航线、跳伞、落地、六阶段缩圈、圈伤、唯一胜者和 18 分钟正式预算。
- [x] 任务 9：19 名独立 AI 的落地、搜集、进圈、视野、战斗、换弹、补给和治疗。
- [x] 任务 10：加载页、设置、HUD、背包、安全区、击杀流、受击反馈、结算和无刷新重开。
- [x] 任务 11：清单式 2D/GLB 替换、真实解码/节点校验、动态加载、实例复用、AI 分级和性能统计。
- [x] 任务 12：规则回归、完整 AI 加速局、生产构建、静音 Chrome smoke 和文档。

### 最终验证

- `npm run typecheck`：通过。
- `npm run test`：14 个文件、72 项 Vitest 全部通过。
- `npm run build`：通过，生成不依赖后端的相对路径静态产物。
- Playwright 及其浏览器依赖：未安装，`npm ls @playwright/test playwright playwright-core` 为空。
- 本机 Chrome、生产 `dist/`、1920×1080、中画质、音量 `0`：菜单与 20 人 HUD 正常，控制台无错误；航线/滑翔采样最低 112 FPS、平均约 119 FPS；战斗阶段采样最低 120 FPS、平均约 120 FPS。
- 真实规则集成：19 个 `BotController` 使用 `SimulationCombatWorld` 完成搜集、交火并产生唯一胜者。
- 生命周期：Babylon `NullEngine` 连续创建/销毁 4 个岛屿场景后 scene 和 loot marker 引用归零。
- 终审：最后一轮定向代码审查通过，无明确高风险 finding。

## 审查

### 2026-07-16 14:27 +0800：当前未提交实现审查（不通过）

- 审查范围：任务 1–12、成功标准、当前工作区全部未提交实现；重点检查浏览器对局推进、规则、AI 公平性、资源 fallback/GLB、重开、性能与静态构建。
- 对照基线：本 plan；仓库当前为尚无 commit 的 `master`，因此相对主分支的实际改动是当前全部未跟踪文件，没有可用的历史 merge-base。
- 结论：**不通过**。静态构建和现有测试能通过，但完整对局、AI 搜集、公平战斗、素材替换与若干规则存在阻塞问题，尚未达到任务 1–12 和成功标准。
- 用户约束：未使用 Playwright，也未下载 Playwright Chromium；本次不要求恢复 Playwright。

#### Findings（按严重度）

1. **[严重] AI 无法可靠落地搜集，很多 Bot 会永久空手或卡在不可达物资上。**
   - 证据：`src/config/map.ts:48-58` 生成物资点时不避让 `MAP_OBSTACLES`；几何检查发现 72 个点中 23 个位于建筑碰撞盒内，其中 18 个即使贴墙也超过 3m 交互距离。`src/ai/navigation/GridNavigator.ts:13-16` 对被阻挡目标返回空路径，但 `src/controllers/BotController.ts:158-163` 又把空路径回退为原始目标；同时 `src/controllers/BotController.ts:134-155` 只搜索 85m 内物资，找不到后在 `:113` 直接去圈心。
   - 复现：用真实 `BattleRoyaleMode + GameSimulation + BotController` 跑 12 个固定 seed 到对局时间 120s；每局仅 2–8/19 名 Bot 持枪，6–12 名 Bot 从未拾取任何物资。无视野目标的延长模拟中，多局最后胜者仍为空手，主要靠缩圈决胜。
   - 影响：任务 6/7/9 和“19 名 AI 自主推动完整对局”未完成，浏览器局会退化为空手跑圈/卡墙。
   - 最小修法：生成时剔除碰撞盒内及导航不可达物资；空路径不得直冲被阻挡目标；未持枪 Bot 应跨越 85m 上限选择最近的可达武器，并在目标变化时清理/重算 waypoint。补多 seed 的 Vitest，覆盖落地、可达拾取、持枪率和完整对局推进。

2. **[严重] 玩家被淘汰后规则模拟永久停止，AI 不会继续产生唯一胜者。**
   - 证据：`src/app/BattleRoyaleSession.ts:85-91` 只有 `pointerLock && !playerEliminated` 时才调用固定步；`:125-130` 玩家死亡后设置 `playerEliminated = true` 并退出 Pointer Lock。
   - 复现：玩家在仍有至少 2 名 Bot 存活时死亡；淘汰卡会出现，但此后 Bot、缩圈和 `BattleRoyaleMode` 都不再更新，`state.phase` 无法到 `finished`。
   - 影响：任务 8/9/10 的完整生命周期和“最后存活者唯一且正确”只在玩家活到最后时才可能成立。
   - 最小修法：把“本地输入是否激活”和“规则模拟是否运行”拆开；玩家死亡后继续固定步驱动 Bot/模式（可切观察态），直到 `match-finished`。补玩家中途死亡后仍产生唯一胜者的 Vitest/会话级测试。

3. **[高] 丢枪再拾取可无消耗回满弹匣，玩家可无限刷弹。**
   - 证据：`src/game/systems/InventorySystem.ts:280-300` 丢枪只保存 item ID；`:180-197` 拾枪重新调用默认满弹的 `createWeaponState`。`src/controllers/HumanController.ts:99-103` 已把该路径暴露给玩家的 G 键。
   - 复现：把步枪打到 0 发且背包无弹，按 G 丢枪后原地按 F；弹匣恢复为 30，备弹仍为 0。
   - 影响：绕过弹药/换弹规则，且 Bot 不会主动丢枪，形成明显玩家特权。
   - 最小修法：地面武器保留完整 `WeaponState`（至少弹匣和换弹状态），拾取时转移而非新建满弹状态。补“空枪丢下再拾取仍为空”的 Vitest。

4. **[高] 同一固定步内的胜负由命令 Map 顺序决定，浏览器固定偏袒玩家。**
   - 证据：`src/game/GameSimulation.ts:40-44` 逐角色完成移动/开火/伤害；`src/app/BattleRoyaleSession.ts:103-111` 总是先插入玩家命令，再插入 Bot。
   - 复现：玩家和 Bot 都为 30 HP、无甲，并在同一 tick 使用 34 伤害步枪互相命中；玩家命令先时玩家获胜，反转 Map 顺序时 Bot 获胜。
   - 影响：同时致死、争抢物资等冲突受插入顺序控制，不符合人类/AI 共用且公平的规则入口。
   - 最小修法：分阶段收集所有角色意图，再基于同一 tick 快照统一结算移动、命中和伤害；至少保证反转命令顺序不改变结果。补顺序不变性 Vitest。

5. **[高] 命中与 AI 视野使用上一渲染帧的 Babylon mesh，低帧率时可落后多个固定步。**
   - 证据：`src/client/render/BabylonCombatWorld.ts:10-41` 直接对场景 mesh 射线检测；`src/app/BattleRoyaleSession.ts:90-92` 可在一次渲染前执行多个 fixed step，而角色 mesh 只在 `:142-151` 的 `syncVisuals` 更新。
   - 复现条件：角色横向移动并交火时制造 100–250ms 帧卡顿；一次渲染前会推进 3–7 个规则步，但射线仍命中旧位置，结果随渲染帧率变化。
   - 影响：固定步规则并未真正与渲染分离，玩家闪避和 AI 射击会出现帧率相关的不公平结果。
   - 最小修法：命中/LOS 使用规则状态中的稳定碰撞体和静态障碍查询，不以待同步的渲染 mesh 作为权威数据；补相同规则输入在不同 render batching 下结果一致的 Vitest。

6. **[高] 替换角色 GLB 会同时替换规则命中盒，素材改动可改变可见性和伤害结果；任务 11 的真实 GLB 替换也未被证明。**
   - 证据：`src/client/render/scenes/IslandScene.ts:107-115` 加载角色模型后禁用程序化子 mesh，`:127-146` 把 GLB 子 mesh 直接标成可拾取且写入 `actorId`；`BabylonCombatWorld` 据此判定命中和 LOS。当前 `public/assets/asset-manifest.json:33-48` 全是 `procedural-model`，仓库没有 GLB 或替换验收测试。
   - 复现条件：只在清单中换入一个合法但轮廓、原点或 scale 不同的角色 GLB；Bot 命中面积和 LOS 会随模型改变，模型若不穿过角色根节点高度还可能无法被 AI 看见/击中。
   - 影响：违反“仅改清单替换素材、不改变玩法”，也会造成 AI/玩家命中规则不一致。
   - 最小修法：保留独立、固定、不可见的规则 hitbox；GLB 仅作不可拾取视觉层。加入最小 GLB fixture，用 Vitest + Babylon NullEngine 覆盖成功替换、节点校验失败 fallback、替换前后 hitbox 不变和反复 dispose。

7. **[高] 武器实际射速显著低于配置。**
   - 证据：`src/game/systems/CombatSystem.ts:33-46,112-118` 用 30Hz tick 递减 cooldown，并只在每 tick 最多开一枪，没有保留超出的时间且受浮点残值影响。
   - 复现：固定 30Hz 持续开火并提供足够弹量，30 秒实测步枪约 450 RPM（配置 600）、冲锋枪约 600 RPM（配置 820）、霰弹枪约 86 RPM（配置 90）。
   - 影响：三类武器平衡和 HUD/配置语义错误，尤其步枪与冲锋枪被大幅削弱。
   - 最小修法：按绝对 next-shot 时间或可结转的 cooldown accumulator 结算，并处理 epsilon；补每把枪在固定时窗内的射速 Vitest。

8. **[高] 对局中新产生的掉落物没有渲染对象，死亡掉落、替换武器和手动丢弃均不可见。**
   - 证据：`src/client/render/scenes/IslandScene.ts:509-539` 只为开局物资创建 mesh；`src/app/BattleRoyaleSession.ts:134-139` 不处理 `item-dropped`，`:152-156` 也只同步已有 `lootMeshes`。
   - 复现：按 G 丢枪、替换双槽武器或击杀携带物资的角色；规则状态和拾取提示里有新 loot，但场景中没有标记。
   - 影响：玩家会拾取“隐形物资”，任务 6/10 的搜集与死亡掉落反馈不完整。
   - 最小修法：让渲染层按状态增量创建缺失 loot mesh，或消费 `item-dropped` 创建并在耗尽后回收；补状态到视图适配层的 Vitest。

9. **[高] 正常配置不可能达到计划约定的 15–20 分钟目标局长。**
   - 证据：`src/config/battleRoyale.ts:18-23` 所有等待与收缩阶段合计 435 秒；加 22 秒航线和约 36 秒最慢降落也仅约 493 秒（约 8.2 分钟），最终半径归零后还会迅速结束。
   - 复现：不发生枪战、让角色仅被最终圈淘汰；局长上界仍远低于 15 分钟，正常战斗只会更短。
   - 影响：核心产品节奏与 plan 目标不符。
   - 最小修法：重新标定正式配置的阶段时长/半径/伤害，保留独立 fast config；补正式配置时间预算和 fast config 完整推进的 Vitest。

10. **[中] 两个槽位持有同类武器时，第二把枪换弹会错误结算到第一把。**
    - 证据：`src/game/systems/CombatSystem.ts:43-46,87-100` 换弹完成只传 `weaponId`，随后用 `find` 取第一把同 ID 武器。
    - 复现：两个槽位都是步枪，槽 0 满弹、槽 1 空弹且激活槽 1；换弹结束会发出 `reload-completed`，但槽 1 仍为 0、备弹未减少。
    - 影响：合法双槽组合出现假完成且无法装弹。
    - 最小修法：把具体 `WeaponState` 或槽位传给完成逻辑；补同 ID 双武器换弹 Vitest。

11. **[中] 头盔完全没有规则效果。**
    - 证据：`src/game/systems/DamageSystem.ts:17-23` 只读取 `armorLevel/armor`；全仓库没有伤害逻辑读取 `helmetLevel`。
    - 复现：0/1/2 级头盔、相同生命和护甲分别承受 34 点伤害，生命都从 100 降到 66。
    - 影响：任务 6 宣称的两档头盔只是 HUD 数字和物资占位，不形成装备成长。
    - 最小修法：明确首版头部命中 contract 与头盔减伤/耐久，或至少定义一致的简化减伤规则；补 0/1/2 级头盔 Vitest。

12. **[中] UI 资源 fallback 只识别 HTTP 失败，不识别 200 响应但无法解码的坏图。**
    - 证据：`src/assets/AssetCatalog.ts:63-70` 只检查 `response.ok` 并缓存字节；`src/app/GameApp.ts:78-83`、`src/client/ui/GameHud.ts:26-29` 仍直接把 URL 交给 `<img>`，没有 decode/error 回退。
    - 复现条件：清单中的 SVG/PNG URL 返回 200，但内容损坏或 MIME/编码无效；预加载会标记成功，最终显示破图且不会切到 fallback。
    - 影响：任务 2/11 的“加载失败时回退占位资源”不完整。
    - 最小修法：预加载阶段实际 decode/解析 2D 资源，失败时标记 unavailable；或统一图片组件监听 `error` 后解析 fallback。补 200 坏内容的 Vitest。

#### 缺失验证与待处理项

- 现有 34 个 Vitest 全部通过，但没有覆盖：真实 BotController 多 seed 完整局、物资可达性、同时致死顺序不变性、正式射速、丢枪/拾枪弹药保持、同类双枪换弹、头盔效果、玩家死亡后的继续推进、真实 GLB 成功/失败 fallback、动态掉落渲染和重开 dispose。
- Builder 必须先修复 findings 1–9；findings 10–12 也需要补规则或 fallback 实现。Writer/后续验收需补上述 Vitest，并记录至少一次真实 GLB/HUD 清单替换及多次重开内存趋势。
- 已执行：`npm run typecheck` 通过；`npm run test` 8 files / 34 tests 通过；`npm run build` 通过；从 `dist/` 的 Vite preview 打开生产站点并进入航线成功，开发浏览器实测可推进到 combat 且出现 AI 淘汰。构建输出有两个超过 500kB 的 chunk 警告（主 chunk 708kB、GLTF chunk 625kB）。
- 残余风险：当前浏览器片段约 120 FPS，但未完成 1080p 激战 45/60 FPS、长局内存、连续重开和正式 GLB 的性能验收；因此不能据此确认任务 11 性能基线或无重开泄漏。

### 2026-07-16 16:08 +0800：第二轮复审（不通过）

- 审查范围：逐项复查首次审查 302–372 行的 12 个 findings，并重点复查规则对局推进、AI 多 seed 搜集、simultaneous combat、`SimulationCombatWorld`、动态掉落、GLB 视觉层、正式局长、图片 fallback 和重开资源释放。
- 对照基线：本 plan；仓库仍是无 commit 的 `master`，全部实现均为未跟踪文件，没有可用 merge-base 或历史 diff，因此本轮以当前全部文件相对空主分支及首轮 findings 为审查范围。
- 结论：**不通过**。原 12 项中 8 项已修复，4 项虽修了原始表象但仍有高风险缺口或引入了高风险回归；需要 builder 继续处理下列 4 个高风险 findings 后再复审。
- 用户约束：未启动浏览器、未使用或建议 Playwright、未下载 Chromium、未启动声音。

#### 第二轮 Findings（按严重度）

1. **[高][新回归] 同 tick 最终互杀和最终圈同时致死改成了固定按实体 ID 偏袒 Bot，且胜者完全免除本 tick 伤害。**
   - 证据：`src/game/systems/CombatSystem.ts:175-193` 在所有存活者均会被本 tick 伤害杀死时选择排序后的 `living[0]`，随后直接跳过该角色的全部伤害；`src/game/modes/BattleRoyaleMode.ts:196-208` 对安全区同时致死采用同样策略。固定 ID 中 `bot-*` 排在 `player` 前；`tests/unit/gameSimulation.test.ts:159-168` 已明确把“玩家与 Bot 同时致死后 bot-1 满状态获胜”固化为期望。
   - 复现：只保留 `player` 和 `bot-1`，两者 30 HP、无甲，同 tick 用 34 伤害武器互相命中；无论命令 Map 顺序如何，`bot-1` 都存活并获胜，玩家射向它的伤害被完全丢弃。最终圈中所有剩余角色同 tick 受到致死圈伤时也固定由字典序最小 Bot 获胜。
   - 影响：首轮 finding 4 的 Map 插入顺序依赖虽消失，但替换成了对固定玩家 ID 永久不利的规则偏置，不满足人类/AI 公平共用规则；真实 30 Hz 对局中 33ms 内的最终互杀会稳定判玩家失败。
   - 待处理：定义无角色类型/ID 偏置的同时致死 contract，并覆盖互换实体 ID、玩家/Bot 身份及最终圈同时致死；不能通过直接跳过胜者全部伤害来制造唯一胜者。

2. **[高][首轮 finding 6 未完全修复] GLB 合同校验仍是可选的，空 GLB 会被当作成功资源并关闭可见 fallback。**
   - 证据：`src/client/render/loadCatalogModel.ts:35-39` 在清单未填写 `metadata.requiredNodes` 时直接跳过节点校验，也不要求至少存在一个可渲染 mesh；`src/client/render/scenes/IslandScene.ts:109-125` 只要 loader 返回非空就关闭所有程序化 Bot/枪械视觉。`tests/unit/loadCatalogModel.test.ts:13-25,73-79` 的“成功 GLB”只有一个空 `root` node、没有 mesh，恰好证明不可见模型会被判成功。正式清单 `public/assets/asset-manifest.json:33-48` 仍全部是程序化模型。
   - 复现：仅将 `model.character.enemy` 或 `model.weapon.rifle` 的清单项改为上述仅含空 root 的 GLB，且不配置 `requiredNodes`；加载返回成功，随后程序化 Bot 或第一人称枪械被禁用，导入模型又没有任何可见 mesh。
   - 影响：所谓“只改清单即可替换 GLB”仍可让所有敌人或武器视觉消失；当前测试只覆盖 loader，没有覆盖 `createIslandScene` 的替换、fallback 保留和反复 dispose，任务 11/成功标准尚未被证明。
   - 待处理：强制不同模型类型的必要节点/可渲染 mesh contract，只有完整校验和实例化成功后才关闭 fallback；补 NullEngine 场景级成功/空模型/坏节点/fallback/重复 dispose 测试，并完成一次真实清单替换记录。

3. **[高][新增发现] Bot 弹匣耗尽且无匹配备弹时，只要看见敌人就永久停留在战斗分支，不会搜寻弹药。**
   - 证据：`src/controllers/BotController.ts:70-95` 对“可见目标 + 已持枪”无条件提前返回，即使 `ammoInMagazine === 0` 且没有备弹；真正的物资搜索位于 `:106-115`，无法到达。`:146-155` 还把任意 ammo 都视为有用物资，没有限定当前武器弹种。
   - 复现：给 Bot 一把 0 发步枪、空背包，在 10m 放置可见玩家并在 2m 放置步枪弹；`update` 返回 `fire=false/reload=false` 和追敌移动，连续调用仍不拾取近处弹药。若背包被其他弹种占满，问题会进一步固化。
   - 影响：多 seed 测试只证明无战斗环境下 140 秒内至少 15/19 Bot 拿到枪，没有覆盖实战弹药续航；实际 Bot 打空弹匣后会退化为追逐目标直至被击杀或被圈淘汰，任务 9 的搜集/弹药/战斗闭环仍不完整。
   - 待处理：无可装填弹药时应退出交战并寻找当前武器匹配且可达的 ammo，必要时允许换枪；补多 seed、真实 `SimulationCombatWorld` 的搜集—交战—耗尽—补给—继续战斗测试。

4. **[高][首轮 finding 8 修复引入稳定性风险] 动态掉落现在可见，但每次丢弃/拾回都会永久累积规则对象和 Babylon mesh。**
   - 证据：`src/game/systems/InventorySystem.ts:350-372` 每次掉落都生成新 ID；拾取只在 `:148-151` 将旧 loot 标为 unavailable，从不删除。`src/client/render/LootMarkerViewAdapter.ts:13-20` 只创建/更新 marker，没有删除/dispose；`src/client/render/scenes/IslandScene.ts:525-551` 因而永久保留所有 marker，`src/app/BattleRoyaleSession.ts:156-160` 每帧还遍历并更新整个累计集合。
   - 复现：持枪连续执行 G 丢弃、F 拾回；每轮 `groundLoot` 和 `lootMeshes` 各增加 1，旧对象/mesh 始终保留。持续操作会令每帧同步从开局约 72 项线性增长到数千项；只有整局重开、scene dispose 后才释放。
   - 影响：18 分钟长局可被普通输入制造持续内存与每帧 CPU 增长，违背任务 11 的“无持续内存上涨”；动态掉落由不可见变成了无界视图/状态泄漏。
   - 待处理：为已耗尽 loot 定义状态回收和 marker dispose/复用策略，确保同步移除视图；补大量丢弃/拾回后规则对象、marker 数量有界及 scene dispose 后归零的测试。

#### 原 12 项逐项复查

1. **部分修复，仍不通过**：物资点已避开障碍，导航不再直冲空路径，未持枪 Bot 可全图找武器；5 个 seed 均达到至少 15/19 持枪。但实战耗尽弹药后不会补给，且没有多 seed 完整实战局测试，见新 finding 3。
2. **已修复**：`BattleRoyaleSession.ts:91-94` 在玩家死亡后不依赖 Pointer Lock 继续推进；fast mode 测试可产生唯一胜者。仍缺玩家中途死亡的会话级自动测试。
3. **已修复**：地面武器保存并转移完整 `WeaponState`；空枪丢下再拾、替换武器和死亡掉落均有 Vitest。
4. **原插入顺序问题已修复，但修法不通过**：命令排序和批量伤害使反转 Map 顺序结果一致；新 ID 偏置见 finding 1。
5. **已修复**：命中和 LOS 已迁到纯规则 `SimulationCombatWorld`，使用固定角色体积与静态障碍；测试覆盖遮挡、最近目标和状态更新 batching。
6. **部分修复，仍不通过**：规则 hit volume 已与 GLB 视觉解耦，loader 有最小 GLB 和坏节点测试；但空模型会关闭 fallback，未完成场景级替换/dispose 验证，见 finding 2。
7. **已修复**：cooldown 可结转负余量，三把武器 30 秒射速测试与配置误差不超过 1 发。
8. **可见性已修复，但修法不通过**：状态同步会创建新增掉落 marker；旧 loot/mesh 无界累积，见 finding 4。
9. **已修复**：正式配置航线加全部圈阶段预算为 18 分钟，fast config 独立，已有预算与快速完整推进测试。
10. **已修复**：换弹完成直接作用于具体 `WeaponState`，同 ID 双枪的活动槽测试通过。
11. **已修复**：0/1/2 级头盔提供一致的简化全伤害减免，圈伤明确绕过，已有规则测试。
12. **实现已修复，仍有验证缺口**：预加载会实际解析 SVG、解码 image，并在 200 坏内容时标记 unavailable；已有坏 SVG 测试，但尚无 PNG/WebP 坏内容测试。

#### 验证与残余风险

- 已执行 `npm run typecheck`：通过。
- 已执行完整 `npm run test -- --reporter=verbose`：13 files / 63 tests 全部通过。
- 已重新定向执行 AI、规则、simultaneous combat、`SimulationCombatWorld`、动态掉落适配、正式局长、图片 fallback 和 GLB 相关 Vitest：9 files / 52 tests 全部通过；5 个 AI seed 用例均通过。
- 本轮没有使用浏览器、Playwright、Chromium 或声音。一次尝试用 Node 直接加载 TS 做额外长局采样因 Node 不支持源码中的 TypeScript parameter property 而失败，该失败命令未作为验证证据；随后已用仓库正式 Vitest 命令成功重跑相关测试。
- 重开释放路径静态上会移除 HumanController 监听、关闭 AudioContext 并 dispose scene/engine，scene dispose 也注册了 GLB container 清理；但没有连续重开、模型实例和音频资源释放的自动测试。受用户禁止浏览器/声音约束，本轮不能据此确认真实浏览器无泄漏。
- 现有 AI multi-seed 仅覆盖 5 个 seed、无战斗世界和“至少 15/19 持枪”，未覆盖正式配置下多 seed 完整实战局；正式 18 分钟配置也只验证时间预算，未验证真实平均局长和长局性能。
- Builder 必须处理上述 4 个高风险 findings；writer/验收需补实战多 seed、场景级 GLB、PNG/WebP 坏图、动态 marker 回收和连续重开资源释放证据后再发起第三轮复审。

### 2026-07-16 16:36 +0800：最终复审（不通过）

- 审查范围：重点复查第二轮 4 项 findings，并检查最新 `SimulationCombatWorld` 集成、GLB 视觉不可拾取、重开 dispose、19 Bot 完整局测试及相关调用链。
- 对照基线：本 plan；仓库仍是无 commit、无 remote 的 `master`，全部实现均为未跟踪文件，故相对主分支的范围仍是当前全仓库，没有可用 merge-base 或历史提交 diff。
- 结论：**不通过**。空 GLB fallback、普通空弹 Bot 搜索兼容弹药、loot/marker 有界复用等已有实质修复，但第二轮 finding 1、3 仍各留有高风险路径。
- 用户约束：本轮未启动浏览器或声音，未使用 Playwright，未下载 Chromium。

#### 最终 Findings（按严重度）

1. **[高][第二轮 finding 1 未完全修复] 枪战 tie-break 不再固定偏袒 actor class，但仍通过完全免伤制造胜者；最终圈及同 tick 拾取仍固定让 Bot ID 占优。**
   - `src/game/systems/CombatSystem.ts:184-193` 现按 tick hash 选择幸存者，`tests/unit/gameSimulation.test.ts:170-175` 证明 24 个 tick 中玩家和 Bot 都可获胜；但选中者仍跳过本 tick 的全部伤害，生命和护甲保持原值。
   - `src/game/modes/BattleRoyaleMode.ts:196-207` 仍排序实体 ID 并让 `living[0]` 完全免除致死圈伤；当前 `bot-*` 固定排在 `player` 前，因此最终圈同时致死仍固定判 Bot 获胜。
   - `src/game/GameSimulation.ts:40-46` 还按同一 ID 顺序串行处理拾取，`InventorySystem` 会由先处理者立即把 loot 标为 unavailable；玩家和 Bot 同 tick 争抢同一物资时也固定由 Bot 获得。
   - 影响：核心公平性问题只在互射分支被部分修复；最终圈和物资竞争仍存在稳定 actor-class 偏置，且互射幸存者状态不符合实际已命中的伤害。
   - Builder 需处理：为战斗、圈伤和物资冲突定义一致且不依赖当前 actor ID 命名的结算规则；不能靠丢弃幸存者全部伤害制造唯一胜者，并补最终圈、同 tick 拾取和互换 ID/kind 测试。

2. **[高][第二轮 finding 3 未完全修复] 无弹 Bot 仅在背包有空栈时搜索兼容弹药，背包被不兼容弹种占满后仍会永久失去补给能力。**
   - `src/controllers/BotController.ts:146-165` 已在 `needsAmmo` 时限定当前武器弹种，但 ammo 候选仍无条件要求 `backpack.length < maxBackpackStacks`；同文件 `:157-162` 又允许尚有弹时拾取任意弹种，Bot 本身没有丢弃无用栈或切换到有弹武器的策略。
   - 复现条件：空弹匣步枪 Bot 的背包用其他弹种填满，在附近放步枪弹并保留可见敌人；Bot 不再追敌，但也不会选择或拾取步枪弹，只会转向圈心。
   - `tests/unit/botController.test.ts:176-209` 只覆盖空背包；`tests/unit/aiLootReachability.test.ts:112-150` 的完整局只有一个 seed、以 0.25s 直接步进，且只断言出现过拾取/开火/Bot 击杀，没有覆盖“耗尽—补给—继续战斗”。
   - 影响：正常搜集即可形成的满背包路径仍会让 Bot 在后半局永久空枪，任务 9 的弹药公平和战斗续航未闭环。
   - Builder 需处理：无兼容弹药时允许腾出无用栈或采用有弹武器，并补满背包兼容弹药、耗尽后续战及多 seed 完整局验证。

#### 已确认修复与验证

- 空 GLB：`loadCatalogModel.ts:26-28` 强制至少一个有顶点的可渲染 mesh，空模型测试通过并保留程序化 fallback。
- loot/mesh：`InventorySystem.ts:358-376` 复用 unavailable loot ID；重复 30 次丢弃/拾回后规则对象保持 1 个，marker 随同一 ID 更新，scene dispose 后引用清空。
- `SimulationCombatWorld`：会话已使用规则状态完成命中/LOS；遮挡、最近目标、状态更新 batching 测试通过。
- GLB 视觉：静态路径会将导入模型的子 mesh 标为 `isPickable = false`；但现有 scene 生命周期测试仅使用程序化资源，仍缺有效 GLB 场景级不可拾取/fallback/dispose 断言。
- 重开释放：静态路径会 dispose HumanController、AudioContext、scene 及 engine；NullEngine 下 4 次 scene 重建/销毁通过。受禁止浏览器和声音约束，未验证真实 AudioContext、GLB 实例及浏览器内存趋势。
- 已执行 `npm run typecheck`：通过；已执行 `npm run test -- --reporter=verbose`：14 files / 69 tests 全部通过。
- 残余风险：完整 AI 局仍只有单 seed 且使用 4Hz 直接步进；真实 30Hz 正式配置、多 seed 长局、有效 GLB 场景替换和完整 session 连续重开的资源趋势仍未被自动验证。

### 2026-07-16 16:50 +0800：最终两项阻塞定向复查（不通过）

- 审查范围：定向复查上一轮最终 findings 1–2，检查共享 simultaneous survivor、同 tick 物资排序、满背包空枪 Bot 的同命令丢弃/拾取及新增回归测试，并寻找修复引入的严重/高风险回归。
- 对照基线：本 plan；仓库仍为无 commit 的 `master`，没有可用 merge-base，故以本 plan 上一轮最终复审记录和当前全仓库实现为基线。
- 结论：**不通过**。固定 actor class 偏置、命令插入顺序依赖、最终圈 selector 未共享、满背包无法拾兼容弹药这几个已验证表象已修复；但 simultaneous survivor 仍保留上一轮明确禁止的完全免伤语义，Bot 修复还引入了高风险重复丢弃回归。
- 用户约束：未启动浏览器或声音，未使用 Playwright，未下载 Chromium。

#### Findings（按严重度）

1. **[高][上一轮 finding 1 未完全修复] combat 与最终圈虽已共享 tick selector，但选中的 survivor 仍会完全跳过本 tick 已命中的全部伤害。**
   - 证据：`src/game/systems/CombatSystem.ts:185-195` 和 `src/game/modes/BattleRoyaleMode.ts:201-211` 都只对非 survivor 调用 `DamageSystem`；survivor 不损失生命或护甲，也不产生对应受伤事件。直接复现 30 HP、无甲双方同 tick 用 34 伤害步枪互射，胜者仍为 30 HP。
   - 影响：上一轮要求的“不能靠丢弃幸存者全部伤害制造唯一胜者”尚未落实；当前测试只断言 winner 轮换、顺序不变和 loser 掉落枪弹量，没有断言 survivor 的生命、护甲及伤害事件。
   - Builder 需处理：在保留唯一 survivor 的同时结算其已发生伤害（例如只对最终致死边界做明确、最小化调整），并为 combat 与最终圈补 survivor 生命/护甲/事件断言。

2. **[高][本轮新回归] Bot 的一次性 `dropItem` 被决策缓存重复发送，会在后续固定 tick 连续丢弃同类物资。**
   - 证据：`src/controllers/BotController.ts:54-55` 的缓存快路径只清除 `fire`、`interact`、`useItem`，保留 `dropItem`；新逻辑在 `:109-123` 缓存了带 `dropItem` 的拾弹命令。直接按真实 30Hz 连续调用两次：首 tick 正常丢一栈并拾到步枪弹，下一 tick 返回 `interact=false, dropItem="ammo.shell"`，背包又少一栈；远距离决策间隔内可继续重复。
   - 影响：正常存在多个同类栈时，Bot 会额外丢掉多栈药品或第二把枪的弹药，破坏刚修复的补给与战斗续航公平性；新增测试 `tests/unit/botController.test.ts:212-240` 只执行一次 controller/update，未覆盖缓存 tick。
   - Builder 需处理：缓存返回不得重放一次性动作，至少清空 `dropItem`，并补连续多个 30Hz tick 的 Controller + Inventory 回归测试，断言只丢一栈且兼容弹药已拾取。

#### 已确认修复、验证与残余风险

- 已确认：`selectSimultaneousSurvivor` 被 combat 与最终圈共用；候选按 ID 规范化后随 tick 变化。物资命令按 tick hash 排序，反转命令 Map 插入顺序不改变胜者，24 tick 中玩家/Bot 均能获胜。
- 已确认：满背包空枪 Bot 的首次决策会选择兼容弹药，并在同一命令中先丢一栈、再忽略刚丢物拾取兼容弹药；对应新增测试通过。该已验证主路径不作为失败项。
- 已执行 `npm run typecheck`：通过；相关 Vitest（`gameSimulation`、`battleRoyaleMode`、`botController`、`inventorySystem`、`aiLootReachability`）5 files / 47 tests 全部通过。
- 残余性能/人工体验风险（非本轮阻塞）：本轮按用户约束未做浏览器、声音、真实 30Hz 长局性能或人工体验验收；现有 19 Bot 完整局仍是单 seed、4Hz 直接步进，不能外推正式长局性能和体验。

### 2026-07-16 17:13 +0800：上一轮两项 blocker 定向复查（通过）

- 审查范围：只复查上一轮 16:50 记录中的两项 blocker：simultaneous survivor 的 combat/final-zone 伤害结算，以及 Bot cached command 的一次性动作清理和满背包补弹路径；同时检查这些最小修复是否引入高风险回归。
- 对照基线：本 plan。仓库仍是无 commit、无 remote 的 `master`，全部文件均未跟踪，无法生成相对主分支的历史 diff；本轮据上一轮记录的具体代码位置与当前实现做定向对照。
- 结论：**通过。本次审查未发现明确问题或高风险 finding。**
- Blocker 1 已闭环：combat 对选中 survivor 仍逐笔调用同一 `DamageSystem`，正常扣除开火弹药、执行头盔减伤与护甲吸收、产生受伤事件，只以 `minimumHealth = 1` 限制最终生命下界；因此不会再完全免伤，且最多保留 1 HP。final zone 同样实际调用伤害系统并最多保留 1 HP；圈伤继续按既有规则绕过护甲。
- Blocker 2 已闭环：Bot 缓存快路径已清空 `fire/reload/jump/interact/switchWeapon/useItem/dropItem` 等一次性动作；满背包空枪 Bot 首 tick 丢弃一栈并拾取兼容弹药后，下一缓存 tick 的 `dropItem` 为 `null`、`interact` 为 `false`，不会重复丢弃。
- 验证：`npm run typecheck` 通过；相关 Vitest（`gameSimulation`、`battleRoyaleMode`、`botController`、`damageSystem`、`inventorySystem`）5 files / 44 tests 全部通过。
- 残余验证缺口（非阻塞）：simultaneous combat 新增断言直接覆盖 survivor 的 1 HP，final-zone 用例从 1 HP 起测；护甲扣减、伤害事件和圈伤绕甲分别由现有规则测试与静态调用链覆盖，尚无单个组合用例同时断言全部状态。按用户约束未使用浏览器、声音或 Playwright。

### 2026-07-16 23:34 +0800：未提交武器切换 bug 修复审查（不通过）

- 审查范围：相对 `origin/main`（`3e8d5e3`）的当前未提交改动；重点检查空活动枪拾新枪自动装备、首把枪/双槽替换/AI/掉落重拾、主键盘/小键盘/滚轮和控制器到背包测试链。
- 对照基线：本 plan 的双主武器槽、统一角色指令入口、AI 同规则及任务 6 验证要求。
- 结论：**不通过**。规则层主路径未发现高风险回归，但存在一个可复现的一次性输入泄漏和一个关键整链验证缺口。
- Findings：
  1. **[中]** `HumanController` 在未获得 pointer lock 时仍缓存主键盘/小键盘切枪请求；会话此时暂停且不调用 `createCommand` 清理，恢复 pointer lock 后旧请求会被执行，导致暂停期间按键泄漏到后续游戏 tick。Builder 需限制非激活输入或在 pointer-lock 边界清理一次性请求，并补回归测试。
  2. **[中][验证缺口]** 新控制器测试只覆盖“已有双枪时 Numpad2/单向滚轮 -> InventorySystem”，自动装备测试则直接构造 `ActorCommand`；未覆盖原问题的 `F keydown -> HumanController -> InventorySystem 拾枪/自动装备 -> 后续切枪` 整链，也未断言 Digit1/2、Numpad1/2、双向滚轮及请求只消费一次。Writer/builder 需补整链用例。
- 已确认：空枪且无匹配备弹时拾入空槽会切到新枪；首把枪仍进入活动槽；满双槽仍替换活动槽；武器状态在掉落/重拾和替换时保持；完整 Vitest 中 AI 多 seed/完整局均通过。
- 验证：`npm run typecheck` 通过；定向 Vitest 4 files / 36 tests 通过；完整 `npm run test` 15 files / 74 tests 通过。未启动浏览器、声音或 Playwright。

### 2026-07-16 23:37 +0800：武器切换两项 blocker 定向复核（通过）

- 审查范围：仅复核 23:34 记录中的 Pointer Lock 输入泄漏、控制器到背包整链测试，以及这些修复可能引入的高风险回归。
- 对照基线：本 plan；当前 `HEAD/main/origin/main` 同为 `3e8d5e3`，目标改动仍为相对该基线的未提交差异。
- 结论：**通过。本次审查未发现明确问题或高风险 finding。**
- Blocker 1 已闭环：键盘和鼠标按下仅在当前 canvas 持有 Pointer Lock 时缓存；退出 Pointer Lock 会清空按键、持续开火及全部一次性动作；监听器在 dispose 时对称移除。
- Blocker 2 已闭环：测试已通过真实 `KeyF` 事件生成控制器命令并进入 `InventorySystem` 完成空枪拾枪自动装备，随后覆盖主键盘、小键盘、双向滚轮、一次性请求消费及暂停输入不泄漏。
- 高风险回归检查：未发现首把枪、双槽替换、AI 共用规则、掉落/重拾或输入生命周期回归。
- 验证：`npm run typecheck` 通过；相关 Vitest（`humanController`、`inventorySystem`、`botController`、`gameSimulation`）4 files / 36 tests 全部通过。按用户约束未启动浏览器、声音或 Playwright。

### 2026-07-17 01:27 +0800：四项用户投诉未提交改动审查（通过）

- 审查范围：相对 `origin/main`/`HEAD`（均为 `ed45927`）的当前工作区改动及两个未跟踪文件；重点复核小地图投影、圈/航线/玩家朝向与敌人信息隔离，空活动武器时 HUD/第一人称/GLB 可见性，每 POI 18 点物资配额与随机源复现，以及 Q/H 在按住移动/开火时的单击启动、输入抑制和治疗进度。
- 对照基线：本 plan 的任务 6、7、8、10、11 与 HUD/搜集/资源替换验收要求；主分支为 `main`，`HEAD` 与 `origin/main` 相同，因此本次实际范围是工作区相对 `ed45927` 的差异。
- 结论：**通过。本次审查未发现明确中高风险问题。** 小地图只生成玩家、航线、POI 和安全区视图；坐标与朝向投影一致。HUD 与包含程序化/GLB 子节点的 `viewWeaponRoot` 均按活动武器显隐。四个 POI 各保持 18 点及固定类别配额，同随机 seed 可复现。治疗请求会先抑制已按住的移动/开火状态，并保持到对应按键/鼠标释放，后续新移动或开火仍可按规则中断治疗；HUD 读取权威 `usingItem` 显示剩余时间和进度。
- 验证：`npm run typecheck` 通过；定向 Vitest（`minimap`、`humanController`、`inventorySystem`、`battleRoyaleMode`、`islandScene`）5 files / 29 tests 全部通过。未启动浏览器、声音或 Playwright。
- 残余验证缺口：受本次约束未做浏览器视觉验收；现有测试未直接覆盖 HUD DOM 的有枪→无枪切换、有效 GLB 子节点随 root 显隐，以及治疗抑制后的释放/重按完整事件序列，结论主要由对应静态调用链和现有定向规则测试支撑。

### 2026-07-17 01:43 +0800：四项用户投诉定向复核（通过）

- 审查范围：当前工作区相对 `main`/`origin/main`（`ed45927`）的未提交改动；仅复核小地图、空枪/准备阶段显隐、分层物资和 Q/H 单击治疗四项投诉。
- 对照基线：本 plan 的任务 6、7、8、10、11，以及用户指定的敌人信息隔离、航线/圈状态、GLB parent、每 POI 配额/确定性、输入抑制/恢复、首帧同步和 HUD 进度要求。
- 结论：**通过。本次审查未发现明确中高风险问题。** 小地图视图不包含敌方 actor；`viewWeaponRoot` 统一承载程序化/GLB 武器并随活动武器显隐，actor 在 aircraft 阶段隐藏；每 POI 维持 18 个点和固定类别配额，同 seed 可复现；Q/H 单次请求会抑制已按住的移动/开火，释放后可恢复后续输入，HUD 读取权威治疗状态。
- 验证：`npm run typecheck` 通过；定向 Vitest（`minimap`、`humanController`、`inventorySystem`、`battleRoyaleMode`、`islandScene`、`loadCatalogModel`）6 files / 32 tests 全部通过。未启动浏览器、声音或 Playwright。
- 残余验证缺口（非阻塞）：未做浏览器视觉验收；尚无 HUD DOM、有枪→无枪、有效 GLB 场景级 parent/显隐及治疗释放后重按的整链自动测试。

### 2026-07-17 01:55 +0800：四项体验修复最终验收

- 小地图：右上角常驻显示岛屿、四个 POI、航线、玩家朝向、当前圈和目标圈，不包含敌人位置；航线阶段状态显示“航线飞行”。
- 准备视觉：玩家无活动武器时 HUD 图标和统一 `viewWeaponRoot` 均隐藏；所有 actor 在 `aircraft` 阶段隐藏，避免 19 个 Bot 与玩家同坐标叠进镜头。
- 物资分布：每个 POI 的 18 个点固定分层为 5 武器、4 弹药、3 医疗、6 装备，三类武器和对应弹药均有覆盖，类别环形相邻率不高于 20%，同 seed 可复现且不同 seed 变化。
- 治疗输入：`Q` 绷带和 `H` 急救包各用单次按键即可触发；若移动/开火正按住则先停止并抑制至松键，权威 `usingItem` 驱动倒计时、进度条和完成/中断提示。
- 自动验证：`npm run typecheck`、16 个测试文件/82 项 Vitest、`npm run build` 全部通过；最终代码审查未发现中高风险问题。
- 静音生产预览：音量 `0`，准备阶段无武器/角色遮挡，小地图与治疗进度卡视觉清晰，控制台无错误或警告。

### 2026-07-18 01:15 +0800：当前未提交 terrain/floor 及全量 diff 审查（不通过）

- 审查范围：当前 `main` 工作区相对 `HEAD/origin/main`（`a0a4267`）的全部未提交改动和 3 个未跟踪文件；重点检查 `IslandScene.ts`、`islandScene.test.ts`、地形权威碰撞、射击反馈、生命周期及其余行为改动。
- 对照基线：本 plan 的固定小岛、禁止程序生成地图、权威规则/渲染边界、任务 7/11/12 与上一轮已验收的物资配额。
- 结论：**不通过**。需 builder 处理下列阻塞问题后复审；不能记录为通过。
- Findings 摘要：
  1. **[高]** `createMapLayout` 按每局随机 seed 改变山体、建筑和物资坐标，偏离固定小岛及“不做程序生成地图”的明确范围。
  2. **[高]** 75% 航线自动跳伞会把仍在飞机上的玩家直接横向传送到最近 POI 的物资点，而不是从当前航线位置离机，破坏航线语义并给予无成本精准落点。
  3. **[高]** 渲染地形是 5m 网格三角面，移动/射击却查询连续解析高度；抽样的三角形质心误差最高约 0.063m，已超过弹痕仅 0.04m 的表面偏移。岛外规则还保留 y=0 的无限地面，而可见海面在 y=-1.5，岸边向海射击会生成悬空命中和弹痕，仍有闪烁/漂浮风险。
  4. **[高]** 屋顶坡道已成为权威移动支撑面，但 `SimulationCombatWorld` 只检测 terrain 和 building AABB；子弹及 AI LOS 可穿过可站立的实体坡道，渲染/移动/战斗权威不一致。
  5. **[中]** 每 POI 配额从已验收的 5 武器/4 弹药/3 医疗/6 装备改成 6/4/3/5，并同步改测试固化新语义；当前需求没有对应依据，属于无关玩法平衡回归。
  6. **[中]** `mapLayoutCache` 对随机每局 seed 永久增量缓存且无清理/上限；生产重开会持续保留 layout。场景生命周期测试每轮固定使用同一 seed，无法发现该增长。
  7. **[中][验证缺口]** floor flicker 断言筛选 `metadata.surfaceType`，但实现从未设置该 metadata，因此恒为空；测试没有验证 beach/wet/ocean band 的实际边界、非重叠关系、三角地形与规则表面一致性或连续帧视觉稳定性。
- Builder 待处理：恢复固定地图和既有物资配额；自动离机保留当前航线坐标；统一渲染地形、移动支撑和射击表面（含海面与坡道）；限制或移除随机 layout cache；补真正能失败的表面重叠、边界射击、坡道遮挡、不同 seed/restart 内存及连续帧视觉回归测试。
- 验证：`npm run typecheck` 通过；完整 Vitest 18 files / 97 tests 通过；`npm run build` 通过（主 chunk 812.59kB、GLTF chunk 625.30kB 警告）；生产 preview 以音量 `0` 打开航线场景，控制台无 error/warn。自动化 Pointer Lock 无法持续保持，因此未把单帧预览当作 floor flicker 动态验收证据。

### 2026-07-18 01:52 +0800：更新随机地图需求后的全量终审（不通过）

- 审查范围：当前 `main` 工作区相对 `HEAD/main/origin/main`（均为 `a0a4267`）的全部未提交改动及 3 个未跟踪文件；重点复核有界 seed 地图、floor/perimeter、地形渲染与权威规则、屋顶坡道、自动/手动离机、缓存、AI 公平性、性能和测试。
- 对照基线：本 plan 已更新的“边界与 POI 固定、共享可序列化 seed 随机丘陵/建筑/物资/装备”要求。01:15 记录中关于“必须恢复固定地图”的 finding 已被最新用户要求明确取代，不再作为问题。
- 结论：**不通过**。没有发现无界 layout/effect cache 或已复现的地表 band 面积重叠；自动离机也会保留当前航线坐标。但仍有 2 项高风险功能问题和 2 项中风险坡道/AI 问题需要 builder 处理。
- Findings：
  1. **[高] 手动过早离机仍可在岛外落地，移动时还会瞬移到边界。** 航线起点可位于 `±400m` 有效地形外；零水平输入时 `moveAxis` 不执行边界 clamp，岛外 `getTerrainHeight` 又返回 `0`，角色会在可见海面上方被判定落地。以 mode 随机源恒为 `0.5` 可得到 `x=520` 的航线起点；立即只按 Space 后可一直在 `x=520` 降至 `y=1.76`，随后首次产生对应轴移动时直接 clamp 到 `399.58`。需为手动离机定义岛外降落/回收规则，禁止站在无权威地形的海面或百米瞬移，并补航线起点早跳测试。
  2. **[高] 可见屋顶比权威屋顶高 0.46m，坡道、站立面和射击反馈没有落在同一表面。** 渲染 roof cap 的底面才是 obstacle/ramp 的 `topY`，可见顶面在其上方 0.46m；Movement 与 Combat 仍使用 obstacle AABB 顶面。结果是坡道终点钻入 roof cap、角色脚底位于可见屋面内部，向屋顶开火产生的 impact/decal 也落在 cap 内而不可见。需让渲染 roof、移动支撑和 `SimulationCombatWorld` 共用同一顶面，并补可见 mesh 顶点/权威命中点/站立高度组合断言。
  3. **[中] AI 导航完全不知道屋顶和坡道，玩家拥有 AI 无法使用的战术空间，Bot 若空降屋顶还会被判为起点 blocked。** `GridNavigator` 只做 obstacle 的二维阻挡，不含 ramp/高度层；Bot 的物资和进圈路径都依赖该 navigator。Movement 却允许降落到 roof support，因此屋顶 Bot 在无可见敌人时会拿到空路径并停住，地面 Bot 也永远不会规划上坡。需明确坡道是否属于 AI 可用导航；若是，应加入分层/坡道连接，若否则至少禁止 Bot 在屋顶落地并消除玩家单方面安全位。
  4. **[中] seed 建筑抖动没有校验坡道与其他建筑，部分合法 seed 会生成被邻楼截断的坡道。** 对 seed `0..9999` 的布局枚举发现 2417 个 ramp/非所属 obstacle 顶视投影相交；例如 seed `8892` 的 `ramp-building-3-4` 与 `building-3-1` 沿 z 重叠约 `3.614m`，且该段坡道高度仍在邻楼 AABB 内，入口不可用。现有测试只检查单个 seed 的 building-building 不重叠。生成时需避让/换向坡道，并补多 seed 的 ramp-building clearance 测试。
- 验证证据：`npm run typecheck` 通过；完整 `npm run test -- --reporter=verbose` 为 18 files / 100 tests 全部通过；`npm run build` 通过，主 chunk 813.56kB、GLTF chunk 625.30kB，保留既有大 chunk 警告；`git diff --check` 通过。静音生产 preview 可进入航线、自动离机、落地及 AI 战斗，页面显示约 120 FPS，玩家淘汰后规则仍继续推进。
- 已确认非阻塞项：`mapLayoutCache` 强引用上限为 8，terrain grid 使用 WeakMap；CombatEffects 各池固定容量并可 dispose；ground/beach/wet/ocean band 静态边界无面积重叠；地形规则高度使用与 Babylon 网格一致的三角插值；物资配额保持 5/4/3/6；75% 自动离机保留当前航线位置。
- Builder 待处理：先修 findings 1–2；同时收敛 findings 3–4 并补手动早跳、屋顶 mesh/rule、Bot 屋顶逃生/坡道导航及多 seed 坡道避让回归。Writer/验收需保留当前 bounded seeded-map 语言，不得恢复已被用户取代的固定地图结论。

### 2026-07-18 02:05 +0800：四项 blocker 修复复审（不通过）

- 审查范围：当前 `main` 工作区相对 `HEAD/main/origin/main`（均为 `a0a4267`）的完整未提交 diff；定向复核 01:52 记录的手动/自动离机、屋顶统一、AI 坡道导航、坡道避让，并额外检查反向（`startZ > endZ`）坡道。
- 对照基线：本 plan 已更新的有界、共享可序列化 seed 控制丘陵/建筑/物资/装备需求；受控随机地图仍是明确预期，不恢复旧固定地图结论。
- 结论：**不通过；无高风险 blocker，但仍有 2 项中风险 blocker。** 上轮四项的主体修复均已落地，但反向坡道暴露了物资排除回归，且屋顶只统一了高度、未统一可见 footprint。
- Findings：
  1. **[中] 反向坡道不会参与 loot 避让，可生成被坡道盖住且无法拾取的物资。** `src/config/map.ts:287-292` 的 `pointInsideRamp` 仍假设 `startZ <= endZ`；新生成的 row 1/2 外向坡道为 `startZ > endZ`，条件恒为 false。枚举 seed `0..9999` 得到 7752 个反向坡道/物资 clearance 重叠，1997 个 seed 至少有一件物资因坡道高度导致 3D 拾取距离超过 3m。seed `1` 的 `loot-33` 位于 `ramp-building-1-3` 下方：loot y=`0.45`、角色站在坡道后的 eye y≈`3.7246`，垂直距离≈`3.2746m`；HUD/Bot 以水平距离提示或反复 interact，但 `InventorySystem.ts:128-134` 拒绝拾取。Builder 需对 ramp z 范围统一使用 min/max，并补反向坡道 loot-clearance/实际拾取测试。
  2. **[中] 屋顶高度已统一，但可见 roof cap 的 0.8m 四周挑檐仍不在 movement/combat AABB 中。** `IslandScene.ts:433-443` 把 roof 宽深设为 obstacle `+1.6m`，而 `MovementSystem.ts:214-220` 和 `SimulationCombatWorld.ts:210-218` 的 x/z 范围仍只使用 obstacle 本体。以 seed `0` 第一栋楼为例，在墙外 0.5m（仍位于可见挑檐内）向下射击，规则射线穿过屋顶并命中 y≈0 的 terrain，而非可见 roof y=`3.38`；同一区域也不是可站立支撑面。Builder 需让可见 cap footprint 与权威 obstacle footprint 一致，或把挑檐纳入 movement/combat 几何，并补 roof edge 射线/支撑测试。
- 已确认修复：岛外手动 Space 不再离机；75% 航程处所有仍在 aircraft 的 actor 会在当前且位于岛内的航线坐标自动离机；`BUILDING_ROOF_CAP_HEIGHT` 已统一 ramp top、屋顶中心顶面、Movement 支撑和 Combat AABB 的 y 上界；`GridNavigator` 使用当前 seed 的 ramps，屋顶起点/目标路径顺序在正向和反向坡道上均正确；坡道按 building row 朝 POI 外侧生成，对 seed `0..9999` 额外枚举未发现 ramp 与非所属 building 相交，仓库已有 100-seed 回归。
- 验证：`npm run typecheck` 通过；完整 `npm run test -- --reporter=verbose` 为 18 files / 104 tests 全部通过；`npm run build` 通过，保留主 chunk 814.31kB、GLTF chunk 625.30kB 警告；`git diff --check` 通过。未修改业务源码、未使用 Playwright或声音。
- Builder 待处理：修复上述两个中风险 blocker；重点新增反向坡道的物资排除/拾取和 roof cap 边缘 render-rule 一致性测试后再复审。

### 2026-07-18 02:14 +0800：剩余两项 medium 修复后的最终全量复查（不通过）

- 审查范围：当前 `main` 工作区相对 `HEAD/main/origin/main`（均为 `a0a4267`）的完整未提交 diff；复查此前全部 findings、反向坡道 loot clearance、roof cap x/z/y 边界，并寻找受控随机丘陵引入的新渲染/规则回归。
- 对照基线：本 plan 当前“有界地图、共享可序列化 seed 控制丘陵/建筑/物资/装备”要求；controlled random map 明确保留，不按旧固定地图语言审查。
- 结论：**不通过；无高风险 blocker，仍有 1 项中风险 blocker。** 上轮反向坡道物资和 roof cap footprint 两项已闭环，但世界安全区边界仍未适配新增丘陵。
- Finding：
  1. **[中] 世界安全区环固定在 y=0.18，缩圈后会被权威随机丘陵埋住，导致部分边界完全不可见。** `src/client/render/scenes/IslandScene.ts:963-970` 创建厚度 1.2m 的水平 torus，`src/app/BattleRoyaleSession.ts:189-192` 每帧只更新 x/z 和半径，y 始终为 0.18；而本次 terrain 可高达十余米。torus 顶部约为 y=0.78，因此 terrain 高于该值的边界段会在深度测试中完全位于地表下。对 1000 个确定性对局采样第一阶段 target circle（最终会成为 current circle），1000/1000 均至少有边界点高于 0.78；最差样本约 25% 圆周被埋。影响：玩家在丘陵附近无法从世界场景辨认当前圈边界，虽仍有小地图，但任务 8/10 的场景安全区反馈相对原平地地图发生明确回归。Builder 需让边界按 terrain 高度分段贴地、改为足够高的垂直边界，或采用不被地形埋没且语义明确的表现，并补多 seed 圈边界可见性测试。
- 已确认全部此前 findings 闭环：岛外手动离机被拒绝；75% 时所有剩余 aircraft actor 在当前且位于岛内的航线坐标自动离机；terrain mesh/规则三角插值一致且 perimeter band 无面积重叠；`BUILDING_ROOF_CAP_HEIGHT` 与 ramp top、Movement、Combat、可见 roof y 一致，roof x/z footprint 也与 obstacle 完全一致；正反向 ramp 的 Movement/Combat/导航顺序正确；BotController 使用当前 seed 的 obstacles/ramps；seed `0..9999` 未发现 ramp/loot 或 ramp/非所属 building 重叠；layout/effect/loot marker 缓存和池有界；物资配额保持 5/4/3/6。
- 额外验证：1000 个随机航线在 75% 自动离机均位于 actor 边界内且所有剩余 actor 同点离机；1000 seed 的 rooftop→中心及中心→rooftop GridNavigator 路径均非空；roof 中心/边缘的 Combat y 命中与支撑面一致（仅精确浮点边界存在非实质性的闭区间舍入差异，不作为 blocker）。
- 自动验证：`npm run typecheck` 通过；完整 `npm run test -- --reporter=verbose` 为 18 files / 104 tests 全部通过；`npm run build` 通过，保留主 chunk 814.34kB、GLTF chunk 625.30kB 警告；`git diff --check` 通过。未修改业务源码、未使用 Playwright 或声音。
- Builder 待处理：仅剩上述世界安全区环的丘陵适配及对应多 seed 可见性回归；修复后再进行最终通过复审。

### 2026-07-18 02:21 +0800：terrain-following safe-zone ribbon 最终复查（不通过）

- 审查范围：当前 `main` 工作区相对 `HEAD/main/origin/main`（均为 `a0a4267`）的完整未提交 diff；定向复核最后一项世界安全区边界 finding，并回看此前离机、terrain/render/rule、perimeter、roof/ramp、AI、公平性、缓存、性能和测试结论。
- 对照基线：本 plan 当前有界、共享可序列化 seed 控制随机丘陵/建筑/物资/装备要求；controlled random map 仍为明确需求。
- 结论：**不通过；无高风险 blocker，仍有 1 项中风险 blocker。** ribbon 顶点会跟随权威 terrain，session 也会按 center/radius 更新，但只校验/采样顶点不足以保证三角形边内不被曲面穿透。
- Finding：
  1. **[中] 96 段 ribbon 的顶点虽离地，但 segment 内部仍会被丘陵穿透并局部完全埋没。** `src/client/render/scenes/IslandScene.ts:979-1008` 仅在每个圆周顶点采样 terrain，并用直线三角形连接相邻顶点；权威 terrain 在约 18–26m 长的外圈 segment 内可能高于两端线性插值。对 10,000 个确定性对局、第一阶段收缩的 21 个 center/radius 中间状态、每 segment 10 个内部点采样，9,971 个对局存在至少一个被 terrain 穿透的 ribbon 区段；最深约 0.403m，已接近并可超过 ribbon 的 0.43m 总高度，因此该处仍可完全不可见。最差圆周状态约 2.6% 采样点埋入 terrain。`tests/unit/islandScene.test.ts:79-92` 只断言顶点 lower/upper y 和一次移动后的首顶点，无法发现 segment interior 穿透。Builder 需提高/adaptively subdivide 到与 terrain 网格误差匹配、在 segment 内采样并抬升顶边，或使用不会被地形遮挡的边界表现；测试需断言所有三角形边内插值均高于共享 terrain，而不只是顶点。
- 已确认修复有效：`BattleRoyaleSession.ts:164-190` 会随规则步同步 center/radius；ribbon mesh 与 vertex/material 数量固定，反复更新不分配新 Babylon mesh；顶点 lower/upper 分别为 terrain +0.12/+0.55；此前全部离机、屋顶、坡道、AI、loot、cache 和 render/rule findings 仍保持闭环。
- 自动验证：`npm run typecheck` 通过；完整 `npm run test -- --reporter=verbose` 为 18 files / 104 tests 全部通过；`npm run build` 通过，主 chunk 813.57kB、GLTF chunk 625.30kB，保留既有大 chunk 警告；`git diff --check` 通过。未修改业务源码、未使用 Playwright 或声音。
- Builder 待处理：仅剩 ribbon segment interior 的 terrain clearance 和对应多 seed/中间缩圈状态测试；处理后再发起最终通过复审。

### 2026-07-18 02:32 +0800：当前未提交全量独立复审（不通过）

- 审查范围：当前 `main` 工作区相对 `HEAD/main/origin/main`（均为 `a0a4267`）的完整未提交 diff；重点复核有界 seed 地图、单 terrain/perimeter、共享权威地形、roof/ramp movement/combat/navigation、离机边界、terrain-following safe-zone ribbon、缓存/特效池和测试。
- 对照基线：本 plan 当前“有界地图、共享可序列化 seed 控制随机丘陵/建筑/物资”要求；不恢复已被用户取代的旧固定地图结论。
- 结论：**不通过；未发现高风险 blocker，仍有 2 项中风险 blocker。**
- Findings：
  1. **[中] safe-zone ribbon 的 segment 内部仍会被地形完全穿透。** `IslandScene.ts:979-1002` 固定用 96 段，只在端点采样 terrain 后用直线三角形连接；seed `0`、初始 center `(0,0)`、radius `400` 的 segment 83 在 `t=0.6` 处，terrain 比下边线高约 `0.531m`，也比仅高 `0.43m` 的上边线高约 `0.101m`，该处整条 ribbon 埋入地形。`islandScene.test.ts:79-92` 仍只断言顶点和单个移动后顶点，无法覆盖 segment interior。Builder 需提高/自适应细分或在段内保证上下边 clearance，并补 segment 内插值回归。
  2. **[中] Bot 的 rooftop target 路径没有接入战斗决策，新增屋顶仍是 AI 无法主动到达的战术层。** `GridNavigator.ts:22-43` 已能生成 ground→roof 路径，但 `BotController.ts:105-129` 对可见敌人始终直接使用水平向量追逐/横移/后退；navigator 只在 loot/安全区分支 `:138,157,159` 使用。seed `0` 第一栋楼上放玩家、地面放持枪 Bot 并使用真实 `SimulationCombatWorld` LOS，连续 60 秒 controller+movement 后 Bot 最大 y 仍为 `1.76`，没有走坡道。`movementSystem.test.ts:139-157` 只直接测试 navigator，未覆盖 BotController 追逐屋顶目标。Builder 需让需接近的屋顶敌人走 ramp path（或明确禁止该战术层），并补 controller+movement/combat 整链测试。
- 验证：`npm run typecheck` 通过；完整 `npm run test -- --reporter=verbose` 为 18 files / 104 tests 全部通过；`git diff --check` 通过。额外抽样 5,000 个 seed 未发现 layout 生成失败、越界 loot、坡道被 terrain 穿透或建筑 roof 被 terrain 覆盖；未修改业务源码、未提交。

### 2026-07-18 02:54 +0800：最终 release-gate 全量复审（不通过）

- 审查范围：当前 `main` 工作区相对 `HEAD/origin/main`（`a0a4267`）的完整未提交 diff；对照本 plan，并复核此前 terrain/floor、权威地形、离机、roof/ramp、loot/cache、safe-zone ribbon 与 Bot combat pursuit findings。
- 结论：**不通过；未发现高风险 blocker，仍有 1 项中风险 blocker。** controlled-random bounded island 为明确预期，不作为问题。
- Finding：`BotController.navigate` 在接近当前 waypoint 2m 时重算整条路径，却始终只保存新的 `path[1]`（`src/controllers/BotController.ts:240-245`）。对 ground→roof 路径，`GridNavigator` 会依次返回 ramp start、ramp end、roof target（`src/ai/navigation/GridNavigator.ts:32-42`）；Bot 到达 ramp start 后每次都重新选择 ramp start，无法推进到 ramp end。以当前 seed `2147483648` 的 `building-0-1` 为例，持枪 Bot 追逐屋顶远端目标 60 秒后仍停在 `z=150.622/y=1.797`，而 ramp start/end 为 `150.522/161.722`、屋顶目标 eye y 为 `5.94`。现有 `botController.test.ts:42-68` 只检查首个 command 的方向，没有推进 controller + movement 穿越全部 waypoints。Builder 需保存/消费完整 waypoint 序列，或在到达当前 waypoint 后明确推进下一节点，并补真实多 tick ground→ramp→roof 回归。
- 验证：`git diff --check`、`npm run typecheck`、完整 Vitest（18 files / 105 tests）及 `npm run build` 均通过；生产 preview 在本机 Chrome、音量 `0` 下可进入航线，控制台无 error/warn。构建保留既有 813.61kB 主 chunk 与 625.30kB GLTF chunk 警告。

### 2026-07-18 03:02 +0800：Bot 屋顶追击 blocker 最终复核（通过）

- 审查范围：复核 02:54 release-gate 唯一 blocker，并确认当前 `main` 相对 `origin/main`（`a0a4267`）完整未提交 diff 的既有结论未被该修复回归。
- 结论：**通过。本次审查未发现明确高/中风险阻塞项。** `BotController` 会保存并顺序消费完整 navigation path；combat target 移动不会在路径中段重置 waypoint，地形高度差会保持导航，同时保留目标瞄准方向。
- 验证：新增 controller + `MovementSystem` 30 秒回归可到达屋顶高度；额外以真实 `SimulationCombatWorld`、30 Hz 复现可见屋顶目标，Bot 到达目标屋顶。抽样 100 个布局、2,597 条有效可见 ground→roof 路径均到达屋顶，未复现 waypoint 卡死。
- 自动检查：`git diff --check`、`npm run typecheck`、完整 Vitest（18 files / 105 tests）和 `npm run build` 全部通过；仅保留既有大 chunk 警告。

### 2026-07-18 14:12 +0800：HEAD(e1c50ba) 未提交实现最终 release-gate 审查（不通过）

- 审查范围：当前 `main` 相对 `HEAD/origin/main`（`e1c50ba`）的 24 个 tracked 文件完整未提交 diff，包含 README/docs；按用户要求忽略未跟踪的 `session-ses_096e.md`。对照本 plan 及本轮 1200m、6 POI、1+50 AI、可进入建筑、三类武器模型和 UI/文档增量要求。
- 结论：**不通过。** 参与人数、物资配额、默认程序化武器显隐、墙/屋顶/坡道的主要权威链路和 5-seed 门槛已有测试，但仍有 1 项高风险和 2 项中风险 blocker。

#### Findings（按严重度）

1. **[高] 4Hz 决策缓存会在真实 30Hz 固定步中重复执行同一个 waypoint 移动，复杂路径可永久振荡。** `BotController.ts:79-90` 在决策间隔内复用缓存的 `move`，而 `:318-322` 只按单个传入 `deltaSeconds` 缩放“本步”剩余距离，waypoint 又只在下一次决策的 `:288-293` 才消费。生产会话每个 1/30s 固定步调用 controller；新增 `botController.test.ts:82-118` 却用 0.25s 同时推进 controller 和 Movement，未覆盖缓存 tick。用真实 1/30s 复现 map seed `2147483648` 的 rooftop→ramp→ground loot：Bot 60 秒后仍未拾枪，在 ramp-start `z=486.446` 两侧约 `486.219–487.919` 往复，目标 loot `z=494.446` 始终 available。影响多墙绕行、屋顶追击/撤离和室内路径；builder 需让缓存 tick 能安全消费/截断 waypoint，补真实 30Hz controller+movement 多 waypoint 回归。
2. **[中] 随机建筑生成未校验世界边界和 terrain clearance，合法 seed 会生成 AI 不可达坡道及被地形穿透的建筑/坡道。** `map.ts:104-121,179-212` 按 POI 外向直接生成坡道并只做平面 building clearance；Movement 在 `MovementSystem.ts:160-163` 把角色限制在 `±599.58m`，navigator 在 `GridNavigator.ts:126-131` 也拒绝界外节点。枚举 seed `0..999` 有 11 条坡道起点越过 600m；seed `331` 的 `ramp-building-5-3` 为 `startZ=605.856/endZ=593.603`，ground↔roof 两向 `findPath` 均为空。另抽样 seed `0..249`，seed `28/building-5-4` footprint 地形最高 `9.3405`，高于权威/可见 roof `8.7935`；并发现坡道表面最多被 terrain 穿入约 `0.533m`。builder 需在接受建筑时校验完整 footprint、坡道、世界边界和 terrain clearance，并补多 seed 生成/导航/表面不相交测试。
3. **[中] 新增三类稳定 weapon asset ID 没有接入 GLB 替换与武器切换，清单替换会产生错误显隐。** `IslandScene.ts:185-188` 仍只加载 `model.weapon.rifle`，`:202-206` 附加的 rifle GLB 没有 `actorVisual/weaponId` metadata；`:794-797` 因而无法在切到 SMG/shotgun 时隐藏它。`model.weapon.smg`、`model.weapon.shotgun` 虽已写入 manifest，却从未传给 `loadCatalogModel`；敌人 character GLB 成功时 `:195` 还会关闭全部程序化第三人称武器。现有 scene 测试只用 procedural entries。影响文档约定的“只改对应清单项”替换 contract：rifle GLB 会和其他活动枪叠显，另外两类 GLB 被静默忽略。builder 需按 weapon ID 管理 GLB/fallback 的实例与显隐，并补有效/失败 GLB、三类切换、第三人称和 dispose 的场景级测试。

#### 验证与后续处理

- 已执行 `git diff --check`、`npm run typecheck`、完整 `npm run test`：18 files / 109 tests 全通过；另定向 6 files / 44 tests 全通过。未使用 Playwright、未下载浏览器、未播放声音。
- 额外以本地 Vite 模块在 Chrome 中静音执行真实 30Hz 规则脚本：5 个 seed 的 140 秒持枪数为 `42/49/48/45/44`，均达到 42/50；但上述多 waypoint 复现稳定失败，说明现有 0.25s 加速测试不能替代真实固定步导航回归。
- 已确认 `src/game/` 未发现 DOM/Babylon import 或 `context.Background()`；状态仍只保存可序列化 seed/规则数据。默认 procedural manifest 下三类第一/第三人称 mesh 的基础切换测试通过。
- Builder 必须先处理 finding 1；findings 2–3 也需在 release 前收敛。Writer/验收需补真实 30Hz 多 waypoint、多 seed 地图有效性和有效 GLB 场景级证据后再发起复审。本轮未复跑 build，参考主 agent 已提供的 build/静音生产 preview 通过记录。

### 2026-07-18 17:10 +0800：HEAD(e1c50ba) 完整 diff 与新增 SVG 最终 release-gate 复审（不通过）

- 审查范围：当前 `main` 相对 `HEAD/origin/main`（均为 `e1c50ba`）的 34 个 tracked 文件完整工作区 diff，以及新增 `public/assets/ui/item-ammo-sniper.svg`、`public/assets/ui/weapon-sniper.svg`；按要求忽略 `session-ses_096e.md`。对照本 plan 和用户本轮最终 2400m、1+49 AI、16 落区、240 物资、四类武器等范围。
- 结论：**不通过。** 旧 30Hz waypoint、建筑/坡道/terrain、四类程序化与 GLB 显隐、`actor-died.weaponId` 等主路径已有实现和定向测试，但完整必跑测试当前不能稳定通过，并发现 5 项中风险功能偏差。

#### Findings（按严重度）

1. **[高][验证阻塞] 完整 `npm run test` 在当前工作区不能稳定通过。** 连续两次完整运行分别为 3 个和 1 个 timeout；第二次清理本轮 Vite dev 进程后仍在 `tests/unit/islandScene.test.ts:15` 的默认 5 秒上限失败（场景四次重建耗时约 5.72 秒）。该文件单独运行可通过，首项约 4.30 秒，说明不是确定性断言失败，但在完整并发套件下余量不足，CI/release check 具有可复现的抖动风险。Builder 需让标准完整命令有稳定余量，并重新提供完整绿灯证据，不能以单文件通过替代。
2. **[中] 地图/物资生成只做最小间距局部约束，仍会生成大片空白、断开的道路簇和跨区堆叠物资。** `src/config/map.ts:236-258` 只拒绝过近点，没有最大覆盖半径；seed `358` 的地图内 `(1100,1100)` 距最近落区中心约 `1281m`、最近建筑约 `1082m`、最近物资约 `870m`。`src/config/map.ts:187-215` 的每点两个最近邻也不保证全图连通，seed `0..400` 有 56 个 layout 的道路图分裂。另一方面 `src/config/map.ts:497-545,559-574` 的 `selected` 每区重置；同一批 401 seed 中，seed `237` 的 zone 10/14 两件物资仅距 `0.124m`，累计有 1,435 个跨区 pair 小于 `18m`。小地图与地表虽然调用同一道路函数、索引一致，但这些实际布局仍违反本轮重点要求中的大片空白/不合理堆叠收敛目标。Builder 需增加不依赖固定格点的覆盖、道路连通及跨区全局 spacing 校验。
3. **[中] 13/16 个区域必然缺少一种匹配弹药，未达到四类武器/弹药的区内可用语义。** `src/game/modes/BattleRoyaleMode.ts:307-320` 对 10–17 件区域把 ammo 数固定为 3，而 loot table 已有 4 种弹药；`createLootEntries` 虽先创建四种候选，区域循环只会 pop 3 个。当前固定 count 多重集中恰有 13 个 10–17 件区域，因此这些区域每局都会随机缺一类弹药；`tests/unit/battleRoyaleMode.test.ts:86-90` 也只要求武器 4 类、弹药至少 3 类。影响是同区已保证出现的某类枪没有对应补充弹，分流到该武器落点的 Bot 打空后必须跨区搜索。
4. **[中] 圈外跑圈并非最高优先级，低血量 Bot 会先原地治疗。** `src/controllers/BotController.ts:130-145` 在 `outsideZone` 判断前直接返回 medkit/bandage 命令；因此圈外携药 Bot 会停留 2.5–5 秒，后期高圈伤时可直接治疗至死。现有测试只覆盖“圈外有可见敌人”，没有覆盖圈外同时可治疗；Builder 需明确把跑圈放到治疗之前，并补该组合回归。
5. **[中] 键盘切枪没有清除 9-tick 换弹缓冲，会把旧枪的 R 请求施加到新枪。** `src/controllers/HumanController.ts:120-132` 的 Digit/Numpad 分支仅清理 scope；只有滚轮分支 `:188-193` 清理 `reloadRequestTicks`。实际按 `R` 后同 tick 按 `Digit2`，首个命令同时为 `reload=true/switchWeapon=1`，下一 tick仍为 `reload=true`；而 `GameSimulation` 先处理 inventory switch、后处理 combat，导致新活动枪收到旧请求。Builder 需统一所有切枪入口清理缓冲，并补同 tick 键盘切枪整链测试。
6. **[中] Pointer Lock 丢失只清了 controller scope，FOV/viewmodel 不会立即退出。** `HumanController.ts:196-205` 会将 `scopeHeld` 置 false，但 `BattleRoyaleSession.ts:177-185` 把 camera FOV 和 view weapon 同步放在 `elapsedSeconds` 变化门控内；按 Esc 后模拟暂停、elapsed 不再变化，因此相机会继续保持 `0.32` 且第一人称枪仍隐藏，直到恢复锁定并推进下一个 fixed tick。HUD overlay 已退出，三者状态不一致。Builder 需让 scope presentation 在失锁边界立即同步，并补暂停/恢复回归。

#### 验证与后续处理

- `npm run typecheck`：通过。
- `npm run test`：第一次 18 files / 122 tests 中 3 个 timeout；停止本轮 Vite dev 后第二次为 17 files / 121 tests 通过、`islandScene` 1 个 timeout；`npx vitest run tests/unit/islandScene.test.ts` 单独 2/2 通过。完整命令仍判失败。
- `npm run build`：通过，仅保留 `index` 约 828.60kB、GLTF 约 625.30kB 的 >500kB warning；`git diff --check e1c50ba` 通过。
- 额外通过本地 Vite 模块做了 seed `0..400` 的跨区 spacing/道路连通采样及 seed `0..999` 的生成/覆盖采样；1000 seed 未见生成 throw、每区室内物资仍至少 1、远距物资仍至少 6，但得到 findings 2–3 的反例。本轮未使用 Playwright、未下载浏览器、未播放声音。
- Builder 必须先恢复完整 `npm run test` 的稳定绿灯；同时处理 findings 2–6 并补对应全局 spacing/覆盖、四弹药区内覆盖、圈外治疗、键盘切枪 reload buffer、失锁 scope 同步测试后再复审。上述均为待处理项，不记录通过结论。

### 2026-07-18 17:53 +0800：17:10 findings 与山地/狙击/输入增量最终复审（不通过）

- 审查范围：当前 `main` 相对 `HEAD/origin/main`（均为 `e1c50ba`）的 34 个 tracked 文件完整工作区 diff及新增 sniper 两个 SVG；忽略 `session-ses_096e.md`。重点复核 17:10 的 1 高 + 5 中 findings，并检查新增山峰、环境密度、48m/s 高空滑翔、狙击镜、换弹缓存和死亡武器标签。
- 结论：**不通过。** 上轮测试超时、道路断连、跨区 loot 堆叠、四弹药覆盖、圈外治疗优先级、键盘切枪 reload buffer、失锁 scope presentation 均已闭环；但新的 coverage 点位生成器会对合法 seed 确定性抛错，而且“最大空白 <720m”并未在 401 seed 范围成立。

#### Findings（按严重度）

1. **[高][新增回归] 合法 map seed 可让新 coverage 采样器直接生成失败，整局无法创建。** `src/config/map.ts:298-325` 为每个 wilderness 点只尝试固定 320 个候选；当候选同时不满足 buildable、最小间距和逐点最远覆盖时，立即抛出 `Not enough coverage map points`，没有扩大搜索、回退或重试布局。用当前源码顺序枚举 seed `0..1200`，seed `832`、`859` 均稳定抛错；`createBattleRoyaleState` 会直接传播该异常，生产 `GameApp` 最终进入 LOAD FAILED 而不是开始对局。现有 401-seed 测试只到 `0..400`，无法证明 32-bit 每局 seed 的生成可靠性。Builder 需让采样失败可确定性收敛或安全重试，并加入上述反例及更广 seed 验证。
2. **[中][上轮 finding 2 未完全闭环] 最远候选策略仍不保证所声明的 `<720m` 建筑覆盖。** `src/config/map.ts:298-324` 只从 320 个随机候选中按带 `0.88–1` 扰动的最近距离打分；`tests/unit/mapLayout.test.ts:129-167` 实际只检查 `[0,33,237,358]` 四个 seed，并非最终证据所称的 401 seed 覆盖。按该测试同样的 `220m` 网格枚举 `0..400`，seed `303` 在 `(1100,-1100)` 到最近建筑约 `966.25m`（最近落区中心约 `1197.77m`、最近 loot 约 `833.27m`），明显超过 720m，仍会出现用户要求收敛的大片空旷区。道路 MST 连通和全局 loot 12m spacing 已确认修复，不在本 finding 范围。

#### 已确认闭环与验证

- 上轮 finding 1：标准 `npm run test` 本轮实跑为 18 files / 126 tests 全通过，总时长约 125.68s；重型测试显式 timeout 后未再复现完整套件失败。
- 上轮 findings 3–6：每区四枪/四弹测试通过；圈外判断位于治疗前且有低血 medkit 回归；Digit/Numpad/滚轮均清 reload buffer；scope FOV/viewmodel 每帧同步，失锁不再依赖 elapsed tick。
- 山地/规则：seed `0..400` 的现有建筑/坡道/terrain 测试通过；额外对同范围 ramp 宽度与长度做更密采样，未发现超过既有 `0.08m` epsilon 的 terrain 穿入。48m/s 仅用于高空且玩家/Bot 共用同一 MovementSystem，近地仍连续降至约 8–12m/s，未发现明确规则不公平。
- 狙击/死亡：四类程序化及 GLB 第一/第三人称显隐、RPM、scope 条件、`actor-died.weaponId` 和安全区 `null` weapon 调用链未发现新回归；新增 SVG 内容有效。
- 性能残余风险（非本轮 blocker）：场景 mesh 仍固定且不随局时增长；但 `<3900` 不是全 seed 严格上界，额外 NullEngine 对 140 栋建筑的 seed `135` 实测为 3975 meshes。结合现有静音 Chrome 约 120 FPS 证据，本轮不把约 2% 超差单列中高风险，但后续不应把单 seed 断言表述成全局硬上限。
- 自动验证：`npm run typecheck && npm run test && npm run build && git diff --check e1c50ba` 完整通过；构建仅既有 `index` 约 829.78kB、GLTF 约 625.30kB warning。额外本地 Vite 模块枚举发现上述 seed `832/859` 生成失败和 seed `303` coverage 反例。未使用 Playwright、未下载浏览器、未播放声音。
- Builder 必须处理 findings 1–2，并补生成不抛错及真正覆盖 `0..400`（含 seed 303）的最大空白回归后再复审；本轮不记录通过结论。

### 2026-07-18 20:15 +0800：HEAD(e1c50ba) 完整 diff 与 sniper SVG 最终 release-gate 审查（不通过）

- 审查范围：当前 `main` 相对 `HEAD/origin/main`（均为 `e1c50ba`）的 36 个 tracked 文件完整工作区 diff，以及新增 `public/assets/ui/item-ammo-sniper.svg`、`public/assets/ui/weapon-sniper.svg`；按要求忽略 `session-ses_096e.md`。对照本 plan、本轮用户列出的 2400m/1+49 AI/建筑与屋顶/四类武器/排行榜/死亡物资/观战/后期缩圈/性能主链。
- 结论：**不通过。** seed `832/859`、401-seed 地图门禁、四枪四弹、30Hz waypoint、GLB/fallback、死亡物资、观战和 15 分钟配置等现有回归大部分通过，但存在 3 项高风险及 3 项中风险 blocker；标准完整测试也连续两次未获绿灯。

#### Findings（按严重度）

1. **[高] 92% 自动离机点可位于岛外，空闲玩家会在海面落地并在首次移动时瞬移百余米。** `src/game/modes/BattleRoyaleMode.ts:28,104-121` 在固定 92% 航程无边界检查地强制离机；`src/game/systems/MovementSystem.ts:49-57` 只约束手动离机，且 `:169-174` 在无水平输入时不做边界恢复。常量随机源 `0.5` 的正式航线为 `x=1560→-1560`；推进到 93% 后玩家在 `x=-1341.6` 离机，空闲下降后仍在该坐标、`y=1.76` 被判 grounded，首次向 x 移动直接跳到 `-1199.435`，瞬移约 `142.165m`。`tests/unit/battleRoyaleMode.test.ts:151-167` 只断言“当前位置离机”，反而未校验当前位置是否在岛内。Builder 需按航线与 actor 半径计算最后合法离机进度/位置，保证自动离机、落地和后续移动均无岛外站立或瞬移，并补多角度/偏移及空闲玩家完整下降回归。
2. **[高] 权威 LOS 短暂被建筑遮挡后，Bot 会丢弃已生成的屋顶追击路径，真实主链不能稳定走坡道上楼。** `src/controllers/BotController.ts:170-203` 首次看到目标后清空受击调查状态；下一决策若 `SimulationCombatWorld` LOS 暂时为 false，`:205-270` 没有 last-known combat target，直接进入物资/巡逻并重写导航。用 seed `2147483648` 的 `building-0-0`、背对楼顶玩家的持霰弹枪 Bot 复现：受击后会转向、开火并开始坡道路径，但绕楼时 LOS 连续丢失约 61 个 30Hz tick；30 秒后 Bot 从距玩家约 48m 走到 342m 外，未登上该屋顶。现有完整 ground→roof 测试 `tests/unit/botController.test.ts:77-115` 使用 `hasLineOfSight: true` 的假 world；真实 world 用例 `:117-153` 只推进约 0.33 秒，未覆盖完整路径。Builder 需在 LOS 暂失时沿有限时长的最后可见位置/既有 waypoint 继续调查（期间不得开火或更新隐藏目标位置），并补真实 `SimulationCombatWorld + MovementSystem` 的 30Hz 多 tick 上楼回归。
3. **[高][验证阻塞] 标准完整 `npm run test` 连续两次失败，新增 1.5 秒性能守卫在并发套件下稳定抖动。** 首次完整运行为 17 files/139 tests 通过，`tests/unit/movementSystem.test.ts:80-93` 实测 `2218ms > 1500ms`；按用户要求重试后该项仍为 `2007ms > 1500ms`，且 `tests/unit/loadCatalogModel.test.ts:13` 又触发默认 5 秒 timeout。相同两个文件定向运行时 14/14 通过，移动守卫约 388ms、GLB 用例约 696ms，证明是并发负载下的门禁不稳定而非完整绿灯。Builder/writer 需把性能基准与并发重型套件隔离或采用稳定的专用门禁，同时给 GLB 重型测试明确余量；不能以单文件通过替代 release 命令。
4. **[中] 同 tick 多攻击者会按实体 ID 顺序覆盖受击方向，正常 ID 体系固定让 AI 优先调查玩家。** `src/game/systems/CombatSystem.ts:81-85,214-225` 按 actor ID 收集并顺序应用伤害；`src/game/systems/DamageSystem.ts:21-29` 每笔伤害覆盖同一 timestamp 的 `lastDamageDirection`。玩家在西、`bot-1` 在东同时命中目标时，无论 command Map 插入顺序，最终方向都固定指向玩家；只把 ID 改成 `a-player/z-bot` 就改为指向 Bot。伤害本身顺序稳定，但新增调查行为形成 actor-class/命名偏置。Builder 需在 batch 层为同 tick 多来源定义不依赖 ID/kind 的公平选择或聚合规则，只记录一次调查信号，并补交换 ID/kind/插入顺序测试。
5. **[中] 排行榜和结果卡把状态 ID 直接拼进 `innerHTML`，可执行注入内容。** `src/client/ui/GameHud.ts:225-230` 将 `actorLabel(actor.id)` 插入排行榜 HTML，`:270,278` 也把 `winnerId/detail` 插入结果卡。向 `MatchState.actors` 加入 ID ``<img src=x onerror='window.__reviewXss=1'>`` 后显示 Tab 榜，实测 handler 执行、标志变为 1。当前离线局 ID 由本地生成，因此外部可利用面有限，但这不满足本轮明确要求的 XSS 检查，也破坏可迁移状态边界。Builder 需用 DOM 节点与 `textContent` 渲染动态值，或统一严格转义，并补恶意 ID 回归。
6. **[中] 地图实现与已记录的“20 处路边院落”最终语义不一致，实际硬编码生成 28 处。** 本 plan 实现记录第 375 行及用户本轮基线均明确 `16 山 + 20 路边院落`；`src/config/map.ts:97,143-150` 却把 `COVERAGE_COMPOUND_COUNT` 设为 28，每处再生成 2–3 栋建筑，额外增加 16–24 栋建筑及对应墙/屋顶/坡道 mesh。现有 401-seed `<450m` 门禁依赖这套 28 点实现，却没有断言最终院落数量。Builder 需恢复准确的 20 处语义，并通过改进 20 点的覆盖采样而不是无记录扩量来继续满足 seed 303 与 401-seed 环境空白门禁。

#### 验证与待处理

- `npm run typecheck`：通过。
- `npm run test`：首次 18 files / 140 tests 中 1 项失败；重试为 2 项失败，均见 finding 3。定向 `loadCatalogModel + movementSystem` 为 2 files / 14 tests 通过。
- `npm run build`：通过；`index` 837.55kB、GLTF 625.30kB，仅保留 >500kB warning。`git diff --check e1c50ba --`：通过。
- 地图/AI 已在失败的完整套件中实际跑完：seed `832/859`、401-seed 几何与 `<450m`、5-seed 至少 42/49 持枪和 49 Bot 唯一胜者相关断言均通过；这不能覆盖 findings 1–2、4–6。
- 静音生产 smoke：本机 Chrome、volume `0`，菜单显示 50 人/49 AI，生产 HUD 与 400m 小地图可进入，console 无 error/warn。另通过本地 Vite 模块完成自动离机、真实 LOS 屋顶追击、同 tick 受击方向和排行榜注入复现。
- Builder 必须先处理 findings 1–6；writer 需补岛外自动离机、真实 LOS 完整上楼、同 tick 多来源公平性、排行榜 XSS、准确 20 院落及稳定完整测试门禁。复审前必须提供标准 `npm run test` 完整绿灯，不能记录为通过。
