## Plan

### 目标

保留灰炉城现有高密度、权威高楼、连廊、物资、AI 和联机契约，但移除固定 `3 × 2` 方盒街区。每个 `mapSeed` 必须确定性生成不同的地块分割、建筑退线、尺寸、组合和院落；同 seed 可复现，不使用非确定性视觉随机，也不改变苍岬岛。

### 验收

- 仍为 448 栋建筑、233 栋多层、54 栋 4–5 层、32 条连廊、250 物资。
- 核心覆盖率仍为 45%–60%，LOS 指标不回退。
- 不同 town seed 的绝大多数核心建筑中心和 footprint 都不同。
- 单个 seed 的 64 个核心街区拥有大量不同排列，不再重复固定六个局部坐标。
- 建筑不重叠、不侵入道路；连廊端点、楼梯、Movement、Combat/LOS、GridNavigator 和 AI 仍一致。
- 实现、定向/完整验证、Chrome MCP 验收后完成独立 reviewer；commit 前再次 pull。

## Build

### 更新日志

- 2026-08-02 18:05：用户确认线上灰炉城密度足够，但拒绝固定方盒/模板化排列，明确要求真正的 seeded procedural randomness。已在 `main@7ffb5c2` 执行 `git pull origin main`，结果 `Already up to date`；当前工作区干净。
- 2026-08-02 18:44：完成 seeded random blocks 实现。X/Z 两方向各 9 条道路轴由 seed 生成，形成 8×8 个 150–205m 不等宽街区；每个街区使用带回溯的 BSP 随机分割为 6 个不等工业地块，四边退线、建筑 footprint 和院落偏置独立随机，长宽比限制为 ≤3.2。随机相邻地块仍确定性选择桥端，连廊门洞按两楼实际重叠区开洞。8 个 POI、16 个落点和 168 个道路掩体均消费随机街区/道路，不再使用固定棋盘坐标。
- 2026-08-02 18:44：量化 seeds 0/1/2/42/99/2026/314159：均保持 448 建筑、233 多层、54 高楼、32 连廊、250 物资；核心覆盖率 54.36%–55.56%，建筑最大长宽比 3.17，每个 seed 的 64 个核心街区均得到 64 个不同局部排列。不同 seeds 1/2 的 384 栋核心楼中超过 320 栋中心和 footprint 变化，道路轴也不同；island seeds 0/42/2026 golden SHA-256 保持。
- 2026-08-02 18:44：验证通过：town layout、map selection/island golden、GridNavigator、NullEngine Greyfurnace scene/minimap、三 seed×250 物资导航/拾取、town 49 Bot full-match；完整 typecheck、Worker dry-run、same-origin standalone build 和 budgets。随机街墙下 town 独立 operation budget 调整为 LOS≤26000、shot trace≤30000，island 原 20000/23500 未变。
- 2026-08-02 18:44：Chrome DevTools MCP 使用 production build 固定 seed 42 验收，音量 0；scene 创建 14320 个批量墙源和 8 POI，console 无 error/issue。停止 render loop 后生成 `/tmp/last-line-random-town-aerial.webp` 的真实俯视图，确认道路带不等宽、街区内部 footprint/退线/院落明显不重复；页面关闭后只剩 `about:blank`，standalone server 已停止并清理临时数据。
- 2026-08-02 19:13：已解决第 1 轮两项 medium。POI/landing 不再使用街区中心抖动，而是在指定随机街区的临街空地与院落候选中进行 seeded 有界采样，按最大 POI 装饰半径避让全部楼体，并为一层入口保留额外净空；随机候选不足时以确定性的 4m 网格搜索兜底，无可用公共空间则明确报错。独立 `createTownMapBlueprint(42)` 两次重建深比较现覆盖生成器本身的可复现性；9 个代表 seed 同时断言全部 16 个落点避开楼体、坡道和入口净空，不再依赖 `createMapLayout` 缓存。
- 2026-08-02 19:13：生成压力检查 seeds 0–2999 全通过，均保持 448 建筑和 16 落点，未出现生成失败或点位进入带 10m 装饰净空的建筑 footprint。新增跨 seed 断言确认道路、楼体中心/footprint、POI 坐标、道路掩体和楼层分配均发生变化。
- 2026-08-02 19:13：修复后验证通过：`npm run typecheck`；unit 43 files / 398 tests；standalone 3 files / 20 tests；受影响 map selection、town layout、AI loot、NullEngine scene、minimap 共 5 files / 61 tests；定向 determinism/public-space/randomness 11 tests；`npm run build`、`npm run build:worker` dry-run、`npm run build:server` 和 `npm run check:budgets`。预算结果：browser entry 1,059,478/1,075,000，Worker 449,452/450,000，standalone 468,941/470,000，均 PASS。`npm run test` 中 Worker runtime 未进入用例，因为本机 Debian glibc 2.28 无法启动当前 `workerd`（要求 GLIBC_2.29–2.35）；app unit 与 standalone 已分别完整通过，且本次未改 Worker/shared server 业务代码。
- 2026-08-02 19:13：使用最新 `dist/` 再次完成 Chrome DevTools MCP production 验收，游戏音量 0；seed 42 场景仍为 14320 个批量墙源、8 个 POI，console 无 error/issue，并更新 `/tmp/last-line-random-town-aerial.webp`。验收后主动关闭页面，确认只剩 `about:blank`，停止 8798 preview 并确认端口和 Chrome/MCP 进程无残留。
- 2026-08-02 19:55：已解决第 2 轮两项 high 和一项 medium。权威地图重建算法变更将 `MULTIPLAYER_PROTOCOL_VERSION` 从 4 提升到 5，旧 Pages 客户端会被明确拒绝；`MATCH_CHECKPOINT_VERSION` 从 3 提升到 4，Worker 和 standalone 共享的 `GameRoom` 恢复路径会关闭并删除旧版本运行房间。unit 直接验证旧 checkpoint 不兼容、当前版本兼容，Worker 合同把前一版本 checkpoint 写入持久层后验证淘汰，standalone 合同跨 SQLite 环境重启验证 `room-v1` 和 `checkpoint-v1` 均被删除；现有当前版本 standalone 重启恢复测试保留并通过。`docs/architecture.md` 和 `docs/deployment.md` 已同步协议 5 与维护发布要求。
- 2026-08-02 19:55：POI/landing 现统一保留 8×18m seeded 公共空间，覆盖最大仓库四集装箱实际 footprint；生成器仅在 3.75m 正式道路之外再留 1.5m 肩部净空的退线带/院落中选择，且避让建筑、内部坡道/楼梯和一层入口。相同 `TOWN_POINT_HALF_WIDTH/DEPTH/OBSTACLE_CLEARANCE` 常量由蓝图生成、权威 cover/tree、地表铺装和测试共同消费；168 个 cover 与 96 个 tree 均拒绝侵入全部 16 个保留区，避免 seed 7/19 的 fence/POI 穿插。
- 2026-08-02 19:55：最终随机/公共空间压力证据：独立 blueprints seeds 0–2999 全通过；完整 `MapLayout` seeds 0–99 全通过，均保持 168 cover、96 tree 且无 POI/landing footprint 穿插；代表 9 seeds 的测试同时检查道路、建筑、坡道、入口、cover、tree 和 rock。曾尝试统一 18×18 保留区，定向测试证明密集街区无法稳定容纳后立即废弃；最终 8×18 是最大真实模型 footprint，而非为通过测试缩小模型。
- 2026-08-02 19:55：最终验证通过：`npm run typecheck`；unit 43 files / 399 tests；standalone 3 files / 21 tests；`npm run build`、`npm run build:worker` dry-run、`npm run build:server`、`npm run check:budgets`。最终预算：browser entry 1,059,671/1,075,000，Worker 449,932/450,000，standalone 469,465/470,000，均 PASS；曾出现的 Worker/standalone 超预算通过精简公共空间实现解决，未修改预算。完整 Greyfurnace 49 Bot 对局与 7,000 event 原门禁在最终布局下通过，未放宽事件上限。Worker runtime suite 仍因本机 glibc 2.28 无法启动当前 `workerd`（要求 GLIBC_2.29–2.35）而无法本地执行；Worker typecheck、test typecheck、dry-run bundle 和对应合同源码已完成，需由推送后的 Node 24 CI 执行完整 Worker suite。Docker 命令在本机不可用，本次未修改 Docker/Compose。
- 2026-08-02 19:55：最终 Chrome DevTools MCP 使用最新 `dist/`、音量 0 复验 seed 42；14320 个批量墙源、8 个 POI，console 无 error/issue，并更新 `/tmp/last-line-random-town-aerial.webp`。验收后主动关闭页面并确认只剩 `about:blank`，停止 8798 preview，确认端口及 Chrome/MCP 进程无残留。
- 2026-08-02 20:35：已解决第 3 轮三项 presentation medium。道路肩部真实半宽统一导出为 `TOWN_ROAD_SHOULDER_HALF_WIDTH=6`，公共空间按肩部之外再加 1.5m 净空生成；为保证全部 seeds 在高密街区仍有临街装卸带，核心楼体道路退线从 12m 调整为 14.25m。seeds 0–2999 均可生成，代表 seeds 核心建筑覆盖率仍为 47.51%–48.98%，保持 448 栋与 45%–60% 高密验收。
- 2026-08-02 20:35：保留真实最大模型 8×18m footprint，不把公共空间扩大成会破坏高密生成的 12×18。为摆脱 12m terrain 顶点间距，town 的 8 个主 POI 改为各自创建独立 8×18 `town-poi-paving-*` ground mesh，位置和尺寸消费同一公共空间常量；island terrain POI 分类和随机序列保持原分支。NullEngine 断言 8 个铺装 mesh 与 8 个主 POI 一一对齐且世界包围盒尺寸正确，production MCP 也实际观测到 `poiPavingCount=8`。
- 2026-08-02 20:35：visual-only rock/shrub placement 提取为生产共用的确定性 `createNaturalDetailPlacements`；town 候选统一避让全部 16 个公共空间，island 分支只新增一个恒为 false 的 mapId 条件，不增加 RNG 消耗。回归覆盖 reviewer 复现的 seeds 1/2 × low/medium/high，按旋转安全水平半径检查全部 76/152/228 个 placement；现有 island high/low 视觉数量测试继续通过。最初用 6 个完整 Babylon 场景覆盖三画质导致 Node 22 默认 4GB heap OOM，随后改为复用生产 placement 纯函数，只保留一个 NullEngine town scene 检查铺装与最终 mesh，默认 heap 完整 unit 恢复通过。
- 2026-08-02 20:35：最终验证通过：`npm run typecheck`；unit 43 files / 405 tests；standalone 3 files / 21 tests；shoulder-clear blueprints seeds 0–2999；完整 layouts seeds 0–99；`npm run build`、Worker dry-run、server build、budgets。最终预算：browser entry 1,060,362/1,075,000，Worker 449,977/450,000，standalone 469,510/470,000，均 PASS，预算文件未改。最终 Chrome MCP 最新 `dist/`、音量 0：14320 墙批次、8 POI、8 独立铺装，console 无 error/issue；页面关闭到只剩 `about:blank`，8798 preview 与 Chrome/MCP 进程无残留。
- 2026-08-02 20:41：按用户要求在 commit 前将全部工作区改动（含 plan）暂存到 stash，执行 `git pull --ff-only origin main`。线上从 `7ffb5c2` 快进到 `490e0f6 fix: compact menu settings layout`，仅修改 `.gitignore` 与 `src/styles/main.css`；`git stash pop` 无冲突，地图、场景、协议、checkpoint、测试和文档文件均未被线上提交触碰。
- 2026-08-02 20:41：基于新基线 `490e0f6` 重新完成 browser/Worker/server build 和 budgets：browser entry 1,060,362/1,075,000，CSS 44,804/45,000，Worker 449,977/450,000，standalone 469,510/470,000，均 PASS。最新 `dist/` 再次通过 Chrome MCP：14320 墙批次、8 POI、8 独立铺装，console 无 error/issue；页面关闭到只剩 `about:blank`，8798 preview 与 Chrome/MCP 进程无残留。
- 2026-08-02 20:43：post-pull reviewer 复核通过，未解决 blocker/high/medium 均为 0。已在 `main@490e0f6` 提交功能、测试与工程文档，commit 为 `643b5bb feat: generate realistic random town blocks`；本 plan 的最终审查与交付记录单独提交。
- 2026-08-02 20:54：交付完成。审查/验证 plan 提交为 `9fc05bb docs: record random town validation`，两项提交已推送到 `origin/main`。GitHub Actions run `30766391067` 成功：Node 24 typecheck、完整 unit/Worker/standalone 测试、browser/Worker/server build、budgets、Docker image 与只读非 root 容器 `/health` smoke、GitHub Pages deploy 全部通过；非 tag 的 release 与 Docker publish 正常跳过。
- 2026-08-02 20:54：Cloudflare Pages 对 commit `9fc05bb` 部署成功；Workers Build ID `09884ab5-677e-4b47-886c-6d559f4e1838` 成功，实际 production Worker Version ID 为 `716a0321-87c5-4ca5-a217-c4dd0e7130b3`。`npm run test:multiplayer:production` 已对 `https://lastlinep2p.011203.xyz` 通过真实 HTTP/WebSocket smoke，确认 welcome 使用 protocol 5。记录提交前已再次 `git pull --ff-only origin main`，结果 `Already up to date`。

## Review

### 2026-08-02 独立审查第 1 轮

- 审查范围：按 `main@7ffb5c2` 对照 `git diff 7ffb5c2`，静态审查随机道路/BSP 地块、建筑、连廊门洞、POI/落点/掩体消费、island 兼容性和新增测试；未重复 Build 已记录的 typecheck、测试、构建、budgets 或 MCP 浏览器命令。
- 结论：**不通过，阻止提交**。
- **Medium — POI 与 landing zone 会落入权威建筑体内。** `src/config/townMap.ts:138`–`src/config/townMap.ts:142` 在建筑生成后，仅按街区中心加随机偏移生成点位，没有对该街区的建筑、楼梯或可用院落做净空选择；`src/client/render/scenes/IslandScene.ts:1279` 又直接在这些坐标创建水塔、集装箱和信标。定向采样 seeds `0/1/2/7/19/42/99/2026/314159` 时，每个 seed 有 `2–7/8` 个主 POI 中心位于建筑 footprint 内，且 `8–13/16` 个 landing zone 位于建筑内；例如 seed `42` 的灰炉广场、旧火车站、仓储港区、老城区、城市公园均穿楼。这违反 POI/landing 消费随机街区时不得与建筑/坡道重叠的验收，也会让视觉 POI 与权威几何互相穿插。Builder 需从随机街区的真实空地/道路节点中确定性选择并加入建筑、坡道和必要掩体净空测试。
- **Medium — “同 seed deterministic”测试被布局缓存掩盖。** `tests/unit/townMapLayout.test.ts:19`–`tests/unit/townMapLayout.test.ts:23` 连续调用 `createMapLayout("town", 42)` 后只断言引用相同；`src/config/map.ts:210`–`src/config/map.ts:214` 的缓存保证第二次根本不会重新执行生成器，所以即使生成器内部引入非确定性该测试仍会通过。Builder 需绕过/清空缓存或直接对两次独立 `createTownMapBlueprint(42)` 的结构做深相等断言，才能覆盖用户要求的可复现性。
- 已确认：不同 seeds `1/2` 的中心/footprint、道路 span 变体和 64 街区 pattern 断言有效；定向扫描 3,000 个 seeds 未发现核心楼体重叠或侵路，抽查 seeds 的楼梯地形净空与桥门坐标一致；448/233/54/32/250 数量、LOS、AI、island golden、town 专属 operation budget 和 MCP 清理采用 Build 已记录证据。共享 facade helper 的新增可选坐标当前仅由 town skybridge 调用，普通/island 门面仍走原分支。
- 未解决计数：**blocker 0，high 0，medium 2，low 0**。两项 medium 修复并补充针对性验证后必须重新发起独立复审。

### 2026-08-02 独立审查第 2 轮

- 审查范围：完整重读本 plan 后，按 `main@7ffb5c2` 静态复审全部 diff，重点检查第 1 轮两项 medium 的处置、POI/landing 全路径净空、visual footprint、联机兼容版本、checkpoint 恢复、island、AI/loot/LOS/bridge 语义。未重复已记录的 typecheck、完整测试、构建、预算、MCP 或 3,000-seed 检查；仅用最小只读脚本核实未被现有测试覆盖的道路/POI/cover 几何。
- 第 1 轮 finding disposition：
  - **已解决 — POI/landing 穿楼。** `src/config/townMap.ts:218`–`src/config/townMap.ts:235` 的全部随机候选和确定性网格兜底都统一经过 `pointClearsTownBuilding`；10m 楼体净空覆盖楼内坡道/楼梯，`src/config/townMap.ts:269`–`src/config/townMap.ts:279` 另保留一层 front 门外净空。`tests/unit/townMapLayout.test.ts:109`–`tests/unit/townMapLayout.test.ts:161` 对 9 个 seed 的 16 个落点检查楼体、坡道和入口，且 Build 已记录 0–2999 seed 生成压力证据。
  - **已解决 — determinism 测试被缓存掩盖。** `tests/unit/townMapLayout.test.ts:19`–`tests/unit/townMapLayout.test.ts:25` 直接独立调用两次 `createTownMapBlueprint(42)`，同时断言不同引用和结构深相等，确实绕过 `createMapLayout` 缓存并覆盖生成器本身。
- 结论：**不通过，阻止提交**。
- **High — 权威地图算法改变但联机协议版本未提升。** 当前 diff 让同一个 `mapId/mapSeed` 从固定 `3×2` 街区变为完全不同的道路、楼体、门洞、桥和掩体，但 `src/network/protocol.ts:17` 仍为基线的协议 `4`。客户端会本地重建 `MapLayout`，而 `src/network/MultiplayerClient.ts:316`–`src/network/MultiplayerClient.ts:325` 只按该常量拒绝旧客户端；因此缓存中的旧 Pages 客户端会接受新 Worker 的 welcome，以旧固定几何渲染新服务端的随机权威碰撞、LOS 和 loot。Builder 必须提升协议版本、更新对应测试/文档，并按 AGENTS 的维护 rollout 执行；这是共享 multiplayer 变更，提交和发布前需完成相应 Worker/standalone 合同与生产部署/smoke 要求。
- **High — 权威地图语义改变但 checkpoint 版本仍兼容旧房间。** `src/server/MatchRuntime.ts:21` 的 `MATCH_CHECKPOINT_VERSION` 在基线和当前均为 `3`，`src/server/MatchRuntime.ts:350`–`src/server/MatchRuntime.ts:351` 因而会接受由旧固定 town 几何产生的 actor/loot checkpoint；`worker/GameRoom.ts:688`–`worker/GameRoom.ts:702` 随后用新随机布局恢复这些旧坐标。结果可能把存活角色和物资恢复进新楼墙、楼梯或道路障碍，直接违反 `docs/architecture.md:81` 和 `docs/deployment.md:319` 声明的旧权威地图 checkpoint 必须关闭。Builder 必须提升 checkpoint 版本并覆盖旧版本房间被关闭/删除、当前版本仍可恢复的 Worker 与 standalone 合同。
- **Medium — 新 POI 仍不是可保留的真实公共空间，且会与权威道路掩体穿插。** `src/config/townMap.ts:218`–`src/config/townMap.ts:258` 将 75% 候选放在街区边界道路轴内侧仅 `0.5–2.5m`，而 `src/client/render/scenes/IslandScene.ts:912`–`src/client/render/scenes/IslandScene.ts:915` 把道路中心 `3.75m` 设为正式路面；9 个代表 seed 的全部 8 个主 POI 均距道路轴仅 `0.51–2.43m`，所以水塔、信标和集装箱实际落在车行道中央。更重要的是 `src/config/map.ts:685`–`src/config/map.ts:730` 在 POI 之后生成权威 cover 时不消费 POI footprint：最小复现 seed `7` 的“仓储港区”两只集装箱与 `town-cover-20` fence 相交，seed `19` 的“铸造工业园”与 `town-cover-26` 也相交。现有 public-space 测试只检查点中心相对楼体/坡道/门口，未检查真实 POI mesh footprint、道路、cover 或 tree。Builder 需基于各 POI 实际 footprint 在人行道/院落选择点位，并把保留区传给 cover/tree 生成，增加道路和完整 visual footprint 对全部权威障碍的回归断言。
- 其余 disposition：静态审查未发现新增的建筑/BSP 生成失败路径、island 语义变化或 bridge/facade 回归；共享 facade helper 的偏移分支仍仅由 town skybridge 使用，island golden、448/233/54/32/250、AI/loot/LOS/operation budget 和 MCP 清理沿用 Build 已记录证据。
- 未解决计数：**blocker 0，high 2，medium 1，low 0**。以上 high/medium 全部解决并补齐针对性合同/几何验证后，必须发起第 3 轮独立复审。

### 2026-08-02 独立审查第 3 轮

- 审查范围：完整重读本 plan 后，按 `main@7ffb5c2` 静态复审全部 diff，重点检查协议 5、checkpoint 4、8×18 公共空间、共享 terrain/常量、Worker/standalone 合同、预算相关精简、island、AI/loot/LOS/bridge。未重复已记录的 typecheck、完整 unit/standalone、构建、budgets、MCP 或 3,000/100-seed 检查；仅使用最小只读脚本核实未被现有测试覆盖的道路肩部、地形网格和 visual-only natural detail 风险。Worker runtime 的本机 glibc 缺口不作为代码 finding。
- Round 2 finding disposition：
  - **已解决 — protocol 5 隔离旧客户端。** `src/network/protocol.ts:17` 已提升为 `5`；`src/network/MultiplayerClient.ts:316`–`src/network/MultiplayerClient.ts:325` 对 welcome 做严格相等检查，因此旧协议 4 Pages 客户端会拒绝新 Worker，新客户端也会拒绝旧 Worker。`tests/unit/multiplayerClient.test.ts:43`–`tests/unit/multiplayerClient.test.ts:75` 固定版本 5 并覆盖前一版本 mismatch；生产 smoke、Worker welcome 和 standalone welcome 均消费同一常量。`docs/architecture.md:55` 与 `docs/deployment.md:319`–`docs/deployment.md:320` 已同步协议 5 和维护 rollout。
  - **已解决 — checkpoint 4 淘汰旧权威地图。** `src/server/MatchRuntime.ts:21` 已提升为 `4`，兼容检查仍为精确版本相等；`worker/GameRoom.ts:118`–`worker/GameRoom.ts:149` 在 Worker/standalone 共用构造恢复路径中对旧 running/finished checkpoint 执行 `storage.deleteAll()`。unit 覆盖当前版本可恢复及版本 3 拒绝；Worker 合同覆盖旧 checkpoint 淘汰，standalone 合同跨 SQLite 环境重启后同时断言 `room-v1`、`checkpoint-v1` 删除；`tests/standalone/standaloneServer.test.ts:152`–`tests/standalone/standaloneServer.test.ts:242` 继续以当前 checkpoint 验证真实 town HTTP/WebSocket 重启恢复。
  - **部分解决 — 8×18 公共空间。** `TOWN_POINT_HALF_WIDTH=4`、`TOWN_POINT_HALF_DEPTH=9` 与最大仓库四集装箱 footprint 一致；生成、cover、authoritative tree、terrain 和测试共享这些常量。代表 seed 的最小复核未发现公共空间与建筑、坡道、入口、skybridge、cover、authoritative tree 或 rock 相交，Round 2 的 seed 7/19 fence 穿插已消失。但下述道路肩部和 visual-only detail 问题仍使该 finding 不能关闭。
- 结论：**不通过，阻止提交**。
- **Medium — 公共空间仍侵入实际渲染道路肩部，且测试复用了错误边界。** `src/config/townMap.ts:74`–`src/config/townMap.ts:77` 把道路半宽定义为 `3.75m`、额外净空为 `1.5m`，所以 `src/config/townMap.ts:221`–`src/config/townMap.ts:236` 只保证 POI footprint 离轴线 `5.25m`；但 `src/client/render/scenes/IslandScene.ts:909`–`src/client/render/scenes/IslandScene.ts:912` 的实际 shoulder 一直铺到轴线 `6m`。代表 seeds 的最近 footprint 边缘仅为 `5.27–5.73m`，每个 seed 都有公共空间压入 shoulder。`tests/unit/townMapLayout.test.ts:137`–`tests/unit/townMapLayout.test.ts:145` 只断言同一组 `3.75+1.5` 常量，因此无法发现 presentation 契约漂移。Builder 需共享正式路面和肩部的真实半宽，按 `6m` 外再保留所需净空，并增加与场景道路分类一致的断言。
- **Medium — 8m 铺装宽度无法由当前 12m terrain 顶点网格稳定表达。** `src/config/map.ts:137`–`src/config/map.ts:139` 与 `src/client/render/scenes/IslandScene.ts:593`–`src/client/render/scenes/IslandScene.ts:595` 形成 12m 顶点间距；`src/client/render/scenes/IslandScene.ts:914`–`src/client/render/scenes/IslandScene.ts:923`、`src/client/render/scenes/IslandScene.ts:930`–`src/client/render/scenes/IslandScene.ts:938` 却只在顶点进入 8×18 矩形时标记 town paving/highlight。最小采样中 seed 42 的 8 个主 POI 有 5 个在 X 方向没有任何地形顶点落入 8m footprint，seed 19 有 6 个，因而这些公共空间不会形成声明的完整铺装。Builder 需用不依赖单个顶点命中的 terrain 分类/独立铺装 mesh，或让采样分辨率足以稳定表示 8m footprint，并加入实际 ground/submesh 回归。
- **Medium — visual-only shrub 仍会与 POI 模型穿插。** 权威 cover/tree/rock 已避让保留区，但 `src/client/render/scenes/IslandScene.ts:1241`–`src/client/render/scenes/IslandScene.ts:1293` 的装饰岩石/灌木仍通过 `randomNaturalPosition` 生成；`src/client/render/scenes/IslandScene.ts:2291`–`src/client/render/scenes/IslandScene.ts:2295` 只检查权威 obstacles，不检查 town 公共空间。按真实 low/medium/high 数量和 RNG 消耗复现：seed `1` 的“铸造工业园”在三档画质均有 shrub 与仓库集装箱相交，seed `2` 的“仓储港区”在 medium/high 也相交。Builder 需让 town visual natural details 消费同一保留区，且不能改变 island 的现有视觉随机序列，并补充 NullEngine 或纯几何回归。
- 其余 disposition：预算文件和阈值未改，最终产物证据采用 Build 已记录结果；岛屿 terrain 分支保持旧尺寸/圆形 highlight，golden 与 scene 证据未见回归；AI loot、LOS、operation budget、448/233/54/32/250、bridge opening/floor/navigation 仍有既有验证。协议变更后仍须按 AGENTS 在实际发布阶段完成 Worker 新版本确认和生产 smoke，这属于尚未执行的交付步骤，不是本轮新增代码 finding。
- 未解决计数：**blocker 0，high 0，medium 3，low 0**。三项 medium 修复并补齐针对性 presentation 验证后，必须发起第 4 轮独立复审。

### 2026-08-02 独立审查第 4 轮

- 审查范围：完整重读本 plan 后，按 `main@7ffb5c2` 静态复审全部 diff，重点检查 Round 3 的 shoulder 退线、14.25m 核心楼体 setback、独立 POI paving、natural detail 生产 helper、测试提取，以及 protocol 5、checkpoint 4、island、AI/loot/LOS/bridge 和预算契约。未重复已记录的完整 typecheck、405 unit、21 standalone、构建、budgets、MCP 或 3,000/100-seed 检查；仅用最小只读脚本检查代表 seed 的铺装地形平整度、town detail 数量，以及 island placement 对基线算法的逐项一致性。
- Round 3 finding disposition：
  - **已解决 — 真实 road shoulder 外再留 1.5m 净空。** `src/config/townMap.ts:74`–`src/config/townMap.ts:78` 分离正式路面 `3.75m` 与 shoulder `6m`；`src/config/townMap.ts:222`–`src/config/townMap.ts:237` 按 `6m + 1.5m + footprint` 生成全部随机和 fallback 候选，`tests/unit/townMapLayout.test.ts:137`–`tests/unit/townMapLayout.test.ts:145` 使用 shoulder 常量验证同一契约，`src/client/render/scenes/IslandScene.ts:930`–`src/client/render/scenes/IslandScene.ts:955` 也消费相同 road/shoulder 常量。14.25m 核心 setback 为 8×18 临街空间保留净空；Build 已记录 seeds 0–2999 生成、47.51%–48.98% 覆盖率、完整 Bot/LOS/bridge 验证，未见密度或权威可走性回归。
  - **已解决 — 8×18 独立铺装摆脱 12m terrain 网格限制。** `src/client/render/scenes/IslandScene.ts:859`–`src/client/render/scenes/IslandScene.ts:873` 只为 town 的 8 个主 POI 创建 `town-poi-paving-*`，尺寸严格消费 `TOWN_POINT_HALF_WIDTH/DEPTH`，中心高度为权威 terrain 加 `0.015m`，使用既有 POI 强调材质并保持 non-pickable/non-colliding。代表 seeds 的 8×18 footprint 高度差均为 0；NullEngine 测试检查数量、命名、中心和世界包围盒，MCP 已记录实际 8 个铺装。island 不创建该 mesh，原 terrain POI 分类保留在 `mapId === "island"` 分支。
  - **已解决 — natural detail 同源且不改变 island RNG。** `src/client/render/scenes/IslandScene.ts:1266`–`src/client/render/scenes/IslandScene.ts:1367` 由 scene 和测试共同消费 `createNaturalDetailPlacements`；位置搜索、失败时跳过、成功后 rotation 随机数、rock 后 shrub 的顺序与基线完全一致。town-only 条件位于 `src/client/render/scenes/IslandScene.ts:2364`–`src/client/render/scenes/IslandScene.ts:2376`，使用全部 16 个 landing/public-space footprint 与 clearance。最小复核确认 seeds 1/2 的 low/medium/high 分别稳定产生 76/152/228 placement，且 island seeds 0/42/2026 三画质输出与基线算法逐项完全相等；NullEngine 最终 mesh 和纯 placement 回归覆盖 reviewer 原复现路径。
- 结论：**通过；本轮未发现明确的 blocker、high 或 medium 问题。**
- 其余确认：protocol 5 的严格 welcome 隔离、checkpoint 4 的 Worker/standalone 旧存储删除与当前版本恢复仍闭环；island golden、terrain/perimeter 分支和 visual RNG 保持；预算文件及阈值未改，最终产物余量采用 Build 已记录证据；测试提取复用生产 helper，没有复制第二套 placement 算法。Worker runtime 的本机 glibc 缺口是已记录环境限制，不构成代码 finding。
- 残余交付门禁：由于本次包含协议和共享 multiplayer 变更，提交/发布阶段仍须按 AGENTS 执行 commit 前 pull、Node 24 CI Worker suite、维护 rollout、确认新 Worker version，并在生产 endpoint 运行 `test:multiplayer:production`；这些是尚未执行的发布步骤，不影响本轮代码审查通过。
- 未解决计数：**blocker 0，high 0，medium 0，low 0**。

### 2026-08-02 Commit 前 post-pull 复核

- 审查范围：重读最新 Build 与 Round 4 后，以快进后的 `main@490e0f6` 为基线静态审查 `git diff 490e0f6`，并单独审查新基线提交 `490e0f6 fix: compact menu settings layout` 的 `.gitignore` 与 `src/styles/main.css`。未重复 plan 已记录的 build、budgets 或 MCP。
- 基线合并 disposition：新提交与当前功能 diff 没有任何重叠文件，stash pop 后不存在冲突标记或残留 CSS/.gitignore 工作区 delta。`.gitignore` 仅新增 `.opencode`，未忽略 `.agents/plans/`、地图/场景/协议源码、测试或文档；当前唯一未跟踪文件仍是本 plan。
- 菜单 CSS disposition：compact layout 仅让 `.ai-sniper-setting` 保持普通双列项，并在窄屏继续使用双列 grid、缩小 toggle 文案间距；`GameApp` 中地图选择仍是首个 `<select data-setting="map-id">`，事件绑定、持久化、单人启动与联机房间 mapId 读取均未改变。该 CSS 不作用于 `IslandScene`、terrain、POI paving、HUD/minimap 或协议呈现，未发现与随机 town 场景的交叉回归。
- 当前功能 diff disposition：相对 `490e0f6` 的 15 个改动文件与 Round 4 审查范围一致；protocol 5、checkpoint 4、6m shoulder、14.25m setback、8×18 paving、town-only natural detail 避让、island 分支及测试合同均未因快进发生语义变化。`git diff --check 490e0f6` 通过，无冲突标记、遗留 TODO/FIXME 或禁止的 `context.Background()`。
- 结论：**post-pull 复核通过；未发现 blocker、high 或 medium 合并风险，可以进入 commit 步骤。**
- 残余发布门禁不变：commit 后仍需按 AGENTS 完成 Node 24 CI Worker suite；协议 5 发布必须使用维护 rollout，确认新 Worker version 并运行 production multiplayer smoke。
- 未解决计数：**blocker 0，high 0，medium 0**。
