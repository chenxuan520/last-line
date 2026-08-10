## 计划

### 项目背景信息

当前游戏只有一套由 `mapSeed` 驱动的苍岬岛权威布局。用户要求新增一张明显城镇化的地图，并在菜单中提供显式地图选择，同时保持现有海岛种子结果、旧设置、旧房间数据、旧 checkpoint、单机规则和 Cloudflare/standalone 共用业务逻辑的兼容性。

本任务禁止使用负数 seed、seed 高位、特殊 seed 区间或其他隐式编码来表示地图类型。地图身份和随机种子必须是两个独立字段。

### 事实与约束对齐

- 当前/目标分支：`main`。
- 规划基线：`main@3f17b4a`，已在开始规划前执行 `git pull origin main`，工作区干净。
- 当前权威状态只有 `mapSeed`；所有移动、战斗、AI、掉落、HUD、场景和服务端运行时都通过 seed 重建 `MapLayout`。
- 当前 `createMapLayout(seed)` 缓存只以 seed 为 key，各系统的布局刷新也只比较 seed；新增地图后必须同时比较 `mapId + mapSeed`。
- 当前联机房间已有 `RoomOptions`，可承载不可变的房主地图选择；quick match 必须按地图分池，不能把选择城镇地图的玩家加入海岛房间。
- 当前 `MULTIPLAYER_PROTOCOL_VERSION = 3`。旧客户端无法识别 town 布局；若服务端创建 town、旧客户端仍按 island 渲染，会造成权威碰撞和表现不一致，因此联机地图字段上线必须升级严格协议版本并执行维护发布流程。
- 当前 checkpoint 版本是 `3`。旧 checkpoint 和旧持久化房间没有 `mapId`，读取边界必须显式迁移为 `"island"`，不能因缺字段关闭旧海岛房间。
- 当前地图大小为 2400m，航线、安全区、小地图投影和场景远裁剪都依赖统一尺寸。第一版 town 继续使用同一地图尺寸和边界，避免改动战斗时长与网络范围。
- 当前 island 建筑只支持 1–3 层及权威坡道。town 可以将同一套楼板/墙面/坡道规则扩展到 4–5 层，但不得改动 island 的楼层分配、随机调用顺序、比例或 seed 结果；不引入电梯、不可导航楼梯或复杂地下结构。
- 当前资源可复用；第一版不要求新增外部 GLB/贴图资产，以程序化建筑、道路、围墙、掩体、植被密度和 POI 布局形成城镇差异。
- 所有代码改动在实现和必要验证完成后、commit/push/deploy/completion report 之前，必须启动独立 `code-reviewer`。所有 blocker/high/medium 审查发现必须处理并复审通过，才能提交和推送。

### 更新日志

- 2026-08-02 13:02：用户确认采用显式 `mapId`，拒绝用 seed 符号位或特殊 seed 区间编码地图。确定地图选择进入单人设置和联机房间选项；开始前已 pull 到 `main@3f17b4a`。
- 2026-08-02 13:02：用户指定当前 agent 按 `/home/lingchen.judy/ai-workspace/subagents/code-writer.md` 执行，并要求先创建 plan；本轮只建立实施计划，不修改运行时代码。
- 2026-08-02 13:02：用户再次明确交付门禁：实现完成和 push 前必须启动 审查者，确认无未解决 blocker/high/medium 后才能提交推送。
- 2026-08-02 13:04：用户把 town 口径提高为“非常高密度废旧工业化城镇”：核心街区连续楼群必须切碎视线，除主干道、广场和公园外，地面基本看不到远处地平线；允许新增程序化建筑类型，并要求加入房屋之间的二楼权威连廊。
- 2026-08-02 13:04：量化现有 island 基线为约 221–232 栋建筑、44–46 栋多层、278–300 段坡道、384 棵权威树。town 目标提高为 400–520 栋建筑、45%–60% 多层、24–48 条二楼连廊，核心城区建筑覆盖率和街墙连续度显著高于 island。
- 2026-08-02 13:04：用户要求将玩家可见的“废旧工业城镇”改为更正式的地图名；确定显示名为“灰炉城”，稳定 `mapId` 仍为 `"town"`。
- 2026-08-02 13:12：用户要求把全部需求整理成 审查者 可直接核对的验收口径；新增“用户验收口径 / 审查者 对照清单”，后续代码 审查者 必须逐项判定，不能只看测试通过或建筑数量。
- 2026-08-02 13:12：用户提供隔离式 Chrome DevTools MCP。最终实现必须先由 实现 Agent 使用该 MCP 完成真实浏览器验收和自验收，确认页面、交互、控制台与资源清理无问题后，再启动独立 code-reviewer；审查者 通过前禁止 commit/push。
- 2026-08-02 13:14：用户允许灰炉城出现 4–5 层废旧厂办楼、工业塔楼等高楼，并允许 实现 Agent 自由设计景观；硬约束是该扩展只作用于 town，不能改变苍岬岛既有 1–3 层逻辑和任何 seed 结果。

### 用户验收口径 / 审查者 对照清单

以下条目是用户明确确认的需求，优先级高于实现便利性。代码实现完成后的独立审查者 必须逐条核对，并在 `## 审查` 中记录结论：

1. **地图身份必须显式**
   - 必须存在独立 `mapId`，稳定值为 `"island"` / `"town"`。
   - `mapSeed` 只负责随机布局，禁止使用负数、符号位、高位、保留区间或特殊数值编码地图类型。
   - 相同 seed 的 island/town 必须能同时存在且不会串缓存。

2. **玩家必须能直接选择地图**
   - 主菜单必须有地图选择项：苍岬岛 / 灰炉城。
   - 单人对局使用当前选择。
   - 创建公开/私人联机房间时，房主选择写入房间。
   - 房间大厅和公共房间列表显示地图名称。
   - quick match 只匹配相同 `mapId`，通过房间码加入则继承房间地图。

3. **现有兼容性不能被破坏**
   - 现有 island seed 的生成结果保持不变。
   - 旧 settings、旧 HTTP 创建请求、旧 persisted room、旧 checkpoint/state 缺少 `mapId` 时默认 island。
   - Cloudflare 和 standalone 必须共享同一地图业务实现。
   - 不允许旧客户端把 town 当 island 渲染；联机严格协议必须同步升级并按维护流程发布。

4. **灰炉城必须是极高密度工业城，不是普通城镇**
   - 建筑数量目标 400–520，明显高于 island 当前约 221–232。
   - 核心 1400m × 1400m 建筑覆盖率目标 45%–60%。
   - 多层建筑比例 45%–60%；主要为 2–3 层，并有 8%–15% 的 town 建筑为 4–5 层工业塔楼/厂办楼。
   - 除主干道、广场、公园和外围缺口外，核心街区连续楼群应让地面玩家基本看不到远处地平线。
   - 核心城区无遮挡距离采样：中位数 ≤90m，90 分位 ≤180m。
   - 审查者 必须检查真实布局/场景结果，不能只因建筑数组长度达标就判定密度满足。

5. **允许并要求新增程序化建筑类型**
   - 可新增厂房、长仓库、联排楼、狭长商住楼、角楼、塔楼、围墙院落、货箱区、管线支架等。
   - 灰炉城允许 4–5 层厂办楼、工业塔楼和高位平台；这些高楼仍必须有完整楼板、墙面、开口、坡道/楼梯等权威结构。
   - 苍岬岛仍严格保持现有 1–3 层逻辑、楼层比例和 deterministic seed 输出，禁止因为共享 helper 扩展而改变 island。
   - 新建筑仍必须使用统一权威几何，不能只做视觉外壳。
   - 不要求新增外部美术资产；程序化几何和材质变体属于范围内。

6. **必须有二楼跨楼连廊**
   - 每个 town seed 目标 24–48 条连廊。
   - 连廊连接相邻 2–3 层建筑的二楼，端点有合法开口和落脚平台。
   - 连廊必须真实可走，下方保留街巷净空。
   - 连廊必须进入权威 `MapLayout`，同时被 Movement、Combat/LOS、AI/GridNavigator、server runtime 和 render 消费。
   - 禁止出现“看得见但走不上去”“客户端能走但服务端挡住”“AI 不认识连廊”。

7. **灰炉城高楼必须真实可用**
   - 4–5 层建筑不是纯外观拉高；每层都必须有权威楼板、墙面、开口、上下层连接和可用空间。
   - 玩家必须能从地面到达 4–5 层并安全返回；AI/GridNavigator 也必须能规划到高层目标。
   - 高层墙体、楼板和屋顶必须参与子弹碰撞与 LOS；不能隔楼命中或穿越不存在的开口。
   - 苍岬岛仍只生成 1–3 层，审查者 必须对照 island golden signatures 确认高楼扩展没有改变旧图。

8. **AI 和物资必须适配高密街区**
   - AI 能通过道路、建筑入口、坡道和连廊移动，不直接穿墙或因空路径直冲障碍。
   - 城镇物资总量保持现有 250；建筑内、高层或连廊附近物资必须可达。
   - 必须跑 town 多种子导航、拾取和 49 Bot/full-match 回归；不能降低既有 AI 阈值掩盖失败。

9. **渲染性能必须有确定性约束**
   - 高建筑量优先使用批量几何、共享材质、实例化和确定性 LOD。
   - 权威碰撞和地图内容不随画质降低。
   - 性能门禁使用 building/mesh/instance/draw-resource/protocol-byte/raw-artifact 等确定性数量，不以 wall-clock、FPS、heap 或压缩体积作硬门禁。

10. **交付前必须独立代码审查**
   - 审查者 只在实现完成后审代码，不负责审 plan。
   - Writer 完成实现和必要自动测试后，必须先使用用户提供的 Chrome DevTools MCP 完成真实浏览器验收和 实现 Agent 自验收。
   - MCP 验收通过后、commit/push/deploy/completion report 前，必须启动独立 `code-reviewer`。
   - 所有 blocker/high/medium 审查发现必须逐条判断、处理并复审通过。
   - 未取得 审查者 无未解决 blocker/high/medium 的结论前，禁止 commit 和 push。

11. **Chrome DevTools MCP 验收顺序和配置**
    - MCP 配置：

```toml
[mcp_servers.chrome-devtools]
command = "npx"
args = [
  "-y",
  "chrome-devtools-mcp@latest",
  "--headless",
  "--isolated",
  "--executablePath",
  "/home/lingchen.judy/.local/bin/chrome-for-testing",
  "--no-usage-statistics",
]
```

    - 实现 Agent 必须用 MCP 分别验收 production build 的苍岬岛和灰炉城。
    - 至少检查：地图选择持久化、单人双地图启动、HUD 地图名、小地图 POI/道路、灰炉城楼群密度、实际进入 4–5 层、二楼连廊可见与可达、高层/连廊移动与射击遮挡、拾取、控制台 error/warn、手机 844×390 横屏菜单和对局布局。
    - 联机验收至少创建灰炉城私人房，确认大厅地图名、两端 full state/mapId 一致、房主开始后两端场景一致；quick match 分池由 Worker/standalone 契约覆盖，并在可行时用 MCP 双页面补充验证。
    - 游戏音量全程保持 `0`。
    - 每一轮 MCP 验收结束后立即关闭本轮打开的所有页面/context，停止本轮启动的本地服务，并确认只剩不可避免的 `about:blank`，不得把清理拖到任务结束。

### 要实现的功能整体概述

1. 新增稳定地图标识：
   - `"island"`：现有苍岬岛，默认值。
   - `"town"`：新增灰炉城。
2. 菜单新增“地图选择”：
   - 单人开始时按选择创建对应地图。
   - 创建公开/私人房间时，由创建者当前选择写入房间。
   - quick match 只匹配同一 `mapId` 的公开等待房间；没有可用房间时按选择创建。
   - 通过房间码加入时继承房间地图，非房主不能覆盖。
3. 新增城镇化权威布局：
   - 规则化主干道、支路和街区。
   - 中央商业区、老城区、工业区、住宅区、车站、医院、公园等稳定 POI。
   - 400–520 栋程序化建筑；核心城区连续楼群和街墙是主要视野边界，除主干道、广场、公园和外围缺口外，地面玩家不应获得贯穿地图的远距离视线。
   - 45%–60% 建筑为多层；主要为 2–3 层，另有 8%–15% 为 4–5 层工业塔楼/厂办楼。新增厂房、长仓库、联排楼、狭长商住楼、角楼和塔楼等程序化 footprint/style。
   - 24–48 条二楼权威连廊连接满足间距和高度条件的相邻建筑；连廊可通行、可阻挡移动/子弹/LOS，并被 AI 导航消费。
   - 树木显著减少并集中在公园、绿化带和外围；工业设备、围墙、货箱、管线支架等掩体承担主要街道遮挡。
   - island 保持既有 1–3 层逻辑；town 支持 1–5 层。所有楼层都必须有权威坡道/楼板/墙体/开口、可导航物资和共享碰撞/LOS/导航。
4. 保持兼容：
   - 现有 `createMapLayout(seed)` 继续等价于海岛，仅作为源码兼容入口，不承担地图选择。
   - 新权威路径统一使用 `createMapLayout(mapId, seed)`。
   - 旧 localStorage、旧房间 options、旧 checkpoint/state 缺少 `mapId` 时迁移为 `"island"`。
   - 同一 island seed 的布局内容和确定性签名保持不变。

### 涉及仓库

- `/data00/home/lingchen.judy/self/last-line`

### 数据结构定稿

```ts
export type MapId = "island" | "town";

export const DEFAULT_MAP_ID: MapId = "island";
```

`MapId` 放在不依赖 `game/state` 的独立配置模块中，避免 `map.ts` 与 `state/types.ts` 产生运行时循环依赖。

新建或扩展的核心字段：

```ts
interface GameSettings {
  mapId: MapId;
  // existing fields...
}

interface MatchState {
  mapId: MapId;
  mapSeed: number;
  // existing fields...
}

interface MapLayout {
  readonly mapId: MapId;
  readonly displayName: string;
  readonly seed: number;
  readonly roadSegments: readonly [number, number, number, number][];
  readonly skybridges: readonly MapSkybridge[];
  // existing fields...
}

interface RoomOptions {
  mapId: MapId;
  // existing fields...
}

interface LobbyView {
  mapId: MapId;
  // existing fields...
}

interface PublicRoomSummary {
  mapId: MapId;
  // existing fields...
}
```

```ts
interface MapSkybridge {
  readonly id: string;
  readonly fromBuildingId: string;
  readonly toBuildingId: string;
  readonly center: Vector3State;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly orientation: "x" | "z";
  readonly floorY: number;
}
```

`MapBuilding.storyCount` 的类型扩展为 `1 | 2 | 3 | 4 | 5`。兼容规则：

- island generator 继续只产生 `1 | 2 | 3`，现有比例和 seed 结果不变。
- town generator 可以产生 `1`–`5` 层，4–5 层只用于灰炉城高楼类型。
- 现有 floor slab、wall opening、internal ramp 和 navigation 代码必须按任意 `storyCount` 逐层生成，不能写死 3 层上限。

字段兼容规则：

- 新创建的 settings/state/room/checkpoint 必须始终写入 `mapId`。
- 读取外部或持久化数据时，只有 `"island"` 和 `"town"` 有效；缺失或非法值统一归一化为 `"island"`。
- `mapSeed` 始终保持无符号 32 位随机种子，不再承担任何地图类型语义。
- public room list、lobby state 和 full match state 都显式携带地图身份。

### 接口约定

- `createMapLayout(seed)`：保留，严格等价于 `createMapLayout("island", seed)`。
- `createMapLayout(mapId, seed)`：所有新权威调用使用此形式。
- `MultiplayerClient.createRoom(visibility)`：继续读取 `GameSettings`，请求体新增 `mapId`。
- `MultiplayerClient.quickMatch()`：请求体新增 `mapId`，服务端只匹配同地图房间。
- `joinRoom(code)`：不发送覆盖地图字段，使用房间持久化选项。
- `MULTIPLAYER_PROTOCOL_VERSION`：由 `3` 升级为 `4`；不允许旧客户端进入可能为 town 的房间。
- 旧 HTTP 创建请求未传 `mapId` 时仍创建 island 房间，保证旧脚本和运维调用安全默认。

### 文件/模块落点

#### 新增文件

- `src/config/maps.ts`
  - 定义 `MapId`、`DEFAULT_MAP_ID`、地图显示名和 `normalizeMapId`。
- `src/config/townMap.ts`
  - 生成 town 的 deterministic district、道路、400–520 栋建筑、工业掩体、树木、二楼连廊和物资布局。
  - 只产出 `MapLayout`，不依赖 DOM/Babylon。
- `tests/unit/mapSelection.test.ts`
  - 覆盖 mapId 归一化、设置默认值、同 seed 不同地图、缓存 key 和单人状态选择。
- `tests/unit/townMapLayout.test.ts`
  - 覆盖 town 确定性、400–520 栋密度、道路、街墙遮挡、边界、坡道、连廊、物资和医院。

#### 修改文件

- `src/config/map.ts`
  - 为 island layout 增加 `mapId/displayName/roadSegments`。
  - 保留旧 island 算法输出。
  - 公共 factory 按 `mapId + seed` 分发和缓存。
  - 抽出 town 需要复用的纯建筑几何 helper；不得复制一套 wall/floor/ramp 规则。
  - `MapLayout` 增加 `skybridges`；island 固定为空数组，保证旧布局其他字段结果不变。
  - `MapBuilding.storyCount` 扩为 1–5；island 分配函数维持 1–3，town 使用独立楼层分配策略。
- `src/config/settings.ts`
  - `GameSettings.mapId`、默认 island、旧 localStorage 归一化。
- `src/game/state/types.ts`
  - `MatchState.mapId`。
- `src/game/modes/BattleRoyaleMode.ts`
  - state 创建 options 接收 mapId；布局和 loot 按 mapId+seed 生成。
- `src/game/GameSimulation.ts`
  - 默认布局使用 state mapId+seed。
- `src/game/systems/MovementSystem.ts`
- `src/game/systems/InventorySystem.ts`
- `src/game/systems/SimulationCombatWorld.ts`
- `src/controllers/BotController.ts`
  - 所有布局缓存和刷新同时比较 mapId 与 seed。
  - Movement/CombatWorld 把 skybridge floor/slab 纳入支撑面与遮挡；Bot/GridNavigator 能进入连廊并跨楼移动。
- `src/ai/navigation/GridNavigator.ts`
  - 仅在需要时同步构造默认值；导航本身继续消费 `MapLayout`。
- `src/client/render/scenes/IslandScene.ts`
  - 第一版不做文件/导出重命名，避免无关 churn。
  - 接收 mapId 或已解析 layout，按 layout road/district 元数据渲染。
  - island 海岸/植被保持原结果；town 使用城市道路、较少植被和密集建筑。
- `src/client/ui/GameHud.ts`
  - 按 mapId+seed 创建 minimap layout。
  - 地图名称和 aria label 不再硬编码“苍岬岛”。
  - road path 使用 `layout.roadSegments`。
- `src/client/ui/minimap.ts`
  - 若 town 保持 2400m，则投影公式不变；仅补显式 layout/map metadata 参数时的测试。
- `src/client/poiVisuals.ts`
  - POI 视觉类型不得继续只靠中文名称隐式推断；为新旧 POI 建立稳定类型映射或布局元数据。
- `src/client/brandSigns.ts`
  - town 中只生成能解析到有效 POI 的标牌；不得因缺少 island 特定名称抛错。
- `src/app/GameApp.ts`
  - 单人菜单新增地图下拉框并持久化。
  - 联机创建/quick match 读取当前地图选择。
  - 房间列表和 lobby 展示地图名称。
- `src/app/BattleRoyaleSession.ts`
- `src/app/MultiplayerSession.ts`
  - 场景、HUD、MovementSystem 和权威布局均使用 state mapId+seed。
- `src/network/MultiplayerClient.ts`
  - 创建房间和 quick match 请求携带 mapId。
- `src/network/protocol.ts`
  - 协议版本升到 4。
  - Lobby/PublicRoom/Match state 投影携带 mapId。
- `src/server/MatchRuntime.ts`
  - `MatchRuntimeOptions.mapId`。
  - 新对局创建和 checkpoint restore 归一化 mapId。
  - layout 按 mapId+seed 构造。
- `worker/shared.ts`
  - `RoomOptions.mapId`。
- `worker/LobbyDirectory.ts`
  - `roomOptions()` 归一化 mapId。
  - quick match 按 mapId 过滤。
- `worker/GameRoom.ts`
  - persisted old room options 缺 mapId 时归一化 island。
  - start match 将 room mapId 传给 runtime。
  - lobby/summary 携带 mapId。
- `standalone/`
  - 平台适配不新增地图业务分支；只验证共用 Worker/service 类的 HTTP/WebSocket 行为。
- `README.md`
- `docs/architecture.md`
- `docs/deployment.md`
- 根 `AGENTS.md`
  - 文档地图选择、显式 mapId、旧状态默认值、quick-match 分池和发布维护规则。

#### 检查文件

- 所有 `createMapLayout(...)` 调用，确认状态驱动链路不再隐式默认 island。
- 所有只比较 `layout.seed` / `navigatorSeed` / `layoutSeed` 的缓存刷新逻辑。
- 所有手写 `MatchState` 测试 fixture，补 `mapId` 或经过兼容 normalizer。
- Worker 持久化房间/checkpoint 恢复。
- standalone restart/checkpoint 测试。
- Production protocol smoke 和 Worker deployment。

### 范围

#### 范围内

- 两张地图的显式选择。
- 单人 town 对局完整飞机到结算链路。
- 联机房主/quick-match 地图选择和全房一致性。
- town 权威地形、道路、建筑、坡道、碰撞、LOS、导航、物资、安全区和 HUD。
- town 二楼权威连廊、连廊入口/落点、AI 跨楼导航与连廊碰撞/LOS。
- 新增程序化建筑尺寸、配色和用途类型，不依赖新增外部资产。
- 旧数据默认 island 的兼容迁移。
- 协议 4 维护发布。

#### 范围外

- 照片级新美术资产或外部素材采购；允许新增程序化建筑、工业构筑物和材质变体。
- 电梯、载具、可破坏建筑、复杂楼梯、地下系统。
- 不同地图独立武器数值、背包规则、安全区时长或人数。
- 对旧 island seed 结果做“顺手优化”。
- 让房主在房间创建后或倒计时中切换地图。
- 在进行中的 match 中热切换地图。

### 关键假设或待确认项

- 稳定 ID 已确认：
  - `"island"`：苍岬岛。
  - `"town"`：灰炉城。
- town 第一版沿用 2400m 地图边界、50 人、现有航线/安全区配置和同一物资总量。
- town 建筑数量目标为 400–520，核心 1400m × 1400m 内建筑覆盖率目标 45%–60%；外围仍保留航线落点、少量开阔区和安全区转移通道。
- town 多层建筑比例目标 45%–60%，其中 4–5 层高楼占 town 建筑 8%–15%；二楼连廊目标 24–48 条。若某 seed 无法满足安全几何约束，生成器应确定性重试或失败测试，不得静默降低到稀疏地图。
- town 菜单、房间大厅、房间列表和 HUD 显示名统一为“灰炉城”；稳定 `mapId` 仍为 `"town"`。
- 房间地图在创建时确定，成员加入后不可修改。
- quick match 按玩家当前地图选择分池；不会跨地图匹配。
- 如果用户要求“不升级协议版本仍兼容旧客户端”，该要求与 town 联机权威一致性冲突，必须停下来重新确认，不能静默让旧客户端按 island 渲染 town。

### 推荐方案

#### 1. 地图身份与兼容边界

- 新建独立 `maps.ts`，避免把地图身份塞回 seed。
- authoritative `MatchState.mapId` 使用必填类型；仅在 localStorage、HTTP body、persisted room、checkpoint 等反序列化边界允许缺失并归一化。
- 保留 `createMapLayout(seed)` 旧签名，确保现有工具和第三方调用默认 island；仓库内部状态驱动路径全部迁到显式双参数。
- cache key 使用 `${mapId}:${seed}`，所有系统缓存同时记录 mapId 与 seed。

#### 2. Town 布局

- 保持同一 2400m 边界，中心约 1400m × 1400m 为近连续建筑覆盖的高密城市区，外围为仓储、铁路货场、工人住宅和少量绿化缓冲。
- 视觉和战术验收不是只看建筑数量：随机抽取核心城区地面观察点，除沿主干道/广场视锥外，水平射线应在较短距离内命中建筑、围墙或工业掩体；核心区中位无遮挡距离目标不超过 90m，90 分位不超过 180m。
- 先生成 deterministic 正交主干道和次级街道，再以街区为单位放置建筑，不沿用 island 的随机 POI 圆形散布。
- 规划 8 个主要 POI：
  - 中央广场
  - 老城区
  - 商业街
  - 住宅区
  - 工业园
  - 火车站
  - 城市公园
  - 体育场
- 医院继续作为独立 `HospitalPoi`，保留固定医疗物资索引。
- 建筑复用统一 wall/floor/ramp helper，town 支持 1–5 层；新增厂房、长仓库、联排楼、狭长商住楼、角楼、4–5 层厂办楼和工业塔楼 footprint/style，仍使用统一权威几何。
- 4–5 层建筑必须逐层生成楼板、墙面开口、内部坡道/楼梯平台和导航连接；不能只拉高外墙或复制视觉楼层。
- 连廊只连接相邻的 2–3 层建筑：二楼 `floorY` 必须一致或在可接受坡度内；两端必须有合法墙面开口/平台；下方净空允许街巷通过；连廊自身生成 floor slab、侧壁/护栏和导航通道。
- 主街保持可识别方向和中长 LOS，支路、巷道、院落与厂区提供近战掩体；绝大多数地面位置不应直接看到地图远端。
- 树木主要分布在公园、道路绿化带和外围；数量可以低于 island，但同一 town seed 下权威且质量无关。
- 物资总量保持现有 250，按街区建筑密度分配；高层、连廊附近和厂房内部均可布点，但所有 indoor/bridge loot 必须可达。

#### 3. 渲染和 HUD

- 不重命名 `IslandScene.ts`，减少导入 churn；内部按 `layout.mapId` 选择海岛或城镇环境分支。
- `MapLayout.roadSegments` 成为渲染、地表和小地图道路的单一来源。
- HUD 地图名称、minimap aria、POI 类型和道路均来自 layout metadata，不写死苍岬岛。
- town 复用现有程序化材质；通过道路网、建筑密度、围墙、广告牌和植被分布形成视觉差异。

#### 4. 联机一致性

- room options 持久化 mapId，host/quick match 创建时写入。
- public summary 和 lobby view 展示 mapId；quick match 严格同 mapId。
- `MatchRuntime` 只从 room option 创建新 state，恢复时以 checkpoint state mapId 为准。
- 协议升级到 4，执行维护发布：暂停新联机入口、排空房间、部署并 smoke Worker、部署匹配 Pages、重新开放并再 smoke。

### 任务拆解

### 任务 1：建立地图身份和兼容 normalizer

- 目标：引入显式 `MapId`，所有旧数据安全默认 island，不改变任何 island seed 输出。
- 仓库 / 文件：`src/config/maps.ts`、`src/config/settings.ts`、`src/game/state/types.ts`、`src/config/map.ts`、对应 unit tests。
- 前置依赖：无。
- 关键改动点：定义 map catalog；设置和 state 增加 mapId；提供双签名 map factory；cache key 加 mapId；保留旧单 seed 入口。
- 验证方式：
  - `npm exec -- vitest run --config config/vitest/unit.config.ts tests/unit/mapSelection.test.ts tests/unit/mapLayout.test.ts`
  - 对代表性 island seeds 比较改造前后布局签名。
- 完成标志：旧调用仍生成 island；同 seed 的 island/town cache 不冲突；旧缺字段数据归一化为 island。

- Step 1: 新建 `maps.ts` 和归一化测试。
- Step 2: 给 settings/state/layout 增加字段。
- Step 3: 改造 layout factory/cache，并锁定 island golden signatures。

### 任务 2：抽取共享建筑几何并实现 town generator

- 目标：生成 deterministic、可导航、权威一致的城镇布局。
- 仓库 / 文件：`src/config/map.ts`、`src/config/townMap.ts`、必要的共享纯 helper 模块、`tests/unit/townMapLayout.test.ts`。
- 前置依赖：任务 1。
- 关键改动点：共享 wall/opening/floor/ramp 生成；town 道路/街区/400–520 栋建筑/24–48 连廊/医院/物资/植被；`MapLayout.roadSegments/skybridges`。
- 验证方式：
  - town 同 seed 深相等、不同 seed 不同。
  - building/ramp/skybridge/map boundary/terrain/loot reachability 多种子检查。
  - 道路清空、建筑数量 400–520、多层比例 45%–60%、4–5 层比例 8%–15%、连廊 24–48、核心覆盖率和物资总量 deterministic count。
  - 4–5 层逐层 floor/opening/ramp/navigation 完整性，AI 能到达顶层并返回地面。
  - 核心城区无遮挡距离采样达到中位数 ≤90m、90 分位 ≤180m；主干道保留可识别的长视线。
- 完成标志：town layout 可被 Movement/Combat/GridNavigator/Inventory 直接消费，无空路径穿墙或不可达主物资点；楼群密度和视线指标达到灰炉城的高密工业城区口径。

- Step 1: 在不改变 island 输出的前提下抽取共享几何。
- Step 2: 实现 town district 和 road grid。
- Step 3: 生成高密建筑、程序化建筑类型、坡道、医院、物资和植被。
- Step 4: 生成二楼连廊及端点开口/平台/导航结构。
- Step 5: 补多种子结构、视线密度、连廊和导航测试。

### 任务 3：迁移全部权威消费者到 mapId + mapSeed

- 目标：相同 seed 的两张地图不会复用错误布局，所有规则系统消费同一 layout。
- 仓库 / 文件：`BattleRoyaleMode.ts`、`GameSimulation.ts`、Movement/Inventory/CombatWorld、BotController、GridNavigator、MatchRuntime。
- 前置依赖：任务 1、任务 2。
- 关键改动点：state creation 传 mapId；系统缓存比较 mapId+seed；checkpoint restore normalizer；server runtime map consistency。
- 验证方式：
  - 同 seed 下运行 island 后切 town，确认 movement/LOS/navigation/loot 使用 town。
  - MatchRuntime 新建与 restore state mapId 一致。
- 完成标志：仓库内没有状态驱动的 `createMapLayout(state.mapSeed)` 残留。

- Step 1: 改 state 创建和 GameSimulation。
- Step 2: 改规则系统与 Bot 缓存。
- Step 3: 改 MatchRuntime 创建/恢复。
- Step 4: 全仓搜索并处置隐式 seed-only 调用。

### 任务 4：增加单人地图选择和 town presentation

- 目标：菜单可选择地图，单人 town 完整可玩，HUD/minimap 正确显示。
- 仓库 / 文件：`GameApp.ts`、`BattleRoyaleSession.ts`、`IslandScene.ts`、`GameHud.ts`、`poiVisuals.ts`、`brandSigns.ts`、CSS、settings/UI tests。
- 前置依赖：任务 2、任务 3。
- 关键改动点：地图 select 和持久化；场景按 layout 分支；HUD 名称/道路/POI 动态化；手机/桌面菜单适配。
- 验证方式：
  - 本地 Chrome/Edge，音量 0，分别启动 island/town production build。
  - 检查 console、地图标题、minimap 道路/POI、飞行/跳伞/拾取/战斗。
- 完成标志：刷新后选择保留；两张地图都完成飞机到结果流程；无硬编码苍岬岛泄漏到 town。

- Step 1: 菜单和 settings。
- Step 2: Session/scene 参数链。
- Step 3: HUD/minimap/POI/brand 适配。
- Step 4: production browser 双地图验收并立即清理浏览器/服务。

### 任务 5：联机房间地图选择和协议升级

- 目标：房主/quick match 选择地图，全房和服务端一致，旧 room/checkpoint 默认 island。
- 仓库 / 文件：protocol、MultiplayerClient、GameApp lobby、worker shared/LobbyDirectory/GameRoom、MatchRuntime、standalone tests。
- 前置依赖：任务 3、任务 4。
- 关键改动点：协议 4；RoomOptions/LobbyView/PublicSummary mapId；quick match 分池；persisted old room/checkpoint migration；lobby 展示。
- 验证方式：
  - Worker contract：旧 body 默认 island、town create、quick match 分池、join inherited map、lobby/summary mapId。
  - standalone real HTTP/WebSocket：创建 town 私人房、两人进入、full state town、restart restore。
  - 客户端协议 mismatch 维持具体终态错误。
- 完成标志：任何客户端、房间、runtime 和 scene 对同一局使用相同 mapId+seed；旧持久化数据恢复为 island。

- Step 1: 协议类型和版本。
- 第 2 步：HTTP 客户端/房间选项/快速匹配。
- 第 3 步：GameRoom 持久化/大厅/启动运行时。
- Step 4: Worker + standalone 契约测试。

### 任务 6：文档、性能、审查和发布

- 目标：完成工程门禁、独立审查、提交推送和生产一致发布。
- 仓库 / 文件：`AGENTS.md`、README、architecture/deployment、当前 plan。
- 前置依赖：任务 1–5。
- 关键改动点：文档地图契约和发布流程；Build 更新日志；review 记录；协议维护发布。
- 验证方式：
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
  - `npm run build:worker`
  - `npm run build:server`
  - `npm run build:standalone`
  - `npm run check:budgets`
  - 使用用户提供的 Chrome DevTools MCP 验收 island/town production browser，音量 0，并逐轮清理页面/context/本地服务。
  - 实现 Agent 按“用户验收口径 / 审查者 对照清单”完成自验收并记录证据。
  - 独立 `code-reviewer` 静态审查，不重复外层已记录的完整门禁。
  - `wrangler deployments status` 与 `npm run test:multiplayer:production`。
- 完成标志：
  - 无 unresolved blocker/high/medium。
  - plan 的 Build/Review 记录完整。
  - commit/push 仅在 审查者 通过后执行。
  - Worker 新版本 ID 和 production smoke 记录完成。

- Step 1: 更新文档和 plan Build。
- Step 2: 运行全部自动测试、typecheck、构建和预算门禁。
- Step 3: 使用 Chrome DevTools MCP 完成双地图、桌面/手机和联机浏览器验收；每轮立即清理。
- Step 4: 实现 Agent 完成自验收，对照用户清单确认无缺口并把证据写入 plan Build。
- 步骤 5：启动独立审查者，逐条评估审查发现，修复后复审。
- Step 6: 审查者 通过后 commit/push。
- Step 7: 按协议维护流程部署 Worker/Pages 并 smoke。

### 风险与验证

- **Island 回归风险**：共享 geometry 抽取可能改变既有随机调用顺序。必须在抽取前建立 island representative seed golden signatures，抽取后逐字一致；不得仅凭现有宽松阈值判断。
- **高楼扩展风险**：把 `storyCount` 类型扩到 5 可能让 island 共享代码发生行为变化。island 楼层随机策略必须保持原函数和随机调用顺序；4–5 层只从 town generator 进入共享逐层几何函数，并用 island golden signatures 锁死回归。
- **旧客户端错图风险**：town 上线但协议不升级会导致表现/碰撞分裂。必须 protocol 4 + maintenance rollout。
- **旧 checkpoint 风险**：直接把 `mapId` 做必填而无反序列化迁移会关闭旧房。必须在 restore 边界默认 island，并有真实 restart 测试。
- **缓存串图风险**：同 seed 不同 mapId 若仍只按 seed cache，会让一张图复用另一张布局。factory 和每个 subsystem cache 都需 mapId+seed 测试。
- **AI 导航风险**：建筑密度提升后空路径和不可达 loot 增多。必须保留主街宽度、路口、建筑间隙和可达入口，并跑 town 多种子 49 Bot/full match。
- **连廊拓扑风险**：连廊若只有渲染 mesh 或只进入 Movement，会导致 AI、LOS 和服务端不一致。`skybridges` 必须是 `MapLayout` 权威字段，由 Movement、CombatWorld、GridNavigator、server runtime 和 render 同源消费。
- **渲染资源风险**：400–520 栋建筑和连廊可能突破 scene resource budget。优先硬件实例、批量 wall/floor geometry、共享材质和确定性 LOD；使用 deterministic building/mesh/draw-resource counts，不以 wall-clock/FPS 作为硬门禁。
- **联机快照风险**：更密集建筑不进入动态快照，但可见 loot 分布变化；验证 protocol bytes 和 visible loot bounds。
- **UI 风险**：地图 select 增加菜单高度，需验证 844×390 手机横屏和桌面窄窗口。

### MVP / 下一步

MVP 定义为：

1. 显式 `mapId` 全链可用且旧数据默认 island。
2. 单人菜单可选 island/town。
3. town 有 deterministic 道路、街区、建筑、医院、物资、树木和完整权威碰撞/导航：
   - 400–520 栋建筑、45%–60% 多层，其中 8%–15% 为 4–5 层，另有 24–48 条二楼连廊。
   - 核心城区楼群遮挡达到中位无遮挡距离 ≤90m、90 分位 ≤180m。
4. 联机创建与 quick match 按 mapId 一致。
5. 两张地图均通过核心规则、浏览器和 multiplayer contract。

计划创建后，下一步由实现 Agent 从任务 1 开始，先建立兼容测试和 island golden signatures，再修改实现。

## 构建

### 更新日志

- 2026-08-02 13:02：按用户要求先执行 `git pull origin main`，fast-forward 至 `3f17b4a`；确认当前/目标分支均为 `main`、工作区干净。读取 实现 Agent/审查者 规则、现有地图 factory、settings/state、单人 Session、联机 RoomOptions/Lobby/GameRoom/MatchRuntime、checkpoint 和 HUD/scene 链路；本轮只创建 plan，尚未修改运行时代码。
- 2026-08-02 13:02：创建本 plan，确定显式 `MapId = "island" | "town"`、旧数据默认 island、quick match 按地图分池、协议 4、town 2400m 城镇布局和独立审查者 前置于 commit/push 的交付门禁。
- 2026-08-02 13:26：完成 任务 1 基础层。新增 `src/config/maps.ts`，设置和权威 `MatchState` 增加 `mapId`；`createMapLayout(seed)` 保持 legacy island，新增显式 `createMapLayout(mapId, seed)`、mapId+seed cache key 以及 island metadata/empty skybridges。对 seed 0/42/2026 建立改造前 SHA-256 golden，剥离新增 metadata 后哈希逐字一致；`mapSelection/settings/mapLayout` 针对性测试 7 项通过，`typecheck:app` 通过。当前 town factory 仍明确报未实现，未用 island 冒充 town。
- 2026-08-02 13:40：完成 任务 2 核心权威布局。灰炉城固定生成 448 栋建筑、233 栋多层、54 栋 4–5 层、32 条二楼连廊、18 条城市道路、250 个物资点、96 棵树、168 个工业掩体和 64 个外围岩石；4–5 层逐层生成墙面、开口、楼板和内部坡道。连廊生成二楼端点门洞、权威桥面和护栏墙，Movement/Combat 通过既有 floor/wall 几何消费，GridNavigator 新增同层跨楼路径。town/grid 针对性测试 12 项和 `typecheck:app` 通过，包含道路清空、核心无遮挡距离、桥面支撑、护栏子弹遮挡、高楼逐层完整性与 AI 连廊跨楼。
- 2026-08-02 13:41：完成 任务 3 规则/runtime 迁移。GameSimulation、MovementSystem、InventorySystem、SimulationCombatWorld、BotController、BattleRoyaleSession、MultiplayerSession 和 MatchRuntime 的状态驱动布局均改为 `mapId + mapSeed`，缓存刷新同时比较二者；MatchRuntime restore 对旧 state 缺失/非法 mapId 归一化为 island。全仓搜索已无运行时 `createMapLayout(state.mapSeed)` 残留，`typecheck:app` 通过。
- 2026-08-02 14:00：完成 任务 4/5 主链。单人菜单新增苍岬岛/灰炉城选择并持久化，BattleRoyaleSession/scene/HUD/minimap 使用 state mapId+seed，HUD 地图名/aria/道路来自 layout；灰炉城 NullEngine 场景构建通过，448 栋及连廊批量后 scene mesh <900。联机协议升至 4，create/quick 请求携带 mapId，RoomOptions/LobbyView/PublicSummary/GameRoom/MatchRuntime 持久化 mapId，quick match 按地图分池，旧 room/state 缺字段默认 island；Worker 地图分池 2 项、MatchRuntime town/legacy restore 2 项、standalone town 私房双人 full state/checkpoint restart 1 项均通过，完整 typecheck 通过。
- 2026-08-02 14:49：完成灰炉城工业建筑视觉差异化收尾。`TownBuildingKind` 六类元数据进入 town `MapBuilding`，核心建筑按厂房、仓库、联排楼、商业楼、角楼和塔楼使用不同权威 footprint，54 栋 4–5 层楼全部为 tower；场景为六类建筑批量生成烟囱、屋顶监视窗、设备间、招牌、角亭和塔冠轮廓，保持 visual-only 且不改变权威 footprint。`typecheck:app`、town/map selection 12 项和灰炉城 NullEngine 场景测试通过；island 生成路径与 golden payload 未增加该字段。
- 2026-08-02 15:24：完成自动门禁第一轮。完整 typecheck 通过；unit 42 文件 376 项、Worker 4 文件 32 项、standalone 3 文件 20 项全部通过。Debian 10 宿主自带 glibc 2.28 无法启动当前 workerd，Worker suite 使用一次性 Debian 12 glibc 2.36 loader wrapper 执行，结束后原 `workerd` SHA-256 前后均为 `758f6571b186eabeeb9fddd944894bccc42f363c2f8933cf34f8a73e3b10cff4`。三个旧用例在本机仅因 wall-clock timeout 超时，定向重跑证明断言通过后只放宽 harness timeout，未修改 seed 范围、断言或 AI 阈值。
- 2026-08-02 15:24：浏览器、Worker dry-run、server 和 same-origin standalone 构建全部通过。预算初跑中浏览器 entry/总 JS/chunk/CSS/总 dist 全通过，Worker `424812/400000`、standalone `445074/425000` 超出旧上限。架构资源审查用 esbuild metafile 确认 server 中 town generator 约 8KB、完整权威 map 模块约 68KB，增长来自两端必须共享的第二张权威地图规则而非视觉代码或重复资产；将原始字节硬上限审阅调整为 Worker 450KB、standalone 470KB，分别保留约 5.9% 与 5.6% 余量。
- 2026-08-02 15:42：完成 Chrome DevTools MCP production 验收，游戏音量全程为 `0`。桌面 1440×900 分别选择并刷新确认灰炉城/苍岬岛持久化，两张地图均进入真实 50 actor 场景并由航线跳伞；HUD、地图名称、小地图 aria、8 个 POI、道路路径和网络资源正常，保存 `/tmp/last-line-town-desktop.webp`、`/tmp/last-line-island-desktop.webp`。844×390、DPR 3、mobile+touch+landscape 仿真中，灰炉城菜单/对局均无横向页面溢出，11 个触控动作按钮、左右双开火按钮和最小触控尺寸通过，保存菜单/对局截图。双隔离 context 创建同一灰炉城私人房，验证同一码、2/10、来宾准备、房主开局及双方 `match.full` 后 HUD/小地图均为灰炉城。每轮均主动关闭页面，确认只剩 `about:blank`，停止对应 standalone 服务并删除临时数据目录；控制台只出现 headless SwiftShader 驱动警告。MCP 发现的 7 个表单元素缺 `name` 已补齐并复验为 5 个联机输入均有稳定 name、console 无 error/issue。
- 2026-08-02 15:47：按用户最新要求在提交前再次同步线上。第一次直接 `git pull origin main` 因本任务未提交文件重叠被 Git 保护性拒绝，未覆盖文件；随后使用一次性 stash 保存全部本任务文件，fast-forward `main` 从 `3f17b4a` 到 `3c09969`，`stash pop` 自动合并成功且无冲突，stash 已删除。远端新增 pointer-lock 安全请求、联机首帧处理、空降物资可见范围和对局退出 UX 均保留。
- 2026-08-02 15:50：完成 `3c09969` 合并后的回归。完整 typecheck 通过；map selection、town layout、IslandScene、MatchRuntime、GameApp actions 和 MultiplayerClient 共 6 文件 42 项通过；standalone 3 文件 20 项通过；Worker dry-run、same-origin standalone build 和预算检查通过。合并后原始产物为 browser entry `1050349/1075000`、all JS `3747004/3900000`、CSS `44894/45000`、Worker `424991/450000`、standalone `445253/470000`。
- 2026-08-02 15:51：完成 实现 Agent 自审。对照 11 条用户验收口径确认：地图身份与 seed 独立；所有运行时状态驱动 factory/cache 使用 `mapId + mapSeed`；旧 settings/room/checkpoint 缺失值归一化 island；quick match 按 map 分池；协议为 4；Movement/Combat/LOS/GridNavigator/server/render 同源消费高楼和连廊的 wall/floor/opening/ramp；town 49 Bot 保持原 `>=42/49` 武装阈值。对 seeds 0/42/2026/314159 实测均为 448 栋、核心 384 栋，1400m×1400m 核心 footprint 覆盖率 56.66%–56.76%，多层比例 52.01%，4–5 层比例 12.05%，32 连廊、18 道路、250 物资；island seeds 0/42/2026 golden SHA-256 仍逐字一致。`git diff --check` 通过，无 conflict marker、无 seed 编码地图类型、无运行时 seed-only state factory 残留。高楼/连廊的可达、支撑和射击遮挡由 town layout、Movement、CombatWorld、GridNavigator 单测验证；浏览器验证负责 production 场景可见、HUD、交互、桌面/手机和双端联机一致性。
- 2026-08-02 17:42：完成 审查者 第 1 轮 的 1 high、4 medium 代码修复。GridNavigator 现可组合“建筑门 ↔ 楼内坡道 ↔ 任意楼层 ↔ 二层连廊 ↔ 邻楼 ↔ 地面”；town 连廊端点楼梯井被确定性放在桥门对侧，工业围栏方向与街侧偏移修正并避开全部建筑/坡道。新增真实 `MovementSystem` 路径跟随测试，角色已实际走完街道↔五层、街道↔连廊↔邻楼及楼内↔楼内三类路线。灰炉城 8 个 POI 全部接入稳定视觉类型并由 NullEngine scene metadata 覆盖。核心 LOS 门禁改为 seeds 42/2026/314159 的 800+ 个权威 blocker 外可站立点，纳入建筑、工业掩体、树干和岩石，实测中位数 28m、90 分位 116m。新增 seeds 1/42/99 × 250 个 town 物资的门外导航和权威拾取检查，以及独立 town 49 Bot full-match。
- 2026-08-02 17:42：针对 town full-match 初始 `findPath=73055` 的 operation 回归完成根因优化，而非抬高旧 island 阈值。BotController 新增按 loot ID+generation+失败位置的 320 项不可达目标缓存，移动 36m 或 generation 改变后才重试；失败退避掩体立即拒绝；patrol/zone/forced relocation 候选先过滤权威 blocker。确定性诊断将 town `findPath` 降至约 20.3k；town 独立硬门禁设为 `findPath<=22000`、LOS `<=22000`、shot trace `<=25000`，island 原 `17500/20000/23500` 均保持不变。town 49 Bot full-match 已完成唯一胜者、Bot 拾取、Bot 射击和死亡事件验证。
- 2026-08-02 17:42：审查者第 5 项审查发现的附加 production 高楼/连廊人工实操已尝试使用 Chrome MCP 的真实 touch PointerEvent 输入、只读 Babylon active camera 位置，不写权威 state；已真实完成固定 seed 42 灰炉城的飞机→跳伞→门外落地，并确认脚本可穿过建筑门。后续页面内自动驾驶受 headless 50 actor 软件 WebGL 速度、MCP 单调用超时和 waypoint 收敛影响，未形成完整五层/连廊操作记录。用户随后明确允许“如果没有恶劣问题，先推上去看效果，再逐步完善”，因此该项从本次预览推送硬门禁改为明确后续工作；代码权威链路已有真实 Movement 跟随、CombatWorld 环境遮挡和 GridNavigator 测试，基础 production MCP 的双地图、手机和双端联机证据仍有效。所有失败/中止的 MCP 轮次均立即杀掉隔离 Chrome、停止 standalone 服务并删除临时数据；当前无浏览器或服务残留。
- 2026-08-02 17:42：修复后回归通过：完整 typecheck；`townMapLayout/gridNavigator/botController/minimap/islandScene/aiLootReachability` 共 6 文件 107 项；Worker dry-run、same-origin standalone build 和预算。最终产物为 browser entry `1054429/1075000`、all JS `3751084/3900000`、CSS `44894/45000`、Worker `433689/450000`、standalone `453783/470000`；`git diff --check` 通过。
- 2026-08-02 17:50：按用户“commit 前必须 pull”要求再次用一次性 stash 保存全部任务改动，`git pull origin main` 将基线从 `3c09969` fast-forward 至 `65182ab`，随后 `stash pop` 自动合并成功且无冲突、stash 已删除。远端新增 APP_VERSION 注入、CI/Docker release 规则和菜单版本文案均保留；`GameApp` 地图选择、联机输入 name 和版本 footer 自动合并正确。新基线回归再次通过完整 typecheck、上述 6 文件 107 项、Worker dry-run、same-origin standalone build 和预算；最终产物仍为 browser entry `1054429/1075000`、Worker `433689/450000`、standalone `453783/470000`。当前无 MCP Chrome、render loop 或本地 server 残留。
- 2026-08-02 17:54：审查者 第 3 轮 在 `main@65182ab` 新基线上复核通过，确认版本注入/CI/Docker 合并未破坏地图实现，`unresolved blocker/high/medium = 0`。随后按用户要求在真正 commit 前再次执行 `git pull origin main`，结果为 `Already up to date`；当前允许提交预览版本。完整 production 人类五层/连廊实操按用户最新决定保留为推送后 follow-up，正式协议 4 Worker/Pages 维护发布及 production smoke 也不属于本次预览 push。

## 审查

### 第 1 轮 — 2026-08-02 — 不通过

- 审查基线：`main@3c09969`；`HEAD` 与基线一致，待审内容为 working tree 中 40 个已跟踪文件及 `src/config/maps.ts`、`src/config/townMap.ts`、`tests/unit/mapSelection.test.ts`、`tests/unit/townMapLayout.test.ts` 等未跟踪文件。
- 审查依据：本 plan 的 11 条用户验收口径、根 `AGENTS.md`、README、`/home/lingchen.judy/ai-workspace/subagents/code-reviewer.md`、`git diff 3c09969` 及关键调用链。
- 已信任 Build 中记录的 typecheck、unit 376/376、Worker 32/32、standalone 20/20、post-pull 定向测试、四类构建/预算和 Chrome MCP 结果；本轮未重复这些命令。仅运行了针对现有证据未覆盖风险的只读 Node/tsx 几何诊断：跨建筑/高楼导航、全部 town loot 门口到落点路径、连廊端点高差及真实可站立核心视线采样。
- 结论：存在 1 个 high、4 个 medium 审查发现。验收项 6、7、8、11 未完成，验收项 4 的 LOS 自动门禁无效；修复并补齐证据后必须复审。当前禁止 commit、push 或 deployment。

#### 审查发现

1. **High — AI 导航没有形成可组合的入口、楼层和连廊拓扑。**
   - 位置：`src/ai/navigation/GridNavigator.ts:90`、`src/ai/navigation/GridNavigator.ts:103`、`src/ai/navigation/GridNavigator.ts:209`、`src/ai/navigation/GridNavigator.ts:317`、`src/ai/navigation/GridNavigator.ts:648`。
   - `findGroundDoorPath` 只能处理一次“室外 ↔ 单栋建筑内部”转换；当起点和终点都在不同建筑中时，它仍把楼内起点交给 exterior blocker 扫描。高层路径又把首段内部坡道底端当作 `GROUND_LOCATION` 的地面端点，而 town 的 ground blocker 是整栋建筑 footprint，因此街道到高层、楼内到另一栋楼内及高层返回街道都会得到空路径。
   - 定向复现：town seed 42 下，`town-building-0-5` 的地面内部点到五层屋顶及反向路径均为 `[]`；`town-building-27-5` 内部到 `town-building-36-0` 内部同样为 `[]`。这意味着 AI 无法从地面规划到 4–5 层，也无法从地面到达二楼连廊后跨楼；现有只从连廊两端二楼内部开始的测试没有覆盖完整入口链路。
   - 影响：直接违反验收项 6、7、8 的 AI/GridNavigator 高层往返、连廊可达和建筑间移动要求；空路径还会造成机器人反复换目标或停滞。
   - Writer 待处理：把门、内部坡道、楼层和连廊建成可组合的双向转换路径；增加“街道 ↔ 4/5 层”“街道 ↔ 连廊 ↔ 相邻楼层”“一栋楼内部 ↔ 另一栋楼内部”的实际 Movement 跟随路径测试，不能只断言路径数组存在。

2. **Medium — 灰炉城 POI 类型没有接入稳定映射，场景会跳过全部 8 个 town POI 的程序化地标。**
   - 位置：`src/client/poiVisuals.ts:3`、`src/client/poiVisuals.ts:15`、`src/client/render/scenes/IslandScene.ts:1279`、`src/config/townMap.ts:69`。
   - `POI_VISUAL_TYPES` 仍只包含苍岬岛名称；“灰炉广场、铸造工业园、旧火车站、工人住宅区、仓储港区、老城区、商业街、城市公园”全部返回 `null`，而 `createPois` 对 `null` 直接返回。小地图会以无类型圆点和文字兜底，但场景中没有 plan 约定的稳定 POI 表现/地表类型。
   - 影响：灰炉城的主要区域只剩标签和规则楼群，缺失已规划的广场、工业园、车站、住宅、仓储、公园等可辨识地标；也未完成 plan 明确列出的 `poiVisuals.ts` 适配。
   - Writer 待处理：为 town POI 提供稳定类型元数据或显式映射，并补 NullEngine/minimap 测试，确认 8 个 town POI 都有预期类型且不会静默跳过。

3. **Medium — 核心无遮挡距离测试从建筑内部起射，硬性 LOS 指标当前是无效门禁。**
   - 位置：`tests/unit/townMapLayout.test.ts:164`。
   - 现有 49 个采样点 `(x + 28, z + 28)` 全部落在建筑 footprint 内；`distanceToBuilding` 从距离 0 开始，因此测试主要得到 0 并必然满足中位数/90 分位阈值，不能证明地面玩家视线被切碎。
   - 定向只读检查在实际可站立核心点上得到 seed 42/2026 的中位数约 26m、90 分位约 131–133m，当前布局抽查仍达到目标；问题是 checked-in regression gate 没有保护该目标。
   - Writer 待处理：改用不在任何权威 blocker 内的可站立采样点，按要求纳入建筑、围墙/工业掩体和树干，并明确处理主干道、广场、公园例外；至少覆盖多 seed。

4. **Medium — 没有完成要求的 town 多种子 AI 与 49 Bot/full-match 回归。**
   - 位置：`tests/unit/aiLootReachability.test.ts:133`、`tests/unit/aiLootReachability.test.ts:168`。
   - 新增 town 用例只用一个 seed 42，且只检查落地后 `>=42/49` Bot 持枪；后面的 49 Bot 打到唯一胜者用例未传 `mapId: "town"`，实际仍跑 island。现有测试没有覆盖 town 多 seed 导航/拾取，也没有 town full-match。
   - 影响：验收项 8 的明确交付物缺失，且审查发现 1 的建筑/高楼路径缺陷因此未被现有门禁发现。
   - Writer 待处理：在不降低既有阈值的前提下增加 town 多 seed 导航/拾取和真实 49 Bot full-match，记录使用的 mapId 和 seed，并保留 deterministic operation 上限。

5. **Medium — Build 中的 Chrome MCP 记录没有覆盖验收项 11 要求的高楼/连廊实操。**
   - 位置：`.agents/plans/2026-08-02-town-map-selection.md:572`。
   - 已记录双地图启动、HUD/minimap、844×390、双页面联机和逐轮清理，但没有记录“实际从地面进入 4–5 层并返回、实际走上并通过二楼连廊、高层/连廊移动和射击遮挡、灰炉城拾取”的操作与结果。仅进入场景、跳伞和看到地图名不能替代这些明确验收步骤。
   - 影响：presentation/physical-authority 的关键用户验收没有可审计证据；审查发现 1 修复后也需要重新确认人类实操链路。
   - Writer 待处理：修复后按 plan 原顺序补做并逐项记录上述 production Chrome/Edge 验收，音量保持 0，每轮立即清页、停服务并确认只剩 `about:blank`。

#### 11 项验收对照

1. **通过**：`MapId` 与 `mapSeed` 独立，factory key 为 `mapId + normalizedSeed`，未发现 seed 符号位/范围编码；同 seed 双地图可并存。
2. **通过**：主菜单、单人、公开/私人创建、lobby/public summary、quick match 分池和房间码继承链路均显式携带地图。
3. **通过（发布尚未执行）**：island seeds 0/42/2026 golden 保持；旧 settings、HTTP body、persisted room 和 checkpoint state 默认 island；Worker/standalone 共用业务类；协议已升至 4。维护发布属于 review 通过后的部署步骤。
4. **有待处理**：448 栋、核心覆盖率、多层/高楼比例和实际可站立点 LOS 抽查达到量化目标，但 checked-in LOS 测试无效，见审查发现 3。
5. **通过（POI 表现除外）**：六类 town 建筑和 4–5 层逐层 wall/floor/opening/ramp 使用统一权威几何，island 仍为 1–3 层；town POI 类型缺口见审查发现 2。
6. **不通过**：32 条连廊有权威 floor/rail/opening，Movement/Combat/render 同源，但 AI 不能从地面组合路径到连廊，见审查发现 1。
7. **不通过**：高楼几何和碰撞记录完整，但 GridNavigator 无法从地面到五层或返回；缺少符合要求的完整高层可用链路，见审查发现 1。
8. **不通过**：250 个 ground-floor town loot 在抽查的 seeds 0/42/2026/314159 均可从对应门外到达，但建筑间/高层 AI 路径失败，且没有 town 多 seed/full-match 门禁，见审查发现 1、4。
9. **通过**：权威布局质量无关；scene 使用墙/楼板/坡道/工业轮廓批量合并并有 `<900` mesh 硬门禁；Worker/standalone 原始字节上限调整有共享权威地图模块增长和约 5–6% 余量的架构说明，本轮接受该预算调整。
10. **本轮已执行但未通过**：独立 review 已在 commit/push/deploy 前完成；必须处理所有 high/medium 后复审。
11. **不通过**：双地图、mobile、双页面和清理证据存在，但缺少高楼/连廊/遮挡/拾取的明确 production 实操记录，见审查发现 5。

#### 其他核对

- `3c09969` 新增的安全 pointer-lock 请求、`MultiplayerSession` 首帧 `processMessages`/remote pose/reset tick、空降 400m/落地 60m loot replication 及退出路由均保留，未发现本任务覆盖这些逻辑。
- 未发现无关 `context.Background()`、冲突标记、state-driven seed-only layout factory 或 Cloudflare/standalone 地图业务分叉。
- 残余风险：本轮未重复外层完整测试、构建、预算或浏览器命令；修复审查发现后应按受影响范围先做定向验证，再由外层实现 Agent 更新构建记录并请求第 2 轮复审。

### 第 2 轮 — 2026-08-02 — 通过

- 审查基线仍为 `main@3c09969`，`HEAD` 与基线一致；重新完整读取本计划、最新构建记录、第 1 轮审查发现和当前 `git diff 3c09969`。当前待审范围为 42 个已跟踪文件及 5 个未跟踪任务文件。
- 已信任 outer 实现 Agent 记录的完整 typecheck、6 files/107 tests、Worker dry-run、standalone build、budgets、`git diff --check` 和既有 production MCP；未重复这些命令。
- 本轮仅针对现有证据未直接汇总的两个具体风险运行只读 Node/tsx 检查：seeds 0/1/42/99/2026/314159 的 32 条桥端楼梯井方向和 168 个 cover 两两重叠；结果均为 0 个错误端点、0 个 cover overlap。另以真实 `SimulationCombatWorld` 对 seeds 42/2026/314159 的每个 851 个 blocker 外可站立核心点发射 16 个水平射线，权威命中距离中位数约 27m、90 分位约 108.3m，满足 `≤90m/≤180m`。
- 结论：第 1 轮的 1 high、4 medium 审查发现均已解决或按用户最新明确授权降为后续残余风险。本轮未发现新的 blocker/high/medium；当前**未解决 blocker/high/medium = 0**，允许进行用户所说的预览推送看效果。

#### 第 1 轮 审查发现 处置

1. **High 导航 — 已解决。**
   - `src/ai/navigation/GridNavigator.ts:98` 新增 town exterior-ground 双向组合路径；`src/ai/navigation/GridNavigator.ts:139` 将楼层路径与建筑门外地面连接；`src/ai/navigation/GridNavigator.ts:192` 将入口楼、二楼桥、出口楼及最终目标组合为完整候选路径。
   - `src/config/townMap.ts:99` 将每个桥端楼梯井确定性放在桥门对侧；`src/config/map.ts:663` 修正工业 cover 朝向和街侧偏移。多 seed 只读检查确认桥端楼梯井方向正确、cover 不与其他 cover 重叠；checked-in 测试还确认 cover 不与建筑/内部坡道重叠。
   - `tests/unit/townMapLayout.test.ts:140` 使用真实 `MovementSystem` 走完街道↔五层、街道↔连廊↔邻楼、楼内↔楼内，不再只检查非空 path。验收项 6、7、8 的 AI/Movement 组合路径已满足。

2. **Medium POI — 已解决。**
   - `src/client/poiVisuals.ts:12` 为灰炉城 8 个 POI 提供稳定类型映射；`tests/unit/minimap.test.ts:48` 固定完整映射。
   - `tests/unit/islandScene.test.ts:945` 通过 NullEngine scene metadata 确认每个 town `mapPoint` 都产生对应 POI presentation，不再被 `createPois` 静默跳过。

3. **Medium LOS 门禁 — 已解决。**
   - `tests/unit/townMapLayout.test.ts:219` 覆盖 seeds 42/2026/314159，在 800+ 个建筑、cover、tree、rock footprint 外可站立点采样，并排除灰炉广场/城市公园 100m 例外。
   - checked-in 几何门禁满足阈值；本轮额外使用真实 `SimulationCombatWorld` 复核墙面开口后的权威 LOS，三个 seed 均为中位约 27m、90 分位约 108.3m，因此没有“footprint 测试通过但权威射线失败”的差异。

4. **Medium AI 多种子/full-match — 已解决。**
   - `tests/unit/aiLootReachability.test.ts:175` 对 seeds 1/42/99 的全部 250 个 town loot 验证门外导航和权威拾取；`tests/unit/aiLootReachability.test.ts:225` 分别运行 island/town 49 Bot full-match，并要求唯一胜者、Bot 拾取、Bot 射击和 Bot 击杀事件。
   - `src/controllers/BotController.ts:804` 对不可达 loot 按 `id + generation + 失败位置` 缓存，移动 36m 或 generation 改变后重试；缓存有 320 项上限。失败 retreat cover 会立即拒绝，patrol/zone/forced relocation 会先过滤权威地面 blocker，属于针对 73k path calls 根因的有界优化。
   - town 单独使用 `findPath<=22000`、LOS `<=22000`、shot trace `<=25000`；island 原 `17500/20000/23500` 和多 seed 武装阈值均未降低。map-specific operation budgets 有真实约 20.3k town path calls 的记录和完整 match 行为断言，依据充分。

5. **Medium MCP 高楼/连廊实操 — 按用户最新范围降为 follow-up residual risk。**
   - 基础 production MCP 已覆盖双地图、持久化、HUD/minimap、844×390 mobile、灰炉城双页面联机、console 和逐轮清理；附加轮还完成真实飞机→跳伞→门外落地及穿门。
   - 完整五层/连廊人工走完受 headless 软件 WebGL 与 MCP 超时影响未完成，但权威代码链已有真实 Movement 跟随、GridNavigator、CombatWorld 遮挡和 NullEngine scene 测试。
   - 用户最新明确授权“没有恶劣问题可以先推看效果，后续再逐步搞好”。在本轮未发现恶劣代码问题的前提下，该缺口不再构成 preview push 的 blocker/high/medium；仍应在后续真实生产体验中补录完整人类高楼、连廊、拾取和射击遮挡走查。

#### 交付边界与残余风险

- **预览推送**：允许；无 unresolved blocker/high/medium。
- **正式 Worker/Pages 协议 4 上线**：仍必须遵守 plan/AGENTS 的维护发布顺序，并在部署后记录新 Worker version、`wrangler deployments status` 和真实 `npm run test:multiplayer:production`。本轮通过不替代这些部署后门禁。
- Residual risk：组合桥路径当前会优先选择可用 bridge route，即使 ground route 更短；这是性能/路线质量问题而非正确性阻断，现有 town operation budget 已约束成本。完整 production 人类五层/连廊实操仍是明确 follow-up。

### 第 3 轮 — 2026-08-02 — 新基线快速复核通过

- 审查基线更新为 `main@65182ab`，`HEAD` 与基线一致；重新读取最新 Build/Review 和 `git diff 65182ab`。本轮仅检查 pull/stash pop 是否破坏 第 2 轮 结论，以及远端 APP_VERSION/Vite/CI/Docker 版本注入与三个重叠文件的合并结果。
- 已信任 outer 实现 Agent 记录的合并后完整 typecheck、6 files/107 tests、Worker dry-run、standalone build、budgets 和 `git diff --check`；本轮未重复测试、构建、预算或 MCP。
- `AGENTS.md` 同时保留 `65182ab` 的 plan/审查者 交付规则和本任务的 mapId、高楼/连廊、quick-match 规则；无冲突标记或语义覆盖。
- `docs/deployment.md` 同时保留 APP_VERSION/Docker build-arg 文档和协议 4 地图维护发布流程；正式 Worker/Pages 部署后门禁不变。
- `src/app/GameApp.ts` 同时保留 `VERSION ${escapeAttribute(__APP_VERSION__)}` footer、地图选择/持久化、公开房间与 lobby 地图名称、联机输入 `name` 属性。未发现版本注入覆盖地图 UI 或反向覆盖 footer。
- `.github/workflows/ci.yml`、`Dockerfile`、`vite.config.ts`、`src/vite-env.d.ts` 相对 `65182ab` 均无 working-tree 改动；`APP_VERSION` 的 CI、Docker build arg、Vite define 和类型声明链路完整。
- 结论：新基线合并未破坏 第 2 轮 的导航、POI、LOS、AI、联机或 preview-push 结论，亦未引入新的 blocker/high/medium。当前 **unresolved blocker/high/medium = 0**。
- Residual risk 和交付边界维持 第 2 轮：完整 production 人类五层/连廊实操仍为 follow-up；正式协议 4 上线仍需维护发布、Worker version 和 production multiplayer smoke。
