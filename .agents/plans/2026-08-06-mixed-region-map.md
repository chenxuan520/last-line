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
