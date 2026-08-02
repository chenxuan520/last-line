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
