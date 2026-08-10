## Plan

### 背景

现有联机模式使用临时游客身份。用户要求增加可持久化的玩家账号系统、单一管理员管理终端，以及由管理员控制“是否强制注册登录”的全局开关。

### 目标

1. 单机入口、规则和无网络行为保持不变。
2. 联机准入开关关闭时继续允许游客；打开时，新建联机身份必须完成玩家账号注册或登录。
3. 已经创建的游客和正在运行的房间不因开关切换而中断。
4. 玩家密码仅保存随机盐和 PBKDF2-SHA-256 哈希；Refresh Token 使用 HttpOnly Cookie，Access Token 仅保存在页面内存。
5. 管理终端只支持一个管理员账号，支持当前密码修改和一次性 Worker Secret 忘记密码恢复。
6. 管理员可查看、搜索、禁用/恢复玩家账号、撤销玩家会话、查看及强制关闭在线房间。
7. Turnstile 保留可选集成；没有 Site Key/Secret 时关闭，配置不完整时失败关闭。

### 实现顺序

1. 完成账号和管理员 Durable Object 数据模型、安全会话及恢复流程。
2. 完成管理终端和在线房间控制。
3. 增加全局准入设置及公开玩家认证网关。
4. 在联机菜单接入注册、登录、Cookie 恢复和 Access Token 自动刷新。
5. 补充 Worker 集成测试、应用回归、浏览器验收和生产部署验证。

### 边界

- 玩家账号开关只控制新建联机身份，不改变现有未绑定游客；管理员禁用或撤销账号会终止该账号已绑定的准入、重连和活动连接。
- 玩家账号与管理员账号完全分离。
- 不使用 Workers KV 保存密码或管理员凭据。
- Turnstile 密钥和内部 capability 只使用 Worker Secret，不写入仓库。

## Build

### 更新日志

- 2026-07-20 18:57：完成 `AccountDirectory`、`AdminDirectory`、同源 `/admin` 管理终端、账号管理和在线房间强制关闭；生产 Worker 新增 SQLite Durable Object 绑定，完成 Bootstrap 初始化并删除一次性 Bootstrap Secret。
- 2026-07-20 19:03：完成应用 238 项、Worker 25 项测试，`typecheck`、前端构建、Worker dry-run 和安全审查通过；生产健康检查、独立管理员登录及私人测试房间关闭通过，浏览器控制台无错误。
- 2026-07-20 23:11：按用户最新口径收敛为单管理员，新增 `ADMIN_RESET_TOKEN` 一次性忘记密码恢复方案；正在实现管理员“强制注册登录”开关、公开玩家认证接口、HttpOnly Refresh Cookie 和联机菜单注册/登录流程。当前 Worker 定向测试 26 项通过，尚未进行本阶段最终全量验证和部署。
- 2026-07-20 23:28：完成准入开关、玩家注册/登录/会话恢复网关、合法 `__Host-` Refresh Cookie、跨标签刷新锁、Access Token 自动续期、账号游客关联与 session revision 校验；管理员 Reset Token 服务端只允许使用一次。Worker 定向测试 26 项通过，文档已同步，等待最终全量验证、浏览器验收和生产部署。
- 2026-07-21 00:31：处理用户反馈的“联机后单机卡顿”和双人同时回到飞机问题。补全 WebSocket 监听/重连 timer/回调队列、HUD、场景集合及音频节点释放；新增独立 `checkpoint-v1`，恢复时按 tick 选择新于 room 主记录的 checkpoint，并在发送 reconnect token / 消费 admission token 前完成持久化。浏览器实测生产冷单机约 120.09 FPS，修复后“联机开局 -> 管理关闭 -> 单机”约 120.05 FPS，两个 10 秒窗口均无 long task。新增连接关闭和 checkpoint 恢复回归，等待最终全量门禁、无活动房间确认、部署和推送。
- 2026-07-21 00:39：完成最终实现与上线准备。应用 25 files / 240 tests、Worker 26 tests 全部通过，`npm run typecheck`、`npm run build`、`npm run build:worker`、`git diff --check` 通过；安全审查无剩余 blocker/high。部署前管理接口确认生产无活动房间，随后部署 Worker 并将唯一管理员用户名按用户要求改为 `chenxuan`，一次性 `ADMIN_RESET_TOKEN` 使用后已删除；旧管理员凭据失效，准入开关当前保持游客模式，Turnstile 因无密钥保持关闭。当前生产 Worker deployment 为 `59e62938-fc85-4677-af05-e1583960e9c1`，健康、管理员登录、Auth 配置均验证通过，等待 Git 提交推送和静态站自动部署。
- 2026-07-21 00:46：首轮账号/管理/生命周期改动已提交并推送 `0cd1ecd`。随后修复 AI 跳伞接近落点时满速过冲造成的左右振荡：新增 12m 比例减速区和 0.75m 水平死区，180 tick 轨迹回归确认方向反转不超过 1 次、落点误差不超过 0.8m。等待最终全量验证和第二次提交推送。
- 2026-07-21 00:51：AI 跳伞修复完成最终全量验证：应用 25 files / 241 tests、Worker 26 tests、`npm run typecheck`、`npm run build`、`npm run build:worker`、`git diff --check` 全部通过。部署前再次确认生产无活动房间，Worker 已部署版本 `71396a8a-33e1-427c-b45e-9edf19fd4017`；等待第二次 Git 提交推送和静态站部署完成。
- 2026-07-21 01:03：AI 跳伞修复已提交并推送 `e9df68d`；GitHub Actions `29761398512` 成功，GitHub Pages 发布成功，Cloudflare Pages production deployment `544e333d-4170-4424-bd0e-dd22dd4afda7` 已上线。生产管理终端确认唯一管理员可登录；强制账号开关打开后静态站显示注册/登录并禁止匿名匹配，关闭后 5 秒内恢复游客模式，最终保持游客模式。生产浏览器静音、控制台无错误；Git 工作区与 `origin/main` 对齐。

## Review

待本阶段实现完成后记录最终审查结论。重点检查：Cookie 属性、并发 Refresh、账号禁用后的游客凭据、Access Token 过期刷新、策略切换即时性、Reset Token 一次性消费和 CORS/CSRF。
