## Plan

### 背景

联机模式下，桌面端与手机端在飞机/跳伞高空阶段都看不到地面物资，接近落地后才出现；同时用户确认联机飞机阶段存在卡顿，落地后恢复。已静态确认现有服务端按 X/Y/Z 三维 60m 球过滤地面物资，导致高空客户端根本收不到物资记录。修复可见性前必须同时定位飞机阶段卡顿，避免水平范围同步放大高空快照或 Mesh 创建开销。

### 目标与边界

- 仅修复联机投影与联机表现链路；单机物资和权威规则保持不变。
- 联机高空能够看见水平 60m 范围内的地面物资，不同步全地图 250 件物资。
- 定位并最小修复“飞机/跳伞阶段卡、落地后正常”的确认根因，不以降低画质、删除物资或弱化权威语义掩盖问题。
- 保持 Cloudflare 与 standalone 共用实现；桌面与手机使用同一业务语义。
- 覆盖高空物资投影、进入/离开范围生命周期、快照字节/资源有界性及关联的浏览器性能验收。

### 实现顺序

1. 复核飞机阶段 snapshot、远端 actor 平滑、飞机/场景同步、物资投影与 Mesh 生命周期。
2. 使用 production standalone 双人联机做性能取样，区分 CPU 长任务、渲染资源抖动与网络/快照批处理。
3. 先补失败回归，再实现水平物资投影及确认的高空卡顿最小修复。
4. 执行 typecheck、完整 Worker/standalone 测试、构建、预算和桌面/手机浏览器验收。
5. 完成静态审查，更新文档，提交、推送并验证生产 Worker 与正式联机 smoke。

## Build

### 更新日志

- 2026-08-02 18:11：确认当前/目标分支均为 `main`，按用户要求先 pull 并 fast-forward 至 `350711a`；工作区仅保留用户既有 `.gitignore` `.opencode` 改动，本任务不纳入提交。建立专用计划，先调查联机高空卡顿再改物资可见性。
- 2026-08-02 18:34：静态根因确认。飞机速度约 52m/s、快照约 10Hz、插值最短 120ms，而本地 correction 固定 6m 上限；正常相邻快照会形成约 5.2m 新位移加约 0.87m 未完成插值，隔次达到约 6.07m 并触发 snap，符合“飞机阶段卡、落地后正常”。本地跳伞仍错误复用 grounded 6m 上限，外部飞机 progress 也直接按 10Hz 快照跳变。物资延迟则由服务端三维 60m 球过滤确认；改成水平 60m 后沿航线同时可见约 3–5 件、整条航线累计约 17–24 件，预计单帧仅增加约 0.7–1.0KB，不是当前卡顿根因。另确认 `sendFull` 未重置 per-player visible loot set，需一起修复退出范围 tombstone 生命周期。
- 2026-08-02 18:45：完成核心实现。新增 deployment-aware 本地 correction：grounded 保留 6m，aircraft/parachuting 按 snapshot/interpolation 时间与权威速度预算平滑并保留硬上限；外部飞机 progress 改由 rendered server tick 推导。物资复制改为水平 60m，full state 重置可见 ID，增量帧只发 newly-visible、dirty-visible、hidden tombstone，不再每 100ms 重发全部可见物资。新增隔次 6.07m 飞机 correction、高速跳伞、外部飞机 progress、高空物资边界及 loot 生命周期回归；针对性测试通过，等待完整验证。
- 2026-08-02 20:13：最终验证通过：`npm run typecheck` 三段通过；`npm run test` 单次全绿（unit 40 files / 361 tests、Worker 4 files / 31 tests、standalone 3 files / 20 tests）；Worker/standalone/browser/server build 与全部预算通过。production standalone 双人联机、音量 0，飞机阶段 5 秒 RAF 取样 601 帧、平均 8.33ms、最大 9.4ms、0 个 >25ms 帧；控制台最终无 error/warn。浏览器验收结束后已关闭额外 context、保留唯一 `about:blank` 并停止/删除临时 server 数据。
- 2026-08-02 20:30：实现 commit `4da0c78`（`fix: smooth airborne multiplayer and improve match UX`）已推送 `main`。用户随后要求明确独立审查门禁；已实际启动独立 `code-reviewer` 对 `350711a..4da0c78` 做最终静态审查，无 blocker/high/medium/low finding。生产 Worker 部署与 smoke 待规则文档 follow-up 提交后执行。
- 2026-08-02 20:35：独立 reviewer 通过后，规则 follow-up commit `5d826b5` 已推送。自动 Worker 部署状态仍停留旧版本，按仓库 fallback 执行 `npm run deploy:worker`；Worker typecheck、31 项 Worker tests、dry-run bundle、正式部署及 production HTTP/WebSocket smoke 全链通过。生产 Worker 当前版本 `577b4e09-15b9-45dd-bcf2-b86257c017fb`，protocol 3 smoke 通过。
- 2026-08-02 22:57：用户生产复验确认水平 60m 高空 footprint 仍几乎看不到物资，并补充开局飞机阶段会闪现。重新核对正式站已部署 `4da0c78` 客户端；生产探针确认 `match.full` 在航线起点包含 0 件物资，60m 方案沿航线同屏仅约 3–5 件，未达到实际可见性目标。开局闪现根因确认为地图加载期间服务端已推进、客户端却先渲染旧 full 后再应用合并后的最新 snapshot，加载越久首帧追赶距离越大并触发 24m snap。当前修正为 session 首帧前吸收积压快照并重置展示时间线；飞机/跳伞物资 footprint 扩至与 actor replication 相同的水平 400m，落地仍保持 60m，steady frame 仍只发 transition delta。seed 2026 全航线确定性探针峰值 47 件、累计 116 件、单步最多 5 件进入或 2 件离开；代表初始投影约 31KB，仍低于现有 50KB full-state 上限。针对性 3 files / 32 tests 与 app typecheck 已通过，尚待完整门禁和最终浏览器验收。
- 2026-08-02 23:17：完整自动门禁通过：`npm run typecheck`；unit 40 files / 362 tests、Worker 4/31、standalone 3/20；Worker dry-run、browser/standalone server builds、YAML 解析和 `git diff --check`。预算最终为 browser entry 1,036,163/1,075,000、CSS 44,894/45,000、Worker 395,454/400,000、standalone 417,300/425,000，全部通过；首次 CSS 超限 35 bytes 后未调高预算，改为复用既有双按钮布局并重新构建通过。本地 production standalone 双客户端确认高空物资通过真实 WebSocket 以 transition delta 持续进入，快照稳态仍约 10Hz；5 秒 RAF 窗口平均 8.33ms、最大 10.3ms、0 个 >25ms，console 无 error/warn。浏览器页/context、standalone 与临时数据均已清理，仅保留 `about:blank`。本机无 Docker，真实 image smoke 留给推送后的 GitHub runner。
- 2026-08-02 23:26：采纳 Round 7 Medium。HUD 现在于同一个同步 `start()` 调用中先创建，再消费加载期积压消息，随后才重置 correction/remote pose/render tick；因此浏览器仍不会在中间绘制旧 full，但积压的本地死亡、赛果和 connection feed 事件已有展示目标，不再被静默消费。针对性 app typecheck 与 3 files / 17 tests 通过，等待独立复审。

## Review

### 2026-08-02 20:15 — Final static review

- 审查范围：相对 `main@350711a` 的 airborne correction、external aircraft presentation、horizontal loot projection/delta/full bookkeeping、关联测试与架构文档；排除用户既有 `.gitignore` 改动及独立局内 UX plan 的展示细节。
- 结论：通过，未发现明确 blocker/high/medium。grounded 仍使用历史 6m 阈值；aircraft/parachuting 预算同时受速度、snapshot/interpolation 时间与 24m/18m 硬上限约束，deployment/death/真实 teleport 仍 snap；外部飞机只改 presentation progress，不修改权威 `FlightState`。
- 物资复核：高空仅同步水平 60m footprint，不同步全图；full 正确替换 per-player visible set，steady frame 不重发，dirty/new/hidden generation/tombstone 顺序保持；交互仍走既有 3D 权威距离。完整测试、构建、预算与浏览器证据均已记录，无剩余中高风险。

### 2026-08-02 — Final static re-review (Round 2)

- 审查范围：`main` 的 `350711a..4da0c78`，对照本 plan 复核 airborne correction/teleport 边界、external aircraft interpolation、horizontal loot projection、transition-only delta/full bookkeeping、dynamic generation 与快照有界性；排除既有 staged `.gitignore` `.opencode` 改动。
- 结论：通过，本轮未发现明确问题；无 blocker/high/medium finding，Round 1 无待处置 finding。实现仍保持 grounded 6m 阈值，aircraft/parachuting 使用速度、tick gap 与硬上限组合预算，生命周期和超预算位移立即 snap；物资 full/增量/隐藏 tombstone 链路与客户端 generation 更新一致。
- 验证依据：仅使用 plan 已记录的 typecheck、单次完整测试、Worker/standalone/browser/server builds、budgets 与双人 production standalone 浏览器证据；按要求未复跑测试、构建或浏览器检查。
- 残余事项：本轮是静态代码审查，不包含生产 Worker 部署状态或正式 production smoke 的确认；该发布门禁仍需按仓库交付规则另行记录。

### 2026-08-02 — Independent gameplay/UX static review (Round 7)

- 审查范围：相对 `main@3f17b4a` 的 `MultiplayerSession` 首帧积压快照吸收、`MatchRuntime` 空中 400m/落地 60m 物资投影、transition delta/tombstone、关联测试及架构文档；排除 staged `.gitignore` 和暂停中的 version-injection 文件。仅采用已记录的 typecheck、unit 40/362、Worker 4/31、standalone 3/20、构建、预算、浏览器及 standalone 探针证据，未复跑门禁。
- 结论：不通过；发现 1 项 medium，需 builder 处理后复审。400m/60m 水平 footprint、权威 3D 交互、full/delta/tombstone 计算和有界数量本轮静态复核未见其他明确问题。
- **Medium — `src/app/MultiplayerSession.ts:193-203, 527-540`：** `start()` 在创建 HUD 前消费加载期积压消息；sequenced 事件因此在 `hud === null` 时被提交。若本地角色在重连/地图加载期间死亡，`processEvents()` 会先把 `playerEliminated` 置为 `true`，却无法展示淘汰卡；HUD 创建后的 `synchronizeOutcome()` 又因该标志跳过补偿，导致淘汰卡及返回/观战操作一直缺失。同期 connection/feed 事件也会静默丢失。
- 待 builder 处理：在不恢复首帧旧状态渲染的前提下，将积压事件的展示/淘汰状态提交延后到 HUD 可用之后，或提供等价的无事件丢失初始化顺序；补充“start 前积压本地 `actor-died`/connection event”的针对性回归，确认首帧仍直接使用最新 snapshot。此项为阻塞复审的 medium，不是仅风险提示。

### 2026-08-02 23:26 — Round 7 disposition

- **采纳并修复 Medium：** `MultiplayerSession.start()` 将 HUD 创建移动到积压消息消费之前；两步仍处于同一个同步调用栈，首帧绘制前 state 已更新到最新 snapshot。随后明确清空 bootstrap correction、以最新 actor positions 重建零时长 remote poses，并把 rendered server tick 重置到最新 tick，保持消除开局追帧闪现的目标。
- **验证：** app typecheck 与 `gameAppActions` / `matchRuntime` / `positionSmoothing` 共 17 项针对性测试通过；完整门禁和浏览器证据继续沿用 23:17 记录，待最终复审通过后再做提交前最小重验。

### 2026-08-02 — Independent static re-review (Round 8)

- 审查范围：沿用 Round 7 的 `main@3f17b4a` gameplay/UX 范围与排除项，重点复核 `MultiplayerSession.start()` 初始化顺序、积压事件和首帧 presentation reset，并再次静态核对空中 400m/落地 60m 物资生命周期与有界性；未重复运行测试、构建、预算或浏览器检查。
- 结论：通过；Round 7 的 `MultiplayerSession` Medium 已关闭，本范围未发现新增 blocker/high/medium。HUD 在 `processMessages()` 前同步创建，因此积压的 `actor-died`、`match-finished` 和 `human-connection` 均有展示目标；随后在同一调用栈内清空 correction、以最新 state 重建零时长 poses、重置最新 render tick，并在返回浏览器事件循环前执行首次 `syncVisuals()`，不会恢复旧 full 首帧。
- 关联复核：400m airborne/60m grounded 水平 footprint、权威 3D 交互、full/delta/tombstone 和数量/载荷边界未因本轮修正改变。验证依据沿用 plan 已记录的完整门禁、浏览器/standalone 探针及 23:26 针对性结果；残余验证缺口是当前没有直接构造 start 前积压事件的专用 session 单测，但静态调用顺序不存在未决中高风险。

### 2026-08-02 — Final independent static re-review (Round 9)

- 审查范围：沿用 Round 7/8 的 `main@3f17b4a` gameplay/UX 范围与排除项；复核最终 pointer-lock follow-up 未影响 `MultiplayerSession` bootstrap，并再次对照 400m airborne/60m grounded loot、transition lifecycle、交互距离与性能边界。未重复运行完整门禁。
- 结论：通过，本次审查未发现 blocker/high/medium。Round 7 的积压事件/首帧 finding 继续保持关闭：HUD、消息消费、bootstrap pose/correction/render-tick reset 和首次视觉同步仍处于同一同步调用栈，最新 snapshot 在任何浏览器帧前生效；pointer-lock helper 改动不进入该联机状态链路。
- 验证依据：沿用已记录的完整 typecheck/tests/build/budgets、浏览器/standalone 探针，以及 23:31 的 app typecheck、17 项 targeted tests、browser build、预算和 diff check；本轮仅做静态复审。
