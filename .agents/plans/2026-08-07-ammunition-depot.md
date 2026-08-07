# 弹药库特殊建筑与全内置楼梯实施计划

## Context

当前三张地图都拥有一个权威医院建筑。医院由 `MapLayout` 显式记录建筑 ID、地图位置和两份专属医疗物资索引；客户端、AI、单机和联机服务端都消费同一布局。用户要求新增与医院并列的特殊建筑“弹药库”：

- 苍岬岛、灰炉城、烬岚郡每张地图恰好一个弹药库。
- 弹药库必须是可进入、可导航、参与权威碰撞与视线判断的现有地图建筑，而不是纯视觉模型。
- 弹药库内部固定放置四种枪械各自的一份弹药：步枪弹、轻型弹、霰弹、狙击弹。
- 这四份弹药属于弹药库的独立专属资源，不替换、不挤占现有全局物资池。
- 弹药库使用独特但克制的深色军械/工业外墙，并使用已经加入 manifest 的 `ui.item.ammo-depot` 和 `decal.poi.ammo-depot` 资源。
- 本任务在独立分支 `feat/ammunition-depot` 完成，不把代码标识写成中文拼音。

用户同时要求修复全部建筑的屋顶通路：

- 当前部分一层建筑没有任何楼梯，另一些岛屿建筑依赖外置坡道/脚手架式楼梯上屋顶。
- 最终所有一层与多层建筑都必须使用建筑内部楼梯；一层建筑也要有从地面层到屋顶层的内部楼梯。
- 删除所有外置坡道，不保留纯视觉外置楼梯，也不能让导航、碰撞或 LOS 继续消费隐藏的 exterior ramp。

## Final Contract

### 权威地图

- `MapLayout` 新增显式 `ammunitionDepot` 记录，至少包含：
  - 显示名 `"弹药库"`；
  - 唯一 `buildingId`；
  - 地图位置；
  - 步枪弹、轻型弹、霰弹、狙击弹四个专属 loot index。
- 每个合法 `mapId + mapSeed` 恰好生成一个弹药库。
- 弹药库与医院的 `buildingId` 必须不同。
- 弹药库必须选择带合法底层入口、内部可站立且四份物资可到达的建筑。
- 苍岬岛优先使用仓储区附近的非医院建筑；灰炉城优先使用 warehouse/factory；烬岚郡必须位于固定城区且优先使用 warehouse/factory，不能落在农村或森林。
- 选择过程确定性、使用独立 seed/排序，不扰动医院选择、地形、道路、建筑、树、石、草垛或现有物资随机流。

### 全内置楼梯

- 每个 `MapBuilding` 都必须拥有非空 `stairwell`，不再以 `storyCount > 1` 作为创建条件。
- 每栋建筑生成恰好 `storyCount` 条内部楼梯：
  - 一层建筑生成一条 `level 0 → level 1` 的内部楼梯，`level 1` 即屋顶；
  - 多层建筑逐层连接，最后一条通往屋顶。
- `MapLayout.roofRamps` 不得包含 `kind: "exterior"`；最终所有记录都必须是 `interior`。
- 删除岛屿外置坡道生成和回退逻辑，不保留脚手架式权威几何或 presentation mesh。
- 每层 floor/roof slab 必须保留与内部 stairwell 对齐的开口和 landing；不得出现楼梯穿过完整楼板/屋顶。
- 墙体、门窗、楼板、楼梯、Movement support、Combat/LOS、GridNavigator、AI 和渲染必须消费同一组内部楼梯。
- 原有建筑 footprint、位置、楼层数、颜色（特殊建筑除外）和地图道路不因楼梯重构而变化。
- 常规 loot 和特殊 loot 不得生成在 stairwell footprint 内；所有既有 loot 仍须可站立、可拾取、从建筑入口可导航。
- 建筑尺寸不足以容纳合法内部 stairwell 时生成必须显式失败或在建筑生成阶段保证尺寸，不能静默回退到外置楼梯。

### 物资数量

- 现有全局物资保持原合同：
  - 240 个常规区域物资；
  - 10 个额外医疗物资；
  - 合计 250 个既有全局物资，位置、类别和随机结果不因弹药库变化。
- 弹药库额外追加 4 个专属物资点，因此初始地图总地面物资为 254。
- 四份专属弹药固定为：
  - `ammo.rifle × 90`
  - `ammo.light × 96`
  - `ammo.shell × 18`
  - `ammo.sniper × 16`
- 专属点位必须在弹药库内部、互不重叠、远离墙体和楼梯井，并可从建筑外经底层门导航到达。
- `lootZoneCounts` 继续只描述原有常规区域分布，不计医院和弹药库专属资源。
- 战局初始化必须按 `ammunitionDepot` 的显式索引赋固定物品；不能通过“排在数组最后四项”的隐式猜测完成。
- AI、拾取、丢弃、联机复制、checkpoint 和动态 loot record 继续使用普通 `GroundLootState`，不新增特权拾取逻辑。

### 建筑视觉

- 弹药库权威墙体颜色使用独立常量，选择低饱和深枪灰/军绿色，不使用高亮、霓虹或花哨配色。
- 弹药库墙面、楼板和屋顶使用统一的特殊军械库材质；可复用已验证的工业金属纹理，但纹理失败时必须保留深色程序化 fallback。
- 建筑正立面增加使用 `ui.item.ammo-depot` 的非碰撞、不可拾取标牌；纹理仅在 ready 后绑定，失败时保持可见纯色牌面。
- 小地图单独显示“弹药库”标记，并使用 `decal.poi.ammo-depot`。
- POI 资源映射新增 `ammo-depot` 类型，但弹药库不加入普通 `mapPoints`，避免改变区域数量、地形铺装或普通 POI 装饰。
- 低、中、高画质均必须显示弹药库建筑颜色、标牌和小地图标记；高画质可以保留所属城区已有工业细节，但不能改变权威几何或专属物资。

### 兼容性与联机

- 不改变 `MapId`。由于三地图权威楼梯/楼板几何从 exterior/缺失改为全 internal，且初始 ground loot 从 250 改为 254，`MULTIPLAYER_PROTOCOL_VERSION` 从 7 升到 8，明确拒绝不知道新几何/物资状态的旧客户端。
- `MATCH_CHECKPOINT_VERSION` 从 6 升到 7。v6 及更旧 checkpoint 均在旧权威几何/物资合同下创建，必须在 Worker 和 standalone 恢复时关闭并删除，不能把旧坐标和旧 loot roster 套入新布局。
- Worker、standalone 和单机都必须通过相同 `createMapLayout()` 获得弹药库及四份物资。
- 现有 50 人、房间、地图选择、伤害、背包和弹药数值保持不变。

## Planned Changes

### 1. 失败回归

文件：

- `tests/unit/mapLayout.test.ts`
- `tests/unit/mixedMapLayout.test.ts`
- `tests/unit/battleRoyaleMode.test.ts`
- `tests/unit/minimap.test.ts`
- `tests/unit/islandScene.test.ts`
- 必要时 `tests/unit/aiLootReachability.test.ts`

先加入以下失败断言：

1. 三地图代表 seeds 均有唯一、确定、非医院的弹药库。
2. 弹药库建筑具有专属墙色、合法入口和四个内部可导航点。
3. 前 250 个全局 loot point/loot record 合同保持，额外四项为固定弹药与固定数量。
4. 四类弹药均能从门外导航、站立、交互拾取。
5. 小地图把“弹药库”映射到 `decal.poi.ammo-depot`。
6. NullEngine 场景创建专属墙/楼板材质和一个 ammo-depot facade sign；标牌 non-pickable/non-colliding。
7. 三地图代表 seeds 中每栋建筑 `stairwell !== null`，`roofRamps.length === sum(storyCount)` 且全部为 `interior`。
8. 每栋一层建筑存在 `0 → 1` 内部楼梯、对应 roof opening/landing，并可从门外导航到屋顶。
9. 三地图不再出现任何 exterior ramp 权威记录或外置坡道渲染 mesh。
10. 所有常规、医院和弹药库 loot 均避开 stairwell footprint，入口到物资路径继续成立。

### 2. 地图数据

文件：

- `src/config/map.ts`
- 必要时 `src/config/townMap.ts`
- 必要时 `src/config/mixedMap.ts`

实施：

- 增加 `AmmunitionDepotPoi` 和 `MapLayout.ammunitionDepot`。
- 增加独立、确定的三地图建筑选择 helper。
- 岛屿选择必须避开医院并保持入口/内部楼梯净空。
- town/mixed 选择必须避开医院，优先 warehouse/factory；mixed 限定固定城区。
- 增加四点内部布局 helper，显式验证建筑内边距、墙体、楼梯井和点间距。
- 保留医院索引与前 250 点位顺序；仅在末尾追加 4 个专属点。
- 增加 `GLOBAL_LOOT_POINTS = 250`、`AMMUNITION_DEPOT_LOOT_POINTS = 4` 和清晰的总数合同，避免把“全局数量”与“地图总记录数”混为一谈。
- 让 island/town/mixed 的所有建筑在最终 `MapBuilding` 阶段都带内部 stairwell。
- 统一通过 `createInternalRamps()` 为所有建筑生成逐层通路；删除 `createRoofRamp()`、方向回退和 exterior ramp 分支。
- 在三类 loot point 生成与特殊建筑点位 helper 中避开 stairwell footprint。

### 3. 战局物资

文件：

- `src/game/modes/BattleRoyaleMode.ts`
- `src/network/protocol.ts`
- `src/server/MatchRuntime.ts`
- `tests/unit/battleRoyaleMode.test.ts`
- `tests/unit/multiplayerClient.test.ts`
- `tests/unit/matchRuntime.test.ts`
- `tests/worker/admin.test.ts`
- `tests/standalone/localDurableObjectRuntime.test.ts`

实施：

- `createGroundLoot()` 接受 `ammunitionDepot` 元数据。
- 保留原 250 项生成与随机流。
- 根据四个显式 index 生成四种固定弹药和既有标准数量。
- 断言总 ground loot 为 254，原 250 项类别与数量合同保持。
- 协议升为8，checkpoint升为7；v6及更旧状态在两套服务端持久化恢复中删除。

### 4. HUD、POI 与场景

文件：

- `src/client/poiVisuals.ts`
- `src/client/ui/GameHud.ts`
- `src/client/render/scenes/IslandScene.ts`
- `tests/unit/minimap.test.ts`
- `tests/unit/islandScene.test.ts`

实施：

- 新增 `"ammo-depot"` POI visual type 与 `decal.poi.ammo-depot` 映射。
- HUD 小地图在医院之外单独绘制“弹药库”。
- 增加弹药库特殊墙/楼板/屋顶材质。
- 正立面创建 `ui.item.ammo-depot` 标牌，保持程序化 fallback 和 ready-only texture binding。
- 合并静态批次时把弹药库 surfaces 与普通建筑分开，不能丢失专属材质。
- 渲染只消费内部楼梯；删除 exterior ramp 的脚手架式/外置 mesh 路径与材质（若已无其他用途）。
- 一层建筑屋顶开口、landing 和内部楼梯必须与高楼使用同一可见结构，不做 presentation-only 假楼梯。

### 5. 文档

文件：

- `AGENTS.md`
- `docs/architecture.md`
- `docs/deployment.md`（仅当发布验收步骤需要补充）

记录：

- 医院和弹药库都是显式权威特殊建筑，必须唯一且互不重合。
- 弹药库四类弹药不占前 250 个全局物资。
- 三平台和三画质必须消费相同布局和专属物资索引。
- 所有建筑包含内部楼梯并且 exterior ramps 被禁止。

## Validation

### 自动测试

按从小到大顺序：

1. 新增 map layout / battle royale / minimap / scene 定向失败回归。
2. 受影响 unit 文件。
3. `npm run typecheck`
4. `npm run test`
5. `npm run build`
6. `npm run build:worker`
7. `npm run build:server`
8. `npm run check:budgets`
9. `git diff --check`

按用户此前明确要求，本任务不运行 coverage。最多使用 7 个 worker，至少保留 1 个 CPU 核心。

### Chrome MCP

使用 production build、本机 Chrome/Edge、音量 `0`：

1. 分别进入苍岬岛、灰炉城、烬岚郡。
2. 检查每图仅一个弹药库，与医院不同栋。
3. 检查小地图“弹药库”图标。
4. 检查深色克制外墙、专属正面标牌和四份地面弹药。
5. 检查 console 和 Network，无新增错误或资源重复请求。
6. 每一轮结束立即导航 `about:blank`、关闭 isolated context、停止 preview、确认端口关闭且 MCP 只剩不可避免的 `about:blank`。

### 独立审查

实现和验证完成后启动独立 reviewer，重点检查：

- 三地图唯一性与医院分离；
- 250 + 4 数量边界；
- 固定索引与随机流稳定性；
- 可导航/可拾取；
- authoritative/client/server 一致性；
- special material、asset fallback 和 batch 合并；
- 一层屋顶可达、全内置 stairwell 和 exterior ramp 完全移除；
- loot/stairwell 净空；
- 无协议/checkpoint 无关变更。
- 协议8/current checkpoint7和旧房间删除路径。

必须解决全部 blocker/high/medium 后才能提交。

## Delivery

1. 在本 plan 的 `## Build` 记录实现与验证事实。
2. 在 `## Review` 记录 reviewer rounds 与 finding disposition。
3. 创建一个同时包含实现、测试、文档和 plan 的提交；禁止 plan-only commit。
4. 普通 push `feat/ammunition-depot`。
5. 创建以 `main` 为 base 的 GitHub PR。
6. 在 PR 评论 `@codex review`，监控最新 SHA。
7. 等待 GitHub CI、Cloudflare Pages 和 Workers Builds；确认 protocol 8 Worker 新生产版本、自动 production smoke 与一次独立 production smoke 均通过。
8. Codex 若提出有效问题，按新的实现/review/提交轮次处理，直到最新 SHA 明确无问题。
9. 不擅自 merge。

## Build

- 2026-08-07：从最新 `main@feea36aba657d1fa2c62837dc18b0c735a48fbea` 创建 `feat/ammunition-depot`。确认 manifest 已有 `ui.item.ammo-depot`（256×256 WebP）与 `decal.poi.ammo-depot`（WebP），现有四类弹药为 `ammo.rifle / ammo.light / ammo.shell / ammo.sniper`，标准单堆数量为 `90 / 96 / 18 / 16`。
- 2026-08-07：医院链路盘点完成。三地图都通过 `MapLayout.hospital` 显式记录特殊建筑与两个医疗 loot index；前 240 个区域物资加 10 个医疗物资形成现有 250 条记录。弹药库将沿用显式特殊建筑/索引模式，在这 250 条之后追加 4 条，不修改前 250 条随机流。
- 2026-08-07：用户追加全内置楼梯要求。当前 island 一层建筑使用 `kind: "exterior"` 的屋顶坡道，town/mixed 一层建筑没有 stairwell；最终合同收紧为所有建筑都有 stairwell、一层也生成 `0→1` 内部楼梯、`roofRamps` 全部为 `interior`，并同步收紧楼板开口、导航、渲染与 loot 净空。
- 2026-08-07：核心失败回归准确红灯。三地图弹药库用例均因 `layout.ammunitionDepot` 缺失失败；BattleRoyale 两项因专属弹药合同缺失失败；岛屿因仍含 `exterior` ramp 失败，town/mixed 的 ramp 总数分别为 `708/923`、`139/171`，明确证明一层建筑缺少内部楼梯。失败不是测试环境或语法错误。
- 2026-08-07：权威核心实现后，三地图弹药库、前250+专属4弹药和全内置楼梯8项定向测试通过；Movement以真实门外→门内→内部楼梯→一层屋顶路径通过。所有一层楼从完整单屋顶板升级为5块带开口roof slab并增加一条内坡道，50人medium NullEngine场景实测aggregate vertices `584,958`、unique vertices `413,256`、unique indices `953,826`；对应确定性资源门限仅调整为`590,000 / 420,000 / 960,000`，没有修改FPS、时钟或功能断言。
- 2026-08-07：兼容性复核确认本任务改变三地图权威楼梯/楼板几何并把初始loot roster从250改为254。为防旧客户端和旧checkpoint误解释新状态，最终合同升为protocol 8 / checkpoint 7，并拒绝v6及更旧持久化对局。
- 2026-08-07：受影响布局全文件 island/town/mixed 3 files / 61 tests通过；前一轮并发高负载导致3个Scene wall-clock timeout，串行复跑scene lifecycle及mixed/town高画质用例均通过，未修改timeout。核心 Movement 使用真实门外→门内→内部楼梯→一层屋顶路径通过。
- 2026-08-07：protocol 8 / checkpoint 7 实现后，受影响unit 7 files / 88 tests、standalone真实SQLite恢复11/11、三端typecheck通过。完整v6 checkpoint在standalone删除，当前v7 town checkpoint保留恢复；Worker同类真实DO测试已更新，因本机glibc 2.28无法启动当前workerd，运行证据必须由push后的Node24 CI提供。
- 2026-08-07：三地图各40 seeds结构扫描全部通过：唯一弹药库与医院分离、墙色正确、254 loot points、弹药库索引固定250–253、每栋建筑均有stairwell、所有ramp均为internal且总数等于各建筑storyCount之和。
- 2026-08-07：最终完整unit 46 files / 463 tests通过；此前并发高负载造成mixed/scene wall-clock timeout，串行原用例均通过，未改timeout、seed或功能阈值。Bot同栋跨层路径修复为建筑内部组合路径，不再错误先出门再进门；一层/三层屋顶追踪、Movement双向物理遍历、GridNavigator双向路径和坡面LOS均通过。
- 2026-08-07：完整standalone 3 files / 25 tests通过；三端typecheck通过。browser、Worker dry-run、server和same-origin standalone build全部通过。预算最终browser entry `1,102,306 / 1,200,000`、all JS `3,798,961 / 4,000,000`、252 / 270 chunks、CSS `44,643 / 50,000`、dist `4,398,622 / 4,550,000`、Worker `523,245 / 615,000`、server `538,582 / 630,000`，全部PASS；`git diff --check`通过。按用户既有要求未运行coverage。
- 2026-08-07：production Chrome DevTools MCP三地图独立验收通过，全程volume=0。苍岬岛low、灰炉城high、烬岚郡low均显示小地图`decal.poi.ammo-depot`、正面`ui.item.ammo-depot`标牌、`#35413d`深枪灰墙体和`texture.industrial.metal`、专属surface batch、254个loot marker以及250–253四种弹药；资源各仅一次HTTP preload，scene阶段使用内存payload。三图均无旧外置ramp mesh，ramp batch source分别为287/919/245。console仅本机SwiftShader warning，无应用错误。
- 2026-08-07：每轮Chrome结束都立即导航`about:blank`、关闭isolated context并停止preview；最终MCP仅page1 `about:blank`、8798无监听、无本任务preview进程，临时截图已删除。

## Review

待实现、自动验证和 Chrome MCP 完成后追加。

### Round 1 — 2026-08-07

- 审查基线：`main@feea36aba657d1fa2c62837dc18b0c735a48fbea`；审查范围为 `feat/ammunition-depot` 当前完整工作区 diff，并对照本 plan 的 Plan、Build、Final Contract 与仓库根 `AGENTS.md`。
- 结论：**不通过，阻止提交**。
- Findings：blocker 0、high 1、medium 1、low 0。

1. **High — 原地图与前 250 个全局物资没有保持，违反本 plan 的显式兼容合同。**
   - 位置：`src/config/map.ts:304`、`src/config/map.ts:306`、`src/config/map.ts:332`、`src/config/map.ts:1847`、`src/config/map.ts:1862`、`src/config/map.ts:1865`、`src/config/map.ts:1505`、`src/config/map.ts:2652`、`tests/unit/mapSelection.test.ts:47`。
   - 岛屿 `createSeededBuildings()` 删除了旧 exterior-ramp 的地图边界、地形和相邻建筑筛选，改用不同的 internal-ramp 条件；随后石头、掩体、医院选择和前 250 个物资都消费这批重排后的建筑/坡道。测试又直接替换了三条 island layout hash，而没有锁定 `main` 的既有建筑、医院与前 250 点位前缀。
   - reviewer 做了未被外层证据覆盖的最小 `main` 对照：seed `0 / 42 / 2026` 的岛屿分别有 `125 / 145 / 221` 个前 250 点位变化，建筑数从 `226 / 221 / 223` 变成 `237 / 227 / 230`，变化建筑为 `188 / 107 / 151`，三例医院建筑 ID 也全部改变。town 每例有 2 个前缀点变化，mixed 有 2–4 个前缀点变化；它们来自 stairwell 冲突后重新选点及医院专属点重排。
   - 影响：这不是“250 条记录仍存在”，而是改变了既有地图、医院、自然物、落地搜集位置以及权威布局；直接违背 Final Contract 中“不扰动医院选择、地形、道路、建筑、树、石、草垛”和“保留前 250 点位顺序/位置，仅追加四项”的要求，也让升级前后同 seed 的非目标内容产生大面积无关变化。
   - builder 必须恢复原建筑/医院/自然物与前 250 点位前缀，仅为既有建筑附加 internal stairwell/floor opening，并在索引 `250–253` 追加弹药库物资。若个别旧点与新 stairwell 冲突，应通过合法的 stairwell 侧向/布局选择解决，而不是静默移动既有点。需要增加能对照旧基线前缀的回归；不能再次通过改写 snapshot hash 接受无关布局漂移。

2. **Medium — 架构文档仍把当前联机协议写成 7。**
   - 位置：`docs/architecture.md:73`。
   - 实现、部署文档和 plan 已切到 protocol 8，但架构说明仍写“Multiplayer protocol version 7”。协议升级必须做 Worker/Pages 配套维护发布，保留旧当前版本描述会误导后续发布与故障判断；应改为当前 protocol 8，并说明 8 覆盖本次楼梯/初始 loot roster 合同。

- 已参考外层记录的失败回归、三图各 40 seeds、unit 46/463、standalone 3/25、三端 typecheck、四类 build、budgets 与三地图 production Chrome 证据；未重复完整 tests、build、browser 或 coverage。
- 为核对具体未覆盖风险，reviewer 仅运行两项只读定向检查：
  - 三地图各 160 seeds 扫描：未发现 depot 离开 mixed 固定城区或任一 loot 落入 stairwell footprint。
  - 当前分支与 `main` 的 `0 / 42 / 2026` 三图布局/前 250 点位 JSON 对照：确认上述 High finding。
- 除上述 findings 外，静态审查未发现弹药库显式索引 `250–253`、四种固定弹药数量、普通 `GroundLootState` 路径、全 internal ramp 类型、协议 8/checkpoint 7 拒绝旧状态、ready-only 标牌纹理或特殊 surface batch 的额外明确问题。完成修复与定向回归后必须重新请求独立 review。

### Round 1 finding disposition

1. **High（原地图与前250漂移）— 已解决。**
   - island 恢复旧 exterior-ramp footprint 仅作为生成期 `RampFootprint` 净空包络，以完全复刻旧建筑、石/树/cover和前250点候选接受顺序；该结构没有 `kind`、ID或level，绝不进入 `MapLayout`，Movement/LOS/GridNavigator/渲染仍只消费最终 internal `RoofRamp`。
   - town/mixed 恢复旧“仅多层internal ramp”参与自然物与前250点生成、恢复原医院点位。前250确定后，再对每栋楼确定性搜索内部stairwell side、前后offset和坡向；候选必须位于建筑内、清地形且不覆盖任一旧loot，两侧/偏移都失败会显式抛错，绝不移动旧点。
   - 对 `main@feea36a` 建立临时detached worktree并做逐字段JSON对照：island/town/mixed × seeds `0/42/2026` 的mapPoints、landingZones、terrain、非stair建筑几何、医院、rocks、trees、covers、前250 loot、zone counts、roads、urban roads和skybridges全部`SAME`，命令exit 0；临时worktree和文件已删除。
   - `mapSelection.test.ts` 不再接受目标字段变化后的全量新hash，而是锁定与main相同的“非楼梯几何+前250点”稳定hash；弹药库和全内楼梯由独立合同断言。
   - 进一步执行三地图各160 seeds扫描：所有布局254点、ramp全internal、ramp数等于storyCount总和、任一室内loot均不与stairwell footprint重叠，全部通过。

2. **Medium（architecture仍写protocol 7）— 已解决。**
   - `docs/architecture.md` 当前明确写protocol 8，并说明其覆盖新权威楼梯与弹药库loot roster；deployment文档同步为protocol 8 / checkpoint 7维护发布。

- 2026-08-07：finding修复后的行为回归补充通过：Bot从高地医院内部经正门离开进圈、从正门追逐一层屋顶目标、逐层爬上三层屋顶均通过；所有seed-zero内部楼梯的GridNavigator双向路径与Movement物理双向遍历通过。地面导航现按每个障碍物所在地的权威地形高度判断建筑/石/cover/树的垂直重叠，修复高地建筑外壳被错误忽略、门外路径直穿整栋楼的问题。
- 2026-08-07：Round 1 High最终修复后，严格main对照和三图各160 seeds扫描均exit 0；稳定hash回归锁定island seeds `0/42/2026`非stair几何与前250点，不再用更新全量目标hash掩盖漂移。内部stairwell对旧点零移动，通过side、前后offset与坡向有限搜索适配既有建筑；island历史外置坡道只作为无ID/kind/level的生成期`RampFootprint`净空包络，绝不进入最终MapLayout或权威系统。
- 2026-08-07：reviewer修复后最终完整unit 46 files / 463 tests、standalone 3 / 25、三端typecheck全部通过；browser/Worker dry-run/server/standalone builds与`git diff --check`通过。预算最终browser entry `1,104,047 / 1,200,000`、all JS `3,800,702 / 4,000,000`、252/270 chunks、CSS `44,643 / 50,000`、dist `4,400,363 / 4,550,000`、Worker `529,038 / 615,000`、server `544,075 / 630,000`，全部PASS。
- 2026-08-07：reviewer修复后production Chrome同一isolated context依次reload三图复验通过，全程volume=0。苍岬岛/灰炉城/烬岚郡均显示弹药库sign与minimap marker、254 loot、250–253四种弹药、internal ramp batch且无外置ramp mesh；console三轮仅Babylon启动与本机SwiftShader warning。结束后导航about:blank、关闭context、停止preview，MCP仅page1 about:blank、8798关闭、无preview进程。

### Round 2 — 2026-08-07

- 审查基线：`main@feea36aba657d1fa2c62837dc18b0c735a48fbea`；重读本 plan 最新 Build、Round 1 findings 与 disposition 后，静态审查 `feat/ammunition-depot` 当前完整工作区 diff。
- 结论：**通过，本次审查未发现明确问题。**
- Findings：blocker 0、high 0、medium 0、low 0。

1. **Round 1 High 已关闭。**
   - `RampFootprint` 是 `src/config/map.ts` 内部生成期结构，仅含坡面包络坐标和高度；最终权威 `RoofRamp` 额外要求 `id / obstacleId / kind: "interior" / fromLevel / toLevel`。旧岛屿外置坡道算法只通过 `createLegacyRampClearance()` 复刻建筑、自然物和旧 loot 的候选净空顺序，没有进入 `MapLayout.roofRamps`、Movement、LOS、GridNavigator 或渲染。
   - island 恢复旧建筑候选、旧坡道净空、医院选择、自然物和前 250 点生成顺序；town/mixed 恢复旧多层 ramp、旧墙体和医院点参与前 250 点生成。`assignStairwellsAvoidingLoot()` 只在前 250 点已经固定后，对 side、前后 offset 和 ramp direction 做有限确定性搜索；候选必须留在建筑内、不覆盖旧室内 loot、且清地形，失败会显式抛错，没有移动旧点的分支。
   - reviewer 重新创建 `main@feea36a` 临时基线并逐字段对照 island/town/mixed × seeds `0/42/2026`：map points、landing zones、terrain、排除 stairwell 的建筑事实、医院、rocks、trees、covers、前 250 loot、zone counts、roads、urban roads、skybridges全部相同，9/9 `SAME`、exit 0。
   - 补充对照把唯一允许变化的弹药库建筑/墙体颜色归一后，三图九个布局的完整建筑记录、wall segments 和 wall openings 也全部相同。说明没有借 stable hash 遗漏门窗或非目标墙体漂移。
   - `tests/unit/mapSelection.test.ts` 的三个 island stable hash 与 reviewer 从 `main` 按相同裁剪口径实时计算的值逐一一致；测试明确锁定旧非楼梯几何和前 250 点，弹药库颜色、显式索引和全 internal stair geometry 则由独立合同测试覆盖，不再通过更新全量目标 hash 接受无关变化。
   - 外层三地图各 160 seeds 扫描覆盖 254 点、全 internal ramp、ramp 数量、stairwell/loot 净空；该证据与当前有限搜索实现一致，可信。

2. **Round 1 Medium 已关闭。**
   - `src/network/protocol.ts`、`docs/architecture.md` 和 `docs/deployment.md` 现一致为 protocol 8；架构文档明确说明版本 8 覆盖新权威楼梯和弹药库初始 loot roster。checkpoint 仍一致为 current version 7。

3. **高地建筑地面导航修复未发现新回归。**
   - 三地图统一使用 building-envelope ground navigation；同栋跨层使用内部组合路径，跨栋/室外路径通过底层 door transition。
   - `obstacleOverlapsLocation()` 在 ground surface 上按每个障碍物自身位置的权威地形高度判断垂直重叠，避免高地建筑、石头、cover、树因远端起点高度而被错误忽略；非 ground 楼层仍使用当前楼层 support，保持楼层隔离。
   - reviewer 对 island seed 99 高地医院做最小只读路径检查：医院 `baseY=4.152`，中心到远端路径包含连续的门内/门外 waypoint，离开门外后不再穿回建筑 envelope，检查 exit 0。外层 Bot 高地医院出门进圈、一层/三层屋顶追踪、GridNavigator 与 Movement 双向楼梯证据足以覆盖行为链路。

- 已参考外层最终证据：unit 46/463、standalone 3/25、三端 typecheck、browser/Worker/server/standalone builds、budgets、三图 Chrome 复验及立即清理；按要求未重复完整 tests、build、browser 或 coverage。
- reviewer 仅运行上述两个具体风险的只读定向核验，并已删除 `/tmp` 下本轮临时 baseline、脚本和比较文件。
