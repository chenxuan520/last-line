# 部署指南

生产前端产物是 `npm run build` 生成的静态 `dist/`。Vite 使用相对资源 URL，因此同一产物既能部署在 GitHub 仓库子路径，也能部署在 Cloudflare Pages 根域。菜单页脚版本优先从构建时的 `APP_VERSION` 注入，否则使用 `git describe --tags --always`。CI 会检出完整历史：tag 构建使用精确 Git ref 名，分支和 PR/MR 构建使用 `git describe`。

## GitHub Actions 与 GitHub Pages

`.github/workflows/ci.yml` 在所有分支 push、所有指向 `main` 的 PR/MR、匹配 `v*` 的版本 tag 和手动触发时运行构建任务：

1. 使用 Node.js 24 按 lockfile 安装依赖。
2. 运行 TypeScript 检查。
3. 运行 Vitest。
4. 构建 `dist/`。
5. 以 dry-run 方式把 `lastlinep2p` Worker 打包到已忽略的 `dist-worker/`。
6. 类型检查并把 standalone Node 服务打包到已忽略的 `dist-server/`。
7. 对三套生产产物执行已签入的原始字节和 chunk 数量预算。
8. 构建 production Docker image，以只读文件系统和临时可写挂载运行，并要求精确 `/health` 响应。
9. 只有 `main` 通过 GitHub Pages OIDC 部署静态产物。

功能分支 push 运行相同核心 typecheck、test、build、budget、Worker dry-run、standalone bundle、Docker build 和容器 smoke，但不部署 GitHub Pages，也不发布 release image。部署和发布任务继续由现有 `main` 与 tag 条件保护。

仓库 secret 不保存部署 token。预期站点地址：

```text
https://chenxuan520.github.io/last-line/
```

## GitHub 发布

推送匹配 `v*` 的版本 tag，会在发布 GitHub Release 前运行相同 typecheck、test 和 build 门禁：

```bash
git tag v0.2.0
git push origin v0.2.0
```

Workflow 把 production `dist/` 打成 `last-line-v0.2.0.zip`，创建带自动说明的 release 并附加压缩包。Tag 构建不部署 GitHub Pages。发布任务使用 workflow 短期 `GITHUB_TOKEN`，不需要额外 release secret。

相同 typecheck、test、build、budget、production image 和容器健康门禁通过后，合法语义版本 tag 还会把 standalone image 发布到：

```text
docker.io/chenxuan520/last-line
```

稳定 tag `v1.2.3` 会为 `linux/amd64` 与 `linux/arm64` 发布 `1.2.3`、`1.2`、`1`、`latest`。预发布 `v1.2.3-rc.1` 只发布预发布版本，不移动 `latest`。`v1.2.3+build.7` 这类 SemVer build metadata 会被拒绝，避免多个 Git tag 覆盖同一 Docker 别名。Docker Hub 使用仓库 secret `DOCKERHUB_USERNAME` 和 `DOCKERHUB_TOKEN`；token 需要读写权限，禁止提交或打印。GitHub Release 等待 image push，因此 registry 失败不会留下缺少匹配 image 的成功 release。

Docker build 通过 `APP_VERSION` build argument 接收同一浏览器版本。Release image 使用 Git tag；CI 分支 image 使用 `git describe --tags --always`。本地直接构建时必须显式传入，因为 `.git` 不在 Docker context 中：

```bash
docker build --build-arg "APP_VERSION=$(git describe --tags --always)" -t last-line .
```

## Cloudflare Pages Git 集成

必须通过 dashboard 创建 Cloudflare 项目，禁止使用 Wrangler Direct Upload。Cloudflare 不允许 Direct Upload 项目后续转换为 Git 集成。

1. 在 Cloudflare dashboard 打开 **Workers & Pages**。
2. 选择 **Create application** > **Pages** > **Connect to Git**。
3. 选择 GitHub 仓库 `chenxuan520/last-line`。
4. 使用以下构建设置：

| 设置 | 值 |
| --- | --- |
| 项目名 | `last-line` |
| 生产分支 | `main` |
| 框架预设 | `Vite` |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| 根目录 | `/` |

5. 构建镜像没有自动从 `package.json` 选择版本时，为 production 和 preview 添加 `NODE_VERSION=24`。
6. 保存并部署。

首次构建后的默认域名：

```text
https://last-line.pages.dev/
```

生产自定义域名：

```text
https://lastline.011203.xyz/
```

在 Pages 的 **Custom domains** 中添加代理 CNAME：

| 类型 | 名称 | 目标 |
| --- | --- | --- |
| `CNAME` | `lastline` | `last-line.pages.dev` |

之后每次 push 到 `main` 都会自动更新生产环境。启用 preview branch deployment 后，PR/MR 和非生产分支可获得 Cloudflare preview。

Cloudflare Git 集成不需要 GitHub secret `CLOUDFLARE_API_TOKEN` 或 `CLOUDFLARE_ACCOUNT_ID`。仓库访问由 Cloudflare Pages GitHub App 管理。

## Cloudflare `lastlinep2p` Worker

联机后端与 Pages 分离。`wrangler.worker.jsonc` 定义 production `LobbyDirectory`、`GameRoom`、`AccountDirectory`、`AdminDirectory` SQLite Durable Object；不得替换 Pages 项目配置。玩家注册/登录由 Worker 暴露，并由管理员全局入场开关控制。同源管理终端位于 `/admin`。

本地开发：

```bash
npm run dev:worker
npm run dev
```

Worker 验证：

```bash
npm run types:worker
npm run typecheck:worker
npm run build:worker
npm run test:multiplayer:production
```

`test:multiplayer:production` 先在最多 120 秒内轮询公共 Worker 无副作用 `/health` 协议 header，让新部署版本传播到自定义域。Transport error 和 Cloudflare 502/503/504 只能在同一有界时间内重试；无效响应和持续失败仍使部署失败。Marker 匹配源码 `MULTIPLAYER_PROTOCOL_VERSION` 后，smoke 只创建 1 个私有 production 房间，打开返回的 WebSocket，要求匹配的 `welcome` 和等待房成员状态，然后确认并离开。禁止重试访客创建、房间创建、WebSocket、大厅或离开失败。每次 production Worker 或 Pages 部署后都运行。`MULTIPLAYER_SMOKE_URL` 和 `MULTIPLAYER_SMOKE_ORIGIN` 可覆盖默认值。有界定时 GitHub Actions 用于发现持续漂移，只是告警，不是部署顺序门禁。

Worker 和 Pages 独立部署，严格协议不支持混合滚动发布。协议变化必须使用维护发布：

1. 在 production Pages 禁用新联机入口并等待部署完成。
2. 用管理员房间列表排空或关闭活动房；通知已打开旧标签页维护后必须刷新。
3. 部署 Worker，并运行 `npm run test:multiplayer:production`。
4. 部署匹配的 Pages 客户端并等待完成。
5. 重新启用联机入口，再次运行 production smoke，并在音量 `0` 的 Chrome/Edge 中验证入房。

禁止把定时 smoke 或仓库 CI 描述成 Cloudflare 两次部署间的原子门禁。维护期间仍存活的旧标签页必须收到明确协议不匹配刷新消息，通用连接关闭标签不得覆盖它。

从同一仓库创建独立 Cloudflare Workers Builds 项目：

| 设置 | 值 |
| --- | --- |
| Worker 名称 | `lastlinep2p` |
| 生产分支 | `main` |
| 构建命令 | `npm ci && npm run typecheck:worker && npm run test:worker && npm run build:worker` |
| 部署命令 | `npx wrangler deploy --config wrangler.worker.jsonc && npm run test:multiplayer:production` |
| Node 版本 | `24` |

部署后的 Worker 使用 `https://lastlinep2p.011203.xyz`，禁止复用 Pages CNAME。公开非 secret 端点和 `VITE_MULTIPLAYER_ENABLED=true` 提交在 `.env.production`。GitHub Actions 把该标志覆盖为 `false`，所以 GitHub Pages 保持无联机按钮的单机静态演示。本地浏览器只在 localhost 回退到 `http://127.0.0.1:8787`。

Workers Builds 管理部署访问，因此仓库或 GitHub Actions 不添加长期 Cloudflare token。

每次 `main` push 都要求 Workers Builds，包括看似只改客户端的提交，因为共享协议导入仍可能要求匹配 Worker 产物。Pages 部署不代表 Worker 部署。每次修改 Worker/共享联机/协议后：

1. 运行 `npx wrangler deployments status --config wrangler.worker.jsonc`，确认本发布有新 production 时间戳/ID。
2. 运行 `npm run test:multiplayer:production`，要求真实入房、WebSocket welcome、协议、大厅成员状态和离开流程通过。
3. 在当前 plan 或发布记录中记录 Worker 版本 ID 和 smoke 结果。

Workers Builds 不可用或失败时使用 `npm run deploy:worker`。该命令有意把 Worker typecheck、Worker tests、dry-run bundle、production 部署和公共联机 smoke 组成一个验证 fallback。正常发布禁止使用裸 `wrangler deploy`，公共 Worker 仍是旧版本时禁止报告完成。

### 管理终端 secret

部署管理终端前，生成两个相互独立的随机值并保存为 Worker secret。禁止提交任何一个值：

```bash
openssl rand -base64 32
npx wrangler secret put INTERNAL_ADMIN_TOKEN --config wrangler.worker.jsonc

openssl rand -base64 32
npx wrangler secret put ADMIN_BOOTSTRAP_TOKEN --config wrangler.worker.jsonc
```

`INTERNAL_ADMIN_TOKEN` 是管理员、账号、大厅和房间 Durable Object 之间的永久 capability。`ADMIN_BOOTSTRAP_TOKEN` 是临时值。部署后：

1. 打开 `https://lastlinep2p.011203.xyz/admin`。
2. 输入 Bootstrap Token，并设置首个管理员用户名和密码。
3. 确认管理员登录成功。
4. 立即删除 bootstrap secret：

```bash
npx wrangler secret delete ADMIN_BOOTSTRAP_TOKEN --config wrangler.worker.jsonc
```

删除 bootstrap secret 不会删除管理员。首个管理员存在后，bootstrap 端点也会永久拒绝再次初始化。

系统只支持 1 个管理员。管理终端支持正常改密。忘记密码时创建临时恢复 secret：

```bash
openssl rand -base64 32
npx wrangler secret put ADMIN_RESET_TOKEN --config wrangler.worker.jsonc
```

重新加载 `/admin`，选择**忘记密码**，输入 token 和新密码，确认登录后立即删除 secret：

```bash
npx wrangler secret delete ADMIN_RESET_TOKEN --config wrangler.worker.jsonc
```

每个 reset token 值在 `AdminDirectory` 中只能使用一次，即使延迟删除 secret 也一样。设置新的随机 secret 会创建新的单次恢复凭据。

Cloudflare Turnstile 可选。两个值都不设置即关闭。以后启用时，创建只允许 `lastlinep2p.011203.xyz` 的 widget，并同时配置两个值；只配置一个会让管理页 fail-closed：

```bash
npx wrangler secret put TURNSTILE_SITE_KEY --config wrangler.worker.jsonc
npx wrangler secret put TURNSTILE_SECRET_KEY --config wrangler.worker.jsonc
```

Turnstile 只是密码哈希、持久限流、同源修改检查、HttpOnly cookie 和内部 capability secret 的补充。

## Standalone Node.js 部署

Standalone 模式在 1 个 Node.js 24 进程中运行静态站点、公共 API、WebSocket 房间、管理终端、权威模拟和持久化。它不使用 Durable Objects、Workers KV、D1、R2 或 Cloudflare compute。Cloudflare 与 standalone 共享网关、目录类、房间规则、认证规则、协议和 `MatchRuntime`；只适配存储、alarm、socket 和进程生命周期。

Standalone 有意只支持 1 个服务和 1 个 Node 进程。独立 SQLite 数据库在进程存活时持有 OS 排他锁；即使锁数据库文件保留，崩溃也会自动释放锁。Cloudflare 与 standalone 数据库相互独立，不自动迁移账号或活动房间。

### 本机构建与运行

```bash
npm ci
cp .env.standalone.example .env.standalone
openssl rand -base64 32
# 把生成值写入 ADMIN_BOOTSTRAP_TOKEN，并设置 SERVER_PUBLIC_ORIGIN。
npm run build:standalone
npm run start:server
```

`build:standalone` 使用 `VITE_MULTIPLAYER_URL=same-origin` 编译浏览器，再打包 Node 服务。存在 `.env.standalone` 时，`start:server` 会读取它。默认数据目录为 `data/`，包含 `last-line.sqlite`、SQLite WAL 文件和 `.server-lock.sqlite`。关闭后锁数据库文件可以保留，只有存活 OS 锁表示所有权。禁止把该目录放在临时文件系统。

源码开发时，先用 `npm run build:standalone` 生成 same-origin `dist/`，再运行 `npm run dev:server`。Watch 进程会重载服务端源码但不重建浏览器资源；standalone 是全栈服务，因此仍要求有效静态目录。`npm run dev:worker` 和 `npm run dev:server` 是替代后端，默认都使用 8787 端口，禁止在同一端口同时运行。

### Standalone 环境变量

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `SERVER_MODE` | `standalone` | Node 入口必须为 `standalone`。平台选择必须位于玩法代码之外。 |
| `SERVER_HOST` | `127.0.0.1` | 监听地址；容器内使用 `0.0.0.0`。 |
| `SERVER_PORT` | `8787` | HTTP 与 WebSocket 端口。 |
| `SERVER_PUBLIC_ORIGIN` | `http://127.0.0.1:<port>` | 外部可见且无 path 的 HTTPS origin。反代后必须设置，保证同源检查正确。 |
| `SERVER_DATA_DIR` | `data` | 持久 SQLite 和锁目录。 |
| `SERVER_STATIC_DIR` | `dist` | Node 提供的浏览器 production build。 |
| `SERVER_TRUST_PROXY` | `false` | 是否信任第一个 `X-Forwarded-For`。示例默认关闭；只有所有直连都来自可信代理时才能启用。 |
| `ALLOWED_ORIGINS` | 空 | 额外逗号分隔浏览器 origin；同源自动加入。 |
| `ADMIN_BOOTSTRAP_TOKEN` | 空 | 临时首个管理员 token；初始化后删除并重启。 |
| `ADMIN_RESET_TOKEN` | 空 | 临时单次密码恢复 token；使用后删除并重启。 |
| `TURNSTILE_SITE_KEY` | 空 | 可选 Cloudflare Turnstile site key。 |
| `TURNSTILE_SECRET_KEY` | 空 | 可选 Cloudflare Turnstile secret；两个 Turnstile 值必须同时存在或同时缺失。 |

每次 standalone 启动都在内存生成 `INTERNAL_ADMIN_TOKEN`，因为所有内部调用留在同一进程，且不公开 `/internal/*` 路由。

### Docker Compose

```bash
cp .env.standalone.example .env.standalone
# 设置 SERVER_PUBLIC_ORIGIN 和 ADMIN_BOOTSTRAP_TOKEN。
docker compose -f docker-compose.standalone.yml up -d --build
```

Image 构建 same-origin 浏览器产物和打包后的 Node 服务，以非特权 `node` 用户运行，把 SQLite 存在命名卷 `last-line-data`。`LAST_LINE_PORT` 只改变宿主机发布端口，容器仍监听 8787。

也可以直接拉取已发布版本。生产环境应固定版本，禁止依赖 `latest`：

```bash
docker pull chenxuan520/last-line:1.2.3
```

发布 image 与 Compose 构建合同相同：把持久可写卷挂到 `/data`，暴露容器 8787，设置 `SERVER_PUBLIC_ORIGIN` 为外部 HTTPS origin，并提供必需 standalone 环境变量。Image 以非特权 `node` 用户运行；禁止仅为逃避卷权限修复而改成 root runtime。

GitHub Actions 在无凭据情况下执行 `docker build`，再以只读根文件系统、`no-new-privileges` 和临时 `/tmp`、`/data` 挂载启动 image。容器没有返回精确 standalone 健康响应时，Pages 部署和 release 打包不能继续。只有已验证版本 tag 才由独立最小权限任务登录 Docker Hub 并发布多架构 image。

### TLS 反向代理

生产账号和管理员 cookie 使用 `Secure` 与 `__Host-`，因此生产必须 HTTPS。最小 Caddy 配置：

```caddyfile
game.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

设置：

```text
SERVER_PUBLIC_ORIGIN=https://game.example.com
SERVER_TRUST_PROXY=true
```

Caddy 和 Nginx 的标准反代配置会自动代理 WebSocket upgrade。`SERVER_TRUST_PROXY=true` 时禁止暴露绕过可信代理的其他监听器。

### 持久化、重启与备份

- 账号、管理员状态、入场策略、访客、房间状态、重连凭据、alarm deadline 和比赛 checkpoint 全部本地保存。
- 运行中比赛约每秒 checkpoint。SIGINT/SIGTERM 先停止房间循环并提交 checkpoint，再最多用 2 秒排空 HTTP/WebSocket 后再次提交。Compose 在 SIGKILL 前给 30 秒。异常重启后，运行房从最新已提交 checkpoint 恢复。
- 重连 token 只有客户端确认 replacement welcome 后才轮换；窗口期内旧 token 与 pending token 都可用，因此 welcome 送达前断线仍可恢复。
- Checkpoint 保存权威比赛状态，但不保存所有瞬态控制器/输入对象；崩溃恢复不承诺与不中断执行逐位一致。
- 简单复制文件前先停服务，或使用包含 WAL 状态的 SQLite-aware online backup。定期在独立数据目录测试恢复。
- 数据目录和 `.env.standalone` 禁止进入源码控制。使用宿主文件权限和正常异地备份保护。
- 升级时优雅停止唯一进程，替换 `dist/` 和 `dist-server/`，再启动。禁止旧新进程重叠访问同一数据目录。

### Standalone 验证

```bash
npm run typecheck:server
npm run test:server
npm run test:performance
npm run build
npm run build:worker
npm run build:server
npm run check:budgets
curl https://game.example.com/health
```

每个 PR/MR 额外运行独立 `performance` job：在同一 Node.js 24 / Chrome runner 中分别构建 `origin/main` 与 PR HEAD，双方先预热，再交替采样 3 轮并取中位数。门禁监控三张地图的场景启动、heap、Mesh 创建/移除、最终 Mesh/material/geometry/vertex/index，以及灰炉城高画质 production Chrome 的进场延迟、稳定 FPS、P95/P99 帧时间和长帧数量；任一运行时指标相对 `main` 劣化超过 15% 即失败。报告写入 Actions summary 并作为 artifact 上传。压缩大小不参与该运行时门禁，原始产物大小继续由 `check:budgets` 约束。

Standalone 集成套件验证静态服务、原生 SQLite 账号/管理员持久化、数据目录进程锁、crash-safe alarm 所有权、有界房间实例淘汰、早期 WebSocket close 清理、真实双客户端比赛、优雅 checkpoint、重启和重连。共享 Worker 测试额外覆盖确认前重连 token 宽限。浏览器验收还必须通过真实 HTTPS 代理覆盖注册/登录 cookie 恢复和管理终端。

### 运行指标

指标以单行 JSON 发出，`type: "server_metric"`、`schemaVersion: 1`，不通过 HTTP 暴露。Standalone 写 stdout，供 Docker 或进程管理器收集。Cloudflare 写 Workers Logs，并关闭 invocation logging，避免 WebSocket query 凭据进入调用记录。

| 指标 | 含义 |
| --- | --- |
| `active_rooms` | 新鲜 waiting、countdown 或 running 房间摘要绝对数量。 |
| `tick_delay_ms` | 30 Hz 权威步骤前的调度延迟，汇总 count/sum/max。 |
| `websocket_buffered_bytes` | Standalone 发送后采样的出站队列；Cloudflare 无法获取时增加 `unavailableCount`，禁止报假零。 |
| `checkpoint_duration_ms` | 从 checkpoint 序列化到 `checkpoint-v1` 存储成功/失败的耗时，汇总 count/sum/max。 |

房间摘要通常每 60 秒 flush，也会在 shutdown、finish、强制关闭、runtime 释放和 tick/checkpoint 失败路径 flush。它们有意不含房间码/ID、玩家/账号 ID、IP、URL 或 token。指标尽力而为，绝不影响权威状态或持久化。

## 部署验收

- 任何 production push 前完成 plan 关联的审查/复审闭环；存在未解决 blocker、high、medium 时禁止部署。
- 浏览器检查音量保持 `0`。
- 独立验证单机，再打开两个本地 Chrome/Edge 页面验证快速匹配、50 人 HUD、远端人类表现和重连。
- 验证三张地图。灰炉城必须显示正确 HUD/小地图名、高密工业街区、可达四/五层、56 条权威二层连桥，并在所有联机客户端使用同一地图 ID。烬岚郡必须显示 6 个紧凑不规则命名区域和 5 条短连接道路；所有山完整位于地图内；唯一 `医院` 位于 `赤钟城区`；高密城镇、稀疏农村/草垛和树石位于坡地的山林必须区分；城镇区域生成 8 条 X/Z 双方向短权威连桥，农村/森林不生成。快速匹配不得混合 island/town/mixed 请求。
- 验证建筑本体以矩形为绝大多数，约 12% 为切角六边形、约 6% 为多边形近圆形；医院、弹药库和连桥端点保持矩形。特殊形状必须在外墙、楼板、门窗、楼梯、移动、战斗、导航和渲染中一致。禁止实体屋顶护栏；最多约 15% 普通矩形建筑生成 0.5m 稀疏视觉金属围栏，围栏不可碰撞、不遮挡射击/视线、允许子弹穿透。
- 验证画质隔离，所有地图保持基线光照和 image processing。低/中画质不创建高画质岛屿/城镇批次、高细节角色装备或高画质 HUD。高画质岛屿显示岸边泡沫、道路湿痕、POI 灯；灰炉城显示透明立面玻璃、可读墙纹、道路/立面/屋顶/工业细节和不挡权威开口的装卸口；烬岚郡工业细节只作用于真实城镇建筑和附近城市道路，农村/森林保持自然表现。驾驶舱保持不透明并与城镇玻璃独立。
- 所有地表纹理使用低饱和偏灰 tint，城市、道路、农村和森林不得出现鲜艳黄橙或过艳绿色。Babylon 上传失败时必须保留程序化顶点色，不得变白。
- 粗指针移动设备直接开始/部署点击必须申请全屏并尝试横屏；拒绝后保留竖屏旋转流程，退出全屏后显示横屏重试，不支持浏览器不显示死按钮。验证双开火、释放一个 pointer 不停止另一个、右开火可拖动视角、灵敏度端点明显不同、中/高画质高于 CSS 像素分辨率且 DPR 最多 2 倍。禁止从无用户手势 `orientationchange` 申请全屏。
- 权威地图/协议升级后同时刷新浏览器产物并重启活动房。协议不匹配迫使旧客户端重连，不兼容 checkpoint 房间自动关闭删除。
- Checkpoint 版本 12 要求完整 island/town/mixed 状态、由 `mapId + mapSeed` 派生的每条标准初始物资记录（不变的 250 条全局、仅底层 4 条弹药库、10 条手雷）、不超过 2.5 秒剩余引信的合法活动手雷、合法背包 stack 和可达安全区时间线；合法后续 drop/death 可额外保留。版本 11 及更早在 Worker/standalone 恢复时删除，因为它们仍可能包含逐层弹药库旧事实，或早于烬岚郡至少两个城镇、2.5 秒手雷引信、圆形/六边形建筑、删除实体屋顶护栏和新连桥权威碰撞。
- 权威地图/协议发布使用维护顺序：禁用新联机入口、排空/关闭房间、部署并 smoke 协议 13 Worker、部署匹配 Pages、重新启用入口，再分别 smoke 三图房间。
- 验证两种入场设置：访客模式保持原流程；要求账号时阻止匿名访客创建，允许注册/登录，刷新后恢复 HttpOnly refresh session，并拒绝禁用/撤销账号。
- 禁止安装 Playwright 或下载 CI 浏览器。
