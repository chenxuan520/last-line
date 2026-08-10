# 项目 Agent 指南

## 项目目标

维护一款浏览器大逃杀游戏：单机模式为 1 名人类玩家加 49 个 AI，联机模式为 2–10 名人类玩家并由 AI 补足到 50 个权威角色。必须保持从飞机部署到结算的完整流程、桌面端与移动端输入能力一致，以及权威规则与客户端表现之间的清晰边界。

## 中文要求

- Agent 的思考进度、用户沟通、Plan、Review 结论和交付报告必须全程使用中文。
- 仓库内所有说明文档和 `.agents/plans/` 下 Plan 的说明正文必须使用中文。新增或修改 Markdown 后，提交前必须扫描并清除非专业术语的英文叙述。
- 代码标识、文件路径、命令、协议字段、第三方产品名和无法翻译的上游原文可以保留英文，但周围说明必须使用中文。
- `Goal`、`Context`、`Contract`、`Plan`、`Build`、`Review`、`Round`、`Finding`、`Disposition`、`Re-review`、`Planner`、`Builder`、`Writer`、`Reviewer` 等 Agent 工作流概念属于专业术语，必须保留英文，不得翻译、机械替换或作为英文叙述残留清理。新 Plan 的文档标题和结构标题必须使用准确英文，说明正文使用中文。
- 历史 Plan 属于已完成任务的事实记录，禁止为了统一语言、格式或术语而批量翻译、重写或清理。只允许修改当前任务明确关联的新 Plan；用户明确要求恢复历史 Plan 时，必须逐字恢复原内容，同时保留当前任务新增的 Plan。
- Git 提交标题和正文、分支名，以及 GitHub MR/PR 的标题、正文和 Review 评论必须使用准确、具体的英文，并说明改动目的、范围或修复的问题；禁止只写 `fix`、`update`、`follow-up`、`wip` 等无法判断实际内容的含糊信息。仓库说明文档、工程指南和 Plan 的说明正文继续使用中文；代码标识、文件路径、命令、协议字段和第三方产品名保持原文。

## 常用命令

```bash
npm ci
npm run typecheck
npm run test
npm run test:multiplayer:production
npm run test:coverage
npm run build
npm run build:worker
npm run build:server
npm run build:standalone
npm run check:budgets
npm run preview
```

`npm run test` 只运行 Vitest。禁止为本项目添加 Playwright、安装 Playwright 浏览器或下载 Chromium。浏览器检查必须使用本机已经安装的 Chrome/Edge。任何浏览器测试开始前都必须把游戏音量设为 `0`。

## 架构规则

- `src/game/` 禁止导入 DOM 或 Babylon 模块。
- 核心状态必须保持可 JSON 序列化，并使用稳定的实体 ID。
- 人类与 Bot 控制器只能生成 `ActorCommand`，不得直接修改权威状态。
- 移动、战斗、背包、伤害、安全区和结算逻辑必须放在规则系统或模式中。
- 权威命中检测与视线检测必须使用 `SimulationCombatWorld`；渲染网格绝不能充当玩法碰撞体。
- 同时发生的动作必须与命令插入顺序、角色类型无关。
- 树干的位置和数量由种子决定，属于权威数据且不受画质影响。移动、战斗/视线、导航、动态掉落、服务端权威逻辑和客户端表现必须共同使用 `MapLayout.treeTrunks`；树叶可以按画质改变网格精度，但只能影响视觉。
- 地图身份必须通过显式 `mapId` 表达，并与 `mapSeed` 相互独立。禁止用种子的符号位、数值区间或特殊值编码地图类型。所有由状态驱动的布局缓存都必须同时以地图 ID 和种子为键；持久化状态缺少地图 ID 时统一归一化为岛屿地图。
- 混合地图始终包含 6 个命名大区域：1 个固定的高密城镇且拥有唯一医院、1 个固定的稀疏农村、1 个固定的山地森林，以及 3 个由种子选择类型的城镇/农村/森林区域。随机 3 区必须至少包含 1 个城镇，使整张地图始终有 2–4 个城镇；农村和森林仍可随机出现。放大后的近方形区域中心必须组成紧凑、不规则的种子化集群，禁止退化为固定行列或矩形槽位；中心包围盒必须小于旧方格布局，且必须恰好使用 5 条短连接道路形成不相交的连通骨架，不得穿过第三个区域的开发核心。建筑、权威树木、石头、草垛和区域物资必须使用显式的最近区域归属，禁止依赖重叠轮廓推断；城镇建筑覆盖率必须至少达到最近归属区域面积的 38%，各类型降落区必须保持为可导航的公共空间。区域类型、完整半径范围内的地形山丘、道路、城市视觉道路、几何、物资、导航和表现必须全部位于地图边界内并共同使用同一份种子化蓝图；森林树木/石头必须按完整占地范围约束地形变化和放置偏移，禁止只采样中心点而把物体放到陡坡上；任何代码层地图 ID 都不得使用中文拼音。这些生成器形状和防回归细节应写在工程指南和架构文档中，不要写进 README 的产品介绍。
- 每张地图必须恰好拥有 1 个权威医院和 1 个与医院不同的权威弹药库。弹药库每一层都要在现有 250 条全局物资预算之外，为每种枪械弹药提供 1 个固定弹药堆；布局、大逃杀初始化、AI、同步、持久化、HUD 和渲染必须使用显式建筑记录及逐层物资索引，禁止从数组尾部推断。
- 所有建筑（包括一层建筑）都必须拥有内置楼梯间，并且每层恰好有 1 条穿过楼板/屋顶开口的权威坡道。禁止外置脚手架楼梯；移动支撑、战斗/视线、导航、物资避让和渲染只能使用共享的内置坡道记录。
- 每栋建筑都要根据 `mapId + mapSeed + buildingId` 选择 1 个确定性建筑轮廓。建筑本体以矩形为绝对多数，目标比例约为矩形 82%、切角六边形 12%、多边形近圆形 6%；医院、弹药库和参与高层连桥的建筑保持矩形。建筑变化还可使用立面柱、檐口和内缩屋顶机房；禁止通过沿屋顶周边添加实体女儿墙或矮墙制造差异。建筑外墙、楼板、开口、楼梯、移动、战斗/视线、投掷物碰撞、导航、服务端权威逻辑和渲染必须共同使用同一轮廓，禁止只在视觉上做圆形/六边形而权威几何仍是矩形。屋顶保持平坦可达，内部楼梯开口必须畅通。最多约 15% 的普通矩形建筑可以确定性生成 0.5m 高的稀疏金属屋顶围栏；围栏只能由细立柱和横杆组成，必须不可碰撞、不可作为射击/视线遮挡、允许子弹穿透，不得写入权威 `wallSegments`，也不需要因为内部楼梯出口在屋顶中央而额外留边缘缺口。
- 高层楼板和空中连桥属于权威地图几何。灰炉城稳定生成 56 条二层连桥，同时保留少量无桥核心街区；烬岚郡仅在城镇区域稳定生成 8 条短连桥，并且必须同时覆盖 X/Z 方向。移动支撑、战斗/视线、导航、服务端权威逻辑和渲染必须共同使用同一批楼板、墙体、开口、坡道和连桥记录；禁止发布纯表现的桥或楼板。
- 灰炉城街道必须保持为由种子决定的单一连通图，包含受限抖动的主干骨架、局部 T 字路口、弯道和合并后的视觉街区；禁止退化为贯穿全图的正交网格线。建筑、POI、掩体、权威树木、地形道路、小地图道路和视觉细节必须共同使用或避让 `MapLayout.roadSegments` 的同一道路肩范围。
- 所有地图类型都必须在确定性、符合地图语义的锚点上渲染完整的 5 张品牌标牌。岛屿锚点保持稳定；城镇和混合地图使用各自的住宅/城镇、工业/森林、仓库/农村 POI。品牌标牌只能影响表现，必须不可拾取、不可碰撞且地形安全；缺少锚点或安全位置时必须显式失败，禁止静默减少标牌。
- `GameMode` 必须保持通用。大逃杀行为属于 `BattleRoyaleMode`，不要臆测未来 5v5 规则。
- 单机调试模式只能通过 `npm run dev -- --debug=true` 显式启用。无敌、属性编辑、物品发放和 UI 面板必须只存在于 `BattleRoyaleSession`；禁止通过联机协议、Worker/standalone 服务、持久化 checkpoint 或正常生产构建暴露调试状态。
- Cloudflare 与 standalone 联机必须共享协议、网关、大厅、房间、账号、管理员和比赛领域逻辑。平台专属代码只能处理存储、alarm、socket、HTTP 和进程生命周期适配；禁止分叉玩法或复制第二套服务实现。
- 浏览器只能根据 URL 选择后端（完整 standalone 使用 `same-origin`），不得根据 Cloudflare 或 standalone 分支玩法语义。
- 联机模式只能预测可撤销的本地开火表现。命中、弹药、伤害和死亡必须由服务端权威处理；人类 hitscan 回溯必须使用服务端发出的单调递增 render tick，最多保留文档规定的 200ms 角色胶囊窗口，并使用当前权威地图遮挡。单机和 Bot 射击继续查询当前状态。
- 联机空中表现必须使用感知部署阶段的修正预算，并在快照之间插值外部飞机；禁止把落地后的 6m 瞬移阈值应用到合法的飞机/降落伞移动。空中地面物资同步使用水平 400m 范围，落地后使用 60m 范围，并且只发送状态转换增量；交互距离仍使用权威三维距离。
- 目前唯一支持的投掷物是破片手雷。每张地图必须在不变的 240 个基础物资点和 10 个额外医疗点之后，追加恰好 10 个手雷点，每点 2 枚。手雷必须作为背包物品并使用 2.5 秒权威引信；固定步长飞行、反弹、引信、爆炸遮挡、衰减伤害、自伤、服务端权威、AI 使用、checkpoint 状态、网络同步和表现必须共同使用同一份权威记录与配置。禁止从图片/模型 metadata 推导手雷规则，也禁止使用 Babylon 物理或渲染 hitbox 处理玩法碰撞。

## 服务端规则

- Cloudflare Worker 与 standalone Node.js 必须保持相同的公共 HTTP/WebSocket 协议。standalone HTTP 服务绝不能暴露内部对象路由。
- Standalone 有意设计为 1 个服务、1 个 Node.js 进程。本地 SQLite 是权威数据源；独占锁数据库必须拒绝第二个存活进程，同时要支持崩溃恢复。
- Alarm 必须保证至少投递一次：handler 完成前持续保存 alarm 所有权，并使用 generation 防止旧调用删除新调度。每份持久化房间状态都必须存在可恢复的 alarm 路径。
- 重连 token 采用两阶段轮换。旧 token 或客户端提交的 pending token 在 `connection.ack` 提升 `welcome` 下发的新 token 之前仍然可用。
- 关闭已过期/已结束的房间，释放 socket 与运行时状态，并淘汰休眠的本地房间服务。禁止无限期保留已结束的 50 人比赛。
- 只能在 `SERVER_PUBLIC_ORIGIN` 下重建 standalone 请求；认证或同源检查前必须拒绝绝对地址和 network-path 目标。只有当所有直连 peer 都是可信代理时，才能信任转发的客户端 IP。
- 关闭服务时，先停止房间循环并写入 checkpoint，再在有界时间内排空 HTTP/WebSocket。数据库和进程锁清理必须放在 `finally` 中，包括启动失败路径。
- 运行指标必须只用于观测并保持低基数。`active_rooms`、`tick_delay_ms`、`websocket_buffered_bytes` 和 `checkpoint_duration_ms` 只能使用带版本的结构化日志；禁止添加房间/账号/IP/token 标签、写入 checkpoint 或暴露公共 metrics 路由。当 Cloudflare 平台无法提供缓冲区信息时，必须报告为不可用。
- 联机房间创建后地图选择不可变。快速匹配只能加入请求地图 ID 相同的公开等待房；通过房间码加入时继承房间地图。

## 资源规则

- 玩法和渲染代码必须引用稳定的 asset ID，禁止引用具体资源路径。
- 预加载图片必须直接使用已经通过验证的 `AssetCatalog` payload，禁止在创建场景时再次 fetch。世界纹理只能以非阻塞资源增强材质；纹理缺失或加载失败时，权威几何必须立即使用程序化颜色/顶点色回退继续渲染，禁止隐藏网格或显示白色错误材质。
- 玩法数值必须保留在 `src/config/`；模型 metadata 不得改变伤害、射速、背包或命中体积。
- GLB 模型只影响视觉且必须不可拾取。只有加载、网格校验和必需节点校验全部成功后，才允许关闭程序化回退。
- 必须保留类型化 fallback 检查以及真实的 SVG/图片解码校验。
- 复用停用的地面物资记录和标记网格，禁止为每次掉落创建无上限对象。

## AI 规则

- AI 必须遵守与玩家相同的移动、弹药、伤害、背包、治疗和安全区规则。
- 感知结果必须通过距离、视野和 `SimulationCombatWorld` 视线检测。
- 物资目标必须可导航。路径为空时必须重新选择目标，禁止直接穿过障碍。
- 无武器 Bot 必须在全图搜索可到达的武器。弹药为空的 Bot 必须搜索兼容弹药，背包已满时可以丢弃不兼容弹药堆。
- 每个 Bot 的决策状态必须相互独立，远距离更新必须错峰执行。

## 测试规则

- 实际可行时，修复规则回归前先添加一个会失败的 Vitest。
- 通过注入随机源保持测试确定性。
- 同时冲突必须覆盖两种命令插入顺序。
- 完整比赛测试使用快速大逃杀配置；生产时间断言必须单独测试。
- 场景、GLB 和生命周期测试使用 Babylon `NullEngine`。
- 禁止降低多种子 AI 阈值来掩盖导航或拾取失败。
- 自动化或人工验证期间禁止播放音频。
- 每个新增或修改的可见功能都必须在 production build 中使用 Chrome/Edge MCP 浏览器打开，音量必须为 `0`。实现 Agent 必须用 MCP 截取受影响区域，并在完成前亲自使用图片查看工具打开检查；只截图不查看不算完成。DOM 存在、computed style、单元测试、console 检查和其他 Agent 的描述只能作为辅助证据，不能替代实现 Agent 亲眼查看渲染截图。必须把变更元素与相邻同类元素比较，并明确检查字体、字号、字重、颜色、间距、对齐、位置、裁剪和重叠；功能存在但视觉不一致仍视为未完成。
- 移动端全屏和方向锁定必须来自真实用户激活。禁止在 `orientationchange` 中调用 `requestFullscreen()`；不支持或拒绝全屏的浏览器必须仍可手动横屏游玩并提供可用的重试入口。
- 修改共享联机类后必须同时运行 Worker 和 standalone 合同测试。Standalone 回归必须覆盖真实 HTTP/WebSocket、持久化/重启、进程锁、alarm generation、重连宽限、房间淘汰和有界关闭；竞态测试使用确定性 barrier，禁止只依赖时间等待。
- `test:multiplayer:production` 必须保持为真实公共 HTTP/WebSocket smoke，并与覆盖率分离。它必须创建私有房、验证已部署的 welcome 协议和大厅状态，然后离开；每次生产 Worker 或 Pages 部署后都要运行。定时 production-smoke workflow 只用于漂移检测，不是原子部署门禁。
- 禁止让通用 WebSocket `closed` 状态覆盖明确的联机终止错误。协议不匹配、房间关闭、账号撤销等原因必须保持为最终可见消息，并提供返回联机菜单的可用路径。
- 联机开火回归必须覆盖本地射速/弹匣限制、预测与权威特效去重、可选旧 render tick、socket 单调边界、历史角色命中、回溯上限和当前地图遮挡。
- 手雷回归必须覆盖一次性命令消费、背包使用、高/低抛输入、权威 sweep/反弹/引信、范围衰减与遮挡、两种同时插入顺序、自伤、Bot 安全/冷却/并发、精确的 10×2 额外分布、灰炉城可达性、checkpoint 兼容、联机可见性和有界表现/特效池。
- 人类连接通知必须有序、状态转换幂等、只显示昵称，并由 Worker/standalone 的关闭和重连路径共享。桌面端 `Tab + 滚轮` 必须滚动排行榜且不能切枪；暂停退出必须让单机回主菜单、联机回在线大厅，并关闭比赛连接。
- 桌面端可能启动比赛或公开倒计时的联机操作，必须在真实用户激活中同步请求 pointer lock，并在异步入场/场景加载期间保持它，在大厅/菜单/错误退出时释放。单机与联机会话恢复必须共享安全的可选/同步/旧 Promise pointer-lock helper；禁止依赖异步大厅或 `match.full` 回调创建首次锁定。触摸端必须与 pointer lock 隔离，拒绝锁定时必须保留可用的“继续游戏”回退。
- 快速匹配、创建房间、房间码加入和公开房加入必须共享单飞入场门禁。同步禁用所有入场入口，离开菜单时使旧尝试失效；connection 的状态/消息 handler 只有在自身连接仍是活动的 `GameApp.multiplayerConnection` 时才能修改 UI、全屏或 pointer lock。
- 持久化比赛 checkpoint 只有在版本为当前版本且包含完整可恢复状态时才兼容：恰好包含配置的 50 个角色，record key 与 `actor.id` 一致；显式 `mapId + mapSeed` 派生的每个标准初始物资 key 都存在且与 `loot.id` 一致；active grenade 记录合法，next sequence 严格更大；安全区时间线可达；背包 stack 引用 `ITEMS`、数量为正整数且不超过 `maxStack`。额外合法动态物资仍允许存在。持久化成员必须是完整 `RoomMemberRecord`，record key 等于 `playerId`；身份、昵称、入场/重连凭据、账号/会话配对、布尔值、时间戳、连接 epoch 和 actor ID 类型都要在使用前验证。运行中/已结束房间必须保留 2–10 个非空且唯一的 actor ID，并与 checkpoint 中完整的 `kind: "player"` 角色集合一致；成员不得指向 Bot 或共享角色。缺失、null、数组、部分、畸形或旧版本状态均不兼容，Worker 和 standalone 都必须无异常地删除它们。
- 性能门禁必须使用确定性的操作次数、协议字节、场景资源和原始产物数量。禁止硬门禁墙钟时间、FPS、堆内存或压缩大小；修改已签入预算必须经过明确的架构/资源审查。
- 覆盖率按源码归属分别统计：`src/` 和 `standalone/` 使用 V8，Cloudflare `worker/` runtime 使用 Istanbul。所有业务源码必须纳入范围，报告只能写入已忽略的 `node_modules/.cache/coverage/`；降低已签入阈值属于需要审查的质量决策，禁止用它掩盖未覆盖代码。

## 审查与交付规则

- 除非用户明确要求本任务跳过审查，否则每次提交前都必须启动独立 `code-reviewer`。审查必须在实现和验证完成后进行；自审和测试通过不能替代独立审查。Reviewer 只读，不得修改 Git 或文件，只分析 diff/合同，并避免重复已经记录的完整验证。
- post-commit hook 只用于提醒再次确认审查要求。若漏审，必须在 push、部署或完成报告前补做独立 `code-reviewer`。
- Reviewer 禁止重复外层实现 Agent 已完成并写入当前 plan 的 test、typecheck、build、budget、smoke 或浏览器命令。默认只做静态 diff/合同分析；只有某个明确风险缺少证据时才能运行最小定向验证，并说明现有证据为何不足。禁止仅为了“独立确认”重跑完整套件。
- Review 子 Agent 是只读 Git reviewer：禁止 checkout/切分支、stash、reset、add、commit、amend、rebase、push、force-push 或删除远端分支。只有外层 Agent 可以修改仓库和远端 Git 状态；任何子 Agent 声称完成的操作都必须由外层本地验证。
- 创建提交前必须检查 `git status -sb`、`git log --oneline -n 10` 和精确的 `git ls-remote --heads origin <branch>` 目标；先保留或暂存工作区改动，再运行 `git pull --rebase` 使提交基于最新远端 tip。解决冲突并重新检查 diff 后才能提交，验证提交后才能 push。若必须移除提交，使用保留文件的非破坏性 parent reset，并在新提交前验证工作区。除非用户明确点名该操作，否则禁止 force-push 或改写远端历史。
- pull、rebase 或 merge 冲突必须在用户指定的当前分支解决；除非用户明确要求，否则禁止新建或切换分支。
- 删除远端分支前必须确认精确分支名和用户明确意图，只执行一次删除，然后 fetch --prune 并确认 ref 已不存在。Reviewer/子 Agent 声称提交、推送、reset 或删分支，不代表外层工作区或远端真的改变。
- 评估 finding 前必须重新阅读当前 plan。Reviewer 反馈只能作为待验证输入，必须结合需求、兼容性、现有语义和代码核实，禁止机械套用。
- 所有 blocker、high、medium finding 都必须解决并请求复审。存在此类未解决问题时禁止提交、推送、部署或报告完成，除非 plan 记录了明确且有证据的“不需要改代码”理由。
- 每个实现提交前，把该轮已完成的审查及 finding 处理结果写入当前 plan 的 `## 审查`，把提交前已经知道的事实写入 `## 构建`，并与实现放进同一提交。
- **绝对禁止 plan-only commit。** 每次提交前检查 staged 路径；如果 staged 非空且全部位于 `.agents/plans/`，必须停止，禁止提交。不得绕过或禁用 hook、添加无意义非 plan 文件、amend 其他提交、改写历史或创建只承载 plan 记录的 follow-up commit。Plan 的构建/审查记录必须在对应实现提交前完成，并与该实现一同提交，没有例外。
- 除非用户明确要求该历史操作，否则禁止 amend、重写或 force-push 已推送的实现提交。提交后得知的事实不得伪装成提交前已经知道。
- 提交后 CI、部署、Reviewer 或 Codex 发现问题时，只要当前流程要求持续监控和修复，就必须立刻进入 follow-up 实现轮次，不得等待用户再次确认：按需修改代码/测试/文档，在同一 plan 追加新轮次，重新完成必要验证和独立审查，然后创建并推送包含非 plan 交付物的正常 follow-up commit。此规则绝不允许 plan-only commit。
- 纯文档或 plan 记录修改若不改变可执行代码、workflow/配置行为、合同、安全或部署行为，默认不需要独立 reviewer，除非用户明确要求。Workflow、Dockerfile、构建脚本和运行时配置属于可执行改动，不是纯文档。
- 同一变更中必须同步更新工程文档。架构、合同、安全、持久化、部署、命令或长期验证规则变化时，必须更新 `AGENTS.md`、README 和相关 `docs/`。
- 每次 Chrome/Edge MCP 验证结束后必须立刻关闭本轮打开的所有页面/context，停止本轮启动的本地服务，并确认只剩无法避免的 `about:blank` 后才能继续其他工作。禁止在验证轮次之间遗留页面、浏览器 context、render loop 或本地服务；全程音量保持 `0`。

## 完成检查表

1. 运行 `npm run typecheck`。
2. 运行 `npm run test`。
3. 运行 `npm run build`。
4. 修改联机/共享服务端代码时运行 `npm run build:worker` 和 `npm run build:server`；修改自托管产物或 same-origin 客户端选择时运行 `npm run build:standalone`。
5. 生成浏览器、Worker 和 standalone 产物后运行 `npm run check:budgets`。
6. 表现层变化时，在本机 Chrome/Edge 中打开 production build，音量设为 `0` 并检查 console。
7. 完成审查/复审闭环，确保没有未解决 blocker、high、medium finding；只有用户明确要求本任务跳过审查时例外。
8. 合同、控制、命令、架构、持久化、安全或部署行为变化时，更新 `AGENTS.md`、README 和 `docs/`。

## 部署规则

- `.github/workflows/ci.yml` 必须使用 Node.js 24 和 lockfile 安装。
- 所有 PR/MR 和每次分支 push 都运行核心 CI；只有 `main` 可以把验证通过的 `dist/` 部署到 GitHub Pages。
- Cloudflare Pages 使用 dashboard Git integration，跟踪 `main`，构建命令为 `npm run build`，输出目录为 `dist`。
- Cloudflare Workers Builds 也必须跟踪 `main` 并运行文档规定的 Worker 构建与部署命令。仓库 push 或 Pages 部署成功绝不代表 Worker 已部署。
- 修改 `worker/`、共享联机服务端代码或 `MULTIPLAYER_PROTOCOL_VERSION` 后，必须等 `wrangler deployments status` 显示该版本创建了新的 production Worker，并且 `npm run test:multiplayer:production` 对公共端点通过，任务才算完成。部署事实写在中文用户报告中；若部署或 smoke finding 需要真实 follow-up 修复，则在同一 plan 追加 finding 与修复，并和非 plan 交付物一起提交。禁止仅为回填部署事实创建纯文档或 plan-only commit。自动 Worker 部署未发生时必须报告 blocker，并使用已验证的 `npm run deploy:worker` fallback；禁止静默让 Pages 与 Worker 停留在不同 revision。
- `npm run deploy:worker` 必须保持为验证过的 fallback 链：Worker typecheck、Worker tests、dry-run bundle、部署、真实 production HTTP/WebSocket smoke。正常发布禁止替换成裸 `wrangler deploy`。
- Worker 部署验证只允许重试无副作用的 `/health` 协议标记，以及新版本向公共自定义域传播时的临时 transport/gateway 失败。等待必须有界；标记匹配后只能创建 1 个 smoke 房间，禁止重试 guest、room、WebSocket 或 leave 失败。
- Worker 与 Pages 部署不是原子的。协议版本变化必须使用有文档的维护发布：禁用新联机入口、排空或关闭房间、部署并 smoke Worker、部署匹配的 Pages 客户端、重新启用入口并再次 smoke。禁止独立滚动严格协议版本并假设 CI 顺序能保证兼容。
- Git integration 可用时禁止把 Cloudflare 长期凭据加入仓库。
- Vite 资源 URL 必须同时兼容 GitHub `/last-line/` 子路径和 Cloudflare 根域名。
- Standalone production 使用 Node.js 24、same-origin 浏览器构建、支持 WebSocket 的 HTTPS 反向代理和持久数据卷。除非设计了明确迁移，否则 Cloudflare 与 standalone 数据必须相互独立。
- 禁止提交 `.env.standalone`、管理员恢复/bootstrap 值、SQLite 数据、WAL 文件、cookie、入场/重连 token 或代理凭据。
- 修改 Docker/Compose 时，如果 Docker 可用就必须运行容器 smoke；不可用时记录缺口，并仍要验证本地 bundle、真实 HTTP/WebSocket 流程、优雅关闭和崩溃锁恢复。
- CI 必须在没有 registry 凭据的情况下构建 production Docker image，并以非 root 用户、只读文件系统和临时可写挂载运行它；只有 `/health` 返回精确预期结果后，Pages 或 release 产物才能继续。
- 版本 tag 必须通过完整构建和容器 smoke，GitHub Actions 才能向 Docker Hub 发布多架构 standalone image。Registry 凭据只能放在 `DOCKERHUB_USERNAME` 和 `DOCKERHUB_TOKEN` Actions Secrets 中，禁止打印、持久化或作为 Docker build argument 传入。
