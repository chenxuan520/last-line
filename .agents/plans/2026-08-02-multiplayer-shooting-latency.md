## Plan

### 背景

当前联机模式只预测本地移动，枪声、后坐力、枪口火光和弹道都等待服务端约 10 Hz 快照中的权威事件；服务端还使用收到输入时的当前角色位置判定 hitscan。目标是在不改变单机 `BattleRoyaleSession` 行为和共享权威战斗规则的前提下，降低联机本地开火反馈延迟，并加入有界、可验证的服务端命中回溯。

### 目标与边界

- 仅调整联机客户端、联机协议与服务端 `MatchRuntime`/房间链路；单机保持现状。
- 本地按下开火后立即呈现可逆的枪声、后坐力和枪口反馈，伤害、死亡、弹药与正式命中仍由服务端权威决定。
- 使用服务端已下发的 tick/时间引用，而不是信任客户端墙钟时间。
- 服务端只在短、固定上限内查询历史 actor hitbox；实时地图遮挡及全部武器/弹药/射速校验继续由当前权威规则负责。
- Cloudflare 与 standalone 继续共享同一协议和房间实现。
- 增加确定性测试，覆盖回溯上限、历史命中、当前遮挡和联机本地反馈去重。

### 实现顺序

1. 复核联机协议、事件呈现、快照与服务端 combat 调用边界，确定最小字段和历史状态落点。
2. 先补针对性失败测试，再实现联机专属即时开火表现和权威事件去重。
3. 实现服务端 actor hitbox 历史环形窗口及有界 hitscan 回溯，不改共享单机模拟语义。
4. 更新架构文档，执行 typecheck、完整测试、浏览器/Worker/server/standalone 构建和预算检查。
5. 完成静态审查，记录部署阻塞或生产验证结果，提交并推送。

## Build

### 更新日志

- 2026-08-02 16:46：已确认当前分支与目标分支均为 `main`；用户要求保留既有 `.gitignore` 中 `.opencode` 忽略项并由本任务判断处理，同时删除无关未跟踪 session 导出文件。本任务将新建专用计划并只提交联机射击改造相关文件。
- 2026-08-02 16:50：完成实现边界复核。客户端仅在 `MultiplayerSession` 增加本地枪声、后坐力、枪口与无命中预测弹道，并在权威事件返回时保留正式 impact、抑制重复表现；服务端使用客户端正在呈现的 server tick 查询最多约 200ms 的 actor 胶囊历史，静态地图遮挡、武器、弹药、射速、伤害与死亡仍由当前权威规则决定。协议字段采用向后兼容的可选字段，不提升协议版本；旧客户端自动使用当前世界判定。
- 2026-08-02 16:57：完成核心实现。新增 `LocalShotPredictor`，仅供联机 session 按权威武器 cadence/可见弹匣即时生成本地枪声、后坐力、枪口和无 impact 弹道，并按服务端事件顺序去重后补正式 impact；新增 `LagCompensatedCombatWorld` 与 actor 胶囊短历史，`GameRoom` 将 render tick 限制为已向该 socket 下发且单调不回退的值，`MatchRuntime` 再限制最多回溯 6 个 30Hz tick。旧客户端不发 tick 时继续当前世界命中，单机和 Bot 不进入回溯。已更新 `README.md`、`AGENTS.md`、`docs/architecture.md`。
- 2026-08-02 16:57：针对性验证通过：`LocalShotPredictor`、协议解析、`CommandInbox`、预测/权威效果去重、impact-only、历史命中、200ms 上限、当前地图遮挡及 `MatchRuntime` 主链共 6 个测试文件 / 24 项通过；`npm run typecheck` 的 app、Worker、server 三段均通过。
- 2026-08-02 17:06：完整自动验证通过：`npm run test` 为 unit 37 files / 336 tests、Worker 4 files / 30 tests、standalone 3 files / 20 tests；`npm run build`、`npm run build:worker`、`npm run build:standalone`（含 `build:server`）均通过。`npm run check:budgets` 全部通过：browser entry 1,027,864/1,075,000 bytes，Worker 389,506/400,000 bytes，standalone server 411,536/425,000 bytes。
- 2026-08-02 17:06：浏览器验证通过：使用本机 production standalone 构建在 `http://127.0.0.1:8799` 创建两个隔离浏览器身份，快速匹配进入同一 50 actor 联机实战；主音量保持 `0`，HUD、房间倒计时、联机状态和权威战局事件正常，控制台无 error/warn。验证结束后已关闭第二浏览器 context、将唯一页面恢复为 `about:blank`、停止本地 server 并删除临时数据。
- 2026-08-02 17:22：采纳第一轮 reviewer 的两项 medium。服务端现在把每次权威 `shot-fired`/`shot-traced` 与实际消费的 input sequence 一同放入 `SequencedGameEvent`；客户端按该 sequence 精确确认预测射击，不再因 snapshot ack 提前删除仍可能被连续开火复用的预测。联机后坐力改为 `LocalRecoilPresentation` 的有界、自动恢复相机 offset，不再调用 `HumanController.applyRecoil()` 修改后续权威 aim；full/resync 会清零。补充“ack 先于服务端开火仍去重”和后坐力有界/恢复/重置回归。针对性 6 files / 26 tests 与 `npm run typecheck` 均通过。
- 2026-08-02 17:28：采纳第二轮 reviewer 的两项 medium，废弃会被连续输入合并覆盖的 input-sequence 关联，改为客户端每次真实预测时随消息提交独立 `shotSequence`；`CommandInbox` 在最新连续 command 之外维护有界、按 6 tick 过期的预测 shot FIFO，`MatchRuntime` 仅在 `shot-fired` 真正产生时消费并回写事件 envelope，因此多个输入在一个 server tick 前合并也不会改写关联。客户端所有尚未确认且未过期的预测继续占用预测弹匣，发送失败会显式取消并恢复本地 cadence/ammo。新增 coalescing FIFO、已 ack 未确认弹匣保留、服务端 shot envelope 关联和发送取消回归；针对性 6 files / 28 tests 及三段 typecheck 通过。
- 2026-08-02 17:34：采纳第三轮 reviewer 的跨武器 medium。预测消息增加与 `shotSequence` 成对出现的可选 `shotWeaponId`；服务端 pending shot 记录武器归属，实际 `shot-fired` 只消费同 `weaponId` 的最早 token，被拒绝的 A 武器预测不会挪用 B 武器确认。客户端对同 tick reload/switch/use/drop 输入不做本地开火预测，避免权威 inventory 先变化导致预测武器错误。新增跨武器拒绝 FIFO、字段成对校验和 inventory-action 抑制回归；针对性 6 files / 29 tests 与三段 typecheck 通过。
- 2026-08-02 17:39：按用户要求同步远端。首次 `git pull` 因任务工作区与远端重叠而安全中止；经用户明确授权后使用临时 stash，`main` 已 fast-forward 从 `f2af65d` 到 `4932b95`（上游 mobile controls / inventory management 更新），随后恢复任务改动。仅 `tests/unit/networkProtocol.test.ts` 发生内容冲突，已保留上游 backpack drop sanitization 用例与本任务 render/shot token 用例完成最小解冲突；其余代码和文档自动合并。待在新基线上重新执行完整验证和 reviewer。
- 2026-08-02 17:46：新基线完整验证通过：针对性 6 files / 30 tests；`npm run typecheck` 三段通过；`npm run test` 为 unit 38 files / 352 tests、Worker 4 files / 30 tests、standalone 3 files / 20 tests；`npm run build:worker` 与 `npm run build:standalone`（含 browser/server）通过。预算全通过：browser entry 1,033,183/1,075,000 bytes，Worker 394,028/400,000 bytes，standalone server 415,874/425,000 bytes。
- 2026-08-02 17:46：新基线 production standalone 浏览器复验通过：音量保持 `0`，两个隔离身份快速匹配进入同一 50 actor 权威联机战局，房间、倒计时、HUD 与联机状态正常，控制台无 error/warn。验证后已关闭额外 context、唯一页面恢复 `about:blank`、停止 server 并删除临时数据。
- 2026-08-02 17:52：实现已提交并推送到 `main`，commit `455ff9c`（`feat: add multiplayer shot prediction and rewind`）；提交明确排除用户既有 `.gitignore` 改动。push 后 `wrangler deployments status` 仍显示 2026-07-23 旧版本，未观察到自动 Workers Build，按发布规则执行 `npm run deploy:worker` fallback；Worker typecheck、30 项 Worker tests、dry-run bundle、正式部署和生产 HTTP/WebSocket smoke 全链通过。生产 Worker 当前版本 `4efd863c-bbe7-4756-9d23-a670c65bc820`，`test:multiplayer:production` 通过（protocol 3）。

## Review

### 2026-08-02 17:19 CST — Final static review

- 审查范围：以 `HEAD`/`origin/main`（均为 `f2af65d`）为基线审查当前全部任务改动及未跟踪任务文件；按用户要求排除 `.gitignore` 中既有无关 `.opencode` 增量。
- 对照计划：`.agents/plans/2026-08-02-multiplayer-shooting-latency.md`。
- 结论：不通过；无 blocker/high，存在 2 个 medium，需 builder 修复后复审。
- Medium：`LocalShotPredictor.acknowledgeInputs()` 按输入 ack 直接删除预测射击，但服务端 ack 只表示连续输入已消费，`CommandInbox` 仍会在后续 tick 复用同一 `fire=true` 输入并产生权威射击；自动射击在 cadence/网络相位错开时会失去待确认记录，随后重复播放权威枪声、后坐力、枪口和弹道。需重做预测确认/拒绝关联，并增加跨 snapshot ack、延迟和自动射击 cadence 用例。
- Medium：预测后坐力直接调用 `HumanController.applyRecoil()` 永久修改 `pitch`，继而改变后续上送的 `aimDirection`；预测若被服务端拒绝或 full/resync 重置，当前实现无回滚，违反“即时表现必须可逆”的边界。需改为纯表现层后坐力或提供明确的拒绝回滚/校正，并覆盖拒绝场景。
- 验证参考：仅静态分析；未重复用户已完成的 typecheck、25 项针对性测试、完整 337/30/20 测试、Worker/standalone 构建、预算和浏览器验证。
- 测试缺口：尚无真实 `GameRoom` socket 用例覆盖 optional render tick、per-socket 单调上界及 full/reconnect/checkpoint 重置；也未见延迟 ack 下自动射击去重、混合回溯/非回溯射手的同时战斗双顺序回归。上述为验证缺口，不等同于额外确认 bug。

### 2026-08-02 17:22 CST — Builder disposition

- Medium 1：确认成立并已修复。预测射击不再由通用 input ack 清除；`MatchRuntime` 把产生权威射击时实际消费的 input sequence 写入事件 envelope，新客户端精确匹配，旧服务端缺字段时保留 FIFO 兼容。新增连续开火 input 已 ack、权威 shot 后到仍不重复表现的回归。
- Medium 2：确认成立并已修复。联机即时/权威后坐力均改为仅作用于相机的 `LocalRecoilPresentation`，不再改变 `HumanController.pitch` 或后续 `ActorCommand.aimDirection`；offset 有上限、按帧恢复并在 full/resync 重置。单机历史 recoil 路径未改。
- 验证：修复后针对性 6 files / 26 tests 通过；app、Worker、server typecheck 通过。等待复审。

### 2026-08-02 17:25 CST — Final static re-review

- 审查范围：重新对照本计划审查 `HEAD`/`origin/main`（`f2af65d`）后的全部当前任务 diff 与未跟踪任务文件；继续排除无关 `.gitignore` `.opencode` 增量。仅静态分析，未重复任何 suite/build/budget/browser 命令。
- 结论：不通过；无 blocker/high，仍有 2 个 medium，均属于第一项去重修复尚未闭合。第二项后坐力 finding 已确认解决。
- Medium：`LocalShotPredictor.synchronize()` 不再删除已 ack 预测，却在计算预测弹匣时排除 `inputSequence <= ackSequence` 的待确认射击。ack 不能证明该连续输入已实际开火；若权威弹匣仍保留最后一发，客户端会重新放出该发并在下一 cadence 再预测一次，违反可见弹匣上限。需让已 ack 但未由 shot envelope 确认/明确拒绝的预测继续占用预测弹匣，或增加可判定的权威拒绝结果。
- Medium：权威 envelope 使用 `CommandInbox` 消费时的最新 sequence，而客户端预测绑定产生预测的 sequence；`CommandInbox.accept()` 会在一次服务端 step 前用更新的连续输入覆盖旧输入。网络/调度合并多个 `fire=true` frame 时，预测可能属于 N、权威 shot 却标 N+1，客户端精确匹配失败并重复播放权威表现。需使用不会被连续输入合并改写的 shot correlation，或证明并覆盖合并区间的匹配语义。
- 已确认解决：`LocalRecoilPresentation` 只向本地相机 pitch 加有界、自动恢复 offset；预测与未预测权威射击均走该表现层，full/resync reset；联机路径不再调用 `HumanController.applyRecoil()`，不会改变后续 `ActorCommand.aimDirection`。单机路径保持原状。
- 兼容/顺序检查：`SequencedGameEvent.inputSequence` 为可选字段，旧客户端会忽略、新客户端对旧服务端走 FIFO；snapshot 事件合并保留完整 envelope 并按 event sequence 排序，shot-fired 后的 pellet trace 顺序未破坏；120-input expiry 与 64 条容量均有界。旧服务端下被拒绝预测只能 FIFO 近似关联后续同武器 shot，仍是兼容降级风险。
- 验证参考：修复后 6 files / 26 targeted tests 与 app/Worker/server typecheck 通过；此前完整 tests/builds/budgets/browser 证据已参考但未重跑。现有测试未覆盖多个连续 input 在单个服务端 step 前被合并，且弹匣测试当前反而允许 ack 后在权威 ammo 未减少时再次预测。

### 2026-08-02 17:28 CST — Builder disposition round 2

- Medium 1：确认成立并已修复。所有尚未由权威 shot envelope 确认、取消或有界过期的本地预测都继续从权威弹匣中预留一发，不再因通用 input ack 释放；新增最后一发已 ack 但未开火时禁止再次预测的回归。
- Medium 2：确认成立并已修复。关联 ID 改为独立 `shotSequence`：客户端只在实际预测时生成；服务端 `CommandInbox` 即使合并更新的连续输入也保留有界 FIFO，实际产生 `shot-fired` 时才消费并附加到 shot/traces。新增 N/N+1 连续输入同 tick 合并仍按预测顺序消费，以及 `MatchRuntime` 权威事件携带 shot sequence 的回归。
- 兼容性：两个新增字段均可选；新客户端连接旧服务端继续 FIFO 降级，新服务端连接旧客户端继续无关联的权威表现，不改变协议版本。针对性 6 files / 28 tests 与 app/Worker/server typecheck 均通过，等待再次复审。

### 2026-08-02 17:32 CST — Final static re-review round 3

- 审查范围：重新对照本计划及 round-2 disposition，静态审查 `HEAD`/`origin/main`（`f2af65d`）后的全部当前任务 diff 与未跟踪任务文件；继续排除无关 `.gitignore` `.opencode` 增量。未重复 suites/builds/budgets/browser。
- 结论：不通过；无 blocker/high，仍有 1 个 medium。上一轮“ack 后弹匣释放”和“连续 input coalescing 覆盖关联 ID”两项本身已解决，但新 FIFO 对被拒绝预测缺少归属/取消语义。
- Medium：服务端 `pendingShots` 只保存 sequence/tick，并在任何后续 `shot-fired` 上按全武器 FIFO 消费。预测可以被权威规则拒绝（例如持枪 A、按住 fire 的同一 command 同时 switch 到 B：客户端按旧可见 A 预测，服务端 inventory 先切 B 再 combat 并实际发射 B），此时 A 的 token 会被附到 B 的 shot。客户端又要求 weaponId 与 shotSequence 同时精确匹配，因此 B 的即时预测无法被确认、权威 B 表现会重复，队列随后也可能继续错位。需让队列保留足以匹配权威 shot 的归属，或在确定拒绝/切换/释放时取消旧 token；补充“被拒绝预测后不同武器实际开火”的回归。
- 已确认：客户端仅在真实预测时发送可选 `shotSequence`，send 返回 false 会取消并恢复 ammo/cadence；全部未确认预测继续预留弹匣且按 30 input 有界过期。服务端队列限制为 32、按 6 tick 过期并去重，恶意输入不能无界增长。正常同武器 coalescing/delayed fire 会保序；`shot-fired` 与同 tick shotgun traces 获得同一 token，事件 sequence 与 snapshot coalescing 顺序保持。新增字段对旧/新两侧均为可选兼容。后坐力仍为 camera-only，full/resync reset，单机路径不变。
- 验证参考：round-2 后 6 files / 28 targeted tests 与 app/Worker/server typecheck 通过；此前完整证据仅参考、未重跑。现有测试未覆盖 rejected token 后 switch/reload/drop 导致的跨武器 FIFO 归属错位。

### 2026-08-02 17:34 CST — Builder disposition round 3

- Medium：确认成立并已修复。`shotSequence` 现在必须与 `shotWeaponId` 成对出现；`CommandInbox` 的有界 pending shot 同时保存 weapon ownership，`MatchRuntime` 只按权威 `shot-fired.weaponId` 消费匹配 token。被拒绝的 rifle token 不会再附着到随后 smg shot；客户端同 tick inventory-changing command 也不再做可能错误的旧武器预测。
- 验证：新增 rifle 预测被拒绝后 smg token 仍独立匹配、协议 partial token 拒绝和 inventory action 不预测用例；针对性 6 files / 29 tests 与 app/Worker/server typecheck 通过。等待再次复审。

### 2026-08-02 17:35 CST — Final static re-review round 4

- 审查范围：重新对照本计划、round-3 finding 与 disposition，静态审查 `HEAD`/`origin/main`（`f2af65d`）后的全部当前任务 diff 与未跟踪任务文件；继续排除无关 `.gitignore` `.opencode` 增量。未重复 suites/builds/budgets/browser。
- 结论：通过；本次审查未发现明确问题，无 blocker/high/medium。round-3 跨武器 token finding 已解决。
- 关联检查：`shotSequence`/`shotWeaponId` 在协议中必须成对且均受类型/长度约束；旧客户端不发字段、新客户端对旧服务端的可选字段兼容路径保持。`CommandInbox` 按 weapon ownership 保留每武器 FIFO，跨连续输入合并不丢 token，队列限制 32、按 6 tick 过期并按 sequence 去重；匹配只移除权威 `shot-fired.weaponId` 对应的最早 token，不会让被拒绝 rifle 预测占用 smg 确认。客户端对同 tick reload/switch/use/drop 跳过预测，send false 会取消并恢复 cadence/ammo，所有未确认同武器预测继续预留弹匣且按 30 input 有界过期。
- 事件检查：`MatchRuntime` 只在实际 `shot-fired` 后消费匹配 token，同一 actor 本 tick 的 `shot-fired` 与全部 shotgun `shot-traced` 共用该 token；原事件 sequence、snapshot coalescing 排序、impact-only 去重和同时战斗批处理未改变。Bot、旧客户端及无 token 权威射击继续无关联路径。
- 后坐力：仍为本地 camera-only 有界恢复 offset，full/resync reset；联机不修改 `HumanController.pitch`/`ActorCommand.aimDirection`，单机原路径未变。
- 验证参考：round-3 后 6 files / 29 targeted tests 与 app/Worker/server typecheck 通过；此前完整 tests/builds/budgets/browser 证据仅参考、未重跑。残余兼容风险仅为旧服务端缺少 token 时按同武器 FIFO 近似关联，以及被拒绝同武器预测在有界窗口内按展示计数对账；未发现由此产生的 blocker/high/medium 回归。

### 2026-08-02 17:48 CST — Post-pull final static review

- 审查范围：以更新后的 `HEAD`/`origin/main`（均为 `4932b95`）为基线，静态审查当前全部任务 diff 与未跟踪任务文件；按既定要求排除无关 `.gitignore` `.opencode` 增量，并额外对照上游 `f2af65d..4932b95` 的 mobile controls、inventory 与 `ActorCommand` 变化。未重跑任何测试或构建。
- 结论：通过；本次审查未发现明确问题，无 blocker/high/medium。pull/stash 恢复未破坏此前通过的 firing prediction、shot token、rewind 或单机边界。
- 冲突检查：`tests/unit/networkProtocol.test.ts` 已同时保留上游 indexed backpack drop 经过 `sanitizeActorCommand` 不变的覆盖，以及任务的非法 render/partial shot token 拒绝、可选 render/shot token 与 legacy input 覆盖；仓库无冲突标记，`git diff --check HEAD` 无输出。
- 上游兼容检查：`ActorCommand` 字段形状未变，新增 backpack drop 仍通过既有 `dropItem: string | null`；协议 128 字符 sanitization 保留当前稳定 drop request。`LocalShotPredictor` 对任何 reload/switch/use/drop（含 indexed backpack drop）跳过预测，避免 inventory-before-combat 语义造成错误 token；移动端新增双侧/拖动开火仍归一到同一 `fire` command，不改变 cadence、ammo reservation 或 camera-only recoil。`CommandInbox` 继续一次性合并 drop one-shot，并独立保留按 weapon ownership 的有界 shot FIFO。
- 权威/边界检查：render tick 的 per-socket 单调上界、6 tick/200ms actor capsule rewind、当前地图遮挡、shotgun trace envelope、事件 coalescing 与旧/新协议兼容未受上游变化影响。Bot 与单机继续使用 current-world hit test；`BattleRoyaleSession` 只接入上游 backpack UI callback，仍走原权威 recoil/combat 路径。
- 验证参考：新基线外层证据为 targeted 6 files / 30 tests、三段 typecheck、完整 unit 38/352 + Worker 4/30 + standalone 3/20、Worker/standalone/browser/server builds、budgets 及 production standalone 双人联机/console smoke 全通过；本轮仅引用，未重复执行。
