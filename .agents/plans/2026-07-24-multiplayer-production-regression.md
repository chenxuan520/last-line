## Plan

### 目标

- 修复正式站进入联机房间后立即显示“房间已关闭 / 房间连接已关闭”的故障。
- 用真实生产 HTTP 和 WebSocket 流程覆盖创建房间、welcome 协议、大厅状态和主动离开。
- 强化 Worker 与 standalone 契约测试，确保两套后端发送当前协议版本。
- 让移动端联机入口与单机入口一样，在真实点击激活内申请全屏并锁定横屏，等待大厅期间保持激活。
- 不触碰用户已有 `.gitignore` 和未跟踪 session 文件。

## Build

### 更新日志

- 2026-07-24 01:27 +0800：生产复现确认 HTTP guest/room 均为 201，WebSocket 可打开，但 `lastlinep2p.011203.xyz` 首帧 `welcome.protocolVersion=1`，当前客户端要求版本 3；客户端按设计关闭连接，界面最终显示通用关闭文案。最近 coverage/配置整理提交未修改联机实现，但 Pages 自动部署、Worker 停留在 2026-07-21 的 `f00551c7`，形成前后端部署漂移。
- 2026-07-24 01:27 +0800：部署当前 Worker 版本 `955f47ab-9cec-4c83-9cdc-fabe7fb15f3b`。同一生产探针复验收到 `welcome.protocolVersion=3` 和 `lobby.state`，发送 `connection.ack`/`lobby.leave` 后以 1000 正常关闭，线上联机恢复。
- 2026-07-24 01:36 +0800：新增 `test:multiplayer:production`，在正式 Worker 创建私人房间并校验当前 welcome 协议、admission 身份、大厅状态和正常离开；main push CI 会运行，PR 不访问生产。Worker 与 standalone 契约测试同时断言当前协议和 room/player。typecheck、普通 322 app + 30 Worker + 20 standalone tests、production smoke、browser/Worker/server builds、全部 budgets、`git diff --check` 均通过；按既有约定未运行 coverage。Chrome 正式站音量为 0，私人房间 `99WGGG` 显示“已连接”，退出正常，console 无 warning/error；页面已关闭，仅余 `about:blank`。
- 2026-07-24 01:46 +0800：采纳 reviewer Round 1 三项 finding。客户端协议不匹配改为先完成 closed 状态，再投递明确 error；大厅终止错误会留在当前页面并提供返回按钮，不再被通用断线文案或自动跳转覆盖。公网 smoke 增加 15 秒 HTTP timeout、room/code/waiting/member/connected/host 校验；独立定时 workflow 提供有界生产漂移告警，不再伪装成与 Cloudflare 部署原子协调的 main CI 门禁。部署文档和 AGENTS 固化严格协议的维护发布流程与“明确终止原因必须最终可见”规则；待验证与复审。
- 2026-07-24 01:50 +0800：按用户要求进一步固化部署责任。确认本次事故根因是 Pages 已更新而 Worker 自动部署未发生，不能再把 push/Pages 成功视为后端发布成功。`deploy:worker` 收口为 Worker typecheck、Worker tests、dry-run、正式 deploy、公网联机 smoke 的完整 fallback；AGENTS 和部署文档要求 Worker/shared protocol 改动必须核对新的 production version ID 并记录 smoke，自动部署失效时作为阻塞明确处理。Workers Builds 的 main 构建命令补齐 clean install、Worker tests 和 dry-run。
- 2026-07-24 01:56 +0800：修复移动端联机全屏激活。快速匹配、创建房间、房间码加入和公开列表加入都会在点击处理器首次 `await` 前调用 `activateFromUserGesture()`；请求失败时释放，成功后等待大厅不再错误 `deactivate()`，从而让公开房间自动开局仍继承已获取的全屏/横屏。退出、终止错误和返回菜单仍释放。另处理 reviewer Round 2 Low：公网 smoke 的 WebSocket timeout 先 best-effort `lobby.leave`，一秒后才强制 terminate。AGENTS 新增 reviewer 禁止重复运行外层已记录验证的规则。
- 2026-07-24 02:08 +0800：确认并处理 reviewer Round 2 Medium。连接层现在保存 protocol/room/account 三类终止消息，`finishClosed()` 在 handler 切换空窗只清理普通队列并保留最终原因；战局 session 将原始 message 传给 GameApp，统一显示“联机已结束”终止页和返回联机大厅按钮。新增定向回归覆盖 protocol mismatch 的 closed→error 顺序，以及 room/account 错误跨 lobby→match handler gap 后仍可读取。
- 2026-07-24 02:13 +0800：最终增量验证完成。App typecheck、`multiplayerClient` + `mobileFullscreenController` 定向 13 tests、最新 browser build、budgets、production multiplayer smoke 与 `git diff --check` 通过；此前同一最终改动链已完成完整 322 app + 30 Worker + 20 standalone tests、Worker/server build。移动触控 Chrome 桩实测创建私人联机房间时同步产生 1 次 fullscreen request 和 1 次 landscape lock，大厅 `S6VQHZ` 保持“已连接”；正常退出后页面回到唯一 `about:blank`，本地 preview 已停止。按用户要求 reviewer 后续只做静态复审，不重复外层验证。
- 2026-07-24 02:13 +0800：排查用户补充的高空自然物件疑问。单机 `BattleRoyaleSession` 与联机 `MultiplayerSession` 对树、岩石、干草、围栏和建筑使用相同 `createIslandScene`、map seed、quality、fog `1560–2640m` 和 camera far plane `2880m`；未发现联机专属静态物件距离裁剪，故不做无证据改动。唯一真实模式差异是地面 loot 的 60m 服务端复制范围，不属于自然场景物件。
- 2026-07-24 02:17 +0800：采纳静态 reviewer Round 3 Medium。`GameHud` 的普通结算按钮事件会传入 `MouseEvent`，不能直接复用新增的可选终止文案回调；现改为无参包装 `() => this.onExit()`，确保正常结算仍返回菜单，不会把事件对象误显示为终止原因。
- 2026-07-24 02:23 +0800：`88c1a75` 推送后确认 Cloudflare Pages 已自动发布该 commit，但 Worker 仍停留在手工版本 `955f47ab`，证明 Workers Builds 自动部署未生效；按新规则立即启用 verified fallback。fallback 在部署前被既有 `serverMetrics.test` 顺序污染阻塞，未发生部署：无隔离 Worker suite 可能从已恢复的 1 个房间开始，测试错误硬编码 `[0,1]` 而实际正确增量为 `[1,2]`。现把断言改为“恰有两次观测且创建房间使 active count +1”，同时兼容生产 DO 从持久房间恢复的真实语义，不降低指标行为要求。待定向验证、静态复审、提交后重新执行完整 fallback。

## Review

### 2026-07-24 01:39 +0800 — Round 1

- 审查范围：以 `0642927` 为基线，审查未提交的 production smoke、package/CI、Worker 与 standalone 协议断言、`tsconfig.server.json`、文档、部署顺序、清理、token 日志和测试确定性；按要求排除 `.gitignore` 与 `session-ses_0784.md`。
- 对照 plan：`.agents/plans/2026-07-24-multiplayer-production-regression.md`。
- 审查结论：**不通过**。当前线上 Worker `955f47ab-9cec-4c83-9cdc-fabe7fb15f3b` 与协议 3 的实测恢复证据成立，但以下问题仍需处理。
- **High（阻塞，待 builder / writer）**：`docs/deployment.md:107` 要求协议变更先部署 Worker，但客户端在 `src/network/MultiplayerClient.ts:310` 严格要求协议完全相等；先上线 N+1 Worker 会让仍在线的 N 版 Pages 客户端再次全部关闭房间。并且 `.github/workflows/ci.yml:46-51` 只在 Worker dry-run build 后探测生产，未与独立的 Cloudflare Worker/Pages 自动部署建立顺序或门禁，可能在 Worker 部署前竞态失败，也不能阻止正式 Pages 先上线。需给出不会制造协议不兼容窗口的兼容/维护发布方案，并让 post-deploy smoke 与实际生产部署顺序一致，或明确其仅为告警而非门禁。
- **Medium（阻塞，待 builder）**：`scripts/smoke-production-multiplayer.ts:96-127` 只确认收到 `type: "lobby.state"`；`isServerMessage` 仅校验消息 discriminator，因此缺少 `lobby`、指向错误房间或不包含 admission player 的 payload 仍可在 1000 关闭后通过。需至少校验 lobby room/code、等待状态及当前 player/member 身份，兑现 plan 中的大厅状态验证。
- **Medium（阻塞，待 builder）**：`scripts/smoke-production-multiplayer.ts:32-48` 的两个生产 HTTP 请求没有 abort/总超时，CI step 也没有 `timeout-minutes`；生产端若迟迟不结束响应，main workflow 可长时间挂起而不是确定性失败。需增加有界 HTTP/step 超时，并保持失败路径的 best-effort socket/room 清理。
- 已确认项：PR 条件会跳过生产 smoke；Worker/standalone welcome 断言使用当前共享协议常量；成功路径发送 `connection.ack`、`lobby.leave` 并要求 1000 关闭；脚本输出与错误拼装未直接记录 guest/admission/reconnect token；未发现 `context.Background()`。
- 验证：`npm run typecheck` 通过；定向 Worker `lobby.test.ts` 7/7 通过；定向 standalone `standaloneServer.test.ts` 10/10 通过；`npm run test:multiplayer:production` 通过并收到 protocol 3；`git diff --check`（排除指定文件）通过。未运行 coverage，未使用浏览器/MCP。

### 2026-07-24 02:03 +0800 — Round 2

- 审查范围：继续以 `0642927` 为基线，复核当前全部未提交联机回归改动及 Round 1 三项 finding；重点覆盖终止错误顺序/UI、production smoke 超时与大厅身份、定时 workflow、维护发布、Worker 强制部署验证链、清理、测试和文档。按要求排除 `.gitignore` 与 `session-ses_0784.md`。
- Round 1 disposition：部署竞态 finding **已解决**（主 CI 已移除生产 smoke，独立 schedule 明确仅作观测，文档改为停服维护发布）；大厅 payload finding **已解决**（校验 roomId/code/waiting 及 admitted connected host）；HTTP/CI 超时 finding **已解决**（两次 fetch 各 15 秒、WebSocket 15 秒、step 2 分钟、job 3 分钟）。
- 新要求已确认：协议不匹配按 `closed` 后 explicit error 的顺序投递；大厅内 protocol/room-closed/account-disabled 会在通用 closed 后恢复明确原因和返回联机大厅按钮；`deploy:worker` 无递归且依次执行 Worker typecheck/tests/dry-run/deploy/public smoke；AGENTS/docs 要求核对并记录新 Worker version ID，`wrangler deployments status` 命令有效；scheduled workflow YAML、cron、权限与 timeout 结构有效；主 CI/PR 均不调用生产 smoke。
- 审查结论：**不通过**，仍有 1 项 Medium 阻塞。
- **Medium（阻塞，待 builder）**：`src/app/MultiplayerSession.ts:252-260` 仍未兑现新增的“明确终止原因最终可见”规则。运行中收到 `room-closed` 或 `account-disabled` 时只调用 `onExit()` 返回主菜单而完全丢弃 message；重连 welcome 的 `protocol-mismatch` 更不会命中该分支，会被静默忽略并留下已关闭但仍显示中的战局。`src/app/GameApp.ts:593-609` 在场景异步创建期间还主动移除 lobby handlers，使该问题覆盖 lobby→match handoff 窗口。影响是维护发布、管理员关房或账号撤销时，活跃/加载中的旧客户端仍看不到明确原因，也没有承载该原因的返回联机大厅操作，与 `AGENTS.md:77` 和 `docs/deployment.md:117` 的新承诺冲突。需让 session/handoff 将 protocol mismatch、room closure、account revocation 的原始 message 传回可见终止 UI，并增加覆盖三类原因及 closed/error 顺序的回归测试。
- 清理/安全复核：smoke 成功和结构校验失败路径会发送 `lobby.leave`，最终要求 1000 close；WebSocket 总超时会强制 terminate，最坏只留下按既有 1 小时 TTL 回收的空私人房间，记录为低风险残余；日志不输出 guest/admission/reconnect token；未发现 `context.Background()`。
- 验证：`npm run typecheck`、完整 `npm run test`（322 app、30 Worker、20 standalone）、`npm run build`、`npm run build:worker` dry-run、`npm run test:multiplayer:production`（protocol 3）均通过；scheduled workflow 经本地 YAML parser 解析；`npx wrangler deployments status --help` 通过；`git diff --check`（排除指定文件）通过。因明确禁止，未执行 `deploy:worker`/任何部署、coverage 或浏览器/MCP；部署链仅做静态展开并分别验证部署前组件。

### 2026-07-24 02:03 +0800 — Round 2

- 审查范围：基于本 plan，对照 `main` / `origin/main` / `HEAD` 共同基线 `0642927`，审查当前全部未提交改动及新增 production smoke/workflow；按要求排除 `.gitignore` 与 `session-ses_0784.md`。重点复核终止错误 UI/事件顺序、生产 HTTP/WebSocket smoke、定时 workflow、维护发布文档、AGENTS 强制规则、Worker deploy 链和 Worker/standalone 协议断言。
- 审查结论：**有待处理**。Round 1 的 High 和两项 Medium 主问题均已解决，未发现 blocker/high/medium；仍有 1 项 Low 清理缺口，因此本轮不记录“通过”。
- Round 1 High disposition — **已解决**：`.github/workflows/multiplayer-production-smoke.yml` 仅由 schedule/手动触发，job/step 分别限制为 3/2 分钟，未接入 `main` Pages 部署门禁；`docs/deployment.md:109-139` 明确严格协议需停服维护、Pages/Worker 非原子、定时 smoke 只做漂移观测，并要求核对 production Worker version ID。`AGENTS.md:76-77,106-109` 已固化相同强制规则；`package.json:13` 和 Workers Builds 文档共同给出 typecheck → Worker tests → dry-run → deploy → production smoke 的默认/回退链。
- Round 1 Medium（大厅 payload）disposition — **已解决**：`scripts/smoke-production-multiplayer.ts:106-132,155-169` 校验当前协议、welcome 的 room/player、lobby 的 room/code/waiting 状态，以及 admission player 的 connected/host member；本轮真实 production smoke 通过 protocol 3。
- Round 1 Medium（有界执行）disposition — **主体已解决**：两个 HTTP 请求各使用 15 秒 abort，WebSocket 总等待为 15 秒，workflow 另有 step/job 上限。其失败路径清理仍有下述 Low finding。
- 终止错误/event-order disposition — **已解决**：`MultiplayerClient.ts:310-318` 先触发 `closed` 再投递 `protocol-mismatch`；`GameApp.ts:493-510` 对 protocol/account/room 终止错误先关闭连接，再写入最终错误文案并替换为“返回联机大厅”动作，后续 close 事件不能覆盖。单测断言最后两个事件为 `status:closed`、`message:protocol-mismatch`。未使用浏览器，UI 动作由代码路径审查确认。
- Worker/standalone 协议断言 disposition — **已解决**：Worker 真实升级响应和 standalone 两个真实客户端 welcome 均断言共享 `MULTIPLAYER_PROTOCOL_VERSION` 及 admission room/player。
- **Low（待 builder）** — `scripts/smoke-production-multiplayer.ts:65-74`：WebSocket 总超时直接 `finish()`/`terminate()`，没有像 `leaveWithFailure()` 一样在 socket 已打开且尚未发送 leave 时 best-effort 发送 `lobby.leave`。若 Worker 已完成 admission/welcome、但 lobby 状态迟迟不到，定时 smoke 会失败但把私人房间留到一小时 waiting TTL，未完整兑现 Round 1 对失败路径清理的要求。请在不放宽总时限的前提下覆盖该超时清理分支；连接尚未建立、无法发送 leave 的失败仍可直接终止。
- 验证：实际执行 `npm run typecheck`、`npm run test`（322 app、30 Worker、20 standalone）、`npm run build`、`npm run build:worker`、`npm run build:server`、`npm run check:budgets`、`npm run test:multiplayer:production`，全部通过；production smoke 收到 protocol 3。`git diff --check 0642927` 及两个新增文件的 no-index whitespace check 均通过；未发现 `context.Background()`。按要求未运行 coverage、未使用浏览器、未提交/推送/部署。
- 残余验证说明：新增 scheduled workflow 尚未在 GitHub Actions runner 上实际触发；本轮仅完成 YAML/权限/触发条件/timeout 的静态审查。本轮 production smoke 已验证脚本成功路径，但未注入超时故障路径。

#### 2026-07-24 02:04 +0800 — Round 2 汇总结论

- 当前 Round 2 最终结论仍为 **不通过**：保留 `src/app/MultiplayerSession.ts:252-260` / `src/app/GameApp.ts:593-609` 的 **Medium** 终止原因丢失 finding；同时采纳 `scripts/smoke-production-multiplayer.ts:65-74` 的 **Low** 超时清理 finding。前者需 builder 阻塞处理并复审，后者需补齐 best-effort leave 或在后续处置中明确接受理由。
- 其余 Round 1 findings、scheduled workflow、维护发布文档、Worker deploy 链及 version-ID 记录要求的 disposition 维持“已解决”。

### 2026-07-24 02:17 +0800 — Round 3

- 审查范围：按要求仅做静态复审；以当前 `main` / `origin/main` / `HEAD` 共同基线 `0642927` 对照本 plan，审查全部当前改动，并排除 `.gitignore` 与 `session-ses_0784.md`。未重复 test、typecheck、build、budget、smoke、浏览器或部署命令。
- Round 1 High（协议漂移与部署纪律）disposition — **已解决**：生产 Worker 版本与 protocol 3 smoke 证据已记录；主 CI 不再把生产 smoke 伪装为原子门禁，维护发布顺序、Worker version ID 核对、完整 `deploy:worker` fallback 和 Pages/Worker 独立部署风险均已固化到 `AGENTS.md` 与 `docs/deployment.md`。
- Round 1 Medium（大厅 payload）disposition — **已解决**：production smoke 校验 welcome protocol/room/player，以及 lobby room/code/waiting 和 admission member 的 connected/host 状态。
- Round 1 Medium（有界执行）disposition — **已解决**：HTTP 各有 15 秒 timeout，WebSocket 有 15 秒总时限，workflow job/step 分别有 3/2 分钟上限。
- Round 2 Low（WebSocket 超时清理）disposition — **已解决**：已打开 socket 的总超时先 best-effort 发送 `lobby.leave`，保留 1 秒关闭窗口后才 terminate；未建立连接时仍只能直接失败，属于合理残余风险。
- Round 2 Medium（明确终止原因）disposition — **核心终止链路已补齐，但本轮发现一项新的 Medium 回归，仍不通过**：lobby 中明确错误最终覆盖通用 closed；handler 空窗会保留 terminal message；session 能把 protocol/room/account 原始文案传到“联机已结束”页面。不过正常战局结果按钮现在会把 DOM `MouseEvent` 误当作 terminal message，详见下项。
- **Medium（阻塞，待 builder）** — `src/app/MultiplayerSession.ts:173-179` / `src/client/ui/GameHud.ts:366-370` / `src/app/GameApp.ts:612,627-644`：`MultiplayerSession` 把可接收 `terminalMessage` 的 `onExit` 直接作为 `GameHud.onRestart`；`GameHud` 又把该函数直接注册为 click listener。浏览器会把 `MouseEvent` 作为首参传入，导致正常淘汰/结算后点击“重新部署/再来一局”走 `returnToMenu(event)`，最终显示伪造的“联机已结束”和 `[object MouseEvent]`，而不是正常返回菜单。需把普通 HUD 退出包装为无参调用，并保留仅 terminal error 路径传字符串的语义；建议补覆盖正常结果按钮与三类 terminal 原因的回归。
- 其余核对：移动端四类联机入口均在首次 `await` 前同步激活 fullscreen，waiting lobby 不再释放，退出/失败/终止才释放；Worker 与 standalone welcome 断言共享协议常量；scheduled workflow 仅 schedule/manual 触发且为观测用途；`AGENTS.md` 已禁止 reviewer 重复外层验证并强化 Worker 发布核验。高空自然物件 no-fix 决策成立：单机和联机共同调用 `createIslandScene`，共享 map seed、quality、fog、camera far plane 及树/岩石/草垛/栅栏/建筑创建路径；60m 服务端范围仅作用于动态 loot，不构成联机专属自然物件裁剪证据。
- 审查结论：**不通过**。上述 Medium 需 builder 修复后复审；除此之外未发现 blocker/high/medium/low finding。已参考 Build 中记录的最终验证证据，本轮未执行任何重复验证。

### 2026-07-24 02:18 +0800 — Round 4

- 审查范围：仅静态复核 Round 3 callback 修复及其与既有终止消息链路的交互；未执行任何测试、构建、smoke、浏览器或部署命令。
- Round 3 Medium disposition — **已解决**：`MultiplayerSession` 传给 `GameHud` 的普通退出回调已包装为 `() => this.onExit()`，DOM `MouseEvent` 不再进入 terminal message 参数；`processMessages()` 仍仅对 protocol mismatch、room closure、account revocation 显式调用 `this.onExit(message.message)`，明确终止原因继续进入最终 UI。
- 审查结论：**通过。本次复审未发现 blocker/high/medium/low 问题。**

### 2026-07-24 — Round 5（post-`88c1a75` 静态复审）

- 审查范围：仅审查 `tests/worker/serverMetrics.test.ts:20-24` 在 `88c1a75` 后的断言改动及 Build 中记录的 `[1,2]` 失败原因；未执行任何测试、typecheck、build、smoke、浏览器、部署或项目命令。
- 审查结论：**通过，未发现 blocker/high/medium/low 问题。** `active_rooms` 在无隔离套件及生产持久状态下允许非零起点；断言恰有两次观测且第二次严格为第一次 `+1`，仍约束一次房间创建只产生预期的基线/更新观测并将活跃房间数增加一。它仅移除了错误的零初始状态假设，不会掩盖本项测试负责覆盖的产品指标行为。
