## Plan

### 背景

现有角色和枪械 GLB 已生成，但角色由 28 个 mesh 部件组成，后续 50 人同场时绘制批次偏高；模型还需要提供远景版本，方便后续接入 LOD。

### 目标

1. 保持现有模型外观和挂点契约不变。
2. 将基础 GLB 的静态部件按材质合并，降低 mesh / draw call 数量。
3. 生成角色和枪械的远景 LOD GLB，移除不影响轮廓的小部件。
4. 不修改资源清单、渲染接入和权威玩法逻辑。

## Build

### 更新日志

- 2026-07-22 17:03：确认当前分支为 `main`，工作区已有 `.gitignore` 修改和上一轮模型资源；本次只覆盖 `public/assets/models/`，保留现有未提交改动。
- 2026-07-22 17:06：完成模型优化。基础角色由 28 个 mesh 合并为 8 个，基础枪械为 4–5 个；新增角色和枪械 `*-lod1.glb` 远景版本，角色为 6 个 mesh、枪械为 4–5 个。最终目录全部通过 Babylon.js 9.16.2 NullEngine GLB 解码、可渲染 mesh、`root` 和角色/枪械挂点校验；未修改资源清单、渲染接入或玩法代码，未提交/推送。
- 2026-07-22 18:56：按用户要求开始接入全部 12 个 GLB，并落实两组展示层优化。资源清单已声明 player/enemy 与四类武器的 base/`.lod1` 稳定 ID 和 required nodes；远端真人/AI 分别使用 player/enemy 模型，第一人称使用 base 武器，第三人称武器按 `grip` 对齐 `weapon_socket`，角色按画质距离切换 LOD。HUD 重计算降至 10Hz、排行榜按排名字段缓存，安全区复用单一 position buffer；树/灌木/装饰岩改硬件实例，低/中/高细节递增并采用 60/90/120 FPS 上限。定向 app typecheck 及 HUD/场景/固定步/资源清单相关测试已推进，修复了导入武器被 fallback 抑制逻辑误伤的问题；尚待完整门禁、MCP 静音画面/LOD/性能验收、review、提交和推送。用户要求已同步进 `AGENTS.md`：每轮 Chrome/Edge MCP 验证结束必须立即关闭本轮页面/context、停止本轮服务并确认只剩 `about:blank`，不得拖到任务末尾。
- 2026-07-22 19:31：完成最终实现和自动门禁。按用户补充口径，低画质完全跳过 GLB 替换并保留程序化角色/武器，资源目录也不再在菜单阶段预载 model；中/高画质才按需下载、校验和缓存当前场景需要的角色以及四类武器 base/LOD1。完整 `npm run typecheck`、应用 **30 files / 278 tests**、Worker **3 files / 27 tests**、standalone **2 files / 15 tests**、应用 build、Worker dry-run、Node server bundle及 `git diff --check` 全部通过；构建仅保留既有大 chunk warning。实现自检确认 `src/game/`、命中/碰撞、AI、协议和服务端权威规则未改，30Hz 固定步在 60/90/120 render cap 下保持不变。用户要求删除所有 MCP/调试启动的 Chrome，本轮已终止全部相应 headless Chrome 并通过进程检查得到 `NO_MCP_CHROME_PROCESSES`；因此最终版本不再重新启动浏览器，视觉验收缺口明确保留，不伪造浏览器结论。当前尚未提交/推送。
- 2026-07-22 20:09：逐条确认 Round 1 的 1 high + 2 medium 均成立并完成修正。`attachModel` 现在按原分量缩放导入根，保留 GLB 左右手系转换所需的负 Z；生产 GLB 回归验证角色/第一人称导入根 handedness、枪口位于相机前方、第三人称 `grip` 与 `weapon_socket` 世界坐标重合，同时修复程序化角色抑制误关导入 `visualModel` 根的问题。base 角色或武器失败时不再以 LOD1 取代，近远景和第一人称均保留程序化 fallback；LOD1 单独失败时有效 base 全距离使用。角色 manifest 新增明确的 `armorMeshes`/`helmetMeshes` 契约，loader 强制校验为可渲染 mesh，装备显隐不再依赖自由命名。`npm run typecheck`、相关资源/loader/场景 **3 files / 20 tests** 和 `git diff --check` 通过；新增真实生产 GLB 变换、base 失败但 LOD1 成功、缺失装备 mesh 回归。等待 reviewer 复审。
- 2026-07-22 20:18：确认 Round 2 的 medium 成立并完成修正，同时补齐其 low 验证缺口。manifest validator 现在要求所有 `model.character.*` GLB 声明非空 `armorMeshes`/`helmetMeshes`，loader 对直接构造 catalog 的绕过路径执行同样防御校验，并继续验证每个名称对应可渲染 mesh；文档示例和替换步骤同步必填字段。partial-failure 回归拆分覆盖“角色 base 成功但武器 base 失败时第一/第三人称均保留程序化武器”和“角色/武器 LOD1 失败后远距离继续使用有效 base”。`typecheck:app`、资源/loader/场景 **3 files / 24 tests** 与 diff check 通过；等待 Round 3 复审。
- 2026-07-22 20:36：Round 3 reviewer 结论为 `No findings`，review 闭环完成。最终完整门禁通过：应用 **30 files / 285 tests**、Worker **3 files / 27 tests**、standalone **2 files / 15 tests**、三套 typecheck、应用 build、Worker dry-run、Node server bundle及 diff check 全绿。按用户提醒在 review 后完成一次 Chrome DevTools MCP 静音生产验收：844×390 横屏触控下低画质 HUD 约 `61 FPS`，资源列表没有 GLB 或 glTF loader chunk；同一轮切换中画质后 HUD 约 `89 FPS`，按需加载 enemy base/LOD1 与四类武器 base/LOD1 共 10 个 GLB、未加载本地玩家第三人称角色，触控对局可从航线进入滑翔，画面和 HUD 正常，console 无 error/warn。验收完成后立即导航到 `about:blank`、停止 4173 preview、确认仅剩空白页，并终止全部 MCP/调试 headless Chrome；最终进程检查为 `NO_MCP_CHROME_PROCESSES`。截图保存在临时目录 `final-model-lod-mcp.png`。等待提交、推送和 CI。
- 2026-07-22 21:40：用户明确把后续范围扩展为权威树干掩体与移动端全屏，并选择继续沿用本 plan，覆盖原 Plan 中“不修改权威玩法逻辑”的旧边界。当前 `main` 与 `origin/main` 对齐，工作区仅有用户既有 `.gitignore` 修改，继续保持不触碰。新口径为：树干由 map seed 确定并同时进入移动、弹道/LOS、AI 导航和物资掉落避障；所有画质与联机端保持相同树木数量/位置，只降低视觉模型精度而不删树；移动端仅从真实用户点击申请全屏并尝试横屏锁定，失败或退出全屏后提供可点击重试，不从 `orientationchange` 绕过浏览器激活限制。已完成代码链路梳理，尚未修改实现。
- 2026-07-22 21:59：完成权威树干与移动全屏主实现。`MapLayout.treeTrunks` 以独立 seed 流固定生成 384 个树干，避让建筑、权威岩石/掩体、坡道、道路、物资和其他树干；移动碰撞、`SimulationCombatWorld` 子弹/LOS、`GridNavigator`、Bot 撤退掩体和动态掉落统一消费该数组。渲染层不再按画质删树，各档均实例化同一批树干/树冠，仅把树冠 tessellation 设为 5/6/7；协议版本升为 2，旧客户端会被明确拒绝，避免新旧权威地图混用。新增 `MobileFullscreenController`：单机开始/重开与私人房主开始按钮同步请求全屏，成功后尝试锁定横屏；自动开始的联机客户端不伪造激活，而在 HUD 提供全屏重试；请求拒绝、退出全屏及不支持 API 都保留手动横屏降级。相关地图、移动、弹道、导航、掉落、场景、画质、协议和全屏定向测试通过，`typecheck:app` 通过；地图 21 tests、IslandScene 11 tests及其余定向 51 tests 均通过。README、`AGENTS.md`、架构和部署文档已同步，完整门禁、review 与浏览器验收待执行。
- 2026-07-22 22:04：完整自动门禁通过：三套 typecheck、应用 **31 files / 297 tests**、Worker **3 files / 27 tests**、standalone **2 files / 15 tests**、应用 build、Worker dry-run、Node server bundle及 `git diff --check` 全部成功；应用构建仅保留既有大 chunk warning。五 seed 权威树干生成、401 seed 地图稳定性、49 Bot 武装/完整局、真实两客户端 standalone 对局与 checkpoint 恢复均通过。当前改动尚待 reviewer 闭环和 Chrome MCP 静音验收，未提交/推送；用户既有 `.gitignore` 继续保持任务外且不会纳入提交。
- 2026-07-22 22:22：逐条评估 Round 4 的 3 个 medium，均确认成立并修正。地面导航对树干改用树干所在地形高度做垂直相交判断，新增跨 30m 山坡高差路径回归；其他墙段仍沿用当前楼层 support，第一次完整复跑发现医院出门回归失败后已据此收窄判断，BotController 52 tests 与导航 4 tests 重新通过。`MatchCheckpoint` 新增独立语义版本 2，Durable Object/standalone 共享的 GameRoom 加载旧 checkpoint 时会关闭 socket、移除目录记录并删除房间，而不是按新树木几何恢复旧角色/物资；Worker 新增真实旧 checkpoint 恢复清理测试。私人房主启动失败、倒计时回退、连接关闭、主动离房和返回菜单路径均收口全屏控制器，已获得或延迟完成的方向锁都会释放；控制器 7 tests 通过，部署/架构文档同步旧房间策略。修正后的最终完整门禁与 Round 5 复审待执行。
- 2026-07-22 22:30：Round 4 修正后的最终门禁通过：三套 typecheck、应用 **31 files / 299 tests**、Worker **3 files / 28 tests**、standalone **2 files / 15 tests**、应用 build、Worker dry-run、Node server bundle和 diff check 全绿；仅保留既有大 chunk warning。完整门禁过程中先后暴露并修正了地面墙段过滤回归与 Worker 旧 checkpoint 测试的 Durable Object eviction 不稳定写法；最终版本保留医院出门、49 Bot 完整局、导航索引/完整扫描等价、真实两客户端 checkpoint 恢复及旧语义房间清理。等待 Round 5 复审。
- 2026-07-22 22:45：Round 5 reviewer 结论为 `No findings`，3 个 medium 全部闭环。随后仅用 Chrome DevTools MCP 在 844×390、coarse pointer、touch、横屏、主音量 0 的生产 preview 验收：点击“开始游戏”后 `document.fullscreenElement === document.documentElement`，`screen.orientation.type=landscape-primary`，触控 HUD 正常且约 90 FPS；主动退出全屏后“进入全屏”按钮立即出现，真实点击可重新进入全屏并自动隐藏。实机场景可见完整树干/树冠和地形，截图为临时目录 `authoritative-tree-fullscreen-mcp.png`，console 无 error/warn。验收结束立即导航到 `about:blank`、关闭隔离 context、确认仅剩唯一空白页、停止 4173 preview，并核对后仅终止明确带 `--headless=new`、`--remote-debugging-pipe` 和临时 Puppeteer profile 的 MCP Chrome 根进程；无调试 Chrome 或本地服务残留。当前等待提交、推送和 CI。

## Review

待资源生成和 Babylon GLB 加载校验完成后记录。

### 2026-07-22 19:58 CST — Round 1

- 审查范围：以本 plan 和用户补充目标为基线，完整对照 `bd9559b..84436c1`（merge-base 为 `bd9559b`）；确认未改动 `src/game/`、网络协议或服务端权威逻辑。
- 审查结论：**不通过**，存在 1 个 high、2 个 medium，需 builder 修复后复审。
- High：提交的角色/武器 GLB 以 `+Z` 为正面/枪口方向；Babylon 导入根原有 `scaling=(1,1,-1)` 与 Y 轴旋转共同完成左右手系转换，但 `attachModel` 用 `scaling.setAll(scale)` 覆盖了负 Z，留下 180° 旋转。结果 yaw=0 时角色和第三人称武器背向瞄准方向，第一人称枪口位于相机后方。需保留/正确组合导入根变换，并用真实生产 GLB 验证角色正面、grip/socket 和 muzzle/camera 方向。
- Medium：base GLB 单独失败而 LOD1 成功时，`replaceCatalogModels` 会用 LOD1 替代第一人称/base 近景并抑制程序化 fallback，违反“加载失败保留程序化 fallback”和“第一人称始终 base”的契约。需按层级独立回退并补部分失败测试。
- Medium：装备显隐依赖 mesh 名包含 `armor`/`helmet`，但该隐式命名契约既未进入 manifest/required-node 校验，也未写入替换文档；合法替换模型可能让护甲/头盔永久显示或在某一 LOD 消失。需明确并验证可替换资产的装备节点/mesh 契约，或采用不依赖自由命名的映射。
- 已参考验证：`npm run typecheck` 通过；应用 30 files / 278 tests、Worker 3 files / 27 tests、standalone 2 files / 15 tests 通过；`npm run build` 通过（仅大 chunk warning）；`git diff --check` 通过。另用 Babylon 9.16.2 NullEngine 解码生产 GLB 并检查实例世界变换，确认上述方向问题。
- 残余风险：未做 Chrome/Edge 视觉验收；现有 IslandScene GLB 测试对 12 个 ID 复用同一个合成三角形 GLB，只检查元数据/显隐，未覆盖生产资产方向、挂点世界变换和 partial-failure fallback，因此不能替代修复后的真实资产验证。

### 2026-07-22 20:14 CST — Round 2

- 审查范围：重新读取本 plan 后，审查工作区相对 `84436c1` 的全部修正；`.gitignore` 为 plan 已记录的任务前既有改动，不计入本轮修正结论。
- 审查结论：**不通过**，Round 1 high 与 base/LOD fallback medium 已闭环；装备显式契约 medium 仍未完全闭环，另有 1 个 low 测试覆盖缺口。
- 已闭环：`attachModel` 改为按原分量缩放，生产 GLB NullEngine 测试确认角色/第一人称导入根保留负 Z、第一人称枪口位于相机前方、第三人称 grip 与 socket 重合；`suppressProceduralCharacter` 也跳过 `visualModel`，导入根不再被误关。
- 已闭环：运行时只在 base 角色/武器有效时抑制对应程序化 fallback；第一人称不再使用 LOD1，LOD1 缺失时代码会将 base 用于远近两组。
- Medium（需 builder 处理）：文档声明 character entry **必须**提供 `armorMeshes`/`helmetMeshes`，但 manifest validator 和 loader 都未要求字段存在且为非空字符串；缺失/类型错误会被解析为空列表并继续加载，运行时因此无法标记导入装备 mesh，护甲/头盔可永久显示。文档示例和替换步骤也仍省略这两个必填字段。需让 manifest/loader、文档和测试对“必填或显式无装备”的语义一致。
- Low（验证缺口）：partial-failure 测试同时让 enemy base 与 rifle base 失败，未单独经过“角色 base 成功、武器 base 失败”的第三人称分支，也没有 LOD1 单独失败后在远距离继续使用 base 的回归断言；当前实现经代码审查符合预期，但测试未完整锁定要求矩阵。
- 已参考验证：`npm run typecheck` 通过；资源/loader/场景定向 3 files / 20 tests 通过；`npm run build` 通过（仅既有大 chunk warning）；`git diff --check 84436c1` 通过。未进行 Chrome/Edge 视觉验收。

### 2026-07-22 20:23 CST — Round 3

- 审查范围：重新读取本 plan 后，完整复审工作区相对 `84436c1` 的修正；`.gitignore` 仍为 plan 已记录的任务前既有改动。
- 审查结论：**通过，No findings**。未发现新的 blocker/high/medium/low。
- Round 2 medium 已闭环：manifest validator 对所有 `model.character.*` GLB 强制要求非空 `armorMeshes`/`helmetMeshes`；loader 对直接构造 `AssetCatalog` 的路径重复执行防御校验，并确认声明名称对应可渲染 mesh；生产 manifest、运行时精确名称映射、文档示例和替换步骤保持一致，缺失契约会回退程序化模型而不会留下永久装备。
- Round 2 low 已闭环：测试分别覆盖角色 base 成功但武器 base 失败时第一/第三人称保留程序化武器，以及角色/武器 LOD1 失败后远距离继续使用有效 base。
- 复核确认 handedness、生产 GLB 枪口方向、第三人称 grip/socket 对齐、导入根显隐、base/LOD fallback 和场景 dispose/container/observer 生命周期未出现新回归。
- 已参考验证：`npm run typecheck` 通过；定向资源/loader/场景 3 files / 24 tests 通过；完整应用单测 30 files / 285 tests 通过；`npm run build` 通过（仅既有大 chunk warning）；`git diff --check 84436c1` 通过。Worker/standalone 未在本轮重跑，修正未涉及共享多人或服务端代码；Chrome/Edge 视觉验收仍为已记录缺口。

### 2026-07-22 22:10 CST — Round 4（权威树干与移动全屏续作）

- 审查范围：重新读取本 plan、`AGENTS.md` 和 README，以用户批准的续作目标为基线，审查 `main` 工作区相对 `HEAD b6c63ba` 的全部任务改动；按要求完全忽略用户既有 `.gitignore` 修改。
- 审查结论：**不通过**，存在 3 个 medium，需 builder 修复并复审；若调整升级/存量房间策略，writer 需同步部署文档。
- Medium（AI 导航未可靠纳入山地树干）：`src/ai/navigation/GridNavigator.ts:269-275,314-320,497-503` 虽把 `treeTrunks` 加入 blocker，但整条地面路径只用起点的 `supportY` 做垂直相交过滤。山地路径起点与树所在位置高度差超过角色高度时，树会被排除，而实际移动会贴地到树处并被 `MovementSystem` 挡住，Bot 因而会反复规划同一条穿树直线。定向诊断在 seed 0 的 `tree-trunk-0` 上得到跨树两点直线路径（仅 2 个点），树底高 `19.978`，起点地面高 `30.6901`、终点 `7.4953`；seed 1/7/19/42/99 也均复现。现有单测仅在树两侧各 5m 的近似同高地面验证绕行，未覆盖该山地高差。需让地面 blocker 判断使用障碍物位置的地形/沿路径高度语义，并补高差回归。
- Medium（协议升级没有隔离旧语义 checkpoint）：`src/server/MatchRuntime.ts:30-35,53-64,193-199` 的 `MatchCheckpoint` 不记录地图/协议语义版本，`worker/GameRoom.ts:603-616` 会无条件把既有 `checkpoint-v1` 状态交给当前代码恢复，而 `worker/GameRoom.ts:271-280` 又始终向该房间宣告当前 protocol 2。升级前已运行的房间因此可在新代码下继续：角色和旧动态掉落来自无树地图，但恢复后的移动/弹道/导航突然生成 384 棵树；新客户端仍会接受该房间。单纯 bump WebSocket welcome 版本不能阻止这类旧/新地图语义混合，standalone 也复用同一恢复路径。需给 checkpoint/room 加语义版本并拒绝、关闭或明确迁移旧房间，并覆盖升级恢复测试。
- Medium（私人房主失败/退出路径泄漏横屏锁生命周期）：`src/app/GameApp.ts:470-480` 在房主点击时立即激活全屏控制器，但 `cannot-start` 等普通错误路径 `src/app/GameApp.ts:413-424` 只更新状态，退出房间也直接返回联机菜单；两者均未调用 `deactivate()`。而 `src/client/ui/MobileFullscreenController.ts:63-75` 只有 `deactivate()` 才会 `orientation.unlock()`。房主在其他玩家未准备时点击（服务端会返回 `cannot-start`），随后退出房间，菜单仍可能被锁在横屏，违反手动降级与有界生命周期要求。需在未进入对局的离开/关闭/启动失败路径收口控制器，并补 GameApp 级生命周期测试。
- 已参考验证：用户提供的完整门禁均通过——应用 31 files / 297 tests、Worker 3 / 27、standalone 2 / 15、完整 typecheck、应用/Worker/server builds 和 diff check；代码复核覆盖地图生成、移动/弹道/LOS、导航/撤退、动态掉落、渲染画质、协议及全屏/HUD 生命周期。另运行了上述多 seed 导航定向诊断。尚未进行本续作的 Chrome/Edge 静音移动端验收；自动门禁不能覆盖真实全屏激活、方向锁和浏览器拒绝行为。
- 待处理：builder 修复以上 3 项并补回归后请求 Round 5；writer 按最终 checkpoint 兼容策略更新 `docs/deployment.md`。Chrome/Edge 移动端验收在无 unresolved medium 后执行。

### 2026-07-22 22:36 CST — Round 5

- 审查范围：独立重读本 plan、`AGENTS.md` 和 README 后，以 `HEAD b6c63ba` 为基线复审当前完整任务 diff，并重点核验 Round 4 的 3 个 medium；继续完全忽略用户既有 `.gitignore` 修改。
- 审查结论：**通过，No findings**。Round 4 的 3 个 medium 均已闭环，未发现新的 blocker/high/medium/low。
- 已闭环（山地树干导航）：`MapTreeTrunk.kind` 提供显式类型标记；`GridNavigator` 仅在地面路径判断树干时使用树干所在地形高度，墙段、楼层和其他既有障碍仍沿用当前 surface support。30m 山坡高差回归、索引/完整扫描等价和既有多层建筑/医院出门路径共同覆盖该边界。复跑 Round 4 的 seed 0/1/7/19/42/99 定向诊断，已不再出现跨树的两点直线路径。
- 已闭环（旧 checkpoint 语义隔离）：`MatchCheckpoint.version` 固定为当前语义版本 2；共享 `GameRoom` 在创建 runtime 前检查 running/finished checkpoint，版本不兼容时向存量 socket 发送 `room-closed` 并关闭、以 finished summary 移除 Lobby 目录记录、删除房间存储，且 `ensureRuntime` 另有防御检查。Worker 真实 Durable Object 旧 checkpoint 清理回归和架构/部署文档与实现一致。
- 已闭环（全屏/方向锁生命周期）：`cannot-start`、terminal room error、倒计时回退到 waiting、连接关闭、主动离房、联机菜单及主菜单路径均会 `deactivate()`；开始创建多人 session 前清除旧 lobby status handler，避免进入游戏后由旧回调误释放方向锁。已获得及延迟完成的 orientation lock 都会释放，且仍仅从真实点击请求 fullscreen。
- 已参考验证：用户提供的最终完整门禁——三套 typecheck、应用 **31 files / 299 tests**、Worker **3 / 28**、standalone **2 / 15**、应用/Worker/server builds 和 diff check 全部通过。Reviewer 另复跑导航/全屏控制器/checkpoint 定向 **3 files / 14 tests**，并执行六 seed Round 4 导航诊断，全部通过；`git diff --check b6c63ba` 无输出。
- 残余风险：真实移动浏览器对 fullscreen/orientation API 的支持和拒绝策略仍需按 plan 在 Chrome/Edge 静音验收中确认；该浏览器验收缺口不构成代码 finding。
