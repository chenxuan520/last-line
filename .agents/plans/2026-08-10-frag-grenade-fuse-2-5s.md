# Frag Grenade 2.5-Second Fuse

## Context

当前破片手雷权威引信为 3.5 秒。用户反馈爆炸等待时间太长，投掷后目标过于容易撤离，要求缩短为 2.5 秒。

## Contract

- `FRAG_GRENADE_CONFIG.fuseSeconds` 固定为 2.5 秒，成为单机、Worker、standalone、AI、checkpoint 校验、轨迹采样和客户端表现共同使用的唯一引信配置。
- 手雷从权威生成时开始倒计时；不得在客户端、Bot 或服务端维护第二套引信数值。
- 飞行、反弹、爆炸范围、伤害、遮挡、自伤、背包消耗、AI 冷却和同时动作语义保持不变。
- Checkpoint 中活动手雷必须拥有正数且不超过 2.5 秒的剩余引信；旧协议/checkpoint 不得与本轮未发布的权威规则混用。
- `AGENTS.md` 和架构文档必须同步记录 2.5 秒引信。

## Plan

1. 添加失败回归，精确断言权威引信为 2.5 秒，并验证投掷后在 2.5 秒边界爆炸。
2. 修改共享手雷配置，不在其他系统写死新数值。
3. 把 checkpoint 超限回归改为相对共享配置构造，避免未来规则变更留下旧常量。
4. 更新 `AGENTS.md`、`docs/architecture.md` 和本 Plan。
5. 运行手雷聚焦测试、完整组合验证、typecheck/build/budget 与 `git diff --check`；不运行 coverage。
6. 使用 production Chrome MCP 在音量 `0` 下实际投掷并观察引信表现；验收后立即清理页面和服务。
7. 与同一未提交分支中的烬岚郡至少两个城镇增量一起启动独立 Reviewer，解决全部 blocker/high/medium Finding。
8. 创建准确英文 commit，普通 push 到现有 PR，重新请求 Codex 并监控 CI、Cloudflare Pages 和 Review thread。

## Build

- 2026-08-10：失败回归在旧配置上精确得到 `3.5 !== 2.5`，确认当前产品引信确实未满足需求。共享 `FRAG_GRENADE_CONFIG.fuseSeconds` 改为 2.5；`ThrowableSystem` 创建、30Hz 固定子步、轨迹采样、Bot 弹道判断、checkpoint 上限校验和客户端 `GrenadePresentation` 继续共同消费该值，没有新增第二套引信常量。
- 2026-08-10：新增权威边界回归：投掷后推进 `2.49s` 时活动手雷仍存在且剩余 `0.01s`，再推进 `0.01s` 后手雷被删除并产生 `grenade-exploded`。Checkpoint 超限回归改为 `FRAG_GRENADE_CONFIG.fuseSeconds + 0.000001`，不再写死旧 3.5 秒。
- 2026-08-10：Bot 安全高抛测试同步共享 2.5 秒引信。真实 controller 扫描确认 16m 目标可在引信前安全落点并投掷，20m 旧 fixture 会因轨迹末点无法在 2.5 秒内接近目标而正确拒绝；测试同时锁定“16m 投、20m 不投”，没有放宽最小自伤距离、最大落点误差或 AI 活动手雷上限。
- 2026-08-10：手雷系统、MatchRuntime、BotController、GrenadePresentation 和 GameSimulation 聚焦套件 `5 files / 126 tests` 通过；收尾 checkpoint/表现 fixture `2/2` 通过。Node 24.18.1 三目标 typecheck、组合最终完整应用 `51 files / 583 tests` 与 standalone `3 files / 33 tests` 通过；本机 Worker runtime 仍在测试执行前被 glibc 2.28 阻止，push 后 CI 必须补充 Worker `52/52`。
- 2026-08-10：组合最终 browser、Worker dry-run、server、same-origin standalone build 和 browser rebuild 均通过。确定性预算为 browser entry `1,164,941 / 1,200,000`、全部 browser JavaScript `3,847,712 / 4,000,000`、整个 `dist` `4,670,877 / 5,000,000`、Worker `613,992 / 615,000`、standalone `625,008 / 630,000`。
- 2026-08-10：production Chrome MCP 在音量 `0` 下使用真实 `ThrowableSystem`、`GrenadePresentation` 和 `CombatEffects`。冻结投出状态显示 1 个活动手雷、权威剩余引信 `2.50s`；按游戏相同的 30Hz `SIMULATION_STEP_SECONDS` 推进后，`grenade-exploded` 在权威模拟 `2.50s` 到达，墙钟为 `2.51s`，活动手雷归零，真实表现池冻结显示 1 个爆炸球和 8 个粒子。实现 Agent 亲自查看投出与爆炸截图，console 只有 Babylon 启动日志与 SwiftShader 警告。每轮结束后立即回到 `about:blank`，停止 4173 并删除全部 `/tmp/last-line-grenade-fuse*` 文件。

## Review

### 2026-08-10 Combined Final Review

- Reviewer 以 `064b2f7` 为基线，静态审查本 Plan 与烬岚郡至少两个城镇 Plan 的完整未提交组合 diff；未重复外层门禁，也未修改文件、Plan、Git 或远端。
- 结论：**通过，可提交并普通推送。** Blocker、high、medium、low 均为 0。
- `FRAG_GRENADE_CONFIG.fuseSeconds = 2.5` 是唯一引信配置；`ThrowableSystem`、轨迹预览、Bot 安全落点、checkpoint 上限、Worker/standalone 共享 runtime 与客户端表现均消费共享配置或权威状态，没有残留玩法含义上的 3.5 秒常量。
- 回归真实覆盖 2.49/2.50 秒爆炸边界、Bot 16m 投掷与 20m 拒绝、checkpoint 超限、协议拒绝和 standalone SQLite 恢复；没有通过删除断言、放宽 timeout 或降低安全阈值掩盖回归。
- 协议 12 与 checkpoint 11 完整隔离本轮权威规则；本机 Worker runtime glibc 缺口由 push 后 Node 24 CI 补证据。
