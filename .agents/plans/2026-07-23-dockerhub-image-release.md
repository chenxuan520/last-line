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
