## Plan

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

## Build

### 更新日志

- 2026-08-02 18:34：确认现状：暂停卡只有继续按钮；Tab 排行榜容器虽可滚动，但 pointer lock 下 wheel 被 `HumanController` 全部用于切枪/观战；运行中真人断线只更新 server connected/takeover 状态，其他客户端忽略 `lobby.state`，当前没有断线提示。确定采用模式化返回目的地、Tab 优先 wheel routing、协议附加 sequenced presence event 和独立移动端可见 connection feed。
- 2026-08-02 18:45：完成实现。暂停卡增加双按钮：单机返回主菜单，联机 dispose/close match 后返回联机大厅；Tab held 时 wheel 优先滚动榜单，松开后恢复切枪/观战。新增联机专属 `human-connection` sequenced event，runtime 仅对真实幂等转换发一次，restore 静默，GameRoom 统一处理 accept/close/account revoke 并用 epoch 屏蔽 stale close；客户端只用已知 display name，桌面复用 top-right feed，手机使用独立紧凑 feed。新增 shared、Worker 与 standalone 断线/重连回归及 HUD/input 纯函数测试，当前针对性测试与 typecheck 通过。
- 2026-08-02 20:13：最终自动与浏览器验收通过。桌面真实 Tab 榜单包含 50 行，wheel 后 `scrollTop 0→129`，松开后历史切枪路径由单测覆盖；单机暂停卡“返回大厅”回主菜单，联机暂停/结果卡回“联机大厅”并关闭连接。844×390 手机横屏双按钮完整无重叠；真人关闭连接后另一端显示规范化 display name 的断线提示，手机暂停状态仍能收到；Worker 与 standalone 均有真实 close/reconnect sequenced event 回归。完整 tests/builds/budgets 及最终无 console error/warn 证据同关联性能 plan。
- 2026-08-02 20:25：用户明确强化仓库交付规则：除非用户逐任务明确要求跳过，否则所有代码改动提交前必须启动独立 `code-reviewer` subagent；自审和测试通过都不能替代。已同步更新根 `AGENTS.md`，并对本轮最终 diff 实际启动独立 reviewer；`350711a..4da0c78` 审查无 blocker/high/medium/low finding。规则文档改动本身继续交由独立 reviewer 复审后再提交。
- 2026-08-02 20:28：采纳独立 reviewer Round 3 的两项 medium：根规则补齐 review 必须发生在 commit/push/deploy/completion report 之前；Completion Checklist 的 review gate 同步增加“仅用户逐任务明确跳过”例外，消除规则冲突。等待独立复审通过后再提交本 follow-up。
- 2026-08-02 20:30：独立 reviewer Round 4 已通过，Round 3 两项 medium 均关闭，无 blocker/high/medium 遗留。实现 commit `4da0c78` 已在独立代码审查中通过；当前仅提交经独立审查通过的 reviewer 强制规则与 plan 记录，随后执行生产部署门禁。

## Review

### 2026-08-02 20:15 — Final static review

- 审查范围：暂停返回、Tab+wheel、human connection event 的 client/shared/Worker/standalone 全链，及桌面/844×390 手机布局；对照本 plan 的模式边界与信息泄露约束。
- 结论：通过，未发现明确 blocker/high/medium。Tab held 分支优先于死亡观战和存活切枪，松开后历史语义恢复；退出 callback 使用零参数 closure，单机/联机目的地分离，运行中不误发 `lobby.leave`。
- 连接复核：runtime 状态转换幂等且 restore 静默，GameRoom 在改变 member flag 前恢复 runtime，epoch 屏蔽旧 socket close，account revoke/close 不重复；事件与 gameplay 共用严格递增 sequence，客户端只解析已知 display name 并抑制自身/未知 ID。Worker 与 standalone 真实断线/重连、桌面和手机提示均通过，无剩余中高风险。

### 2026-08-02 — Final static re-review (Round 2)

- 审查范围：`main` 的 `350711a..4da0c78`，对照本 plan 复核 GameApp/session 路由与连接释放、Tab/dead-spectator wheel 优先级、桌面/移动 HUD、presence sequence/idempotence/epoch/restore/account-revoke、旧客户端容忍性、display-name-only 展示及单机隔离；排除既有 staged `.gitignore` `.opencode` 改动。
- 结论：通过，本轮未发现明确问题；无 blocker/high/medium finding，Round 1 无待处置 finding。暂停/结果回调保持单机与联机目的地分离并由 session dispose 关闭 match socket；Tab held 分支先于观战/切枪，释放后恢复历史语义；presence 仅展示已知远端 display name，旧客户端会安全忽略新增事件类型。
- 验证依据：仅使用两份 plan 与用户给出的既有 typecheck、完整测试、构建、预算、桌面及 844×390 production standalone 双客户端证据；按要求未复跑测试、构建或浏览器检查。
- 残余事项：本轮是静态代码审查，不包含生产 Worker 部署状态或正式 production smoke 的确认；该发布门禁仍需按仓库交付规则另行记录。

### 2026-08-02 — Independent final static review (Round 3)

- 审查范围：相对 `main@4da0c78` 的未提交 follow-up 文档 diff（根 `AGENTS.md` 与两份关联 plan）；排除既有 staged `.gitignore` `.opencode` 改动。对照本 plan 核查独立 `code-reviewer` 强制规则的措辞、可执行性及与既有交付规则的一致性。
- 结论：不通过；无 blocker/high，但仍有 medium finding。新增规则已明确覆盖“所有代码改动”、逐任务显式 opt-out、独立 `code-reviewer`，并明确自审和测试通过不能替代；但尚未完整落实 plan 记录的“提交前”约束，且 opt-out 与现有 Completion Checklist 第 7 项冲突。
- 待 builder / writer 处理：在根 `AGENTS.md` 明确独立 review 必须发生在 commit/push/deploy/report completion 之前；同时给 Completion Checklist 第 7 项补上与逐任务显式 opt-out 一致的例外，避免一处允许跳过、另一处仍无条件要求 review loop。完成后请求复审。
- 验证依据：仅做静态 diff/规则对照，未复跑 test、typecheck、build、budget、smoke 或浏览器检查；Round 2 对 `350711a..4da0c78` 的既有独立审查记录未发现问题，本 finding 仅针对 `4da0c78` 后的规则文档 follow-up。

### 2026-08-02 — Independent documentation re-review (Round 4)

- 审查范围：相对 `main@4da0c78` 的当前未提交文档 follow-up（根 `AGENTS.md` 与两份关联 plan），排除既有 staged `.gitignore` 改动；重点复核 Round 3 的两项 medium 及全部既有 Review and Delivery Rules 的一致性。
- 结论：通过，本次审查未发现明确问题；Round 3 的两项 medium 均已解决，无 blocker/high/medium finding 遗留。根规则现已明确所有代码改动须在实现和所需测试完成后、commit/push/deployment/completion report 前接受独立 `code-reviewer` subagent 审查，只有用户针对该任务显式指示才可跳过，且自审和测试通过不能替代；Completion Checklist 第 7 项已同步同一显式 opt-out。
- 一致性复核：新规则与 reviewer 静态优先、重读 plan、处理中高等级 finding、记录每轮 review 及文档同步等既有条款无冲突；未放宽未获显式 opt-out 时的 review/re-review 门禁。
- 验证依据：仅做静态 diff、plan 与规则文本对照；按要求未运行 test、typecheck、build、budget、smoke 或浏览器检查。文档规则改动不引入额外运行时验证缺口。

### 2026-08-02 — Independent final documentation review (Round 5)

- 审查范围：相对 `4da0c78` 的完整未提交文档 diff（根 `AGENTS.md` 与两份 active plan），排除 `.gitignore`；对照两份 plan 复核独立 review 门禁及新增 20:30 Build 记录。
- 结论：通过，本次审查未发现明确问题；Round 3 的两项 medium 已由 Round 4 关闭，无 blocker/high/medium 遗留。`HEAD`、`main` 与 `origin/main` 均指向 `4da0c78`，当前纳入范围的改动仅为上述三份文档；两条 20:30 记录与既有独立审查、尚待执行的生产 Worker 部署及 smoke 状态一致。
- 验证依据：仅做静态 diff、Git 引用与 plan 记录对照；按要求未运行 test、typecheck、build、budget、smoke 或浏览器检查。生产部署门禁仍待本次文档提交后执行。
