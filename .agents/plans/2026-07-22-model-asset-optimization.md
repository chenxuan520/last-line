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
- 2026-07-22 23:07：按用户反馈修正手机加载面板轻微溢出。`src/styles/main.css` 将 `.loading-panel` 从固定宽度改为 `min(420px, 100%)`，补齐 `min-width/max-width`，窄屏下居中并收紧内边距；资源加载与地图准备共用该面板。生产 build 与 diff check 通过；Chrome DevTools MCP 静音验收确认 390×844 资源加载面板为 `362×162`、667×375 地图准备面板为 `420×162`，两者均完整落在视口/安全区内且 document/UI root 横向 overflow 均为 0，console 无 error/warn。用户明确要求该纯 CSS 小修不再重复 reviewer，验收后已立即关闭隔离页、停止 4173 并终止明确的 MCP headless Chrome，当前等待直接提交推送。
- 2026-07-22 23:14：按用户最终选择，仅将第一/第三人称手持枪恢复为此前程序化模型，保留现有角色 GLB/角色距离 LOD和地面物资模型。`IslandScene` 中高画质只按需加载 character base/LOD1，不再加载、实例化或压制程序化武器；生产 manifest 的四个 `model.weapon.*` 恢复为 `procedural-model` 并移除武器 `.lod1` 声明，文档和场景回归预期同步。用户明确要求本次先提交推送，测试和 reviewer 稍后再单独执行，因此本轮未运行枪械回退后的 typecheck/test/build，也未发起 reviewer；该验证缺口保留待用户后续指令处理。手机加载面板修复此前已完成 build/MCP 验收并已彻底清理浏览器与服务。
- 2026-07-23 00:33：处理手持枪回退后的生产问题并完成完整验证。用户提供的控制台日志确认部署切换期间动态 `glTF` chunk 曾被 CDN 以 HTML 返回，人物 base/LOD1 因加载器 import 失败而回退旧程序化模型；新增 `vite:preloadError` 恢复控制器，跨刷新最多重试 2 次，成功加载后清除预算，多次失败后仍允许原 fallback 继续游戏。旧程序化第三人称枪不再留在 actor 根坐标，而是分别在新人物 base/LOD 的 `weapon_socket` 下创建；第一人称旧枪保持原样。AI authored PBR 战斗服按 manifest 改为暗蓝灰（主衣 `#526773`、深拼接 `#344550`、浅层 `#6C8290`、护甲/背带 `#252C2E`、头盔 `#30383A`），皮肤色保持不变，联机真人 player GLB 继续使用原军绿色。同步修复上一提交遗漏的 production manifest 测试。完整三套 typecheck、应用 **32 files / 301 tests**、Worker **3 files / 28 tests**、standalone **2 files / 15 tests**、应用 build 和 diff check 均通过；仅保留既有大 chunk warning。Chrome DevTools MCP 高画质静音实测确认 enemy base/LOD GLB 与 loader chunk 全部 200、启用人物 uniform 为 `#526773`、旧 body 未启用、程序化枪父节点为 base/LOD `weapon_socket`、console 无 error/warn；近景截图为临时目录 `enemy-blue-gray-procedural-weapon.png`。验收后已关闭隔离页、停止 4173 并终止明确的 MCP headless Chrome。按用户要求下一步先提交推送，再监控流水线并调用 reviewer。
- 2026-07-23 01:49：继续处理用户新增的 AI、场景品牌、草垛辨识与首页介绍需求。Round 6 dynamic chunk recovery 的 high/medium 已按 reviewer 要求修正并经 Round 7 `No findings` 闭环：预算只在完整 character base/LOD 成功后清除，sessionStorage 全链路 best-effort。AI 三层楼问题确认由重叠内梯 support、坡道中途无法识别、跨楼层目标不重算 preserve-aim 路径、水平距离误判到达及 zone 复用 combat path 共同导致；内梯改为左右分道折返，GridNavigator 支持坡道中点上下行，Bot 跨楼层重算路径、战斗记忆改 3D 到达、zone 不复用瞄准路径，并新增三层双向移动、坡道中点、玩家跳下追击和圈外下楼回归。5 张品牌贴图已逐张确认含义：空降区、苍岬岛行动徽章、LL-01 资产牌、限制区域、补给标识；以 5 个稳定 decal ID 接入野外落区、医院、北港、雷达哨和旧仓区的非碰撞实体标牌。草垛从浅黄褐改为深橙黄 `#B86B22`。首页新增战术手册风格 ABOUT 入口/响应式对话框，集中展示创建者 `chenxuan520`、GitHub 仓库、五步玩法、桌面与手机操作。本阶段定向实现完成，等待完整门禁、MCP 验收、最终 reviewer、提交推送；用户既有 `.gitignore` 保持不动，5 张品牌图现纳入本任务。
- 2026-07-23 02:21：上述 AI/首页/品牌/草垛实现完成最终验证。完整三套 typecheck、应用 **32 files / 305 tests**、Worker **3 files / 28 tests**、standalone **2 files / 15 tests**、应用 build、Worker dry-run、Node server bundle和 diff check 全绿；仅保留既有大 chunk warning。AI 回归确认三层内梯可双向连续通行、任意内梯中点均可规划到地面/屋顶、可见目标从屋顶跳下会重算跨层路径、圈外屋顶 Bot 能下楼进入地面安全区，49 Bot 五 seed 武装率及完整唯一胜者继续通过。Chrome DevTools MCP 静音生产 preview 验收：ABOUT 桌面双栏与 390×844 手机单栏滚动布局均无横向溢出；5 张品牌图全部创建稳定标牌，正面文字方向正确，其中补给牌截图 `brand-supply-sign-front-final.png`；草垛实际材质 `#B86B22` 且与黄色物资明显区分，截图 `hay-orange-final.png`；console 无 error/warn。每轮验收后均已关闭隔离页、停止 4173、确认只剩 `about:blank` 并终止明确的 MCP headless Chrome。等待最终 reviewer。
- 2026-07-23 03:13：逐条确认 Round 8 的 1 high + 3 medium 以及 Round 9 的 1 high + 1 medium 均成立并继续修正。内梯左右分道后为每层补充跨两条 lane 的 authoritative landing，且 landing 中心与 ramp endpoint 对齐；新增 seed 0 全部多层建筑真实 `MovementSystem` 上下楼验证，不再只验证 path 非空。权威内梯几何变化同步把 multiplayer protocol 与 `MatchCheckpoint` 版本从 2 升至 3，旧客户端/旧房间不会混用新几何。品牌标牌改由纯函数在每个 seed 上旋转/扩圈选取位置，避让建筑、权威岩石、掩体、树干、坡道、其他标牌、地图边缘和陡坡；覆盖 seed 14 等代表 seed。ABOUT 打开时将背景 menu 设为 `inert`，Tab/Shift+Tab 在对话框内循环，Escape 关闭并恢复触发按钮焦点；Chrome MCP 已实测 close → Shift+Tab 到最后链接 → Tab 回 close → Escape 回 ABOUT 按钮，背景不可聚焦、console 无 error/warn。修正后代表 seed 的标牌、内梯/AI 定向回归、typecheck 和 build 已通过，所有 MCP 页面、4173 服务及调试 Chrome 已立即清理；等待最终完整门禁与 Round 10。
- 2026-07-23 10:08：Round 10 reviewer 结论为 `No findings`，Round 8/9 全部 finding 闭环。最终完整门禁再次通过：三套 typecheck、应用 **33 files / 308 tests**、Worker **3 files / 28 tests**、standalone **2 files / 15 tests**、应用 build、Worker dry-run、Node server bundle和 diff check 全绿；仅保留既有大 chunk warning。最终实现覆盖 AI 三层楼上下行/追击/进圈、protocol/checkpoint v3、动态 chunk 有界恢复、暗蓝灰 AI 角色、正确 socket 的程序化手持枪、5 张安全落位品牌标牌、深橙黄草垛和可访问的响应式 ABOUT 手册。架构文档同步内梯共享几何、视觉标牌和 ABOUT 边界；准备提交推送并监控 CI。

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

### 2026-07-23 00:48 CST — Round 6（角色 GLB 生产加载稳定性）

- 审查范围：重读本 plan、`AGENTS.md` 和 README 后，按用户给定基线完整审查 `878c9d7..25c000a`；忽略用户既有 `.gitignore` 修改。重点复核 Vite preload error 语义、跨刷新预算、fallback、程序化武器 base/LOD socket 与资源生命周期、PBR 调色共享和测试/文档同步。
- 审查结论：**不通过**，存在 1 个 high、1 个 medium；需 builder 修复并补回归后复审。
- High（重试预算可在后续动态 GLTF 依赖失败时无限重置）：`src/client/render/loadCatalogModel.ts:41-48` 在顶层 `@babylonjs/loaders/glTF` import 一成功就删除计数，早于 `LoadAssetContainerAsync`。Vite 8 会为每个失败的动态 import 分派 `vite:preloadError`；当前生产 build 中 Babylon glTF 加载器在此后仍会按 PBR 模型路径动态 import `pbrMaterial.pure`、`pbrMaterialLoadingAdapter` 等 chunk。若这些后续 chunk 在部署切换中返回 HTML，页面每次都会先成功导入顶层 loader 并把计数清零，再因同一后续 chunk 失败而 reload，导致 `MAX_RELOADS` 永远不可达、程序化 fallback 也无法稳定接管，直接违反“两次后停止”的目标。现有测试只独立调用 clear 并连续分派事件，没有覆盖“前置 loader 成功清零、后续 preload 失败、跨页面重复”的循环。需把预算清除绑定到完整模型动态加载链路稳定成功之后，并增加跨 reload 生命周期回归。
- Medium（sessionStorage 拒绝会把可选恢复逻辑升级为启动/模型故障）：`src/main.ts:5-9` 在 `GameApp` 初始化前直接求值全局 `sessionStorage`，而 `src/client/dynamicChunkRecovery.ts:13-15` 和 `src/client/render/loadCatalogModel.ts:44` 也未隔离 storage 的 `SecurityError`。在 storage 被浏览器策略拒绝或页面处于无可用存储的 origin 时，前者可让应用完全无法启动；即使初始化时取得对象，成功 loader 后的 `removeItem` 异常也会把已成功的 import 重新判成失败并强制角色 fallback。恢复计数应为 best-effort，存储不可用不能破坏既有游戏或模型 fallback；需补 get/set/remove 抛错回归。
- 已确认无新增问题：角色 base/LOD 失败仍保留既有程序化人物；程序化第三人称武器分别位于有效 base/LOD `weapon_socket` 下并随父 LOD 生效，旧 actor-root 武器保持压制；scene dispose 仍回收 observer、实例和 container；enemy base/LOD 独立容器的共享 PBR 材质只按各自 manifest metadata 修改，skin 与无调色 metadata 的 player palette 不受影响；manifest 测试及文档与生产条目一致。
- 已参考验证：用户提供的完整 typecheck、应用 **32/301**、Worker **3/28**、standalone **2/15**、build/diff check、Chrome 高画质静音验收和成功的 CI/Pages run `29938582668`。Reviewer 另复跑 dynamic recovery、loader、manifest、IslandScene **4 files / 26 tests** 全部通过，并确认 Vite 8 helper 的 default-prevented/throw 语义及生产 bundle 的后续 PBR 动态 import；`git diff --check 878c9d7 25c000a` 无输出。
- 待处理：builder 修复以上 high/medium 并补齐异常存储与“顶层 loader 成功后下游 chunk 持续失败”的回归，再请求 Round 7；现有 bounded-retry 文档结论在修正前不成立。

### 2026-07-23 01:21 CST — Round 7

- 审查范围：重读本 plan、`AGENTS.md` 和 README 后，仅复审 `25c000a` 当前工作区中 Round 6 high/medium 对应的 dynamic chunk recovery、loader/scene 接线及测试；按用户要求忽略 `.gitignore`、品牌素材及其他 AI/首页进行中改动。
- 审查结论：**通过，No findings**。Round 6 的 1 个 high、1 个 medium 均已闭环，未发现新的 blocker/high/medium/low。
- High 已闭环：顶层 `@babylonjs/loaders/glTF` import 不再清除预算；只有当前场景实际需要的 character base/LOD 全部经过 `loadCatalogModel` 的动态依赖加载、GLB 解码、renderable mesh 与节点契约校验并返回成功后，`replaceCatalogModels` 才 best-effort 清除计数。任一下游 PBR chunk 或模型失败都会保留预算并返回既有程序化 fallback，不再出现每次 reload 先清零的循环。
- Medium 已闭环：`main` 只注册惰性的 `window.sessionStorage` getter；getter 以及 get/set/remove/reload 均被隔离为 best-effort。只有计数成功持久化才 `preventDefault()` 并 reload；无法取得/写入 storage 时不拦截 Vite 原始错误，既不会阻止应用初始化，也不会把成功 loader 因清理异常改判为失败。
- 测试处置：新增 denied-storage 回归和完整 character base/LOD 成功后清预算断言；现有 partial-failure/LOD fallback 用例继续覆盖加载失败路径。用户提供 targeted typecheck、**4 files / 27 tests**、build 及完整应用 **32/301**、Worker **3/28**、standalone **2/15** 全绿；Reviewer 复跑相同 **4 files / 27 tests** 通过，相关 diff check 无输出。
- 残余风险：本轮只调整失败恢复与存储防御逻辑，未重复浏览器视觉验收；Round 6 已确认的生产 GLB、palette、weapon socket/LOD 和资源生命周期结论不变。

### 2026-07-23 02:32 CST — Round 8（AI、品牌标牌、草垛与 ABOUT 最终审查）

- 审查范围：重读本 plan、`AGENTS.md` 和 README 后，以 `HEAD 25c000a` 为基线审查当前全部未提交任务改动；按用户要求忽略其既有 `.gitignore`，并将 5 张品牌 WebP 作为任务文件。覆盖三层楼移动/导航/战斗路径缓存、权威几何与 checkpoint/protocol 兼容、品牌标牌、草垛、ABOUT、Round 7 dynamic chunk recovery 及测试/文档。
- 审查结论：**不通过**，存在 1 个 high、3 个 medium；需 builder 修复并补回归后复审，checkpoint/protocol 策略若调整需 writer 同步架构/部署说明。
- High（分道内梯约半数楼型无法进入或离开顶层）：`src/config/map.ts:761-786` 固定偶数层在左 lane、奇数层在右 lane，但 `src/ai/navigation/GridNavigator.ts:302-311` 的顶层 approach 永远在 stairwell 的建筑内侧。顶层 lane 位于外侧时，顶层 ramp 与内侧楼板之间没有 landing，路径会横穿相邻低层 ramp 上方的空洞并坠落，随后持续追逐无法到达的高 Y waypoint。seed 0 实际移动诊断中，两层 `building-0-1`（side=1）上楼停在 waypoint 4/6、Y=6.80（屋顶 Y=11.76），三层 `building-0-12`（side=-1）停在 6/8、Y=12.24（屋顶 Y=17.44）；反向下楼同样在第二个 waypoint 坠落并卡住。seed 0 的 45 个内梯建筑有 24 个属于该不连续组合。现有 movement/Bot 回归只取 seed 0 第一个恰好连续的三层 `building-0-0`，没有覆盖两种 stairwell side 与 2/3 层奇偶组合，因而计划中的下楼修复并未完整成立。
- Medium（权威坡道语义升级未隔离旧客户端/旧 checkpoint）：内梯中心线和宽度已经从 HEAD 的居中 3.6m 改为分道 2.4m，直接改变移动、弹道/LOS、导航和可恢复角色位置；但 `src/network/protocol.ts:16` 仍为 protocol 2，`src/server/MatchRuntime.ts:18` 仍为 checkpoint 2，且本轮没有兼容迁移。滚动部署时旧客户端会被新服务端接受并渲染不同坡道，升级前的 running checkpoint 也会按新几何恢复，违反现有“权威地图语义不兼容即关闭旧房间”的契约。
- Medium（品牌标牌固定偏移会在部分 map seed 穿入权威场景）：`src/client/render/scenes/IslandScene.ts:1262-1311` 只按 POI 固定 offset 放置标牌，没有对建筑、岩石、树和 cover 做 clearance。对 seed 0–999 的布局诊断发现 65 个标牌中心落在权威障碍 footprint 内，其中 drop-zone 62 次；例如 seed 14 的 drop-zone 位于 `building-8-0` 内，会被墙体遮挡。现有 IslandScene 测试只在 seed 0 断言创建 5 个 mesh，未验证多 seed 可见放置。
- Medium（ABOUT 声明为 modal，但键盘焦点未按 modal 管理）：`src/app/GameApp.ts:145-178,222-237` 打开时只聚焦关闭按钮，没有让背景菜单 inert/隐藏，也没有 Tab focus trap；从对话框最后一个链接继续 Tab 会进入背后的菜单，此后 Escape 事件不再经过 overlay。关闭时也未把焦点还给 ABOUT 触发按钮。视觉桌面/手机验收不能覆盖该键盘和辅助技术回归，当前亦无对应测试。
- Round 7 复核：预算仍只在所需 character base/LOD 全部成功后 best-effort 清除，sessionStorage 的 get/read/write/remove 与 reload 异常仍被隔离；未发现 dynamic chunk recovery 回归。
- 已参考验证：用户提供的三套 typecheck、应用 **32/305**、Worker **3/28**、standalone **2/15**、应用/Worker/server builds、diff check 及静音桌面/手机 MCP 验收；Reviewer 确认 `git diff --check 25c000a` 无输出，并执行上述多楼型真实 `MovementSystem` 路径诊断、1000-seed 标牌 footprint 诊断及静态焦点链审查。
- 待处理：builder 修复内梯 landing/lane 连通性并覆盖两种 side × 2/3 层的上下行；升级并验证 protocol/checkpoint 语义或提供证据充分的兼容迁移；让 5 个标牌按布局选择无障碍稳定位置并补多 seed；补齐 ABOUT 的焦点约束、关闭回焦和键盘测试。以上完成后请求 Round 9。

### 2026-07-23 02:55 CST — Round 9

- 审查范围：重读本 plan、`AGENTS.md` 和 README 后，以 `HEAD 25c000a` 为基线复审当前完整工作区，重点逐项验证 Round 8 的 1 high + 3 medium；继续忽略用户 `.gitignore`，5 张品牌 WebP 属任务文件。
- 审查结论：**不通过**。Round 8 的 checkpoint/protocol 与品牌位置 medium 已闭环，ABOUT 的运行时代码已闭环但约定的键盘验证仍缺失；内梯 high 仍可稳定复现，需 builder 继续处理后请求 Round 10。
- High（未闭环，新增 landing 仍未进入实际换道路径）：`src/config/map.ts:818-839` 把 full-width landing 放在 ramp endpoint 之外的 Z 区间，但 `src/ai/navigation/GridNavigator.ts:302-311` 仍把楼板 approach 放在 `z = ramp.endZ`，路径也仍直接连接 ramp 中心与 approach。实际移动会在距离 endpoint 0.5m 内提前切换 waypoint，并在 landing 覆盖区之前横穿另一条低层 lane 上方，故 Round 8 的坠落/高 Y waypoint 卡死没有改变。Reviewer 用当前 `GridNavigator` + `MovementSystem` 对 seed 0 全部 45 栋多层楼逐栋执行真实上下行，仍有原来的 24 栋双向失败；`building-0-1` 上楼仍停在 4/6、Y=6.802（屋顶 11.76），下楼停在 2/6，`building-0-12` 上楼仍停在 6/8、Y=12.242（屋顶 17.44），下楼停在 2/8。`tests/unit/mapLayout.test.ts:525-543` 只断言 navigator 返回非空数组，不能证明路径可走；`tests/unit/movementSystem.test.ts:320-354` 仍只选择第一个恰好连续的 `building-0-0`。
- Medium（验证缺口，ABOUT 待完整闭环）：`src/app/GameApp.ts:222-260` 已正确加入 menu inert、Tab 环绕、Escape 和关闭回焦，静态复核未见新的焦点链问题；但仓库测试中仍没有 ABOUT/dialog/inert/focus 用例，本轮也没有提供改动后真实键盘 MCP 证据，因此 Round 8 明确要求的键盘测试尚未完成。builder 应补自动回归，或在无 DOM 测试基础设施时按仓库浏览器规则提供可定位的真实键盘验收记录。
- 已闭环（checkpoint/protocol）：`MULTIPLAYER_PROTOCOL_VERSION` 与 `MATCH_CHECKPOINT_VERSION` 均从 2 升到 3；共享服务会按既有精确版本检查拒绝旧客户端并清理旧 checkpoint，未见分叉语义。
- 已闭环（品牌位置）：新增纯函数 `getBrandSignPlacements`，候选按固定顺序确定并同时检查 bounds、建筑/岩石/cover/树、坡道、标牌间距和坡度。现有代表 seed（含 14）测试通过；Reviewer 另独立扫描 seed 0–999，5 个标牌均生成且上述约束 0 失败。scene 仍只消费结果创建非碰撞、非 pickable 展示对象。
- 其他复核：Round 7 dynamic chunk recovery、草垛颜色、AI preserve-aim/3D memory/zone path 改动未见新回归；`git diff --check 25c000a` 无输出，未发现 `context.Background()`。
- 已参考验证：用户提供修正前完整门禁（应用 **32/305**、Worker **3/28**、standalone **2/15**、typecheck/builds）及本轮 app typecheck、定向 **6 files / 106 tests** 与 simulation suite；最终全量门禁按用户说明尚待 review 后复跑，不能替代上述真实移动失败。
- 待处理：builder 让 landing 与导航换道 waypoint 形成有面积余量的连续支撑，并用真实 `MovementSystem` 覆盖两种 stairwell side × 2/3 层（至少 seed 0 全部多层楼双向）；补 ABOUT 键盘自动或真实浏览器验证后再请求 Round 10。checkpoint/protocol 和品牌问题无需继续改动。

### 2026-07-23 10:07 CST — Round 10

- 审查范围：重读本 plan、`AGENTS.md` 和 README 后，以 `HEAD 25c000a` 为基线最终复审当前完整任务 diff；按要求忽略用户 `.gitignore`，5 张品牌 WebP 作为任务文件。重点验证 Round 9 内梯 high 与 ABOUT 验证 medium，并回看 AI 路径缓存、权威移动/弹道/LOS、checkpoint/protocol、标牌、草垛、动态 chunk recovery、渲染生命周期和测试/文档。
- 审查结论：**通过，No findings**。Round 9 的 high/medium 均已闭环，当前未发现新的 blocker/high/medium/low。
- High 已闭环：每层 landing 现在以 incoming ramp endpoint 为中心、宽度覆盖两条 lane、深度为 `2 * STAIRWELL_LANDING_DEPTH`，在 waypoint 0.5m 提前切换时仍提供连续权威支撑，并与相邻楼板相接。新增测试不再只判断 path 非空，而是用真实 `MovementSystem` 将 seed 0 全部 45 栋多层楼逐栋上楼再下楼。Reviewer 独立执行同构诊断得到 `buildings: 45, failed: 0`，此前 `building-0-1`、`building-0-12` 等失败组合均已恢复。
- Medium 已闭环：ABOUT 打开时将背景 menu 设为 inert，焦点进入关闭按钮；Tab/Shift+Tab 在 dialog 内首尾环绕，Escape 关闭，关闭后 inert 复位并把焦点还给 ABOUT。用户提供的真实 Chrome MCP 键盘链路逐项验证上述行为，补足 Round 9 的验证缺口。
- 其余复核：protocol 与 MatchCheckpoint 均为版本 3，既有共享兼容检查会拒绝旧客户端并清理旧 checkpoint；品牌位置保持纯确定性并检查 bounds、坡度、建筑/岩石/cover/树/坡道及标牌间距，代表 seed 含 14，Round 9 的 0–999 seed 独立扫描结论仍适用；标牌和 GLB 仍为非权威展示对象且随 scene dispose，草垛为 `#B86B22`；preserve-aim 跨 surface 重算、3D combat-memory arrival、zone 不复用 combat path 及 Round 7 chunk recovery 未见回归。未发现 `context.Background()`。
- 已参考验证：用户提供最终完整门禁——三套 typecheck、应用 **33 files / 308 tests**、Worker **3 / 28**、standalone **2 / 15**、应用/Worker/server builds 与 diff check 全绿；静音 MCP 已确认 ABOUT 桌面/手机、键盘焦点、5 个正面标牌、橙色草垛、console 无 warning/error并完成页面/服务/调试 Chrome 清理。Reviewer 另复跑 movement/navigation/Bot/brand/combat **5 files / 97 tests** 全部通过，独立完成 seed 0 全楼型物理上下行诊断，并确认 `git diff --check 25c000a` 无输出。
- 残余风险：未发现需要阻塞交付的残余风险；后续新增楼层数、内梯拓扑或品牌类型时应继续扩展真实移动与多 seed 放置语料。
