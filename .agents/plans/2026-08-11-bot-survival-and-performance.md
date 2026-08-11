# Bot Survival, Combat Recovery, and Runtime Performance

## Context

现有 Bot 已具备基础进圈、备用武器切换和兼容弹药搜索逻辑，但真实对局仍会出现三类问题：小型目标圈阶段可能继续停留在当前圈边缘，收圈后因路径长度或障碍来不及进入；进圈逻辑会在搜索弹药之前提前返回，使无可用弹药的 Bot 长时间只移动而不恢复战斗力；现有换枪只覆盖“备用枪弹匣已经装填”或“备用枪有后备弹药”的局部情况，不会在两把枪都不可用时主动寻找并替换为地面上可立即使用的武器。

性能方面，单机已共享 `GridNavigator`，但 authoritative multiplayer 仍为每个 Bot 和 takeover Bot 创建独立 navigator；单机每个 simulation tick 还会重复构造相同的 AI actor ID `Set`。Bot 决策热路径持续扫描并排序完整 actor/loot 集合，需用确定性 operation counts 和同 runner 性能对比确认哪些优化具有实际收益，禁止以降低 AI 行为质量换取耗时下降。

## Contract

- Bot 在当前安全区外时，进圈优先级高于战斗、治疗、拾取和普通脱困；不得因可见目标、既有 loot target、retreat、patrol 或 forced relocation 继续停留毒圈。
- Bot 在安全区等待阶段必须根据到目标安全区的可导航路径长度、剩余等待时间、sprint speed 和确定性错峰预算分批出发；时间充足时继续在当前安全区分散搜刮和巡逻，禁止开局全员立即冲向下一圈中心。目标圈很小时也必须在最晚安全出发点前转移，收缩开始后立即持续进圈。
- Bot 不得为拾取弹药或武器主动走出当前安全区。提前转移期间，只允许选择位于目标安全区内且 detour 不会破坏进圈时间预算的恢复物资。
- 当 active weapon 弹匣为空时，优先切换到已经装填的 secondary weapon；若 secondary weapon 可用 reserve ammo，则切换并装填；若当前枪有 reserve ammo，则装填。
- 当所有已携带武器都无法立即开火且没有兼容 reserve ammo 时，Bot 必须主动寻找可达的兼容弹药。若没有可达兼容弹药，则寻找可达、已装填或带有可用同类 reserve ammo 的地面武器，并替换不可用武器。
- “主动换枪”的实现范围在开工前需要用户确认：是否只包含两个 weapon slots 之间切换，还是同时包含用地面武器替换两把完全断弹的旧枪。确认前不得固化该歧义合同。
- loot target 必须保持 generation 校验和导航可达性；目标消失、被其他 Actor 拾取、路径失效或离开允许区域时必须重新选择，禁止穿墙直走。
- AI 保持与玩家相同的移动、拾取、背包、换枪、装填、弹药和毒圈伤害规则；不得为 Bot 注入弹药、瞬移、忽略容量或绕过 authoritative systems。
- 单机和 authoritative multiplayer 的同地图 Bot 必须共享只读、同步、不可重入使用的 `GridNavigator`；每个 Bot 的路径、loot target、waypoint、retreat 和 decision 状态仍必须保留在各自 Controller。
- 三张地图必须同时生成五类既有品牌牌、医院标记和弹药库专用牌；弹药库牌必须使用 `decal.poi.ammo-depot`，并贴合真实底层门洞所在墙面，禁止复用背包物品图标或悬空在包围盒外。
- 三张地图的弹药库建筑都必须使用六边形权威 footprint。墙体、门洞、楼板、楼梯、导航、碰撞、LOS、渲染和底层四堆弹药必须消费同一六边形记录；弹药库不得成为 skybridge 端点。
- 性能优化优先消除重复 navigator construction、每 tick 固定集合分配和可证明的完整集合重复排序；不得减少 perception range、LOS、地图组合、Bot 数量或导航正确性来获得性能数字。
- 新增 deterministic performance contracts，至少锁定单机与服务端每局 navigator build 数、固定时段 Bot operation counts，以及优化前后同 runner 的 runtime 指标。PR 继续接受相对 `main` 的 15% 多维性能门禁。
- 不运行 coverage。测试必须覆盖毒圈路径时间预算、当前圈外强制回圈、断弹时 slot 切换、兼容弹药搜索、地面武器恢复、目标竞争/失效、三张地图完整 Bot 对局和性能 operation budgets。

## Plan

1. 记录当前 `BotController`、single-player session 和 `MatchRuntime` 的 navigator construction、actor/loot scans、pathfinding 与 per-tick allocation 基线，建立能复现毒圈死亡和断弹停摆的 deterministic tests。
2. 提取安全区 travel budget，使用可导航路径长度与剩余阶段时间决定提前转移；确保当前圈外逻辑无条件清理低优先级状态并持续 sprint 进入可生存区域。
3. 重构 combat recovery 决策顺序，统一评估两个 weapon slots 的 loaded magazine、reserve ammo 和 reload 状态；在无可用枪时稳定搜索兼容弹药，并按用户确认的范围支持地面武器替换。
4. 让 single-player、multiplayer Bot 和 takeover Bot 共享同一 navigator；缓存固定 AI actor IDs，移除每 tick 可避免的集合分配，并只在不改变语义时收敛 Bot 热路径扫描/排序。
5. 将三地图弹药库改为不参与连桥的六边形权威建筑，使用真实六边形墙面放置专用弹药库牌，并参数化验证所有地图的完整牌子集合。
6. 补充 unit、multi-seed simulation、Worker/standalone shared-runtime 和 performance contract tests；使用 Node 24 运行定向测试后再运行完整 typecheck、test、build、Worker/server/standalone build 和 budgets。
7. 使用 production build 在本地 Chrome/Edge、音量 `0` 验证三张地图的进场、Bot 对局、六边形弹药库、所有牌子和 console，逐图截图检查；每轮验证后立即关闭页面并停止本地服务。
8. 启动独立 `code-reviewer`，要求回看用户原始需求并专门审查 AI 行为优先级、authoritative 一致性、地图/牌面视觉、性能影响和剩余优化空间；解决全部 blocker/high/medium Finding 并 Re-review。
9. 将 Plan、实现、测试和文档放入同一英文 commit，普通 push 英文分支，创建英文 MR title 和中文 MR description，评论 `@codex` 并跟进所有 review thread 与 CI。

## Build

- 2026-08-11：从最新 `origin/main` 的 `6a3abbd` 创建独立 worktree `/data00/home/lingchen.judy/self/last-line-bot-performance` 和分支 `feat/bot-survival-performance`。
- 2026-08-11：初步静态定位确认，当前 `shouldEnterTargetZone` 在 living Actor 不超过 3 且目标圈有效半径小于 24 米时会阻止提前转移；所有普通 ammo recovery 分支位于该提前返回之后，因此可能被长期压住。
- 2026-08-11：初步性能定位确认，single-player 已共享 navigator，但 `MatchRuntime` 为普通 Bot 和 takeover Bot 分别构造 Controller 默认 navigator；single-player 每 tick 仍通过 `new Set(this.botControllers.keys())` 重建固定 AI actor ID 集合。
- 2026-08-11：用户补充确认 Bot 开局扎堆严重，要求 Bot 努力活动而不是在某处等待。策略调整为等待期按可导航距离和错峰预算分批转移，时间充足时继续留在当前安全区搜刮/巡逻；人在毒圈外或收缩开始后立即进圈。
- 2026-08-11：用户追加要求三地图牌子完整、弹药库使用专用牌面、弹药库建筑为六边形。实现范围扩展到权威地图几何、场景牌面和三地图截图验证。
- 2026-08-11：实现首圈开局分散策略。存活人数仍超过半数且首圈剩余等待大于 25 秒时，Bot 只主动攻击 45m 内近敌；受击反应保持不变，之后恢复正常 150m 感知。三地图 49 Bot 完整赛局新增前 120 秒至少 26 人存活门禁，并继续要求唯一胜者、Bot 拾取/击杀、操作次数和事件预算。
- 2026-08-11：实现断弹恢复优先级：已装填备用枪、当前枪装填、备用枪装填、兼容弹药、带弹地面枪。安全区内未武装 Bot 可中断 forced relocation 去拾取 120m 内最近可达枪；毒圈外仍无条件优先进圈。Town seed 42 武装率恢复到至少 42/49，未降低既有阈值。
- 2026-08-11：单机缓存固定 Bot actor ID 集合，联机普通 Bot 与接管 Bot 共享一份 `GridNavigator`；performance contract 分别锁定单机和 authoritative room 只构建 1 份导航索引。AI 霰弹仍逐 pellet 执行权威 trace/命中/伤害，表现只广播最多 1 条 actor/environment 代表轨迹，全 miss 不广播；玩家 pellet 轨迹不压缩。
- 2026-08-11：三张地图弹药库固定为非连桥端点的六边形权威建筑。普通全局物资不占用弹药库，底层四点同时满足与全局物资至少 12m、库内至少 4m、六边形内缩、楼梯/墙体/坡道避让和门口导航可达。Island/Town/Mixed 各扫描 seed 0–24，共 75 份布局全部通过六边形、非连桥和四点完整审计。
- 2026-08-11：三张地图均保留 5 张品牌牌、医院标记和弹药库专用牌。弹药库牌改用 `decal.poi.ammo-depot`，按真实底层门洞中心、旋转和外法线贴合六边形斜墙；Town/Mixed/Island `NullEngine` 场景合同和品牌牌/小地图合同通过。
- 2026-08-11：协议提升到 14，checkpoint 提升到 13，旧矩形弹药库地图状态不兼容。完整三目标 typecheck、unit `51 files / 592 tests`、standalone `3 files / 33 tests`、performance `2/2` 通过；Worker runtime 本机仍在测试前受 glibc 2.28 阻止，Node 24 CI 必须补真实 Worker `52/52`。
- 2026-08-11：原始 bundle 与同依赖 `origin/main` 临时 archive 对比：Worker 从 `613,992B` 增至 `624,037B`，server 从 `624,925B` 增至 `634,651B`，分别增加 `10,045B` 和 `9,726B`。按已批准的可读性/资源放宽，预算从 615KB/630KB 调整为 630KB/640KB；运行时 PR 对 main 的 15% 多维性能门禁不变。
- 2026-08-11：最终自测使用 Node 24.18.1。三目标 typecheck 通过；完整 unit `51 files / 592 tests` 通过；standalone `3 files / 33 tests` 通过；performance comparison semantics 与 runtime contract `2/2` 通过。Worker runtime 本机仍在任何测试前受 glibc 2.28 缺少 2.29–2.35 阻止，未产生虚假测试结果，Node 24 CI 的 Worker `52/52` 保持最终门禁。
- 2026-08-11：浏览器、Worker dry-run、server 和 standalone build 全部通过。调整后的全部原始产物 budget 通过：browser entry `1,169,340/1,200,000B`、all JS `3,852,111/4,000,000B`、Worker `624,037/630,000B`、server `634,651/640,000B`，其他 chunk/CSS/dist 项同样通过。
- 2026-08-11：production Chrome 高画质、音量 `0` 逐图验证苍岬岛、灰炉城、烬岚郡。三张小地图截图均显示全部普通命名点、医院和弹药库；字体、字号、颜色一致，DOM bounding-box 两两重叠均为 0。三张地图的 scene metadata 均确认专用牌使用 `decal.poi.ammo-depot`、贴合 `opening-polygon-0-0` 真实门洞，贴图 ready；相机逐图对准门面后截图检查，六边形斜墙、门洞与牌面无悬空、遮挡或重叠。console 只有本机 SwiftShader 弃用警告，无应用 error。验证后页面恢复 `about:blank`，preview 和 4173/4174/5173 端口全部清理。
- 2026-08-11：使用同一主机、Node 24.18.1、Chrome for Testing 151、相同依赖和参数，对只读 `origin/main` archive 与当前分支预热后交替采样 3 轮取中位数。全部 runtime/scene/browser 指标通过 15% 门禁：Island/Town startup 分别改善 1.99%/2.62%，Mixed startup +0.23%，browser entry +1.65%，startup/stable FPS 分别改善 12.96%/6.94%，heap 变化不超过 2.04%。最接近门禁的是 browser stable P95/P99 `+14.27%`，仍通过；独立 Reviewer 必须专门审查其结构性风险和剩余优化空间。
- 2026-08-11：Reviewer 修复后最终重建 browser、Worker dry-run、server 和 standalone 全部通过，全部预算继续通过。最终 browser entry `1,169,670/1,200,000B`、all JavaScript `3,852,441/4,000,000B`、Worker `625,070/630,000B`、server `635,594/640,000B`；最终 BotController `67/67`、performance contract `2/2` 和三目标 typecheck 通过。

## Review

- 2026-08-11 Reviewer Round 1：Blocker 0、High 0、Medium 1、Low 1，不批准提交。Medium 指出 `shouldBeginTargetZoneTravel` 使用 `Math.min(pathLength(route.path), boundaryDistance * factor)` 截短真实导航距离，可能让需要长绕行的 Bot 过晚出发；Low 指出 browser stable P95/P99 `+14.27%` 距 15% 门禁仅剩 0.73 个百分点，建议减少等待期重复 route search。
- 2026-08-11 Builder disposition：接受 Medium 和 Low。出发预算改为完整 `pathLength(route.path)`；每个安全区阶段只缓存 1 条路线，普通移动不再按 18m 反复重建，进入出发窗口时最多刷新 1 次当前路线并锁定该阶段转移。新增确定性长绕行夹具：直线仅 40m、真实 route 390m 时按完整路线提前出发；同时断言阶段预计算 1 次、出发窗口最多刷新 1 次，出发后不再搜索。修复后长绕行/缓存与既有进圈合同 `4/4`、三地图完整赛局 `3/3`、三目标 typecheck 和 `git diff --check` 通过，已请求 Re-review。
- 2026-08-11 Reviewer Re-review：Blocker 0、High 0、Medium 0、Low 0，批准提交。Reviewer 确认真实 `pathLength`、阶段 route cache、出发窗口单次刷新、`zoneTravelKey` 锁定和直线 40m/实际 390m 长绕行回归已闭环；stable P95/P99 `+14.27%` 仍通过 15% 门禁，且 route search 次数已收敛，不再构成未解决风险。
