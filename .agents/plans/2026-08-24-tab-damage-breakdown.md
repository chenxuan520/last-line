# Tab Damage Breakdown

## Plan

### Goal

在 `Tab` 本局排行榜中，让玩家看到自己对每名角色使用哪些武器造成了多少原始伤害，同时保持权威结算、联机重连恢复和现有排行榜性能边界。

### Product Shape

- 排行榜继续按现有规则显示排名、角色名、存活状态和击杀数，不改变排序。
- 在被伤害角色对应行的角色名后，按稳定武器顺序显示“武器图标 + 累计原始伤害数值”。
- 只创建实际造成过正伤害的武器条目；没有伤害的武器完全不渲染，不显示固定武器格、伤害标题或占位符。
- 只显示当前玩家对目标造成的伤害；手雷自伤不记录也不显示，其他玩家和 Bot 的伤害不向当前玩家展示。
- 原始伤害指权威命中或爆炸距离与遮挡判定通过后，头盔减免、护甲吸收和剩余生命截断之前的伤害。霰弹枪累计每个实际命中的 pellet，破片手雷使用权威距离衰减值。
- 每局从零开始；联机断线重连和服务端 checkpoint 恢复后继续保留同一局统计。

### Scope and Non-goals

- 修改共享伤害统计、联机投影、checkpoint、排行榜渲染与样式，并覆盖枪械、霰弹枪和破片手雷。
- 不改变现有伤害、护甲、头盔、死亡、击杀归属、同时结算、命中检测、爆炸遮挡或安全区规则。
- 不修改 `actor-damaged.damage` 的既有“实际生命损失”语义，也不从展示事件推断武器或原始伤害。
- 不展示每次命中历史、时间线、入站伤害、Bot 伤害或手雷自伤。

### Key Decisions

- 权威层使用按 `sourceId -> targetId -> causeId` 组织的稀疏累计，只记录真人角色来源；`causeId` 使用四种枪械 ID 或 `grenade.frag`。
- 枪械在同时伤害批次应用前记录所有有效命中贡献，避免死亡应用顺序改变累计；AI 控制的命令不计入真人统计。
- 同 tick 多枚手雷在合并生命伤害前按各自 owner 记录贡献，避免现有击杀来源选择规则错误吞并其他来源。
- 普通联机快照只携带变化后的累计条目，并在 viewer 投影中只保留 `sourceId` 等于当前玩家的条目；`match.full` 只下发当前玩家的稀疏全量，用于重连恢复。
- checkpoint 保存完整但稀疏的真人伤害累计并严格验证 actor、目标、cause 和正有限数值；协议与 checkpoint 版本同步提升。
- HUD 只在排行榜可见时按现有最多 10Hz 节奏检查签名；伤害没有变化时不重建 50 行 DOM。

### Performance Contract

- 不在 `ActorState` 中复制伤害历史，不让 50 个 actor 的常规复制负担随统计增长。
- 不在每个 snapshot 广播完整伤害矩阵；只发送本帧变化且只发给对应来源玩家。
- 不记录 Bot 来源，因此单机最多维护 1 名玩家、联机最多维护 10 名玩家的稀疏数据。
- HUD 不做每帧全量伤害矩阵扫描；只读取当前玩家记录，并沿用排行榜可见时的有界刷新。

### Open Questions

- 无。用户已确认手雷自伤不显示、重连后保留，并要求避免明显性能影响。

### Tasks

1. 添加失败回归，锁定枪械减免前累计、霰弹枪 pellet 累计、手雷距离伤害、多来源归因、自伤排除和 AI 来源排除。
2. 实现共享稀疏累计与变化集，接入枪械和手雷权威结算，不改变实际扣血事件语义。
3. 增加 checkpoint 保存/恢复与严格校验，增加 viewer 专属 full/snapshot 投影和客户端变化合并，并升级协议/checkpoint 版本。
4. 在排行榜角色名后渲染实际存在的武器图标与累计值，补签名、图标、无占位符、淘汰样式及窄屏布局回归。
5. 更新 `AGENTS.md`、架构和部署文档中的流程、权威统计、协议及持久化合同。
6. 运行定向测试、Worker/standalone 合同测试、完整 typecheck/test/build、Worker/server/standalone 构建、性能合同与预算检查。
7. 使用 production build 在本机 Chrome 中保持音量 `0`，检查普通、多人武器、淘汰和无伤害行，并分别检查桌面与移动横屏截图、console、裁剪和重叠；结束后清理页面、服务和临时资源。
8. 完成独立 Reviewer 审查并闭环全部 blocker、high、medium Finding，更新本 Plan 后提交并推送功能分支。
9. 创建 MR/PR，在 MR 中 `@codex`；持续处理 Codex 与 CI 反馈并重复必要验证和 Reviewer，直到 Codex 完全通过且 required checks 全绿后合并。
10. 按严格协议维护发布流程确认 Worker、Pages、production smoke 与线上行为。

### Validation and Success Criteria

- 有头盔/护甲或低剩余生命的目标仍按减免前值累计，`actor-damaged.damage` 保持实际生命损失。
- 霰弹枪只累计命中的 pellet；多来源同时命中与多枚手雷不受命令或记录插入顺序影响。
- 手雷自伤、Bot、AI takeover、安全区伤害、miss、遮挡和零伤害均不产生可见条目。
- 无伤害行保持原布局，不生成图标、数字、空容器或占位符；有伤害行显示在正确目标名称后。
- 联机普通快照只发送当前来源的变化项，其他玩家不能看到该统计；重连和 checkpoint 恢复后累计不丢失或重复。
- 排行榜排序、Tab + 滚轮、淘汰名称样式、桌面和移动横屏布局无回归。
- 自动化验证、production 浏览器验收、独立 Reviewer、Codex 和 required checks 全部通过。

### Update Log

- 2026-08-24：记录用户确认的排行榜展示、仅显示实际造成伤害的武器、护甲/头盔减免前累计、自伤排除、重连保留和低性能影响要求；完成现有 UI 与权威伤害链路研究并确定稀疏增量投影方案。

## Build

### Update Log

- 2026-08-24：先增加权威集成失败回归，旧实现的 5 个新增用例均因不存在伤害累计而失败；排行榜 helper/signature 的 2 个新增用例也按预期失败。实现后定向 `DamageSystem`、`ThrowableSystem`、`GameSimulation`、`MatchRuntime`、排行榜、协议和图标共 7 files / 123 tests 通过。
- 2026-08-24：新增 `DamageTotalsTracker`，只记录非 AI 控制真人来源对其他角色的正 raw contribution。枪械在同时批次实际扣血前累计，霰弹枪同 source/target/cause 的 pellet 在变化集中合并为一条最终 total；手雷在目标总伤害合并前按 owner 分账。`actor-damaged.damage`、护甲、头盔、死亡和击杀逻辑保持原语义。
- 2026-08-24：协议提升至 16，checkpoint 提升至 15。普通 frame 只携带稀疏 `damageChanges`，viewer 投影只保留当前来源；`match.full` 只下发当前玩家完整累计。checkpoint 严格拒绝缺失 ledger、Bot 来源、自伤、未知 cause、非正或非有限总值，恢复后继续累计。
- 2026-08-24：排行榜保留原 4 列和排序，只在目标名称后为实际正伤害创建“图标 + 数值”；无伤害行不创建伤害 list/item。当前玩家伤害进入既有排行榜 signature，其他来源变化不触发该玩家 DOM 重建。
- 2026-08-24：完整三套 typecheck 通过；完整 `npm run test` 为 unit 51 files / 620 tests、Worker 4 files / 52 tests、standalone 3 files / 33 tests；performance contracts 2/2 通过。browser、Worker dry-run、server、same-origin standalone 和最终 browser rebuild 均成功。
- 2026-08-24：初次 budget 检查仅 Worker `633,026 / 630,000`、standalone `643,172 / 640,000` 失败。相对 main 分别增加 5,175B/4,955B（0.82%/0.78%）；独立资源审查确认稀疏实现无超过 15% 风险，并批准按实际增量把两项预算最小调整为 635KB/645KB。最终全部预算通过：browser entry `1,175,417 / 1,200,000`、all JavaScript `3,858,188 / 4,000,000`、CSS `45,759 / 50,000`、dist `4,681,887 / 5,000,000`、Worker `633,026 / 635,000`、standalone `643,172 / 645,000`。
- 2026-08-24：实现 Agent 使用最终 production 样式在 Chrome 中保持音量 `0` 验收。真实无伤害对局包含 50 行且 `.leaderboard-damage-list/.leaderboard-damage` 均为 0；临时验收累计通过真实 `GameHud` 路径渲染 5 个枪械/手雷图标及数值，桌面 `1440×900` 与移动横屏 `844×390` 均无裁剪、列重叠或图标加载失败，console 无 warning/error。截图经实现 Agent 亲自查看；临时累计代码随后删除，最终干净 production build 重建通过，页面、服务、截图和日志均已清理，只剩 `about:blank`。
- 2026-08-24：Reviewer Round 1 后，checkpoint 改为 `source -> target -> [rifle, smg, shotgun, sniper, grenade]` 固定槽压缩表示，运行时和网络展示仍使用可读的稀疏 cause map。10 真人 × 每人 49 目标 × 5 cause 的最大合法 fixture 从 114,015B 降至 90,495B，通过既有 100KB checkpoint 门禁；恢复时再解包，不增加常规 snapshot 字节。actor source/target 校验改为 `Object.hasOwn`，`constructor` 原型键回归由失败转为通过。
- 2026-08-24：Round 1 修复后完整三套 typecheck、MatchRuntime 31/31、Worker 52/52、standalone 33/33 通过；Worker/server 重建和预算通过，当前原始产物分别为 `634,015 / 635,000` 与 `644,065 / 645,000`。
- 2026-08-24：Re-review 1 后为每个 source/target/cause 总值增加 `999999` 权威上限，记录时封顶、恢复时拒绝更大值；固定五槽数组逐索引要求 own property，拒绝 sparse hole。最大 2,450 槽全部取上限时 checkpoint 为 97,845B，继续通过 100KB 门禁；新增累计封顶、`Number.MAX_VALUE`、sparse array 和显式 `[rifle, smg, shotgun, sniper, grenade.frag]` ABI 顺序回归。
- 2026-08-24：第二轮修复后完整三套 typecheck、GameSimulation + MatchRuntime 65/65、browser/Worker/server build 和预算通过。最终原始产物为 browser entry `1,175,440 / 1,200,000`、Worker `634,385 / 636,000`、standalone `644,435 / 646,000`；独立资源复审批准 636KB/646KB，其他预算和 15% runtime gate 不变。
- 2026-08-24：Re-review 2 后把累计持久化精度固定为一位小数：运行时封顶 `99999`，checkpoint 五槽保存放大 10 倍的安全整数并拒绝小数，彻底消除长小数字符串突破体积门禁的路径。定向 65/65、三套 typecheck、browser/Worker/server build 与 budgets 通过；最终 browser entry `1,175,459 / 1,200,000`、Worker `634,589 / 636,000`、standalone `644,639 / 646,000`。
- 2026-08-24：提交前最终验证使用 Node 24。完整 unit 51 files / 622 tests 中 620 项一次通过，只有两个未修改 `townMapLayout` 用例在全套高负载下超过既有 5 秒墙钟；保持测试和 timeout 不变后，两项按原配置隔离重跑分别约 1.32 秒和 2.34 秒通过。standalone 3 files / 33 tests 通过；Worker 与 standalone 并行时 51/52 通过，唯一未修改大厅用例出现瞬态 `room is not initialized`，随后 Worker 单独完整重跑 4 files / 52 tests 全部通过。
- 2026-08-24：最终完整三套 typecheck、browser build、Worker dry-run、server build、same-origin standalone build、恢复后的普通 browser build、budgets 和 `git diff --check` 通过。最终产物保持 browser entry `1,175,459 / 1,200,000`、all JavaScript `3,858,230 / 4,000,000`、CSS `45,759 / 50,000`、dist `4,681,929 / 5,000,000`、Worker `634,589 / 636,000`、standalone `644,639 / 646,000`。

## Review

- 2026-08-24：独立资源审查未发现 blocker/high/medium，也未发现超过 15% 的性能风险；批准 Worker/standalone 预算分别调整到 635KB/645KB。记录 1 项 Low：standalone 真实重连只断言空 ledger，非空恢复由 `MatchRuntime` checkpoint/projection 单元回归覆盖。
- 独立 `code-reviewer` 已在 Re-review 3 批准；无未解决 blocker/high/medium Finding。

### Round 1

- Review 时间：2026-08-24。
- 审查范围：当前分支 `feat/tab-damage-breakdown` 相对 `origin/main`（共同基线 `f3f50e2`）的完整未提交改动，并补读未跟踪的 `src/game/DamageTotals.ts`；对照本 Plan、用户原始需求、`AGENTS.md` 和 `README.md`。
- 审查结论：**不通过**。无 blocker/high；存在 2 项 Medium 和 1 项 Low。
- Medium：`tests/unit/matchRuntime.test.ts:921-993` 的既有 `100,000B` checkpoint 边界仍只测空 `damageTotals`，没有覆盖本次新增的主要可增长字段。只读定向量测表明，当前校验器接受的 10 个真人来源 × 每人 49 个目标 × 5 个 cause 的 2,450 条累计会使 checkpoint 从 `76,826B` 增至 `123,015B`，已超过现有边界 23%。Builder 需用非空高水位 ledger 覆盖并收敛序列化/持久化大小，或提供经过批准的新边界依据；不能继续用空 ledger 宣称 hot checkpoint 有界。
- Medium：`src/server/MatchRuntime.ts:445-447` 用 `actors[targetId]` 判断目标存在，会把 `constructor` 等继承自 `Object.prototype` 的名字误判为现有 actor。定向构造的 `human-1 -> constructor -> rifle: 10` checkpoint 在 `Object.hasOwn(state.actors, "constructor") === false` 时仍被 `isMatchCheckpointCompatible` 接受，违反严格目标校验合同。Builder 需改为 own-key 校验并补畸形 checkpoint 回归。
- Low：`tests/standalone/standaloneServer.test.ts:188-242` 的真实 WebSocket 重连/进程重启仍只验证空 ledger；非空恢复、viewer 私有 full、snapshot 合并目前由分层单测和静态调用链间接证明，尚无真实非空端到端证据。建议在修复本轮 Medium 时一并补齐。
- 性能与最小改动：权威热路径只对真人正伤害做 O(contribution) 累计，变化集按 key 合并；viewer 过滤最多放大到 10 个连接，HUD 仅在排行榜可见时按 10Hz 扫描 50 个 actor 和当前玩家稀疏记录，未见常态运行时超过 15% 的明确风险。新增 tracker、full/delta、checkpoint 和 HUD 结构均可追溯到当前需求，未见无关业务改动或禁止的 `context.Background()`；除上述 checkpoint 高频复制/持久化高水位外，没有明显可删除抽象或额外调用放大。
- 已参考验证：沿用 Build 中完整 typecheck、620/52/33 tests、2 项 performance contract、全部 builds、最终 budgets 和静音 production Chrome 桌面/移动验收；Reviewer 未重复这些命令。额外只执行 `git diff --check origin/main` 和两次只读定向 checkpoint 量测。
- 待处理：以上 2 项 Medium 必须由 Builder 修复并重新请求 Review；Low 为验证缺口，若不补需在后续记录中给出明确风险接受依据。

### Round 1 Builder Disposition

- Medium 1：确认成立并已修复。checkpoint 不再重复 cause 字符串，改用版本 15 固定顺序的五项数值数组；新增最大合法真人 ledger 回归，序列化大小为 90,495B，低于既有 100,000B 门禁。普通 frame/full 投影格式未改变。
- Medium 2：确认成立并已修复。source 和 target 均要求是 `actors` 的 own key；新增 `constructor` 目标回归，旧实现复现为错误接受，修复后拒绝。
- Low：暂不扩展真实 standalone 对局以人工制造非空伤害；现有真实 WebSocket 重连/进程重启覆盖 full 字段，`MatchRuntime` 覆盖非空 checkpoint pack/unpack、恢复、viewer 私有 full 和 delta。该缺口保留为低风险，不阻止本轮复审。
- 修复验证：完整三套 typecheck、MatchRuntime 31/31、Worker 52/52、standalone 33/33、Worker/server build 和预算通过；等待独立 Re-review。

### Re-review 1

- Review 时间：2026-08-24。
- 审查范围：重新对照本 Plan、Round 1 Builder Disposition、用户原始需求及 `origin/main@f3f50e2`，复审当前完整未提交 diff，重点检查固定五 cause checkpoint pack/unpack、高水位、own-key、恢复、viewer 隐私与调用放大。
- 审查结论：**不通过**。上一轮 own-key Medium 已闭环；checkpoint 高水位 Medium 尚未彻底闭环，并新增 1 项严格数组校验 Medium。
- Medium：`tests/unit/matchRuntime.test.ts:357-375` 把每个 cause 固定为 `999` 后称为“maximum valid”，但 `src/server/MatchRuntime.ts:458-459` 仍接受任意正有限数值，`packDamageTotals` 也原样序列化。只读定向构造的相同 2,450 槽 ledger 使用 `Number.MAX_VALUE` 时仍通过 `isMatchCheckpointCompatible`，checkpoint 为 `139,495B`，继续超过 `100,000B` 门禁。Builder 需让门禁覆盖全部被兼容校验接受的数据，或建立并验证有依据的累计上限；当前 `90,495B` 只能证明三位数 fixture。
- Medium：`src/server/MatchRuntime.ts:456-459` 以 `length`、`every`、`some` 校验固定数组，但 JavaScript 的 `every`/`some` 会跳过空洞。`new Array(5)` 仅设置索引 0 为 10 时只有一个 own slot，却仍通过兼容校验，并由 `unpackDamageTotals` 把缺失四槽默认为 0，违反缺失/部分 checkpoint 必须拒绝的严格合同。Builder 需校验五个索引均为 own 数值槽并补回归。
- 已闭环：source/target 都在访问 actor 前使用 `Object.hasOwn`；`constructor` 目标回归直接构造原型键并确认拒绝，未见其他 source/target 原型穿透路径。
- pack/unpack、隐私与性能：固定顺序当前由同一 `DAMAGE_CAUSE_IDS` 同时驱动 pack/unpack，正常恢复不丢 cause；压缩只作用于 checkpoint，`match.full`/delta 继续使用可读稀疏 map，viewer 投影仍只保留当前来源，未引入隐私扩散。pack 为每个稀疏 source/target 固定读取 5 槽，checkpoint 1Hz 最多约 2,450 次读取；unpack 仅恢复时执行，未见常态运行时超过 15% 或 snapshot 调用放大风险。
- Low/残余风险：真实 standalone 非空 ledger 重连仍未直接覆盖，沿用 Round 1 已接受的分层证据；此外固定数组顺序尚未在长期架构文档中明确写出，现有 round-trip 测试的 pack/unpack 共用同一常量，不能锁住版本 15 的索引 ABI。`docs/architecture.md` 记录的 `5,175B/4,955B` 增量与“约 2KB”余量也已落后于当前 `634,015/644,065`、不足 1KB 的最终产物事实，Writer 应同步修正。
- 已参考验证：沿用 Builder 记录的 MatchRuntime 31/31、三套 typecheck、Worker 52/52、standalone 33/33、Worker/server build 与 budgets；Reviewer 未重复这些命令，仅执行静态 diff、`git diff --check` 和一次针对上述两个明确风险的只读定向构造。
- 待处理：以上 2 项 Medium 需由 Builder 修复并再次请求 Re-review；文档数值和固定 cause 顺序由 Writer 同步，既有 standalone Low 可继续作为明确残余风险保留。

### Re-review 1 Builder Disposition

- Medium 1：确认成立并已修复。`MAX_DAMAGE_TOTAL = 999999` 同时约束权威累计和 checkpoint 校验；最大 10 真人 × 49 目标 × 5 cause 全部取上限的 checkpoint 为 97,845B，覆盖所有兼容数据并通过 100KB 门禁。
- Medium 2：确认成立并已修复。恢复校验逐个检查五个数组索引均为 own property、有限非负且不超过上限，并要求至少一项正值；稀疏数组 fixture 现在拒绝。
- Low 文档：`AGENTS.md`、`docs/architecture.md` 和 `docs/deployment.md` 已明确版本 15 固定 `[rifle, smg, shotgun, sniper, grenade.frag]` 顺序、own slot 和 `0..999999` 合同；测试直接断言固定 ABI 及具体 packed 数组，不只做同常量 round-trip。
- 资源事实：严格校验后的最终 Worker/server 相对 main 增长 6,534B/6,218B（1.04%/0.97%）。独立资源复审批准预算最小调整到 636KB/646KB，当前余量 1,615B/1,565B，其他预算和 15% runtime gate 不变。
- 修复验证：完整三套 typecheck、GameSimulation + MatchRuntime 65/65、browser/Worker/server build 和 budgets 通过；等待下一轮独立 Re-review。

### Re-review 2 Builder Disposition

- Medium：确认成立并已修复。运行时累计统一四舍五入到一位小数并封顶 `99999`；checkpoint 只接受 `0..999990` 安全整数，pack 放大 10 倍、unpack 除以 10。任意长小数不再属于兼容数据，最大合法 2,450 槽仍为 97,845B。
- 回归：新增小数 checkpoint 拒绝，ABI packed fixture 明确断言 `34 -> 340`、`22.3 -> 223`、`140 -> 1400`；累计封顶回归继续通过。
- 文档：`AGENTS.md`、架构和部署文档同步记录一位小数、`99999` 上限与放大 10 倍整数持久化合同；最终资源数据同步为 Worker `634,589 / 636,000`、server `644,639 / 646,000`，相对 main 约 `1.07%/1.01%`，15% runtime gate 不变。
- 验证：GameSimulation + MatchRuntime 65/65、完整三套 typecheck、browser/Worker/server build 和 budgets 通过；等待下一轮独立 Re-review。

### Re-review 2

- Review 时间：2026-08-24。
- 审查范围：重新对照 Re-review 1 Builder Disposition、用户原始需求及 `origin/main@f3f50e2` 复审完整未提交 diff，重点检查累计上限、固定五槽 ABI、strict checkpoint、高水位、恢复、viewer 隐私和性能。
- 审查结论：**不通过**。own-key、固定 ABI 和 sparse-hole Medium 已闭环；100KB checkpoint 高水位仍有 1 项 Medium 未闭环。
- Medium：`MAX_DAMAGE_TOTAL = 999999` 只限制数值大小，不能限制 JSON 数字的文本长度。`tests/unit/matchRuntime.test.ts:369-390` 用六位整数上限填充，因此得到 `97,845B`，但 `src/server/MatchRuntime.ts:463-469` 仍允许有较长小数表示的有限值。只读定向构造将同一 2,450 槽填为 `123456.78901234567`，checkpoint 仍被 `isMatchCheckpointCompatible` 接受，实际为 `127,245B`。Builder 需让 100KB 门禁覆盖所有兼容数值表示，而不只是整数上限 fixture。
- 已闭环：source/target 使用 `Object.hasOwn`；五个数组索引逐项要求 own property、有限非负、`<= 999999` 且至少一项正值，sparse-hole 不能再穿透；测试直接锁定 `[rifle, smg, shotgun, sniper, grenade.frag]` 和 `[34, 0, 0, 0, 140]`，长期文档与当前 ABI、资源增量和预算一致。
- 恢复与隐私：pack/unpack 共用已锁定顺序，合法非空 checkpoint 恢复为可读 cause map；压缩表示不进入 `match.full`/snapshot。full 和 delta 仍只投影当前来源，未发现跨玩家泄漏或重复累计路径。只读高水位 full 构造为 `31,090B`，仍低于既有 `50,000B` 边界。
- 性能与最小改动：记录路径仅增加常数级 `Math.min`；checkpoint 1Hz 最多扫描 490 个 source/target 对和 2,450 槽，unpack 仅恢复时执行，snapshot 格式与工作量不变。结合独立资源复审的 1.04%/0.97% 增量，未见常态运行时超过 15% 或明显可删除抽象；阻塞点仅为兼容校验允许的长小数仍可突破 checkpoint 硬门禁。
- Low/残余风险：真实 standalone 非空 ledger 重连仍未直接覆盖，继续沿用 MatchRuntime pack/unpack、viewer projection 与真实空 ledger 重连的分层证据。
- 已参考验证：沿用 Builder 记录的三套 typecheck、GameSimulation + MatchRuntime 65/65、browser/Worker/server builds、budgets 和独立资源复审；Reviewer 未重复外层验证，仅执行静态 diff、`git diff --check` 及两个针对 checkpoint/full 字节边界的只读定向构造。
- 待处理：Builder 需闭环上述长小数 checkpoint Medium 后再次请求 Re-review；既有 standalone Low 可继续作为明确残余风险保留。

### Re-review 3

- Review 时间：2026-08-24。
- 审查范围：对照 Re-review 2 Builder Disposition、用户原始需求与 `origin/main@f3f50e2` 复审当前完整未提交 diff，重点检查一位小数累计、放大 10 倍持久化、固定五槽 ABI、strict checkpoint、100KB 高水位、恢复、隐私和性能。
- 审查结论：**通过；本次审查未发现新的 blocker、high 或 medium Finding，批准进入提交/MR 流程。** 此前全部 Medium 已闭环。
- 闭环确认：运行时总值每次记录后四舍五入到一位小数并封顶 `99999`；pack 只输出放大 10 倍的整数，unpack 对称除以 10。checkpoint 逐槽要求 own property、安全非负整数、`<= 999990` 且至少一项正值，长小数、超限、负数和 sparse-hole 均不兼容；source/target own-key 与非自伤约束保持完整。
- ABI 与高水位：测试直接锁定 `[rifle, smg, shotgun, sniper, grenade.frag]` 以及 `34 -> 340`、`22.3 -> 223`、`140 -> 1400`，不再只依赖同常量 round-trip。10 真人 × 49 目标 × 5 槽全部取合法最大整数时 checkpoint 为 `97,845B`，覆盖当前校验器允许的最大数值文本宽度并低于 `100,000B` 门禁。
- 恢复与隐私：checkpoint 压缩只存在于持久化边界，恢复后继续使用可读稀疏 cause map；`match.full` 和 delta 格式未改变，viewer 仍只接收自身来源记录，frame coalescing 继续按 source/target/cause 保留最新累计，未见泄漏、错位或重复累计。
- 性能与最小改动：真人贡献热路径只新增常数级舍入/封顶；1Hz checkpoint 最多扫描 490 个 source/target 对和 2,450 固定槽，unpack 仅恢复时执行，HUD 与 snapshot 工作量未放大。Worker/server 相对 main 增量 `1.07%/1.01%` 已获独立资源复审批准，当前预算余量分别 `1,411B/1,361B`；未见超过 15% 的风险、无关业务改动、可删除抽象或禁止的 `context.Background()`。
- Low/残余风险：真实 standalone 非空 ledger 重连仍未直接覆盖；现有真实空 ledger 重连与 MatchRuntime 非空 pack/unpack、恢复、viewer projection 的分层证据足以支持本轮批准，但后续可补端到端回归。
- 已参考验证：沿用 Builder 记录的三套 typecheck、GameSimulation + MatchRuntime 65/65、browser/Worker/server builds、budgets 和独立资源复审；Reviewer 未重复外层验证，仅完成静态 diff、合同和现有证据复核。
