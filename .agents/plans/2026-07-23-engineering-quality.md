## Plan

### 背景

项目已具备完整应用、Cloudflare Worker、standalone Node.js 和 Docker 部署链路，但 CI 尚未实际构建并启动容器，也没有自动约束前端/服务端产物体积、关键模拟工作量或生产场景资源规模。服务端目前缺少活动房间、tick 调度延迟、WebSocket 发送积压和 checkpoint 写入耗时等低基数运行指标。

### 目标

1. 在 GitHub Actions 中构建 production Docker image，并以只读、非特权方式启动容器检查 `/health`。
2. 为前端、Worker、standalone 产物建立确定性的原始字节预算，阻止依赖或资源意外膨胀。
3. 为 AI/模拟、快照和生产场景资源建立不依赖机器耗时的固定回归预算。
4. 以共享、只观察、不影响权威状态的方式记录活动房间、tick 延迟、WebSocket 积压和 checkpoint 耗时；不新增公开 metrics 接口，不记录房间、账号、IP 或 token 等高基数/敏感字段。
5. 保持 Cloudflare 与 standalone 玩法和协议一致，指标故障不得影响房间运行。

### 实现边界

- 不引入浏览器自动化、Playwright、容器仓库推送或长期凭证。
- 不用墙钟耗时、FPS、内存或压缩后字节作为硬 CI 阈值。
- Cloudflare 服务端 WebSocket 无法读取真实 `bufferedAmount` 时明确记录不可用，不用消息大小或零值伪装。
- `/health` 保持现有轻量响应，不公开新增 `/metrics`。
- 预算调整必须是显式、可审查的代码变更。

## Build

### 更新日志

- 2026-07-23 14:17：确认 `main@aa4d496` 与 `origin/main` 对齐，工作区仅有用户原有 `.gitignore` 修改，继续保持不碰不提交。完成 CI、Docker、standalone/Worker 服务边界、既有测试和产物规模的只读梳理；确定采用 Docker `/health` smoke、原始字节预算、固定操作/资源/协议字节预算和无公开端点的结构化指标日志方案。尚未修改业务代码。
- 2026-07-23 14:40：完成工程质量门禁实现。GitHub Actions 现在固定构建单人 Pages 产物，随后构建 Worker/standalone、执行 `check:budgets`，再无凭证构建 production Docker image，并以非 root、只读根目录、`no-new-privileges`、临时 `/tmp`/`/data` 和动态回环端口启动容器，严格校验 `/health` 后才允许 Pages/Release 继续。新增原始字节/分块预算脚本，当前前端入口 `1,020,794/1,075,000`、最大异步块 `613,551/650,000`、全部浏览器 JS `3,717,449/3,900,000`、252/260 chunks、CSS `41,556/45,000`、dist `4,236,301/4,450,000`、Worker `383,765/400,000`、standalone `406,121/425,000`，全部通过。
- 2026-07-23 14:40：新增 schema v1 结构化服务指标。`LobbyDirectory` 在持久目录变化后记录绝对 `active_rooms`；`GameRoom` 以 60 秒窗口汇总 `tick_delay_ms`、`websocket_buffered_bytes`、`checkpoint_duration_ms`，并在关闭/终局/失败路径刷新。standalone 记录真实 `ws.bufferedAmount` 到 stdout；Cloudflare 明确增加 `unavailableCount`，不伪造零值。指标不含房间、账号、IP、URL 或 token，不持久化、不增加公开端点，sink 同步/异步失败均不影响权威房间。Wrangler 开启自定义日志并关闭 invocation logs。
- 2026-07-23 14:40：新增不依赖墙钟的固定回归预算：五个 seed 的 49 Bot 搜刮寻路次数、seed 2026 完整 49 Bot 战局的控制器/命令/寻路/LOS/射线/事件/loot 工作量、10 真人 50 actor 的 full/snapshot/450-event/checkpoint JSON 字节，以及真实 production GLB 中画质 50 actor NullEngine 场景的 mesh/node/material/geometry/vertex/index 上限。完整门禁通过：应用 34 files / 313 tests、Worker 4/29、standalone 3/20，`npm run typecheck`、应用 build、Worker dry-run、standalone server bundle、全部预算和 `git diff --check` 均通过。当前机器仍无 Docker 命令，因此本地容器 smoke 无法执行；原生真实 HTTP/WebSocket、优雅关闭和 SIGKILL 后锁恢复由 standalone 20 项测试覆盖，真实容器 smoke 将由本次新增 GitHub Actions 完成。尚待提交、推送和远端 CI 确认。
- 2026-07-23 14:42：工程实现、CI、指标和回归测试已提交为 `6c56fb3 chore: add engineering quality gates`；AGENTS、README、架构、部署说明与本 plan 作为配套文档提交，随后与实现同批普通 push。远端 CI/Docker smoke 结果按用户既有要求仅在对话汇报，不再为监控结果创建 plan-only 小提交。
- 2026-07-23 14:49：首轮远端 CI `29985918638` 的 typecheck、362 项测试、三套 build、预算检查和 Docker image build 均通过，但容器 smoke 暴露真实问题：只读容器上的 `/data` tmpfs 默认由 root 持有，非 root `node` 用户无法创建 SQLite lock database，健康检查因此未就绪。修正 CI tmpfs mount 为 `/tmp mode=1777`，并为 `/data` 显式设置 `uid=1000,gid=1000,mode=0700`，继续保留 `noexec/nosuid`、只读根目录和 `no-new-privileges`；待新一轮远端容器 smoke 确认。

## Review

### 2026-07-23 14:40 +0800

- 审查范围：本 plan 对应的 CI、预算脚本、共享 metrics 契约、Worker/standalone 接入、测试与文档；继续排除并未修改用户原有 `.gitignore`。
- 审查修正：Docker smoke 补齐 `--init`、`no-new-privileges` 和受限 tmpfs；结构化日志补齐固定 `schemaVersion: 1`；移除单个 WebSocket error/send failure 触发的高频部分窗口 flush，仅在房间生命周期和 checkpoint/tick 失败边界刷新。
- 远端验证修正：首轮真实容器 smoke 证明 root-owned `/data` tmpfs 与镜像的非 root 用户不兼容；该问题成立且阻塞容器启动，已用显式 UID/GID 和私有目录权限修复，而不是放宽为 root 容器或可写根目录。
- 独立核对：指标只读取调度时间、socket 队列和 checkpoint 写入边界，不反馈到模拟、网络节流或持久状态；Cloudflare buffer 不可用语义与 standalone 真实值明确分离；无新增 `/metrics` 或内部路由暴露；预算只使用固定 seed、操作/资源/原始字节，不依赖运行器速度、FPS、GC、内存或压缩器版本。
- 结论：**通过，未发现剩余 blocker/high/medium。** Docker 本机不可用是已记录的验证环境缺口，由 push 后的 GitHub Actions 容器构建与 smoke 关闭。

### 2026-07-23 15:08 +0800 — Final range review

- 审查范围：以本 plan 为基线，完整复核 `aa4d496..32c1488` 的 3 个提交和全部 24 个改动文件，并对照 `main@aa4d496`；用户原有 `.gitignore` 修改继续排除且未触碰。
- 结论：**通过。No findings（blocker/high/medium/low 均无）。** CI 固定 Pages production 环境并构建 browser/Worker/server；原始字节及固定操作、协议、场景资源预算均为确定性门禁；Docker 使用实际 production image、非 root image user、只读根目录、`no-new-privileges`、受限临时 `/tmp`/`/data`，严格匹配 `/health` 且失败/成功路径均清理容器。
- 指标核对：`active_rooms` 取持久 room directory 的 fresh waiting/countdown/running 绝对数；tick delay 在权威 step 前相对计划 tick 采样；checkpoint 从 `runtime.checkpoint()` 序列化前计时至 `checkpoint-v1` storage 完成/失败；standalone 读取真实 `ws.bufferedAmount`，Cloudflare 只增加 `unavailableCount`。记录为低基数 schema v1 JSON line，不持久化、不公开 endpoint、不反馈权威逻辑，sink 同步/异步失败被隔离；Worker/standalone 共用实现与协议边界未分叉。
- 验证证据：独立执行 `npm run typecheck`；定向 4 个 unit budget/metrics 文件（26 tests）、Worker metrics（1 test）、standalone metrics/lifecycle（14 tests）；重新执行 browser、Worker、server builds 与 `npm run check:budgets`，全部通过，预算值与 Build 记录一致；`git diff --check aa4d496..32c1488` 通过。另核验 GitHub Actions run `29986319176` 对 `32c1488` 全部成功，包含 362 项完整测试、三套 build、budgets、无凭证 Docker build、真实 image smoke、cleanup 与后续 Pages deploy。
- 残余风险：本机仍无 Docker，未重复本地容器 smoke；远端最终 run 已实际覆盖并关闭此前 root-owned `/data` tmpfs 问题。改动业务源码未出现 `context.Background()`。
