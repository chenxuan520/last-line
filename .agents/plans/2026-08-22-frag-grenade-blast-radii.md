# Frag Grenade Blast Radii

## Plan

### Goal

扩大破片手雷的权威伤害范围与爆炸动画范围，使无甲满血目标在 5 米内受到致死伤害，同时让客户端爆炸表现覆盖 8 米视觉半径。

### Product Shape

- 破片手雷在单机、Worker 和 standalone 中共同使用 10 米权威伤害半径。
- 3 米内造成 140 点满伤；继续沿用线性衰减，使 5 米处恰好造成 100 点原始伤害，10 米处为 0。
- “5 米致死半径”明确指 `100 HP`、无头盔、无护甲目标；护甲继续按现有规则减伤，不保证有甲目标在 5 米内死亡。
- 客户端主爆炸网格与飞散动画扩大到 8 米视觉半径，但不新增动态光源或实时阴影。

### Scope and Non-goals

- 修改共享手雷配置、既有线性伤害边界、爆炸动画尺寸及对应回归。
- 严格联机协议与 checkpoint 版本必须隔离旧伤害规则，Worker 与 standalone 继续共享同一套玩法实现。
- 同步更新架构与部署文档中的手雷半径、协议和 checkpoint 合同。
- 不改变引信、投掷速度、重力、反弹、遮挡、自伤、背包、物资数量、AI 决策距离或爆炸音频。
- 不新增动态灯光、实时阴影、Babylon 物理或玩法 hitbox。

### Key Decisions

- `FRAG_GRENADE_CONFIG.radius = 10`。
- `FRAG_GRENADE_CONFIG.maximumDamage = 140`。
- `FRAG_GRENADE_CONFIG.fullDamageRadius = 3`。
- 继续使用现有线性衰减，精确保证 `grenadeDamage(5) = 100`。
- 爆炸动画的最大视觉半径为 8 米；表现只消费权威爆炸事件，不参与伤害判定。
- 基于同步后的 `origin/main` 协议 14/checkpoint 13，本轮使用 `MULTIPLAYER_PROTOCOL_VERSION = 15` 和 `MATCH_CHECKPOINT_VERSION = 14`，旧客户端和旧比赛状态不得混入新规则。

### Assumptions

- “满山半径”按上下文解释为“满伤半径”，用户已指定为 3 米。
- “只扩大动画”包括现有主爆炸网格与飞散粒子的动画范围，不包括新增环境动态照明。
- 5 米致死边界按爆炸点到权威角色胶囊最近点的距离计算，与现有系统语义一致。

### Open Questions

- 无；伤害、致死、满伤和视觉半径及动态光源范围均已确认。

### Technical Context

- 权威配置：`src/config/throwables.ts`。
- 权威衰减与爆炸结算：`src/game/systems/ThrowableSystem.ts`。
- 客户端爆炸表现：`src/client/render/CombatEffects.ts`。
- 严格协议与 checkpoint：`src/network/protocol.ts`、`src/server/MatchRuntime.ts`。
- 主要回归：`tests/unit/throwableSystem.test.ts`、`tests/unit/combatEffects.test.ts`、`tests/unit/multiplayerClient.test.ts`、`tests/unit/matchRuntime.test.ts`，以及现有 Worker/standalone 恢复合同。

### Tasks

1. 添加失败回归，锁定 `10/140/3` 权威配置、5 米 100 点伤害、5 米内无甲致死和 10 米零伤害。
2. 添加爆炸表现回归，锁定动画初始状态与最大 8 米视觉半径，同时保持对象池有界。
3. 修改共享配置和最小表现代码，不改变既有遮挡、护甲、自伤或事件路径。
4. 升级严格协议与 checkpoint 版本，并更新精确版本断言、架构和部署合同。
5. 运行聚焦回归、完整 `npm run typecheck`、`npm run test`、`npm run build`、`npm run build:worker`、`npm run build:server`、`npm run build:standalone`、`npm run check:budgets` 和 `git diff --check`。
6. 使用 production build 在本机 Chrome 中保持音量 `0`，实际触发爆炸并查看截图，比较角色/环境尺度、8 米动画范围、裁剪和遮挡；结束后关闭页面并停止服务。
7. 启动独立 Reviewer 静态审查完整 diff，解决全部 blocker、high、medium Finding 后复审。

### Validation and Success Criteria

- `grenadeDamage(0)` 与 `grenadeDamage(3)` 均为 140，`grenadeDamage(5)` 为 100，`grenadeDamage(10)` 为 0。
- 无甲 `100 HP` 目标在权威距离 5 米内死亡，5 米外按线性曲线衰减；有甲结果保持现有减伤语义。
- 爆炸网格最大直径为 16 米，即视觉半径 8 米；飞散动画不再停留在原约 2 米范围。
- 旧协议客户端被版本 15 拒绝，旧版本 13 checkpoint 被版本 14 恢复校验拒绝。
- 聚焦与完整自动化验证通过，production Chrome 静音截图经实现 Agent 亲自查看且无应用错误。

### Update Log

- 2026-08-22 02:20：记录用户确认的 10 米伤害半径、140 点最大伤害、3 米满伤半径、无甲 5 米致死和 8 米纯动画视觉半径；明确不新增动态光源或实时阴影，并确定严格协议/checkpoint 隔离方案。

## Build

### Update Log

- 2026-08-22 02:56：先添加权威边界与真实结算失败回归，旧实现分别暴露 `8/120/1.5` 配置、5 米目标剩余约 37.13 HP；表现回归确认旧爆炸球在 0.33 秒时仍只有 0.6 米半径。共享配置现为 `10/140/3`，`grenadeDamage(5) = 100`，无甲 100 HP 目标在权威胶囊距离 5 米处死亡。
- 2026-08-22 02:56：`CombatEffects` 保持 4 个爆炸网格、32 个通用粒子和既有材质池，不新增 Light 或 ShadowGenerator。主爆炸网格从 0.6 米扩张到 8 米半径，8 个飞散粒子在 0.52 秒有界生命周期内扩散到同一视觉边界；聚焦 `ThrowableSystem` 与 `CombatEffects` 共 19 项测试通过。
- 2026-08-22 02:56：本轮与苍岬岛布局变更共同升级严格协议/checkpoint，并同步 `AGENTS.md`、README、架构和部署合同；完整验证、浏览器验收和独立 Review 尚待后续记录。
- 2026-08-22 04:14：最终三套 TypeScript typecheck、完整 unit `51 files / 592 tests`、Worker `4 files / 52 tests`、standalone `3 files / 33 tests` 全部通过；browser、Worker dry-run、server、same-origin standalone 和最终 browser rebuild 均成功。确定性预算全部通过：browser entry `1,165,625 / 1,200,000`、全部 browser JavaScript `3,848,396 / 4,000,000`、整个 `dist` `4,671,561 / 5,000,000`、Worker `614,901 / 615,000`、standalone `625,676 / 630,000`。
- 2026-08-22 04:14：首轮正常 production build 与专用 production bundle 均保持音量 `0`。实现 Agent 亲自查看真实 `CombatEffects` 冻结截图：0.33 秒时主爆炸半径约 `7.782m`，几乎贴合 8 米参考环，8 个飞散粒子可见；场景仅有验收环境原有 ambient light，特效没有创建动态灯光或阴影。正常游戏 production console 无 error/warn；临时页面、服务、截图与 bundle 已全部清理，Chrome 只剩 `about:blank`。
- 2026-08-22 04:38：独立 Reviewer 指出首轮最后可见帧没有精确达到 8 米，且结算测试把角色中心而非胶囊边界放在 5 米。爆炸网格和手雷飞散粒子现各自在精确达到 8 米时保持一个可见帧，下一 update 才回收；普通枪击环境粒子不继承该额外帧。回归精确断言启用中的网格半径为 `8m`、最远粒子为 `8m`，随后爆炸/粒子计数都归零。真实结算改为把爆心放在角色胶囊纵轴范围内、角色中心放在 `5m + ACTOR_RADIUS`，先断言最近胶囊距离恰为 5 米，再断言 `actor-damaged.damage = 100`、目标死亡、外移 0.001 米目标存活。
- 2026-08-22 04:38：Review 修复后完整三套 typecheck、unit `51/592`、Worker `4/52`、standalone `3/33` 再次通过；最终 browser build 与全部预算通过，browser entry 更新为 `1,165,893 / 1,200,000`，Worker/standalone 仍为 `614,901 / 615,000`、`625,676 / 630,000`。production bundle 再验收显示启用中的真实爆炸网格精确为 `8m`，8 个粒子保持活动，未创建额外灯光，console 无 error/warn；实现 Agent 再次亲自查看其与 8 米参考环贴合的截图并清理全部资源。
- 2026-08-22 05:03：提交前同步发现 `origin/main` 已推进到 `0fbfe4c`，其中六边形弹药库已占用协议 14/checkpoint 13 并把 Worker/server 预算调整为 630KB/640KB。当前分支在保留新 main 全部语义的基础上完成冲突解决，本任务最终改用协议 15/checkpoint 14；旧 14 客户端与旧 13 checkpoint 均被拒绝。
- 2026-08-22 05:03：合并后最终三套 typecheck、unit `51 files / 616 tests`、Worker `4 files / 52 tests`、standalone `3 files / 33 tests` 和 performance contracts `2/2` 通过；browser、Worker dry-run、server、same-origin standalone、最终 browser rebuild、budget 与 `git diff --check` 通过。最终产物为 browser entry `1,171,935 / 1,200,000`、all JavaScript `3,854,706 / 4,000,000`、`dist` `4,677,871 / 5,000,000`、Worker `627,793 / 630,000`、standalone `638,159 / 640,000`。
- 2026-08-22 12:48：PR #7 Codex 提出两项 P2：Bot 最小自伤距离仍写死 10 米，未包含角色胶囊半径；8 米视觉半径仍是渲染器本地常量。两项均接受。`FragGrenadeConfig.visualRadius = 8` 成为共享表现配置，`CombatEffects` 不再保留独立数值；Bot 最小落点距离改为 `FRAG_GRENADE_CONFIG.radius + ACTOR_RADIUS`，并新增 13.4 米目标会被新安全边界拒绝的真实轨迹回归。
- 2026-08-22 12:48：Codex 修复后手雷聚焦 `10/10`、三套 typecheck、Worker `52/52`、standalone `33/33`、browser/Worker/server build、budget 和 `git diff --check` 通过。完整 unit 在与 typecheck 并行的高负载下为 `611/613`，仅两个未修改 town 用例超过既有 5 秒墙钟；两项按原 timeout 单独重跑分别约 1.05 秒和 1.18 秒通过，未修改 timeout 或断言。最终产物为 browser entry `1,171,981 / 1,200,000`、Worker `627,851 / 630,000`、standalone `638,217 / 640,000`。

## Review

### 2026-08-22 Combined Review

- Round 1 Reviewer 对照用户原始需求、两份 Plan 和 `origin/main@6a3abbd` 完整 diff，只做静态审查且未重复外层验证。发现 1 项 High：网格/粒子在到达精确 8 米的同一 update 被禁用，最后可见帧不足 8 米；1 项 Medium：集成回归把角色中心放在 5 米，未真实构造 5 米胶囊距离；1 项 Low：standalone 临时目录残留 v12 名称。三项均按 Build 记录修复。
- Round 2 Re-review 确认 `finalFrame` 与手雷专属 `holdFinalFrame` 保持精确 8 米可见一帧并在下一 update 回收，普通环境粒子保持旧生命周期；池抢占会由 `activate()` 重置状态，counter 一致。5 米集成回归现覆盖恰好 100 伤害、死亡与 5.001 米存活，v13 诊断名称已同步。
- 最终 Finding：blocker 0、high 0、medium 0、low 0，**批准提交**。性能结论：池容量、Mesh/material 数量不变，每帧只增加固定 36 个轻量状态分支，无新增分配或超过 15% 的风险；地图生成对比约 `+3.7%`。Reviewer 提醒 Worker 预算仅余 99B，后续共享代码变化必须继续检查。
- 2026-08-22 05:03：提交前同步改变了审查基线并引入六边形弹药库、Bot 生存/性能与预算改动；上述批准仅适用于旧基线。已在新基线 `origin/main@0fbfe4c` 完成合并和全套验证，等待独立 Reviewer 对最终组合 diff 再审查。
- 2026-08-22 05:03：最终独立 Reviewer 以 `origin/main@0fbfe4c` 复审完整组合 diff，确认六边形弹药库、Bot 生存/性能、协议 15/checkpoint 14、精确 8 米可见帧、5 米胶囊伤害和池复用均正确。最终 Finding 为 blocker 0、high 0、medium 0、low 0，**批准提交**；性能结论为固定容量池无新增分配或调用放大，未见超过 15% 的风险。
- 2026-08-22 12:48：Codex 两项 P2 已实现并完成验证，等待独立 Reviewer 复审共享视觉配置、Bot 自伤边界及测试充分性后提交 follow-up。
- 2026-08-22 12:50：独立 Reviewer 复审 Codex follow-up 未发现 blocker/high/medium/low，批准提交。Reviewer 确认 `radius + ACTOR_RADIUS = 10.42m` 能保证胶囊爆炸距离至少 10 米；13.4 米 fixture 的预测落点约 10.022 米，旧门槛会投、新门槛拒绝，16 米安全投掷仍成立。`visualRadius` 不进入网络状态/checkpoint，无需在同一未合并协议 15/checkpoint 14 内再次升级；普通环境粒子、固定池和性能保持不变。
