## Plan

### 项目背景信息

`mixed` 地图“烬岚郡”已在 `feat/hybrid-regions` 分支实现并提交，但当前六个大型模块固定落在 `3 × 2` 槽位：

- X 坐标固定为 `-760 / 0 / 760`。
- Z 坐标固定为 `-560 / 560`。
- 每个区域固定为 `640 × 880` 的纵向长方形。
- 区域连接道路是与槽位一致的横纵网格。

该结构让六个地点在小地图和实景中呈现明显六宫格，区域之间又暴露出较长、单调的空白连接路，不符合苍岬岛式自然散点观感。本轮属于实现提交后的新增用户修正，必须使用独立 plan；不得回写已经随 `a47ab50` 提交的 `.agents/plans/2026-08-06-mixed-region-map.md`。

当前分支为 `feat/hybrid-regions`，本轮开始时本地与 `origin/feat/hybrid-regions` 一致，工作区干净。当前主 agent 继续同时承担 planner 和 writer；只在完整实现与自测后启动独立 reviewer。

### 事实与约束对齐

- 地图尺寸仍为 `2400 × 2400`，不改变 `mapId: "mixed"`、显示名“烬岚郡”、六个区域、三类区域、唯一“医院”、250 个物资点、16 个 landing zone 或既有联机协议。
- 固定存在的 `赤钟城区`、`风穗乡`、`沉杉岭` 以及三个 seed 随机类型区域都保留；本轮只修正宏观位置、区域外形尺度和连接道路。
- 六个区域中心必须由 `mapSeed` 确定性生成，同 seed 完全一致，不同 seed 的中心布局需要实际变化。
- 六个区域不得再落成两条完全相同 Z 行和三条完全相同 X 列，也不得用另一个固定模板替代旧六宫格。
- 区域中心继续保持足够最小距离，避免 POI、建筑和自然障碍挤成不可玩的重叠团；同时区域可视边缘需要靠近，不能保留大段空白走廊。
- 区域从 `640 × 880` 的纵向长方形改为更大的近方形 footprint。城区仍保持高建筑覆盖率，农村仍保持稀疏，森林树密度不得因为面积增大而下降。
- 区域连接道路必须消费随机中心，生成确定性、连通且较短的道路骨架；不能残留固定 `[-760, 0, 760] × [-560, 560]` 横纵连接。
- 地形、建筑、道路、树干、岩石、草垛、物资、导航与渲染继续消费同一权威布局。
- 区域 footprint 允许在视觉过渡带靠近或轻度交叠，因此区域内容归属不能继续只靠“点落入哪个矩形”反推；生成和测试必须使用显式稳定 `regionId`，避免相邻区域误计数或物资选错建筑。
- 苍岬岛和灰炉城生成器、seed golden、协议版本和 checkpoint 版本不变。
- 不新增 Playwright 或浏览器下载；Chrome MCP 使用本地浏览器且音量保持 `0`。
- 新实现提交前必须完成 plan Build 记录、独立 reviewer 与 Review 记录。提交后不得再回写本 plan。

### 更新日志

- 2026-08-07 02:24：用户指出烬岚郡六个区域相距过远、中间空白道路过长，且固定六宫格和纵向长方形模块观感生硬；要求参考苍岬岛地点的随机分布，让地点更大、更靠近。
- 2026-08-07 02:29：方案确定为“seed 随机紧凑散点 + 近方形放大 footprint + 基于真实中心的最短连通道路”，而不是整体缩放旧 `3 × 2` 网格或换用另一套固定模板。
- 2026-08-07 02:29：确认区域轻度靠近后需要显式 `regionId` 维护生成归属；权威碰撞仍由最终 `MapLayout` 几何统一处理，不允许相邻模块生成实体互相穿插。
- 2026-08-07 06:12：用户追加联机桌面启动回归：比赛加载完成后未自动持有 pointer lock，HUD 立即显示“继续游戏”暂停卡；要求参考已修复的单机桌面路径。范围新增联机真实手势预锁、MultiplayerSession 安全 resume、自动倒计时和私人房准备/开始路径测试与 Chrome 双端联机验收；不改变触控、服务器协议、房间规则或暂停卡兜底。

### 用户验收口径 / Reviewer 对照清单

1. **非六宫格**
   - 任一代表 seed 的六个主地点不能只有 3 个唯一 X 和 2 个唯一 Z。
   - 中心布局随 seed 变化，同 seed 重建完全一致。
   - 至少覆盖普通 seed、全农村 seed `11`、全城区 seed `16`、全森林 seed `38`。

2. **紧凑且更大**
   - 区域 footprint 改为近方形并比旧 `640 × 880` 面积更大。
   - 每个区域都有至少一个近邻，近邻区域的 footprint 边缘间距必须显著小于旧纵向 `240m` 空白；禁止再次出现长距离孤立模块。
   - 六个区域的整体中心包围盒明显小于旧 `1520 × 1120` 固定阵列，但 footprint 与内容仍在 `2400 × 2400` 地图边界内。

3. **自然短路网**
   - 宏观 connector 恰好形成六区域连通骨架，长度基于随机中心。
   - connector 不得全部水平/垂直，不得出现旧固定网格 segment。
   - 最长 connector 和 connector 总长度需受测试阈值约束，避免恢复长空路。
   - `urbanRoadSegments` 仍只包含城区内部道路，不能把 connector 当成灰炉城工业道路。

4. **区域内容**
   - 每个城区仍有 36 栋建筑并维持既有高覆盖率范围。
   - 每个农村仍有 9 栋房、草垛、树和岩石。
   - 每个森林仍有 2 栋小屋、3 个山丘、密集权威树和岩石；面积增大后树密度不低于旧实现。
   - 每个混合实体携带稳定区域归属，测试按归属而不是重叠矩形反推数量。

5. **医院、物资和玩法**
   - 唯一“医院”仍位于固定城区。
   - 16 个 landing zone、240 个基础物资和 10 个医疗物资保持不变。
   - 医院、室内物资、道路、坡面树石、Movement、Combat/LOS、GridNavigator 和 49 Bot 完整对局回归通过。

6. **呈现与交付**
   - production build 在 Chrome MCP 桌面和 `844 × 390` mobile 中确认六地点不再呈六宫格，中间没有大片空白长路，音量为 `0`。
   - 每轮浏览器验收后立即关闭页面、停止本地服务并确认只剩 `about:blank`。
   - typecheck、完整 Vitest、coverage、browser/Worker/server/standalone build 和 budgets 通过。
   - 独立 reviewer 无未解决 blocker/high/medium 后才能提交并推送。
   - 推送到现有 PR 后重新 `@codex review`，监控到 Codex 对新提交明确无重大问题。

7. **联机桌面自动进入**
   - 桌面端私人房主点击“开始对局”、私人玩家点击“准备”时，必须在真实用户手势内同步请求 pointer lock。
   - 公开快速匹配、创建公开房和点击公开房列表会进入自动倒计时，必须在对应真实点击内预锁鼠标。
   - 联机 session 加载完成后若 pointer lock 已保持，不得重复请求；若浏览器拒绝、API 缺失、同步抛错或返回 legacy void，比赛仍需完成加载并显示现有“继续游戏”兜底。
   - 触控端不请求 pointer lock；私人未准备状态、退出房间、返回菜单和协议语义不变。
   - 本地真实 HTTP/WebSocket 联机验收至少使用两名玩家启动一局，确认桌面房主加载后 `pointerLockElement === canvas` 且 pause card 不可见。

### 要实现的功能整体概述

1. 用独立 seed 流生成六个紧凑、确定性、非行列对齐的区域中心。
2. 把区域 footprint 改成更大的近方形，并按新尺度调整城区道路、建筑 parcel、森林山丘和 landing-zone 偏移。
3. 生成基于区域中心的短连通 connector，再追加各类型区域内部道路。
4. 给 mixed 地图权威实体保留显式区域归属，避免靠重叠 footprint 反推。
5. 增加多 seed 宏观形态、间距、道路、归属与旧地图隔离测试。
6. 完成自动测试、Chrome MCP 实图、独立审查、提交、推送和 Codex 复审。

### 涉及仓库

- `/data00/home/lingchen.judy/self/last-line`

### 文件/模块落点

#### Create

- `.agents/plans/2026-08-07-compact-mixed-regions.md`
  - 本轮 Plan、Build、Review 的唯一记录文件。

#### Modify

- `src/config/mixedMap.ts`
  - 替换固定 `REGION_SLOTS`；新增紧凑随机中心生成、近方形尺度、自然 connector、尺度化局部道路/建筑/山丘。
- `src/config/map.ts`
  - mixed 权威实体写入并消费显式 `regionId`；物资按 blueprint 归属选建筑。
- `tests/unit/mixedMapLayout.test.ts`
  - 新增非网格、seed 变化、整体紧凑、近邻边缘间距、短连接骨架、显式归属和多 seed 压力回归。
- `tests/unit/islandScene.test.ts`
  - 若场景资源数量或道路断言受森林密度/connector 数变化影响，按新权威 contract 更新。
- `tests/unit/aiLootReachability.test.ts`
  - 复核 mixed 操作预算；只有真实、可解释的确定性增长才调整显式 per-map 阈值。
- `README.md`、`docs/architecture.md`、`AGENTS.md`
  - 删除“稳定 3 × 2 宏观 slot”语义，记录 seed 随机紧凑区域、显式归属和短连通道路长期约束。
- `scripts/check-performance-budgets.mjs`
  - 仅在最终产物真实超限且完成架构/resource 审查时调整；禁止预先放宽。
- `src/controllers/pointerLock.ts`
  - 抽取单机/联机共用的“仅桌面、未锁定时安全请求”入口，继续兼容 API 缺失、同步异常、legacy void 和 Promise rejection。
- `src/app/GameApp.ts`
  - 在公开匹配/公开创建/公开房列表、私人准备和私人开始这些真实用户手势内预锁鼠标。
- `src/app/MultiplayerSession.ts`
  - `resumeInput()` 复用单机安全 helper，已锁定时不重复请求。
- `tests/unit/gameAppActions.test.ts`
  - 覆盖 desktop/touch、已锁定去重和失败容错。

#### Check

- `src/client/render/scenes/IslandScene.ts`
  - 道路和自然 detail 必须继续消费新 `roadSegments` / `urbanRoadSegments`，不能内置旧槽位假设。
- `src/ai/navigation/GridNavigator.ts`、`src/game/systems/MovementSystem.ts`、`src/game/systems/SimulationCombatWorld.ts`
  - 无需因位置变化分叉实现，但必须用真实布局回归。
- Worker 与 standalone
  - 本轮不改协议或持久化格式，仍需完整合同测试确认 mixed 房间消费相同 seed 布局。
- `tests/standalone/standaloneServer.test.ts` 与 Chrome MCP
  - 复用既有真实 HTTP/WebSocket 房间启动合同；浏览器额外验证联机 session 加载后的 pointer lock 和 pause card。

### 范围

#### 范围内

- 烬岚郡六区域宏观位置、区域尺度、连接道路和内容归属。
- 与布局变化直接相关的生成、权威几何、AI、渲染、测试和文档。
- 现有功能分支、PR 和 Codex 审查的增量交付。

#### 明确不做

- 不改地图总尺寸。
- 不新增或删除区域，不改变三固定三随机规则。
- 不改地点中文名称、地图名称或医院名称。
- 不改变武器、缩圈、50 人规模、物资总量、协议版本或 checkpoint 版本。
- 不修改苍岬岛、灰炉城布局算法。
- 不改变联机倒计时、最少真人数、准备规则、断线重连或协议。
- 不合并 PR、不生产部署。

### 关键假设或待确认项

- “尽量拉近”解释为缩短区域中心的近邻距离和 connector 长度、增大实际内容 footprint，而不是允许建筑/树石真实穿模。
- “像岛屿一样随机分布”解释为中心由 seed 随机采样并有距离约束；区域类型和名称规则不变。
- 区域可在过渡边缘轻度靠近，但所有实际权威实体仍必须通过全局碰撞和道路净空检查。
- 本轮继续使用现有分支和 PR，因为这是对尚未合并实现的直接增量修正；不创建第二个功能分支或第二个 PR。

### 推荐方案

#### 1. 随机紧凑中心

使用与苍岬岛 `createSeededMapPoints` 相同的确定性拒绝采样思想：

- 在地图中央受限范围内采样候选点。
- 与已选中心保持明确最小距离。
- 对候选增加轻量中心聚合评分，优先选满足最小距离且整体包围盒较小的候选。
- 使用独立随机流，不能改变三随机区域类型在既有代表 seed 上的组合。
- 生成失败时明确抛错，不回退到固定六宫格。

#### 2. 近方形放大 footprint

- 将区域从纵向 `640 × 880` 改成更大的近方形。
- 城区 parcel 和内部道路使用相对区域尺寸计算，避免继续保留旧绝对长方形。
- 森林主山丘半径和树数按面积同步增加，保持或提高既有树密度。
- landing zone 偏移按区域尺度生成，继续保持 16 个落点。

#### 3. 短连通道路

- 对六个区域中心运行确定性最小生成树，得到 5 条 connector。
- 不额外生成旧式整行/整列道路。
- 城区内部道路和农村内部道路继续独立追加。
- connector 与局部道路共同参与建筑、树石、草垛的权威净空。

#### 4. 显式归属

- mixed 建筑、树、岩石和 cover 携带可选 `regionId`。
- 生成数量按当前区域局部计数，不再通过坐标落入可能重叠的 rectangle 计数。
- mixed 物资通过 blueprint building ID 到 `regionId` 的映射筛选区域建筑。
- gameplay 仍把这些对象当普通 `MapObstacle`，不引入 mixed-only 碰撞分支。

### 任务拆解

### Task 1: 锁定失败回归

- 目标：让旧六宫格实现明确失败。
- 仓库 / 文件：`tests/unit/mixedMapLayout.test.ts`。
- 前置依赖：本 plan 完成。
- 关键改动点：断言 seed 确定性与跨 seed 变化、唯一坐标数量、近方形面积、整体包围盒、每区近邻边缘距离、connector 连通/斜向/长度和旧固定 segment 消失。
- 验证方式：运行 `npx vitest run tests/unit/mixedMapLayout.test.ts`，确认新增测试在旧实现上因固定槽位失败。
- 完成标志：失败信息直接指向六宫格、区域尺度或长 connector，而不是无关生成错误。

### Task 2: 实现紧凑随机蓝图

- 目标：替换固定槽位和网格 connector。
- 仓库 / 文件：`src/config/mixedMap.ts`。
- 前置依赖：Task 1。
- 关键改动点：独立位置 RNG、受约束随机中心、近方形尺寸、尺度化 landing zones、MST connector、尺度化城区/农村道路与建筑 parcel、森林山丘。
- 验证方式：定向 Vitest；额外扫描连续和分散 uint32 seeds，检查生成成功、边界、最小间距、最长 connector 和全 27 类型组合。
- 完成标志：新增宏观测试通过，旧 seed `11 / 16 / 38` 类型组合保持。

### Task 3: 固化区域归属

- 目标：允许区域靠近时仍准确生成和计数内容。
- 仓库 / 文件：`src/config/map.ts`、`tests/unit/mixedMapLayout.test.ts`。
- 前置依赖：Task 2。
- 关键改动点：mixed 实体携带 `regionId`；生成循环使用局部计数；物资按 blueprint 归属筛选建筑；测试按显式归属断言数量和区域边界。
- 验证方式：mixed layout、AI loot、Movement、Combat/LOS 与 GridNavigator 定向测试。
- 完成标志：代表 seed 和压力 seed 均无区域误计数、穿模、物资缺失或生成失败。

### Task 4: 同步长期文档

- 目标：仓库规则准确反映随机紧凑布局。
- 仓库 / 文件：`AGENTS.md`、`README.md`、`docs/architecture.md`。
- 前置依赖：Task 2–3 结构稳定。
- 关键改动点：记录非网格随机中心、近方形区域、显式 region ownership 和短连接骨架；不写一次性数值流水账。
- 验证方式：全文搜索旧 `3 × 2` / fixed slot 表述；`git diff --check`。
- 完成标志：文档与代码 contract 一致。

### Task 5: 完整验证与实图验收

- 目标：确认布局修正没有破坏完整游戏。
- 仓库 / 文件：全仓库和 production build。
- 前置依赖：Task 1–4。
- 关键改动点：执行 typecheck、完整 unit/Worker/standalone、三套 coverage、全部 builds 和 budgets；再用 Chrome MCP 验收普通 seed 与极端类型 seed。
- 验证方式：
  - `npm run typecheck`
  - `npm run test`
  - `npm run test:coverage`
  - `npm run build`
  - `npm run build:worker`
  - `npm run build:server`
  - `npm run build:standalone`
  - `npm run check:budgets`
  - Chrome MCP 桌面与 `844 × 390` mobile，音量 `0`。
- 完成标志：全部命令通过；实图确认六地点自然紧凑且无六宫格；浏览器与服务器全部清理。

### Task 6: 独立审查与 GitHub 闭环

- 目标：完成独立静态审查和 PR 增量交付。
- 仓库 / 文件：完整 diff、本 plan、现有 PR。
- 前置依赖：Task 5。
- 关键改动点：启动独立 reviewer；逐项判断 finding，解决全部 blocker/high/medium 并复审；在 commit 前写完 `## Build` / `## Review`；提交、普通 push、重新评论 `@codex review` 并监控。
- 验证方式：`git diff --check`、staged paths 检查、远端 SHA/PR head/CI/Codex commit 对齐。
- 完成标志：reviewer 与 Codex 均无重大问题，PR head 和本地提交一致。

### Task 7: 修复联机桌面自动进入

- 目标：联机桌面从真实用户操作进入比赛后直接获得游戏输入，不再先显示“继续游戏”卡。
- 仓库 / 文件：`src/controllers/pointerLock.ts`、`src/app/GameApp.ts`、`src/app/MultiplayerSession.ts`、`tests/unit/gameAppActions.test.ts`。
- 前置依赖：保留现有单机安全 helper 和多人房间状态机。
- 关键改动点：统一 desktop pointer-lock helper；公开自动倒计时入口、私人 ready/start 入口同步预锁；session resume 安全去重；touch 隔离。
- 验证方式：先添加 helper 失败测试；运行 GameApp/pointer-lock 定向测试、完整 unit/Worker/standalone；production standalone 双浏览器真实创建/准备/开始，检查 pointer lock 与 pause card。
- 完成标志：桌面联机加载后 pause card 隐藏且输入 active；拒绝 pointer lock 时仍显示可用兜底，不中止比赛。

### 风险与验证

- **全城区压力：** 六个扩大城区靠近后，后生成区域可能因跨区建筑和道路净空不足而达不到 36 栋。必须用 seed `16` 和分散高位 seed 压力扫描，必要时调整中心最小距离或 parcel 尺度，不能删除全局碰撞。
- **区域归属漂移：** footprint 靠近后坐标判断会重复命中。必须显式记录 `regionId`，不能靠数组顺序或名称反推。
- **道路切穿：** MST connector 可能穿过第三个区域或山丘。所有建筑/自然障碍继续消费完整 road footprint；浏览器需观察道路是否形成不自然长直线。
- **森林密度：** 面积增大而树数不变会视觉变稀。按面积比调整数量，并核对 scene resource/AI operation budgets。
- **地图边界：** 中心采样限制必须考虑区域半尺寸、建筑、山丘和道路 shoulder，压力扫描所有生成物均不得出界。
- **缓存：** `createMapLayout("mixed", seed)` 缓存同 seed 结果；测试中心变化时使用不同 seeds，不能把 cache 误判为生成未变化。

### MVP / 下一步

先添加会在旧实现上失败的宏观布局回归；随后只修改 `mixedMap.ts` 和 `map.ts` 完成最小正确布局修正。定向测试稳定后再更新文档并进入完整验证，不提前调整预算。

## Build

### 更新日志

- 2026-08-07 02:29：完成本轮独立 plan；开始前分支为 `feat/hybrid-regions`，HEAD 为 `a47ab50`，本地与远端一致且工作区干净。实现尚未开始。
- 2026-08-07 02:30：先在 `tests/unit/mixedMapLayout.test.ts` 添加宏观失败回归；旧实现准确因 seed 之间中心完全相同、固定六宫格和 7 条网格 connector 失败，其他既有 mixed 测试继续通过，证明新测试命中用户指出的布局问题。
- 2026-08-07 02:40：在 `src/config/mixedMap.ts` 将固定 `3 × 2`、`640 × 880` 槽位替换为 seed 确定性的紧凑随机中心与 `780 × 780` 近方形区域。中心采样限制最小距离、最近邻上限、整体包围盒、近似同行/同列和连接长度；代表 seed 的中心均至少有 5 个唯一 X/Z，旧全农村 `11`、全城区 `16`、全森林 `38` 类型组合保持。
- 2026-08-07 02:49：宏观 connector 改为 Kruskal 最短连通树，固定为 5 条边；端点连接区域边缘或城区内部道路，候选边若穿越第三个区域开发核心即拒绝。`urbanRoadSegments` 仍仅包含城区内部 4 条道路，connector 不获得工业呈现。
- 2026-08-07 02:54：为靠近后的过渡带增加显式 `regionId` ownership。mixed 建筑、树、岩石、草垛携带区域 ID，建筑/自然障碍/区域物资同时要求最近中心属于该区域；生成和测试不再从可能重叠的矩形反推归属。物资按 `regionId` 选择区域建筑，旧苍岬岛和灰炉城对象不设置该字段。
- 2026-08-07 03:04：将 16 个 landing zone 与六个小地图标签中心解耦：城区入口放在内部道路公共空间，农村入口沿乡间道路，森林入口位于林间保留地。针对真实高位 `mapSeed=2581720956` 的不可达物资复现，将 mixed 室外物资建筑外缘净空提高到 8m，避免落入相邻城区长楼之间的窄缝；室内物资、总量和拾取规则不变。
- 2026-08-07 03:06：区域扩大后森林树数由每区 150 提高到 180，保持原有森林树密度；城区仍固定 36 栋，农村 9 栋，森林 2 栋，既有岩石、草垛和山丘数量保持。城区补充候选使用较小临街建筑填满 36 栋，未通过减少建筑数掩盖紧凑布局压力。
- 2026-08-07 03:10：定向验证通过：`mixedMapLayout` 8/8；mixed/AI 筛选 13 项通过；三个 mixed 输入随机 seed 的 750 个物资点全部可导航、可拾取；250 个连续 seed 蓝图生成 0 失败，100 个连续 seed 完整 `MapLayout` 生成 0 失败且均为 250 个物资；全 `npm run typecheck` 通过。失败过的放大补充楼参数因 4/250 seed 无法生成 36 栋已回退，没有降低生成稳定性或测试标准。
- 2026-08-07 03:10：同步 `AGENTS.md`、`README.md`、`docs/architecture.md`、`docs/deployment.md`，长期契约改为紧凑不规则中心、近方形区域、5 条短 connector、显式最近区域归属、类型化 landing zone、180 棵森林树和 mixed 室外物资 8m 建筑净空。`git diff --check` 通过，生产代码/长期文档无旧 `REGION_SLOTS` 或中文拼音标识。
- 2026-08-07 03:27：完整自动测试完成。unit 为 44 files / 430 tests，全部通过；本机 Debian glibc 2.28 无法直接启动当前 workerd，使用任务开始前已存在且上轮验证过的 `/tmp/last-line-workerd-runtime/workerd` 用户态 glibc wrapper 后，Worker 为 4 files / 32 tests、standalone 为 3 files / 22 tests，全部通过。wrapper 仅用于测试进程环境，没有修改系统或仓库。
- 2026-08-07 03:56：三套 coverage 全部通过。机器同时有约 68 个仓库外象棋 self-play 进程占满 64 核，默认并发 coverage 首轮出现多个未改模块的 5s wall-clock timeout；确认 load average 约 69 且无断言/阈值共同根因后停止无效轮次，按仓库上次同类环境已验证的 `8 workers + 120s` 通用安全 timeout 重跑同一 unit coverage，三条长压力测试仍使用各自 600/900/2400s 有限上限，未修改代码、测试断言或覆盖率阈值。最终 application V8 为 statements 77.78%、branches 71.76%、functions 80.60%、lines 79.82%，`mixedMap.ts` 为 97.25% / 91.12% / 100% / 99.29%；Worker Istanbul 为 77.69% / 70.16% / 92.73% / 83.42%；standalone V8 为 77.13% / 62.25% / 86.30% / 80.43%；加权总值为 77.74% / 71.18% / 82.64% / 80.33%。
- 2026-08-07 03:58：browser、Worker、server、standalone 四套构建全部通过。第一次并行 build 同时写 `dist/` 留下重复 hash chunk，导致总量/数量假超限；随后按 `build:standalone -> build:worker -> check:budgets` 顺序重建清理产物竞态，确认总 browser JS、chunk 数、CSS、整个 dist 均原预算 PASS，仅共享权威布局逻辑导致三个 raw 单文件真实增量：browser `1,091,098 / 1,090,000`、Worker `499,002 / 490,000`、server `515,883 / 510,000`。完成资源审阅后只把这三项上限最小调整到 `1,095,000 / 500,000 / 520,000`，保留约 0.36%–0.82% 余量，其他六项预算不变。最终预算全部 PASS：browser `1,091,098 / 1,095,000`、largest non-entry `613,551 / 650,000`、all JS `3,787,753 / 3,900,000`、252 / 260 chunks、CSS `44,643 / 45,000`、dist `4,309,692 / 4,450,000`、Worker `499,002 / 500,000`、server `515,883 / 520,000`。
- 2026-08-07 04:04：完成两轮 production Chrome MCP 验收，全程主音量为 `0`。桌面高画质进入烬岚郡航线阶段，HUD/小地图显示地图名、六个区域和唯一“医院”；DOM 读取的六个 POI transform 为 `(143.97,54.09)`、`(156.50,115.11)`、`(92.02,93.99)`、`(82.57,158.28)`、`(39.91,76.95)`、`(86.12,39.50)`，横纵坐标均为 6 个不同值，跨度约 `117 × 119` 小地图像素，实图确认地点贴近成连续战场而非旧 3 列 × 2 行。桌面截图保存为 `/tmp/last-line-compact-mixed-desktop.webp`。
- 2026-08-07 04:04：移动轮次使用 `844 × 390 × DPR2`、mobile、touch、landscape。烬岚郡小地图边界为 `731,86 -> 829,184`，完整处于视口；视角区、左右开火、瞄准、跳跃、拾取、换弹、切枪、绷带、急救、暂停、背包共 12 个可见触控交互全部在视口内。移动截图保存为 `/tmp/last-line-compact-mixed-mobile-844x390.webp`。两轮控制台均只有本机 SwiftShader software WebGL deprecation warning，无应用错误；每轮结束后立即导航到 `about:blank`、停止 preview，最终确认浏览器仅剩 `about:blank` 且 8798 端口关闭。
- 2026-08-07 04:48：重新完整阅读本 plan 后逐项验证并采纳独立 reviewer Round 1 的 3 个 medium 和 1 个 low。中心生成新增单轴 `1,400m` 与包围盒面积 `1,450,000m²` 硬上限，比旧固定中心阵列面积至少缩小 14.8%；位置生成会按实际区域类型预构建 connector，若无法形成 5 条无交叉、不过第三模块开发核心的平面连通树则确定性重试。seed `4820` 修复后面积 `1,449,630m²`，seed `12894` 修复后 connector 不再相交。
- 2026-08-07 04:48：城区密度不再用完整 `780 × 780` 矩形作分母。新增确定性 Voronoi 半平面裁剪，精确计算 nearest-owned 区域多边形及建筑矩形与该多边形的交集，生产生成器强制 36 栋建筑覆盖率至少 38%；较大临街 fallback 候选按 footprint 优先选择，仍保留小楼兜底而不增加建筑数。500 个连续 blueprint seed 0 失败，最低真实 owned 覆盖率为 39.11%（seed `498:mixed-region-3`）；reviewer seed `256` 的四个城区为 40.95%–46.55%。
- 2026-08-07 04:48：森林/农村 hill 的半径先生成，再把 X/Z 中心采样范围夹到 `[-1200 + radius, 1200 - radius]`，保证完整 footprint 在地图内；reviewer seed `423` 的越界农村 hill 已消失。测试新增 seed `423` 全部 hill radius 边界断言。
- 2026-08-07 04:48：新增 reviewer 反例与压力回归：seed `4820` 的中心面积、seed `12894` 的 connector 非交叉、seed `256` 的真实城区密度、seed `423` 的完整 hill footprint；另连续 10,000 个位置 seed 聚合断言 span/area 合同，使用有限 600s 安全上限且不减少 seed 或放宽几何阈值。该 mixed 文件 9/9 通过；500 seed blueprint 和 100 seed 完整 `MapLayout` 均 0 失败；全 typecheck 通过。
- 2026-08-07 05:00：高密修复最初让两个混合物资反例暴露出 zone 与入口错配：单纯把自然障碍净空提高到 14m 只会移动失败点。最终根因修复为每个 mixed 室外物资围绕自己的类型化 landing-zone anchor 在 30–175m 内确定性采样，同时要求 anchor 到物资的 1.5m 权威走廊不穿建筑、树、石、草垛或坡道；8m 建筑端点净空和 14m 自然障碍端点净空作为附加保障。三个 mixed 输入随机 seed 的 750 个物资重新全部可达/可拾取，100 seed 完整生成 0 失败。
- 2026-08-07 05:00：reviewer 修复后完整 `npm run test` 返回 0：unit 44 files / 431 tests、Worker 4 / 32、standalone 3 / 22。Worker 继续使用已记录的本机 workerd wrapper；未修改协议、checkpoint、测试断言、AI operation budget 或旧地图 golden。
- 2026-08-07 05:56：reviewer 修复后的三套 coverage 全部通过。连续 10,000 seed 宏观用例在 V8 coverage + 持续 68 个外部满核任务下实测 624s，原 600s 有限保护上限仅发生 wall-clock timeout、无几何断言失败；将该压力测试上限调整为 900s，与仓库既有 100-seed 几何压力一致，未减少 seed 或改变 `1,400m / 1,450,000m²` 阈值。最终 unit 44 files / 431 tests 为 77.94% / 71.82% / 80.83% / 80.00%，Worker 4 / 32 为 77.56% / 70.08% / 92.73% / 83.28%，standalone 3 / 22 为 77.13% / 62.25% / 86.30% / 80.43%，加权总值为 77.86% / 71.23% / 82.79% / 80.46%。
- 2026-08-07 05:58：reviewer 修复后的 standalone/browser、Worker、server 顺序构建全部通过。精确 Voronoi 裁剪、平面 connector 检查和 mixed 物资走廊属于三端共享权威逻辑；最终产物为 browser `1,093,837B`、Worker `507,944B`、server `524,275B`。browser 继续通过既有 `1,095,000B` 上限；经第二次最小资源审阅，仅把 Worker/server raw 上限从 `500,000 / 520,000` 调整为 `510,000 / 530,000`，保留约 0.4% / 1.1% 余量。最终全部预算 PASS：browser `1,093,837 / 1,095,000`、largest non-entry `613,551 / 650,000`、all JS `3,790,492 / 3,900,000`、252 / 260 chunks、CSS `44,643 / 45,000`、dist `4,312,431 / 4,450,000`、Worker `507,944 / 510,000`、server `524,275 / 530,000`；`git diff --check` 通过。
- 2026-08-07 06:05：完成 reviewer 修复后的最终 production Chrome MCP 复验，全程音量 `0`。桌面高画质小地图六 POI transform 为 `(131.65,59.79)`、`(46.82,67.58)`、`(138.62,120.10)`、`(42.93,136.38)`、`(87.79,104.97)`、`(103.42,158.69)`，仍为六组不同坐标，跨度约 `96 × 99` 小地图像素，比 Round 1 前实图更紧凑；唯一医院在 `(122.24,82.24)`。桌面截图为 `/tmp/last-line-compact-mixed-final-desktop.webp`。移动 `844 × 390 × DPR2` 中 11 个可见按钮全部在视口内，小地图 `731,86 -> 829,184` 完整在界内，截图为 `/tmp/last-line-compact-mixed-final-mobile-844x390.webp`。两轮控制台仅 SwiftShader warning；每轮结束均立即导航 `about:blank`、停止 preview，最终浏览器仅剩 `about:blank` 且 8798 关闭。
- 2026-08-07 06:13：用户追加联机桌面加载后仍显示“继续游戏”卡的问题。失败测试先确认缺少共享 desktop helper；根因是单机在真实“开始游戏”手势中同步请求 pointer lock，而 `MultiplayerSession.resumeInput()` 仍直接调用旧 API 且首次执行发生在异步场景加载后，浏览器用户激活已经丢失。新增 `requestDesktopPointerLockSafely` 和 `releasePointerLockSafely`，单机/联机 session 统一处理已锁定去重、touch 隔离、API 缺失、同步异常、legacy void 和 Promise rejection。
- 2026-08-07 06:39：联机真实手势接线完成。快速匹配、创建公开房、按码/公开房列表加入会在点击内预锁以覆盖公开自动倒计时；创建私人房不预锁，私人访客入房未准备时会释放预锁以保留大厅光标，点击“准备”时重新锁定；私人房主点击“开始对局”时同步锁定。联机菜单、加入失败、连接关闭、terminal/cannot-start、退出房间、场景创建失败和返回菜单都会安全释放。策略由 `multiplayerAdmissionRequestsPointerLock` / `privateLobbyReleasesPointerLock` 显式承载；`gameAppActions`、`gameHudActions`、`humanController` 定向 3 files / 29 tests 通过，app typecheck 通过，app/controller 无直接 `requestPointerLock()` 调用。
- 2026-08-07 06:39：完成 same-origin standalone 真实双客户端 Chrome MCP 验收。使用临时 `/tmp/last-line-pointer-lock-e2e` SQLite 目录和 `http://127.0.0.1:8799`，两个隔离 browser context 创建私人房：Guest 按码加入后的未准备 lobby 自动释放 pointer lock，点击“准备”后 `pointerLockElement===canvas`；Host 点击“开始对局”后立即锁定。3 秒倒计时和异步场景加载后，Host 与 Guest 均保持 `pointerLockElement===canvas`，pause card `is-visible=false` / `display:none`，Host 音量设置为 `0`；双方 console 仅 SwiftShader warning。截图为 `/tmp/last-line-multiplayer-auto-pointer-lock-host.webp`。验证后两个 context 均导航 `about:blank` 并关闭，standalone 有界 shutdown 完成，8799 关闭，Chrome 只剩不可避免的 `about:blank`。
- 2026-08-07 07:26：联机 pointer-lock 最终实现增加显式策略合同。`multiplayerAdmissionRequestsPointerLock` 仅对 quick/public/join 预锁，私人房主创建等待时不锁；`privateLobbyReleasesPointerLock` 让私人访客入房未准备阶段恢复光标，点击准备时再锁。所有菜单、失败、closed/terminal/cannot-start、leave、场景创建失败和 return 路径使用容错 release helper；单机/联机 session resume 使用同一 desktop helper，app/controller 已无直接 `requestPointerLock()`。最终 `gameAppActions` / `gameHudActions` / `humanController` 为 3 files / 29 tests。
- 2026-08-07 07:26：用户追加需求后的最终完整自动门禁全部通过：typecheck；unit 44 files / 436 tests；Worker 4 / 32；standalone 3 / 22。最终 unit coverage 为 statements 77.81%、branches 71.80%、functions 80.82%、lines 79.84%；Worker/standalone coverage 源码未变并沿用最终已通过报告 77.56% / 70.08% / 92.73% / 83.28% 与 77.13% / 62.25% / 86.30% / 80.43%；加权总值为 77.75% / 71.21% / 82.79% / 80.32%。
- 2026-08-07 07:26：最终 same-origin browser/server、Worker dry-run 构建与预算通过。联机 UX 新增约 926B browser entry，完成最小资源审阅后 browser raw 上限从 `1,095,000` 调为 `1,100,000`，保留约 0.48% 余量，其他预算不变。最终 browser `1,094,763 / 1,100,000`、largest non-entry `613,551 / 650,000`、all JS `3,791,418 / 3,900,000`、252 / 260 chunks、CSS `44,643 / 45,000`、dist `4,313,357 / 4,450,000`、Worker `507,944 / 510,000`、server `524,275 / 530,000`，全部 PASS；`git diff --check` 通过。

## Review

待完整实现和所有外层验证完成后，由独立 reviewer 追加。

### Round 1 — 2026-08-07

- 审查范围：以 `a47ab505a6d4bf5ab7c7046a52e9bf96a6d0a93a` 为本轮直接基线，静态审查 `git diff a47ab50` 的全部 tracked 增量、本 plan、根 `AGENTS.md`、`README.md`，并结合 `main@7a453f5` 与既有 mixed 地图语义检查回归。
- 已参考外层验证：typecheck、unit 44 files / 430 tests、Worker 4 / 32、standalone 3 / 22、三套 coverage、四套 build、budgets、250-seed blueprint、100-seed `MapLayout`、Chrome MCP desktop/mobile；reviewer 未重复这些命令。
- 额外最小只读验证：现有证据未直接覆盖 connector 非交叉、整体中心包围盒相对旧阵列、城区覆盖率多 seed 下界和完整 hill footprint 边界，因此运行无文件修改的导入扫描。10,000 个位置 seed 全部可生成；500 个 blueprint seed 全部可生成；100,000 个 seed 的 connector 几何扫描发现 5 个交叉布局。
- 审查结论：**不通过，阻止提交。** Findings：blocker 0、high 0、medium 3、low 1。以下 3 个 medium 必须由 builder / writer 修复并请求复审；low 应一并修复或给出明确的边界合同理由。

#### Medium

1. `src/config/mixedMap.ts:82`、`src/config/mixedMap.ts:227`：整体紧凑条件只把 X/Z 各自限制到 `1,440m`，没有实现 plan 要求的“六中心整体包围盒明显小于旧 `1,520 × 1,120` 阵列”。10,000-seed 只读扫描中 9,746 个 seed 的 Z span 仍不小于旧 `1,120m`，6,473 个 seed 的中心包围盒面积不小于旧阵列；seed `4820` 为 `1,435.320 × 1,438.195m`，面积约为旧阵列的 121.3%。这会让区域虽脱离六宫格，但大量 seed 仍铺成更高、更大的宏观战场，直接偏离“拉近、减少大片空白”的用户目标。需要把整体 span/area 或等价聚合指标纳入生成接受条件，并加入会覆盖该反例的多 seed 回归。
2. `src/config/mixedMap.ts:425`、`AGENTS.md:35`、`docs/architecture.md:43`：Kruskal 只按长度和第三区域核心过滤边，没有拒绝候选边与已经选择的 connector 相交，却把长期合同写成 “non-crossing”。100,000-seed 只读几何扫描发现 5 个交叉布局，首个为 seed `12894`：connector `0→3` 与 `4→5` 在无共享端点时相交。道路交叉既违反 plan/AGENTS，也可能在区域过渡带形成无设计依据的 X 形道路。需要在选边时拒绝与已选 connector 的非端点相交，或改用能保证平面性的连接算法，并添加该 seed 和跨 seed 非交叉测试。
3. `tests/unit/mixedMapLayout.test.ts:199`、`src/config/mixedMap.ts:662`：本轮把城区覆盖率断言从既有 `38%` 下调到 `28%`，但 plan 验收清单明确要求“维持既有高覆盖率范围”，且没有在 Build 中记录该需求变更。实际 500-seed 扫描最低已经只有约 `24.11%`（seed `256` 的 `mixed-region-5`），代表性测试未抓到并且当前 `28%` 下界本身也不是生成器合同。用户要求城区像灰炉城一样非常密集；允许大量 34–58m 补充楼把覆盖率降到旧范围以下会造成可见稀疏回归。需要恢复可生成的高密度布局/明确下界，并用足够的多 seed 测试证明，而不是放宽测试。

#### Low

1. `src/config/mixedMap.ts:530`、`tests/unit/mixedMapLayout.test.ts:68`：边界测试只检查 region rectangle，未检查 `terrainHills` 的完整半径 footprint。seed `423` 的 rural hill 为 `z=1002.509, radius=208.742`，越过 `MAP_HALF_SIZE=1200` 约 `11.251m`；中心仍在地图内，所以当前断言不会失败。山丘高度函数仍会影响边界内地形，但其权威 footprint 与 plan 的“所有生成物均不得出界”不一致。应约束 hill center/radius 或把合同和测试明确为仅要求可见地图内采样安全。

- 非阻塞确认：`regionId` 仅作为 mixed 权威实体可选元数据加入，island/town 生成路径未被赋值；mixed 物资按 landing-zone blueprint 的 `regionId` 选择建筑，并对室外点做 nearest ownership；`urbanRoadSegments` 仍只含城区局部道路；预算只调整三个确有增量的 raw artifact 上限，余量约 0.36%–0.82%，其他预算未变。

### Round 2 — 2026-08-07

- 审查范围：冻结实现后重新完整读取 reviewer 提示、根 `AGENTS.md`、`README.md` 和本 plan；继续以 `a47ab505a6d4bf5ab7c7046a52e9bf96a6d0a93a` 为直接基线、`main@7a453f5` 为主分支背景，静态复审当前全部 tracked diff、untracked plan、地图生成/物资调用链和联机 pointer-lock 状态机。
- 已参考外层最终证据：typecheck；unit 44 files / 436 tests、Worker 4 / 32、standalone 3 / 22；最终 coverage 与加权报告；500 seed blueprint、100 seed `MapLayout`、10,000 seed positions、750 mixed loot；顺序 builds/budgets；地图 desktop/mobile Chrome；same-origin standalone 双客户端私人房 pointer-lock E2E 及页面、服务清理。reviewer 未重复完整门禁。
- Round 1 disposition：已确认 `1,400m` 单轴和 `1,450,000m²` 包围盒硬限制及 seed `4820` / 10,000-seed 回归；connector 选边拒绝已选边相交且位置生成按实际 region kinds 预验证，seed `12894` 已覆盖；Voronoi nearest-owned polygon 与建筑交集覆盖率由生产强制不低于 38%，seed `256` 与 500-seed 下界证据有效；hill 先确定半径再夹紧中心，seed `423` 的完整 footprint 保持在地图内。Round 1 的 3 个 medium 和 1 个 low 均已解决。
- 额外最小只读验证：生产与测试共同调用 `mixedRegionBuildingCoverage`，现有证据不能独立排除同源公式错误，因此仅对 seeds `0 / 16 / 42 / 256 / 498 / 4820 / 12894` 的所有城区运行独立 `500 × 500` midpoint grid 近似；owned area 与 coverage 均在 0.5% 容差内匹配精确半平面裁剪，结果 PASS，未修改文件。
- 联机结论：安全 helper 正确包含 optional API、同步异常、legacy void、thenable rejection、已锁定去重和 touch 隔离；quick/public/join 在真实点击中预锁，create-private 不锁，私人 guest 未准备释放、ready 重锁、host start 锁定。menu、admission/list join failure、closed、terminal、cannot-start、leave、scene creation failure 和 session exit 均释放；加载期 terminal 由 `MultiplayerConnection` 缓存后交给新 session 的 `processMessages()`，最终仍走 `returnToMenu` 释放。session start 在锁已保持时不重复请求，拒绝时保留 `继续游戏` 兜底；未发现等待大厅锁死、异步用户激活误用、误释放或错误路径泄漏。
- 其他确认：mixed outdoor loot 以对应 landing-zone 为 anchor，在 nearest-owned 区域内采样，并同时要求端点净空和建筑/自然障碍/坡道二维权威走廊；750 点真实导航/拾取与 100-seed 生成证据覆盖其主要失败面。10,000-seed 压力用例保留所有样本和几何阈值，`900s` 是受高系统负载影响的有限 wall-clock 保护，不是性能 gate 或断言弱化。三次预算调整均对应可归因的 raw artifact 增量，最终只改 browser/Worker/server 单文件上限并保留约 0.4%–1.1% 余量，其他资源预算未放宽；文档与最终合同一致。
- 审查结论：**通过。** 本次审查未发现明确问题。Findings：blocker 0、high 0、medium 0、low 0；没有阻止提交的 unresolved finding。
- 残余风险：公开 quick/public/list-join 的真实浏览器 pointer-lock 成功链路主要由相同同步手势接线、helper 测试和私人房双客户端 E2E 类推，最终 Chrome E2E 未逐一点击这三个公开入口；浏览器拒绝 pointer lock 的真实 UI 表现由容错 helper、HUD input-active 逻辑和既有 `继续游戏` 卡合同覆盖，自动化未控制浏览器权限策略强制拒绝。两项均为非阻塞经验性浏览器覆盖边界。
