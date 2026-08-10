# Runtime Performance CI and Review Gates

## Context

建筑轮廓、纹理和连桥功能合并后，现有 CI 的最终场景资源预算与产物大小预算全部通过，但生产环境仍出现明显进场回归。根因包括构建期间创建并销毁大量临时 Mesh，以及单机为 49 个 Bot 重复初始化相同地图导航器。现有门禁只检查最终资源，未覆盖构建过程中的重复工作；Reviewer 也没有被强制要求逐次评估启动、每帧和批处理路径的性能风险。

## Contract

- 性能 CI 必须采用多维联合门禁，同时覆盖确定性的操作次数、对象 churn、场景资源，以及可重复采样的 wall-clock、FPS 和 heap。任何单一维度都不能独立代表整体性能，也不能仅凭单项改善掩盖其他维度的明显回归。
- 压缩包或 gzip 大小不属于运行时性能门禁。原始浏览器、Worker、standalone 产物大小继续由既有确定性 budget 独立约束。
- wall-clock、FPS 和 heap 必须在固定 Node/浏览器版本、固定地图/seed/画质、预热与多轮采样条件下使用，并采用抗抖动统计和有依据的容差；失败时必须同时输出确定性资源/操作事实，帮助区分真实回归与运行器噪声。
- CI 必须单独显示运行时性能合同结果，不能只把性能断言隐藏在完整应用测试中。
- 每个 PR/MR 必须触发独立性能 job，在同一 CI runner、同一 Node/Chrome/依赖和采样参数下对比 `origin/main` 与 PR HEAD。不得引用不同 run 的历史耗时直接比较。
- 所有纳入门禁的“越小越好”指标只要 PR HEAD 相对 `origin/main` 劣化超过 `15%` 就失败；“越大越好”指标按对称比例规则判断。报告必须列出 main/head 绝对值、变化百分比和失败维度。
- push 到 `main` 时运行绝对性能合同并产出基线 artifact，防止 merge 后才发现不可运行；PR 的通过条件仍以同 runner 的 main/head 相对对比为准。
- 场景门禁至少覆盖代表性的苍岬岛、灰炉城和烬岚郡布局，并监控最终 Mesh、材质、几何、顶点、索引、thin instance，以及构建期间新增/移除 Mesh 数量。
- 单机 49 个 Bot 必须共享同一份无状态地图导航索引；CI 必须锁定每局导航器构建次数，防止重复初始化回归。
- 性能阈值必须基于当前已验证架构制定。提高阈值必须记录具体资源或算法理由，并由独立 Reviewer 审查；禁止为让 CI 通过而无依据放宽。
- Reviewer 对每个代码变更都必须明确给出性能影响结论。涉及场景构建、每帧 update、Bot 循环、导航、网络 tick、序列化、资源加载、Mesh/material/texture 或集合扫描时，必须检查重复工作、复杂度、分配、缓存、批处理和可裁剪性，并列出仍存在的优化空间。
- Reviewer 不得重复外层已完成的完整性能命令；默认静态检查 diff 与热路径，只有证据缺口明确时才运行最小定向验证。

## Plan

1. 提取单机 Bot controller 创建 helper，并注入 navigator factory，使测试可确定性断言 49 个 Bot 只构建 1 个 `GridNavigator`。
2. 新增独立 runtime-performance 检查脚本，在 Babylon `NullEngine` 中创建代表性地图场景，记录最终场景资源、场景构建过程 Mesh churn、wall-clock 分位数和 heap 变化。
3. 新增 production Chrome 性能采样，固定地图/seed/画质，记录进场延迟、首段与稳定段 FPS/长帧，并保留音量 `0`。
4. 保留既有原始产物 budget；运行时性能对比不计算或阻断压缩大小。为运行时指标设置已签入相对阈值并输出逐项 PASS/FAIL。
5. 在 `package.json` 和 GitHub Actions 中增加独立性能检查命令与 CI 步骤。
6. 更新 `AGENTS.md`，要求 Builder 记录多维性能证据，Reviewer 输出明确的性能风险与优化空间结论。
7. 运行 Node 24 typecheck、性能脚本、相关单元测试、生产 build、现有 budget 与 `git diff --check`。
8. 启动独立 Reviewer，解决所有 blocker/high/medium Finding 后提交并推送 `main`，监控 CI。

## Build

- 2026-08-10：新增独立 `performance` GitHub Actions job。每个 PR/MR 明确 checkout PR HEAD，并在同一 runner 创建 `origin/main` worktree；双方复用 Node.js 24、依赖和 Chrome，先预热，再交替采样 3 轮并取中位数。
- 2026-08-10：新增三张地图高画质 `NullEngine` 采样，记录端到端 startup、强制 GC 后 heap、场景构建期间 Mesh add/remove churn，以及最终 Mesh/material/texture/geometry/vertex/index。新增灰炉城高画质 production Chrome 采样，音量固定为 `0`，记录进场延迟、稳定 FPS、P95/P99 帧时间、50/100ms 长帧、强制 GC 后 JS heap 和 DOM node 数。
- 2026-08-10：所有运行时指标统一使用 `15%` 相对 `main` 门禁；纯比较器回归证明 `15.00%` 通过、`15.01%` 失败，FPS 采用对称下降规则。gzip/压缩大小不参与运行时判定，原始产物继续由既有 `check:budgets` 约束。
- 2026-08-10：提取 `createSinglePlayerBotControllers`，单机 49 个 Bot 共享同一无状态 `GridNavigator`；独立 `test:performance` 使用 navigator factory 精确断言 49 个 controller 只构建 1 份导航索引。生产 Chrome 灰炉城高画质点击到 HUD 从合并后约 10.2 秒降至约 3.4 秒，优于合并前约 5.7 秒。
- 2026-08-10：新增需求确认长期规则：玩法数量、楼层、范围、权威状态、协议等存在歧义时，必须先得到用户明确确认，确认前不得实现或固化合同；Reviewer 必须回看用户原始需求，禁止只验证 AGENTS/Plan/测试自洽。
- 2026-08-10：紧急修复弹药库错误合同。所有地图无论弹药库建筑 1–4 层，都只保留 `level: 0` 和 `loot-250..253` 四种弹药，总 canonical loot 固定 `264`、手雷从 `254` 开始、上层专属弹药为 0。严格联机协议提升到 13，checkpoint 提升到 12。
- 2026-08-10：Node 24 三目标 typecheck 通过；弹药库/布局/AI/协议/checkpoint 核心 `7 files / 157 tests`、复核 `5 files / 120 tests`、standalone `3 files / 33 tests`、独立性能合同通过。Worker runtime 本机仍在任何测试前受 glibc 2.28 阻止，Worker typecheck 和 dry-run build 通过，新 push 的 Node 24 CI 必须补充真实 Worker 证据。
- 2026-08-10：browser、Worker dry-run、server build 和全部既有预算通过。production Chrome 音量 `0` 检查烬岚郡 seed 5，小地图显示唯一弹药库；scene 精确读取 `loot-250..253` 四种弹药均位于同一底层高度。权威脚本扫描 island/town/mixed 1–4 层代表 seed，全部得到唯一底层记录、总数 264、手雷起点 254、上层弹药 0。
- 2026-08-10：性能比较器新增 strict schema。`island-high`、`town-high`、`mixed-high` 和 `browser` 四个 section 及全部必需指标必须完整存在且为有限数值；section/指标缺失、未知、NaN 或 Infinity 均立即失败，禁止空 comparison fail-open。
- 2026-08-10：浏览器采样分为 startup 与 stable 两段。startup 覆盖点击开始至 HUD 出现后 2 秒，stable 覆盖其后 8 秒；两段分别记录 FPS、P95/P99 帧时间及 50/100ms 长帧，连同进场延迟、强制 GC 后 JS heap 和 DOM node 一起参与 15% 门禁。采样器等待 Chrome 有界退出并清理临时 profile，实测完整输出后无 `/tmp/last-line-performance-chrome-*` 残留。
- 2026-08-10：场景采样新增 `thinInstances` 总量；main push 的 performance job 使用 `--mode baseline` 预热后采样 3 轮中位数，校验同一 strict schema，并上传 JSON/Markdown 基线 artifact。PR 仍在同 runner 对 main/head 做 15% 相对比较。

## Review

- 2026-08-10 Reviewer Round 1 按用户原始语义审查弹药库热修，确认功能代码、协议/checkpoint 和测试覆盖正确；提出 1 个 Medium（部署文档仍写协议 12 Worker）和 1 个 Low（standalone 测试名称/目录仍写 version 11）。两项均已改为协议 13 / version 12，已请求 Re-review。
- 2026-08-10 Reviewer Re-review 确认弹药库与前述 Medium/Low 已闭环，但对性能 CI 提出 1 个 High（漏采刚进游戏 startup 长帧）、3 个 Medium（缺指标 fail-open、遗漏 thin instance、main push 不生成绝对基线 artifact）和 1 个 Low（架构文档保留旧性能规则）。Builder 已按上述 Build 记录全部修复，并请求最终 Re-review。
- 2026-08-10 Reviewer 最终 Re-review：Blocker、High、Medium、Low 均为 0，批准提交推送。Reviewer 确认 startup/stable 双阶段帧指标、strict schema、thin instance、PR 相对门禁、main 基线 artifact 和架构文档均已闭环；弹药库仅底层四堆、协议 13、checkpoint 12、需求歧义先确认和原始需求回看规则均符合用户明确澄清。性能上，弹药库修复只减少记录/同步/渲染资源，共享导航器消除最多 48 次重复索引构建，当前 diff 未发现可能超过 15% 的新增运行时风险。
