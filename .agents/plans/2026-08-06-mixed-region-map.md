## Plan

### 项目背景信息

当前游戏提供两张同为 `2400m × 2400m` 的权威地图：

- `mapId: "island"`，显示名“苍岬岛”，以山地、村落、树林、岩石和稀疏建筑为主。
- `mapId: "town"`，显示名“灰炉城”，以高密工业建筑、连通街道、多层楼和二楼连廊为主。

本任务新增第三张混合地图。它不是把两张旧地图简单叠加，而是在同一张不扩大的地图中划分六个大型区域，让高密城区、稀疏农村和山坡密林都成为可辨识、可战斗、可导航的权威环境。三种区域至少各固定存在一个，另外三个区域的类型由 `mapSeed` 确定性选择。

当前分支为 `feat/hybrid-regions`，从最新 `main@7a453f5` 创建。规划、实现、测试、浏览器验收、修复和 GitHub 交付均由当前主 agent 自己完成；除最终强制的独立 `code-reviewer` 外，不启动 planner/writer subagent。只有遇到独立且适合并行的研究探索问题时才允许使用 explorer。

### 事实与约束对齐

- 地图显示名定为 **“烬岚郡”**，稳定程序标识定为 `mapId: "mixed"`；地图身份不能编码在 `mapSeed` 的符号位、范围或特殊值中，程序标识不得使用中文拼音。
- 地图尺寸继续使用全局 `MAP_SIZE = 2400`，不改变航线、安全区、远裁剪、小地图比例或联机空间范围。
- 玩家可见医院名称只能是 **“医院”**。每个烬岚郡 seed 必须恰好有一个医院，医院必须属于固定城区，不能生成在农村或森林。
- 地图必须有六个大型命名区域：
  - 固定城区：`赤钟城区`。
  - 固定农村：`风穗乡`。
  - 固定山林：`沉杉岭`。
  - 三个随机区域：每个由独立、确定性的 seed 流选择 `town | rural | forest`，允许同类重复。
- 随机区域按类型从对应名称池无重复取名：
  - 城区：`白塔旧城`、`铜灯街区`、`断桥坊`。
  - 农村：`雁栖庄`、`麦风坳`、`石篱村`。
  - 山林：`乌松岭`、`雾鹿峰`、`暮鸦山`。
- “城镇 / 农村 / 森林”只作为内部区域类型，不直接显示成地点名。
- 城区必须参考灰炉城的紧凑街墙和高密建筑，不得退化为苍岬岛式村落；农村必须是稀疏房屋、较多草垛、岩石和零散树木；森林必须位于山坡地形，树木局部密度显著高于苍岬岛，并包含岩石，不生成平原或草地区域。
- 所有房屋、墙体、开口、楼板、坡道、道路、树干、岩石、草垛和地形山丘都是权威地图数据。Movement、Combat/LOS、GridNavigator、AI、服务器和渲染必须消费同一 `MapLayout`，不能只做视觉模块。
- `src/game/` 不能引入 DOM 或 Babylon；控制器仍只产生 `ActorCommand`。
- 苍岬岛和灰炉城既有 seed 结果必须保持不变。新增生成器使用独立文件和独立随机流，不改变旧生成器的随机调用顺序。
- 旧设置、旧房间请求和旧持久化记录缺少/包含未知 `mapId` 时仍归一化为苍岬岛；已知 `"town"` 和新增 `"mixed"` 必须原样保留。
- 旧协议 6 客户端不知道 `"mixed"`，会把它错误走入 island fallback。`MULTIPLAYER_PROTOCOL_VERSION` 必须升为 7，确保旧客户端被明确拒绝。
- 本任务不改变苍岬岛或灰炉城权威布局，也不改变已有 checkpoint state 结构。最终 `MATCH_CHECKPOINT_VERSION` 为 6：兼容读取 v5 island/town/缺失 mapId 的旧岛屿状态，拒绝 v5 mixed 和 v4 及更旧状态，避免回滚到旧代码时把 mixed 坐标归一化成 island 权威几何。
- 不新增外部 GLB、贴图或浏览器依赖；复用稳定 asset ID、程序化建筑、现有材质和 POI decal。
- 测试只使用 Vitest；禁止安装 Playwright 或下载 Chromium。真实浏览器验收使用已配置的本地 Chrome DevTools MCP，全程音量 `0`。
- 实现、测试、完整构建和 Chrome MCP 验收完成后，必须启动独立 `code-reviewer`。所有 blocker/high/medium finding 必须处理并复审通过后才能 commit/push。
- 关联 plan 的 `## Build` 和 `## Review` 必须在实现 commit 前写完并与实现一起提交；commit 后禁止回写本 plan，禁止 plan-only commit。
- GitHub 操作优先使用 `gh`。分支推送后创建 Pull Request，在 PR 评论中发送 `@codex`，持续轮询 review/check/comment，处理有效问题并再次完成必要验证和独立 reviewer，直到 Codex 明确无问题或留下可核验的通过状态。

### 更新日志

- 2026-08-06 16:39：用户提出新增一张同尺寸混合地图，要求由六个大型区域组成，至少固定一个高密城区、一个稀疏农村和一个山坡密林，另三个区域按 seed 随机为三类之一；医院只能有一个且只能位于城区。
- 2026-08-06 16:43：核实现有正式地图名为“苍岬岛”和“灰炉城”；用户纠正不能把“海岛”当正式名称，并要求新地图医院只显示“医院”。
- 2026-08-06 16:44：地图显示名暂定并确认采用“烬岚郡”；地点名采用与现有中文 POI 一致的具名风格，不直接显示“城镇 / 农村 / 森林”。
- 2026-08-06 16:50：从最新 `main@7a453f5` 创建功能分支；工作区干净，开始规划前未修改运行时代码。
- 2026-08-06 16:51：用户明确要求当前主 agent 自己同时承担 planner 和 writer；除最终 reviewer 外不启动其他 subagent，研究探索任务可按需使用 explorer。已停止误启动的 planner，且不采用其未完成产出。
- 2026-08-06 16:52：用户允许 GitHub 相关操作使用 `gh`；交付步骤确定为普通 push、`gh pr create`、PR 评论 `@codex` 和持续 review/check 轮询。
- 2026-08-06 16:52：兼容策略初步定稿：新增第三个稳定 map ID、协议升级至 7；由于旧两图权威数据与 checkpoint state 结构不变，checkpoint 版本默认保持 5，避免无理由关闭现有运行房间。
- 2026-08-06 17:39：用户明确要求代码标识不得使用中文拼音，分支也不得沿用该名字。稳定标识统一改为语义化英文 `mapId: "mixed"`，本地未推送分支改名为 `feat/hybrid-regions`，plan 改名为 `.agents/plans/2026-08-06-mixed-region-map.md`；显示名“烬岚郡”和中文地点名称保持不变。

### 用户验收口径 / Reviewer 对照清单

1. **第三张地图身份**
   - `MapId` 包含 `"island" | "town" | "mixed"`。
   - `MAP_DISPLAY_NAMES.mixed === "烬岚郡"`。
   - `normalizeMapId("mixed") === "mixed"`；缺失和未知值仍回退 `"island"`。
   - 同一个 seed 的三张地图可以同时存在，cache key 必须包含 `mapId + seed`。

2. **六个区域和 seed 规则**
   - `mapPoints` 玩家可见主地点恰好六个。
   - `赤钟城区` 永远是城区，`风穗乡` 永远是农村，`沉杉岭` 永远是山坡森林。
   - 另外三个区域各自从三种类型确定性选择；同 seed 重建完全一致，不同代表 seed 必须出现不同组合。
   - 同一 seed 内随机名称不重复，名称与实际类型一致。

3. **唯一医院**
   - `layout.hospital.name === "医院"`。
   - 只有一个建筑使用医院身份/白色医院外观和医院医疗点。
   - 医院建筑位于 `赤钟城区` 权威边界内。
   - 两个医院医疗物资点可站立、可导航、可拾取；全图不生成第二个医院。

4. **城区**
   - 每个城区模块使用紧凑本地街道和高密建筑，建筑密度、短视线和街墙明显高于农村与森林。
   - 城区建筑可包含 1–4 层，所有多层楼均有权威楼板、墙体、开口和坡道；不要求新增 skybridge。
   - 固定城区必须稳定容纳医院和足够公共/落点空间。
   - 城区建筑、道路、医院、树木、岩石和 POI 保留区不得互相侵入。

5. **农村**
   - 房屋数量显著少于城区，建筑呈分散院落/农舍形态。
   - 草垛数量和局部密度高于其他区域，并有岩石和零散树木。
   - 农舍入口、坡道、物资和道路可达，草垛/岩石/树干不堵死入口。

6. **山坡森林**
   - 每个森林区域至少有明确山丘中心和足够地形高度/坡度，不得是平地树林。
   - 森林树干局部密度显著高于苍岬岛全图平均密度，且树干数量不随画质变化。
   - 森林包含权威岩石；树干与岩石不进入建筑、道路、落点、医院物资或彼此非法重叠。
   - `GridNavigator`、Movement 和 Combat/LOS 均把这些树干/岩石视为同一权威障碍。

7. **物资、AI 与完整对局**
   - 保持总物资记录的既有 250 规模，其中医院追加医疗点仍占最后两个索引。
   - 六区域及内部 landing zones 都有确定性物资配额，室内/室外点可站立且不穿墙、不落在坡道或障碍中。
   - 49 Bot 能在代表 seed 完成跳伞、导航、搜枪和对局；不得降低既有 AI 阈值掩盖失败。
   - 高密城区和密林不能造成空路径后直穿障碍。

8. **呈现与小地图**
   - 菜单地图选择新增“烬岚郡”，本地设置可保存/恢复。
   - HUD 标题显示“烬岚郡”，小地图显示六个区域名、道路、唯一“医院”标记、安全区和玩家。
   - 新地点复用稳定 POI decal：城区使用 town、农村使用 warehouse、森林使用 station；不引用具体 asset 路径。
   - 高质量呈现可复用适用于城区建筑的灰炉城程序化细节，但必须按实际 urban building/road 范围工作，不能把整张混合图错误当成纯灰炉城。
   - 低/中/高画质的权威树干、建筑、岩石、草垛和道路完全一致；画质只影响 visual-only foliage/detail。

9. **联机、持久化与兼容**
   - 单人、公开房、私人房和 quick match 都能选择 `"mixed"`。
   - quick match 只能加入相同 mapId 的等待房间；通过房间码加入继承房间地图。
   - Worker 和 standalone 共用相同 `MapId`、lobby、room、runtime 和 checkpoint 语义。
   - 协议版本为 7，旧协议客户端得到明确 terminal mismatch，不会把烬岚郡渲染成苍岬岛。
   - 旧 island/town settings、房间和 v5 checkpoint 仍可恢复；v5 mixed 与 v4 及更旧 checkpoint 必须关闭并删除。

10. **旧地图零回归**
    - 苍岬岛 seeds `0 / 42 / 2026` 的现有 golden hash 不变。
    - 灰炉城代表 seed 的建筑、道路、连廊、树、物资和布局签名不变。
    - 现有两图的 NullEngine 场景资源、Movement、Combat/LOS、GridNavigator 和 AI 测试继续通过。

11. **交付门禁**
    - 完整 typecheck、全部 Vitest、三套 coverage、browser/Worker/server/standalone build 和 budgets 通过。
    - production build 通过 Chrome DevTools MCP 完成桌面和 `844×390` mobile 验收；音量始终为 `0`。
    - 每轮浏览器验收后立即关闭页面/context、停止本地服务并确认只剩 `about:blank`。
    - 独立 code-reviewer 无未解决 blocker/high/medium 后才允许 commit/push。
    - PR 创建后评论 `@codex`，持续跟进到 Codex 无问题；有效 finding 必须进入修复、验证、独立复审和更新 PR 的闭环。

### 要实现的功能整体概述

1. 新增 `mixed` 地图身份、菜单选项、显示名和三端共享协议支持。
2. 新增独立 `src/config/mixedMap.ts`，只负责确定性生成烬岚郡六区域蓝图，不修改苍岬岛或灰炉城生成器。
3. 在 `src/config/map.ts` 中把蓝图转换为完整 `MapLayout`：
   - 地形山丘。
   - 城区/农村建筑。
   - 权威墙体、开口、楼板、坡道。
   - 道路、岩石、树干、草垛。
   - 唯一医院和医疗物资。
   - 250 个物资点与 landing-zone 配额。
4. 让导航、场景和 POI 映射显式支持混合地图，而不是把所有 `mixed` 分支粗暴归入 island 或 town。
5. 补齐单人、Worker、standalone、checkpoint、协议、AI、Movement、Combat/LOS、NullEngine 和小地图测试。
6. 同步 README、架构和部署说明，记录三地图选择、混合区域权威契约和协议 7 发布要求。

### 涉及仓库

- `/data00/home/lingchen.judy/self/last-line`

### 数据结构定稿

```ts
export type MapId = "island" | "town" | "mixed";

export type MixedRegionKind = "town" | "rural" | "forest";

export interface MixedRegionSpec {
  readonly id: string;
  readonly name: string;
  readonly kind: MixedRegionKind;
  readonly fixed: boolean;
  readonly centerX: number;
  readonly centerZ: number;
  readonly width: number;
  readonly depth: number;
}
```

`MixedRegionSpec` 属于生成期蓝图 contract，不进入网络 `MatchState`，也不要求给苍岬岛/灰炉城的 `MapLayout` 增加空字段。生产代码和测试通过 `createMixedMapBlueprint(seed)` 使用同一份区域事实，避免从地点名称反推类型。

```ts
export interface MixedMapBlueprint {
  readonly regions: readonly MixedRegionSpec[];
  readonly mapPoints: readonly MixedPointSpec[];
  readonly landingZones: readonly MixedPointSpec[];
  readonly terrainHills: readonly MixedHillSpec[];
  readonly roadSegments: readonly (readonly [number, number, number, number])[];
  readonly urbanRoadSegments: readonly (readonly [number, number, number, number])[];
  readonly buildings: readonly MixedBuildingSpec[];
  readonly hospitalBuildingId: string;
}
```

`MapLayout` 网络外权威结果继续使用现有通用结构。城区建筑可设置现有 `townKind` 供程序化工业呈现识别；农村/森林建筑不伪装成 townKind。

### 文件/模块落点

#### Create

- `src/config/mixedMap.ts`
  - 六区域分配、名称池、宏观位置、局部道路、建筑蓝图、山丘和医院建筑选择。
- `tests/unit/mixedMapLayout.test.ts`
  - 烬岚郡结构、密度、唯一医院、地形、障碍、导航、确定性和旧图隔离的主测试。

#### Modify

- `src/config/maps.ts`
  - `MapId`、显示名和归一化。
- `src/config/map.ts`
  - `createMapLayout("mixed", seed)` 分派；混合蓝图到权威 `MapLayout` 的转换和专用物资/自然障碍生成。
- `src/config/townMap.ts`
  - 仅在确需复用无状态几何 helper 时导出最小 helper；禁止改变灰炉城生成顺序或结果。
- `src/app/GameApp.ts`
  - 第三张地图选择 option 和现有设置/联机 UI 消费。
- `src/client/poiVisuals.ts`
  - 12 个候选区域名到现有稳定 POI visual type 的映射。
- `src/client/render/scenes/IslandScene.ts`
  - 混合地图 terrain/城区呈现/自然 detail 避让；保持画质与权威几何隔离。
- `src/ai/navigation/GridNavigator.ts`
  - 让混合地图的多层城区使用正确 interior/exterior blocker 语义，不影响 island/town。
- `src/network/protocol.ts`
  - 协议版本 7。
- `tests/unit/mapSelection.test.ts`
  - 第三地图 identity/cache/menu-compatible normalization 和旧地图 golden。
- `tests/unit/minimap.test.ts`
  - 新地点 POI decal 映射。
- `tests/unit/islandScene.test.ts`
  - NullEngine 混合场景、质量隔离、资源数量和医院/POI 呈现。
- `tests/unit/aiLootReachability.test.ts`
  - 烬岚郡多 seed 物资可达、Bot 搜枪/完整对局和 operation count。
- Movement/Combat/GridNavigator 相关 unit 文件
  - 只新增混合地图真实障碍/坡道/森林回归，不复制实现。
- `tests/unit/multiplayerClient.test.ts`
  - 协议 7。
- `tests/worker/lobby.test.ts`
  - 三地图 quick-match 分池和 legacy fallback。
- `tests/standalone/standaloneServer.test.ts`
  - 真实 HTTP/WebSocket 私人烬岚郡房、双方 `mapId` 一致和重启恢复。
- `tests/standalone/localDurableObjectRuntime.test.ts`
  - checkpoint 6 兼容策略回归：v5 island/town 保留，v5 mixed 与 v4 及更旧状态删除。
- `README.md`
  - “双地图”更新为三地图并描述烬岚郡。
- `docs/architecture.md`
  - 六区域蓝图、权威几何、随机类型、唯一医院和协议 7。
- `docs/deployment.md`
  - 三地图验收和协议 7 维护发布说明。
- `AGENTS.md`
  - 仅当新增了长期地图架构约束时补充，禁止写一次性实现细节。
- 预算配置实际位置（由 `scripts/check-performance-budgets.mjs` 读取）
  - 只有真实产物/operation/resource 超限且经过明确架构审阅时才调整；不得预先放宽。
- `.agents/plans/2026-08-06-mixed-region-map.md`
  - 实现过程中按分钟持续追加 `## Build`，reviewer 增量追加 `## Review`；implementation commit 后停止修改。

#### Check

- `worker/LobbyDirectory.ts`、`worker/GameRoom.ts`、`worker/shared.ts`
  - 通常通过共享 `MapId`/`normalizeMapId` 自动获得第三图；逐处确认没有二值 map 假设。
- `standalone/`
  - 共享 Worker domain classes，不创建平台分叉。
- `src/game/systems/MovementSystem.ts`、`SimulationCombatWorld.ts`、`InventorySystem.ts`
  - 已按 `mapId + seed` 重建布局，重点验证而非无理由修改。
- `src/controllers/BotController.ts`
  - landing zone 数量和物资 zone 映射不能假设仅现有两图。
- `src/client/brandSigns.ts`
  - 固定索引 fallback 在六主 POI/内部 landing zones 下必须安全，不强制新增品牌牌。
- `scripts/check-performance-budgets.mjs`
  - 确认 raw artifact、scene resource 和 operation budget 的真实来源。

### 范围

#### 范围内

- 第三张可选、可单机、可联机、可持久化恢复的完整权威地图。
- 六区域确定性生成和全部区域的游戏规则/渲染/AI 支持。
- 新地图所需的协议版本、测试、文档、预算验证和浏览器验收。
- 分支、commit、push、PR、`@codex` 审查闭环。

#### 明确不做

- 不扩大地图尺寸。
- 不增加平原/纯草地类型。
- 不新增第二家医院。
- 不把六个区域做成六张独立地图或加载分区。
- 不新增外部模型、贴图、音频或第三方运行时依赖。
- 不为烬岚郡新增 skybridge；多层楼继续使用现有权威内部坡道。
- 不修改武器、伤害、缩圈、玩家数或物资 gameplay 数值。
- 不重构 Cloudflare/standalone 平台架构。
- 不合并 PR、不进行生产 Worker/Pages 发布，除非用户在 PR 审查通过后另行明确要求；协议 7 的生产维护 rollout 作为合并后的独立交付门禁保留。

### 关键假设或待确认项

- “三个固定、三个随机”解释为三种类型各有一个固定区域，另外三个区域独立随机类型；不是固定坐标永远不变。第一版保持六个宏观 slot 的几何位置稳定，名称/类型与局部内容由 seed 决定，降低跨区域重叠和测试复杂度。
- 六个“地点”指小地图显示的六个主 `mapPoints`。AI/物资可以有额外内部 `landingZones`，这些内部落点不在小地图重复显示，以维持 49 Bot 分散跳伞和 240 基础物资的合理分配。
- 默认保留 16 个 landing zones：六个主区域点加十个区域内部落点。现有 Bot 的 16 槽分配因此无需改变常量。
- 城区“参考灰炉城”指密度、街墙、多层权威结构和工业程序化风格，不复制灰炉城整图 448 栋或强制连廊。
- checkpoint 最终版本为 6；旧 v5 island/town/缺失 mapId 可恢复，v5 mixed 和 v4 及更旧状态拒绝。该策略同时保护旧房间和代码回滚安全。

### 推荐方案

#### 1. 独立六区域蓝图

在 `mixedMap.ts` 中建立六个互不重叠的宏观 slot。每个 slot 拥有稳定边界，生成器使用按职责拆分的 seed：

- 区域类型/名称流。
- 区域内建筑流。
- 道路流。
- 山丘流。
- 树木流。
- 岩石/草垛流。
- 物资流。

新增或调整一种内容不会打乱其他内容的随机序列。固定三类和随机三类均输出显式 `MixedRegionSpec`，测试不通过名称猜测类型。

#### 2. 连接骨架与局部道路

- 六个区域中心用确定性最小连接骨架形成全图连通道路。
- 城区在边界内生成紧凑本地支路和开发块；建筑必须避让统一 road shoulder。
- 农村使用少量道路/院落支路，房屋沿路分散。
- 森林仅保留通向区域落点的道路，不用规则城市网格切碎山坡。
- terrain、建筑、树、石、草垛、小地图和 visual details 消费同一 `roadSegments`。

#### 3. 权威建筑与医院

- 蓝图只输出 footprint、楼层、种类和颜色；`map.ts` 继续使用现有通用 helper 生成 `MapBuilding`、墙、门窗、楼板和坡道。
- 城区以 1–4 层紧凑楼群为主；农村主要 1 层、少量 2 层；森林最多少量林屋。
- 医院从 `赤钟城区` 内满足尺寸/楼层/入口条件的建筑中确定性选择，强制至少两层并使用 `HOSPITAL_WALL_COLOR`。
- `HospitalPoi.name` 统一为 `"医院"`，不再仿照当前 town 内部 `"灰炉医院"` 的不一致写法。

#### 4. 区域自然障碍

- 森林：每区使用多座高丘形成山坡，按区域边界和坡地采样高密权威树干与岩石。
- 农村：较少树、更多 hay cover、适量岩石；保持农舍入口和道路净空。
- 城区：少量街树/岩石，主要遮挡来自建筑；医院/公共点保留区保持清晰。
- 所有 placement 使用同一碰撞净空函数，并在达到目标数量失败时明确抛错，禁止静默降低密度。

#### 5. 物资与 AI

- 保持 16 landing zones 和 250 总物资，前 240 个按区域类型分配室内/室外点，最后 10 个继续是补充医疗物资，其中最后两个属于医院。
- 城区偏室内，农村兼有农舍/田边，森林偏道路/林间空地；所有点必须验证 support height、墙/坡道/障碍净空。
- Bot 使用现有 `layout.landingZones` 和 `lootZoneCounts`，重点通过多 seed 回归证明不是只在 seed 42 可用。

#### 6. 精确扩展 town 专用分支

不能把所有 `mapId !== "island"` 都默认视为纯灰炉城。逐项改造：

- GridNavigator：混合城区的多层 interior 使用 wall segment，外部高密导航可使用 building envelope；农村/森林仍按通用权威障碍工作。
- Scene：以是否存在 `townKind` 建筑/实际 urban 范围决定建筑细节；不让灰炉城 POI 铺装或全城工业装饰覆盖农村和森林。
- Natural detail：使用混合区域/道路/落点净空，不改变 island 视觉随机序列。

### 任务拆解

### Task 1: 测试先行锁定地图身份与六区域 contract

- 目标：先得到会失败的第三地图 identity、六区域、唯一医院和旧图 golden 测试。
- 仓库 / 文件：`tests/unit/mapSelection.test.ts`、新建 `tests/unit/mixedMapLayout.test.ts`、`tests/unit/minimap.test.ts`。
- 前置依赖：本 plan 完成。
- 关键改动点：写入 `mixed` display/normalize/cache、固定/随机区域、名称池、医院名称/区域、代表 seed 变化、旧图签名不变。
- 验证方式：运行新/受影响 unit 文件，确认新增断言在实现前按预期失败，记录失败原因到 `## Build`。
- 完成标志：失败明确指向缺少 `mixed` 和 mixed generator，不是测试环境错误。

- Step 1: 新增 map selection 和 POI 名称映射断言。
- Step 2: 新建 mixed blueprint/layout contract 测试。
- Step 3: 运行定向 Vitest并记录红灯证据。

### Task 2: 实现独立 mixed blueprint 与权威 MapLayout

- 目标：让任意 uint32 seed 确定性生成六区域完整权威地图。
- 仓库 / 文件：`src/config/mixedMap.ts`、`src/config/map.ts`，必要时最小修改 `src/config/townMap.ts`。
- 前置依赖：Task 1 红灯。
- 关键改动点：六区域、道路、建筑、地形、医院、墙/开口/楼板/坡道、树、岩石、草垛、物资和 cache 分派。
- 验证方式：定向 mixed layout、map selection、Movement、Combat/LOS、GridNavigator 测试；运行多 seed/分散 uint32 压力。
- 完成标志：目标数量稳定，所有几何在边界内且无非法重叠，医院/物资可达，旧图 hash 不变。

- Step 1: 定义 mixed contracts 和独立 seed streams。
- Step 2: 生成六个区域和连通道路。
- Step 3: 生成各类型建筑和固定城区医院候选。
- Step 4: 转换为通用权威墙/楼板/坡道。
- Step 5: 生成按区域密度区分的树/石/草垛。
- Step 6: 生成 16-zone / 250-point 物资布局。
- Step 7: 运行生成压力和定向规则测试。

### Task 3: 接通菜单、协议、Worker 和 standalone

- 目标：单人和两套联机平台都能选择、保存、匹配和恢复烬岚郡。
- 仓库 / 文件：`src/config/maps.ts`、`src/app/GameApp.ts`、`src/network/protocol.ts`、Worker/standalone 相关测试，必要时共享 domain 文件。
- 前置依赖：Task 2。
- 关键改动点：第三 option、normalize、协议 7、quick-match 三图分池、私人房、双方 state mapId、checkpoint 恢复。
- 验证方式：unit multiplayer client、Worker contract、standalone real HTTP/WebSocket/restart。
- 完成标志：三图不串房，旧缺失值回 island，mixed 两端一致，协议 mismatch 保持具体终态。

- Step 1: 扩展 MapId/display/normalization 和菜单。
- Step 2: 升级协议并更新协议断言。
- Step 3: 补 Worker 三图 matchmaking 合同。
- Step 4: 补 standalone mixed 私人房和重启恢复合同。
- Step 5: 核对 checkpoint 6 与 v5 分图兼容结论。

### Task 4: 接通导航、渲染、HUD 和质量隔离

- 目标：新图不仅数据正确，而且真实可玩、可辨识、三画质一致。
- 仓库 / 文件：`src/ai/navigation/GridNavigator.ts`、`src/client/poiVisuals.ts`、`src/client/render/scenes/IslandScene.ts`、`tests/unit/islandScene.test.ts` 及规则测试。
- 前置依赖：Task 2。
- 关键改动点：城区 interior/exterior 导航、六 POI decal、mixed terrain、城区 high details、森林 foliage、农村 hay、医院视觉和资源预算。
- 验证方式：NullEngine low/medium/high、真实路径、Movement/Combat obstruction、scene source/resource counts。
- 完成标志：权威障碍一致，画质不改变 layout，六区/医院可见，资源数量在预算内。

- Step 1: 修正 GridNavigator 二值 map 假设。
- Step 2: 增加 POI visual mapping。
- Step 3: 增加 mixed-specific scene branches。
- Step 4: 补 NullEngine 与规则系统回归。

### Task 5: AI、多 seed、覆盖率和完整本地门禁

- 目标：证明高密城、稀疏农村和密林在真实对局中均不会破坏 AI、性能或覆盖率。
- 仓库 / 文件：`tests/unit/aiLootReachability.test.ts`、coverage 配置只读核对、全仓库。
- 前置依赖：Task 2–4。
- 关键改动点：代表组合 seed、多 forest seed、多 town seed、49 Bot 武装/完整对局、operation count；不得降低旧图阈值。
- 验证方式：
  - `npm run typecheck`
  - `npm run test`
  - `npm run test:coverage`
  - `npm run build`
  - `npm run build:worker`
  - `npm run build:server`
  - `npm run build:standalone`
  - `npm run check:budgets`
  - `git diff --check`
- 完成标志：全部通过；任何环境限制有具体命令、错误和未验证风险，不能用局部测试冒充完整通过。

### Task 6: 文档和 writer 自验收记录

- 目标：让架构、玩法、部署和长期规则与实现一致。
- 仓库 / 文件：`README.md`、`docs/architecture.md`、`docs/deployment.md`、必要时 `AGENTS.md`、本 plan `## Build`。
- 前置依赖：实现 contract 稳定。
- 关键改动点：三地图、六区域、唯一医院、协议 7、checkpoint 结论、生产维护 rollout、验证命令。
- 验证方式：逐条对照用户验收清单、实际代码和测试；检查文档没有声明未实现的数量/能力。
- 完成标志：文档和 Build 记录可供 reviewer 独立复核。

### Task 7: Chrome DevTools MCP production 验收

- 目标：在本地 Chrome 中验证玩家真实看到和操作到的烬岚郡。
- 仓库 / 文件：production `dist/`，不新增浏览器测试代码。
- 前置依赖：Task 5 build 通过。
- 关键改动点：无代码默认改动；发现真实问题则回到对应 Task 修复并重新完整验证受影响项。
- 验证方式：
  - 启动 production preview，先把 localStorage volume 设为 `0`。
  - 桌面：选择烬岚郡、刷新确认持久化、启动单人、检查 HUD 名称、六 POI、医院、城区/农村/山林实景、console error/warn。
  - 通过固定测试 seed/debug 可控入口或开发者脚本定位三类区域；不得只看飞机阶段截图。
  - `844×390` mobile/coarse pointer：检查菜单第三 option、横屏 HUD、小地图和触控布局，不播放音频。
  - 如本地联机可用，创建 mixed 私人房，确认 lobby 名称和双方 mapId；真实联机语义主要由 Worker/standalone contract 覆盖。
  - 每轮结束立即关闭所有任务页面/context、停止 preview/server，并用 MCP 确认只剩 `about:blank`。
- 完成标志：浏览器表现与自动测试一致，console 无任务引入的 error，清理记录写入 Build。

### Task 8: 独立 reviewer 闭环

- 目标：在 commit/push 前完成独立静态审查。
- 仓库 / 文件：完整分支 diff、根 `AGENTS.md`、README、本 plan。
- 前置依赖：Task 1–7 完成且 Build 记录完整。
- 关键改动点：reviewer 不改业务代码，只把结果增量写入本 plan `## Review`。
- 验证方式：启动唯一允许的最终 `code-reviewer` subagent，明确要求不重复外层已经记录的完整 suites/browser，只做静态 diff/contract 审查和最小风险验证。
- 完成标志：所有 blocker/high/medium 已修复并复审为 0；每轮 finding disposition 已记录。

### Task 9: Commit、push、PR 和 Codex 审查

- 目标：把通过本地门禁和独立 reviewer 的实现提交到远端并完成 GitHub 自动审查闭环。
- 仓库 / 文件：当前分支和 GitHub PR。
- 前置依赖：Task 8 通过。
- 关键改动点：commit 前 finalize Build/Review；commit 后仓库对本任务只读；使用 `gh` 创建 PR 和评论。
- 验证方式：
  - commit 前 `git status --short`、`git diff --cached --name-only`，确认 staged set 包含非 plan 实现文件。
  - `git commit` 后 `git log -1 --oneline --decorate`。
  - `git push -u origin feat/hybrid-regions`。
  - `gh pr create`，base `main`，正文包含需求、实现、测试、浏览器、review 和协议发布注意事项。
  - `gh pr comment <number> --body '@codex 请审查这次新增烬岚郡混合地图的完整实现。'`
  - 用 `gh pr checks`、`gh pr view --comments` 和 GitHub review API/`gh api` 轮询 Codex 结果。
- 完成标志：CI 通过，Codex 明确无问题；若有问题，只在用户新的明确请求或当前未 commit 的阶段修改。由于仓库规则规定 implementation commit 后本任务仓库只读，PR 后 Codex 若提出真实代码问题将构成交付阻塞，必须先向用户说明该规则冲突并请求把修复作为新的用户变更，禁止擅自 follow-up commit/amend/force-push。

### 风险与验证

- **密林阻塞风险：** 高密树木可能形成不可穿越区域。用最小树间距、道路/landing clear corridor 和多 seed GridNavigator 连通性测试控制。
- **城区生成失败：** 小区域高密建筑可能无法避开道路/POI。生成器使用 bounded retry + 明确失败，连续 seed 和分散 uint32 压力必须无失败。
- **地形穿楼风险：** 森林山丘不能侵入相邻城区建筑。山丘限制在 forest inset，建筑 footprint 对多点 terrain/roof clearance 采样。
- **物资不可达：** 不能仅断言点不在墙内；必须从真实入口/道路用 GridNavigator 到达并由 AI 拾取。
- **二值 map 分支风险：** 全仓库搜索 `mapId === "town"` / `!== "town"`，逐个决定 `mixed` 是复用、保持独立还是改为 capability 判断。
- **旧图随机漂移：** mixed code 不插入 island/town RNG；保持 island golden 和新增 town signature。
- **性能风险：** 最坏四个 forest 或四个 town 的 seed 都要测 scene resource、AI operations 和 raw artifact；不使用 FPS/墙钟/heap 作为硬门禁。
- **协议发布风险：** PR 不直接发布。协议 7 合并后必须按维护流程协调 Worker 和 Pages，不能先单独部署严格版本造成不兼容窗口。
- **PR 后修复规则冲突：** 根规则禁止 implementation commit 后为同一任务修改仓库，而用户要求跟进 Codex finding。为最大化一次通过，commit 前完成严格 reviewer；若 Codex 仍发现真实问题，必须暂停并让用户明确提出新的修复任务，不能偷偷追加提交。

### MVP / 下一步

1. 先运行新增 identity/blueprint 测试得到红灯。
2. 实现 `mixedMap.ts` 和 `createMapLayout("mixed", seed)`，先让六区域、医院和权威几何测试通过。
3. 再接入联机、渲染、AI、完整门禁、Chrome MCP 和 reviewer。

规划完成后立即由当前主 agent 按 Task 1 开始，不再启动 planner/writer subagent。

## Build

### 更新日志

- 2026-08-06 16:57：完成第一批测试先行红灯。新增 `tests/unit/mixedMapLayout.test.ts`，并扩展 map selection/minimap 测试，锁定第三地图身份、显示名“烬岚郡”、同 seed 三图 cache 隔离、六个确定性具名区域、固定三类、随机三类、唯一“医院”和 12 个候选区域名的稳定 POI decal。定向 Vitest 结果为 3 files 中 3 个预期失败、14 个既有测试通过；失败分别来自缺少 `src/config/mixedMap.ts`、第三地图尚未被 normalize/display factory 接受和新 POI 映射缺失，没有测试环境或既有功能异常。
- 2026-08-06 17:12：完成第一版烬岚郡权威生成与联机/场景接线。新增独立 `src/config/mixedMap.ts`，使用 3×2 六个互斥宏观区域，固定 `赤钟城区/风穗乡/沉杉岭` 三类并按 seed 为另外三格选择 town/rural/forest 和对应不重复名称；每个城区 36 栋、农村 9 栋、森林 2 栋，森林每区 150 棵权威树和 24 块岩石，农村每区 36 棵树、10 块岩石和 30 个草垛，城区每区 12 棵树、4 块岩石和 12 个 cover。连续 seeds 0–99 均成功生成，六区数量稳定，单次脚本总计约 16 秒。
- 2026-08-06 17:12：第三地图 `MapLayout` 已输出完整墙体、门窗、楼板、内部坡道、连通道路、唯一白色医院、16 个 landing zones、240 个区域物资和 10 个补充医疗点，总计 250；医院内部名称统一为“医院”，最后两个医疗点属于医院。最初定向测试暴露随机城区偶尔只能生成 35/36 栋，以及森林多个 landing zone 复用同一室内坐标；已通过同边界确定性补位候选和按建筑使用次数选择不同室内位置修复，没有降低目标数量。
- 2026-08-06 17:12：三套 TypeScript typecheck 通过；identity/mixed/minimap 20 tests、协议/地图 17 tests、现有地图/NullEngine/GridNavigator/minimap 42 tests、standalone 真实服务器 10 tests 全部通过。standalone 用例已改为烬岚郡私人房，验证两客户端 `match.full.mapId === "mixed"`、SQLite checkpoint、进程重启和 reconnect，证明 `MATCH_CHECKPOINT_VERSION = 5` 可保持兼容。Worker lobby 三地图分池用例已补，但本机 Debian glibc 2.28 无法启动当前 `workerd`（缺 GLIBC_2.29/2.30/2.32/2.33/2.34/2.35），本轮无 Worker case 实际执行；类型检查已通过，完整 CI/更高 glibc 环境仍为必要门禁。
- 2026-08-06 17:12：协议已从 6 升到 7，菜单新增“烬岚郡”；GridNavigator 通过 capability helper 让 town/mixed 均使用高密建筑 envelope 与门洞路径。高质量程序化工业表现改为按实际 `townKind` 建筑和邻近道路启用，农村/森林不会整图套用灰炉城效果；mixed terrain 使用 5m 路面和 8m shoulder，自然 visual detail 同源避让 mixed 道路及 18m landing 保留区。新增烬岚郡 low/high NullEngine 测试通过，验证六 POI、唯一医院、全部权威树实例、农村 hay batch、低画质无工业批次、高画质只覆盖城区和自然 detail 净空。
- 2026-08-06 18:13：完成 mixed 生成器结构收敛与更强压力检查。城区改为消费真实本地道路分出的 4×4 开发单元，连续 seeds 0–99 始终保持每区 36 栋且建筑 footprint 覆盖率为 38.78%–39.86%；农村/森林数量保持。室内物资改为在本区建筑和四个安全角中选择满足全局 12m 间距的候选，连续 100 seed 均为 250 点且医院药品对以外最小间距 12.004m。补充医疗改为 landing-zone 邻近分布，三 seed×250 个点均由 GridNavigator 可达并可由真实 InventorySystem 拾取。
- 2026-08-06 18:13：500-seed 建筑 footprint 5×5 地形采样最初发现 seed 491 的森林小屋角落地形高于屋顶 1.22m；生成期现使用同一 hill 公式拒绝 footprint 起伏超过 0.8m 的候选，修复后 0–499 最坏屋顶仍高于最高 footprint 地形 3.482m。森林每区 150 棵树和 24 块岩石另强制位于实际 terrain height ≥3m 的坡地，连续 100 seed 通过。Combat/LOS 与 GridNavigator 回归确认 mixed 树、岩石和草垛消费同一权威障碍；49 Bot 武装、三地图完整对局和原 Greyfurnace operation 上限全部通过，未放宽 AI 门槛。
- 2026-08-06 18:13：用户要求代码和分支不使用中文拼音。稳定地图 ID 最终为 `mixed`，实体 ID 使用 `mixed-*`，分支为 `feat/hybrid-regions`，plan 为本文件；全仓库（排除依赖和构建产物）不区分大小写的旧拼音标识扫描为零命中。显示名“烬岚郡”和中文地点名不变。
- 2026-08-06 18:13：完整 `npm run typecheck` 三段通过。第一次 `npm run test` 在机器上同时存在大量外部象棋 self-play 进程持续占满 CPU 时，427 个 unit 中 424 通过，3 项只因默认 wall-clock timeout 失败且无断言错误；隔离复跑 matchRuntime 为 2.26s、两项旧 island 测试合计 27.49s 并全部通过。仅为对应功能测试设置 30s/60s 显式超时，没有修改断言、业务算法、operation/AI 阈值或性能预算。相同外部高负载下第二次完整 `npm run test` 返回 0：unit 44 files / 427 tests、Worker 4 files / 32 tests、standalone 3 files / 21 tests 全部通过。
- 2026-08-06 18:13：宿主 Debian glibc 2.28 不能直接启动当前 workerd，Docker 也不可用；为避免跳过 Worker 验证，从 Debian Bookworm 官方包提取一次性 `/tmp/last-line-workerd-runtime` 用户态 glibc，并通过 Miniflare 官方 `MINIFLARE_WORKERD_PATH` 指向 wrapper。`workerd 2026-07-14`、完整 Worker tests 和后续完整 `npm run test` 均真实执行成功；未修改系统库、仓库文件或依赖。
- 2026-08-06 20:04：完整覆盖率门禁最终通过。unit V8 在机器同时运行 68 个外部 self-play 满 CPU 任务时，初始并行/单 worker 轮次仅出现 wall-clock timeout，无任何断言或覆盖率阈值失败；按仓库禁止 wall-clock 性能门禁的规则，仅移除三条完整对局/100-seed/401-seed 测试的显式时间上限，保留全部 deterministic operation、结果、几何和 seed 断言，并以 8 个 `nice -20` worker 完整执行 44 files / 427 tests。Application coverage 为 statements 77.43%、branches 71.52%、functions 80.32%、lines 79.48%；新 `mixedMap.ts` 为 97.79% / 93.2% / 100% / 99.36%。Worker Istanbul 4 files / 32 tests 为 77.44% / 70% / 92.73% / 83.14%；standalone V8 3 files / 21 tests 为 77.13% / 62.25% / 86.3% / 80.43%；加权总值为 77.42% / 70.96% / 82.45% / 80.03%。
- 2026-08-06 20:04：完成四套 production build：browser、Worker dry-run、server bundle、same-origin standalone 全部成功。对 `main@7a453f5` 创建只读临时 worktree 做资源审阅：基线 browser/Worker/server 原始字节分别为 1,074,967 / 455,919 / 475,228，原预算仅剩 33B / 4,081B / 4,772B；第三地图完整共享权威算法带来 12,732B / 32,038B / 30,235B，esbuild metafile 显示 `mixedMap.ts` 在 server bundle 中约 14.3KB，其余来自 map factory/转换，没有平台复制或可删除的无关依赖。经显式架构资源审阅，仅把受影响的原始字节上限调整为 browser 1,090,000、Worker 490,000、standalone 510,000，其他 largest chunk、all JS、chunk count、CSS、dist 预算均不变。最终同源 standalone 产物：browser entry 1,087,680 / 1,090,000、Worker 487,957 / 490,000、server 505,463 / 510,000，所有预算 PASS。
- 2026-08-06 20:04：mixed 随机三格在 seeds 0–99,999 内覆盖全部 27 种 town/rural/forest 有序组合；极端 all-rural seed 11、all-town seed 16、all-forest seed 38 已加入 mixed layout 回归，6 项定向测试通过。临时 main baseline worktree 和 size-review 文件已删除，仓库只保留当前功能分支。
- 2026-08-06 20:21：完成两轮 production Chrome DevTools MCP 验收并逐轮清理。桌面高质量轮固定 all-town seed 16，reload 后地图选择持久为“烬岚郡”、音量为 0/静音；真实对局 HUD 显示烬岚郡与 50 人，小地图文本精确为 `赤钟城区/风穗乡/沉杉岭/白塔旧城/铜灯街区/断桥坊/医院`，医院仅一处，资源请求均为 200/304。`/tmp/last-line-mixed-all-town-desktop.webp` 已保存；console 无页面 error 或业务 warning，仅有 headless SwiftShader/ReadPixels 环境告警。该轮随即关闭页面、停止 8798 preview，确认端口关闭且只剩 `about:blank`。
- 2026-08-06 20:21：mobile 轮固定 all-forest seed 38。首次发现 emulation 在新 isolated context 前设置未继承，实际 viewport 为 1905×2053/coarse=false，因此未误记为手机通过；在当前页面重新应用 `844×390×2 mobile touch landscape` 并 reload 后重新验收。真实 viewport 844×390、DPR 2、coarse=true、touchPoints=1；小地图精确显示 `赤钟城区/风穗乡/沉杉岭/乌松岭/雾鹿峰/暮鸦山/医院`。移动摇杆、左右双开火、右侧拖动瞄准、ADS、跳跃、拾取、换弹、切枪、绷带、急救、暂停、背包共 12 个触控区域均可见且完整位于 viewport 内。`/tmp/last-line-mixed-all-forest-mobile-844x390.webp` 已保存；console 仅 SwiftShader 环境告警。验收后关闭页面、停止 preview、关闭端口、重置 emulation，并确认只剩 `about:blank`。
- 2026-08-06 20:21：最终静态自审发现 checkpoint 回滚风险：若 mixed 继续写 v5，旧代码回滚后会把未知 mixed 归一化为 island 并用 mixed 坐标恢复。已将 `MATCH_CHECKPOINT_VERSION` 升为 6，并实现分图兼容读取：v6 接受当前三图，v5 仅接受 island/town/缺失 mapId 的旧岛屿状态，v5 mixed 与 v4 及更旧状态拒绝。Worker 完整 4 files / 32 tests、standalone 完整 3 files / 22 tests、受影响 unit 3 files / 22 tests 和完整 typecheck 均通过；Worker 真实 DO 验证 v5 island checkpoint 恢复与 v4 删除，standalone 真实 SQLite 重启验证 v5 town 保留与 v5 mixed 删除。修复后 Worker/standalone 产物仅各增 146B，最终 488,103 / 490,000 与 505,609 / 510,000，预算仍 PASS；browser 产物与已验收 presentation 未变。
- 2026-08-06 21:13：进一步收紧 v5 checkpoint 兼容判断为原始 `mapId` 只能是 `undefined | "island" | "town"`，未知字符串与 mixed 一样拒绝；unit 加入 invalid-map 回归。最终 shared server 门禁再次通过：完整 typecheck、Worker 4 files / 32 tests、standalone 3 files / 22 tests；最终 Worker/server 原始字节 488,151 / 490,000 与 505,657 / 510,000，预算 PASS。
- 2026-08-06 21:13：最终 presentation 静态自审发现 mixed 的工业道路筛选若只看 segment 中点，可能把连接城区与农村/森林的整条干道工业化。生产 helper 现要求 mixed road segment 的起点和终点都位于 `townKind` 建筑 180m 范围内；Greyfurnace 仍消费全部道路。新增纯函数回归证明 all-forest seed 38 仅固定城区 4 条局部道路、all-town seed 16 共 19 条城区局部道路获得工业表现，跨区 connector 被排除；focused NullEngine 2 tests 通过。
- 2026-08-06 21:13：当前最终 diff 的完整 `npm run test` 返回 0：unit 44 files / 428 tests、Worker 4 files / 32 tests、standalone 3 files / 22 tests。最终 unit coverage 对 checkpoint 6 源码为 statements 77.44%、branches 71.53%、functions 80.32%、lines 79.49%；Worker 为 77.56% / 70% / 92.73% / 83.35%；standalone 为 77.13% / 62.25% / 86.3% / 80.43%；加权总值为 77.45% / 70.97% / 82.45% / 80.06%。最终 browser/Worker/standalone build 与预算再次通过：browser 1,087,692 / 1,090,000，Worker 488,151 / 490,000，server 505,657 / 510,000；其他 budgets 不变且 PASS。`git diff --check` 与全仓库拼音标识扫描通过。实现至此冻结，进入独立 reviewer。
- 2026-08-06 22:15：已重新完整阅读 plan 并逐条评估 Reviewer Round 1，5 medium 与 1 low 均确认成立并全部采纳。坡面 finding：mixed tree/rock 现对完整 5×5 footprint 采样，最大地形差限制为 0.8m，底面取 footprint 最低/最高地形中点，使任一侧最大埋入/离地约 0.4m；forest rock footprint 收敛为 3.8–6m 并把候选上限提高到 60,000，保持每森林 150 棵树/24 岩石。100 连续 seed 全通过，实测最大坡差 0.79999m、最大埋入 0.40047m、最大离地 0.40033m；测试同时验证 bottom placement、rock 顶面 support 和 tree 不提供 support。
- 2026-08-06 22:15：工业道路 finding：`MixedMapBlueprint` 与 `MapLayout` 新增显式 `urbanRoadSegments`，mixed 生成器只把每个 town 区域的 4 条局部道路写入该集合；全图前 7 条 macro connectors 和 rural 支路只留在完整 `roadSegments`。scene 直接消费该字段，不再以距离猜测道路归属；测试逐条深比较 production scene selector、blueprint 与 layout，同步断言 7 条 macro connector 均未进入 subset。all-forest seed 38 为 4 条，all-town seed 16 为 16 条。
- 2026-08-06 22:15：checkpoint finding：当前 v6 现只接受 raw `"island" | "town" | "mixed"`，v6 invalid 明确拒绝；v5 仍只接受 `undefined | island | town`，v5 mixed/invalid 与 v4- 拒绝。27 组合 finding：导出只生成 region specs 的轻量 helper，测试在最多 100,000 seed 内显式比较全部 27 个有序 kind signature，并直接锁定 all-rural 11、all-town 16、all-forest 38。operation low finding：完整对局门禁改成显式 `Record<MapId, budget>`，三图各自列出 findPath/LOS/shot 上限，未来新 MapId 会触发编译缺项。
- 2026-08-06 22:15：timeout finding：三条长时测试恢复有限保护上限，不再使用 0；100-seed ramp 为 900s，401-seed terrain 为 2400s，三地图完整对局为 600s。阈值依据本机 V8 coverage + 68 个外部满核 self-play 的实测最坏 359s / 1227s / 182s，留约 2–3 倍异常保护余量，同时保留全部 deterministic operation/result/geometry/seed 断言，未把 wall-clock 作为通过标准。
- 2026-08-06 22:15：Reviewer 修复后验证完成：完整 typecheck；100-seed footprint 压力；完整 `npm run test` unit 44 files / 428 tests、Worker 4 / 32、standalone 3 / 22；unit/Worker/standalone coverage 全部通过，加权 statements 77.46%、branches 71.03%、functions 82.43%、lines 80.08%；四套 build 与预算 PASS，最终 browser 1,088,048 / 1,090,000、Worker 489,703 / 490,000、server 507,135 / 510,000。production Chrome all-town seed 16 修复后复验实际进入烬岚郡航线阶段，资源全部 200/304、console 仅 SwiftShader warning；`wait_for` 在满核/1 FPS 环境晚于 120s 返回，但随后 snapshot 已证实 HUD/小地图/航线运行。该轮页面、preview、8798 端口均已关闭，只剩 `about:blank`。长期 AGENTS/architecture 已同步 urban road subset 与 footprint 坡面约束。
- 2026-08-06 22:37：Reviewer Round 2 剩余 medium 已严格收口。为抵消 1mm 坐标取整误差，生产 `MIXED_NATURAL_OBSTACLE_MAX_TERRAIN_DELTA` 从 0.8m 收紧到 0.798m；底面仍取 footprint 最低/最高地形中点。连续 100 seed 保持每森林 150 树/24 岩石，实测最大坡差 0.7979907m、最大埋入 0.3994575m、最大离地 0.3994398m，均严格 `<0.4m`；测试阈值收紧为 `<=0.400001m` 仅保留浮点 epsilon。Round 2 low 已同步 plan 数据结构定稿，`MixedMapBlueprint` 代码块现含 `urbanRoadSegments`；architecture 数字同步为 0.798m/<0.4m。
- 2026-08-06 22:37：严格坡面修复后完整 `npm run test` 再次返回 0：unit 44 files / 428 tests、Worker 4 / 32、standalone 3 / 22。完整 typecheck 与 mixed footprint 定向测试通过；browser/Worker/standalone 构建和预算再次 PASS，最终 browser 1,088,052 / 1,090,000、Worker 489,705 / 490,000、server 507,137 / 510,000。该修复只收紧已覆盖常量和断言，Round 1 修复后的最终 coverage 仍对应同一代码分支结构：加权 77.46% / 71.03% / 82.43% / 80.08%。`git diff --check` 通过。

## Review

### 更新日志

- 2026-08-06 21:23：独立 `code-reviewer` 第一轮完成。审查基线为 `main@7a453f5`，范围为 `git diff main` 的 24 个 tracked 变更文件及 3 个 untracked 任务文件，对照本 plan“用户验收口径 / Reviewer 对照清单”、根 `AGENTS.md`、`README.md` 和 `/home/lingchen.judy/ai-workspace/subagents/code-reviewer.md`；结论为 **不通过，需 builder 修复后复审**。本轮未重复外层已记录的 typecheck、完整 Vitest、coverage、build、budget 或 Chrome MCP，只为两个具体未覆盖风险运行了最小只读 `tsx` 采样。Findings / disposition：
  - **Medium — `src/config/map.ts:668` / `src/config/map.ts:744` / `tests/unit/mixedMapLayout.test.ts:118`：森林权威岩石和树干仅按中心点地形高度放置，没有约束完整 footprint 的地形高差。** 岩石/树以水平 AABB 参与 Movement、Combat/LOS、GridNavigator 和渲染；在真实山坡上只用中心点贴地会让一侧悬空、另一侧埋入，且岩石顶面仍被 Movement 当作整块水平可站立支撑。最小只读 9 点 footprint 采样在代表 seeds `0/1/11/16/38/42/2026/0xffffffff` 均发现岩石地形高差约 `2.30m–2.98m`（例如 seed 38 的 `mixed-rock-54` 为 `2.977m`）。现有测试只断言中心高度 `>= 3m`，未覆盖完整 footprint。Builder 应在生成期限制/适配 footprint 坡差，并增加覆盖边角地形与底面/支撑语义的断言。
  - **Medium — `src/client/render/scenes/IslandScene.ts:1149` / `tests/unit/islandScene.test.ts:1191`：工业道路筛选仍会选中跨区域宏观 connector。** 当前规则只要求 segment 两端各在任意 `townKind` 建筑 180m 内；当 connector 连接两个城区时自然成立，与 plan/AGENTS 要求“局部 town roads、农村/森林不误套”不等价。最小只读打印 seed 16 的 19 条 selected roads，确认前 3 条是 `[-760,560→0,560]`、`[0,560→760,560]` 和 `[-760,-560→-760,560]`，长度 `760/760/1120m`，均来自蓝图前 7 条宏观 connector；因此 Build 中“19 条城区局部道路、跨区 connector 被排除”的记录不准确。Builder 应使用蓝图显式道路归属/局部道路标记，或至少严格排除 connector，并把测试从仅断言数量改为逐条断言选中道路属于城区局部道路。
  - **Medium — `src/server/MatchRuntime.ts:350`：checkpoint v6 只校验版本，不校验当前 mapId。** 任意 `version: 6` 且 `state.mapId` 为未知字符串的 checkpoint 会通过兼容判断，随后 `normalizeMatchState` 把未知值归一化为 island；如果状态坐标来自 mixed/future/corrupt geometry，就会重现本次升 checkpoint 版本本来要避免的权威几何错配。当前测试只覆盖 v5 invalid，未覆盖 v6 invalid。Builder 应让 v6 仅接受 `"island" | "town" | "mixed"`，保留 v5 的 `undefined | island | town` 特例，并补 Worker/standalone 共用 guard 回归。
  - **Medium — `tests/unit/mapLayout.test.ts:441` / `tests/unit/mapLayout.test.ts:459` / `tests/unit/aiLootReachability.test.ts:269`：三个长时回归测试把显式超时改为 `0`，会永久等待挂死。** 仓库禁止把 wall-clock 当性能门禁，并不等于可以移除测试运行的安全上限；这些测试仍靠 operation/result/geometry 断言判定性能，但异常死循环、生成停滞或进程资源问题会让 `npm run test` 与未设置更短 job timeout 的 `.github/workflows/ci.yml` 长期占用 runner，直到平台作业上限。该改动还触碰了两个与 mixed 实现无关的旧 island multi-seed 测试。Builder 应恢复合理且宽松的有限 timeout（必要时依据正常高负载数据上调），不要用 `0` 消除失败。
  - **Medium — `tests/unit/mixedMapLayout.test.ts:37`：测试没有锁定 plan/Build 声称的全部 27 个随机区域有序组合。** 当前只扫描 64 seeds，断言 `signatures.size > 3` 且每种 kind 至少出现一次；随机流若退化为少数组合仍会通过，与 Reviewer 清单要求的三个独立 seeded random slot 和 Build 记录“覆盖全部 27 种组合”不匹配。Builder 应用便宜的 blueprint-only 循环显式断言 27 个有序 kind signature，并断言 all-rural/all-town/all-forest 代表 seed 的随机三格确实是对应类型，而不只间接检查总结构数量。
  - **Low — `tests/unit/aiLootReachability.test.ts:351`：新增 mixed 参数化时把 operation 阈值写成 island/非-island 二元分支。** 基线 town 上限数值未被改变，但当前表达让 mixed 直接复用 town 阈值，并使未来第四张地图自动继承该上限，扩展时可能绕过显式资源审阅。建议按 `MapId` 显式列出每图阈值或配置表，并为 mixed 留下独立测得的预算依据。
- 已参考验证：plan `## Build` 记录的最终 typecheck、unit `44/428`、Worker `4/32`、standalone `3/22`、三套 coverage、browser/Worker/server/standalone builds、budgets、极端 seed 压力和两轮 Chrome MCP/清理；本轮仅额外运行两次最小只读 `npx tsx -e`，分别列出 seed 16 的 town presentation roads、采样代表 seed 岩石/树 footprint 地形高差。
- 已确认通过的静态契约：`MapId="mixed"`、显示名“烬岚郡”、代码/分支无拼音标识、`mapId + seed` cache、legacy unknown/default island；六个区域及固定三类、唯一“医院”在固定城区；250 loot/16 landing zones；协议 7、checkpoint 6 与 v5 island/town/undefined 兼容及 v5 mixed/invalid、v4- 拒绝；Worker/standalone 共用语义；旧 island golden 未变；预算调整有基线产物与模块归因记录。
- 残余风险：未重新执行外层完整验证；修复上述权威坡面放置、道路归属、checkpoint 当前版本校验和测试门禁后，应运行最小受影响测试，再由外层按 plan 判断是否需要重跑完整门禁与 Chrome 验收。未解决计数：`blocker=0`、`high=0`、`medium=5`、`low=1`。
- 2026-08-06 22:22：独立 `code-reviewer` Round 2 完成。开始前已重新完整读取 `/home/lingchen.judy/ai-workspace/subagents/code-reviewer.md`、根 `AGENTS.md`、`README.md` 和本 plan 全部 519 行（重点复核 Build 22:15 与 Review Round 1）；审查基线仍为 `main@7a453f5`，范围为当前完整 `git diff main` 的 24 个 tracked 变更文件及 3 个 untracked 任务文件。结论为 **不通过，仍有 1 个 medium 需 builder 收口后复审**。本轮信任 Build 22:15 记录的完整 typecheck、unit `44/428`、Worker `4/32`、standalone `3/22`、三套 coverage、四套 build、budgets 和 Chrome 清理，未重复这些命令；只读取当前产物尺寸并做了常数取整上界核验。
  - **Round 1 Medium 1（坡面 footprint）— 部分关闭，仍保留 Medium。** `src/config/map.ts:673-710` 与 `src/config/map.ts:752-795` 已对 rock/tree 使用 5×5 `terrainFootprintRange`，生成前限制坡差 `<= 0.8m`，底面取 sampled min/max 中点；forest rock 收敛为 `3.8–6m` 且目标数量失败会显式抛错。`tests/unit/mixedMapLayout.test.ts:95-157` 已覆盖分区数量、坡差、底面中点、rock 顶面 support 和 tree 非 support，Build 记录的 100-seed 压力也支持数量稳定。**但用户本轮明确要求单侧 float/embed `<= 0.4m`，当前实现把未取整 `baseY + height/2` 统一 round 到 1mm，理论单侧上界是 `0.4005m`；Build 也实测最大埋入 `0.40047m`、离地 `0.40033m`，而测试允许 `0.401m`（`MAX_DELTA/2 + 0.001`）。因此严格验收线尚未满足。** Builder 应让接受的 footprint 给取整误差留余量（例如把生成坡差上限收紧到 `< 0.799m`），或保存/计算能保证底面严格落在 `min+0.4` 与 `max-0.4` 区间内的值，并将测试阈值改为严格 `<= 0.4m`（仅保留浮点计算级 epsilon，而不是额外 1mm 业务容差）。
  - **Round 1 Medium 2（urban roads）— 已关闭。** `MixedMapBlueprint`/`MapLayout` 显式包含 `urbanRoadSegments`；`src/config/mixedMap.ts:211-258` 只把每个 town 的 4 条局部道路加入 subset，前 7 条 macro connector 与 rural 支路只进入完整 `roadSegments`；`src/client/render/scenes/IslandScene.ts:1149-1153` 直接消费该字段。`tests/unit/islandScene.test.ts:1192-1204` 深比较 blueprint/layout/selector，并验证 macro connector 不在 subset，seed 38/16 分别为 4/16 条。
  - **Round 1 Medium 3（checkpoint current version）— 已关闭。** `src/server/MatchRuntime.ts:350-357` 对 v6 仅接受 raw `island | town | mixed`，对 v5 仅接受 `undefined | island | town`，其余版本拒绝；`tests/unit/matchRuntime.test.ts:95-136` 覆盖 v6 invalid、v5 mixed/invalid 和 v4-，Worker/standalone 继续消费同一 guard 与删除路径。
  - **Round 1 Medium 4（finite timeout）— 已关闭。** 三条测试已恢复有限超时：`tests/unit/mapLayout.test.ts:457` 为 `900_000`、`:502` 为 `2_400_000`、`tests/unit/aiLootReachability.test.ts:366` 为 `600_000`；断言仍以 deterministic geometry/result/operation 为通过标准。
  - **Round 1 Medium 5（27 ordered signatures）— 已关闭。** `createMixedRegionSpecs` 是不生成完整地图的轻量 helper；`tests/unit/mixedMapLayout.test.ts:39-61` 在最多 100,000 seeds 内将结果与显式 27 个有序 signature 集合做精确相等比较，并直接锁定 seeds `11/16/38` 的 all-rural/all-town/all-forest。
  - **Round 1 Low 1（operation budget）— 已关闭。** `tests/unit/aiLootReachability.test.ts:351-362` 使用完整 `Record<MapId, budget>`，island/town/mixed 均显式列出三项 operation 上限；新增 MapId 会触发类型缺项。
  - **Low — plan 数据结构片段未同步新增字段。** 本 plan `MixedMapBlueprint` 的定稿代码块（约 `:163-172`）仍遗漏已进入生产 contract 的 `urbanRoadSegments`，而 Build 22:15、AGENTS 和 architecture 已声明该字段。该项不阻塞代码正确性，但 builder 在最终 commit 前应只更新既有 Plan contract 文本以与实现一致。
- 完整 diff 新风险复查：未发现新的 blocker/high；MapId/display/normalize/cache、六区域/唯一医院、250 loot/16 landing zones、Movement/Combat/GridNavigator 同源、协议 7、checkpoint 删除路径、Worker/standalone 三图分池、scene capability、旧 island golden 和无拼音标识均保持一致。当前产物与 Build 22:15 数字一致：browser `1,088,048 / 1,090,000`（余 `1,952B`）、Worker `489,703 / 490,000`（余 `297B`）、server `507,135 / 510,000`（余 `2,865B`）；预算变更有基线模块归因且未扩大其他门槛，但 Worker 余量极窄，后续任何代码变化都必须重跑 budget。
- 残余风险：本轮未执行完整测试/构建/Chrome；坡面严格 `<=0.4m` 收口后至少需要运行 mixed footprint 定向测试与 100-seed 压力，并因 server/shared source 和产物仅余 297B，重新执行 typecheck、Worker/standalone contract/build/budget；若生产/渲染代码仅改变障碍 Y 坐标生成，则外层按 plan 判断是否需要再次 Chrome。未解决计数：`blocker=0`、`high=0`、`medium=1`、`low=1`。
- 2026-08-06 22:40：独立 `code-reviewer` Round 3 最终复审完成。开始前已重新完整读取 `/home/lingchen.judy/ai-workspace/subagents/code-reviewer.md`、根 `AGENTS.md`、`README.md` 和本 plan 全部 532 行（重点核对 Build 22:37、Review Round 1/2）；基线为 `main@7a453f5`，范围为当前完整 `git diff main` 的 24 个 tracked 变更文件及 3 个 untracked 任务文件。结论为 **通过，本次审查未发现明确问题**。
  - **Round 2 Medium（严格坡面偏移）— 已关闭。** 生产常量 `MIXED_NATURAL_OBSTACLE_MAX_TERRAIN_DELTA = 0.798`，rock/tree 均对 5×5 footprint 取 min/max 并以中点作为底面；在最终 1mm center-Y round 下，最坏单侧理论上界为 `0.798 / 2 + 0.001 / 2 = 0.3995m < 0.4m`。`tests/unit/mixedMapLayout.test.ts:136-148` 将单侧 float/embed 收紧到 `<=0.400001m`，Build 22:37 的 100-seed 实测最大埋入 `0.3994575m`、最大离地 `0.3994398m`，并保持每森林 150 树/24 岩石。
  - **Round 2 Low（plan contract）— 已关闭。** 本 plan `MixedMapBlueprint` 定稿代码块与 `src/config/mixedMap.ts` 当前 interface 均包含 `urbanRoadSegments`。
  - **Round 1 其余 findings — 持续关闭。** mixed scene 直接消费显式 urban-road subset，macro connectors/rural roads 不进入；v6 仅接受 island/town/mixed，v5 仅接受 undefined/island/town；长时测试使用 `900s/2400s/600s` 有限 timeout；轻量 region-spec 测试精确覆盖全部 27 个有序 signature 和 seeds 11/16/38；完整对局使用显式 `Record<MapId, operation budget>`。
- 完整 diff 终审：MapId/display/normalize、`mapId + seed` cache、六区域/固定三类/随机三类、唯一“医院”、城区/农村/山林权威几何、250 loot/16 landing zones、Movement/Combat/LOS/GridNavigator/AI 同源、scene capability、协议 7、checkpoint 6 与 Worker/standalone 删除/恢复路径、旧 island golden、文档、无拼音标识、`src/game/` 导入边界和 unrelated-change 范围均未发现新的 blocker/high/medium。
- 已参考验证：信任 Build 22:37 记录的完整 typecheck、unit `44/428`、Worker `4/32`、standalone `3/22`、coverage、browser/Worker/standalone builds、budgets、100-seed footprint 压力和既有 Chrome 验收/清理；本轮未重复完整命令，只只读核验当前产物与常数。产物与 Build 一致：browser `1,088,052 / 1,090,000`、Worker `489,705 / 490,000`、server `507,137 / 510,000`。
- 残余风险：Worker 原始字节预算仅余 `295B`，implementation commit 前不要再引入无关代码；若 staged implementation 与本次审查 diff 不同，必须重新验证受影响门禁。协议 7 合并后的生产 Worker/Pages 维护 rollout 与 production smoke 仍是合并后独立交付门禁，不属于本次 PR 前静态审查。未解决计数：`blocker=0`、`high=0`、`medium=0`。

## 后续阶段统一记录

本节合并原 `.agents/plans/2026-08-07-compact-mixed-regions.md`、`.agents/plans/2026-08-07-codex-p2-followup.md` 和 `.agents/plans/2026-08-07-checkpoint-roster-followup.md`。从 2026-08-07 起，本文件是烬岚郡地图、联机自动进入和关联 Codex 修复的唯一 plan；后续 Build/Review 只追加到本文件，不再新建同任务 plan。

后续阶段中的最终 contract 覆盖前文已经被用户修正的早期假设，尤其包括：

- 六个区域不再使用固定 `3 × 2` 槽位，而是 seed 确定性的紧凑随机散点。
- 每个区域改为更大的 `780 × 780` 近方形 footprint，六中心单轴跨度不超过 `1,400m`、包围盒面积不超过 `1,450,000m²`。
- 宏观道路是消费真实随机中心的 5 条短、连通、无非端点交叉 connector；`urbanRoadSegments` 只含城区局部道路。
- mixed 实体通过显式 `regionId` 维护稳定归属；城区按 nearest-owned 多边形计算的建筑覆盖率生产强制不低于 `38%`。
- mixed 室外物资围绕所属 landing-zone anchor 采样，并要求权威无障碍走廊。
- 森林每区最终使用 180 棵权威树，继续保持山坡、岩石和比苍岬岛显著更高的树密度。
- 联机桌面从 quick/public/join、私人 ready/start 的真实用户手势预锁鼠标；私人未准备阶段释放，session 复用安全 helper，拒绝时保留“继续游戏”兜底。
- 联机 admission 使用 single-flight generation gate 和 active connection identity guard；旧异步和旧连接无权影响替换连接。
- checkpoint 兼容判断先验证完整可恢复 shape，再应用 v5/v6 map 兼容策略；本轮继续补齐完整 50 人 roster、record key/id 和 room member actor 完整性。

### Phase 2：紧凑随机区域与联机桌面自动进入

#### Plan

目标是修正用户指出的固定六宫格、区域间大片空白和长直道路，同时修复联机桌面加载完成后仍显示“继续游戏”的输入激活回归。

验收合同：

1. 六个区域中心由 `mapSeed` 确定性生成，同 seed 一致、不同 seed 变化，不能退化为固定行列模板。
2. 区域更大、更接近且整体战场更紧凑；代表 seed 和多 seed 压力均满足 span/area、地图边界和最小可玩间距。
3. 5 条 connector 构成短、连通、非交叉骨架，不穿第三模块开发核心；局部城区/农村道路继续按实际类型生成。
4. 每个 mixed 建筑、树、岩石和 cover 使用显式 `regionId`；生成计数和物资归属不再靠可能重叠的矩形反推。
5. 城区 36 栋且 nearest-owned 建筑覆盖率不低于 `38%`；农村 9 栋并保留草垛、树和岩石；森林 2 栋、3 个山丘、180 树和岩石。
6. 唯一“医院”、16 个 landing zones、250 个物资、三固定三随机区域、协议 7 和 checkpoint 6 保持不变。
7. 联机桌面 quick/public/join 在真实点击内预锁；私人访客未准备时释放、ready 时重锁，房主 start 时锁定；touch 不锁。
8. pointer lock API 缺失、同步异常、legacy void 或 Promise reject 不能阻止比赛加载，现有暂停卡继续作为兜底。
9. 完成 typecheck、完整 Vitest、三套 coverage、全部 build/budget、Chrome desktop/mobile/双客户端联机验收和独立 reviewer。

实现任务：

- 在 `src/config/mixedMap.ts` 替换固定槽位，生成紧凑随机中心、近方形区域、平面短 connector 和尺度化局部内容。
- 在 `src/config/map.ts` 写入并消费显式 `regionId`，按归属生成 mixed 物资与自然障碍。
- 在 `tests/unit/mixedMapLayout.test.ts` 覆盖 seed 变化、非网格、span/area、非交叉、hill 边界、真实城区密度和归属。
- 在 `src/controllers/pointerLock.ts` 提供单机/联机共用安全 helper；在 `GameApp` 的真实手势入口预锁，在 `MultiplayerSession` 安全恢复。
- 同步 `AGENTS.md`、`README.md`、`docs/architecture.md` 和预算；不改变旧地图生成、联机规则、协议或 checkpoint 版本。

#### Build

- 2026-08-07 02:30：新增宏观失败回归；旧实现准确因跨 seed 中心不变、固定六宫格和 7 条网格 connector 失败。
- 2026-08-07 02:40：区域替换为 seed 确定性的紧凑随机中心和 `780 × 780` footprint；代表 seed 均至少有 5 个唯一 X/Z，旧 all-rural `11`、all-town `16`、all-forest `38` 类型组合保持。
- 2026-08-07 02:40：宏观道路改为 5 条基于真实中心的确定性最小连接骨架；城区/农村局部道路继续生成，森林树数从 150 提升为每区 180，保持面积扩大后的密度。
- 2026-08-07 02:40：建筑、树、岩石、cover 和 mixed 物资使用显式 `regionId`；区域内容计数与物资建筑选择不再依赖重叠矩形。
- 2026-08-07 03:27：unit 44 files / 430 tests、Worker 4 / 32、standalone 3 / 22 全通过；Worker 使用任务前已有的用户态 workerd wrapper。
- 2026-08-07 03:56：三套 coverage 通过；application `77.78 / 71.76 / 80.60 / 79.82`，Worker `77.69 / 70.16 / 92.73 / 83.42`，standalone `77.13 / 62.25 / 86.30 / 80.43`，加权 `77.74 / 71.18 / 82.64 / 80.33`。
- 2026-08-07 03:58：顺序构建消除并行写 `dist/` 的产物竞态；经资源审阅仅调整 browser/Worker/server raw 上限至 `1,095,000 / 500,000 / 520,000`，最终 `1,091,098 / 499,002 / 515,883`，其他预算不变。
- 2026-08-07 04:04：Chrome desktop/mobile 验收通过，音量 `0`。六 POI 为随机不同坐标且形成连续战场，`844×390` 小地图与触控控件均在视口；两轮仅 SwiftShader warning，页面和 8798 均即时清理。
- 2026-08-07 04:48：采纳 reviewer Round 1：中心新增 `1,400m` 单轴和 `1,450,000m²` 包围盒硬上限；connector 生成拒绝非端点交叉和穿越第三模块核心；seed `4820/12894` 反例关闭。
- 2026-08-07 04:48：城区密度改为 deterministic Voronoi nearest-owned 多边形和建筑交集计算，生产强制覆盖率至少 `38%`；500 blueprint seeds 最低 `39.11%`，seed `256` 为 `40.95%–46.55%`。
- 2026-08-07 04:48：hill 先生成半径再夹紧中心，完整 footprint 保持地图内；seed `423` 反例关闭。10,000 position seeds、500 blueprint seeds、100 完整 layout seeds 均通过。
- 2026-08-07 05:00：mixed 室外物资改为围绕所属 landing-zone anchor 在 `30–175m` 内采样，并要求 anchor 到物资的 `1.5m` 权威走廊不穿建筑、树、石、草垛或坡道；三个 mixed seed 的 750 个物资可达可拾取。
- 2026-08-07 05:00：reviewer 修复后完整测试通过：unit 44 / 431、Worker 4 / 32、standalone 3 / 22。
- 2026-08-07 05:56：最终 coverage 通过；application `77.94 / 71.82 / 80.83 / 80.00`，Worker `77.56 / 70.08 / 92.73 / 83.28`，standalone `77.13 / 62.25 / 86.30 / 80.43`，加权 `77.86 / 71.23 / 82.79 / 80.46`。10,000 seed 压力保持全部样本和几何阈值，仅将高负载有限 timeout 调为 900s。
- 2026-08-07 05:58：最终 shared authority 增量经资源审阅后 Worker/server raw 上限调整为 `510,000 / 530,000`；最终 browser `1,093,837 / 1,095,000`、Worker `507,944 / 510,000`、server `524,275 / 530,000`，全部预算及 `git diff --check` 通过。
- 2026-08-07 06:05：最终 Chrome map 复验通过；desktop 六 POI 跨度约 `96×99` 小地图像素，唯一医院可见；mobile `844×390×DPR2` 小地图和 11 个可见按钮均在视口。两轮音量 `0`、仅 SwiftShader warning，并即时清理页面、preview 和 8798。
- 2026-08-07 06:13：联机 pointer-lock 失败测试确认根因：单机在真实开始手势同步请求，旧 `MultiplayerSession.resumeInput()` 首次执行在异步加载后已失去用户激活。
- 2026-08-07 06:39：新增 `requestDesktopPointerLockSafely` / `releasePointerLockSafely`，覆盖已锁定去重、touch 隔离、API 缺失、同步异常、legacy void 和 Promise rejection；quick/public/join 预锁，私人未准备释放、ready 重锁、host start 锁。
- 2026-08-07 06:39：same-origin standalone 双客户端 Chrome 验收通过。Guest ready 和 Host start 后均锁定；倒计时和异步场景加载后两端 `pointerLockElement===canvas`，pause card 隐藏；音量 `0`，仅 SwiftShader warning。两个 context、standalone、8799 均即时清理，只剩 `about:blank`。
- 2026-08-07 07:26：最终 typecheck、unit 44 / 436、Worker 4 / 32、standalone 3 / 22 通过；application coverage `77.81 / 71.80 / 80.82 / 79.84`，加权 `77.75 / 71.21 / 82.79 / 80.32`。
- 2026-08-07 07:26：联机 UX 使 browser entry 增约 926B，经审阅仅将 browser raw 上限调至 `1,100,000`；最终 browser `1,094,763 / 1,100,000`、Worker `507,944 / 510,000`、server `524,275 / 530,000`，全部预算通过。

#### Review

Round 1：

- 结论不通过：blocker 0、high 0、medium 3、low 1。
- Medium 1：生成仅限制单轴 `1,440m`，大量 seed 的中心包围盒不比旧阵列紧凑；seed `4820` 面积约旧阵列 121.3%。
- Medium 2：Kruskal 未拒绝 connector 非端点交叉；100,000 seed 扫描发现 seed `12894` 等 5 个交叉布局。
- Medium 3：城区覆盖率断言从 `38%` 降至 `28%`，且 seed `256` 实际约 `24.11%`，违反高密城区合同。
- Low 1：hill 边界测试只看中心/region rectangle；seed `423` 的完整 hill radius 越界约 `11.251m`。
- disposition：全部采纳；分别通过 span/area 硬合同、平面 connector、nearest-owned `38%` 生产 gate 和 hill radius 边界生成修复。

Round 2：

- 重新读取统一合同并静态复审完整增量；参考外层 typecheck、完整 tests/coverage/build/budget、地图 desktop/mobile 和双客户端 pointer-lock E2E，未重复完整门禁。
- 额外以独立 `500×500` midpoint grid 验证 seeds `0/16/42/256/498/4820/12894` 的城区 owned area/coverage，与生产精确半平面裁剪在 0.5% 容差内一致。
- pointer-lock helper、真实手势预锁、private release/relock、所有失败/terminal/menu 释放路径和暂停兜底均未发现明确问题。
- 结论通过：blocker 0、high 0、medium 0、low 0。

### Phase 3：Codex admission 与 checkpoint shape P2

#### Plan

Codex 对 `ee1aca8` 指出：

1. admission 可重复触发，替换连接时旧 `closed` handler 可能释放新连接需要的 pointer lock。
2. v5 checkpoint 的 optional-chain mapId 判断把完整 legacy missing-mapId 与缺失/truncated state 混为同一 `undefined`。

修复合同：

- 顶部 quick/public/private/join 和公开房列表共用 single-flight generation gate。
- pending 时同步禁用/忽略重复入口；成功、失败和 finally 都必须按 active token 与 DOM/connection owner 执行。
- 旧 connection 的 status/message/closed handler 无权影响替换 connection。
- active WebSocket open failure 必须由 connection owner 恢复可操作联机大厅、释放输入锁并显示具体错误。
- checkpoint 参数按 `unknown` 验证完整 outer counters 和可恢复 state shape，再应用 v6/v5 map 策略。
- equipment level 使用严格数字枚举；safe-zone stage 在配置范围内，closed 仅允许最后阶段。
- Worker/standalone 继续共享同一 guard 和损坏持久化删除路径。

#### Build

- 2026-08-07 08:58：基线 `ee1aca8`，先添加 admission/checkpoint 失败回归。
- 2026-08-07 09:05：实现 `MultiplayerAdmissionGate`、所有入口共享 gate、active connection identity guard 和完整 checkpoint shape validator；合法 v5 missing-mapId/island/town 保留，missing/null/array/truncated state 及损坏 actor/inventory/safe-zone/flight/loot/result 拒绝。
- 2026-08-07 09:05：定向合同、Worker/standalone 损坏 v5 删除和 typecheck 通过；完整 unit 45 / 440、Worker 4 / 33、standalone 3 / 23 通过。
- 2026-08-07 09:51：coverage 通过；application `77.52 / 71.63 / 80.97 / 79.64`，Worker `77.32 / 69.76 / 92.73 / 83.14`，standalone `77.13 / 62.25 / 86.30 / 80.43`，加权 `77.48 / 71.03 / 82.88 / 80.14`。
- 2026-08-07 09:52：构建与预算通过；checkpoint validator 增量经审阅只将 Worker raw 上限从 `510,000` 调至 `515,000`。browser `1,096,496 / 1,100,000`、Worker `512,960 / 515,000`、server `528,727 / 530,000`。
- 2026-08-07 09:55：Slow 3G Chrome double-click quick match 仅产生一次 `/v1/guests` 和一次 `/v1/matchmaking/quick`；进入公开房后 pointer lock 保持。验证后 isolated context、standalone、8800 即时清理，只剩 `about:blank`。
- 2026-08-07 10:17：采纳 reviewer Round 1：所有 admission success/catch/finally 副作用同时要求 active generation token 与原 owner 仍 connected；补 reset→new attempt→old reject 回归。
- 2026-08-07 10:17：equipment level 改为严格 `0|1|2`，safe-zone stage 必须小于配置长度，closed 仅允许最后阶段；补字符串 equipment 与 stage 999 拒绝回归。
- 2026-08-07 10:17：受影响 unit 3 files / 21、Worker admin 11、standalone runtime 9 和 typecheck 通过；build/budget 通过，browser `1,096,754`、Worker `513,266`、server `528,987`。
- 2026-08-07 10:24：采纳 reviewer Round 2：active WebSocket open failure 由 connection owner 清空 active connection、释放 pointer lock、停用 fullscreen、重渲染联机大厅并显示错误；stale connection 无权操作 UI。
- 2026-08-07 11:02：Chrome 通过强制 WebSocket constructor 抛出验证 open-failure 恢复；页面回到可操作联机大厅，四入口恢复，pointer lock 释放。context、8801 均即时清理，只剩 `about:blank`。
- 2026-08-07 11:02：最终 typecheck、unit 45 / 441、Worker 4 / 33、standalone 3 / 23 通过；application coverage `77.46 / 71.54 / 81.00 / 79.55`，加权 `77.43 / 70.96 / 82.90 / 80.07`。
- 2026-08-07 11:02：最终 build/budget 通过：browser `1,096,976 / 1,100,000`、Worker `513,266 / 515,000`、server `528,987 / 530,000`；`git diff --check`、端口和 Chrome 清理通过。

#### Review

Round 1：

- 结论不通过：blocker 0、high 0、medium 2、low 0。
- Medium 1：旧 admission reject 在 gate reset/new attempt 后仍可无条件释放当前 pointer lock、停用 fullscreen 或写入新页面。
- Medium 2：checkpoint guard 通过 `Number()` 接受字符串 equipment level，并接受 `stageIndex=999`，恢复首 tick 可抛错。
- disposition：增加 token + DOM owner 副作用所有权；equipment/stage 改为严格可恢复合同并补反例。

Round 2：

- 结论不通过：blocker 0、high 0、medium 1、low 0。
- Medium：HTTP admission 成功、DOM 替换后 WebSocket open reject 时，原 owner 已断开且 active connection 已清空，没有 owner 恢复 UI，页面停在“正在连接”死页。
- disposition：把 open-failure 清理责任转移给仍拥有 lobby shell/connection 的 active connection owner。

Round 3：

- 复核 single-flight、stale owner、finally、WebSocket open failure、完整 v5 legacy 和合法 finished/closed；额外最小验证确认字符串 equipment 与 stage 999 拒绝。
- 结论通过：blocker 0、high 0、medium 0、low 0。

### Phase 4：Codex checkpoint actor roster P2

#### Plan

Codex 对 `09c7e8284b2cf841d53934405898fb163bec6a99` 指出：checkpoint `actors` 只要非空且单项 shape 合法就会通过；1 人或 49 人截断 roster 可恢复运行，悄悄改变 50 人 Battle Royale 胜负逻辑。

最终合同：

- `actors` 必须恰好包含 `BATTLE_ROYALE_CONFIG.participantCount`（50）项。
- 每个 `[recordKey, actor]` 必须满足 `recordKey === actor.id`。
- `isMatchCheckpointCompatible(checkpoint, requiredActorIds)` 的 required actor IDs 必须唯一、全部对应 `player`，并与 checkpoint 的完整 player actor 集合一致。
- running/finished room 必须有 2–10 个成员，且每个持久化成员 actor ID 非空、唯一；成员不能指向 bot、共享 actor 或留下未绑定 player actor。
- `worker/GameRoom.ts` 构造期和 `ensureRuntime()` 恢复均传入当前持久化 room member actor IDs。
- 合法完整 v5 missing-mapId/island/town、v6 和 finished/closed checkpoint 继续兼容。
- 1/49 actor、key/id mismatch、50 actor 但缺失真人 member 的 checkpoint 必须拒绝。
- Worker Durable Object 和 standalone SQLite 重启都必须删除 truncated roster，不能进入 runtime 恢复循环。
- 不提高 checkpoint 版本，不改变协议、房间规则或 participant count。

文件与任务：

1. `tests/unit/matchRuntime.test.ts`：先锁定 1 actor、49 actors、key/id mismatch、required human actor missing 的失败回归。
2. `src/server/MatchRuntime.ts`：实现精确 50 人、key/id 和可选 required actor IDs guard。
3. `worker/GameRoom.ts`：constructor 与 `ensureRuntime()` 一致传 room member actor IDs。
4. `tests/worker/admin.test.ts`：增加 truncated roster 的 Worker 删除回归。
5. `tests/standalone/localDurableObjectRuntime.test.ts`：增加 truncated roster 的 SQLite 重启删除回归。
6. `AGENTS.md`、`docs/architecture.md`：记录 checkpoint roster 长期合同。
7. 运行 typecheck、完整 unit/Worker/standalone、三套 coverage、browser/Worker/server/standalone build 和 budgets。
8. presentation 未改变；仍检查本轮不需要重复实图操作。若为交付门禁执行 Chrome，则音量 `0` 并立即清理页面、context、服务和端口。
9. 启动独立 reviewer，解决全部 blocker/high/medium 并复审通过后，把最终 Build/Review 记录写入本文件。
10. staged set 必须包含非 plan 实现文件；一个实现 commit 包含代码、测试、文档和本 plan，随后 push、等待 CI/Pages、再次 `@codex` 并跟进到无问题。

#### Build

- 2026-08-07 11:16：基线 `09c7e82`，Codex actor roster P2 确认成立；本地/远端一致且开始时工作区干净。
- 2026-08-07 11:16：已在 `tests/unit/matchRuntime.test.ts` 添加 1 actor、49 actors、key/id mismatch 和 50 actor 但缺失 required human actor 的失败回归；旧实现按预期在 one-actor 断言返回 `true`，证明测试命中问题。
- 2026-08-07 11:31：按用户要求把三个后续 plan 的 Plan/Build/Review 合并进本 canonical plan，并删除重复文件；后续只维护本文件。
- 2026-08-07 11:28：共享 checkpoint guard 已实现精确 `BATTLE_ROYALE_CONFIG.participantCount`（50）actor、record key 与 `actor.id` 一致、可选 required room-member actor IDs 全部存在。`GameRoom` constructor 和 `ensureRuntime()` 通过同一 `memberActorIds()` helper 传入持久化成员身份，避免只修一条恢复路径。
- 2026-08-07 11:28：回归覆盖 1/49/51 actor、key/id mismatch、50 actor 但删除真人并补 replacement bot；Worker Durable Object 覆盖 49 actor 删除和完整数量但缺 room member 删除，standalone SQLite 重启覆盖 49 actor 删除。定向 unit 10/10、Worker admin 13/13、standalone runtime 10/10 与三端 typecheck 全部通过。
- 2026-08-07 11:45：完整回归在保留 1 个核心给 SSH 的前提下执行。unit 使用最多 7 workers 与 120s 通用有限 timeout，45 files / 441 tests 全通过；Worker 4 files / 35 tests、standalone 3 files / 24 tests 全通过。未减少 seed、未修改业务断言或仓库 timeout。
- 2026-08-07 12:06：coverage 首轮在宿主仍有 56 个外部 self-play 满核进程时出现多个旧地图/导航用例的 wall-clock hook timeout；用户明确要求停止 coverage，因此已终止并清空所有 coverage/Vitest worker，不再重试、不修改 coverage 阈值，也不把本轮记为 coverage 通过。上一提交 `09c7e82` 已有完整 coverage 证据；本轮新增 roster 分支由 unit/Worker/standalone 定向与完整回归覆盖。
- 2026-08-07 12:08：顺序完成 same-origin standalone/browser、Worker dry-run 和 server build；预算全部通过且无需调整：browser `1,096,976 / 1,100,000`、all JS `3,793,631 / 3,900,000`、252 / 260 chunks、CSS `44,643 / 45,000`、dist `4,315,570 / 4,450,000`、Worker `513,774 / 515,000`、server `529,453 / 530,000`。`git diff --check` 通过，coverage 残留进程为零。
- 2026-08-07 12:08：本轮不改变 presentation、地图布局或输入行为，沿用已记录的地图 desktop/mobile、双客户端 pointer-lock、single-flight 和 WebSocket failure Chrome 验收；未重复打开 Chrome，因而没有新增 MCP 页面、context、服务或端口需要清理。
- 2026-08-07 12:24：采纳独立 reviewer Round 1 的 medium。shared guard 现在要求 required actor IDs 唯一、全部实际存在且对应 `player`，并与 checkpoint 的完整 player actor 集合相等；`GameRoom` 对 running/finished persistence 要求 2–10 个成员 actor ID 全部非空且唯一。由此同时拒绝 member→bot、两个 members→同一 actor、null actorId、缺 member actor 和未绑定 player actor。
- 2026-08-07 12:24：为避免“空 members 先触发删除”造成假覆盖，既有 Worker/standalone checkpoint fixture 已改成真实两成员 `human-1/2` 映射；合法 v5 town SQLite 重启仍保留。新增 unit 覆盖 required actor 为 bot、重复 required IDs、required player 集合过短；Worker 真实持久化新增 member→bot、重复 actor、null actorId 删除路径。
- 2026-08-07 12:24：Round 1 修复后的最终受影响门禁通过：三端 typecheck；checkpoint unit 10/10；Worker 4 files / 38 tests；standalone 3 files / 24 tests。第一次 Worker 与 standalone/build 并行时，已有 `stops and deletes a running room` 用例因 DO active references 在 30s 内未释放而失败；无断言/业务错误，串行原命令复跑 Worker 4/38 全通过，未修改 timeout 或测试合同。
- 2026-08-07 12:24：最终 Worker/server bundle 经过等价逻辑精简后在原预算内通过，无需调整阈值：browser `1,096,976 / 1,100,000`、Worker `514,291 / 515,000`、server `529,970 / 530,000`，其余预算保持上一条记录并 PASS；`git diff --check` 通过。按用户明确要求未运行 coverage。

#### Review

待 roster 实现、完整验证和独立 reviewer 完成后追加。不得在 reviewer 通过前 commit/push。

Round 1 — 2026-08-07：

- 审查范围：完整读取 `/home/lingchen.judy/ai-workspace/subagents/code-reviewer.md`、根 `AGENTS.md`、`README.md` 和本 canonical plan，重点对照 Phase 4 Plan/Build 与 Phase 3 review；以 `09c7e8284b2cf841d53934405898fb163bec6a99` 为直接基线、`main@7a453f5` 为背景，静态审查 `git diff 09c7e82`。未恢复或新建已删除的两个重复 plan。
- 已参考外层证据：typecheck；unit 45 files / 441 tests、Worker 4 / 35、standalone 3 / 24；定向 unit 10、Worker admin 13、standalone runtime 10；standalone/browser、Worker dry-run、server builds；最终 budgets 和 `git diff --check`。按用户要求未运行 coverage，也未重复完整 test/typecheck/build/budget/browser。
- 额外最小只读验证：现有测试覆盖 actor 数量、key/id 和 required ID 缺失，但未覆盖 required ID 的 actor kind 与 member 映射唯一性；因此仅构造当前合法 checkpoint 调用 guard。将 required `human-1.kind` 改为 `"bot"` 后仍返回 compatible；传入重复 required IDs `["human-1", "human-1"]` 也返回 compatible，未修改文件。
- 审查结论：**不通过，阻止提交。** Findings：blocker 0、high 0、medium 1、low 0。

Medium：

1. `src/server/MatchRuntime.ts:382`、`worker/GameRoom.ts:1026`：required room-member roster 只检查 ID 在 `actors` record 中存在；`memberActorIds()` 又会保留重复 ID并静默丢弃 `actorId: null`。它没有验证每个持久化 running/finished member 都具有非空、互不重复的 actor ID，也没有验证 required actor 的 `kind === "player"`。最小只读复现确认 required `human-1` 改成 bot 仍兼容，两个成员重复映射到 `human-1` 也会兼容。前者恢复后 `MatchRuntime` 同时把同一 actor 放入 `humanActorIds` 和 `bots`，bot command 会覆盖真人 command；后者会让两个 socket/成员共享同一权威 actor。两种情况都违背 2–10 个稳定真人身份与 authoritative roster 合同，且不会进入 Worker/standalone 的损坏记录删除路径。Builder 应在 `GameRoom`/共享 guard 边界验证 running/finished member actorId 全部非空且唯一，并要求每个 required actor 为 `player`；补 unit 以及至少一个真实持久化删除回归后请求复审。

- 非阻塞确认：checkpoint actor 总数严格为 50，record key 与 `actor.id` 一致，缺失 required ID 会拒绝；constructor 与 `ensureRuntime()` 使用同一 `memberActorIds()` 输入。Worker 49 actor 与 missing-member、standalone SQLite 49 actor 测试都经过真实持久化恢复和 `deleteAll()` 路径。AGENTS/architecture 已同步当前 roster 合同。
- Plan consolidation：canonical plan 已保留 Phase 2 的最终随机紧凑地图/pointer-lock Build、两轮 review findings/disposition，以及 Phase 3 admission/checkpoint 的三轮 review 和最终门禁/浏览器事实；早期固定槽位假设也被显式标记为后续合同覆盖。删除两个重复 plan 未发现丢失会影响后续实现、审查或交付判断的关键 Build/Review 事实。

Round 1 disposition：

- **已解决。** `isMatchCheckpointCompatible()` 通过 required actor set 与全部 player actor 的逐项等价比较，保证 required IDs 唯一、存在、为 `player` 且没有未绑定 player；`memberActorIds()` 要求 running/finished room 恰有 2–10 个非空唯一 actor IDs。constructor 与 `ensureRuntime()` 继续消费同一 helper。
- 新增 unit 的 bot/duplicate/short-player-set 反例，以及 Worker 的 member→bot、duplicate member actor、null actorId 真实持久化删除回归；所有旧 checkpoint persistence fixtures 使用真实两成员，避免由空成员提前拒绝掩盖目标条件。
- 修复后受影响 typecheck、unit、Worker、standalone、build/budget 和 diff check 证据见 Phase 4 Build；未降低断言、未扩大预算、未运行用户要求停止的 coverage。

Round 2 — 2026-08-07：

- 审查范围：重新完整读取 canonical plan Phase 4 最新 Plan/Build/Review、根 `AGENTS.md`、`README.md` 和 reviewer 提示；继续以 `09c7e8284b2cf841d53934405898fb163bec6a99` 为直接基线、`main@7a453f5` 为背景，静态审查当前完整 diff。未恢复或新建已删除的重复 plan。
- 已参考外层最终证据：三端 typecheck；checkpoint unit 10/10；Worker 串行 4 files / 38 tests；standalone 3 / 24；Worker/server build；browser `1,096,976`、Worker `514,291 / 515,000`、server `529,970 / 530,000` budgets；`git diff --check`。未重复完整 unit/build/browser，按用户要求未运行 coverage。
- Round 1 disposition 核对：`isMatchCheckpointCompatible()` 在提供 required IDs 时先拒绝重复 required ID，要求每个 required ID 实际存在且为 `player`，并逐项验证 required set 与 checkpoint 全部 `kind: "player"` actor 集合完全一致；因此 member→bot、缺 member、未绑定 player 和 duplicate required 均拒绝。actor 总数 50、record key/id 一致合同继续保留。
- `GameRoom` 核对：constructor 与 `ensureRuntime()` 均使用同一个 `memberActorIds()`；running/finished persistence 的成员数量必须为 2–10，每个 actorId 非空且互不重复。constructor 对 helper 返回 null 或 shared guard 不兼容统一关闭并 `deleteAll()`；`ensureRuntime()` 同样不会绕过该合同。
- 持久化 fixture 核对：既有 Worker/standalone checkpoint fixtures 均改成真实 `human-1/2` 两成员映射，目标 checkpoint 损坏不再被空 members 提前拒绝掩盖。Worker 的 49 actor、完整 50 但缺 player、member→bot、duplicate actor 和 null actorId 分别到达对应 roster 条件后验证 room/checkpoint 删除；standalone SQLite 真实重启验证 49 actor 删除。合法 v5 town fixture 使用相同真实两成员并确认 room/checkpoint 保留。
- Plan consolidation 与文档：canonical plan 继续保留 Phase 2/3 关键 Build/Review 和 Phase 4 Round 1 finding/disposition；两个重复 plan 保持删除。`AGENTS.md` 与 `docs/architecture.md` 准确记录 50 actor、2–10 member、非空唯一 member actor ID 和完整 player-set 等价合同。
- 审查结论：**通过。** 本次审查未发现明确问题。Findings：blocker 0、high 0、medium 0、low 0；没有阻止提交的 unresolved finding。
- 残余风险：standalone 本轮新增的是 truncated 49-actor SQLite 删除回归，member→bot/duplicate/null 的平台持久化回归集中在共享 Worker `GameRoom` 测试；standalone 复用同一个 `GameRoom` 和 `memberActorIds()`，且完整 standalone suite 已通过，因此这是非阻塞的平台测试分布差异，不是实现分叉。

### Phase 5：三地图品牌牌一致性

#### Plan

用户在 `d78c616` 推送后新增 presentation 修正：苍岬岛已有的五块品牌牌在灰炉城和烬岚郡只出现两块，要求所有地图都显示完整同一组牌子，并分别放在语义合适、几何安全的位置。本阶段是新的用户变更，继续使用本 canonical plan，不新建 plan；它不改变权威地图、碰撞、协议、checkpoint 或游戏数值。

根因与最终合同：

- 稳定牌子资产共五个：`decal.brand.drop-zone`、`decal.brand.island-operations`、`decal.brand.property-ll01`、`decal.brand.restricted-area`、`decal.brand.supply`。
- 当前 `property / restricted / supply` 分别硬编码到苍岬岛 `北港 / 雷达哨 / 旧仓区`；另外两张地图没有这些名称，所以 `resolvePoint()` 返回 `undefined` 并静默跳过，只剩 drop-zone 和 hospital 两块。
- 每个 `MapId`、每个合法 seed 都必须生成五个互不重复的稳定 asset ID；不能用数组索引偶然碰到某个点，也不能在找不到锚点或净空位置时静默少牌。
- 语义锚点：
  - 苍岬岛保持 `北港 / 雷达哨 / 旧仓区`，避免已有外观漂移。
  - 灰炉城：地产牌靠 `工人住宅区`，禁区牌靠 `铸造工业园`，补给牌靠 `仓储港区`。
  - 烬岚郡：地产牌靠固定城区 `赤钟城区`，禁区牌靠固定山林 `沉杉岭`，补给牌靠固定农村 `风穗乡`；不依赖三个随机区域的类型或名字。
- drop-zone 继续锚定 landing zone，operations 继续锚定唯一医院；医院牌和全部品牌牌保持 presentation-only、non-pickable、non-colliding。
- 放置继续使用统一地形/障碍/坡道/牌间净空检查，并面向锚点；若标准搜索半径不足，应扩展确定性候选而不是穿进建筑、树石、道路权威几何或静默丢失。
- 不新增图片、manifest ID 或第三方依赖；复用现有五个稳定资产。

文件与任务：

1. `tests/unit/brandSigns.test.ts`：先把现有“岛屿五牌”升级为三地图、代表 seed、五 asset ID、确定性、净空和语义锚点合同；旧实现应因 town/mixed 只有两牌而失败。
2. `src/client/brandSigns.ts`：把硬编码单名称 resolver 改为显式 per-map 语义锚点，不改变苍岬岛已有锚点；确保任一牌无法放置时显式失败。
3. `tests/unit/islandScene.test.ts`：灰炉城和烬岚郡 NullEngine 场景必须各渲染五个 `brand-sign` mesh，名称集合与资产集合一致，且全部 non-pickable/non-colliding。
4. `AGENTS.md`、`docs/architecture.md`：记录三地图共享五牌、per-map 语义锚点和禁止静默遗漏的长期 presentation 合同。
5. 验证：受影响 unit/NullEngine、typecheck、完整必要回归、browser build 和 budgets；不运行用户已明确停止的 coverage。
6. Chrome DevTools MCP：production build、音量 `0`，分别进入灰炉城和烬岚郡，确认五牌实际 mesh/纹理均出现且 console 无任务引入错误；每轮立即关闭页面/context、停止服务并确认只剩 `about:blank`。
7. 启动独立 reviewer，解决全部 blocker/high/medium 并复审通过；Build/Review 在新实现 commit 前写入本文件。
8. 创建包含非 plan presentation 实现的单一 commit，普通 push 到现有 `feat/hybrid-regions` / PR #2，重新 `@codex review` 并监控最新 SHA 的 CI、Pages 与 Codex 到明确通过。

#### Build

- 2026-08-07 12:36：盘点现有资产与运行结果。五个 asset ID 均已在 manifest 且图片存在；代表 seeds `0/42/2026` 中苍岬岛均生成五牌，灰炉城与烬岚郡均只生成 `drop-zone / island-operations` 两牌。确认根因是三个 `namedPoint()` 只认识岛屿名称，不是纹理解码、场景创建或资产缺失。
- 2026-08-07 12:36：语义锚点定稿为 island `北港 / 雷达哨 / 旧仓区`，town `工人住宅区 / 铸造工业园 / 仓储港区`，mixed `赤钟城区 / 沉杉岭 / 风穗乡`；后两图均使用固定主 POI，不依赖随机候选区域。
- 2026-08-07 12:36：测试先行红灯准确复现：扩展后的三地图 brand-sign contract 在 `town:0` 断言期望 5、实际 2；不是测试环境或纹理加载错误。
- 2026-08-07 12:37：`src/client/brandSigns.ts` 已使用显式 `MapId -> semantic POI` resolver。岛屿锚点保持不变；town/mixed 使用上述专属锚点。确定性净空候选半径扩展到第四档；任何锚点或安全位置缺失现在显式抛错，不再静默 `continue` 少牌。
- 2026-08-07 12:40：三地图 placement 定向测试通过，覆盖 maps `island/town/mixed` × seeds `0/1/11/16/38/42/2026`，断言五个 asset ID 顺序/唯一性、重复调用确定性、权威障碍/坡面/牌间净空，以及地产/禁区/补给牌距其语义锚点 `<55m`。NullEngine 在既有 town/mixed 场景用例中真实创建五个 `brand-sign` mesh，全部 non-pickable/non-colliding；brandSigns + IslandScene 2 files / 24 tests 通过。
- 2026-08-07 13:01：完整 unit 7-worker 轮次中，既有 `mixedMapLayout` 用例在持续外部满核环境下约 31s 发生 wall-clock timeout；该文件不调用 brand-sign 代码。为避免继续等待已经确定失败的无关 401-seed 长尾，停止该轮后按 1 worker 串行复跑 `mixedMapLayout / brandSigns / IslandScene`，3 files / 33 tests 全通过；未修改测试、seed、断言或 timeout。三端 typecheck 通过。
- 2026-08-07 12:43：browser production build 与预算通过，无需调整阈值：browser entry `1,097,274 / 1,100,000`、all JS `3,793,929 / 3,900,000`、252 / 260 chunks、CSS `44,643 / 45,000`、dist `4,315,868 / 4,450,000`；server/Worker 源码未变并继续使用已通过产物 `514,291 / 515,000` 与 `529,970 / 530,000`。`git diff --check` 通过，按用户要求未运行 coverage。
- 2026-08-07 13:06：production Chrome DevTools MCP 验收通过，全程 `volume=0`、low quality。灰炉城进入航线后，Babylon 当前 scene 恰有 5 个 enabled `brand-sign` mesh，名称/实际 texture 分别为完整五 asset ID，全部 `isPickable=false`、`checkCollisions=false`；烬岚郡独立 reload/开局后同样 5/5 全齐。console 仅本机 SwiftShader software WebGL deprecation warning，无任务引入 error/warn。
- 2026-08-07 13:06：浏览器验收后立即导航任务页面到 `about:blank`、关闭 `last-line-brand-signs` isolated context、停止 preview、确认 8798 关闭且无 Vitest/tsx/preview 残留；Chrome MCP 最终只剩不可避免的 page 1 `about:blank`，未占用其他 agent 的浏览器资源。
- 2026-08-07 13:26：采纳独立 reviewer Phase 5 medium。生产 `brandSignPositionClear()` 新增完整 road shoulder 净空：island/town 使用 `TOWN_ROAD_SHOULDER_HALF_WIDTH=6m`，mixed 使用 `MIXED_ROAD_SHOULDER_HALF_WIDTH=8m`，阈值再加牌面 `width/2 + 1m` footprint 半径；点到线段距离处理零长度 segment。牌子候选仍按同一确定性搜索选取，不能落入道路 surface/shoulder。
- 2026-08-07 13:26：测试不再仅调用生产 helper 自证净空；`brandSigns.test.ts` 使用独立点到线段距离实现，逐牌逐 road 断言距离严格大于 map-specific shoulder + footprint，覆盖 reviewer 反例 town seeds `0/38` 及三图代表 seeds。三图 placement 1/1 通过，brandSigns + NullEngine 最终 2 files / 24 tests 通过；五 asset、semantic anchors、确定性、non-pickable/non-colliding 保持。
- 2026-08-07 13:26：道路修复后最终 browser entry 为 `1,097,524 / 1,200,000`，all JS `3,794,179 / 4,000,000`，252 / 270 chunks，CSS `44,643 / 50,000`，dist `4,316,118 / 4,550,000`；Worker `514,694 / 615,000`、server `530,342 / 630,000`，全部 PASS。三端 typecheck 与 `git diff --check` 通过。牌子数量/纹理未变，只修正位置且自动几何/NullEngine已覆盖，因此未重新打开已清理的 Chrome MCP。

#### Review

待实现、自动验证、Chrome MCP 和独立 reviewer 完成后追加。不得在 reviewer 通过前创建本阶段 implementation commit。

Round 1 — 2026-08-07：

- 审查范围：完整读取 reviewer 提示、根 `AGENTS.md`、`README.md` 和 canonical plan Phase 5 Plan/Build；以 `d78c6167146f2998c82bc22ec880a7f576dd757c` 为直接基线、`main@7a453f5` 为背景，静态审查 Phase 5 指定文件的当前 diff 与 brand-sign placement/render 调用链。审查期间共享工作区出现并行 Phase 6 变更，未撤销、覆盖或纳入本轮 finding。
- 已参考外层证据：三端 typecheck；三图 placement 代表 seeds；brandSigns/IslandScene 2 files / 24、串行受影响 3 files / 33；browser build/budget；town/mixed production Chrome 五 mesh/实际纹理、volume 0、console 和 MCP/8798/process 清理。未重复完整 tests/build/browser，按用户要求未运行 coverage。
- 额外最小只读验证：现有测试的净空断言复用生产 `brandSignPositionClear()`，无法独立覆盖该 helper 遗漏的道路合同，因此计算牌面线段到 `layout.roadSegments` 的二维最短距离。代表 seeds 中灰炉城多处牌面实际进入道路路幅：seed `0` 的 `property-ll01` 与 seed `38` 的同牌和道路中心线相交（距离 `0`）；seed `0` 的 drop-zone / supply 距道路中心线约 `0.054m / 0.573m`，均远小于 town road half-width `3.75m`。另对 town seeds `0–99` 做有限只读生成扫描，五牌均可生成，未发现当前第四候选半径造成合法 seed fail-closed；命令未修改文件。
- 审查结论：**不通过，阻止提交。** Findings：blocker 0、high 0、medium 1、low 0。

Medium：

1. `src/client/brandSigns.ts:64`、`tests/unit/brandSigns.test.ts:40`：Phase 5 Plan 与根 `AGENTS.md` 明确要求品牌牌避开道路权威几何，但 `brandSignPositionClear()` 只检查地图边界、建筑/树石/cover、坡道、其他牌和地形高差，从未消费 `layout.roadSegments`；测试又调用同一个 helper 自证净空，所以会共同漏报。最小只读几何扫描确认灰炉城代表 seed 的牌面线段实际穿过 road surface，包含 seed `0` / `38` 的 `property-ll01` 直接与道路中心线相交。这会把两根立柱和整块牌面插在车道中，视觉上明显穿模，也违背本阶段“扩展候选而不是进入道路权威几何”的验收合同。Builder 应按 map family 的实际 road/shoulder width 对完整牌面 footprint 做 segment clearance，并添加独立于生产 helper 的道路距离断言及上述反例后请求复审。

- 非阻塞确认：五个稳定 asset ID 的 per-map resolver、固定 town/mixed semantic anchors 和 island 原名称锚点正确；代表 seeds 的顺序/唯一性/确定性与 100 个连续 town seed fail-closed 扫描通过。NullEngine 与 production Chrome 均证明 town/mixed 五个 sign mesh 和实际 texture 全齐，牌面/立柱通过 `markDecoration` 保持 non-pickable/non-colliding。当前 production catalog 会在启动 preload 阶段验证五张图片且实际文件存在；Chrome 已确认纹理解析。文档、browser budget 与 MCP/preview 清理记录一致。

Round 2（Phase 5 + Phase 6 合并终审）— 2026-08-07：

- 审查范围：重新完整读取 reviewer 提示、根 `AGENTS.md`、`README.md` 和 canonical plan Phase 5/6 最新 Plan/Build；以 `d78c6167146f2998c82bc22ec880a7f576dd757c` 为直接基线、`main@7a453f5` 为背景，静态审查当前 10 个未提交文件的完整 diff。未修改业务代码、测试、文档或预算。
- 已参考外层冻结证据：三端 typecheck；Phase 5 placement/NullEngine 2 files / 24 与串行受影响 3 / 33；Phase 6 Worker admin 19/19、standalone runtime 11/11、最终 Worker 4 / 41 与 standalone 3 / 25；全部 build/budget；town/mixed production Chrome 五 mesh/实际纹理、volume 0、console 与 MCP/8798 清理；`git diff --check`。按要求未重复完整 test/build/browser，未运行 coverage。只读复核时 Chrome MCP 仍只有 `about:blank`；发现的 Vitest 进程属于另一 checkout `last-line-throwables`，未干预。
- Phase 5 复核：三地图五 asset、显式 per-map semantic anchor、island 原锚点、fail-closed、NullEngine/Chrome mesh/texture 以及 non-pickable/non-colliding 合同均保持成立；预算阈值与 Phase 6 Build 记录完全一致，且属于用户明确批准的资源审阅。
- 审查结论：**不通过，阻止提交。** Findings：blocker 0、high 0、medium 1、low 0。Round 1 medium 尚未处理：`src/client/brandSigns.ts:64` 仍未检查 `layout.roadSegments`，`tests/unit/brandSigns.test.ts:40` 仍复用同一 production helper，灰炉城 seed `0/38` 的已确认道路穿模反例仍可发生。必须让完整牌面 footprint 避开实际 road/shoulder width，并用独立道路距离断言覆盖反例后复审。
- 其余 Phase 5 残余风险：当前 fail-closed 连续扫描证据为 town seeds `0–99`，不是全部合法 seed 的数学证明；但显式失败、确定性有限候选、代表 seed/NullEngine/Chrome 证据足以使其保持非阻塞风险。唯一提交阻塞项仍是上述道路净空 medium。

### Phase 6：Codex malformed members container P2

#### Plan

Codex 对已推送提交 `d78c6167146f2998c82bc22ec880a7f576dd757c` 指出：`memberActorIds()` 直接执行 `Object.values(data.members)` 和 `member.actorId`。若 running/finished 持久化 room 的 `members` 整体缺失、为 `null`/array，或某个 member 项本身为 `null`/非对象，constructor 恢复会在兼容判断前抛错，Worker/standalone 无法到达既有 `deleteAll()` 不兼容清理路径。

最终合同：

- `PersistedRoom.members` 在 runtime restore 边界按 `unknown` 防御性解析，不能信任 TypeScript interface 或存储泛型。
- 仅接受非数组 record；每个 member value 必须是非数组 record，且 `actorId` 为非空字符串。
- 继续要求 2–10 个成员、actor ID 唯一，并由共享 checkpoint guard 验证与完整 player actor 集合一一对应。
- malformed container/value 统一返回 `null`，由 running/finished constructor 关闭并删除 room/checkpoint；`ensureRuntime()` 也必须安全返回 null，不能抛错或创建恢复循环。
- Worker Durable Object 和 standalone SQLite 重启至少覆盖 missing members、`members: null` 和 null member entry；合法两成员 v5 town 恢复继续通过。
- 不改变 checkpoint version、协议、房间规则、正常 waiting-room member 创建或 presentation。

文件与任务：

1. `tests/worker/admin.test.ts`：真实 DO 存储 missing/null/null-entry members，evict 后实例化必须删除 room/checkpoint而非抛错。
2. `tests/standalone/localDurableObjectRuntime.test.ts`：SQLite 重启覆盖 malformed members 删除。
3. `worker/GameRoom.ts`：`PersistedRoom.members` 恢复边界及 helper 接受 unknown，先 record/member shape guard 再提取 IDs。
4. `AGENTS.md`、`docs/architecture.md`：记录持久化成员容器也属于 checkpoint/room 恢复 shape，平台必须删除而不是重试。
5. 运行三端 typecheck、Worker/standalone 完整合同、受影响 unit、build/budget；按用户要求不运行 coverage。
6. 本阶段无 presentation 变更，不重复 Chrome；Phase 5 已完成并清理 MCP。
7. 与 Phase 5 一起完成独立 reviewer/re-review，随后创建包含非 plan 实现文件的单一 commit、push、回复 Codex discussion 并重新 `@codex review`。

#### Build

- 2026-08-07 13:09：`d78c616` 两条 CI build 和 Cloudflare Pages preview 均成功；Codex 对精确 SHA 新增 malformed `members` P2。已确认问题成立：当前 `Object.values(data.members)` 和 `member.actorId` 对 missing/null container 或 null entry 会抛错，绕过 constructor 的 incompatible checkpoint `deleteAll()`。
- 2026-08-07 13:11：失败回归准确复现三类输入。Worker admin 参数化用例的 missing/null members 均以 `Cannot convert undefined or null to object` 失败，null member entry 以 `Cannot read properties of null (reading 'actorId')` 失败；standalone SQLite alarm restore 同样在 `memberActorIds()` 抛错，均未到达 room/checkpoint 删除断言。
- 2026-08-07 13:13：`memberActorIds(members: unknown)` 现在先用清晰 `isRecord()` 验证容器和每个 member entry，再验证非空字符串 actorId、2–10 数量和唯一性。constructor 仅对 running/finished restore 调用该 helper；helper 返回 null 或 checkpoint 不兼容时先清空只供 finished summary 使用的 members，安全通知 Lobby 删除目录项，再 `deleteAll()`。`ensureRuntime()` 复用同一 helper并安全返回 null。
- 2026-08-07 13:14：Worker missing/null/null-entry members 三个真实 DO 用例 19/19 通过；standalone SQLite 同一数据库内三种 malformed room 重启后 room/checkpoint 均删除，runtime file 11/11 通过。最终完整 Worker 4 files / 41 tests、standalone 3 / 25、三端 typecheck 全部通过；合法两成员 v5 town 恢复继续通过。
- 2026-08-07 13:18：shape guard 初版使 standalone server raw 产物为 `530,410B`，超过旧 `530,000B` 410B；等价精简后仍为 `530,327B`，继续压缩会牺牲恢复边界可读性。用户明确要求“代码可读性重要”并批准各资源预算相应加大，允许最多增加 100KB；因此恢复清晰 `isRecord()` helper，并完成显式资源预算审阅。
- 2026-08-07 13:20：预算按用户批准统一增加一档：browser entry `1,100,000→1,200,000`、largest non-entry `650,000→700,000`、all JS `3,900,000→4,000,000`、chunks `260→270`、CSS `45,000→50,000`、dist `4,450,000→4,550,000`、Worker `515,000→615,000`、server `530,000→630,000`。最终实际值 browser `1,097,255`、largest `613,551`、all JS `3,793,910`、252 chunks、CSS `44,643`、dist `4,315,849`、Worker `514,694`、server `530,342`，全部 PASS；没有以压缩代码换取字节。
- 2026-08-07 13:20：Phase 6 不改变 presentation，未重新打开 Chrome；Phase 5 MCP 清理状态保持为仅 `about:blank`、8798 关闭、无 preview/Vitest/tsx 残留。按用户要求未运行 coverage。

#### Review

待失败回归、实现、自动验证和独立 reviewer 完成后追加。

Round 1（Phase 5 + Phase 6 合并终审）— 2026-08-07：

- 审查范围与外层证据同 Phase 5 Round 2；静态复核 `worker/GameRoom.ts`、Worker/standalone 真实持久化回归、AGENTS/architecture 合同及预算脚本，没有重复完整验证或运行 coverage。
- Shape guard：`memberActorIds(members: unknown)` 在枚举前拒绝 missing、null、array 和其他非 record container；逐项拒绝 null、array、其他非 object entry，以及非字符串/空字符串 actorId。随后继续执行 2–10 数量和 actorId 唯一性合同，并把 IDs 交给共享 `isMatchCheckpointCompatible()` 验证完整 player actor set，未回归 Phase 4 roster 约束。
- 恢复链路：constructor 只对 `running/finished` 执行该恢复 guard，合法 `waiting/countdown` 不会因 actorId 尚为空而被误删；损坏恢复先清空 members，使 `summary()` 可安全生成 finished directory update，再 `deleteAll()` 删除 room/checkpoint。Lobby 收到 finished summary 后删除目录项。`ensureRuntime()` 复用同一 helper，损坏输入安全返回 null，不会构造 runtime。
- 持久化证据：Worker 真实 Durable Object 与 standalone SQLite 重启均覆盖 missing/null/null-entry 的 room/checkpoint 删除；代码 guard 同时直接覆盖 outer array 和 non-object/array entry。既有 member→bot、duplicate actor、null actorId、缺失 player/截断 roster 回归继续经过同一链路，合法两成员 v5 town SQLite fixture仍保留并恢复。
- 文档与预算：`AGENTS.md`、`docs/architecture.md` 准确记录 malformed members 删除合同；实际阈值为 browser entry `1,200,000`、largest non-entry `700,000`、all JS `4,000,000`、chunks `270`、CSS `50,000`、dist `4,550,000`、Worker `615,000`、server `630,000`，与 Build 记录一致且属于用户明确批准的调整。
- Phase 6 审查结论：**通过。** 本阶段未发现明确问题。Findings：blocker 0、high 0、medium 0、low 0。Phase 6 无独立提交阻塞项；但当前合并提交仍被 Phase 5 未解决的 1 个 medium 道路净空 finding 阻塞。

Phase 5 Round 2 finding disposition：

- **已解决。** `brandSignPositionClear()` 现在消费 `layout.roadSegments` 与实际 map-family shoulder 常量，对完整牌面 footprint 做 point-to-segment clearance；reviewer 的 town seed `0/38` 道路中心线穿模不再可选。
- 测试使用独立几何公式逐条验证 road clearance，不复用 production helper；最终 placement、NullEngine、typecheck 和 build/budget 证据见 Phase 5 Build。Phase 6 代码/测试未因该修复改变。

Phase 5 Round 3（最终 re-review）— 2026-08-07：

- 审查范围：按要求只重新读取 Phase 5/6 最新 Build/Review disposition、`git diff d78c616` 中 `src/client/brandSigns.ts`、`tests/unit/brandSigns.test.ts`、`tests/unit/islandScene.test.ts` 的相关变化，以及当前预算阈值和 Phase 6 文件 diff；未重复 tests、build、browser 或 coverage。
- Round 2 medium 已关闭：生产 helper 对每个 `layout.roadSegments` 使用 point-to-segment 距离，island/town 采用 `TOWN_ROAD_SHOULDER_HALF_WIDTH=6m`、mixed 采用 `MIXED_ROAD_SHOULDER_HALF_WIDTH=8m`，并额外加上 `width / 2 + 1m` 完整牌面 footprint；距离等于阈值也会拒绝。零长 segment 以 progress `0` 回退到端点距离，不会除零或错误放行。
- 独立测试核对：测试自己的 `independentPointToSegmentDistance()` 不调用 production distance/helper，逐牌逐 road 要求严格 `> shoulder + footprint`；代表 seeds 同时包含 town `0/38` 反例以及 island/town/mixed 的 `0/1/11/16/38/42/2026`。同一用例继续锁定五个稳定 asset ID、确定性、semantic anchors 和 `getBrandSignPlacements()` 不抛错，外层 brandSigns 1/1、brandSigns + IslandScene 2/24 证据证明道路修复未回归五牌/fail-closed 与 scene mesh 合同。
- 预算与清理：最终 browser entry `1,097,524 / 1,200,000`、Worker `514,694 / 615,000`、server `530,342 / 630,000`，阈值与用户批准及脚本一致；外层记录 typecheck、build/budget、`git diff --check` 均通过，MCP 仍仅 `about:blank`。
- Phase 5 最终结论：**通过。** 本次 re-review 未发现明确问题。Findings：blocker 0、high 0、medium 0、low 0；此前道路净空 medium 已解决，没有阻止提交的 unresolved finding。

Phase 6 Round 2（最终 re-review）— 2026-08-07：

- 后续变化只涉及 brand-sign 道路净空、对应 unit 和 browser 产物；`worker/GameRoom.ts`、Worker/standalone persistence tests 仍保持 Phase 6 Round 1 已通过的 malformed members guard 与真实删除/合法 v5 恢复合同。外层最终 Worker 4 / 41、standalone 3 / 25 继续通过。
- Phase 6 最终结论：**通过。** Findings：blocker 0、high 0、medium 0、low 0。Phase 5 + Phase 6 合并增量最终通过独立审查。

### Phase 7：Codex complete persisted member shape P2

#### Plan

Codex 对已推送提交 `fa4c857dc17e7517dc20c88f7009fc6b51a1329c` 指出：Phase 6 只证明 members 容器/entry 是 object 并提取 `actorId`，但 running/finished room 中 `{ actorId: "human-1" }` 之类 partial member 仍会通过；record key 与 `member.playerId` 不一致也会通过。恢复后 lobby、admission/reconnect、账号状态和 socket attachment 会读取缺失字段，留下不可访问或语义错乱的房间。

最终合同：

- 持久化 `members` 必须是非数组 record；每个 `[recordKey, member]` 必须是完整 `RoomMemberRecord`，且 `recordKey === member.playerId`。
- `playerId`、`displayName`、`admissionToken`、`reconnectToken` 必须为非空字符串；`pendingReconnectToken` 仅允许 `undefined | null | 非空字符串`。
- `accountId/accountSessionRevision` 必须成对：游客为 `null/null`；账号成员为非空字符串 + 非负安全整数 revision。
- `admissionExpiresAt`、`joinedAt` 必须为有限非负数；`connectionEpoch` 必须为非负安全整数。
- `admissionConsumed`、`ready`、`connected`、`host` 必须为 boolean；`actorId` 对 waiting/countdown 可为 null，对 running/finished 仍由 `memberActorIds()` 要求为非空字符串、2–10 个且唯一。
- malformed member record 或 key identity mismatch 对任意持久化 room status 都不能进入后续读取；constructor 必须安全通知目录并删除 room/checkpoint，不能抛错或反复恢复。
- shared checkpoint player-set、合法 v5 town 两成员恢复、正常 waiting/countdown 创建与加入语义不变。

文件与任务：

1. `tests/worker/admin.test.ts`：在现有 malformed members 参数化真实 DO 测试中增加 array container、partial member 和 key/playerId mismatch，均必须删除 room/checkpoint。
2. `tests/standalone/localDurableObjectRuntime.test.ts`：SQLite 重启覆盖同样输入；合法 v5 town 完整两成员继续保留。
3. `worker/GameRoom.ts`：新增清晰的完整 member shape parser/guard；constructor 对所有 persisted status 先验证完整 members，running/finished 再提取 actor IDs 和校验 checkpoint。
4. `AGENTS.md`、`docs/architecture.md`：把“object member”收紧为完整 `RoomMemberRecord` 与 key identity。
5. 运行 typecheck、完整 Worker/standalone、build/budget 和 `git diff --check`；按用户要求不运行 coverage。无 presentation 变化，不重复 Chrome，MCP保持已清理。
6. 独立 reviewer/re-review通过后创建包含非 plan 实现的单一 commit、push、回复 Codex discussion并再次 `@codex review`。

#### Build

- 2026-08-07 13:48：`fa4c857` 两条 CI build 和 Pages preview 均成功；Codex 对精确 SHA 新增 complete member shape P2。确认当前 guard 只读 `actorId`，partial object 和 record key/`playerId` mismatch 会通过，问题成立。
- 2026-08-07 13:52：失败回归准确复现。Worker admin 在 partial entry 与 key mismatch 两项保留 room/checkpoint，删除断言失败；standalone SQLite malformed fixture index 4/5 同样保留，证明 Phase 6 仅验证 actorId 不足。missing/null/array/null-entry 已保持删除。
- 2026-08-07 13:54：新增完整 `isRoomMemberRecord(key, value)` guard。持久化成员必须满足 key=`playerId`、非空 identity/display/admission/reconnect strings、可选 pending token、游客或账号/session成对、有限非负 deadlines、非负安全整数 epoch、四个 boolean状态和合法 nullable actorId。`persistedMemberActorIds()` 对任意 status 先验证完整 members；running/finished 再要求 2–10 个非空唯一 actor IDs并校验完整 player set。constructor 对 invalid members 或 match checkpoint 统一清理；`ensureRuntime()` 复用同一 parser。
- 2026-08-07 13:56：最终三端 typecheck和完整 Worker 4 files / 44 tests通过；standalone `localDurableObjectRuntime` 11/11通过，覆盖 missing/null/array/null-entry/partial/key mismatch SQLite重启删除及合法v5 town恢复。完整 standalone 轮次仅既有“独立子进程 kill后重获数据锁”用例因子进程3秒内未输出就绪标记失败；机器 load约69且有56个 self-play+14个match进程。该用例与member guard无调用关系；绑定唯一无占用 CPU 56 后原测试1/1通过，未改timeout或断言。
- 2026-08-07 13:56：最终 build/budget继续通过：browser `1,097,524 / 1,200,000`、Worker `516,341 / 615,000`、server `531,722 / 630,000`，其余阈值和实际值沿用Phase 6/牌子最终记录；`git diff --check`通过。Phase 7无presentation变化，未打开Chrome，MCP仍只剩`about:blank`。按用户要求未运行coverage。

#### Review

待失败回归、实现、自动验证和独立 reviewer完成后追加。

Round 1（独立终审）— 2026-08-07：

- 审查范围：完整读取 `/home/lingchen.judy/ai-workspace/subagents/code-reviewer.md`、根 `AGENTS.md`、`README.md` 和 canonical plan Phase 7 Plan/Build；以 `fa4c857dc17e7517dc20c88f7009fc6b51a1329c` 为直接基线、`main@7a453f5` 为背景，静态审查当前 6 个未提交文件的完整 diff。未修改业务代码、测试、文档或其他 plan。
- 完整 member shape：`isRoomMemberRecord()` 覆盖 `RoomMemberRecord` 的全部持久化字段，并在任何后续 lobby/admission/reconnect/account/socket 读取前要求 record key 等于非空 `playerId`；`displayName`、admission/reconnect token 为非空字符串，pending token 仅允许 undefined/null/非空字符串；游客严格为 `accountId/accountSessionRevision = null/null`，账号成员为非空 account ID + 非负安全整数 revision；deadlines/joinedAt 为有限非负数，connection epoch 为非负安全整数，四个状态字段为 boolean，actorId 仅允许 null 或非空字符串。
- 状态语义：constructor 对任意 status 都先调用完整 parser，因此 missing/null/array/partial/key mismatch 不会进入后续成员读取；waiting/countdown 的完整成员允许 `actorId: null`，且不要求 2–10 个 actor IDs。running/finished 通过 `requireActorIds=true` 继续要求 2–10 个非空唯一 actor IDs，并由 `isMatchCheckpointCompatible()` 验证与 checkpoint 全部 player actor set 完全一致，Phase 4/6 roster 合同未回归。
- 恢复链路：条件等价于“member shape 无效，或 running/finished checkpoint 不兼容”；短路和 `&&` 优先级不会误删合法 waiting/countdown，也不会放过损坏 match。清理先将 members 置空并标记 finished，使 `summary()` 安全生成目录删除通知；Lobby 对 finished summary 删除条目，随后 room/checkpoint `deleteAll()`。`ensureRuntime()` 复用同一完整 parser、强制 actor IDs 并再次执行 checkpoint guard。
- 持久化回归：Worker 真实 Durable Object 参数化覆盖 missing/null/array/null-entry/partial/key mismatch，且在破坏前为 running fixture 分配合法 actor IDs，目标条件不会被旧 null-actor guard 掩盖；standalone SQLite 同库重启覆盖相同六类损坏并断言 room/checkpoint 均删除。合法完整两成员 v5 town fixture继续保留恢复；既有 member→bot、duplicate/null actor、缺 player 与 truncated roster 回归仍由完整 Worker 4 / 44 和定向 standalone 11/11 覆盖。
- 既有阶段与预算：Phase 7 diff 不改 brand-sign 或地图代码，Phase 5 的 6m/8m shoulder + footprint 道路净空和 Phase 6 malformed container 合同保持通过。预算阈值仍为用户批准的 browser `1,200,000`、Worker `615,000`、server `630,000`，最终实际值 `1,097,524 / 516,341 / 531,722` 均在范围内。
- 已参考外层证据：三端 typecheck；Worker 4 files / 44 tests；standalone local runtime 11/11；所有 build/budget 和 `git diff --check`；MCP 仅 `about:blank`。未重复完整 tests/build/browser，按用户要求未运行 coverage。
- 审查结论：**通过。** 本次 Phase 7 独立终审未发现明确问题。Findings：blocker 0、high 0、medium 0、low 0；没有阻止提交的 unresolved finding。
- 残余风险：完整 standalone 套件在机器 load 约 69 时，既有独立子进程 3 秒就绪门限发生一次环境性失败；该测试不经过 member restore guard，绑定空闲 CPU 56 后原用例 1/1 通过，且未改 timeout/断言，因此不构成本阶段 finding。
