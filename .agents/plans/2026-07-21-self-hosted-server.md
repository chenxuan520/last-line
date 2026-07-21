## Plan

### 背景

现有联机后端运行在 Cloudflare Worker 与四个 Durable Object 上。权威玩法运行时 `src/server/MatchRuntime.ts` 已与平台解耦，但大厅、房间调度、WebSocket、账号、管理员、持久化和定时恢复仍直接依赖 Cloudflare API。用户要求新增可在自有服务器独立部署、所有核心计算与数据均落在本机的版本，同时避免维护两份业务逻辑。

### 目标

1. 保留现有 Cloudflare 部署和客户端 HTTP/WebSocket 协议。
2. 新增单服务器、单 Node.js 进程的全栈自托管模式，同时提供静态 `dist/`、API、WebSocket 和管理终端。
3. 自托管数据使用本地 SQLite，与 Cloudflare 数据完全独立；账号、管理员、游客、房间、重连凭据、设置和比赛 checkpoint 均本地持久化。
4. 进程重启后恢复等待中、倒计时中和运行中的房间；运行中比赛按现有约每秒 checkpoint 恢复，客户端使用既有 reconnect token 重连。
5. 通过共享领域逻辑和明确的平台适配边界支持 Cloudflare 与 standalone，而不是复制玩法、协议或房间规则。
6. 自托管模式默认不依赖 Cloudflare；Turnstile 作为可选外部能力保留，未配置时关闭。
7. 第一版明确不支持多进程、多服务器、Cloudflare/standalone 数据同步或活动房间迁移。

### 实现顺序

1. 固化公共配置、协议、Cookie/CORS、身份校验和房间状态转换边界，提取 Cloudflare/standalone 可共享的领域逻辑。
2. 实现本地 SQLite schema、事务、账号/管理员/大厅/房间持久化和单进程串行协调。
3. 实现 Node HTTP、WebSocket、静态文件、调度器、checkpoint、重启恢复和优雅关闭。
4. 增加 standalone 启动/构建脚本、环境变量示例、Docker/本机部署说明，并保持现有 Worker 构建路径。
5. 补充共享契约、持久化、重启恢复、认证、房间和 WebSocket 测试；执行完整应用/Worker/standalone 门禁和 reviewer 闭环。

### 验收口径

- 同一浏览器客户端只需切换服务 URL，即可连接 Cloudflare 或 standalone，协议和玩法行为不分叉。
- standalone 可在空数据目录启动、初始化管理员、切换游客/账号准入、创建/加入房间、完成 50 人权威比赛并在重启后重连。
- 运行时不使用 Durable Object、Workers KV/D1/R2 或 Cloudflare 计算；配置 Turnstile 时仅将其作为可选外部验证码服务。
- 单机模式和现有 Cloudflare Worker 回归保持通过。

## Build

### 更新日志

- 2026-07-21 20:41：确认 `main@9473768` 与 `origin/main` 对齐，工作区仅保留用户未跟踪参考文件 `session-ses_082c.md`。完成现有 Worker、Durable Object、协议、认证、管理、checkpoint 和部署边界梳理；与用户确认采用单机全栈、单进程单服务器、本地 SQLite、运行中对局 checkpoint 恢复、Cloudflare/standalone 数据独立、Turnstile 可选及共享逻辑避免重复实现的方案。尚未修改业务代码。
- 2026-07-21 21:04：完成共享 `DurableService` 平台契约，将现有 Lobby/GameRoom/Account/Admin 类从 `cloudflare:workers` 基类解耦，Cloudflare Worker 26 项原测试保持通过。新增 Node HTTP/WebSocket 全栈入口、本地 WAL SQLite KV/SQL/alarm 适配、单数据目录进程锁、房间串行消息队列、静态文件服务、真实客户端 IP/Origin 适配、优雅 checkpoint 关闭和重启 alarm 恢复；客户端新增 `same-origin` 后端地址模式。standalone 4 项集成测试已覆盖静态服务、账号/管理员跨重启持久化、双人真实 WebSocket 开局、运行中 checkpoint 重启重连及重复进程拒绝；`npm run typecheck`、standalone server bundle 与多人客户端定向测试通过。新增 Docker/Compose、环境变量样例和 README/architecture/deployment 文档，尚待完整应用门禁、容器 smoke、reviewer 和提交部署。
- 2026-07-21 21:29：逐条确认 reviewer 的 5 项 High 和 1 项 Medium 均为真实问题并完成修正。alarm 改为带 generation 的 at-least-once 持久记录，handler 成功后才条件删除；PID 文件改为 crash 自动释放的独立 SQLite exclusive lock；reconnect token 改为 welcome/ack 两阶段轮换并保留 previous/pending grace；standalone accept/close 串行收敛，提前断开也会释放 socket 并回写离线；无持久状态/alarm/socket 的 GameRoom 自动驱逐，终局 TTL 到期主动释放 runtime；SIGTERM 先 checkpoint，再最多 2 秒网络 drain，finally 关闭 DB/释放锁，Compose stop grace 调至 30 秒。新增旧 reconnect token、accept 期间断开、alarm handler 中持久记录和连续 20 个房间回收回归；当前应用 typecheck、Worker 27 项、standalone 7 项及 diff check 通过，等待 reviewer 复审和最终完整门禁。Docker 命令在当前机器不可用，真实 image/Compose smoke 仍明确未执行。
- 2026-07-21 21:55：确认第二轮 reviewer 的 2 High + 2 Medium 均成立并闭环。Node 请求目标现在拒绝 absolute/network-path 且强制解析 origin 等于 `SERVER_PUBLIC_ORIGIN`，真实 CSRF 回归证明 `//evil.example/v1/admin/...` 返回 400、目标账号仍可登录；waiting TTL 与 finished TTL 一样发送 4010、关闭全部 socket、删除状态并允许实例驱逐；首次 initialize 改为先写可恢复 alarm 再提交 room state。测试增强为受 barrier 控制的 accept-close 竞态、alarm generation 2 保留、初始化 alarm→state 调用顺序、waiting TTL socket/record 回收、独立子进程 SIGKILL 后同目录重启和不响应 close 的原始 WebSocket 2 秒有界 shutdown。当前 standalone **2 files / 14 tests**、Worker **3 files / 27 tests**、`npm run typecheck` 与 diff check 通过；一次并行运行 Worker/standalone 时既有 DO eviction 用例因资源竞争超时，随后按正式顺序单独原命令通过，无断言或代码修正。等待第三轮 reviewer 复审。
- 2026-07-21 22:05：采纳第三轮 reviewer 新增的 1 项 Medium。确认端口占用时 `listen()` 原始 `EADDRINUSE` 会被未监听 Server 的二次 close 错误覆盖，并使同进程 SQLite exclusive lock 无法释放；启动失败清理现分别保护 listener、environment 和 process lock，任何一步清理异常都只记录且最终重新抛出原始启动错误。新增“端口先被占用→启动返回 EADDRINUSE→释放端口→同进程同数据目录成功启动/health”回归；standalone **2 files / 15 tests**、server typecheck 和 diff check 通过，等待第四轮 reviewer 复审。
- 2026-07-21 22:19：第四轮 reviewer 结论为 `No findings`，此前所有 High/Medium 均保持闭环。最终完整门禁通过：应用 **30 files / 271 tests**、Worker **3 files / 27 tests**、standalone **2 files / 15 tests**、`npm run typecheck`、应用 build、Worker dry-run、Node server bundle、same-origin `build:standalone` 和 diff check 全绿；实际 `dist-server/server.js` 以独立临时数据目录启动后，`/health`、静态首页和游客创建分别返回 200/200/201，SIGTERM 后 SQLite 保留且进程干净退出。当前机器没有 Docker 命令，真实 image/Compose smoke 未执行，Dockerfile/Compose 由类型、bundle、配置和 reviewer 静态检查覆盖。用户确认生产当前无活动房间，并明确以后完成门禁后可直接推送；准备提交、推送并跟踪 CI/自动部署。
- 2026-07-21 22:21：按用户要求完成长期文档终审。`AGENTS.md` 已把项目目标更新为单机 1+49、联机 2–10 真人补满 50，并固化双后端共享领域逻辑、standalone 单进程/SQLite、at-least-once alarm、两阶段 reconnect、请求目标/代理安全、资源驱逐、checkpoint-first shutdown、双后端测试和 Docker 验证规则；README 已补本机全栈运行、same-origin、端口互斥和数据独立；`docs/architecture.md` 覆盖平台适配、锁、alarm、token、恢复和驱逐；`docs/deployment.md` 覆盖原生/Docker、全部变量、HTTPS 代理、备份恢复、验证与限制。`.env.standalone.example` 默认关闭 proxy trust，避免无反代直连时误信客户端转发头。仓库仅有上述三份 docs，`asset-manifest.md` 与本次服务端契约无关，无需改动；文档 diff check 通过。
- 2026-07-21 22:24：用户要求把“写完代码必须通过 review”等执行规范长期固化。`AGENTS.md` 新增 Review and Delivery Rules：非 trivial 代码必须在实现/测试后终审，评估 findings 前重读 plan，逐条独立核对需求和兼容语义，所有 blocker/high/medium 必须修复并复审或在 plan 记录充分不修改依据，未闭环不得 commit/push/deploy/宣称完成；同时强制把每轮审查写入 `## Review`、实现验证提交部署写入 `## Build`，并维护 AGENTS/README/docs。另固化 Chrome/Edge 验收后关闭任务页面/context、停止本地服务且只留 blank page的清理规范；`docs/deployment.md` 同步增加生产部署前 review gate。

## Review

待实现完成后记录审查结论。重点检查：Cloudflare 与 standalone 协议一致性、本地 SQLite 事务与 token 安全、单进程串行边界、房间重启恢复、WebSocket 重连、内部接口不对公网暴露、代理 Origin/IP 处理、静态文件路径安全和优雅关闭。

### 2026-07-21 21:20 +0800

- 审查范围：以 `main@9473768` 为基线，完整审查当前全部 tracked/untracked 改动；按用户要求忽略且未修改 `session-ses_082c.md`。
- 对照 plan：`.agents/plans/2026-07-21-self-hosted-server.md`。
- 审查结论：**不通过（阻塞）**。
- 需要 builder 处理的 findings：
  1. **High — standalone alarm 不是 crash-safe。** `standalone/LocalDurableObjectRuntime.ts:84-96,188-195` 启动时只扫描 alarm 表，却在调用 handler 前先删除持久 alarm；进程在删除后、`GameRoom` 重新设 alarm 前退出，会留下有房间/checkpoint 但无 alarm 的状态，启动时不会实例化/继续房间。`worker/GameRoom.ts:465-474` 的房间状态与 alarm 也不是同一事务。现有 `tests/standalone/standaloneServer.test.ts:85-130` 仅覆盖 `server.close()` 的优雅重启，未覆盖异常退出窗口。
  2. **High — PID 文件锁会阻断异常后的 Docker/本机重启。** `standalone/StandaloneServer.ts:382-400` 只保存 PID，并把任何当前存活的同号 PID 当旧实例；容器重建后的 PID namespace 很容易复用 Node PID，崩溃后遗留锁会让新实例误报占用。若进程在创建空锁文件后、写 PID 前退出，空字符串被转成 PID 0，`process.kill(0, 0)` 也会把锁判为活跃。`tests/standalone/standaloneServer.test.ts:136-140` 实际只在同一进程启动第二个 server，没有覆盖跨进程、PID 复用和空锁恢复。
  3. **High — reconnect token 在客户端确认收到前即失效。** `worker/GameRoom.ts:234-253` 先生成并持久化新 token，之后才发送 `welcome`；`src/network/MultiplayerClient.ts:318-319` 只有收到该消息才保存它。已消费 admission 的重连若在这两步间断网/崩溃，客户端只持有已经失效的旧 token，此后会持续以 401 握手失败，无法回到运行中对局。需要两阶段 rotation/旧 token grace，并补丢失 welcome 的两端契约测试。
  4. **High — standalone WebSocket 在 accept 完成前关闭会留下幽灵在线成员。** `standalone/StandaloneServer.ts:139-174` 在异步 `acceptSocket` 完成前以 `accepted=false` 忽略 close；与此同时 `worker/GameRoom.ts:234-259` 已可能设置 `member.connected=true`、登记 socket、发送 welcome 并在多个 await 后才返回。该窗口关闭后不会调用 `webSocketClose`，可错误触发倒计时/开局；若 close 早于登记，还可能把已关闭 socket 永久留在 `LocalDurableObjectState`。需要让 close 与 acceptance 串行收敛，并补立即断开/accept 失败测试。
  5. **High — 本地房间实例和完整比赛 runtime 无界累积。** `standalone/LocalDurableObjectRuntime.ts:226-275` 的 `records` 从不删除对象；自然结束后 `worker/GameRoom.ts:534-542,114-120` 即使一小时后删除 SQLite 状态，也没有释放 `runtime`、socket/可见物等内存。顺序创建并完成/关闭房间可让单进程永久保留每场 50 人比赛状态，最终 OOM。需要明确本地对象销毁/驱逐机制及重复房间生命周期测试。
  6. **Medium — SIGTERM 不保证文档所称的最终 checkpoint。** `standalone/StandaloneServer.ts:424-431` 先等待所有 WebSocket/HTTP 完成关闭，之后才调用 `prepareForShutdown()`，且无超时/finally；`ws` 关闭握手默认可等待 30 秒，而 `docker-compose.standalone.yml` 未设置足够的 `stop_grace_period`（Compose 默认 10 秒），不响应 close 的客户端会使容器先被 SIGKILL，既不写最终 checkpoint 也不释放锁。应先停 loop/checkpoint，再有界 drain 网络并在 finally 关闭 DB/释放锁。
- 已参考验证：`npm run typecheck`、`npm run test`（271 unit + 26 Worker + 4 standalone）、`npm run build`、`npm run build:worker` dry-run、`npm run build:server` 均通过；`git diff --check` 通过；未发现 `context.Background()`。
- 验证缺口：当前环境没有 `docker` 命令，未能执行真实 image/Compose smoke；上述异常重启、PID 复用、welcome 丢失、accept-close race 和多房间资源回收也均未被现有测试覆盖。

### 2026-07-21 21:48 +0800（复审）

- 审查范围：再次完整重读本 plan，以 `main@9473768` 为基线复审全部 tracked/untracked 自托管改动；继续忽略且未修改 `session-ses_082c.md`。
- 审查结论：**不通过（仍有 2 High + 2 Medium）**。
- 上轮逐项状态：
  1. **alarm at-least-once：部分通过。** `standalone/LocalDurableObjectRuntime.ts:180-191,222-255` 已做到 handler 成功后按 generation 条件删除；复审额外验证 handler 内重设 alarm 后 generation 2 记录仍保留。但 `GameRoom.initialize()` 仍有首次状态与 alarm 之间的持久化窗口，见新 finding 3。
  2. **process lock：通过。** `standalone/StandaloneServer.ts:393-419` 的独立 SQLite `BEGIN EXCLUSIVE` 不再依赖 PID；额外以 bundled server 执行 SIGKILL 后使用同一数据目录重启成功。
  3. **reconnect 两阶段轮换：通过。** previous/pending 均可用于下一次连接，pending 被呈交时先提升为 previous，再签发新的 pending；ACK 只提升当前连接 attachment 中签发且仍匹配的 token。连续丢 welcome/ACK 仍有一个客户端已知 token 可恢复，旧 pending 会被替换而非无界累积。
  4. **Node accept-close：实现通过，测试覆盖偏弱。** close 与 acceptance 都进入房间串行队列，提前 close 会在 accept 完成后再次 release 并执行 `webSocketClose`，未再发现幽灵 connected/socket 路径；但现有测试没有确定性阻塞 acceptance，见 finding 4。
  5. **dormant eviction：部分通过。** force-close、终局 TTL 删除后能够释放 runtime/record，且持久 state/alarm/socket 存在时不会提前驱逐；等待房间 TTL 分支仍会遗留 socket/record，见 finding 2。
  6. **SIGTERM：通过。** `standalone/StandaloneServer.ts:422-450` 先 checkpoint，网络最多 drain 2 秒，超时 terminate，并在 finally 关闭数据库和释放 exclusive lock；Compose 已设 `stop_grace_period: 30s`。
- 本轮 findings：
  1. **High — standalone 的 URL 重建可绕过管理员 same-origin/CSRF 检查。** `standalone/StandaloneServer.ts:226-243` 将原始 `incoming.url` 直接交给 `new URL(..., publicOrigin)`；请求目标 `//evil.example/v1/admin/...` 会被解释成 origin `http(s)://evil.example`，而不是本机 public origin 下的双斜线路径。`worker/AdminDirectory.ts:734-735` 随后会把攻击者的 `Origin` 误判为同源。复审用真实 standalone HTTP 请求、有效管理员 Cookie 和 `Origin: http://evil.example` 对 `//evil.example/v1/admin/accounts/<id>/disable` 发起简单 POST，实际返回 200 并禁用了账号。SameSite=Strict 不能防同一 registrable domain 下的恶意兄弟子域；账号禁用/撤销和关房等无需 JSON body 的操作均可被 CSRF。应拒绝 network-path/absolute-form target，或始终把原始 target 作为 configured public origin 下的 path 解析，并增加真实 HTTP 回归。
  2. **High — 等待房间 TTL 到期后不关闭连接，导致永久幽灵 socket/实例。** `worker/GameRoom.ts:130-135` 删除 state/alarm 并把 `data` 置空，但不像 finished 分支那样关闭 WebSocket；`standalone/LocalDurableObjectRuntime.ts:390-392` 因 socket 仍在集合中而拒绝驱逐。客户端会继续保持一个永远不再响应的房间连接，攻击者还可在大厅记录释放后持续创建新房间，令 socket/record 跨 TTL 无界累积。复审直接触发该 alarm 后确认 `room-v1` 已删除，但 socket 未关闭、`getWebSockets().length === 1`、实例计数仍为 1。现有 eviction 测试只覆盖管理员 force-close，未覆盖等待超时。
  3. **Medium — 首次房间初始化仍可产生“有 state、无 alarm”的不可恢复记录。** `worker/GameRoom.ts:389-408` 先 `put(room-v1)`，随后才 `setAlarm()`；进程在两次独立 SQLite 提交之间退出时，`restoreAlarms()`（`standalone/LocalDurableObjectRuntime.ts:97-109`）不会枚举该房间。虽然创建请求尚未成功返回，但会留下永不恢复/过期的持久孤儿，说明“所有房间状态转换无窗口”尚未成立。首次初始化应先建立可恢复 alarm，或把 state/alarm 纳入同一原子提交/启动扫描。
  4. **Medium — 新增关键恢复测试仍未确定性覆盖所声称的异常点。** `tests/standalone/localDurableObjectRuntime.test.ts:15-47` 仅从第二连接观察 handler 运行时 alarm 行存在，没有杀死并重启进程，也未断言 handler 重设的新 generation 不会被旧 invocation 删除；`tests/standalone/standaloneServer.test.ts:137-158` 在客户端 `open` 后立即关闭，但没有 gate 住服务端 acceptance，因此正常 accept 完成后的 close 同样可使测试通过；`tests/standalone/standaloneServer.test.ts:160-164` 仍是在同一进程开第二个 server。核心 crash/竞态回归需要子进程 SIGKILL、可控 acceptance barrier 和 generation reschedule 场景，避免测试只验证最终表象。
- 已执行验证：`npm run typecheck`、`npm run test`（271 unit + 27 Worker + 9 standalone）、`npm run build`、`npm run build:worker` dry-run、`npm run build:server`、`npm run build:standalone`、`git diff --check` 全部通过；隔离目录内的实际 `dist-server/server.js` bundle 启动/health/SIGTERM 通过；bundle SIGKILL 后同数据目录重启通过；未发现 `context.Background()`。
- 残余验证限制：当前环境仍无 `docker` 命令，无法执行真实 image/Compose smoke。

### 2026-07-21 22:03 +0800（第三轮复审）

- 审查范围：第三次完整重读本 plan，以 `main@9473768` 为基线复审当前全部 tracked/untracked 改动；继续忽略且未修改 `session-ses_082c.md`。
- 第二轮 2 High + 2 Medium 状态：
  1. **network-path/absolute target CSRF：通过。** `standalone/StandaloneServer.ts:407-413` 同时拒绝非 origin-form、`//` network-path 与跨 `SERVER_PUBLIC_ORIGIN` target；HTTP 和 WebSocket 共用该校验。真实 HTTP 回归验证攻击请求返回 400 且目标账号仍可登录。
  2. **waiting TTL socket/实例泄漏：通过。** `worker/GameRoom.ts:130-140` 发送 terminal error、关闭全部 socket、释放 runtime、删除 state/alarm；close 生命周期释放本地 socket 后可驱逐 record。新增测试覆盖 socket close、状态删除和实例计数归零。
  3. **initialize state/alarm 窗口：通过。** `worker/GameRoom.ts:394-413` 已改为先提交可恢复 alarm，再写 room state；崩溃最多留下一个到期后自动清理的无状态 alarm，不再留下无法枚举的 room state。
  4. **关键竞态测试确定性：通过。** alarm generation 2、initialize 调用顺序、waiting TTL、独立子进程 SIGKILL/重启、raw WebSocket shutdown 均有直接断言；accept-close 由 `beforeWebSocketAccept` barrier 明确阻塞在 acceptance 前。该 hook 只能由进程内调用 `startStandaloneServer(config, hooks)` 显式注入，生产入口未传入、环境变量/HTTP 均不可控制，未形成远程后门。
- 此前 5 High + 1 Medium 状态：alarm at-least-once、SQLite exclusive lock、reconnect previous/pending/ACK、Node accept-close、room/runtime eviction、checkpoint-first bounded SIGTERM 均复核通过；Cloudflare Worker 测试与 dry-run、standalone bundle 均保持兼容。
- 审查结论：**不通过（新增 1 Medium）**。
- Finding：
  1. **Medium — listen 启动失败时清理链会再次抛错并永久占住当前进程中的数据目录锁。** `standalone/StandaloneServer.ts:71,86-91` 在 `listen()` 因 `EADDRINUSE` 失败后进入 catch，但对从未成功 listen 的 `Server` 调用 `closeHttpServer()`；`server.close()` 返回 `ERR_SERVER_NOT_RUNNING`，使 catch 在执行 `environment.close()` 和 `releaseLock()` 前提前退出，同时把原始端口错误掩盖成 “Server is not running.”。复审实测：先占用目标端口后启动 standalone，首次错误为 `Server is not running.`；释放端口后在同一进程、同一数据目录重试，仍报 `Standalone data directory is already used by another process`。CLI 进程退出最终会由 OS 释放锁，但测试、嵌入式调用或同进程重试会泄漏 SQLite/runtime 与 exclusive lock。启动失败清理也必须用嵌套 `try/finally` 保证 environment/lock 释放，并保留原始 listen 错误。
- 已执行验证：`npm run typecheck`、`npm run test`（271 unit + 27 Worker + 14 standalone）、`npm run build`、`npm run build:worker` dry-run、`npm run build:server`、`npm run build:standalone`、`git diff --check` 全部通过；隔离无根 `package.json` 目录中的实际 `dist-server/server.js` 启动/health/SIGTERM 通过；未发现 `context.Background()`。
- 残余验证限制：当前环境没有 `docker` 命令，仍无法执行真实 image/Compose smoke。

### 2026-07-21 22:12 +0800（第四轮复审）

- 审查范围：再次完整重读本 plan，以 `main@9473768` 为基线复核第三轮唯一 Medium 及当前完整自托管改动；继续忽略且未修改 `session-ses_082c.md`。
- 第三轮 finding 状态：**通过。** `standalone/StandaloneServer.ts:86-105` 保留并最终重新抛出原始启动错误；listener、environment、exclusive lock 三段清理相互独立，前两段抛错只记录，不会阻止 `releaseLock()`。对未成功监听的 Server 通过 `server.listening` 避免二次 `ERR_SERVER_NOT_RUNNING`。`tests/standalone/standaloneServer.test.ts:212-234` 先占用端口，断言原始 `EADDRINUSE`，释放端口后在同一进程、同一数据目录重新启动并验证 health，直接覆盖此前复现路径。
- 既有 findings 状态：前四轮涉及的 alarm at-least-once/generation、SQLite crash-safe exclusive lock、reconnect 两阶段轮换、accept-close、waiting/finished eviction、checkpoint-first bounded shutdown、request-target CSRF、initialize alarm→state 顺序和确定性竞态测试均保持闭环；本轮修复未改变 Worker 共享领域逻辑或生产 hook 暴露面。
- 审查结论：**通过 — No findings。** 未发现新的 blocker/high/medium。
- 已执行验证：`npm run typecheck`、`npm run test`（271 unit + 27 Worker + 15 standalone）、`npm run build`、`npm run build:worker` dry-run、`npm run build:server`、`git diff --check` 全部通过；未发现 `context.Background()`。
- 残余验证限制：当前环境仍无 `docker` 命令，未执行真实 image/Compose smoke；该限制不改变本轮代码结论。
