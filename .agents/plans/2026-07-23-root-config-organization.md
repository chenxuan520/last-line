## Plan

### 目标

- 将三个 Vitest 配置收口到 `config/vitest/`。
- 将 Wrangler 生成类型移到 `types/`，并让生成命令稳定输出到新路径。
- 保留 `vite.config.ts`、`tsconfig*.json`、Dockerfile 和 package files 等标准根目录入口，不为美观破坏工具惯例。
- 不修改业务代码、测试语义、覆盖率阈值或用户已有 `.gitignore`。

## Build

### 更新日志

- 2026-07-23 23:04：确认 `main@d02a652` 与 `origin/main` 对齐，工作区仅有用户原有 `.gitignore` 修改。开始把三个 Vitest 配置迁移到 `config/vitest/`，Wrangler 生成类型迁移到 `types/`；覆盖率仍只按需执行，本任务不重复运行 coverage。
- 2026-07-23 23:09：完成配置整理。三个 Vitest config 已迁入 `config/vitest/`，Wrangler 类型生成目标改为 `types/worker-configuration.d.ts`，package scripts 与三套 tsconfig 引用同步；根目录只保留工具惯例要求的 `vite.config.ts`。`npm run types:worker`/`--check`、typecheck、普通 372 tests、browser/Worker/server builds、全部 budgets 与 `git diff --check` 均通过；按用户要求未运行 coverage。
- 2026-07-23 23:19：确认 reviewer Medium 成立：根配置移走后裸 `test:watch` 会按默认 glob 错收 Worker/standalone tests。现显式绑定 `config/vitest/unit.config.ts`，与 `test:unit` 使用同一配置；待定向验证和复审。

## Review

### 2026-07-23 23:18 CST

- 审查范围：以 `main@d02a652` 为基线，检查未提交的 Vitest 配置、package scripts、tsconfig、Wrangler 类型及 Docker/build 输入；排除且未触碰用户的 `.gitignore` 修改。
- 结论：不通过，存在 1 个 Medium 阻塞项。
- Finding（Medium，`package.json:33`）：`test:watch` 仍为裸 `vitest`。根目录 `vitest.config.ts` 移走后该命令不再加载 unit config，而会按默认规则收集 Worker/standalone 测试；实测 `npm run test:watch -- --run` 因缺少 Cloudflare pool 而有 4 个 Worker suite 失败。Builder 需显式引用 `config/vitest/unit.config.ts`，并复验 watch 与普通三套测试。
- 验证：三个新 config 与基线内容逐行一致；无旧文件名文本引用；Vitest 非 coverage 配置解析确认 root、include、coverage 输出目录及阈值不变（按要求未运行 coverage）。`types:worker -- --check`、typecheck、Vite build、Wrangler dry-run build、server build 通过，生成类型仅有预期的输出命令、`../worker/index` 相对导入和生成器空白差异；Docker `COPY . .` 且 `.dockerignore` 未排除 `config/`/`types/`。unit 322、Worker 30（一次顺序敏感失败后独立重跑通过）、standalone 20 tests 通过。

### 2026-07-24 00:22 +0800 — Finding disposition

- Round 1 Medium 已关闭：`test:watch` 显式使用 `config/vitest/unit.config.ts`，定向 watch run 5/5 通过，不再收集 Worker/standalone suites。
- 两次 reviewer 复审调用被外部取消；用户明确要求继续推进。Writer 重新核对 package scripts、旧路径搜索、生成类型、typecheck、普通 372 tests、三套 build、budgets 和 diff，未发现剩余 blocker/high/medium。
- 按用户要求未运行 coverage；覆盖率仍为按需命令，配置内容和阈值未变。
