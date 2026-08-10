## Plan

### 背景

项目已有 367 项 Vitest、确定性性能/协议/场景预算和三套 production build 门禁，但 unit、Cloudflare Worker、standalone 三套测试均未启用 coverage provider，因此目前没有可信的代码覆盖率百分比或防回退基线。

### 目标

1. 安装与 Vitest `4.1.10` 严格匹配的 `@vitest/coverage-v8` devDependency，不进入生产 bundle 或 runtime image。
2. 分别统计 `src/`、`worker/`、`standalone/` 的 statements、branches、functions、lines，并生成无重复目录的加权总覆盖率。
3. 使用真实首次结果设置保守且可审查的三套基线阈值，覆盖率低于基线时 CI 失败。
4. coverage 输出只写入已忽略的 `node_modules/.cache/coverage/`，不修改用户已有 `.gitignore`，不提交报告产物。
5. 保留现有 `npm run test` 快速门禁；新增显式 `npm run test:coverage` 并在 CI 中执行。

### 实现边界

- 不通过排除难测业务文件来虚高覆盖率；仅按所有权分别纳入 `src/**/*.ts`、`worker/**/*.ts`、`standalone/**/*.ts`。
- 覆盖率不替代功能回归、确定性预算、Docker smoke 或 reviewer。
- 首轮不追求任意 80% 等目标值，阈值依据当前可复现结果向下取整后建立。
- 不引入浏览器自动化，不修改玩法、协议、持久化或部署语义。

## Build

### 更新日志

- 2026-07-23 20:52：确认当前/目标分支均为 `main@8e821fa`，与 `origin/main` 对齐；工作区仅有用户原有 `.gitignore` 修改并继续排除。三套 Vitest 配置当前均无 coverage provider，CI 仅运行普通测试。确定采用 V8 provider、三套互不重叠 source ownership、`node_modules/.cache/coverage/` JSON summary 和加权汇总脚本；阈值待首次真实运行后确定。
- 2026-07-23 21:09：安装与 Vitest 对齐的精确版本 `@vitest/coverage-v8@4.1.10`。首次运行确认 `src/` V8 coverage 正常，但 Cloudflare `workerd` 官方不支持原生 V8 inspector coverage；按 Cloudflare 官方要求，仅为 Worker 增加 `@vitest/coverage-istanbul@4.1.10`，standalone 继续使用 V8。两个 direct provider package 本体约 56 KiB / 428 KiB，均为 devDependency；`npm audit --omit=dev` 为 0 vulnerabilities。完整 dev audit 的 4 个 high 来自既有 `wrangler/miniflare -> sharp` 链路，不能通过非 breaking update 修复，未执行 `npm audit fix --force`。
- 2026-07-23 21:09：新增三套 coverage scripts/config 和加权汇总脚本，报告只写 `node_modules/.cache/coverage/`。两轮真实 coverage 结果稳定：`src/` statements `73.93%`、branches `67.33%`、functions `75.86%`、lines `76.14%`；Worker `76.31% / 69.27% / 91.38% / 82.21%`；standalone `76.61% / 61.48% / 86.30% / 79.84%`；按 statement/branch/function/line 计数加权总值为 `74.48% / 67.47% / 79.38% / 77.32%`。三套门禁分别向下取整到整数阈值，最终 `npm run test:coverage` 全部通过（317 app、30 Worker、20 standalone）。CI 已改为直接运行 coverage tests，README、AGENTS 和架构文档已同步；尚待普通测试、typecheck/build/budgets 最终门禁和 reviewer。
- 2026-07-23 21:14：从干净 `npm ci` 依赖安装完成最终门禁：`npm run typecheck`、普通 `npm run test`（317 app、30 Worker、20 standalone）、`npm run test:coverage`、browser build、Worker dry-run、standalone server bundle、全部产物预算、`git diff --check` 和 `npm audit --omit=dev` 均通过。Coverage provider 未改变任何 production artifact，预算仍为 entry `1,022,686`、最大异步块 `613,551`、全部 JS `3,719,341`、252 chunks、CSS `43,052`、dist `4,239,689`、Worker `385,045`、server `407,225`。尚待 reviewer 闭环、提交和远端 CI。
- 2026-07-23 21:44：确认并修复 reviewer Round 1 Medium。Coverage 汇总器改为可测试的 TypeScript 模块，对每项 `covered/total` 强制非负整数且 `covered <= total`，缺失/非法结构继续失败；新增 5 项聚焦回归，覆盖正确加权、负数、小数、covered 超 total 和缺失 metric。修正后 typecheck、定向 5 tests 和完整 `npm run test:coverage` 均通过；应用现为 35 files / 322 tests，Worker 30、standalone 20（共 372 tests），覆盖率数值保持不变。待复审。
- 2026-07-23 22:04：reviewer Round 2 返回 `No findings`，Round 1 Medium 已闭环；复审独立覆盖 Node 24/25、缺失/损坏 summary、threshold、ownership、依赖与产物隔离。复审后再次执行普通 `npm run test` 和 `git diff --check`，35 app files / 322 tests、Worker 30、standalone 20 全部通过。本次实现、文档、plan 与完整 review 记录将同一 commit 提交并推送；远端 CI 结果按既有约定在对话汇报，不另建 plan-only 小提交。
- 2026-07-23 22:32：实现以 `f34203f test: add coverage baseline gates` 推送后，远端 run `30014194063` 证明在 GitHub 双核 runner 上用 coverage 替代普通 CI 测试会使重型 map/scene corpus 被 V8 插桩放大到 9 分钟并触发 5/120/240 秒 deadlock timeout。随后仅把 unit coverage 改成单 worker 的 `7d69335` 方向仍不正确：run `30015354806` 用 638 秒后仍有两个 map timeout。现恢复主 CI 为原 `npm run test`，coverage 与阈值保留为开发者按需执行的 `npm run test:coverage`，并恢复并行 coverage 命令；不放宽测试 timeout、不影响生产代码。本记录与实际 CI 修复同一 commit 交付，不创建独立文档 commit。

## Review

### 2026-07-23 21:35 CST — Round 1

- 审查范围：以 `8e821fa` 为基线，覆盖 package/lockfile、三套 Vitest coverage 配置与脚本、汇总脚本、CI、AGENTS/README/architecture 文档及本 plan；用户原有 `.gitignore` 修改已明确排除且未触碰。
- 结论：**不通过（1 个 Medium finding 待处理）**。
- **[Medium][待 builder 处理] `scripts/report-coverage-baseline.mjs:41-52`：汇总脚本只检查 `covered`/`total` 是否为有限数，没有拒绝负数、非整数或 `covered > total`。因此语法有效但逻辑损坏的 summary（例如 `{covered: 2, total: 1}`，甚至 `total: 0, covered: 1`）仍会成功退出并打印错误加权结果，不满足“损坏报告必须失败”的要求。应校验两者为非负整数且 `covered <= total`，并补充缺失、非法 JSON/结构及逻辑非法计数的聚焦验证。**Disposition：Open，复审前需修复。**
- 已验证：Node `25.8.2` 与 CI 对应 Node `24.18.0` 均完整执行 `npm run test:coverage`，每轮均为 317 app + 30 Worker + 20 standalone（367 tests）；三套整数阈值均为对应实测值向下取整。通过 CLI 临时把 Worker statements 阈值提高到 100，30 tests 执行后门禁按预期失败。
- 已验证：coverage ownership 为 `src` 56/56 个非 `.d.ts` 文件、`standalone` 5/5 个非 `.d.ts` 文件；Worker 报告覆盖 6 个可执行模块，未生成运行时代码的 `worker/env.ts` 与 `worker/shared.ts` 仅含 type/interface。三个 include 根目录互不重叠，唯一显式排除为 `src/vite-env.d.ts` 与 `standalone/web-platform.d.ts`，未隐藏业务实现。
- 已验证：Cloudflare 官方已明确 workerd 不支持 native V8 coverage、必须使用 Istanbul；Node suites 使用 V8。两个 provider 均精确锁定 `4.1.10`、peer 到 `vitest@4.1.10`，均为 dev-only；`npm ls --omit=dev` 不含 provider，现有 browser/Worker/server 产物未发现 coverage/Istanbul 代码，Docker runtime 也只复制构建产物与 `ws`。
- 已验证：报告路径被既有 `node_modules/` ignore 规则覆盖；缺失文件、非法 JSON、缺失 metric 及非有限计数会失败；当前加权值按各 suite 的 raw covered/total 逐项求和后计算。CI 的 coverage 步骤位于全部 build、budget 和 Docker smoke 之前并执行全部 367 tests。`npm audit --omit=dev` 为 0；完整 audit 的 4 个 high 与 plan 记录的既有 `wrangler/miniflare -> sharp` 链路一致。
- 残余风险：Node 24/25 与 Worker 定时路径会令未取整实测值小幅浮动（本轮 app 为 `73.93–73.94 / 67.33–67.37`，Worker 重复成功轮次为 `76.31–76.61 / 69.26–69.67`），但均保持相同向下取整阈值且未观察到 coverage threshold 假失败。重复压力运行还复现了 `tests/worker/serverMetrics.test.ts:22` 的共享状态/执行顺序失败；同样可在无 coverage 的既有 `npm run test:worker` 复现，故本轮不归因于本 diff，但属于后续应单独处理的既有 CI 稳定性风险。

### 2026-07-23 22:00 CST — Round 2

- 审查范围：重新读取本 plan，以 `8e821fa` 为基线复审全部 coverage-baseline 改动，并重点检查 reporter 从 MJS 迁移到 TypeScript/`tsx`、新增 5 项 unit tests 及 Round 1 Medium 的处置；用户原有 `.gitignore` 修改继续明确排除且未触碰。
- 结论：**通过；本轮未发现明确问题。**
- Round 1 Medium disposition：**Closed**。`scripts/report-coverage-baseline.ts:33-58` 先校验 summary/total/metric 结构，再要求 `covered` 与 `total` 均为非负整数且 `covered <= total`；负数、小数和 covered 超 total 均会失败。`tests/unit/coverageBaselineReporter.test.ts` 的 5 项用例覆盖 count-weighted 汇总、三类非法计数和缺失 metric，定向执行 5/5 通过。另独立以无报告目录和非法 JSON 文件直接执行 CLI，均非零失败；缺失 summary/total/metric 及字段类型错误也由同一校验路径拒绝。
- `npm ci` 后验证通过：`npm run typecheck`、定向 reporter tests、Node `25.8.2` 完整 `npm run test:coverage`、CI 对应 Node `24.18.0` 完整 `npm run test:coverage`、browser build、Worker dry-run、standalone server bundle和全部 budgets。两轮完整 coverage 均执行 35 app files / 322 tests、4 Worker files / 30 tests、3 standalone files / 20 tests，总计 **372 tests**；TypeScript reporter 均由本地 `tsx@4.23.1` 正常执行。
- Coverage 复核：Node 25 本轮为 app `73.93 / 67.33 / 75.86 / 76.14`、Worker `76.56 / 69.59 / 91.38 / 82.50`、standalone `76.61 / 61.48 / 86.30 / 79.84`；Node 24 为 app `73.94 / 67.37 / 75.86 / 76.14`、Worker `76.31 / 69.27 / 91.38 / 82.21`、standalone 同前。既有 timing/Node 浮动未改变三套向下取整阈值（app `73/67/75/76`、Worker `76/69/91/82`、standalone `76/61/86/79`），新增 tests/reporter 不进入 `src` ownership，初始基线与文档仍准确。
- 加权汇总独立复算 Node 24 raw counts：statements `7323/9831 = 74.49%`、branches `4233/6271 = 67.50%`、functions `1155/1455 = 79.38%`、lines `6772/8758 = 77.32%`，与 reporter 输出一致。Source ownership 仍为 `src` 56/56、standalone 5/5 个可执行 `.ts`；Worker 6 个可执行模块均被统计，未出现于报告的 `env.ts`/`shared.ts` 仍仅含类型声明，三套根目录无重叠。
- 依赖/产物/CI 复核：两个 coverage provider 仍精确为 `4.1.10` 并 peer 到 `vitest@4.1.10`，`tsx` 为既有精确 lock 的 devDependency；`npm ls --omit=dev` 不含三者，三套 production artifacts 未发现 reporter/provider/Istanbul 代码。CI 仍在 build/Docker 前通过 `npm run test:coverage` 执行全部 372 tests；现有 `node_modules/` ignore 规则覆盖全部报告，`npm audit --omit=dev` 为 0，产物 budgets 与 Round 1 记录一致。
- 验证缺口/残余风险：本机无 `docker` 可执行文件，Round 2 未重复 container build/smoke；Dockerfile/CI/Docker inputs 本轮均未新增改动，原有 Worker 测试顺序风险仍按 Round 1 记录保留。
