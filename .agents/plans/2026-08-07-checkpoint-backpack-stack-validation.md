# Checkpoint 背包堆叠校验

## 目标

拒绝背包含未知物品或堆叠数量超过配置上限的持久化比赛 checkpoint。

## 验收

- 共享 checkpoint 校验要求每个背包 `itemId` 存在于 `ITEMS`。
- 数量必须是正整数且不超过 `ITEMS[itemId].maxStack`。
- Unit 拒绝未知 item ID 和超过上限的 `grenade.frag`。
- Worker/standalone 持久化覆盖超大手雷栈恢复时删除房间和 checkpoint。
- 所需验证与独立审查完成，未解决 blocker/high/medium 为 0。
- 实现推送到 PR #3，最新 head 的 CI 和 Codex 无有效审查发现。

## 实现

- `MatchRuntime` checkpoint 校验复用权威 `ITEMS`，不复制堆叠上限。
- 扩展 unit、Worker、standalone 现有损坏 checkpoint 表。

## 构建

- 原校验器会接受未知背包物品和 `grenade.frag ×4`；新增两条 unit 在修复前失败、修复后通过。
- Node.js 24.18.1 三项目 typecheck 通过。
- 聚焦 `matchRuntime` 30/30、standalone runtime 18/18 通过。
- 完整 unit 48 文件 513 测试，standalone 3 文件 32 测试通过。
- 本机 glibc 2.28 无法启动要求 GLIBC 2.29–2.35 的 `workerd`；Worker TypeScript 与 fixture typecheck 通过，真实 Worker 由 GitHub CI 门禁。
- 浏览器、Worker dry-run、服务端和 standalone 构建及预算通过。
- 分支已经包含 `origin/main@feea36a`，无需额外集成。

## 审查

- 独立静态审查检查最终 diff、共享恢复合同、unit、SQLite 重启、DO 淘汰、fixture 隔离、类型收窄和文档。
- 审查者 报告 blocker/high/medium/low 均为 0，并批准提交。
