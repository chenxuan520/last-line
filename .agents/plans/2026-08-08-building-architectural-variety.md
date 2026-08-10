# Building Architectural Variety

## Context

三张地图原本只在建筑尺寸、颜色、层数和少量高画质装饰上变化，主体仍是重复矩形盒子。用户指出建筑与屋顶轮廓过于一致是缺乏真实感的重要原因。本轮在 `feat/building-architectural-variety` 分支上处理建筑体量，不把生成器细节写入 README。

## Contract

- 保留每个种子化建筑占地、层数、楼梯间、门、窗、楼板、连桥、物资点、医院、弹药库、道路避让和地图区域身份。
- 为苍岬岛、灰炉城和烬岚郡建筑添加由 `mapId + mapSeed + buildingId` 决定的稳定轮廓，使相邻建筑不再重复相同体量。
- 用户没有要求屋顶周边护栏或女儿墙。禁止沿屋顶边缘生成连续矮墙；建筑差异必须通过立面柱、檐口和内缩、有明显宽度与深度的屋顶机房/设备体块表达。
- 大型实体轮廓必须加入权威 `MapLayout.wallSegments`，由 Movement、`SimulationCombatWorld`、投掷物碰撞、GridNavigator、服务端权威逻辑和 Babylon 共同使用。禁止纯表现掩体或第二套碰撞表示。
- 屋顶保持平坦且可通过现有内置楼梯到达。禁止添加视觉坡度与权威可行走表面不一致的坡屋顶。
- 新增体块必须避开楼梯屋顶开口和连桥孔洞，不得阻挡门、窗、连桥、内部楼梯路线或屋顶到达点。
- 同一地图和种子的轮廓选择必须稳定，在代表性种子间有实际变化，并与画质无关。
- 轮廓几何按材质/角色批处理，场景资源保持有界。
- 权威碰撞变化必须提升严格联机协议和 checkpoint 兼容版本。删除误加护栏后，协议提升到 11，checkpoint 提升到 10。
- 所有可见结果必须在本机 Chrome/Edge MCP 的 production build 中检查，音量设为 `0`。Builder 必须亲自查看三张地图截图，确认屋顶护栏彻底消失，体量、裁剪、重叠、开口和画质一致性正确。

## Plan

1. 用会失败的地图布局测试锁定轮廓多样性、权威墙体接入、楼梯/门窗/连桥避让和多种子覆盖。
2. 在不改变基础建筑位置的前提下，从稳定建筑事实派生轮廓。
3. 删除重复或误导的高画质纯表现轮廓盒。
4. 在所有画质中渲染并批处理共享权威轮廓。
5. 添加 NullEngine 场景测试，覆盖三图可见性、画质独立、批次上限、材质隔离和资源预算。
6. 更新 `AGENTS.md`、架构文档和当前 Plan。
7. 运行聚焦测试、完整 typecheck/test/build/budget 和 `git diff --check`；不运行覆盖率，最多使用 7 个 worker。
8. 在音量 `0` 下完成三张地图 production MCP 截图检查并立即清理。
9. Reviewer 通过后提交、推送并请求 Codex，后续 Finding 直接进入修复轮次。

## Build

- 2026-08-08：确认 `wallSegments` 已共同驱动移动、hitscan/视线、投掷物 sweep、导航、服务端权威逻辑和 Babylon 渲染，`floorSlabs` 与 `roofRamps` 提供屋顶支撑和内部通行。
- 2026-08-08：添加 6 类确定性轮廓。初始实现错误地让每栋建筑生成 5 段屋顶周边 `roof-edge` 矮墙，并把它们当作轮廓差异。
- 2026-08-08：权威轮廓使用完整 Babylon 盒体和 thin-instance 矩阵，尺寸/中心与权威记录一致；修复了零厚度平面和建筑材质发黑问题。
- 2026-08-08：Movement 只对基础立面添加旧屋顶厚度补偿，权威建筑体块使用显式高度，与战斗、投掷物、导航和渲染一致。
- 2026-08-08：初始权威几何变更把协议从 9 提升到 10、checkpoint 从 8 提升到 9。Node 24 应用测试、standalone、三项目 typecheck、各构建、预算和三图 MCP 当时均通过。
- 2026-08-09：用户明确指出屋顶护栏不是需求。后续修复从生成器中彻底删除 `roof-edge` 和薄片式 `roof-screen`，保留立面柱/檐口，并用内缩屋顶机房、设备房和监视顶表达建筑体量。
- 2026-08-09：删除护栏改变相同地图种子的权威碰撞；严格联机协议提升到 11，checkpoint 兼容版本提升到 10，旧客户端和旧房间必须拒绝或删除。
- 2026-08-09：新增权威六边形/近圆形外墙后，中画质 50 角色生产场景实测总顶点 `645,939`、总索引 `1,587,390`、唯一几何顶点 `472,489`、唯一几何索引 `1,044,006`。增长来自真实多边形外墙、开口和楼板，不是重复场景对象或纯表现护栏。根据用户允许相应放宽资源限制的决定，确定性门槛分别从 `590,000 / 1,550,000 / 420,000 / 960,000` 调整为 `660,000 / 1,620,000 / 485,000 / 1,070,000`；mesh、transform node、材质和 geometry 数量门槛保持不变。该门槛调整必须由本轮 Reviewer 作为明确架构/资源 Review 项复核。
- 2026-08-09：完整 `IslandScene` 文件连续创建多张高密场景时，Vitest fork worker 达到 Node 默认约 4GB heap 上限并 OOM；机器仍有 232GB 可用内存，单独资源用例在 8GB 临时上限下 13 秒完成。单元测试配置为 worker 设置 6GB V8 heap 上限，让标准 `npm run test:unit` 无需人工环境变量即可执行既有高密场景套件；worker 数量和业务测试内容不变。该可执行测试配置变更同样纳入本轮 Reviewer。
- 2026-08-09：特殊轮廓楼板改为按楼梯井精确切分，避免粗条带误删远大于开口的屋面；共享屋顶安全点同时避开楼梯井、权威屋顶体块和 0.5m 导航到达容差。地图导航与真实 `MovementSystem` 均覆盖矩形、六边形和近圆形建筑的双向上下楼。
- 2026-08-09：移动、战斗/视线、手雷 sweep、掉落、GridNavigator 和 BotController 均切换到共享旋转/多边形几何。斜门内外方向与门内物资位置使用同一 `wallOpeningOutwardDirection`；岛屿旧稳定 payload 对比确认地图点、地形、建筑、医院、石头、树、掩体、前 250 物资和道路 `0` 个字段漂移。
- 2026-08-09：灰炉城连桥先由 32 条提高到 48 条，随后按用户反馈进一步提高到 56 条；56 条桥从 64 个核心街区中按种子确定性选择，仍保留 8 个无桥街区。烬岚郡城镇区域先稳定生成 6 条短连桥，随后提高到 8 条，并继续同时覆盖 X/Z 方向、端点侧唯一且每栋建筑最多参与两座桥。20 个代表种子统计：岛屿矩形/六边形/近圆形约 `81.79% / 11.64% / 6.57%`；灰炉城与烬岚郡因医院、弹药库和桥端强制矩形，整体矩形约 `85.7%`，特殊建筑仍保持少数。
- 2026-08-09：受影响移动/战斗/掉落/导航 `77/77`、地图与城镇高种子回归 `68/68`、完整 `IslandScene` `27/27`、BotController `58/58`、standalone 真实集成 `33/33` 通过。完整源码单元最终轮次另行记录在完成前验证中；未运行覆盖率。
- 2026-08-09：三目标 typecheck、浏览器 production build、Worker dry-run、服务端 bundle、同源 standalone build 和预算通过。最终产物：浏览器入口 `1,159,319 / 1,200,000`，最大非入口 `599,667 / 700,000`，全部浏览器 JavaScript `3,842,090 / 4,000,000`，chunk `252 / 270`，CSS `45,225 / 50,000`，整个 `dist` `4,665,255 / 4,700,000`，Worker `599,873 / 615,000`，standalone `611,863 / 630,000`。
- 2026-08-09：最终冷灰地表修复后，完整源码单元 `50 files / 570 tests` 再次通过；浏览器入口变为 `1,159,137 / 1,200,000`，全部浏览器 JavaScript `3,841,908 / 4,000,000`，整个 `dist` `4,665,073 / 4,700,000`，Worker `599,637 / 615,000`，standalone `611,627 / 630,000`。本机 `npm run test:worker` 在任何测试执行前因 Debian glibc 2.28 无法加载要求 GLIBC 2.29–2.35 的 `workerd` 而失败；Worker TypeScript 编译和 dry-run bundle 已通过，最新分支 CI 的 Node 24 Worker 套件仍是交付门禁。
- 2026-08-10：Codex 在远端提交 `d341a7b` 发现特殊多边形建筑楼板仍用轴对齐矩形条带近似，灰炉城 seed `7` 的五层六边形建筑 `town-building-51-5` 在斜边内部点 `(-163.562, 506.272)` 没有权威支撑。进一步对 seed `7` 的全部特殊建筑做 `80 × 80` 网格扫描，确认只调整条带 X 范围仍会在斜边附近漏支撑，因此没有保留表面修补。
- 2026-08-10：多边形楼板改为凸多边形裁剪片段：普通楼层按墙厚内缩，屋顶覆盖完整轮廓，楼梯井前后分别裁剪。`MapFloorSlab.footprintVertices` 成为移动支撑/天花板、空间索引、hitscan/视线、手雷 sweep 和 Babylon 楼板网格共同消费的精确权威几何；矩形楼板继续使用原盒体路径。边界点判断跳过零长度边，避免重复顶点把任意点误判为多边形边界。
- 2026-08-10：新增真实 seed `7` 回归，覆盖五层内部点逐层支撑、外接矩形角点无虚假支撑、向下射击只在真实屋顶轮廓内命中，以及 NullEngine 渲染顶点与权威 `footprintVertices` 一致。系统扫描结果为内部采样 `245,683` 个、漏支撑 `0` 个；外部采样 `138,316` 个、虚假支撑 `0` 个。
- 2026-08-10：P1 修复后的受影响地图/移动/战斗套件 `92/92`、完整 `IslandScene` `29/29`、完整源码单元 `575/575`、standalone `33/33` 通过；三目标 typecheck、浏览器 production、Worker dry-run、服务端 bundle、同源 standalone build、预算和 `git diff --check` 均通过。最终产物为浏览器入口 `1,162,825 / 1,200,000`，全部浏览器 JavaScript `3,845,596 / 4,000,000`，整个 `dist` `4,668,761 / 5,000,000`，Worker `607,524 / 615,000`，standalone `618,990 / 630,000`。
- 2026-08-10：production Chrome MCP 使用真实 `createIslandScene` 固定查看 seed `7` 的 `town-building-51-5` 五层屋顶。Builder 亲自确认完整六边形屋顶连续、斜边没有矩形悬挑或原先的空条带；控制台只有 Babylon 启动日志与 SwiftShader 警告。验收后立即导航到 `about:blank`、停止 `4173` 服务并删除 `/tmp/last-line-polygon-slab-visual*`。
- 2026-08-10：本地合并 `origin/main@978c8b1`，保留主线已审阅的浏览器 `dist` 上限 `5,000,000`，工作区无冲突标记且 `origin/main` 是当前 `HEAD` 的祖先。GitHub PR 暂时显示冲突仅因为远端功能分支仍停在 `d341a7b`，尚未收到本地 merge commit 与本轮 P1 修复；不需要改写历史或强推。

## Review

### 2026-08-08 Reviewer Round 1

- 结论：不通过，发现 1 个 high 和 1 个 medium。
- High：Babylon 把权威建筑体块压成零厚度平面，导致视觉表面与权威碰撞不一致。
- Medium：Movement 给建筑轮廓额外增加 0.18m 高度，而战斗、投掷物、导航和渲染使用显式高度。

### 2026-08-08 Finding Disposition and Re-review

- 零厚度问题通过完整单位盒和 exact thin-instance 矩阵解决；NullEngine 验证每个记录的尺寸、中心和聚合边界。
- Movement 额外高度只保留给基础立面；建筑轮廓与其他系统使用同一显式高度。
- 修复后三项目 typecheck、场景 `26/26`、受影响地图/移动/战斗 `5 files / 122 tests`、standalone `3 files / 33 tests`、各构建、预算和三图 MCP 均通过。
- Reviewer Round 2 通过，当时没有剩余 blocker、high、medium。

### 2026-08-09 User Correction Round

- 用户指出此前所谓“建筑轮廓”主要变成了屋顶护栏，偏离需求。
- 本轮必须验证所有 `roof-edge` 记录为 0，屋顶机房/设备体块有真实宽度和深度、内缩于建筑占地、避开楼梯开口。
- 必须重新进行三张地图 production MCP，亲自确认屋顶周边没有连续护栏，并完成 Reviewer 与 Codex 闭环。

### 2026-08-09 Reviewer Round 1

- 结论：不通过，发现 4 个 medium；未发现 blocker 或 high。Reviewer 接受确定性场景预算调整与 Vitest worker 6GB heap，认为二者有实测依据且没有删测试、增加 worker 或放宽对象数量门槛。
- Medium Finding 1：混合地图原 6 条桥未在算法上保证 X/Z 双方向，且相同 `buildingId + side` 可能重复使用，开口生成又通过 `find()` 错绑第一座桥。修复后候选按端点侧去重，先确定性选择兼容的 X/Z 各 1 条再填满；墙体开口直接携带具体桥引用。一层城镇建筑可以成为短桥候选，被选中后确定性提升到两层并生成完整内楼梯/楼板，桥间隙仍不超过 36m。用户随后要求增加连桥，最终数量提高到 8 条；100 个 mixed seed 扫描和聚焦测试验证 8 条、双方向、端点唯一、桥端至少两层且门洞与桥中心对齐。
- Medium Finding 2：`town-poi-paving` 的一半仍使用棕橙 `poiAccent` 覆盖大面积城市地面。修复后铺地只使用 `poi-dark-material` 与灰色 `road-shoulder-material`；`poiAccent` 仅保留给小面积锈迹/工业道具。场景回归明确禁止 POI 铺地使用 `poi-accent-material`。
- Medium Finding 3：架构文档仍写灰炉城 32 条桥，纹理 Plan 又声称所有场景预算不变。架构文档先更新为 48 条，并在用户追加连桥需求后同步为最终 56 条；纹理 Plan 明确自身只放宽原始 `dist`，多边形建筑场景预算调整属于建筑 Plan 中由独立 Reviewer 复核的资源决策。
- Medium Finding 4：当时把历史 Plan 中的英文自然语言标签视为待翻译内容。用户后续明确否定该处理：历史 Plan 是已完成任务的事实记录，不应批量翻译；最终由 `8171291` 逐字恢复为 `origin/main` 原文。
- Reviewer 额外指出 Bot 撤退掩体仍按世界轴矩形估算是 Low Finding；导航会拒绝非法落点，本轮不扩大到该非阻塞优化。
- 修复后验证：三目标 typecheck 通过；首轮 100 个 mixed seed 扫描全部满足 6 条桥、X/Z 双方向、端点侧唯一和桥端至少两层；受影响逻辑 `5 files / 161 tests`、完整 `IslandScene` `27/27` 通过。用户追加连桥需求后，100 个 mixed seed 重新验证最终 8 条桥、X/Z 双方向和端点侧唯一，100 个 town seed 验证最终 56 条桥且所有桥端至少两层。灰炉城与烬岚郡 production Chrome 复拍均使用音量 `0`，确认大面积 POI 铺地为灰色、桥端提升后无穿模/异常拉高，控制台仅 SwiftShader 警告；每轮都立即回到 `about:blank`、停止 preview、删除截图并释放 4173。
- 修复后最终产物与预算：浏览器入口 `1,159,804 / 1,200,000`，最大非入口 `599,667 / 700,000`，全部浏览器 JavaScript `3,842,575 / 4,000,000`，chunk `252 / 270`，CSS `45,225 / 50,000`，整个 `dist` `4,665,740 / 4,700,000`，Worker `601,614 / 615,000`，standalone `613,470 / 630,000`。
- 2026-08-09 用户追加连桥后的最终门禁：Node 24.18.1 三目标 typecheck 通过；完整源码单元 `50 files / 570 tests`、standalone `3 files / 33 tests` 通过；浏览器 production、Worker dry-run、服务端 bundle、同源 standalone build 和预算均通过，最终产物与上一条记录一致。Worker runtime 套件仍在测试执行前被本机 glibc 2.28 阻止，`workerd` 明确缺少 GLIBC 2.29–2.35；Worker typecheck/dry-run 已通过，分支 CI 必须补充运行时证据。
- 2026-08-09 连桥 production Chrome 复验使用音量 `0` 和真实 `createIslandScene` production bundle，通过临时独立验收页把相机放在权威桥记录旁，不修改仓库、权威状态或桥几何。Builder 亲自检查灰炉城 `town-skybridge-0`、烬岚郡 X 向 `mixed-skybridge-0` 与 Z 向 `mixed-skybridge-1`：桥面、两侧栏杆、二层门洞和两端建筑连续，未见悬空、穿墙、异常拉高或农村/森林误生成桥。控制台仅 SwiftShader 警告；每轮即时回到 `about:blank`，最终删除全部 `/tmp/last-line-*` 临时页/产物、停止 4173，并确认无 preview/Vitest 进程。
- 2026-08-10：`8171291` 撤销不符合预期的历史 Plan 批量翻译，29 个历史 Plan 逐字恢复为 `origin/main` 原文；本任务新增的两个 Plan 保留。`AGENTS.md` 同步规定历史 Plan 禁止批量改写，工作流专业术语必须保留英文。

### 2026-08-09 Reviewer Round 3

- 结论：**通过，可进入实现提交。** Blocker、high、medium、low 均为 0。
- Round 2 当时关闭了历史 Plan 中文化 medium；用户后续判定该 Finding 本身不成立。当前最终 Disposition 是恢复全部历史 Plan 原文，并只在本任务新增 Plan 中使用标准英文工作流术语。
- 用户追加的连桥增量通过静态 Contract 复核：灰炉城从 64 个核心街区中按种子选择 56 个生成桥，仍保留 8 个无桥街区；烬岚郡生成 8 条短桥，继续保证 X/Z 双方向、端点侧唯一、每栋最多两桥、桥端至少两层和门洞绑定具体桥。
- `AGENTS.md`、架构文档、部署文档、测试和本 Plan 均使用最终 56/8 数量。Reviewer 接受外层已记录的种子扫描、Node 24 自动门禁、预算和 production Chrome 证据；本机 `workerd` 的 glibc 缺口仍是环境限制，不构成本轮 Finding。

### 2026-08-10 Exact Polygon Floor Slab Final Review

- 结论：**通过，可提交推送。** Blocker、high、medium、low 均为 0。
- `MapFloorSlab.footprintVertices` 在地图生成、移动支撑与天花板、空间索引、战斗射线与视线、手雷 sweep 和 Babylon 渲染中共同表示同一精确几何；矩形楼板继续走既有盒体路径。
- 凸多边形裁剪、楼梯井前后分片、普通楼层墙厚内缩、完整屋顶轮廓、重复顶点边界处理和毫米取整未发现支撑漏洞或虚假支撑；真实 seed `7` 反例测试同时覆盖轮廓内支撑和外接矩形角点无支撑。
- Babylon 多边形棱柱的三角形 winding、法线、UV 与合批属性一致，NullEngine 回归验证渲染顶点来自权威轮廓。
- 本地 merge commit 正确保留 `origin/main@978c8b1` 的 `browserDist = 5_000_000`，未发现无关改动或冲突解决错误。
