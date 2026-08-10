# 标准物资 Checkpoint 防护

## 背景

Codex 审查 PR #4 的提交 `dae6572f290f9358e93879bdcc64511acf0de2b1` 时发现有效 P2：checkpoint 版本 7 只校验已经存在的 `groundLoot`，却不要求权威初始 `loot-0` 到 `loot-253` roster。空或截断记录可能在缺少弹药库物资的情况下恢复。

## 计划

- 每个 checkpoint 必须包含标准 key `loot-0` 到 `loot-253`。
- 每条地面物资 record key 必须等于稳定 `loot.id`。
- 继续允许合法额外动态 drop/death 记录。
- Unit 覆盖空物资、缺 `loot-250`、key/ID 不一致和合法额外记录。
- Standalone SQLite 与 Worker Durable Object 真实恢复路径覆盖缺 `loot-250` 时删除房间/checkpoint。
- 运行 Node 24 unit/standalone/typecheck、Worker dry-run、构建、预算和 `git diff --check`；不运行覆盖率。
- Follow-up 提交前独立静态审查，推送 PR #4 并重新请求 Codex。

## 构建

- 红测复现 `groundLoot: {}` 被 `isMatchCheckpointCompatible()` 错误接受。
- 新增共享标准 roster 防护，要求 `loot-0..loot-253`、全部标准/动态记录 key 与 `loot.id` 一致，同时允许合法额外记录。
- 新增真实 standalone SQLite 和 Worker Durable Object 截断物资恢复回归。
- 定向 unit/standalone 通过；`isRecoverableLoot()` 收紧为 `GroundLootState` 类型谓词，不改变运行时语义。
- 最终定向 roster/SQLite、standalone 3 文件 26 测试、Node 24 三项目 typecheck、Worker dry-run、服务端构建、预算和 diff check 通过。完整 unit 唯一失败是既有城镇细节 5 秒超时，单 worker 原断言通过。该恢复校验任务不需要 Chrome 或覆盖率。

## 审查

- 独立 follow-up 审查基于 `dae6572`，覆盖 `MatchRuntime`、unit/standalone/Worker 回归和本 plan。
- `TOTAL_LOOT_POINTS = 254`，兼容性要求自有属性 `loot-0..loot-253`；所有现有标准/额外记录先做形状校验并要求 key 等于 `loot.id`，不限制额外记录数量或白名单。
- 两条持久化测试都从合法 checkpoint 开始，仅删除 `loot-250`，并在真实 standalone 重启或 Worker DO 淘汰/重建后验证删除。
- 结论：通过；blocker/high/medium/low 均为 0。
