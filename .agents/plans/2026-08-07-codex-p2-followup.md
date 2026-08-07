## Plan

### 项目背景信息

PR #2 的提交 `ee1aca88e102cc97f758cedc4f06bb30200f2cb6` 已通过本地完整门禁、独立 reviewer、两条 GitHub CI 和 Cloudflare Pages preview，但 Codex 对该精确提交提出两个 P2：

1. 联机 admission 按钮可重复触发。后一次 `enterLobby()` 关闭旧连接时，旧连接的 `closed` handler 会无条件释放 pointer lock，可能把替换连接即将使用的锁清掉，重新出现“继续游戏”卡。
2. `isMatchCheckpointCompatible()` 对 v5 checkpoint 使用 `checkpoint?.state?.mapId`，缺失或截断 `state` 与合法 legacy state 缺少 `mapId` 都得到 `undefined`，会把损坏 checkpoint 错判兼容并在恢复时反复抛错。

用户已明确要求作为新的代码变更继续修复。上一任务 `.agents/plans/2026-08-07-compact-mixed-regions.md` 与提交 `ee1aca8` 均保持只读，本轮使用独立 plan、独立实现提交和新的 review/Codex 闭环。

### 事实与约束对齐

- 当前分支仍为 `feat/hybrid-regions`，本轮基线为本地/远端 `ee1aca8`，开始时工作区干净。
- 不修改地图布局、协议版本、checkpoint 版本、房间规则或 pointer-lock 产品语义。
- admission 修复必须覆盖顶部 quick/public/private/join 和公开房列表点击；重复点击不得启动第二条 admission。
- stale connection 的 `closed` handler 只有在该 connection 仍等于 `this.multiplayerConnection` 时才允许释放 pointer lock、停用 fullscreen 或更新活动连接状态。
- admission 失败必须释放 single-flight gate 并恢复按钮；成功进入 lobby 后也必须释放 gate，允许未来退出后重新入房。
- checkpoint v6 继续仅接受 island/town/mixed；v5 继续兼容完整 legacy state 缺少 `mapId` 以及 island/town，拒绝 mixed、未知 mapId 和 v4-。
- checkpoint state 必须至少具有完整恢复所需的顶层结构：合法 phase、有限 elapsedSeconds、uint32 mapSeed、actors/groundLoot/safeZone/flight records，以及 null/object result。缺失、null、数组或截断对象必须拒绝。
- Worker 与 standalone 共享 `MatchRuntime` 兼容判断；不得平台分叉。
- 本轮仍需独立 reviewer、普通 push、CI、Pages 和 Codex 对新提交通过。

### 更新日志

- 2026-08-07 08:55：用户明确要求继续修复 Codex 对 `ee1aca8` 提出的两个 P2；新任务开始，旧任务仓库记录保持只读。
- 2026-08-07 08:58：确认 admission 根因是缺少 single-flight 加 stale connection closed handler 无连接身份判断；checkpoint 根因是 mapId optional-chain 把缺失 state 与 legacy missing-mapId 混为一谈。
- 2026-08-07 09:05：失败回归准确复现：`MultiplayerAdmissionGate` 模块缺失，v5 `state: undefined` 被 `isMatchCheckpointCompatible` 错误接受。实现 generation-token gate、pending/active/reset、active connection identity guard；所有顶部 admission 和公开房列表共用 gate，pending 时同步禁用全部入口，菜单 reset 使旧异步 token 失效，旧 connection status/message handler 不再影响替换 connection。
- 2026-08-07 09:05：checkpoint 兼容判断改为接收 `unknown`，先验证 outer tick/snapshot/event sequence 和完整 MatchState 恢复结构，再应用 v6/v5 mapId 策略。合法完整 v5 missing-mapId/island/town 保留；missing/null/array/truncated state、损坏 actor/inventory/safe-zone/flight/loot/result、v5 mixed/unknown、v4- 拒绝。Worker 与 standalone 均新增缺失 state 的 v5 持久化删除回归。

### 文件/模块落点

#### Create

- `.agents/plans/2026-08-07-codex-p2-followup.md`
  - 本轮 Plan/Build/Review 唯一记录。
- `src/app/MultiplayerAdmissionGate.ts`
  - 小型 single-flight gate，承载 begin/end/pending，不依赖 DOM/Babylon，便于单测。
- `tests/unit/multiplayerAdmissionGate.test.ts`
  - 重复 begin 拒绝、end 后恢复。

#### Modify

- `src/app/GameApp.ts`
  - 所有 admission 入口共享 gate；pending 时禁用/忽略重复操作；active connection identity guard；成功/失败正确释放 gate。
- `src/server/MatchRuntime.ts`
  - checkpoint 参数按 unknown 防御性解析；验证 state 顶层恢复结构后再应用版本/mapId 策略。
- `tests/unit/matchRuntime.test.ts`
  - v5/v6 缺失、null、array、截断 state 回归。
- `tests/standalone/localDurableObjectRuntime.test.ts`
  - 损坏 v5 checkpoint 在 SQLite 重启后被删除，避免恢复循环。
- `AGENTS.md` / `docs/architecture.md`
  - 仅补长期 single-flight/active-connection ownership 和 checkpoint state shape 规则。

### 范围

#### 范围内

- Codex 两个 P2 的根因修复、回归测试、文档和交付闭环。

#### 明确不做

- 不重构联机菜单。
- 不改变公开/私人房行为、倒计时、重连 token 或连接协议。
- 不迁移 checkpoint schema 或提高版本。
- 不合并 PR、不生产部署。

### 任务拆解

### Task 1: 锁定失败回归

- 目标：Codex 两个反例在当前基线上失败。
- 文件：`tests/unit/multiplayerAdmissionGate.test.ts`、`tests/unit/matchRuntime.test.ts`。
- 验证：定向 Vitest；旧实现缺少 gate，v5 missing/truncated state 被接受。
- 完成标志：失败原因准确指向重复 admission 和 checkpoint state shape。

### Task 2: 修复 admission 竞态

- 目标：任意时刻最多一条 admission，旧 connection close 不影响替换 connection。
- 文件：`src/app/MultiplayerAdmissionGate.ts`、`src/app/GameApp.ts`。
- 关键点：所有 run/list join 入口共用 gate；active identity guard；finally 恢复；菜单重置。
- 验证：gate 单测、GameApp helper 定向测试、same-origin 双击/双客户端 Chrome。
- 完成标志：重复 begin 被拒绝；旧 close 不释放 active lock；正常入房/开局不回归。

### Task 3: 修复 checkpoint shape 验证

- 目标：只恢复具有完整顶层 state 的 v5/v6 checkpoint。
- 文件：`src/server/MatchRuntime.ts`、unit/standalone tests。
- 关键点：unknown record guard、state required fields、legacy missing mapId 仅在完整 state 上成立。
- 验证：unit compatibility matrix；standalone SQLite 删除损坏 checkpoint。
- 完成标志：合法 v5 island/town/undefined 保留，missing/truncated state 与 v5 mixed/v4 删除。

### Task 4: 完整验证与交付

- 目标：完成 typecheck、unit/Worker/standalone、coverage、build/budget、Chrome、review、push、CI/Codex。
- 完成标志：新提交在 reviewer、CI、Pages、Codex 均无 unresolved blocker/high/medium/P2。

### 风险与验证

- gate 若只保护顶部按钮而漏公开房列表，竞态仍存在；所有 admission 必须共用同一实例。
- gate 若成功后永不 end，退出房间后不能再次匹配；必须在 `enterLobby` 完成或失败后释放。
- stale handler identity guard 不能只保护 pointer lock，还要避免旧状态覆盖新 lobby status。
- checkpoint shape 不能要求 v5 legacy `mapId` 存在；但其他恢复顶层字段必须存在。
- 不把 wall-clock 当性能 gate；沿用已记录的有限高安全 timeout。

## Build

### 更新日志

- 2026-08-07 08:58：本轮基线 `ee1aca8`，本地与远端一致，工作区干净；开始添加失败测试。
- 2026-08-07 09:05：P2 定向合同通过：unit gate/GameApp/checkpoint 3 files / 12 relevant tests；Worker 损坏 v5 1/1；standalone SQLite 损坏 v5 1/1；全 typecheck 通过。完整受控门禁通过：unit 45 files / 440 tests、Worker 4 / 33、standalone 3 / 23；首次默认 unit 轮次仅在持续外部满核环境发生 3 个已有 mixed wall-clock timeout，无断言失败，按仓库既有方案以 8 workers + 120s 通用有限上限重跑通过，未修改测试内容或业务阈值。
- 2026-08-07 09:51：最终三套 coverage 通过。Application V8 为 statements 77.52%、branches 71.63%、functions 80.97%、lines 79.64%；Worker Istanbul 为 77.32% / 69.76% / 92.73% / 83.14%；standalone V8 为 77.13% / 62.25% / 86.30% / 80.43%；加权总值为 77.48% / 71.03% / 82.88% / 80.14%。coverage 阈值未调整。
- 2026-08-07 09:52：standalone/browser、Worker dry-run 与 server 构建通过。完整 checkpoint shape validator 使 Worker raw artifact 增至 `512,960B`，经最小资源审阅仅将 Worker 上限从 `510,000` 调整到 `515,000`，保留约 0.4% 余量；其余预算不变。最终 browser `1,096,496 / 1,100,000`、all JS `3,793,151 / 3,900,000`、252 / 260 chunks、dist `4,315,090 / 4,450,000`、Worker `512,960 / 515,000`、server `528,727 / 530,000`，全部 PASS；`git diff --check` 通过。
- 2026-08-07 09:55：same-origin standalone Slow 3G Chrome MCP 验收通过。对“快速匹配”执行真实 double click 后，quick/create-public/create-private/join 四个入口在同一事件循环内同步 disabled；Network 仅出现一次 `POST /v1/guests` 和一次 `POST /v1/matchmaking/quick`，无第二 admission/connection。进入公开房 `RR29JJ` 后 `pointerLockElement===canvas`，console 仅 SwiftShader warning。截图 `/tmp/last-line-codex-p2-single-flight.webp`。验证后页面导航 `about:blank`、isolated context 关闭、standalone 有界 shutdown、8800 关闭，浏览器只剩 `about:blank`。
- 2026-08-07 10:17：重新完整读取本 plan 后采纳独立 reviewer Round 1 的两个 medium。所有 admission success/catch UI、pointer-lock 和 fullscreen 副作用现在同时要求 generation token active 与原 menu/root 仍 connected；finally 仅对 active token 执行 end，并只在原 owner 仍存在时恢复旧按钮，保证 menu reset 后旧 reject 不能影响新尝试，同时成功 enterLobby 替换 DOM 后 gate 仍正常结束。新增 `admissionAttemptOwnsSideEffects` 与 reset→new attempt→old reject ownership 回归。
- 2026-08-07 10:17：checkpoint validator 改为严格数字 armor/helmet 枚举，不再通过 `Number()` 接受字符串；safe-zone stage 必须小于 `BATTLE_ROYALE_CONFIG.safeZoneStages.length`，closed 状态只能位于最后阶段。补充字符串 armor 和 stage 999 拒绝回归；reviewer 最小复现已关闭。受影响完整测试通过：unit gate/GameApp/MatchRuntime 3 files / 21 tests、Worker admin 11/11、standalone runtime 9/9；全 typecheck 通过。
- 2026-08-07 10:17：reviewer 修复后顺序 standalone/browser、Worker dry-run/server build 与预算通过：browser `1,096,754 / 1,100,000`、all JS `3,793,409 / 3,900,000`、Worker `513,266 / 515,000`、server `528,987 / 530,000`，其余预算不变且 PASS；`git diff --check` 通过。
- 2026-08-07 10:24：采纳独立 reviewer Round 2 的 1 个 medium。`enterLobby()` 的 WebSocket open failure 现在由该 connection 在仍为 active 时自行清理：清空 active connection、释放 pointer lock、停用 fullscreen、重渲染联机大厅并显示具体错误；stale connection 仍无权操作 UI。外层 admission catch 保持 owner/token 保护，避免旧异步影响新页面。
- 2026-08-07 11:02：完成 Round 2 修复后的真实 WebSocket open failure Chrome 验证。same-origin standalone 使用临时 8801 与隔离 context，通过 `initScript` 将 `window.WebSocket` 替换为同步抛出 `forced websocket failure` 的构造器；HTTP guest/quick admission 成功后 socket open 失败，页面从 lobby shell 返回可操作的联机大厅，四个 admission 按钮恢复，`pointerLockElement!==canvas`，不再停留“正在连接”死页。身份初始化随后将状态恢复为“游客模式，服务器待命”，核心恢复/解锁合同通过；验证后 context/8801 均清理，只剩 `about:blank`。
- 2026-08-07 11:02：Round 2 修复后最终完整门禁通过：typecheck；unit 45 files / 441 tests、Worker 4 / 33、standalone 3 / 23。最终 application coverage 为 77.46% / 71.54% / 81.00% / 79.55%；Worker/standalone coverage 沿用本轮 P2 最终报告 77.32% / 69.76% / 92.73% / 83.14% 与 77.13% / 62.25% / 86.30% / 80.43%；加权总值为 77.43% / 70.96% / 82.90% / 80.07%。受影响完整 unit gate/GameApp/MatchRuntime 21/21、Worker admin 11/11、standalone runtime 9/9 另行通过。
- 2026-08-07 11:02：Round 2 修复后 build/budget 继续通过：browser `1,096,976 / 1,100,000`、all JS `3,793,631 / 3,900,000`、Worker `513,266 / 515,000`、server `528,987 / 530,000`，其余预算不变；`git diff --check`、环境端口和 Chrome 清理通过。

## Review

待实现和完整验证后由独立 reviewer 追加。

### Round 1 — 2026-08-07

- 审查范围：完整读取 reviewer 提示、根 `AGENTS.md`、`README.md` 和本 plan；以 `ee1aca88e102cc97f758cedc4f06bb30200f2cb6` 为唯一直接基线，静态审查 `git diff ee1aca8` 的全部 tracked 增量、三个 untracked 新文件，以及 admission/checkpoint 的实际调用链。旧 compact plan 未修改。
- 已参考外层证据：typecheck；P2 定向 unit/Worker/standalone；完整 unit 45 files / 440 tests、Worker 4 / 33、standalone 3 / 23；三套 coverage；build/budgets；Slow 3G 真实 double click 单 admission 与浏览器清理。reviewer 未重复完整门禁。
- 额外最小只读验证：现有测试未覆盖 checkpoint 的字符串枚举和越界安全区阶段，因此直接构造当前 `MatchRuntime.checkpoint()` 的损坏副本调用兼容判断。`armorLevel: "1"` / `helmetLevel: "2"` 被错误接受；`safeZone.stageIndex=999`、`status="waiting"`、`secondsRemaining=0` 也被接受，恢复后的首次 `step()` 以“安全区阶段不存在: 999”抛错。命令未修改文件。
- 审查结论：**不通过，阻止提交。** Findings：blocker 0、high 0、medium 2、low 0。以下 medium 均需 builder / writer 修复并请求复审。

#### Medium

1. `src/app/GameApp.ts:408`、`src/app/GameApp.ts:547`：generation token 只在 admission promise 成功后、进入 `enterLobby()` 前检查；`catch` 中的 pointer-lock/fullscreen/UI 清理没有确认 `attempt` 仍 active。用户离开菜单触发 `reset()` 后可以启动新 admission，而旧 `action()` / public-list `joinRoom()` 随后 reject 时，旧 catch 仍会无条件释放当前 canvas pointer lock、停用 fullscreen，并可能写入新页面可复用的 status 节点。这正是本轮要求禁止的“旧 async 影响 replacement”，只是来源从 stale connection close 变成 stale admission rejection。`finally` 的 token-aware `end(attempt)` 不能阻止 catch 副作用。需要让所有成功、失败、finally UI/锁操作都以 active token 和对应 menu/root identity 为所有权条件，并加入 reset → 新 attempt → 旧 promise reject 的回归。
2. `src/server/MatchRuntime.ts:400`、`src/server/MatchRuntime.ts:426`：checkpoint shape guard 仍接受不符合 `MatchState` 且能造成错误恢复的值。护甲/头盔使用 `Number(value.*Level)`，所以字符串 `"1"` / `"2"` 被判兼容；更严重的是 `safeZone.stageIndex` 只要求非负整数，没有限制到 `BATTLE_ROYALE_CONFIG.safeZoneStages` 可恢复范围。最小复现中 `stageIndex=999` 的 combat/waiting checkpoint 返回 compatible，恢复后首个 tick 直接在 `BattleRoyaleMode.getStage()` 抛错，房间会继续保留并由 watchdog 反复尝试，而不会走构造期 incompatible checkpoint 删除路径。需要使用严格数字枚举，并验证 phase/status 对应的 stage index 及其他会在恢复后直接索引/运算的数值合同；至少添加字符串枚举和越界 stage 的拒绝/删除回归。

- 非阻塞确认：顶部 quick/public/private/join 与公开列表确实共享同一 gate，pending 会同步禁用全部入口；active connection status/message handler 的 identity guard 和 `enterLobby()` open failure 清理方向正确。Worker 与 standalone 都通过共享 `GameRoom` 构造期兼容判断执行 `deleteAll()`，缺失 state 的持久化删除测试有效。Worker raw 上限仅从 `510,000` 调到 `515,000`，对应 validator 增量并保留约 0.4% 余量，其他预算未调整。

### Round 2 — 2026-08-07

- 审查范围：重新完整读取本 plan 最新 Build/Review、根 `AGENTS.md`、`README.md` 和 reviewer 提示；继续以 `ee1aca88e102cc97f758cedc4f06bb30200f2cb6` 为直接基线，静态复审当前完整 diff，重点检查 Round 1 disposition 的 admission side-effect ownership、gate finally 语义和 checkpoint 首 tick 可恢复性。
- 已参考外层证据：受影响定向 unit/Worker/standalone、完整 tests、typecheck、顺序 builds 和 budgets；reviewer 未重复完整命令。本轮结论来自静态异步状态机/DOM ownership 调用链分析，不需要额外运行验证。
- Round 1 checkpoint disposition：严格 `0 | 1 | 2` equipment level、`stageIndex < safeZoneStages.length` 和 closed-only-last-stage 已正确实现；完整 v5 missing-mapId/island/town 仍兼容，字符串 level 和 stage 999 回归覆盖原反例。未发现该项剩余 blocker/high/medium。
- 审查结论：**不通过，阻止提交。** Findings：blocker 0、high 0、medium 1、low 0。以下 medium 需 builder / writer 修复并请求复审。

#### Medium

1. `src/app/GameApp.ts:412`、`src/app/GameApp.ts:563`、`src/app/GameApp.ts:637`：admission HTTP 成功后调用 `enterLobby()` 会先安装 connection 并用 `renderLobbyShell()` 移除原 `panel` / public-list `root`，然后等待 `connection.open()`。如果 WebSocket open 失败，`enterLobby()` 会清空 active connection、关闭 socket并重新抛错，但外层 catch 的 `admissionAttemptOwnsSideEffects(..., ownerConnected)` 因原 owner 已不在 DOM 而返回 false；connection 的 closed handler 又因 active connection 已清空而被 identity guard 跳过。结果没有任何 owner 释放 pointer lock、停用 fullscreen、显示错误或恢复可操作入口，页面停在无 actions 的“正在连接” lobby shell。finally 虽能 end gate，却不会恢复已被替换的 UI。顶部四入口和公开列表都存在同一路径。需要在进入 lobby 时显式转移 side-effect ownership，或让 `enterLobby()` 对自己创建并仍拥有的 shell/connection 完成 open-failure UI、lock、fullscreen 清理；添加 admission 成功 → DOM 替换 → socket open reject 的回归。

- 非阻塞确认：menu reset 后旧 token 的 success/catch/finally 已不会影响新 attempt；成功 `enterLobby()` 后 finally 会 end active token，gate 不会卡 pending。checkpoint 修复、Worker/standalone 删除路径、文档和最终预算调整未发现新的明确问题。

### Round 3 — 2026-08-07

- 审查范围：重新完整读取本 plan 最新 Build/Review、根 `AGENTS.md`、`README.md` 和 reviewer 提示；继续以 `ee1aca88e102cc97f758cedc4f06bb30200f2cb6` 为直接基线，静态审查当前完整 diff，重点复核 Round 2 WebSocket open-failure ownership、admission gate 并发/finally 和 checkpoint 合法 legacy/finished 边界。
- 已参考外层最终证据：typecheck；unit 45 files / 441 tests、Worker 4 / 33、standalone 3 / 23；最终 coverage；顺序 builds/budgets；Slow 3G single-flight 与强制 WebSocket 构造失败真实 Chrome 验收及清理。reviewer 未重复完整门禁。
- 额外最小只读验证：构造完整 v5 missing-`mapId` checkpoint 和合法 finished/closed v6 checkpoint；前者兼容并恢复为 island，后者兼容。字符串 equipment level 与 stage 999 均被拒绝，结果符合最终合同，命令未修改文件。
- Admission 结论：顶部四入口和公开列表继续共享单一 generation gate；menu reset 后旧 success/reject/finally 无副作用，新 attempt 保持 active。成功 `enterLobby()` 替换 DOM 后 finally 仍 end token；active WebSocket open failure 由 connection owner 清空 active connection、释放 pointer lock、停用 fullscreen、重渲染可操作联机大厅并设置错误。该重渲染会 reset gate，因此外层 catch/finally 不会二次清理；stale connection 仍被 identity guard 隔离。未发现 pending 卡死、旧 reject 影响新 attempt、status handler 越权或 open-failure 死页。
- Checkpoint 结论：完整 v5 missing-mapId/island/town 保持兼容；v5 mixed/unknown、v4- 和缺失/截断 state 拒绝。严格 equipment enum、safe-zone stage 上界和 closed-last-stage 约束关闭了已知首 tick 崩溃路径；合法 finished/closed 未被误伤。Worker/standalone 继续通过共享兼容判断删除损坏持久化记录。
- 审查结论：**通过。** 本次审查未发现明确问题。Findings：blocker 0、high 0、medium 0、low 0；没有阻止提交的 unresolved finding。
- 残余风险：checkpoint validator 目标是“可恢复 shape”而不是完整业务不变量证明；例如未知 item/weapon ID 或有限但极端的血量、计时数值会由现有系统容错或后续规则归一化，而不是在兼容层全部拒绝。当前未发现这类值会触发构造期或首 tick 未捕获异常，作为非阻塞防御深度边界保留。
