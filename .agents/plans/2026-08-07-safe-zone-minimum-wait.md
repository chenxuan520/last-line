## Plan

- 将正式大逃杀配置中每一阶段的缩圈等待时间下限调整为 35 秒。
- 将正式六阶段圈伤平滑调整为 `5/8/11/14/17/20` 每秒，同时保持各阶段缩圈时长、目标半径和少于 5 人时的缩圈加速语义不变。
- 保留 `FAST_BATTLE_ROYALE_CONFIG` 的测试加速时间，不把正式配置约束误加到测试配置。
- 更新正式对局总时长与等待时间回归断言，并完成相关测试、类型检查和构建验证。

## Build

### 更新日志

- 2026-08-07 22:43：确认当前分支与目标分支均为 `main`，工作区干净，基线为 `27413d4`；已核对正式缩圈配置和预算测试，确认仅第 5、6 阶段等待时间低于 35 秒，改动范围为 `src/config/battleRoyale.ts` 与 `tests/unit/battleRoyaleMode.test.ts`。
- 2026-08-07 22:45：用户追加圈伤平滑化要求；正式六阶段圈伤确定为 `5/8/11/14/17/20` 每秒，等待时间调整为 `120/90/70/35/35/35` 秒，缩圈时长、半径和测试加速配置保持不变；预算与配置回归断言已同步。
- 2026-08-07 22:46：先更新预算、等待下限和圈伤梯度回归，旧配置下如预期失败；完成正式配置修改后执行 `npm run test:unit -- tests/unit/battleRoyaleMode.test.ts`，15 项测试全部通过。
- 2026-08-07 22:49：完整验证通过：`npm run typecheck`；`npm run test` 共 43 个 unit 文件 / 416 项、4 个 Worker 文件 / 32 项、3 个 standalone 文件 / 21 项全部通过；`npm run build`、`npm run build:worker`、`npm run build:server` 与 `npm run check:budgets` 全部通过。当前无已知阻塞或遗留风险，尚未提交和推送。
- 2026-08-07 22:51：提交前确认 `origin/main` 与本地基线均为 `27413d4`，执行 `git pull --rebase --autostash origin main` 后仍为最新；`git diff --check` 通过，工作区仅包含本次配置、回归测试和关联 plan，准备提交并推送。

## Review

- 2026-08-07 22:51：独立 `code-reviewer` 完成静态终审；确认正式等待时间、圈伤梯度、657 秒理论预算、FAST 测试配置隔离及既有阶段切换/少于 5 人加速语义均正确，改动范围符合计划，无 blocker、high、medium 或 low finding，无需追加修改或复审。
