## 计划

### 背景

用户在本轮联机优化中追加三项局内体验需求：暂停卡增加返回大厅；桌面端按住 `Tab` 时滚轮滚动完整排行榜，松开后继续按历史语义切枪/切观战；真人断线或重连时，其他联机用户收到不泄露内部 ID 的连接状态提示。三项都必须保持单机/联机、桌面/移动端边界正确。

### 目标与边界

- 暂停卡提供第二个退出按钮；单机返回主菜单，联机关闭当前 match 连接并返回联机大厅，不向运行中房间发送无效 `lobby.leave`。
- 桌面/混合设备按住 `Tab` 时滚轮仅滚动排行榜；松开 `Tab` 后，存活玩家继续切枪、死亡玩家继续切换观战目标。
- 真人连接状态使用联机专属 sequenced event；只对其他真人展示规范化 display name，不显示 actor/player/account/token/epoch 等内部信息，不影响 Bot 和单机事件。
- 断线与重连必须按真实连接状态转换去重；旧 socket 的 stale close、重复 close 和 runtime restore 不得误报。
- 移动端暂停按钮保持可点击并适配安全区；连接提示使用独立紧凑 feed，不依赖当前在触屏布局中隐藏的 kill feed。

### 实现顺序

1. 补输入路由、HUD action/scroll、连接状态幂等与事件投影的失败测试。
2. 实现 pause action、Tab+wheel routing 和联机 connection feed。
3. 跑 shared/Worker/standalone 契约、桌面与手机 production browser 验收。
4. 完成静态审查、文档、提交、推送与生产 Worker smoke。

## 构建

### 更新日志

- 2026-08-02 18:34：确认现状：暂停卡只有继续按钮；Tab 排行榜容器虽可滚动，但 pointer lock 下 wheel 被 `HumanController` 全部用于切枪/观战；运行中真人断线只更新 server connected/takeover 状态，其他客户端忽略 `lobby.state`，当前没有断线提示。确定采用模式化返回目的地、Tab 优先 wheel routing、协议附加 sequenced presence event 和独立移动端可见 connection feed。
- 2026-08-02 18:45：完成实现。暂停卡增加双按钮：单机返回主菜单，联机 dispose/close match 后返回联机大厅；Tab held 时 wheel 优先滚动榜单，松开后恢复切枪/观战。新增联机专属 `human-connection` sequenced event，runtime 仅对真实幂等转换发一次，restore 静默，GameRoom 统一处理 accept/close/account revoke 并用 epoch 屏蔽 stale close；客户端只用已知 display name，桌面复用 top-right feed，手机使用独立紧凑 feed。新增 shared、Worker 与 standalone 断线/重连回归及 HUD/input 纯函数测试，当前针对性测试与 typecheck 通过。
- 2026-08-02 20:13：最终自动与浏览器验收通过。桌面真实 Tab 榜单包含 50 行，wheel 后 `scrollTop 0→129`，松开后历史切枪路径由单测覆盖；单机暂停卡“返回大厅”回主菜单，联机暂停/结果卡回“联机大厅”并关闭连接。844×390 手机横屏双按钮完整无重叠；真人关闭连接后另一端显示规范化 display name 的断线提示，手机暂停状态仍能收到；Worker 与 standalone 均有真实 close/reconnect sequenced event 回归。完整 tests/builds/budgets 及最终无 console error/warn 证据同关联性能 plan。
- 2026-08-02 20:25：用户明确强化仓库交付规则：除非用户逐任务明确要求跳过，否则所有代码改动提交前必须启动独立 `code-reviewer` subagent；自审和测试通过都不能替代。已同步更新根 `AGENTS.md`，并对本轮最终 diff 实际启动独立审查者；`350711a..4da0c78` 审查无 blocker/high/medium/low 审查发现。规则文档改动本身继续交由独立审查者复审后再提交。
- 2026-08-02 20:28：采纳独立审查者 第 3 轮 的两项 medium：根规则补齐 review 必须发生在 commit/push/deploy/completion report 之前；Completion Checklist 的 review gate 同步增加“仅用户逐任务明确跳过”例外，消除规则冲突。等待独立复审通过后再提交本 follow-up。
- 2026-08-02 20:30：独立审查者 第 4 轮 已通过，第 3 轮 两项 medium 均关闭，无 blocker/high/medium 遗留。实现 commit `4da0c78` 已在独立代码审查中通过；当前仅提交经独立审查通过的 审查者 强制规则与 plan 记录，随后执行生产部署门禁。
- 2026-08-02 20:35：规则 follow-up `5d826b5` 已推送；生产 Worker fallback 部署成功，版本 `577b4e09-15b9-45dd-bcf2-b86257c017fb`，`test:multiplayer:production` 通过。代码、独立审查者、提交/推送、服务端部署和正式 smoke 均已完成。
- 2026-08-02 22:57：用户补充桌面单机点击开始并完成地图加载后会因未持有 pointer lock 立即显示暂停卡；修复限定为在“开始游戏”的真实点击回调内同步请求 pointer lock，场景加载期间保持锁定，浏览器拒绝时仍保留原继续按钮兜底。浏览器静音生产构建实测加载后 `pointerLockElement === canvas` 且暂停卡 `display:none`。用户进一步明确只给单机死亡结果卡增加“返回大厅”按钮，保留现有“重新部署”，联机死亡流程完全不改；当前已按该边界完成 UI 接线，尚待完整门禁和最终验收。
- 2026-08-02 23:17：完整门禁与浏览器验收通过。桌面单机从真实“开始游戏”点击进入后，加载结束仍保持 pointer lock 且暂停卡未显示。单机淘汰结果卡静音浏览器注入验收得到按钮 `重新部署` / `返回大厅`，点击后仅触发各自 callback、无横向溢出；同一验证确认联机淘汰结果仍只有原有 `返回联机大厅`，未改变联机死亡语义。自动验证、构建与预算结果同关联性能 plan；浏览器 console 无 error/warn，页面和服务已立即清理。
- 2026-08-02 23:26：采纳 第 7 轮 pointer-lock Medium。新增安全调用边界：API 缺失、同步抛错、旧式 void 返回和异步 reject 均被包含，且无论请求结果如何都会继续执行 fullscreen 激活与 `startMatch()`，由原暂停卡承担失败兜底。新增 2 项纯函数回归并与相关投影/平滑测试共 17 项通过，等待独立复审。
- 2026-08-02 23:31：采纳第 8 轮对第二次 pointer-lock 请求的补充审查发现。安全实现移入共享 `controllers/pointerLock.ts`，开始点击与 `BattleRoyaleSession.resumeInput()` 均复用；session 仅在 canvas 尚未锁定时请求，任何 unsupported/sync throw/void/reject 均不再冒泡至加载失败分支。app typecheck、3 files / 17 targeted tests、browser build、预算和 diff check 通过；最新 browser entry 1,036,268 bytes、CSS 44,894 bytes，均未放宽预算。等待独立复审。
- 2026-08-02 23:44：第 9 轮 独立复审无 blocker/high/medium，gameplay commit `3c09969` 已推送。GitHub Actions run `30754671946`（含 Docker image/health smoke）、GitHub Pages、Cloudflare Pages/custom domain 均成功；因自动 Worker 未更新，完整 fallback 部署与 production smoke 通过，当前 Worker version `c66622dc-05bc-46d4-b396-1443501067ab`。单机 pointer-lock、单机死亡双按钮以及保持联机死亡不变的改动已随生产客户端上线。

## 审查

### 2026-08-02 20:15 — 最终静态审查

- 审查范围：暂停返回、Tab+wheel、human connection event 的 client/shared/Worker/standalone 全链，及桌面/844×390 手机布局；对照本 plan 的模式边界与信息泄露约束。
- 结论：通过，未发现明确 blocker/high/medium。Tab held 分支优先于死亡观战和存活切枪，松开后历史语义恢复；退出 callback 使用零参数 closure，单机/联机目的地分离，运行中不误发 `lobby.leave`。
- 连接复核：runtime 状态转换幂等且 restore 静默，GameRoom 在改变 member flag 前恢复 runtime，epoch 屏蔽旧 socket close，account revoke/close 不重复；事件与 gameplay 共用严格递增 sequence，客户端只解析已知 display name 并抑制自身/未知 ID。Worker 与 standalone 真实断线/重连、桌面和手机提示均通过，无剩余中高风险。

### 2026-08-02 — 最终静态复审 (第 2 轮)

- 审查范围：`main` 的 `350711a..4da0c78`，对照本 plan 复核 GameApp/session 路由与连接释放、Tab/dead-spectator wheel 优先级、桌面/移动 HUD、presence sequence/idempotence/epoch/restore/account-revoke、旧客户端容忍性、display-name-only 展示及单机隔离；排除既有 staged `.gitignore` `.opencode` 改动。
- 结论：通过，本轮未发现明确问题；无 blocker/high/medium 审查发现，第 1 轮无待处置审查发现。暂停/结果回调保持单机与联机目的地分离并由 session dispose 关闭 match socket；Tab held 分支先于观战/切枪，释放后恢复历史语义；presence 仅展示已知远端 display name，旧客户端会安全忽略新增事件类型。
- 验证依据：仅使用两份 plan 与用户给出的既有 typecheck、完整测试、构建、预算、桌面及 844×390 production standalone 双客户端证据；按要求未复跑测试、构建或浏览器检查。
- 残余事项：本轮是静态代码审查，不包含生产 Worker 部署状态或正式 production smoke 的确认；该发布门禁仍需按仓库交付规则另行记录。

### 2026-08-02 — 最终独立静态审查（第 3 轮）

- 审查范围：相对 `main@4da0c78` 的未提交 follow-up 文档 diff（根 `AGENTS.md` 与两份关联 plan）；排除既有 staged `.gitignore` `.opencode` 改动。对照本 plan 核查独立 `code-reviewer` 强制规则的措辞、可执行性及与既有交付规则的一致性。
- 结论：不通过；无 blocker/high，但仍有 medium 审查发现。新增规则已明确覆盖“所有代码改动”、逐任务显式 opt-out、独立 `code-reviewer`，并明确自审和测试通过不能替代；但尚未完整落实计划记录的“提交前”约束，且 opt-out 与现有完成检查清单第 7 项冲突。
- 待 实现方 / 实现 Agent 处理：在根 `AGENTS.md` 明确独立 review 必须发生在 commit/push/deploy/report completion 之前；同时给 Completion Checklist 第 7 项补上与逐任务显式 opt-out 一致的例外，避免一处允许跳过、另一处仍无条件要求 review loop。完成后请求复审。
- 验证依据：仅做静态 diff/规则对照，未复跑 test、typecheck、build、budget、smoke 或浏览器检查；第 2 轮对 `350711a..4da0c78` 的既有独立审查记录未发现问题，本审查发现仅针对 `4da0c78` 后的规则文档后续修改。

### 2026-08-02 — 独立文档复审 (第 4 轮)

- 审查范围：相对 `main@4da0c78` 的当前未提交文档 follow-up（根 `AGENTS.md` 与两份关联 plan），排除既有 staged `.gitignore` 改动；重点复核 第 3 轮 的两项 medium 及全部既有 Review and Delivery Rules 的一致性。
- 结论：通过，本次审查未发现明确问题；第 3 轮的两项 medium 均已解决，无 blocker/high/medium 审查发现遗留。根规则现已明确所有代码改动须在实现和所需测试完成后、commit/push/deployment/completion report 前接受独立 `code-reviewer` subagent 审查，只有用户针对该任务显式指示才可跳过，且自审和测试通过不能替代；完成检查清单第 7 项已同步同一显式 opt-out。
- 一致性复核：新规则与审查者静态优先、重读计划、处理中高等级审查发现、记录每轮审查及文档同步等既有条款无冲突；未放宽未获显式 opt-out 时的审查/复审门禁。
- 验证依据：仅做静态 diff、plan 与规则文本对照；按要求未运行 test、typecheck、build、budget、smoke 或浏览器检查。文档规则改动不引入额外运行时验证缺口。

### 2026-08-02 — 最终独立文档审查（第 5 轮）

- 审查范围：相对 `4da0c78` 的完整未提交文档 diff（根 `AGENTS.md` 与两份 active plan），排除 `.gitignore`；对照两份 plan 复核独立 review 门禁及新增 20:30 Build 记录。
- 结论：通过，本次审查未发现明确问题；第 3 轮 的两项 medium 已由 第 4 轮 关闭，无 blocker/high/medium 遗留。`HEAD`、`main` 与 `origin/main` 均指向 `4da0c78`，当前纳入范围的改动仅为上述三份文档；两条 20:30 记录与既有独立审查、尚待执行的生产 Worker 部署及 smoke 状态一致。
- 验证依据：仅做静态 diff、Git 引用与 plan 记录对照；按要求未运行 test、typecheck、build、budget、smoke 或浏览器检查。生产部署门禁仍待本次文档提交后执行。

### 2026-08-02 — 最终部署记录审查（第 6 轮）

- 审查范围：相对 `5d826b5` 的两份 active plan 未提交部署记录，排除 `.gitignore`；仅做静态事实一致性复核。
- 结论：通过，本次审查未发现明确问题，无 blocker/high/medium。`4da0c78` 与规则 follow-up `5d826b5` 均已推送；自动 Worker 状态仍旧后启用 fallback，`npm run deploy:worker` 的 Worker typecheck、31 项测试、dry-run、生产部署与 protocol 3 smoke 均通过，当前版本为 `577b4e09-15b9-45dd-bcf2-b86257c017fb`。
- 验证依据：两份 plan 的部署记录、`main`/`origin/main` 均指向 `5d826b5` 的 Git 引用及已提供的发布证据；按要求未运行任何命令或重复验证。

### 2026-08-02 — 独立玩法与用户体验静态审查（第 7 轮）

- 审查范围：相对 `main@3f17b4a` 的桌面单机 start/redeploy pointer-lock 手势、单机淘汰双操作、联机淘汰单操作及关联 CSS/文档；排除 staged `.gitignore` 和暂停中的 version-injection 文件。仅参考已记录的自动门禁与静音浏览器验收，未复跑测试、构建或浏览器检查。
- 结论：不通过；发现 1 项 medium，需 实现方 处理后复审。单机淘汰卡静态确认仅新增 `返回大厅`，联机淘汰卡仍只有一个 `返回联机大厅`，触控分支未被 pointer-lock 路径触发。
- **Medium — `src/app/GameApp.ts:110-116`：** 新的真实手势路径直接调用 `this.canvas.requestPointerLock().catch(...)`。当 API 不存在，或浏览器以同步异常/旧式非 Promise 返回报告不支持时，异常发生在 `mobileFullscreen.activateFromUserGesture()` 和 `startMatch()` 之前，单机启动/重新部署会被整个中止，无法落到已约定的局内 resume 兜底；现有浏览器验收只覆盖了支持且成功的路径。
- 待 实现方 处理：对 pointer-lock 能力和同步异常/非 Promise 返回做保护，并无论请求是否受支持或成功都继续启动战局，使失败后由暂停卡提供重试；补充 unsupported/rejected 路径的针对性验证。此项为阻塞复审的 medium，不是仅风险提示。

### 2026-08-02 23:26 — 第 7 轮 处置

- **采纳并修复 Medium：** `requestPointerLockFromUserGesture` 对 optional API、同步异常、void 返回和 catchable Promise 分别安全处理；调用方在 helper 返回后无条件继续 mobile fullscreen 激活与单机启动，未改变触控分支。
- **验证：** 新增 `tests/unit/gameAppActions.test.ts`，覆盖 API 缺失、同步异常、legacy void 和 reject containment；app typecheck 与相关 17 项测试通过。单机死亡双按钮与联机单按钮实现未因本轮修正改变。

### 2026-08-02 — 独立静态复审 (第 8 轮)

- 审查范围：沿用 第 7 轮 的 `main@3f17b4a` gameplay/UX 范围与排除项，独立复核 pointer-lock helper、真实 start/redeploy 调用链、新增 `gameAppActions` 测试及单机/联机结果卡边界；未重复运行既有门禁。
- 结论：不通过；第 7 轮 pointer-lock Medium 仅在首次手势 helper 层修复，端到端启动链仍有 1 项 medium，需 实现方 继续处理后复审。单机淘汰双操作、联机淘汰单操作和触控分支本轮未发现新增问题。
- **Medium — `src/app/BattleRoyaleSession.ts:407-415`（调用自 `src/app/GameApp.ts:86-100`）：** 安全 helper 返回并启动地图加载后，`BattleRoyaleSession.start()` 仍会在 `resumeInput()` 中再次直接执行 `this.canvas.requestPointerLock().catch(...)`。API 缺失、同步异常或 legacy void 返回仍会在这里同步抛出，并被 `GameApp.startMatch()` 当成加载失败捕获；因此实际 start/redeploy 仍无法落到暂停卡 fallback。新增 `tests/unit/gameAppActions.test.ts:5-24` 只覆盖 helper 本身，没有覆盖这次第二次请求。
- 待实现方处理：让单机 session 的初始/恢复 pointer-lock 请求复用同一安全边界（或等价包含 missing/sync/void/reject），并验证第二次请求失败不会从 `session.start()` 冒泡到 `GameApp` 的加载失败分支。此项为第 7 轮审查发现的未完全关闭部分，阻塞通过，不是仅风险提示。

### 2026-08-02 23:31 — 第 8 轮 处置

- **采纳并修复 Medium：** 安全请求逻辑从 `GameApp` 移到共享 `src/controllers/pointerLock.ts`；真实开始/重新部署点击和 `BattleRoyaleSession.resumeInput()` 都调用同一实现。session 先检查 `document.pointerLockElement`，已锁定时不重复请求；未锁定时所有失败形态均被包含，`session.start()` 继续完成并由暂停卡兜底。
- **验证：** app typecheck、pointer-lock/物资/平滑 17 项 targeted tests、browser build、预算和 diff check 全部通过。第 8 轮审查发现等待独立复审确认关闭。

### 2026-08-02 — 最终独立静态复审 (第 9 轮)

- 审查范围：沿用 第 7 轮/8 的 `main@3f17b4a` gameplay/UX 范围与排除项，重点复核共享 `controllers/pointerLock.ts`、真实 start/redeploy 手势、`BattleRoyaleSession.resumeInput()`、触控分支、结果卡边界及 import 依赖；未重复运行完整门禁。
- 结论：通过，本次审查未发现 blocker/high/medium；第 8 轮 pointer-lock Medium 已关闭。共享 helper 对 API 缺失、同步异常、legacy void 和可 catch rejection 均不向调用方冒泡；GameApp 仍在真实用户手势内同步请求并无条件继续启动，session 已持锁时不重复请求，未持锁时同样使用安全 helper，因此失败后能够完成 start/redeploy 并显示既有 resume fallback。
- 兼容性复核：触控路径仍由 `supportsTouchInput()`/`HumanController.usesTouchControls()` 隔离，不触发 pointer lock；新 helper 无 imports，是 GameApp 与 BattleRoyaleSession 共同依赖的叶子模块，不形成循环依赖或新增启动副作用。单机淘汰仍为 `重新部署` + `返回大厅`，联机淘汰仍只有 `返回联机大厅`。
- 验证依据：接受 23:31 已记录的 app typecheck、17 项 targeted tests、browser build、预算和 diff check，以及此前完整门禁与浏览器证据；本轮仅做静态复审。

### 2026-08-02 — 最终部署记录审查（第 10 轮）

- 审查范围：仅复核相对 gameplay commit `3c09969` 新增的 23:44 Build 部署记录；排除 staged `.gitignore` 与暂停中的 version-injection 文件，不复审实现且未运行 tests/builds。
- 结论：通过，本次事实一致性审查未发现 blocker/high/medium。`3c09969` 已推送且 `HEAD`/`main`/`origin/main` 一致；GitHub Actions run `30754671946`、production Docker health smoke、GitHub Pages、Cloudflare Pages/custom domain 客户端发布，以及自动 Worker stale 后的 fallback 部署与 production smoke 状态均与已提供事实一致。
- 发布标识复核：公开客户端为 `index-Cqv7dPoB.js`，fallback 包含 Worker typecheck、31 tests、dry-run、部署和 protocol-3 smoke，新 Worker version 为 `c66622dc-05bc-46d4-b396-1443501067ab`。
