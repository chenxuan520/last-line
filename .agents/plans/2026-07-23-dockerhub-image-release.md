## Plan

### 背景

项目现有 GitHub Actions 会在 `main`、PR 和 `v*` tag 上完成类型检查、测试、三套构建、产物预算、production Docker image 构建及容器 `/health` smoke，但 tag 发布目前只创建 GitHub Release，不会把 standalone image 推送到镜像仓库。

### 目标

1. 版本 tag 通过现有完整门禁和本地 image smoke 后，自动构建并推送 `chenxuan520/last-line`。
2. 发布 `linux/amd64` 与 `linux/arm64` manifest，稳定版本同时生成完整版本、minor、major 和 `latest` 标签；预发布版本不更新 `latest`。
3. Docker Hub 登录只使用 GitHub Actions Secrets `DOCKERHUB_USERNAME` 和 `DOCKERHUB_TOKEN`，不把凭证写入仓库、日志、镜像或发布产物。
4. Docker Hub 推送失败时，不创建对应 GitHub Release，避免发布状态不一致。

### 实现边界

- 继续复用根目录 production `Dockerfile`，不复制 standalone 构建逻辑。
- 不修改应用、权威玩法、网络协议、持久化格式或 Docker runtime 行为。
- 不触碰或提交用户已有的 `.gitignore` 修改。
- 只接受 `vMAJOR.MINOR.PATCH` 及可选 prerelease 后缀作为 image release tag。

## Build

### 更新日志

- 2026-07-23 19:24：确认当前/目标分支均为 `main@8997d77`，与 `origin/main` 对齐；工作区仅有用户原有 `.gitignore` 修改并继续排除。确认 Docker Hub 目标仓库为 `chenxuan520/last-line`，GitHub Actions 中 `DOCKERHUB_USERNAME` 与 `DOCKERHUB_TOKEN` 两个 Secret 名称均已存在，错误的 `CHENXUAN520` Secret 已按用户要求删除。现有工程质量 plan 明确排除 registry push，因此为本任务新建独立 plan。
- 2026-07-23 19:27：完成 tag image 发布链路。`publish-docker-image` 仅在 `v*` tag 上、现有完整 build/container smoke 成功后运行；先校验 SemVer tag，再通过 Docker 官方 QEMU/Buildx/login/metadata/build-push actions 构建并推送 `linux/amd64,linux/arm64` image。稳定版生成 version/minor/major/`latest`，预发布版不移动 `latest`；GitHub Release 改为等待 image push 成功。README 增加 Docker Hub 入口，AGENTS 与部署文档补齐凭证、平台、标签、失败顺序和直接拉取约束。YAML 解析、发布脚本 shell 语法、有效/无效 tag 表格校验及 `git diff --check` 已通过；尚待完整项目门禁和 reviewer。
- 2026-07-23 19:31：完整本地门禁通过：`npm run typecheck`；应用 34 files / 317 tests、Worker 4/30、standalone 3/20（共 367 tests）；browser、Worker dry-run、standalone server builds；全部产物预算和 `git diff --check`。预算值为 entry `1,022,686/1,075,000`、最大异步块 `613,551/650,000`、全部 JS `3,719,341/3,900,000`、252/260 chunks、CSS `43,052/45,000`、dist `4,239,689/4,450,000`、Worker `385,045/400,000`、server `407,225/425,000`。本机无 Docker，无法本地重复 image smoke；现有 tag workflow 会先在 GitHub runner 上完成 production image smoke，再允许 Docker Hub publish。尚待 reviewer 和远端 tag 实测。
- 2026-07-23 19:36：逐条确认并采纳 reviewer Round 1 的 High/Medium。Image destination 现固定为 plan 契约中的 `docker.io/chenxuan520/last-line`，与登录账号 Secret 解耦，避免误配凭证时发布到错误 namespace。移除不完整的自定义 SemVer 正则，改由已用于 tag 生成的 `docker/metadata-action` SemVer parser 作为单一语法来源，并在登录 Docker Hub 前强制要求其生成非空 tags；因此合法的连续连字符 prerelease 可通过，纯数字前导零 prerelease 会失败，且失败发生在使用 registry 凭证之前。待定向验证和复审。
- 2026-07-23 19:40：确认 reviewer Round 2 Medium 成立并修正。保留 metadata-action 负责 SemVer 解析，但在同一登录前 gate 显式拒绝包含 `+` build metadata 的 Git tag，避免 `v1.2.3+build.7` 与其他 build 版本共同覆盖 `1.2.3`/minor/major/`latest` aliases。部署文档已明确仅支持稳定版或 prerelease，build metadata 会因 alias 冲突被拒绝。待定向验证和复审。
- 2026-07-23 19:45：reviewer Round 3 返回 `No findings`，Round 1/2 的 High/Medium 均已闭环；最终定向 YAML/tag gate/`git diff --check` 通过。本次 workflow、文档、plan 和完整 review 记录将以同一交付 commit 推送，避免另建 plan-only 小提交；随后使用与 `package.json` 一致且未占用的 `v0.1.0` tag 执行首次真实 Docker Hub 多架构发布验证，远端运行结果按既有约定在对话汇报。
- 2026-08-02 23:58：按用户要求参考 roadbook 增加编译期版本字段。首页原 `SINGLE PLAYER / 49 AI` 位置改为 `VERSION <build version>`；Vite 优先读取显式 `APP_VERSION`，否则使用 `git describe --tags --always`，失败才显示 `dev`。GitHub Actions checkout 改为完整历史，branch/tag browser artifact 可直接获得 Git 版本；CI Docker smoke 通过 `git describe` build arg 注入，tag 多架构 image 通过 `github.ref_name` 注入，Dockerfile 在无 build arg 时保守回退 `dev`。部署文档补充直接 Docker 构建命令。验证结果：显式 `v9.8.7-test` 与 fallback `v0.1.1-2-g61d8e1a` 均实际进入 bundle；typecheck 全通过，unit 41 files / 364 tests、Worker 重跑 4/31、standalone 3/20 通过；Worker dry-run、standalone/browser/server builds、预算和 YAML/diff check 通过。首次完整 Worker 尾用例出现一次既有 `room is not initialized` 隔离竞态，独立重跑整套 Worker 31 项通过；本轮未修改 Worker。静音 production preview 确认首页显示 `VERSION v0.1.1-2-g61d8e1a`，桌面与 390×844 移动视口均无横向溢出，console 无 error/warn；页面与 preview 已清理，仅保留 `about:blank`。本机无 Docker，真实 build-arg/image smoke 留给 push 后 GitHub runner。
- 2026-08-03 00:04：采纳 reviewer Round 4 Medium：同一 commit 存在多个 tag 时 `git describe` 不保证选择当前触发 tag，可能导致 release ZIP / CI Docker smoke 与最终发布 image 的页面版本不一致。CI 新增单一 `Resolve application version` 步骤：tag build 精确使用 `GITHUB_REF_NAME`，branch/PR 使用 `git describe --tags --always`；browser build 与 CI Docker smoke 复用同一 step output，tag 多架构 publish 继续使用同一 `github.ref_name`。部署文档已同步精确语义。按用户要求同步根规则：尽量避免 plan-only commit，代码审查通过后先补齐关联 plan/工程文档再与实现一起提交；不改变可执行行为/契约/安全/部署的纯文档或 plan 记录无需独立 reviewer，workflow、Dockerfile、构建脚本和运行配置仍视为可执行改动。等待 workflow 修正复审。

## Review

### 2026-07-23 19:33:37 +0800 — Round 1

- 审查范围：以 `8997d77` 为基线，对照本 plan 审查未提交的 `.github/workflows/ci.yml`、`AGENTS.md`、`README.md`、`docs/deployment.md` 及本 plan；明确排除且未改动用户已有的 `.gitignore` 修改。
- 审查结论：**不通过**，存在 1 个 High、1 个 Medium finding。
- **High（待 builder 处理）— `.github/workflows/ci.yml:185`：** 发布地址由 `DOCKERHUB_USERNAME` Secret 动态拼接，而不是固定为 plan 和文档承诺的 `docker.io/chenxuan520/last-line`。Secret 一旦误配为另一个有写权限的账号，workflow 可成功把镜像推到错误 namespace，随后仍创建 GitHub Release。应将镜像目标与登录身份解耦并固定目标；凭证仍只从既定 Secrets 读取。
- **Medium（待 builder 处理）— `.github/workflows/ci.yml:161`：** 自定义 tag 正则不等价于 SemVer prerelease 语法：会接受 SemVer 禁止的纯数字前导零 tag（如 `v1.2.3-01`），并拒绝 SemVer 允许的含连续连字符 prerelease（如 `v1.2.3-alpha--beta`）。当前 `docker/metadata-action@v5` 会再次严格校验并阻止前一类 tag 实际 push，但显式验证门禁本身不可靠、有效发布会被误拒，且安全性不应依赖后续 action 的隐式行为。应使用与 SemVer 一致的校验并补齐边界样例。
- 已验证：确认当前分支/HEAD/merge-base 均为 `main@8997d77`；检查目标 diff 与 `git diff --check`；Ruby 成功解析 workflow YAML；提取后的 tag 校验脚本通过 `bash -n`；运行有效/无效 tag 矩阵并用仓库现有 `semver` 包交叉验证上述边界；核对 `docker/metadata-action@v5` 官方文档和源码，确认稳定版的 version/minor/major/`latest`、prerelease 仅 version 且不更新 `latest` 的行为；静态核对 `needs` 失败顺序、双平台、GHA cache、job permissions、Docker Hub login 和文档。
- 验证缺口：本轮未访问 Secrets、未推送/tag/commit、未运行浏览器；本机无 Docker，未重复远端多架构 push 或容器 smoke，参考 Build 中已记录的完整本地门禁结果及现有 CI smoke 顺序。

### 2026-07-23 19:39:10 +0800 — Round 2

- 审查范围：重新读取本 plan，以 `8997d77` 为基线复审更新后的 workflow、文档及 Round 1 dispositions；继续明确排除且未改动用户已有的 `.gitignore` 修改。
- Round 1 High disposition：**已解决**。`.github/workflows/ci.yml:164` 已把 destination 固定为 `docker.io/chenxuan520/last-line`，登录仍仅在 `.github/workflows/ci.yml:192-193` 使用 `DOCKERHUB_USERNAME` 与 `DOCKERHUB_TOKEN` 两个 Secrets。
- Round 1 Medium disposition：**已解决其报告的边界问题**。`.github/workflows/ci.yml:160-181` 先用 `docker/metadata-action@v5` 的 SemVer parser 生成 tags，再以非空 gate 拒绝无效输入；gate 位于 QEMU/Buildx/login 之前。独立验证确认 `v1.2.3-01` 生成空 tags 并在登录前失败，`v1.2.3-alpha--beta` 生成非空 prerelease tag 并可继续。
- 审查结论：**不通过**，发现 1 个新的 Medium finding。
- **Medium（待 builder / writer 处理）— `.github/workflows/ci.yml:160-181`、`docs/deployment.md:36-42`：** 非空 tags gate 接受完整 SemVer 中的 build metadata，但 plan 明确只允许 `vMAJOR.MINOR.PATCH[-prerelease]`。例如 `v1.2.3+build.7` 会被 metadata-action 接受并归一化成稳定 aliases `1.2.3`、`1.2`、`1`、`latest`；另一条带不同 build metadata 的 Git tag 也会写入同一组 Docker tags，从而可覆盖既有版本并让 GitHub Release tag 与 image tag 无法一一对应。应在保留 metadata-action 作为 SemVer parser 的同时显式拒绝 `+build` suffix，并把部署文档中的受支持 tag 格式写准确。
- 已验证：workflow YAML 解析、validation shell 语法及空/非空 gate；固定 destination、两个 Secret 引用和 metadata → validation → QEMU → Buildx → login → push 顺序；`needs: build` 与 release 对 `[build, publish-docker-image]` 的依赖；`linux/amd64,linux/arm64`、稳定/预发布 aliases、`latest` 规则、GHA cache 配置和 job permissions；用仓库现有 `semver` 包及 `docker/metadata-action@v5` 官方源码交叉验证 numeric-leading-zero、consecutive-hyphen 和 build-metadata 行为；`git diff --check` 通过。
- 验证缺口：未访问 Secrets，未 commit/push/tag，未运行浏览器；本机无 Docker，未执行真实多架构 registry push，继续参考 Build 中已记录的完整项目门禁和 CI container smoke 顺序。

### 2026-07-23 19:44:30 +0800 — Round 3

- 审查范围：重新读取完整 plan，以 `8997d77` 为基线复审 `.github/workflows/ci.yml`、`AGENTS.md`、`README.md`、`docs/deployment.md` 和全部既有 finding dispositions；继续排除且未改动用户已有的 `.gitignore` 修改。
- Round 1 High disposition：**已解决**。Destination 固定为 `docker.io/chenxuan520/last-line`，登录身份仍只读取 `DOCKERHUB_USERNAME` 与 `DOCKERHUB_TOKEN` Secrets。
- Round 1 Medium disposition：**已解决**。metadata-action 的 SemVer parser 与登录前非空 tags gate 会拒绝 numeric-leading-zero prerelease，并接受 consecutive-hyphen prerelease。
- Round 2 Medium disposition：**已解决**。`.github/workflows/ci.yml:172-185` 在 Docker Hub login 前显式拒绝任何包含 `+` 的 tag，即使 metadata-action 已生成 aliases；稳定版和 prerelease 仍分别通过。`docs/deployment.md:42` 已准确说明 build metadata 会因多个 Git tags 覆盖相同 Docker aliases 而被拒绝。
- 审查结论：**通过；本次审查未发现明确问题。** 未发现新的 blocker/high/medium/low finding。
- 已验证：workflow YAML 与 validation shell；`v1.2.3`、`v0.2.0`、`v1.2.3-rc.1`、`v1.2.3-alpha--beta` 成功路径，以及 `v1.2.3-01`、stable/prerelease `+build` 失败路径；metadata → validation → QEMU → Buildx → login → push 顺序；固定 destination 与 Secrets 隔离；`linux/amd64,linux/arm64`；稳定 version/minor/major/`latest` 和 prerelease-only aliases；GHA cache；publish/release/Pages job permissions；publish 对完整 build/container smoke 的依赖，以及 release 对 image push 成功的依赖；README/AGENTS/deployment 文档；`git diff --check` 通过。
- 残余验证缺口：本机无 Docker，未执行真实多架构 registry push；未访问 Secrets，未 commit/push/tag，未运行浏览器。远端首次 tag 发布仍需由 GitHub runner 实际验证 Docker Hub 登录、manifest push 和失败顺序。

### 2026-08-03 — Build-version review (Round 4)

- 审查范围：相对 `main@61d8e1a` 的 Vite 编译期版本、首页 footer、CI checkout/build/Docker smoke、tag image build arg、Dockerfile、部署文档和本 plan；排除用户 staged `.gitignore`。接受已记录的 typecheck/tests/builds/budgets/browser 证据，未重复完整门禁。
- 结论：不通过；发现 1 项 Medium，无 blocker/high/low。
- **Medium — `.github/workflows/ci.yml:42-58,203-212`：** tag browser artifact 与 CI Docker smoke 使用 `git describe`，发布的多架构 image 使用 `github.ref_name`。同一 commit 存在多个 tag 时，`git describe` 可能选到另一个 tag；定向诊断对同一提交创建 `v1.2.3` 与 `v1.2.4` 后返回 `v1.2.3`，会导致 release ZIP/smoke 与发布 image 的页面版本不一致。tag build 应明确复用当前 `GITHUB_REF_NAME`，branch/PR 可继续使用 Git fallback。

### 2026-08-03 00:04 — Round 4 disposition

- **采纳并修复 Medium：** build job 先解析唯一 application version；tag ref 精确取 `GITHUB_REF_NAME`，其他 ref 才运行 `git describe`。后续 browser build 和 Docker smoke 只消费该 step output；publish job 的 `APP_VERSION=${{ github.ref_name }}` 与 tag build 保持一致。
- **文档与规则：** 部署文档同步 tag/branch 版本来源；根 `AGENTS.md` 增加“先补文档再随实现提交、避免 plan-only commit”及“纯文档/plan 免独立 review，但 executable config 不免”的规则。本 disposition 与规则文档将和版本实现一起提交，不创建纯 plan commit。

### 2026-08-03 — Build-version re-review (Round 5)

- 审查范围：重读本 plan 后复审 Round 4 workflow 修正、Vite/Docker 版本注入、部署文档和根 `AGENTS.md` 新交付规则；排除 staged `.gitignore`，未重复完整门禁。
- Round 4 Medium：**已关闭。** tag ref 的 browser artifact 与 CI Docker smoke 现在都精确使用当前 `GITHUB_REF_NAME`，branch/PR 才使用 `git describe`；tag publish 仍使用同一 ref name。
- 结论：不通过；发现 1 项 High，无 blocker/medium。
- **High — `.github/workflows/ci.yml` Build Docker image：** step output 原本直接插值进 `run:` shell source。合法 Git tag 可包含 `$()`、反引号、引号和分号，恶意 tag 能在 runner 上形成命令注入。必须把 output 通过 step `env` 传入，再在 shell 中以双引号引用环境变量。

### 2026-08-03 — Round 5 disposition

- **采纳并修复 High：** `Build Docker image` 通过 `env.APP_VERSION` 接收 step output，shell 只执行静态命令文本 `--build-arg "APP_VERSION=$APP_VERSION"`；版本字符串不再被拼入 shell source。`docker/build-push-action` 的 tag publish build-arg 属于 action input，不经过 `run:` shell，保持不变。

### 2026-08-03 00:03:10 +0800 — Round 4（build-time version injection）

- 审查范围：重新读取完整 plan、根 `AGENTS.md`、`docs/deployment.md` 和全部目标文件；以当前 `main@61d8e1a`（与 `origin/main`、merge-base 一致）为基线，对照本 plan 的新增 Build 记录及用户本轮版本注入要求审查 `.github/workflows/ci.yml`、`Dockerfile`、`docs/deployment.md`、`src/app/GameApp.ts`、`src/vite-env.d.ts`、`vite.config.ts` 和本 plan；明确排除用户预先 staged 的 `.gitignore`。
- 审查结论：**不通过**，存在 1 个 Medium finding；没有 blocker/high/low finding。
- **Medium（待 builder 处理）— `.github/workflows/ci.yml:42-46,57-58,203-212`：** tag workflow 的 release browser artifact 和前置 Docker smoke 仍以 `git describe --tags --always` 推导版本，而最终多架构 image 以触发事件的 `github.ref_name` 为版本。若同一 commit 上存在多个 tag，`git describe` 不保证选择当前触发 workflow 的 tag，因此 release zip/smoke image 可显示另一个 tag，而发布 image 显示当前 tag，违反“同一语义来源”和 tag artifact 显示精确触发 tag 的要求。定向临时仓库诊断在同一 commit 创建 `v1.2.3`、`v1.2.4` 后得到 `git describe => v1.2.3`，证明该路径不是纯理论风险。builder 应让 tag build 显式使用 `GITHUB_REF_NAME`，并让 browser build、CI smoke 与发布 image 复用该事件版本；branch/PR 仍使用完整 checkout 下的 `git describe` fallback。
- 已静态确认：Vite `define` 使用 `JSON.stringify`，页面在 `innerHTML` 前转义版本字符串；显式 `APP_VERSION`、Git fallback 和 `dev` fallback 顺序正确；Docker `.git` 排除、ARG 传递及 cache invalidation 位置合理；稳定版/prerelease aliases 和发布 image 内显示原始 `v*` tag 的路径正确；正常版本的桌面/移动 footer 验证已有证据；Cloudflare Pages 继续保持相对资源路径和 Git fallback。
- 已参考验证：接受 Build 中记录的 typecheck、41/364 unit、Worker 重跑 4/31、standalone 3/20、各构建、预算、YAML/diff check、两种 bundle version 和静音浏览器验证；未重复完整门禁。仅为上述未覆盖的多 tag 歧义运行了隔离临时 Git 仓库诊断，临时目录已删除。
- 残余验证缺口：本机无 Docker，尚未真实验证 image build/health smoke 和多架构 push；这些仍须由 push 后 GitHub runner 完成。原 plan“不得修改应用”的旧边界已被用户本轮明确的 footer 版本要求覆盖，本轮以较新的明确要求为准。

### 2026-08-03 00:07:11 +0800 — Round 5（version injection re-review）

- 审查范围：重新读取完整 plan（含 Round 4 disposition）、根 `AGENTS.md`、部署文档及相对 `main@61d8e1a` 的全部版本注入目标文件；当前分支、`origin/main` 与 merge-base 均为 `61d8e1a`，继续排除用户预先 staged 的 `.gitignore`。
- Round 4 Medium disposition：**功能语义已解决**。`.github/workflows/ci.yml:36-45` 对 tag ref 精确输出 `GITHUB_REF_NAME`，对 branch/PR 输出完整 checkout 下的 `git describe --tags --always`；`.github/workflows/ci.yml:53-58,69-70` 的 browser build 与 CI Docker smoke 消费同一 step output，`.github/workflows/ci.yml:215-224` 的 tag 多架构 image 继续精确使用 `github.ref_name`。多 tag commit 不再导致正常 tag release 的三类 artifact 版本分叉。
- 审查结论：**不通过**，发现 1 个新的 High finding；没有 blocker/medium finding。
- **High（待 builder 处理）— `.github/workflows/ci.yml:69-70`：** `steps.app-version.outputs.version` 被 GitHub expression 直接拼进 `run:` shell 源码。该值可来自 tag ref 或 `git describe` 的 tag 名，而合法 Git ref 可包含 `"`、`$()`、反引号和分号；例如 `v$(command)` 会在 runner 解析 `docker build --build-arg "APP_VERSION=..."` 时执行命令替换。publish job 的 SemVer gate 在后续独立 job，无法保护 build job，branch/PR fallback 也可能命中带 shell 元字符的已有 tag。攻击者若有 tag 创建权限，可在 CI runner 执行任意命令并篡改随后构建/上传的 artifact。builder 应通过 step-level `env` 传入该 output，再在 shell 中引用已展开的环境变量，不能把不可信 output 直接插值进 `run` 文本。
- 已静态确认：resolve step 的 tag/branch/PR 分支和单行 `$GITHUB_OUTPUT` 格式正确，browser build 的 `env` 传值安全；完整 checkout、Docker ARG/cache invalidation、tag publish build arg、Vite `JSON.stringify` define、HTML 转义、Cloudflare/local fallback 和部署文档均与要求一致。根 `AGENTS.md:92-93` 准确覆盖避免 plan-only commit、实现/review 后先更新 plan/docs 并尽量同 commit，以及纯非可执行文档免 review、workflow/Docker/build/runtime config 仍需 review 的边界。
- 已参考验证：接受 tag `v1.2.4`、branch `v0.1.1-2-g61d8e1a` 模拟以及 YAML parse、diff check；未重复完整 suites。仅针对未覆盖的 shell 注入风险运行 `git check-ref-format --normalize`，确认 `refs/tags/v\";id;#`、`refs/tags/v$(id)`、`refs/tags/v\`id\`` 均是 Git 接受的 ref，未创建或修改任何 ref。
- 残余验证缺口：本机仍无 Docker；真实 image build/health smoke 和多架构 push 继续由 push 后 GitHub runner 验证，但在上述 High 关闭并复审前不得提交或推送。

### 2026-08-03 00:10:16 +0800 — Round 6（final version injection re-review）

- 审查范围：重新读取完整 plan（重点包括 Round 5 finding/disposition），以 `main@61d8e1a` 为基线复审版本解析、browser/Docker 注入、tag publish、Vite/页面转义、部署文档与根 `AGENTS.md` 交付规则；继续排除用户预先 staged 的 `.gitignore`。
- Round 5 High disposition：**已解决**。`.github/workflows/ci.yml:69-72` 通过 step `env.APP_VERSION` 接收 resolve output，`run` 保持静态 shell source 并仅以双引号展开 `"APP_VERSION=$APP_VERSION"`；payload 中的命令替换、反引号、引号和美元符号均作为单个 build-arg 的数据传递，不再参与 shell 解析。workflow 中不存在其他把 version/ref/output expression 直接拼入 `run:` 的等价路径；`.github/workflows/ci.yml:217-229` 的 `docker/build-push-action` build-args 是 action input，不经 shell，且发布前仍受 SemVer gate 约束。
- 审查结论：**通过；本次审查未发现明确问题。** 未发现 blocker/high/medium finding。
- 已静态确认：完整 checkout 支持 branch/PR 的 `git describe --tags --always`；tag build 精确使用 `GITHUB_REF_NAME`；browser build 与 CI Docker smoke 复用唯一 resolve output，tag 多架构 image 使用同一 `github.ref_name`；Docker ARG 会使 build layer 随版本失效且不破坏前置依赖 cache；Vite `JSON.stringify` define 与页面 HTML 转义安全；部署文档与实现一致；根 `AGENTS.md:92-93` 的 plan/docs 同提交及纯文档免 review / executable config 必须 review 边界符合要求。
- 已参考验证：接受恶意外观 payload 经环境变量和 mock docker shell 调用后保持惰性数据、YAML parse 与 diff check 通过的定向证据；接受此前 plan 记录的完整 suites/build/budget/browser 证据，本轮未重复执行。
- 残余验证缺口：本机无 Docker，真实 image build、只读容器 `/health` smoke 与多架构 push 仍须由 push 后 GitHub runner 完成。
