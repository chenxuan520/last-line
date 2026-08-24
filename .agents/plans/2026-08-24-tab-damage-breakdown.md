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

### Round 2 Follow-up

#### Goal

在同一排行榜角色行中增加“该角色对我”的累计原始伤害，并与既有“我对该角色”伤害组成无文字标题的左右双向对照。

#### Contract

- 继续直接在 `main` 上完成并复用本 Plan；排行榜排序、排名、角色名、存活状态和击杀数保持不变。
- 左半区显示当前玩家对该角色的“武器图标 + 累计原始伤害”，右半区显示该角色对当前玩家的相同信息；伤害仍使用既有减免前权威定义和稳定武器顺序。
- 双向伤害区域使用固定中线竖分隔；任一侧存在记录时都显示完整左右区域和分隔线，仅两侧均无记录时完全不渲染伤害区域。
- 左右半区各自保持单行并独立在边界内以 `…` 截断，任何一侧都不得挤占另一侧、状态列或击杀列。
- 统计绑定稳定角色身份，不依赖角色类型或当前控制器类型：真人、Bot 和真人角色被 AI 接管期间产生的全部有效伤害都按 `sourceId -> targetId -> causeId` 记录，包括 Bot 对 Bot；客户端只展示与当前玩家相连的双向关系。
- 联机 full/delta 只向 viewer 发送 `sourceId === viewerId` 或 `targetId === viewerId` 的关系，禁止泄露其他角色之间的伤害矩阵；重连和 checkpoint 恢复后双向累计都必须保留。
- 完整 50 人有向统计最多存在 2,450 个 source/target 对和 12,250 个固定 cause 槽。继续使用可严格校验的固定五槽 checkpoint 表示并提升 checkpoint 版本；标准 50 角色最大矩阵与完整合法背包/双武器高水位状态叠加后实测 `208,975B`，因此将这一确定性标准组合门禁有依据地调整为 `220,000B`。合法额外动态物资仍可增加 checkpoint 大小，不把该门禁描述为所有兼容状态的绝对上界。
- 现有协议字段形状不变，旧客户端会安全忽略新增的入站投影，因此不提升联机协议版本。

#### Tasks

1. 先补单个失败回归，锁定 Bot 入站、Bot 对 Bot、AI takeover 出站、双向 viewer 投影、checkpoint 恢复和 HUD 双向读取。
2. 扩展 `DamageTotalsTracker`，记录所有角色之间的非自伤有效贡献，并移除角色类型和控制器类型对归属的影响。
3. 保持固定五槽 checkpoint 编码和严格数值校验，允许任意现有非自身角色作为来源/目标，提升版本并把标准 50 角色最大有向矩阵与完整合法装备状态的确定性组合锁在 `220,000B` 新门禁内。
4. 在角色名后渲染固定中线的左右伤害半区，分别独立省略，并让排行榜签名同时响应本地出站和入站变化。
5. 按本机单用例规则执行定向测试，并完成 typecheck、相关 build/budget、静音 production 浏览器验收和独立 Reviewer。
6. Reviewer 闭环后提交并推送 `main`，等待 CI、Pages、Worker 和必要 production smoke 全部成功。

#### Success Criteria

- Bot 或其他真人角色伤害当前玩家时，记录显示在来源角色行右半区；当前玩家伤害该角色时仍显示在同一行左半区。
- 真人角色由 AI 接管期间造成的伤害按角色身份累计；Bot 对 Bot 同样保存在完整权威矩阵中，自伤、安全区、miss、遮挡和零伤害仍不统计。
- 仅左侧或仅右侧有记录时仍显示中线和空的另一半；两侧都为空时不创建伤害区域。
- 多武器内容在各自半区内单行省略，不改变状态/击杀列，不产生横向溢出或重叠。
- 联机只投影与 viewer 相连的双向关系；标准 50 角色最大矩阵与完整合法装备状态的确定性组合不超过有依据的新 `220,000B` 门禁，恢复后数值、方向和 cause 不变。

### Round 3 Follow-up

#### Goal

在排行榜顶部补齐列标题，并用角色名称颜色直接标识当前玩家击杀与被击杀关系。

#### Contract

- 排行榜现有 4 列 `排名 / 角色与伤害 / 状态 / 击杀` 完全不变，不新增数据列，也不新增其他列名；只在内容区最顶端为角色列内部已有的两个伤害半区增加 `造成伤害 | 受到伤害`，并与行内固定中线严格对齐。
- 当前玩家击杀的角色名称显示红色；击杀当前玩家的角色名称显示青蓝色。
- 极少数同一角色同时满足两种关系时，青蓝色的“击杀我的角色”样式优先。
- 当前玩家自身、圈伤淘汰、自伤淘汰以及无击杀关系的角色名称保持现有样式；排行榜排序和伤害统计不变。
- 本轮仅使用 `GameHud` 当前会话已经收到的权威 `actor-died` 事件着色，不新增权威状态、协议字段或 checkpoint 数据。

#### Tasks

1. 添加一个精确回归，锁定红色受害者、青蓝色击杀者、青蓝色优先级和无关系默认样式。
2. 在 `GameHud` 处理既有 `actor-died` 事件时记录当前会话关系，并在排行榜名称上派生对应 class。
3. 不改变现有 4 列，只增加与角色列内双向伤害半区对齐的顶部 `造成伤害 | 受到伤害` 子标题。
4. 完成单用例验证、typecheck、build/budget、静音 production 浏览器验收和独立 Reviewer，再提交推送 `main` 并等待 CI/部署。

#### Success Criteria

- 当前玩家击杀目标后，目标行名称为红色；当前玩家被目标击杀后，目标行名称为青蓝色。
- 双重关系时只采用青蓝色优先样式；无关系名称不变。
- 两个伤害子标题与对应半区对齐，在桌面和移动横屏下无裁剪、换行或重叠；现有 4 列宽度和顺序不变。
- 不修改 `ActorState`、联机 full/snapshot、协议版本或 checkpoint 版本。

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
- 2026-08-24：合并后的 GitHub main CI、performance、Docker smoke、GitHub Pages 和 Cloudflare Pages 均成功；Codex 对 `224d1cb` 未发现 major issue。Cloudflare Workers Build `fa3420fa-a93b-40db-b871-2c57d63274bb` 标红，但版本/部署历史证明它已于 05:46:08 创建并部署 `9256c30b-ba98-4048-947a-4abd045a6a39`；随后完整 fallback 部署 `39123e1a-fbf3-4f53-98ae-3fda532f0ab1` 并通过 protocol 16 production smoke。当前 OAuth token 缺少 Workers Builds Configuration 权限，Build logs API 返回 403；结合已部署版本、失败时间和历史同类记录，失败与单次新 `/health` marker 后有副作用 smoke 仍命中旧边缘版本的传播竞态一致，不是构建或部署失败。
- 2026-08-24：CI follow-up 先新增连续稳定回归，旧实现 3 项按预期失败，证明第一次匹配协议即返回。`waitForProductionProtocol` 现要求连续 5 次预期协议；旧版本、缺失 marker、transport 和 502/503/504 都清零计数，仍共享 120 秒总上限，稳定后仍只创建 1 个 smoke 房间且不重试任何有副作用阶段。定向 readiness 10/10 与三套 typecheck 通过。
- 2026-08-24：本机误启动完整 suite 后出现多个未修改地图测试的高负载 timeout，并由用户终止；检查确认本项目无残留 Vitest/Node/workerd 进程。按用户要求，`AGENTS.md` 与完成检查表已改为本机每次只运行单个测试名过滤用例，完整 unit/Worker/standalone suite 只由 CI 执行。本 follow-up 不再本机复跑全套。
- 2026-08-25：Round 2 先把 AI takeover、Bot 入站和 Bot 对 Bot 归属合并为一个精确回归；旧实现因 `aiControlled`/`kind` 过滤按预期得到 `undefined`，实现改为稳定角色 ID 归属后通过。Bot 对 Bot 累计进入完整 ledger，但不进入任何真人 viewer 的 frame change 集。
- 2026-08-25：`projectDamageTotals` 和普通 frame 现只保留 `sourceId === viewerId || targetId === viewerId` 的双向关系。checkpoint 提升至 16，恢复校验允许任意现有非自身角色作为来源/目标；联机协议字段形状保持版本 16 不变。单个精确用例分别验证 checkpoint 16、真人双向投影、HUD 双向 helper/signature，均通过；完整 suite 留给 CI。
- 2026-08-25：完整 50 人矩阵包含 2,450 个有向关系和 12,250 个固定 cause 槽。标准最大矩阵与每名角色双武器、6 个合法满 stack、二级护甲/头盔和使用中物品组合后，checkpoint 兼容校验通过且序列化为 `208,975B`；该确定性标准组合门禁为 `220,000B`，不覆盖允许额外动态物资的任意兼容状态。单个高水位测试通过；最大 viewer 双向 full 包含 98 个关系，量测为 `35,795B`，继续低于既有 `50,000B` full 门禁。
- 2026-08-25：排行榜角色区仅在任一方向有记录时创建固定三列伤害区：左侧出站、中间 1px 分隔线、右侧入站。两侧分别使用单行 `text-overflow: ellipsis`，不互相挤占；两侧均空时不生成区域。排行榜 signature 只响应与当前玩家相连的双向变化，Bot 对 Bot 等无关矩阵变化不重建 DOM。
- 2026-08-25：三套 typecheck 通过；`npm run build`、Worker dry-run、server、same-origin standalone、恢复普通 production build 和 budgets 通过。最终原始产物为 browser entry `1,175,858 / 1,200,000`、Worker `634,655 / 636,000`、standalone `644,705 / 646,000`，未调整任何产物预算。
- 2026-08-25：实现 Agent 在音量 `0` 的 production build 中通过真实 `GameHud` 临时注入并检查双侧长内容、仅左和仅右三种行态。桌面 `1440×900` 中每侧约 138.7px，移动横屏 `844×390` 中每侧约 116.1px；长内容均显示 `…`，中线固定，状态/击杀列不重叠，body 无横向溢出，console 无 warning/error。截图已亲自打开检查字体、颜色、间距、对齐、裁剪和相邻行；临时注入、截图、日志、页面和 preview 服务均已清理，最终干净 production build 已重建。
- 2026-08-25：Round 3 严格限制为 HUD 表现。`GameHud` 使用当前会话已收到的既有 `actor-died` 事件维护玩家受害者集合和击杀玩家的角色 ID；名称 class 由纯 helper 决定，青蓝色击杀者优先于红色受害者。未修改 `ActorState`、权威伤害/死亡、联机协议、checkpoint 或服务端代码。
- 2026-08-25：排行榜仍保持每行 4 个直接 grid 子节点和原 `54px / 1fr / 100px / 90px` 四列；只在内容顶部为角色列内部既有左右伤害半区增加 `造成伤害 | 受到伤害`，没有增加数据列。行高、排序、状态和击杀列保持不变，列表最大高度扣除 23px 标题高度以维持原面板边界。
- 2026-08-25：名称优先级精确用例先因 helper 不存在失败，完成后 1/1 通过；三套 typecheck、最终 production build 和 budgets 通过。最终 browser entry `1,176,690 / 1,200,000`、CSS `46,813 / 50,000`、dist `4,684,214 / 5,000,000`；Worker/standalone 未受本轮代码影响。
- 2026-08-25：实现 Agent 在音量 `0` 的 production build 中检查桌面 `1440×900` 和移动横屏 `844×390`。每个数据行仍恰好 4 个直接子节点；两个 10px 橄榄色标题分别与约 138.7px/116.1px 的左右伤害半区及 1px 中线精确对齐。青蓝色 `rgb(85, 203, 220)` 在双重关系时生效，红色 `rgb(237, 102, 89)` 在淘汰划线名称上保持可见，无关系名称保持原白色；状态/击杀无重叠，body 无横向溢出，console 无 warning/error。截图已亲自打开检查，临时注入、截图、日志、页面和 preview 服务均已清理，最终干净 build 已重建。

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

### CI Follow-up Review Round 1

- Review 时间：2026-08-24。
- 审查结论：不通过；无 blocker/high，存在 1 项 Medium 和 1 项 Low。
- Medium：`AGENTS.md` 已要求本机每次只运行一个测试名过滤用例，但 README 仍把 `npm run test`、`test:performance` 和 `test:coverage` 列为普通开发验证命令，且“本机自动化验证”措辞可能误伤 typecheck/build/smoke，长期规则存在冲突。
- Low：连续 5 次稳定要求被暴露为无人使用的 `requiredConsecutiveMatches` 选项，未来可传入 0、负数或 1 绕过固定合同。
- 其余结论：旧/缺失 marker、transport 和 502/503/504 的连续计数重置正确，120 秒总界保持；稳定后仍只执行一次 guest/room/WebSocket/leave 链。性能只增加 4 次 `/health` 和约 8 秒部署等待，无产品运行时影响。

### CI Follow-up Builder Disposition

- Medium：已修复。`AGENTS.md` 将规则限定为“本机测试执行”，明确不限制 typecheck/build/budget/部署 smoke；常用命令区和 README 同步标注完整 `npm run test`、完整文件/suite、performance/coverage 只由 CI 执行，本机示例只保留测试名过滤的单用例。
- Low：已修复。删除 `requiredConsecutiveMatches` 选项，生产就绪门禁只能使用固定连续 5 次合同。
- 验证：只按新规则运行一个“新版本后命中旧 edge 会重新累计”的定向用例，1/1 通过；完整三套 typecheck 通过，`git diff --check` 通过。等待独立 Re-review；完整测试由 push 后 CI 执行。

### CI Follow-up Re-review

- Review 时间：2026-08-24。
- 审查结论：通过；未发现 blocker、high、medium 或 low Finding，批准提交 `main`。
- Reviewer 确认固定连续 5 次不可配置覆盖，全部允许重试的旧/缺失 marker、transport 和 gateway 失败都会重置计数，120 秒总界与唯一一次副作用 smoke 保持；本机单用例/CI 完整 suite 规则在 AGENTS 和 README 中一致。
- 性能结论：只增加 4 次无副作用健康检查和约 8 秒部署等待，无产品运行时影响或明显优化空间。Reviewer 未重复外层测试、typecheck 或构建。

### Round 2 Review

- Review 时间：2026-08-25。
- 审查范围：当前 `main@2aa12a8` 相对 `origin/main@2aa12a8` 的完整未提交 diff；对照本 Plan 的 `Round 2 Follow-up`、用户原始双向伤害要求、`AGENTS.md`、`README.md` 及 Build 记录，静态追踪枪械/手雷累计、viewer full/delta、客户端 coalescing、checkpoint 16、HUD 与性能路径。Reviewer 未重复外层测试、typecheck、build、budget 或浏览器命令。
- 审查结论：**不通过**。无 blocker/high；存在 3 项 Medium 和 1 项 Low。
- Medium：`tests/unit/matchRuntime.test.ts:380-415` 的 `220000B` 用例不是当前兼容校验器所接受数据的真实高水位。`src/server/MatchRuntime.ts:547-570` 不限制 `maxBackpackStacks` 为权威值 6，允许任意数量的合法重复 stack；`src/server/MatchRuntime.ts:583-606` 还允许任意数量的额外 loot。因此可构造通过 `isMatchCheckpointCompatible`、却任意超过 220000B 的版本 16 checkpoint，文档所称“硬门禁”不能成立。Builder 必须收紧可恢复状态边界并覆盖全部兼容数据，或明确缩窄并更名该预算合同，不能继续称当前 fixture 为最大合法 checkpoint；Writer 随实现同步修正文档数值/措辞。
- Medium：`src/client/ui/GameHud.ts:763-770` 在排行榜可见时每 100ms 用嵌套 `Object.entries(...).flatMap(...)` 扫描完整 damage matrix，单机路径又由 `src/app/BattleRoyaleSession.ts:274-288` 直接传入包含 Bot→Bot 的完整 ledger。最大情况下每次扫描 2,450 个 relation 并分配各层中间数组，其中最多 2,352 条与 viewer 无关，违反 Plan 中只读取当前玩家相关记录的性能合同。Builder 应直接读取 `damageTotals[playerId]`，并仅对各 source 做 `targets[playerId]` 查询，使签名工作量与 50 个 source 加 98 条 viewer 关系相关，而不是与完整矩阵相关。
- Medium：本轮把伤害记录从非 AI 真人扩展到全部 Bot 命中，并把 1Hz checkpoint pack 从最多 490 个关系/2,450 槽扩大到 2,450 个关系/12,250 槽，记录的最大序列化体积也从不足 100KB 增至 208,975B；但 Build 只有功能、构建和产物预算证据，现有 `tests/performance/runtimePerformance.test.ts` 也不覆盖伤害热路径或 populated checkpoint。按仓库 15% 性能规则，当前不足以排除 Bot 战斗、同步 checkpoint clone/pack、存储 I/O 与 GC 的明显回归。Builder 需提供同条件 main/head 的伤害密集运行与高水位 checkpoint 时间/分配证据，或先简化实现后重新验证。
- Low：`src/game/systems/CombatSystem.ts:44-50,213-220` 和 `src/game/systems/ThrowableSystem.ts:27-32,144-150` 在移除 AI 过滤后仍把 `aiControlled` 复制进每个 pending damage 对象，但后续已无读取；这是本轮直接产生的热路径冗余字段，应删除以满足最小改动和分配要求。
- 已确认项：枪械、霰弹 pellet、手雷 owner、Bot→真人、Bot→Bot 与 AI takeover 均按稳定 actor ID 在实际扣血前累计；自伤、圈伤、miss、遮挡和非正伤害未进入 ledger。`projectDamageTotals`、frame filter、绝对累计 coalescing 和重连 full 的方向及 viewer 隔离未见功能错误；checkpoint 版本、五槽 ABI、own-key 和数值校验保持一致；HUD 的任一侧有值即创建等宽左右区与 1px 中线、两侧独立 ellipsis、均空不建区域符合需求。
- 残余风险：真实 Worker/standalone 非空双向 ledger 重连仍缺端到端证据；现有 standalone 用例只断言空 `damageTotals`。业务改动未出现 `context.Background()`，也未发现与需求无关的历史语义修改或新增不必要文件/抽象。
- 待处理：以上 3 项 Medium 必须由 Builder 闭环并重新请求 Review；Low 应随热路径性能收敛一并处理。Writer 需在 checkpoint 边界确定后同步 `AGENTS.md`、架构和部署文档。

### Round 2 Builder Disposition

- Medium 1：确认门禁措辞有误，不改动与本需求无关的动态物资兼容边界。测试、Plan、`AGENTS.md`、架构和部署文档现统一把 `220,000B` 定义为“标准 50 角色 + 完整合法装备 + 最大伤害矩阵”的确定性组合门禁；额外合法动态物资仍允许存在且明确不属于该固定 fixture，禁止再称其为所有兼容 checkpoint 的绝对上界。
- Medium 2：已修复。排行榜签名不再嵌套扫描完整矩阵；只遍历 `damageTotals[playerId]` 的最多 49 个出站目标，再对最多 50 个 source 做一次 `targets[playerId]` 入站查询。最大相关关系为 98，Bot 对 Bot 矩阵不进入 HUD 扫描或中间数组；原精确 signature 用例继续通过。
- Medium 3：已补同一 Node 24 环境、同一进程、交替 9 轮 main/head 定向量测。标准高水位 checkpoint 在 `main` 为版本 15、490 个关系、`118,295B`、创建并 JSON 序列化中位数 `1.076ms`；HEAD 为版本 16、2,450 个关系、`208,975B`、`1.945ms`。相对增长约 80.7%，但绝对新增 `0.869ms` 且只在 1Hz checkpoint 执行；这是用户明确批准的完整矩阵/存储取舍。伤害累计微基准中位数由每贡献 `0.0217µs` 增至 `0.0699µs`，绝对增加约 `0.0482µs`；即使每秒 1,000 个贡献，新增 CPU 约 `0.048ms/s`。证据明确保留相对退化，不以其他指标掩盖，等待 Reviewer 判断该架构/资源调整是否可接受。
- Low：已修复。`CombatSystem.PendingDamage` 和 `ThrowableSystem.PendingExplosionDamage` 不再复制无人读取的 `aiControlled` 字段；活动手雷自身的 AI 来源字段仍按玩法/并发/checkpoint 合同保留。
- 修复验证：三个单个精确用例分别覆盖角色身份归属、viewer 相关 signature 和标准组合 checkpoint，均通过；三套 typecheck、Worker dry-run、same-origin standalone、server、恢复普通 production build 和 budgets 通过。最终 browser entry `1,175,903 / 1,200,000`、Worker `634,585 / 636,000`、standalone `644,635 / 646,000`。浏览器可见结构与样式未在本轮修复中改变，沿用已完成的静音桌面/移动横屏验收。

### Round 2 Re-review

- Review 时间：2026-08-25。
- 审查范围：重新完整阅读本 Plan 与 `Round 2 Builder Disposition`，以当前 `main@2aa12a8`、`origin/main@2aa12a8` 为基线复审完整未提交 diff，重点核对上一轮 3 项 Medium、1 项 Low，以及功能、viewer 隐私、checkpoint 16、性能、最小改动和长期文档。Reviewer 未重复外层测试、typecheck、build、budget 或浏览器命令。
- 审查结论：**通过；本次审查未发现 blocker、high、medium 或新的 low Finding，批准提交 `main`。** 上一轮 3 项 Medium 和 1 项 Low 均已闭环。
- Medium 1 闭环：Plan、测试名称、`AGENTS.md`、架构和部署文档均把 `220000B` 准确限定为“标准 50 角色完整合法装备状态 + 2,450 个有向关系/12,250 个固定槽最大矩阵”的确定性组合门禁，并明确额外合法动态物资可继续增加 checkpoint、且不属于该固定门禁；不再声称覆盖全部兼容 checkpoint。
- Medium 2 闭环：`createLeaderboardSignature` 只遍历 viewer 的最多 49 个出站目标，并对最多 50 个 source 各做一次 `targets[playerId]` 直接入站查询；不会展开其他 source 的 target map。最大处理 98 条 viewer 关系，Bot→Bot 矩阵不再进入 HUD 的关系扫描或中间数组。
- Medium 3 闭环：接受本轮有依据的架构/资源取舍。Node 24 同进程交替 9 轮证据保留了 checkpoint 相对退化：`1.076ms/118295B/490` 关系增至 `1.945ms/208975B/2450` 关系；绝对新增 `0.869ms` 且仅 1Hz 执行。每贡献新增约 `0.0482µs`，即使 1,000 contribution/s 也只增加约 `0.048ms/s`。结合确定性关系/字节上界、既有产物预算、viewer full `35795B` 和 10Hz 稀疏 delta，未见产品规则循环、网络或 HUD 存在超过 15% 的明确风险；checkpoint 相对增长是用户明确批准且文档化的完整矩阵持久化成本。
- Low 闭环：两个 pending damage 结构已删除无人读取的 `aiControlled`；`CombatSystem` 的 AI 参数仍只服务于必要的轨迹表现压缩，`ActiveGrenadeState.aiControlled` 仍服务于 AI 活动手雷并发上限及 checkpoint 合同，没有误删。
- 功能与隐私：枪械、逐 pellet 霰弹枪、按 owner 分账手雷、Bot、Bot→Bot、Bot→真人和 AI takeover 均按稳定 actor ID 在实际扣血前累计；自伤、圈伤、miss、遮挡和非正伤害继续排除。full/delta 只保留 `sourceId === viewerId || targetId === viewerId`，客户端绝对累计 coalescing 与 full 替换保持幂等，未见无关关系泄露。
- checkpoint 与 UI：版本 16、固定五槽 ABI、own-key、非自身 actor、整数范围、恢复方向保持一致。HUD 任一侧有记录即生成等宽左右区和 1px 中线，两侧独立单行省略，均空时不生成区域；签名只响应 viewer 相关变化。
- 最小改动：新增 tracker 范围、双向投影、checkpoint 版本、HUD/CSS、回归和文档均直接对应 Round 2；未见无关历史语义修改、新增不必要抽象/缓存/锁或剩余调用放大，业务代码未出现 `context.Background()`。
- 残余风险：真实 Worker/standalone 非空双向 ledger 重连仍未新增端到端 fixture，继续由真实空 ledger 重连与 MatchRuntime 非空 pack/unpack、full/delta 投影的分层证据覆盖；生产 checkpoint 存储延迟继续可由既有 `checkpoint_duration_ms` 观测。该验证缺口不阻止本轮批准。

### Round 3 Review

- Review 时间：2026-08-25。
- 审查结论：不通过；无 blocker/high，存在 1 项 Medium 和 1 项 Low。
- Medium：红色/青蓝色是击杀关系的唯一提示，名称可访问文本仍只有角色名，屏幕阅读器和无法区分颜色的玩家无法获得同一语义。需增加不改变可见列的非视觉关系说明。
- Low：精确回归只覆盖颜色优先级 helper，未直接锁定 `handleEvents` 的 source/target/self/zone 过滤和 leaderboard signature 失效路径。
- 其余结论：现有 4 个数据列未改变，两个标题只位于角色列的既有伤害半区；颜色、优先级、淘汰划线、滚动、窄屏、DOM 安全和性能未发现其他问题。

### Round 3 Builder Disposition

- Medium：已修复。彩色名称内追加现有 `.sr-only` 隐藏说明“你击杀的角色”或“击杀你的角色”，不增加任何可见文字、数据列或布局宽度；关系 class 与隐藏说明使用同一分支，青蓝优先语义一致。
- Low：保留为低风险。事件接入仅在现有 `actor-died` 分支中执行两个直接 ID 条件并清空 signature；纯 helper 已覆盖受害者、击杀者、双重关系优先、当前玩家和无关角色。为这一小型纯表现改动新增可变私有状态测试入口会扩大实现，交由 Reviewer 判断是否接受。
- 修复验证：原单个精确用例 1/1 通过；三套 typecheck、最终 production build 和 budgets 通过。最终 browser entry `1,176,855 / 1,200,000`、CSS `46,813 / 50,000`、dist `4,684,379 / 5,000,000`；隐藏可访问文本不改变已完成的桌面和移动横屏视觉验收结果。

### Round 3 Re-review

- Review 时间：2026-08-25。
- 审查结论：通过；无 blocker/high/medium，批准提交 `main`。
- 可访问性 Medium 已闭环：`.sr-only` 说明与颜色共用同一关系优先级分支，绝对定位且裁剪，不增加可见内容、宽度或 ellipsis 负担。
- Reviewer 确认每行仍由 `rank / actorDetails / status / kills` 4 个直接子节点组成，两个标题只嵌套在角色列既有伤害半区；协议、checkpoint、权威规则和服务端均未修改。
- Low 接受且不阻塞：未直接测试私有 `handleEvents` 状态，但两个 ID 条件经静态检查正确排除 self、zone 和无关死亡，纯 helper 已锁定颜色与青蓝优先级。
- 性能结论：新增状态最多 49 个 victim ID 和 1 个 killer ID，仅相关死亡时清空一次 signature；未发现调用放大或可进一步删除的实现。
