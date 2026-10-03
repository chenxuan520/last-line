# Ultra Town Visuals

## Plan

### Context

- 用户认为当前画面廉价，希望向 CS:GO 的写实质感靠近；已同意先制作灰炉城可游玩街区样板、看实际效果后再决定推广。
- 用户明确要求新增比「高」更高的画质档位，随后确认按功能分支流程进行。
- 基线为 `main@e1a542c`，工作区干净；同步最新远端后创建 `feat/ultra-town-visuals`。
- 使用现有 `writer` 流程。主线 production build 已通过，原始浏览器产物 4,684,414B、JavaScript 3,859,652B、252 个 chunk；基线产物临时保存在已忽略缓存，用于同机对比。

- 用户补充明确要求同步美化武器和物品，继续沿用当前极高试做范围。

### Contract

- 新增 `ultra`，菜单显示「极高」，保留默认「中」和低／中／高既有表现。
- 本轮写实增强仅在灰炉城 `ultra` 启用；其他地图的 `ultra` 继承「高」表现，明确标注试做范围。
- 验收聚焦同一 seed、同一街区、同一第一人称视角的高／极高对照，包括室外墙地接触、建筑入口与室内可读性。
- 增强范围为有界局部静态投影、材质表面凹凸和合理纹理尺度；继承既有高画质建筑细节。保持克制自然的光照，不使用暗角或重滤镜。
- 第一人称四种枪械与手雷增加分材质、倒角和装配细节；地面模型使用分部件顶点色与更完整枪械轮廓，保持单材质模板与掉落记录复用。第三人称角色密度和玩法保持不变。
- 阴影只消费既有渲染几何；不新增玩法遮挡，不改变权威地图、建筑、开口、坡道、连桥、物资、AI、协议或 checkpoint。保留医院白色、弹药库专用外观和所有标牌。
- 凹凸信息由已验证的 AssetCatalog 图片 payload 派生并在场景内复用，不重复 fetch，不把新增资源加载变成几何可见性的前置条件。
- 新档位使用与高相同的分辨率、植被密度和帧率上限；额外资源只在试做档位按需创建并随场景释放。保留全部现有性能采样、相对阈值和原始预算，并追加灰炉城极高的运行时与浏览器采样。
- 本轮允许新增档位使用局部静态阴影，原先其他档位不使用动态阴影的约束继续保留；不创建手雷动态灯光或阴影。
- 功能分支内完成实现、验证及独立 Reviewer，之后按已确认流程创建 PR 并请求 `@codex` 审查；合并始终由用户操作。

### Steps

1. 接通画质配置、菜单、持久化和高画质继承；验证方式：定向设置用例与菜单实机状态。
2. 在独立按需模块实现灰炉城极高表现；验证方式：NullEngine 单用例检查几何／材质隔离、纹理降级和生命周期。
3. 构建 production 并使用 Chrome DevTools MCP 静音验证；验证方式：桌面／移动整组件截图、街区同机高／极高截图和资源／帧时间观察。
4. 同步工程文档并完成独立 Reviewer；验证方式：需求、合同、性能、真实截图和所有 Finding 闭环。
5. 提交、推送 PR，等待 required checks 和 Codex 审查；禁止自动合并。

### Round 3 Scope

- 用户继续要求升级人物、地面物品，并强调人物提升必须非常明显；随后追加树木。已确认先放进极高，沿用当前灰炉城试做范围和未合并 PR #9。
- 人物是本轮重点：重做近距离身体、头部、四肢和战术装备轮廓，增加服装与硬质装备的材质层次；保留真实装备显隐、武器挂点、远距离 LOD 和资源回退。此前“不新增人物”的 Build 记录仅描述前一版。
- 地面物品细化几何、表面和贴地摆放；树冠改为有枝叶层次的自然轮廓，树皮增加表面细节。树干位置、数量、权威几何、物资生成／交互规则、角色命中与移动均不变。
- 实现落点为极高表现模块与 IslandScene 的既有模型／物品／植被接入点。人物几何在模板阶段构建并共享，物品继续单材质模板复用，树木继续实例化；禁止逐角色重复生成纹理或逐帧新建细节对象。
- 验证包含 production 人物装备／LOD／生命周期定向用例，场景隔离与物品复用用例，桌面／移动人物、物资和树木实景截图，并延续现有 CI 性能采样及独立 Reviewer。
- 独立 Reviewer 已明确同意追加资源覆盖：仅在 `browser-ultra` 冻结帧时间样本之后，从已加载 production EngineStore 读取真实 mesh／material／geometry／vertices／indices，并确认全部外部角色 GLB base 已加载。原 NullEngine 会使用程序化模型，不能代表人物升级；保留其原采样和全部既有门禁，新字段遵循现有首次 INFO／未来同档位 15% 政策。顶点／索引是逐 mesh 求和，不能当作唯一显存或实际绘制量。

### Round 4 Scope

- 2026-09-12：用户要求苍岬岛、烬岚郡也加入类似效果，并明确选择完整效果，包括人物、武器物品、树木、按地图适配的材质和局部静态阴影。沿用未合并 PR #9 与 `feat/ultra-town-visuals`，当前工作区干净，远端 main 仍为 `e1a542c`。此前灰炉城专属约束在本轮扩展为三地图极高，旧 Build／Review 保留为历史事实。
- 将现有极高模块作为三地图共同入口，人物／装备／树木共享模板、LOD 和生命周期保持不变；补齐岛屿与混合地图已有泥土、碎石、森林地表、灰泥和瓦屋顶的缓存法线，并保留自然地貌配色。建筑收边仍限制于已有真实墙段；平直城市铺装继续只用于灰炉城，避免在山坡和乡村道路上产生悬空长板。
- 每张地图使用一张既有规格的局部缓存静态阴影图；不增加角色动态阴影、权威树木、碰撞、玩法、网络或 checkpoint 变化。默认中画质和低／中／高保持原样，菜单改为三地图通用的「极高」。
- 接入与文档落点：`IslandScene`、极高表现模块、菜单及其既有用例、README、架构／资源说明与当前 AGENTS 极高范围；不扩展其他玩法文档或重写历史 Plan。
- 验证：按地图分别运行单个场景隔离和真实人物 GLB 定向用例；production 桌面与移动截图覆盖两张新增地图的完整人物、物品、植被、地表／建筑和菜单／HUD上下文。同步追加两地图 runtime／browser 极高性能场景，保留原样本、预热、轮次、窗口、指标、首次基线政策与 15% 门禁；追加采样须经独立架构／资源 Review。
- 独立 Reviewer 已明确批准新增 island seed 7、mixed seed 395 的 runtime／browser 极高采样，要求 compare 与 baseline 两路径均覆盖，新增场景逐个验证缺失／非法指标失败，保留全局能力探测与首次 INFO／未来同档位 15% 政策。每轮从 6 次增加至 10 次采样会延长 CI，但不影响游戏运行成本；不得预先缩短窗口。
- 完成标准：本轮 typecheck、production build、原预算和定向用例通过；Builder／Reviewer 分别亲自 MCP 截图并查看；全部 Finding 闭环后同分支提交推送，CI 与 Codex 全通过，用户手动合并。

### Round 5 Scope

- Codex 在 `3b2ff07` 提出两项采样器问题：runtime 仅对 town 检查极高实际构建，browser 仅检查所选档位，其他地图退回 high 时可能仍得到合法样本；`gpuTexturesDeleted` 被视为越少越好的硬门禁，会误判正确清理为回归。已重读当前 Plan、完整相关采样路径和定向用例，确认两项均成立。
- 仅修改性能采样器、回归与工程说明：runtime／browser 共用自包含的极高构建断言，三地图必须存在实际静态阴影标记；browser 断言在冻结帧窗口后执行，high 参考无需极高标记。保留纹理删除指标与严格字段检查，改为 INFO；纹理创建／存活数量及其余确定性指标继续原 15% 门禁。独立 Reviewer 已明确批准指标语义纠错：删除次数增加或减少均无法单独判断优劣，必须保留绝对值与变化且标注 INFO；创建／存活仍按原门禁。
- 验证为单用例红／绿回归、脚本 TypeScript／语法检查与独立 Reviewer；不修改 production 代码或视觉，沿用 Round 4 最终截图。继续同分支正常提交并重新等待完整 CI、性能报告与 Codex，通过后由用户手动合并。

### Round 6 Scope

- 2026-10-01：用户认为画面仍远未达到 CS:GO 级真实感。经评估后逐项确认：允许后续引入 CC0／可商用外部资源并放宽预算；首轮只做光照与材质管线；继续在「极高」上迭代；继续叠加在 PR #9 的 `feat/ultra-town-visuals` 分支。环境光从现有三张天空图生成，不新增资源；允许人物近距离实时投影；移动端采用降级方案。开工时工作区干净，远端分支与本地一致，`main` 仍为 `e1a542c`。
- 已确认的 7 项范围（仅「极高」，三地图生效）：
  1. 世界材质在极高下转换为 PBR，并按表面类型设置金属度与粗糙度；安全区圈、经典物资标记和不受光照的特效保持原材质。
  2. 从每局种子对应的现有天空全景生成基于图像的环境光（IBL），取代半球光；天空未就绪或失败时继续使用半球光。
  3. ACES 色调映射与曝光／对比度校准，保留现有配色，不使用暗角或重滤镜。
  4. 屏幕空间环境光遮蔽，提供墙角、墙脚与物体底部的接触暗部。
  5. 静态阴影覆盖扩大，并改进近处过滤质量；静态部分仍只在相机跨越 8m 分区时刷新。
  6. HDR 下的轻度泛光，并在后处理开启后保留多重采样抗锯齿。
  7. 指数距离雾，雾色匹配各天空地平线。
- 人物投影：仅极高桌面端，约 40m 内的非本地角色投射实时阴影；存在近距离角色时阴影图逐帧刷新，角色离开后刷新一次恢复静态缓存。手雷仍不投影，也不创建动态爆炸灯光。此项修改 AGENTS 中“不增加角色动态阴影”的长期合同，属于用户明确授权。
- 移动端（`pointer: coarse`）极高：只启用 PBR、环境光、色调映射和雾，关闭环境光遮蔽、泛光与人物投影，静态阴影保持原 2048²／192m 规格。
- 边界：只改表现层，不改权威几何、碰撞、导航、AI、协议、checkpoint 或资源 manifest；低／中／高画面保持不变。`main` 尚无 ultra，本 PR 的 ultra 成本仍按首次基线政策作为 INFO 报告，high 的确定性硬门禁保持不变；保留 `ultra-town-static-shadows` 构建标记与全部采样。
- 实现落点：新增极高光照模块，由 `UltraPresentation` 在场景末尾调用；`IslandScene` 只向极高模块传入角色可视根节点与本地角色 ID，并让物资标记的运行时换材质经过同一适配器。异步绑定的颜色贴图、透明度来源和法线必须同步到 PBR 材质；顶点色按 gamma 语义换算，不修改共享几何。
- 验证：NullEngine 单用例覆盖三地图材质隔离、PBR 转换、贴图晚绑定、IBL 回退、阴影刷新策略、移动端降级和释放；typecheck、production build、budget；Chrome DevTools MCP 静音截图三地图桌面与移动端并亲自看图，对比同种子高／极高；同步 AGENTS、README 与 docs；独立 Reviewer 审查后正常提交到 PR #9，等待 CI 与 Codex，合并由用户手动完成。

### Round 7 Scope

- 用户在分支预览中明确选择极高，提供空中灰雾、粗糙地表和道路锯齿的截图，要求自行核查后「全部修复好」。已核对当前 HEAD `642e626` 与 main 差异、原始实现、测试和当前 HEAD CI 三轮性能报告，继续本分支/PR #9 流程。
- 本轮修复全部已报告项：降低极高远景灰雾并校准整体光照；按真实道路中心线绘制连续道路表面，避免12m地形三角分类产生大锯齿；把建筑表现从原点附近6栋推广到地图内符合条件的建筑；改善地表/植被的颜色与远景细节；拆分静态与近角色投影，减少阴影和后处理成本；以当前 HEAD 证据重写 PR 性能说明。
- 修复限定于表现，继续保持权威几何、碰撞、导航、AI、账号、联机协议、checkpoint 和低/中/高既有路径。道路与建筑增强必须共同消费现有 layout，不能跨越真实开口；缓存纹理和合批资源必须可释放，不逐帧生成。
- 不以测试或 CI 成功代替画面验收。使用机器已有 Chromium，通过 Chrome DevTools MCP 完成同种子、同地图、同相机的 production 对照，音量始终0，覆盖空中、落地、室内外、人物/物品及桌面/触屏 HUD。Reviewer 独立打开最终 build 并截图看图。完整测试与三轮性能采样继续交 CI，本机每次只跑一个指定用例。
- 所有当前预算与性能指标保留，不通过放宽阈值掩盖成本。提交前记录实际 Build 和独立 Review；正常提交推送后等待 CI、性能审查、Codex 和预览部署，最后由用户手动合并。

### Round 8 Scope

- Codex 对 `376b93f` 提出 P2：全长城镇铺装仍使用道路中点高度，seed 7 外围第 78 条道路约 129m 长，端部高度差约 1m；全图覆盖后铺装埋入或悬空，分缝与铺装脱离。对照现有 `CreateBox` 及逐分缝采样确认成立。
- 继续用户要求「全部修复好」的当前分支流程，将铺装改成沿真实道路采样的连续地表网格，处理起伏与横向坡度，保持全路网范围、裁切、材质及非权威性质。必要时同步分缝坡度。不得改变实际地形、道路或其他画质。
- 新增指定斜坡回归，复跑受影响城镇隔离单用例、typecheck、build、budget；Chrome DevTools MCP 静音检查该外围路段桌面与触屏并亲自看图。独立 Reviewer 完成新 diff 与自己截图的 Review 后正常 follow-up 提交，重跑 CI／性能并请求 Codex 复审。


### Round 9 Scope

- 用户反馈当前光影效果可以，但调高后地面物品比原来难辨认；继续同一功能分支／PR，恢复极高地面物资可读性并保留现有场景光影。只调整物资表现，不扩展拾取距离、生成、尺寸、碰撞、权威状态或 HUD。
- 核对完整物资模板／复用／材质转换／顶点色和光影管线，分析超过 10 秒后再实现。深色顶点配色在线性 PBR 下变暗，原 0.025 的补光转换后约为 0.0003；需通过真实 production 对照确认。
- 优先用仅作用于物资的有界材质补光恢复暗部和部件对比，不增加动态灯、透墙显示、逐帧集合扫描或 mesh／texture。检查生成、死亡掉落和同记录切换后的材质缓存／释放；低／中／高及世界／人物／手持武器不变。
- 本机每次只运行一个明确用例，必要 typecheck／build／budget；Chrome DevTools MCP 静音检查同地图／同相机室外和真实室内物资，亲自查看桌面／触屏截图。独立 Reviewer 审查实际最终 build 与性能影响后，正常提交推送，等待本轮 CI、性能／Codex 和分支预览。保持手动合并。


### Round 10 Scope

- `530a4e3` 的 Codex 已明确通过、公开 Pages 版本及桌面／触屏 smoke 已验证，但两条 CI build 的 Test 均失败。已完成超过 10 秒的日志／配置／完整相关 fixture、场景构建、材质缓存与 Babylon 强制编译上下文检查：push 日志显示 `islandScene.test.ts` 测试子进程在后续大场景构建时耗尽既有 6144MB V8 heap，612／641 个测试通过，没有断言失败；新增物资用例本身已在 CI 完成。
- 将新增完整物资回归移到独立 `ultraLootPresentation.test.ts`，保持真实场景、原 fixture 和全部断言，利用已有每文件隔离释放测试进程，不向原重型场景文件额外叠加一张整图。不放宽 heap／采样／门禁，不跳过测试，不改 production。用例只迁移，本机只指定该单用例、完整 typecheck 与 diff 检查；已有画面／构建证据继续有效，独立 Reviewer 复审后正常 follow-up，等待新 HEAD 的完整 CI、性能及 Codex。


### Round 11 Scope

- `530a4e3` 旧PR性能任务日志现已完整取得：main／HEAD预热完成，随后town-ultra在采样器第262行菜单选择核验抛出泛化的 `Uncaught`，没有完整报告，不是性能数值门禁失败。读取完整采样器、GameApp初始化／设置保存和既有性能合同，并分析超过10秒：只等document.complete写设置不足，旧异步菜单随后初始化volume／sensitivity会把构造时默认settings写回，可能覆盖请求档位。旧日志缺少具体异常，不能据推断宣称已完全证明此次CI的根因。
- 先用真实 production MCP 延迟manifest验证旧菜单晚写竞态和新文档前注入机制，再修复采样准备：保留原两次导航、预热、地图／seed／质量、3轮、click开始时间、HUD及8s观察窗、全部指标／15%门禁。在第二次导航前登记相同设置的document-start注入，新GameApp构造前恢复所需值；保留原手动写入，第一次等待明确目标URL，异常保留CDP真实description。只改CI采样准备，不改production。
- 独立Reviewer已明确架构／资源预审通过：新增操作仅在点击采样前O(1)存储写入和CDP注册，main／HEAD使用同采样器，无已识别>15%生产回归风险；所有原条件必须保持。完整typecheck、独立脚本类型检查、diff检查和MCP定向竞态验证；不在本机运行性能套件。独立Reviewer最终复审后正常follow-up，同HEAD完整CI／性能／Codex和Pages仍须通过。

### Round 12 Scope

- 用户明确要求「保持这个渲染的情况下把优化跟上」，授权自行尝试优化。继续当前分支／PR #9，基线为 `0ac515e`；保留光照、阴影规格、后处理、模型、植被密度、道路和物资辨识度，优化可避免的计算、重复派生与不影响结果的提交，不通过降低画质实现。
- 已检查当前 Plan、完整极高模块及场景调用、相关用例、Babylon 插件／阴影／纹理实现并分析超过 10 秒。候选为无近角色时通过 uniform 跳过空角色图的 PCF、非道路像素跳过无贡献沥青采样、法线图片解码／派生结果在场景内复用，以及按光源实际视锥保守筛选静态投影提交。复杂 shader 替换必须检查实际 production 编译源码与近角色切换，不增加切灯重编译。
- 所有现有预算、CI main/head 三轮地图／seed／画质／预热／窗口／指标／15%门禁保持；本机不运行性能套件或 CLI，使用 Chrome DevTools MCP 静音做固定渲染状态的最小诊断与旧版／最终版对照，并标为诊断证据。基线 production 产物保存在 checkout 外，画面陈列仅操作可视节点，不改权威状态。
- 单次单用例覆盖材质 shader 缓存、空／非空角色投影切换、实际光源视锥边缘与相机外投影物、法线复用与失败／释放；完整 typecheck／build／budget，Builder 与独立 Reviewer 的 production 桌面／触屏截图亲自看图。架构／性能预审与最终 Review 后正常提交，持续修复 CI／Codex，发布分支预览，保留人工合并边界。
- 追加已通过预审的候选：仅模块自有、强度固定为零的 DirectionalLight 按身份跳过直接光 BRDF，完整初始化所有条件 lightingInfo 字段，保留阴影与累加并保护 CUSTOMUSERLIGHTING；必须核实实际 GL shader、扩展宏组合编译及同视点像素对照。

## Build


- 2026-09-06：已完成需求与渲染调用链、材质合批、画质菜单／样式、测试、资源预算和历史视觉 Plan 的上下文检查；实现前分析时间超过 10 秒。

### Build Evidence

- 已接通 `ultra` 设置、菜单与高画质 HUD 继承，仅在灰炉城按需加载新模块。保持默认中画质与其他地图原表现。
- 已实现缓存图片法线、世界尺度 UV、6 栋建筑与 4 段道路的 4 个装饰批次、2048² 静态投影及 8m 分区刷新。
- 根据用户补充美化第一人称四种枪械／手雷，倒角、导轨、瞄具、机匣与镜片按材质合批，近景共 15 个网格；地面物品保留单材质共享模板，增加部件顶点色和完整武器轮廓。
- `npm run typecheck`、`npm run build` 与 `npm run check:budgets` 已通过；当前原始浏览器产物 4,769,292B、JavaScript 3,943,695B、266 个 chunk，预算未变。Worker／standalone 没有源码改动，预算读取现有产物。
- 本机逐次运行单个定向用例：settings 的 ultra 继承；HUD 的 high／ultra 层；法线生成的平面／循环边界；场景的权威几何不变、装备切换、物品几何／材质复用、阴影分区刷新与释放。未运行完整套件。
- Chrome DevTools MCP 静音 production 验证：桌面菜单 1440×900、移动菜单 390×844@2、移动游戏 844×390@2，整组件截图已用图片查看工具打开。检查菜单与相邻设置的字体、字号、字重、颜色、间距、对齐、位置、裁剪和重叠；HUD 沿用高画质布局，触控入口可见，枪械保持在视线下方。
- 桌面逐一查看 rifle／smg／shotgun／sniper／grenade.frag 及 15 类地面物品，修复倒角 UV 长度、面朝向和瞄具悬空；没有错误或警告。对照场景通过 MCP 固定相机／临时切换可见模型，仅供视觉检查；物品陈列图临时移动渲染标记，不改变实际生成规则。场景截图缓存于 `node_modules/.cache/ultra-visuals/`。
- 同机 Chrome 152、灰炉城 seed 0、1440×900@1，high 为 4,359 mesh／92 material／15 texture／1,402,520 vertex；ultra 为 4,351 mesh／100 material／25 texture／1,418,190 vertex。额外纹理为法线及局部投影／铺装，第一人称合批抵消网格增量。可见性／玩法几何不受影响。
- 固定视点 3×6 秒 head high／ultra 观察均约 120 FPS、p95 9.2ms、无大于 50ms 的帧；相机移动时投影仅在跨分区后刷新，8 秒约 7 次。此项受帧率上限限制，属于 INFO，不代表完整比赛性能，也不能替代 CI 的 origin/main 与 HEAD 交替采样。
- 当前仍是街区和装备的写实方向样板，未声称达到 CS:GO 成品资产精度；未新增人物、动画或外部高精度资产。

- 同机 main/high 与 HEAD/high 固定视点 3×6 秒 INFO：main FPS 为 119.82／119.83／119.85，HEAD 为 119.99／119.84／120.15；p95 分别为 9.2ms 与 9.2–9.3ms，均无大于 50ms 帧。未强制 GC 的 heap 分别约 704–725MB 与 720–731MB。该浏览器观察不是隔离 CPU 基准，严格同 runner 交替比较仍交 CI。

### Round 3 Build Evidence

- 人物在已校验的 GLB 模板阶段重建 8 个既有材质组，保留挂点和共享几何；近景每个人物 4,489 个顶点，增加肩颈、裤腿、靴子、手套、头盔、面罩、背心弹匣袋和背包细节。服装织纹全场景复用一张 64² 纹理，远景继续既有 LOD，装备显隐与模型失败回退保留；增强角色不再叠加旧悬空肩甲，第三人称枪管和瞄具接合修正不增加网格。
- 树冠替换为 210 张交错枝叶片与连接轴，共 872 顶点；共享 256² 针叶 alpha-test 纹理和 128² 树皮纹理。既有树干／树冠实例位置、缩放、权威碰撞和数量不变，没有逐帧植被动画。
- 地面 15 类物资继续共享模板和单材质，增加有界倒角、枪械与箱包扣件／缝线，调整武器和护甲／医疗箱贴地姿态及尺寸。较小细节保留简单几何，避免倒角成本无效增长；物资权威生成、拾取和记录复用不变。
- 完整 typecheck、production build、budget 和脚本单独 TypeScript／语法检查通过；本机分别只运行 1 个测试名过滤用例，覆盖真实人物 GLB／装备／LOD／共享几何／权威状态／释放，场景隔离／树木／物资复用，以及新增性能字段缺失与未来 15% 门禁。日志在 `node_modules/.cache/ultra-visuals/` 的 `typecheck-round3.log`、`character-test.log`、`scene-round3-test.log`、`performance-round3-test.log`、`build-round3.log`。没有运行本机完整测试或性能采样脚本。
- 最终原始浏览器产物 4,778,614B、JavaScript 3,953,017B、266 个 chunk；入口 895,335B，既有预算全部保留并通过。Worker／standalone 源码没有修改，最终重建与全套验证交 CI。
- Builder 使用 Chrome DevTools MCP 静音打开最终 production：桌面 1440×900、移动菜单 390×844@2、移动游戏 844×390@2。人物装备、15 类物品陈列、树冠群分别截图并亲自使用 `view_image` 查看，覆盖相邻街道、建筑与完整 HUD；菜单／HUD 字体、字号、字重、颜色、间距、对齐、裁剪、重叠和触控入口无新增异常。最终图为缓存中的 `round3-final-*-desktop.jpg`、`round3-final-*-mobile.jpg`；样板仅临时移动渲染节点与相机，没有修改权威状态。验收后已释放场景并退到空白页。
- 同机 seed 0／桌面最终实际 production 场景：4,351 mesh、100 material、2,833 geometry、1,819,977 vertex、3,682,758 index、28 texture。顶点／索引按 mesh 求和包含共享重复计数，不能当作显存或实际绘制量。固定树冠相机暂停权威循环、仅调用渲染的 3×2 秒观察为 118.48／120.27／120.52 FPS、p95 9.2／9.0／9.4ms，均无大于 50ms 帧；仅为渲染 INFO，不能代表完整比赛或移动设备性能，严格同 runner main/head 证据仍等待 CI。
- 按独立架构／资源审查追加 `browser-ultra` 真实 production 场景资源字段；冻结帧样本后从实际已加载 EngineStore 获取场景，并要求全部外部角色 base GLB 可见于资源记录。保留原运行时采样、预热／轮次／时间窗口、指标与阈值，缺失数据不能聚合成通过。
- 本轮是程序化战术人物与植被的写实方向样板，仍存在块面感；没有声称达到 CS:GO 成品资产精度。

### Round 4 Build Evidence

- 三地图已接入 `UltraPresentation`；追加自然地表、灰泥与瓦屋顶的缓存法线，岛屿／混合使用自然环境光。中央真实墙段保留收边与分缝两批，灰炉城继续既有四批装饰；其他地图没有平直城市铺装。人物、武器物资、树木及静态阴影共享原有增强路径与生命周期，权威代码没有修改。
- 完整 typecheck、production build、budget 通过；性能用例修改后 app typecheck、浏览器采样脚本单独 TypeScript 检查及比较脚本语法检查通过。逐次仅运行一个定向用例，岛屿／混合的场景隔离与真实人物 GLB、灰炉城场景隔离、性能新增场景与严格失败传播均通过。日志为 `node_modules/.cache/ultra-visuals/round4-*-test.log`、`round4-typecheck.log`、`round4-typecheck-app-final.log`、`round4-build.log`；未运行本机完整测试或性能采样。
- 最终浏览器原始产物 4,778,959B、JavaScript 3,953,362B、266 个 chunk，入口 895,297B，既有预算全部保留并通过。Worker／standalone 源码未改，当前预算读取现有产物，CI 将重建并完整验证。
- Builder 使用 Chrome DevTools MCP 静音打开 production，桌面 1440×900、移动菜单 390×844@2、移动游戏 844×390@2。亲自截图并用 `view_image` 查看两地图人物、15 类物品、建筑／地表与树群，额外检查混合地图森林与农村、移动四枪及手雷。菜单与完整 HUD 上下文一起检查字体、字号、字重、颜色、间距、对齐、位置、裁剪和重叠，没有新增异常。图片为缓存下 `round4-menu-*.jpg`、`round4-island-*.jpg`、`round4-mixed-*.jpg`，验收后已释放场景并退至空白页。
- 展示截图使用 seed 0，暂停循环并临时移动渲染节点、相机或切换武器网格；人物／物品陈列与武器图仅用于视觉验收，没有修改权威生成或背包。HUD 的空中状态、未装备及暂停前 FPS 不能作为玩法或性能结论。人物依然存在程序化块面感，未声称达到 CS:GO 成品资产精度。
- 实际 production 场景资源：岛屿 4,966 mesh／101 material／2,824 geometry／1,306,798 vertex／2,864,250 index／32 texture；混合 4,763 mesh／106 material／2,821 geometry／1,210,158 vertex／2,738,154 index／42 texture。顶点与索引逐 mesh 求和包含共享重复，不能等同显存或绘制量。新增地表与屋顶法线已检查实际绑定。
- 按已批准的架构／资源 Review，在 compare 和 baseline 路径均追加 island seed 7、mixed seed 395 的 runtime 与真实浏览器 ultra 采样，实际地图／画质选择均检查。原场景、指标、预热、轮数、窗口、交替顺序与 15% 门禁保留；首次 main 无 ultra 仍只采用同地图同 seed 的 high INFO 参考。完整 CI 性能与 Codex 审查尚待本轮提交后执行。

### Round 5 Build Evidence

- runtime 与 browser 共用有类型、自包含的 `assertUltraPresentation`；移除 town 限制，三图均必须存在实际静态阴影标记。browser 在冻结帧样本后调用，单独 ultra 命令即使不要求纹理统计也执行验证；high 参考继续正常采样。
- `gpuTexturesDeleted` 保留必需字段、严格合法性校验、绝对数及变化报告，仅将其分类改为 INFO，并在报告和工程合同中说明百分比不表示优劣；创建／存活数量及其他原门禁不变。无需修改生产代码或重新拍摄相同画面。
- 定向单用例先复现缺少岛屿极高标记未失败，再复现删除计数 0→1 被错误硬判失败；修复后同一用例通过。覆盖 Node／序列化浏览器函数三地图缺标记失败、有标记通过、high 无标记通过，以及三种 browser section 删除 0→1／1→0 均 INFO、创建／存活超过 15% 仍失败、删除字段缺失／NaN 仍失败。日志为 `round5-red-test.log`、`round5-deletions-red-test.log`、`round5-green-test.log`。
- 完整 typecheck、两份采样脚本的独立 TypeScript 检查、比较脚本语法与 diff 检查通过。新 helper 保持 TypeScript 源与 NodeNext `.js` 引用，已由定向测试验证 Node 导入及浏览器自包含函数执行。脚本类型检查初次发现无声明 JavaScript 模块，已改为类型化共享函数并再次通过。生产构建和预算沿用 Round 4；最终完整 CI 将重新验证。

### Round 6 Build Evidence

- 实现前完成原始需求、当前 Plan、极高模块、`IslandScene` 材质与运行时换材质点、异步贴图绑定、会话调用点、场景／人物／性能用例、采样器标记和文档的上下文检查，分析时间超过 10 秒。
- 新增 `UltraLightingPresentation`：受光 Standard 材质转 PBR，共享映射覆盖物资运行时换材质，颜色贴图／透明度来源／法线的晚绑定转发到 PBR，原材质在网格改挂后释放；顶点色插件按 gamma 语义换算；深色针叶、树皮、林地／泥地和枪械钢件做定向校准。天空探针渲染已绑定穹顶一次并先算球谐再挂载，失败保留半球光。后处理固定做 ACES 色调映射；桌面端 SSAO2（按需动态加载）→ 泛光 → 色调映射，预渲染 MSAA×4；粗指针设备只保留色调映射并由其输入承担 MSAA×4。雾改为按天空取色的指数雾。
- 与已确认描述的差异：第 5 项未使用 Babylon 级联阴影，因为级联会随镜头旋转逐帧重渲染，无法满足“静态部分只在跨分区时刷新”。实际为桌面 4096²／384m 单张静态图（覆盖约为原来的 2 倍，纹素密度与原 2048²／192m 相同，近处改进来自 PCF 中等质量滤波），粗指针设备保持 2048²／192m。浏览器验收发现环境光在室内没有遮挡，白墙整体过曝，因此追加一盏光强为 0 的俯视天空遮挡光及 1024²（粗指针 512²）静态遮挡图，只写楼板、屋顶和坡道，室内保留 45% 天空光；这是让第 2 项可用的必要修正，不改变玩法。均在交付报告中向用户说明。
- 人物投影：桌面端 40m 内非本地角色加入同一张阴影图并逐帧刷新，离开后刷新一次恢复静态缓存；粗指针设备不投影；手雷不投影。角色与第一人称武器接收阴影，其材质在构建后提前异步编译，避免首次出现只见阴影。
- 体积：SSAO2 静态导入会触发打包器把入口共享模块拆成十余个 chunk，改为动态导入后入口 855,947B（基线 895,297B），启动 modulepreload 41 个（基线 38）。新增后处理着色器按 `ultra-post-shaders` 分组。最终浏览器 JavaScript 4,063,933B（基线 3,953,362B，+110,571B／+2.8%），chunk 273 个（基线 266），原始产物 4,889,807B，最大非入口 599,287B。需要把 `browserJavaScript` 从 4,000,000 上调至 4,110,000、`browserJavaScriptChunks` 从 270 上调至 277，其余预算不变；该调整须经独立架构／资源审查。
- `npm run typecheck`、`npm run build`、`npm run check:budgets` 通过；Worker／standalone 源码未改。本机逐个运行单个定向用例：适配器晚绑定／多材质／HUD 材质保留／运行时释放；三地图极高隔离（PBR、后处理、雾、4096 阴影、天空遮挡、分区刷新、释放）；桌面与触屏人物投影；岛屿与灰炉城真实人物 GLB 渲染。日志在 `node_modules/.cache/ultra-visuals/round6-*.log`，未运行完整套件。
- Chrome DevTools MCP 静音打开 production，桌面 1440×900 与移动 844×390@2 触屏横屏，逐张用图片查看工具检查三地图街道／人物／森林／室内及同种子「高」对照、完整 HUD 与触控布局；过程中发现并修复探针未被渲染、首次编译隐身、植被与林地过暗、枪械钢件偏浅、室内过曝，并确认截图需要等待合成帧。最终图为缓存下 `r6-final-*`、`r6-town-*`、`r6-island-*`、`r6-mixed-*`、`r6-sky2-*`；控制台无错误和警告，验收后页面退回空白页并停止预览服务。
- 本机 INFO（Apple GPU、1440×900、每帧 `gl.finish()`、3 个近距离角色）：灰炉城街道极高平均 3.45ms／p95 4.0ms，高 2.45ms／2.9ms；开阔视角 3.01ms 对 2.39ms。场景 4,351 mesh／100 material／39 texture 对 4,359／92／15。不代表 CI 或其他设备，严格 main/head 对比交 CI。

### Round 7 Build Evidence

- 雾改为 1400–3600m 线性远景雾，取消极高地表的蓝灰乘色；低／中／高路径保持原样。三地图在 2048² 双通道遮罩内按真实中心线、宽度与路肩绘制连续道路，交叉口取最大覆盖；WebGL1 使用 RGBA 回退。城镇铺装与分缝共享遮罩裁切相交车道。
- 普通矩形建筑的收边／分缝覆盖全图，城镇铺装覆盖全部道路。细节按 128m 分区合批，320m 外隐藏小型装饰；每分区使用独立 24 顶点几何与薄实例矩阵缓冲，同类装饰共享材质。全图细节增加有界的 mesh／geometry 和启动期矩阵构建成本，以获得视锥裁剪与远距隐藏；不会逐帧构建实例、材质或纹理。
- 静态阴影使用桌面 2048²／256m（触屏仍 2048²／192m）的分区缓存，桌面 40m 近角色独立使用 1024²／96m 小图，人物移动不重画整张静态图；离开后只清空人物图。材质按实际灯源索引获取人物与天空遮挡，不依赖最后一盏灯。SSAO 由 16 降为 8 样本并关闭昂贵模糊；泛光降至四分之一分辨率。树冠 100m 外使用 224 顶点远景 LOD，近景仍为 872 顶点。
- production 截图发现分区实例共享 Geometry 会串写矩阵属性，出现拉长三角形。已修正为每分区独立缓冲，补充 buffer／geometry 不共享、材质共享的防回归检查；不能依赖 NullEngine 的成功替代真实 WebGL 看图。
- 最终逐次单用例验证通过：三地图场景隔离、墙体与地形高度不变、全图细节覆盖、独立分区缓冲、细节／树木 LOD、阴影分区缓存、桌面／触屏人物图、状态不变及场景释放；斜道路口与过滤边缘；三地图实际极高构建标记与原严格性能门禁。未本机运行完整 suite、性能套件或 coverage。
- 完整 `npm run typecheck`、最终 `typecheck:app`、production build、采样断言 TypeScript 检查与 `git diff --check` 通过。最终 JavaScript 4,070,033B、273 chunk、dist 4,895,907B；入口 856,649B、最大非入口 599,287B、CSS 46,822B、Worker 634,585B、standalone 644,635B 全部在原预算内，没有放宽任何预算、采样条件或阈值。服务端源码未变，预算读取已有产物。
- 最终 Chrome DevTools MCP production 验收采用本机已有 Chromium，音量 0；桌面 1440×900@1 与触屏 844×390@2，三地图各截图并用图片查看工具亲自检查。道路连续、建筑远景可见、砖墙／混凝土／地表纹理可读，最终缓冲修复后无异常三角形；触屏静态图仍 2048² 且无人物图。人物与第一人称枪械的固定渲染检查确认独立人物图包含 68 个候选子网格、实际灯源为 sun／actor／sky，控制台无错误或警告。固定相机与人物渲染节点只用于验收，没有修改 Simulation。截图在 `/workspace/cloud-setup/final-*`；本轮页面全部关闭，确认只剩 `about:blank`，4173 预览已停止。HUD 沿用原高画质布局，检查了相邻字体、颜色、间距、对齐、裁剪、触控按钮和覆盖关系。

### Round 8 Build Evidence

- Codex P2 成立。铺装改为从真实地面三角面裁切连续网格：一次构建规则网格的三角索引，只处理各道路两侧矩形包围盒内的单元；裁切顶点的高度沿同一地面三角面插值，保持 0.0425m 贴地间距，避免使用整个长路的单一中点高度。分缝同时采样实际地面高度与横／纵坡度后旋转，仍按原分区薄实例合批。权威地形／道路不变。
- seed 7 外围道路 78 的指定单用例通过：两侧、五处纵向位置与三处横向位置共 30 点，用独立向下射线分别拾取地面／铺装，间距为 0.0425m，覆盖高度变化超过 0.5m；验证全图来源数量、非拾取／非碰撞和状态不变。城镇场景隔离单用例通过，应用 typecheck、production build、budget 与 diff 检查通过；未执行本机完整 suite 或性能采样。
- 最终 JavaScript 4,071,755B／273 chunk、入口 856,641B、dist 4,897,629B；CSS、Worker、standalone 与最大非入口保持预算内，没有上调阈值。seed 7 铺装仍为单个 mesh／material，共 36,944 顶点、276 条道路侧面来源；移除逐条 CreateBox／MergeMeshes 临时网格，增加有界启动期裁切与顶点成本，不增加每帧构建。
- 使用 Chrome DevTools MCP、本机 Chromium、音量 0，桌面 1440×900 与触屏 844×390@2 亲自截图并逐张用图片工具看完整空中／外围斜坡道路与 HUD。铺装／分缝贴地，没有长板悬空或埋入，两端过渡连续；控制台无 error／warn，字体、字号、颜色、间距、行列、裁剪和触控入口没有新增错位。图在 `/workspace/cloud-setup/round8-*`；页面全部关闭，确认只剩 about:blank，自己的 4173 服务已实际关闭。
- `376b93f` 的两条 CI build、Cloudflare Pages 与三轮同 runner 性能门禁已通过，638／52／33／2 个应用／Worker／standalone／确定性性能用例通过。报告显式把 main high 与 HEAD ultra 作 INFO，三地图 high 的确定性资源完全相同。极高稳定 p95 相对该 run 的 main high 为 +170.30%／+270.44%／+307.71%，heap 为 +18.56%／+34.11%／+34.92%，不能宣称硬件流畅或跨 run 比较改进；该报告须独立审查，本轮新提交还必须重新跑 CI／Codex。


### Round 9 Build Evidence

- 暗部可读性回归成立：极高自然物资的 0.025 补光经线性转换变成约 0.0003。保留 PBR 受光，将物资补光底色强度设为 0.22，既有顶点色插件在最终合成前按 16% 底色与 84% 已有线性部件底色调制，抬起暗部并保留颜色差别。复用已经算好的 `surfaceAlbedo`，没有第二次颜色幂运算或新的插件／灯／mesh／material／texture；死亡掉落沿用偏红底色，运行时继续走原缓存。
- 新指定单用例先红后绿，确认 15 类物资的受光材质、部件顶点色、构建不改状态、死亡偏红、拾取隐藏与连续 5 次回收复用，以及几何／位置和 mesh／geometry／texture／缓存材质数量不增长；场景销毁清空物资引用。原晚绑定／多材质／HUD 材质适配指定单用例也通过。本机未运行完整 suite 或性能采样。
- 完整 `npm run typecheck`、最终 production build、原 budget 与 diff 检查通过。缓存隔离修复前 JavaScript 4,072,204B、273 chunk、入口 856,683B、dist 4,898,078B；CSS 46,822B、最大非入口 599,287B、Worker 634,585B、standalone 644,635B 均保持原预算内。没有修改服务端、采样或预算。
- Chrome DevTools MCP、本机已有 Chromium、音量 0，修复前使用公开 `9a9a89b`，暗部补光第一版使用 production：灰炉城 1440×900 桌面及 844×390@2 触屏分别检查暗色建筑底层、医院真实楼层和街道路面；苍岬岛桌面、烬岚郡触屏分别检查医院室内与室外。缓存隔离修复前共 10 张图亲自逐张用图片工具看完整物资与相邻地面、墙面、HUD／触控布局，暗部轮廓更易识别，配色仍有区别，地板／墙面曝光、字体、字号、间距、行列、裁剪没有新变化，控制台无 error／warn。
- 验收临时移动渲染标记和固定相机以陈列全部 15 类，不修改 Simulation／生成／拾取位置。医院使用真实楼层上表面，室外从实际地面三角面读高度；第一次辅助射线检查因 production 未导入 Ray 副作用失败，改成只读三角面插值，失败截图不作为验收证据。所有页面已关闭，仅剩 about:blank，每轮 preview 均实际停止并验证 4173 关闭。辅助脚本和最终图在 `/workspace/cloud-setup/round9-*`，不纳入产品。


### Round 9 Final Build Evidence

- 缓存 Finding 修复后，指定 Effect 隔离回归通过：有／无顶点色的世界与物资组合都实际编译并 `scene.render()`，两个 Effect 非空且不同，物资独有 `ULTRA_LOOT_FILL`；不把临时 subMesh 或 undefined 当证据。所有同类插件在构造注册时提供相同源码，编译前只写一个只读布尔 define，不新增逐帧扫描、JS 对象分配或资源构建。
- 最终完整 typecheck、production build、budget 与 diff 检查通过：JavaScript 4,072,259B、273 chunk、入口 856,683B、dist 4,898,133B，其他原预算保持；缓存隔离仅增加必要 shader 变体，不增加 mesh／material／texture／灯光或更改采样与阈值。
- 缓存隔离后的最终 production 使用 MCP 静音再次截桌面暗色底层／医院、触屏暗色底层／道路共 4 张，Builder 已逐张亲自看图，颜色与轮廓可辨，邻近曝光／HUD 未新增改变，console0。触屏实际 Effect 检查没有物资／世界 define 不匹配；图在 `/workspace/cloud-setup/round9-final-*`。页面全关仅剩 about:blank，4173 已实际停止并确认端口关闭。独立 Reviewer 仍需检查该最终版本并闭环 P2，禁止借第一版通过视觉替代。


### Round 10 Build Evidence

- 新物资回归的 55 行用例与 `createAssets` fixture 原样迁至独立 `ultraLootPresentation.test.ts`，原文件仅移除同一用例；15 类、死亡色调、隐藏、5 次记录回收、材质／几何／位置／状态／资源／释放断言及 60s 超时完整保留。测试总数仍为641，未修改 production、Vitest配置、heap、预算或采样。
- 独立文件指定单用例通过1／1，测试4.42s；完整 `npm run typecheck` 和 diff 检查通过。因 production 与530a4e3逐字相同，Round9最终build／budget／本地及公开桌面／触屏图继续有效，未重复构建或浏览器。
- Reviewer 预审核对 Vitest4.1.10默认文件隔离和 scheduler 的 isolated runner.stop，确认迁移提供真实子进程释放边界，接受方案；日志只能证明OOM且没有断言失败，不能据612个已通过宣称其余用例通过，完整新HEAD CI必须重跑。此调整仅降低测试进程累计内存，不能宣称修复了生产内存泄漏。


### Round 11 Build Evidence

- Chrome DevTools MCP／本机已有Chromium／静音0，真实公开production延迟manifest返回，确认document.complete但菜单尚未出现。旧路径先写town／ultra再放行manifest后，实际菜单及storage变回island／medium；新文档启动时先注入同样settings，则菜单及storage均保留town／ultra。两图亲自看过完整菜单，console0，页面全关仅剩blank，自己的MCP／Chromium进程树已停止。此证据证明竞态缺陷存在，不伪称旧CI泛化Uncaught已完全定因。
- 第二次导航前登记document-start设置脚本，保留旧手动写入；首次就绪要求真实目标href，CDP异常保留exception.description。原两次导航、预热、3轮、场景／seed／质量、click采样时点、HUD及8s窗口、全部指标／门禁和预算未改变。production零diff，现有Round9最终画面／build仍适用，没有本机性能采样。
- 完整 `npm run typecheck`、采样器独立TypeScript检查和diff检查通过。TypeScript7对命令行文件要求显式 `--ignoreConfig`，首次检查因TS5112未执行，添加该编译器要求后通过；未修改项目配置。工程指南、README及架构说明同步记录初始化与严格选择核验。

### Round 12 Build Evidence

- 三个极高模块落实五项计算／提交复用：场景内法线 payload 解码与同配置纹理缓存；WebGL2 非道路零覆盖跳过沥青读取且使用分支外显式梯度，WebGL1 保留旧路径；空人物图以一致 uniform 跳过 PCF；静态／天空图按实际光体积保守裁剪；仅模块工厂登记且终生零强度的两盏遮挡灯跳过直接光 BRDF。光照／后处理／分辨率／模型／植被／道路／物资补光与权威状态保持。
- 按要求每次仅一个具名用例，法线并发／UV／晚绑定／失败／释放、实际 Effect 空近空与灯序／同名非自有灯隔离、真实阴影边界／离屏物／分区恢复均通过；原场景权威几何合同与物资生命周期用例通过。最后 caster 用例增加三个新 renderId 的完整阴影 observer 链，数值不变时 caster.computeWorldMatrix 零调用，排除 updateFlag 重写引起的重复筛选。
- 最终完整 typecheck、production build、budget 与 diff 检查通过：入口 856,683B、最大非入口 599,287B、JavaScript 4,075,592B／273 chunk、CSS 46,822B、dist 4,901,466B、Worker 634,585B、standalone 644,635B；所有原上限不变。最后矩阵缓存修正不改 shader／绘制结果，只增加两份有界矩阵存储和 16 个元素的常数比较。
- Chrome DevTools MCP 使用本机 Chromium，静音0、相同地图／seed／档位、checkout 外保留旧版 production。灰炉城桌面实际 GL program 附着的 fragment shader 编译成功：directional／specular BRDF 调用各 3→1，源码 67,016→66,224 字符，等效状态 Effect 数均为54；WebGL2 显式 textureGrad 已存在。SHEEN／CLEARCOAT／SS_TRANSLUCENCY 联合组合实际 GPU 编译通过，全部条件 info 字段初始化，太阳仍执行原计算；组合额外 Effect 后人物 caster 0→68→0，Effect 始终同一对象且数量55不增长。
- 灰炉城街道／暗处物资旧版与最终 shader 版 production PNG 均亲自查看，未发现物资颜色／轮廓、相邻曝光／道路／HUD 可见退化。第一轮中心世界区域 476,150 像素比较中，超过99%的像素最大通道差不超过6／255；候选独立 context 重拍后，最终街道／暗处同一区域旧新像素完全相同。冻结前异步时序与其他地图物资姿态并非完全一致，不能外推所有帧／所有地图逐像素一致。固定暗处视点跨8m移动的实际 WebGL 提交为219→191、211→183，稳态177不变；提交 indices 同帧分别约减少2.1%，太阳候选276→13、天空5→3。候选列表减少比例不代表整体 GPU 或 FPS 改善，时间保留原始记录且仅作 INFO。
- 早期两个同时打开的重量级 SwiftShader context 导致 MCP 超时，浏览器结束后均关闭页面／进程组并确认端口关闭；改为串行 context 完成有界诊断。首次 GL 查询遇到 Babylon 在编译后清空 fragmentShader 引用，改从 program.getAttachedShaders 读取实际 GPU shader；不以未预处理文本代替编译证据。原 CI 采样器、三轮交替条件、完整指标／15%门禁均未修改，定向截图陈列只改可视节点、不改权威状态。

- 最后矩阵内容缓存版本的三地图／触屏／GL1 production 均完成静音 Chrome MCP：苍岬岛固定移动帧 draw246→220／236→210、indices约减少13%，烬岚郡217→191／207→182、indices约减少19%；对应稳态198／175保持，普通状态 Effect49／50及法线10／15不变。触屏街道／暗处截图均亲自看图且世界区域旧新像素完全相同，移动 draw236→207／223→195、稳态192不变，真实 GPU BRDF2→1、Effect42不变，法线8不变。其他地图物资初始姿态有差异，不当作画质改动；世界曝光、贴图、道路与轮廓保持。
- 强制 WebGL2 context 不可用的兼容验收，确认最终版实际 WebGL1、GPU编译成功、shader没有 textureGrad，保留原道路隐式采样；街道／暗处两张 production 图已亲自查看。全部上下文 console0、volume0，每轮自己的页面全关只剩 blank，实际浏览器／MCP／preview 进程组已停止，4173／4175／9345均关闭。完整记录在 checkout 外 `round12-final-*`，浏览器显示的冻结HUD FPS不能当性能证据；原始定向帧时间可见波动且无三轮完整游戏计时结论。

## Review

- 当前 Round 12 已完成实现与最终静态复审，所有已发现 blocker／high／medium 已处理；Builder 三地图／触屏／WebGL1 与独立 Reviewer production 图像验收均完成，最终 Review 明确通过并批准正常提交。新 HEAD 完整 CI／性能／Codex／分支预览须持续完成。

### Round 1

- Reviewer 发现 F1（medium）：极高近景狙击枪沿用旧分件间隙，枪管缺连接、瞄准镜缺镜座。
- Disposition：对照用户的装备美化要求确认成立；已在极高合批内补枪管连接和两处镜座，保持原有网格／材质数量。重新 production build、typecheck、budget 和定向场景用例；Builder 截图查看装配已连续。
- 最终浏览器产物为 4,769,391B、JavaScript 3,943,794B、266 个 chunk；ultra 顶点数 1,418,526。旧记录保留为此前验证事实。

### Re-review

- 独立 `code_reviewer` 完成最终静态和真实 production 视觉审查，F1 已闭环；当前无未解决 blocker／high／medium Finding。
- Reviewer 自行使用 Chrome DevTools MCP，音量为 0，截图并用 `view_image` 查看桌面 1440×900、移动菜单 390×844@2、移动游戏 844×390@2，覆盖整菜单和相邻设置、四枪手雷、15 类物资、街道／室内开口。字体、字号、字重、颜色、间距、对齐、控件尺寸、裁剪和重叠检查通过；两页面无 console error／warn。Reviewer 已清理自己的页面、场景和截图。
- 性能 Review：配置／HUD 与每帧阴影分区检查均为 O(1)；UV、法线、装饰和装备构建有界且只在启动发生，近景合批减少常驻网格；掉落复用不增加逐次资源增长。Vite 分组保持预算；main/head 浏览器 INFO 可接受，完整相对门禁交 CI。
- 非阻塞优化空间：重复混凝土 payload 可复用法线 CPU 数据，顶点色填充可减少临时数组；本轮不额外扩大实现。
- 浏览器环境：MCP 独立配置参数不可用时，外层确认并清理已结束 Builder 会话的专用残留浏览器；Reviewer 随后独立启动验收。没有使用非 MCP 浏览器路径。

### Round 2

- Codex 在 PR #9 提出 P1：现有性能 harness 不接受或采样 ultra，新档位无法持续验证。
- Disposition：对照新增档位目标确认成立。独立 Reviewer 已完成明确架构／资源审查，同意追加 `town-ultra` runtime 与 browser，保留原 high 场景、指标、轮数／窗口和 15% 门禁。
- 首次基线政策：仅当 main 的 `QUALITY_PROFILES` 明确无 ultra 时，同 runner main high 作为标注清楚的 INFO 参考，报告 HEAD ultra 真实成本；不得伪装成 main ultra 或相对 PASS。main 支持 ultra 后自动比较同档位并应用原 15% 硬门禁。HEAD 无 ultra、导入／采样失败、指标缺失均必须失败。
- Browser 在开始前核验实际画质选择，新增档位同时记录真实 WebGL 纹理创建／删除／存活数量；NullEngine 不加载图片 payload，其 texture 数不代表完整生产纹理成本。比较模式和 main baseline 模式均追加完整采样。
- 实现已追加两种 ultra 采样与严格能力探测、实际菜单值检查、WebGL 纹理计数和首次参考报告；采样异常不捕获为不支持。
- 定向 `ultraPerformance` 单用例通过，覆盖首次 INFO、同档位超过 15% 失败、旧 high 门禁保留、HEAD 不支持、缺失／非法指标、报告标注及真实 QUALITY_PROFILES 能力探测。完整 typecheck、两份采样脚本独立 TypeScript 检查、比较脚本语法检查及 diff 检查通过。本机未运行性能套件或 CLI 浏览器采样，完整新采样交 CI。
- 首次提交 `2f7f49b` 的两次完整 CI build 及原性能门禁已通过：627 个 unit、52 个 Worker、33 个 standalone 用例，Docker smoke 和产物预算通过；原三地图 high 确定性场景资源与 main 相同。当前修复会在同一 PR #9 正常追加提交，并重跑新增采样。
- Round 2 Reviewer 发现 F2（medium）：聚合会过滤某一轮缺失字段，其他合法轮次可能掩盖异常。Disposition：成立，已将完整指标／有限数值检查放到 runtime 和 browser 每次捕获返回处，预热与每轮采样共同使用；新增混合合法／缺失样本回归通过，typecheck 和脚本语法检查再次通过。
- Reviewer 已审查首轮 CI INFO：原 runtime 硬资源 0% 变化，browser nodes +6.05% 仍通过；启动时间不足 2%，mixed heap +6.12%，浏览器进入时间 +0.03%／heap +0.13%，长帧数量持平。SwiftShader 的绝对 FPS 不能代表用户设备体验。
- Round 2 最小静态 Re-review 通过：F2 已闭环，预热与每轮在聚合前完整校验，首次基线边界及旧门禁完整；无未解决 blocker／high／medium。采样器校验与计数只影响 CI 工作，不改变生产游戏运行时。下一步等待新增 ultra 的 CI 实测与 Codex 再审。

### Round 3

- 独立 `code_reviewer` 的提交前 Review 通过，没有未解决 blocker／high／medium Finding；回看用户人物大幅升级、物品和树木的原始需求，确认本轮并非仅调色，范围继续限定灰炉城 ultra。
- Reviewer 自行使用 Chrome DevTools MCP 静音打开最终 production，截图并逐张 `view_image` 查看桌面 1440×900、移动菜单 390×844@2、移动游戏 844×390@2，覆盖完整装备／无甲／背面人物、15 类物资、树冠与相邻街道建筑／完整 HUD。字体、字号、字重、颜色、间距、对齐、裁剪、遮挡和触控入口没有新增异常；未见破面、旧肩甲叠加或明显装配断裂。已清理自己的截图、释放场景并退到空白页。
- 模板启动增强、8 分组共享几何、树木实例和物资模板复用有界，没有新增逐帧构建。共享不能消除人物顶点和树叶 alpha-test 重叠的绘制成本；最终须审查同一 CI 的真实 scene／纹理／FPS／长帧证据，不能用本地 120 FPS 上限免除。可优化空间为更紧凑枝片、远景树冠与人物细部密度，本轮不在缺少实测证据时扩大修改。
- Reviewer 独立核验采样入口实际得到 50 个角色根节点和 49 个有效 base GLB；新增字段在帧样本冻结后读取真实 EngineStore，严格单轮与聚合校验保留。未重复 Builder 的测试、typecheck、build 或 budget。
- 下一步正常提交至 PR #9，等待本轮完整 CI／性能 Review 与 Codex 审查；禁止自动合并或删除分支。

### Round 4

- 独立 `code_reviewer` 的提交前 Review 通过，无 blocker／high／medium Finding；完整检查未提交 diff、新模块与当前 Plan，并回看用户明确选择两张地图完整效果的原始需求。
- Reviewer 自行使用 Chrome DevTools MCP 静音打开 production，桌面 1440×900、移动菜单 390×844@2、移动游戏 844×390@2，截图并逐张亲自 `view_image` 查看两图人物、15 类物资、树木、建筑地表及完整菜单／HUD。字体、字号、字重、颜色、间距、对齐、裁剪与触控布局保持一致，未见新增接合、开口遮挡或悬空铺装；已释放场景、关闭页面并删除自己的 26 张临时图，Builder 服务随后停止。
- 混合地图屋顶宽条带疑点经临时关闭阴影、关闭凹凸及同种子同视点 high 对照，确认原 high 已有完全相同表现，不属于本轮回归，不额外扩大修改。
- 性能 Review：入口仅扩展 ultra，人物共享几何／LOD、装备合批和物资模板保持不变；新法线属于启动时有界工作，单张 256²、消费缓存 payload 并随场景释放。两图各两批建筑装饰，一张 2048²／8m 分区刷新阴影，没有新增权威状态或逐帧对象创建。森林 alpha-test 过度绘制与阴影刷新成本必须由本轮 CI 继续审查，不能用 mesh 数或展示图 FPS 代替；优化空间为减少无用纹理派生与材质扫描。
- Reviewer 确认 compare／baseline 新增采样完整，原逐样本校验、首次 INFO 与未来同档位 15% 门禁保留；未重复 Builder 的测试、typecheck、build 或 budget。允许提交启动 CI，最终三地图同 runner 性能报告与 Codex 尚待本轮提交后审查。

- Round 4 提交后证据：两条 CI build、性能与预览全部通过，633 个应用、52 个 Worker、33 个 standalone 和 2 个性能用例、原预算及 Docker smoke 通过。独立 Reviewer 审查同 run `34677797156` 的三轮聚合报告，接受显式 ultra 的有界新增成本；high 确定性资源不变。岛屿／混合真实 scene 顶点约增加 64万／70万，heap 约增加 24.4MB／25.9MB；稳定帧 p95 增加 25.91%／41.38%，不能用长帧数量减少或 SwiftShader 绝对 FPS 宣称设备流畅。优先优化空间为森林远景 LOD、alpha-test 与阴影裁剪，本轮不构成必须修复 Finding。Codex 后续行评论触发 Round 5，旧通过结论不代表整个 PR 完成。

### Round 5

- 独立 `code_reviewer` 完成最小静态 Re-review，P1／P2 闭环，无新增 blocker／high／medium Finding。共享断言自包含，三地图 runtime／browser 都检查实际标记；浏览器冻结帧后检查，未开启纹理统计的独立 ultra 命令也无法绕过。high 参考保持正常。
- 删除计数保留必需字段、绝对值与变化，只改为 INFO；报告明确不据增减判断优劣，创建／存活硬门禁不变。Reviewer 核对三地图、函数序列化、缺标记、删除双向／非法字段及创建／存活超限回归；没有重复 Builder 的测试、构建或浏览器验收。
- 性能影响仅为采样时一次有界纹理名称扫描，browser 不计入原 FPS 窗口，没有生产成本或预算／窗口变化，无需新增抽象。允许正常提交并启动最终 CI，Round 4 production 视觉证据继续有效，新的性能报告与 Codex 仍需明确通过。

### Round 6

- 独立 `code_reviewer` 对未提交 diff 与 `UltraLightingPresentation.ts` 完成审查，结论不通过，无 blocker／high。第 5 项单张 4096²／384m 阴影图被接受：没有近处角色时仍只在跨 8m 分区刷新，不使用级联是为了守住该约束。预算上调被批准：JavaScript 4,063,933B、273 chunk，新上限只留约 46KB 与 4 个 chunk 余量，入口、最大非入口、dist、CSS、Worker、standalone 未放宽。高画质路径无逐帧新增，high 硬门禁保持。Reviewer 独立 Chrome 静音验收三地图桌面与粗指针降级，室内不过曝、植被不发黑、枪械不是塑料高光、开口未被封死；已关闭本轮页面并停止 4173 预览。
- F1（medium）：`docs/asset-manifest.md` 仍写 JavaScript 与 chunk 上限保持不变，与 4,110,000／277 矛盾。Disposition：成立。已改为写明这两项新上限，并保留入口、最大非入口、CSS、Worker、standalone 与 `dist/` 不变。运行时代码不改。
- F2（medium）：室内天空遮挡（光强 0 的俯视光、桌面 1024²／粗指针 512²、室内保留 45% 天空光）未出现在用户确认的 7 项中，却写入了 `AGENTS.md` 与架构文档。Disposition：不改运行时代码。用户已确认用当前天空穹顶的 IBL 取代半球光；验收时无遮挡的 IBL 把白墙室内照成过曝，遮挡是让该项可用的表现修正，不改权威几何、碰撞或开口。用户随后要求做完当前实现。具体比例与贴图尺寸留在架构说明，作为当前实现合同，避免以后静默漂移。若用户在交付后拒绝室内变暗，再单独移除。
- 低优先级：室内衰减读取光照循环最后一盏灯的 `shadow`。当前灯序由定向测试锁定遮挡光在末尾，本轮不改。
- 性能：桌面极高稳定成本为 PBR、半分辨率 SSAO2、轻度泛光、色调映射和 4096² 阴影图；40m 内有非本地角色时整张阴影图逐帧刷新，这是已确认行为，也是相对高画质最可能超过 15% 帧时间的部分，同档位硬门禁交 CI。可优化空间为近处角色只重绘动态部分、降低 SSAO 采样、遮挡不再依赖最后一盏灯。本轮不扩大实现。
- Re-review：同一只读 Reviewer 复核后通过，F1／F2 闭环，无未解决 blocker／high／medium。允许提交。未重跑测试、构建或浏览器验收。
- 2026-10-02：提交 `6247f2c` 后 Codex 在该提交上提出 P2：生成法线的 `createImageBitmap` 可能在动态加载 SSAO、执行 `convertScene()` 之前完成，绑定只查找 `PBRMaterial`，因此不会重试，凹凸贴图被分配但用不上。对照 `addSurfaceNormal` 与 `convertStandardMaterial` 确认成立：转换会拷贝当时的 `bumpTexture`。已导出 `bindGeneratedSurfaceNormal`，转换前写入仍在场的 Standard 材质，转换后继续写入 PBR。定向单用例 `binds generated normals onto standard materials before PBR conversion` 通过，`npm run typecheck:app` 通过。画面意图不变，不重拍三地图；`6247f2c` 的两条 CI build 已通过，性能作业仍在跑，本修复会另起检查。
- Re-review：同一只读 Reviewer 确认 P2 闭环，转换前写入 Standard、转换后写入 PBR，无新增 blocker／high／medium。允许提交。未重跑测试或浏览器。
- 2026-10-02：Codex 对 `efc5617` 提出 P1，认为法线在转换前生效后，`6247f2c` 的旧截图不能代表最终画面。已用 `efc5617` 重新 `npm run build` 与 `check:budgets`（JavaScript 4,064,033B、273 chunk，仍在 4,110,000／277 内），音量 0 打开 `http://127.0.0.1:4173/`。亲自查看灰炉城落地砖墙街道、苍岬岛地表与烬岚郡滑翔城镇／森林。实时场景里砖墙、混凝土、沥青、屋顶、灰泥、瓦、林地腐殖土和湿苔的 `.normal` 都已挂在 PBR 材质上。控制台无错误。HUD 行列与相邻信息没有新增错位。死亡弹层是安全区淘汰，不是本修复引入的遮挡。
- Re-review：独立 Reviewer 在 1440×900、音量 0、版本 `v0.1.1-105-gefc5617` 下亲自看了灰炉城近处砖墙和苍岬岛航线。砖墙有灰缝明暗；临时去掉 `brick-masonry.normal` 后砖区约 3.9% 像素变化，单通道最大差约 38。开口未封，HUD 无错位。无新增 blocker／high／medium。本记录发生在 `efc5617` 提交之后，不能单独提交。

### Round 7

- 独立 `code_reviewer` 检查完整未提交 diff 与两个新文件，通过，无未解决 blocker／high／medium Finding，允许正常提交启动 CI；用户要求修复当前分支，范围限定极高表现，未扩展权威玩法。
- Reviewer 自行使用 Chrome DevTools MCP 静音打开最终 production，自行截图并逐张使用图片查看工具看三地图桌面／触屏空中与近道路、触屏竖屏完整菜单和横屏 HUD、桌面 5m 近角色与枪械、灰炉城真实建筑室内。道路连续、收边没有拉长三角形或封住开口，室内天空光正常衰减、门洞畅通、没有过曝；字体、字号、字重、颜色、间距、行列、裁剪、相邻控件与触控布局未见新增问题。每页 console error／warn 为 0，触屏没有人物图，桌面独立人物图为 1024²、包含 68 个子网格。
- 性能 Review：雾参数无新增逐帧扫描，配色仅启动期调整。道路遮罩启动期在路段包围盒内栅格化，RG 数据约 8MiB、WebGL1 RGBA 回退约 16MiB，地面增加片元采样；斜长路段包围盒仍可优化。全图细节增加有界启动构建、mesh／geometry 与矩阵数据，128m 分区、320m LOD 和材质复用限制稳定绘制成本；独立几何修复矩阵串写，全图铺装仍可进一步分区。
- 性能 Review：静态 2048² 图只跨分区刷新，近角色只重绘独立 1024² 图；每帧角色检查有界，列表仅成员变化时重建，实际灯源索引避免最后灯光假设。100m 外共享 224 顶点树冠 LOD、8 样本 SSAO 与较小泛光减少远景／后处理成本；近景针叶重叠、PBR、MSAA 和后处理仍需新 CI 实测。没有无上限运行时资源增长、释放遗漏或权威几何污染，预算与采样条件／阈值未放宽。
- 本轮只把道路从三角地表分类移到连续遮罩，既有土壤／森林材质边界仍沿地形网格阶梯化；交付不能宣称全部地表边界平滑或成品写实画质。
- Reviewer 未重复 Builder 的 test、typecheck、build 或 budget，未修改仓库／Git；页面已关闭，仅剩 about:blank。外层发现 4174 退出后仍监听，Reviewer 随即停止遗留 Vite 进程，并以 TCP 实测确认端口关闭。最终同 runner main/head 性能报告与 Codex 必须在本实现提交后继续审查，不以旧 HEAD 的通过代替。

### Round 8

- 独立 `code_reviewer` Review 通过，Codex 全长铺装 P2 已闭环，无未解决 blocker／high／medium，允许正常 follow-up 提交。裁切与索引仅消费表现层地面，未修改其顶点／权威状态；铺装单个 mesh／material，分缝继续分区复用，无新增每帧构建或释放遗漏。新增一次 O(地面三角数＋道路包围盒单元数＋分缝数量) 的有界启动工作和约 3 万铺装顶点，避免原逐路临时箱体创建／合并。
- Reviewer 自行使用 Chrome DevTools MCP、本机 Chromium、音量 0，在独立 context 查看 seed 7 道路 78 两侧桌面／触屏，共 4 张自己的截图逐张使用图片查看工具打开。铺装／分缝贴合坡面，无长平板悬空或埋入；HUD 及相邻控件的字体、字号、颜色、间距、行列、裁剪和触控布局没有本轮新增异常，每页 console error／warn 为 0。其页面已关闭，仅剩 about:blank，Vite PID 11754 已停止，TCP 实测 4174 关闭；其临时脚本／截图已清理，未重复 Builder 测试／类型检查／构建／预算，未修改源文件或 Git。
- Reviewer 审查 `376b93f` 同 runner 三轮报告：high 确定性资源完全不变，全部原门禁通过；ultra 相对 main high 的启动／帧时间／heap 与额外几何／纹理成本完整披露，接受为首次显式 Ultra 的有界成本取舍，不构成新的必须修复 Finding。本轮新提交还需独立检查自己的 CI、性能和 Codex，禁止跨 run 直接比较时间或用绿灯宣称设备流畅。
- 无近角色时 actorLight 仍启用，其 PCF 片元采样并非零成本。Reviewer 确认这是非阻塞优化空间；当前报告同时改变 PBR／IBL／后处理与全图细节，不能把总体 p95 成本归因于这一支路，也无证据表明该支路单独超过 15%。未来可在空列表禁灯，但必须处理实际灯源索引和 shader 变体首次编译。本轮不以猜测追加变体切换。

### Round 9 Initial Review

- 独立 Reviewer 首次审查不通过：P2／medium，`GammaVertexColorPlugin` 根据实例参数返回不同片元代码却没有区分 shader defines；Babylon Effect 缓存按 shader 名与 defines 复用，不按插件处理回调区分。Reviewer 用实际生产触屏把楼板材质临时挂到同一物资几何，取得两个真实 Effect，确认 `sameEffect`／`sameDefines` 均为 true，世界材质会串用物资补光，反向编译也可能让物资失去部件调制。
- Disposition：重读当前 Scope、插件、ThinEngine 缓存与调用链确认成立。Builder 新指定单用例在真实 NullEngine 编译／渲染后同样复现两个材质共享同一 Effect，先红后绿；修复使用独立 `ULTRA_LOOT_FILL` define，所有同类插件提供统一的条件编译片元代码。覆盖有／无顶点色的相同世界／物资组合，检查两个实际 Effect 非空且不同、物资独有该 define。补光数值、顶点和权威状态不变。
- Reviewer 首次自行静音打开最终生产版本，桌面／触屏暗色底层、医院与道路共 6 张自己的截图逐张看图；配色、轮廓与相邻 HUD 无新问题，console0。其页面已全部关、4174 实际进程17559已停止且端口确认关闭，临时资源已清理。此组图仅代表缓存修复前版本，修复后必须重新完成最小最终画面／实际缓存隔离复审，未放行提交。

### Round 9 Re-review

- 独立 `code_reviewer_round9` 最终复审通过，原 P2 已闭环，无未解决 blocker／high／medium，允许正常提交。统一片元源码配合 `ULTRA_LOOT_FILL` 隔离编译缓存；Reviewer 在最终 production 重走原同几何换材质路径，取得两个真实 Effect：`sameEffect=false`、物资 define 为 true、世界 define 为 false。
- Reviewer 自行使用 Chrome DevTools MCP 静音查看桌面暗色底层／医院、触屏暗色底层／道路，共 4 张自己的最终图逐张亲自看过。15 类物资的轮廓和配色可辨，没有整体洗白；邻近世界曝光与 HUD 字体、间距、对齐、裁剪无本轮新问题。实际物资 279／世界 3218 个 submesh 的 define 不匹配为 0，console 无 error／warn。
- 性能 Review：转换与 define 准备增加常数工作，复用原插件与缓存；物资片元增加固定补光运算及必要独立 shader 变体。没有新增逐帧集合扫描、JS 分配、灯光、mesh、material 或 texture，死亡掉落／记录回收继续缓存复用。不存在已识别的本轮必须在提交前追加采样的回归 Finding；整体 Ultra 成本仍须审查新 HEAD 的同 runner CI 报告，不能据此宣称性能改善。非阻塞优化空间为依据真实设备反馈校准补光系数。
- Reviewer 未重复测试／类型检查／构建／budget，未改源文件或 Git；页面全关仅剩 2 个 about:blank，实际 Vite PID18935 停止并 TCP 确认4174关闭，自己的临时图／脚本／日志已清理。外层独立确认4173／4174均关闭。分支同步前保留变更后 `git pull --rebase` 显示远端未变化，无冲突；此记录与本轮实现同提交，后续 CI／Codex 结果不能单独回填提交。

### Round 10 Re-review

- 独立 Reviewer 最终迁移审查通过，无未解决 blocker／high／medium，完整类型检查通过后允许正常 follow-up 提交。独立提取比较确认用例及整个 fixture 逐字保留，新文件被既有 include 覆盖，原文件只移除这一个用例。未改变其他测试、runner、heap、预算、权威或画面；新用例没有 stubGlobal，独立 afterEach 的 restoreAllMocks 保留清理语义。
- 性能 Review：production零变化，场景资源和片元成本与Round9相同；测试总构建／断言工作量保持，文件隔离以进程释放限制累计内存，增加一次测试文件初始化但不是生产开销。新HEAD完整CI必须通过才能认定OOM解决。暂保留原样局部 fixture，抽共享 helper 会扩大本轮影响，复制维护成本是低优先级优化空间。
- 未重复测试、构建或浏览器，未修改Git；保留变更后分支 `git pull --rebase` 显示远端未变化、无冲突。本记录与测试迁移同提交，不单独提交Plan；新HEAD仍需完整CI／性能／Codex及Pages，Round9公开画面仅代表相同production代码。

### Round 11 Re-review

- 独立 Reviewer 最终只读 Review 通过，无未解决 blocker／high／medium，允许正常follow-up提交。核对完整diff、MCP延迟manifest脚本／日志与采样调用链，确认新文档注入在第二次导航前、manualwrite和严格地图／quality核验保留；main／HEAD消费同采样器，所有原预热、交替顺序、窗口、指标、阈值、预算保持。真实竞态已复现，仍不宣称旧Uncaught的唯一根因。
- 性能 Review：固定CDP注册和localStorage写入只在click采样前，没有production差异、逐帧JS或图形资源新增，无必须提交前另采样的>15%风险。非阻塞文档准确性建议已处理：README性能说明改为确定性运行时／资源指标硬门禁，wall-clock／FPS／长帧／heap作为INFO，与既有合同一致，不改变实际门禁。
- Reviewer未重复Builder命令／浏览器，未改Git或源码。`976f64f` 的push完整build已经成功，Test阶段全部通过并完成原产物预算与Docker smoke；PR build进入Docker阶段，这些属于前一HEAD证据，新采样修复仍需新HEAD完整CI／性能／Codex。页面／服务已清理，MCP9345以及preview4173／4174实际确认关闭。


### Round 12 Review

- 独立 `code_reviewer_round9` 按用户保持现有渲染且自行优化的授权进行架构／资源预审、最终静态审查及多次 Re-review；明确要求不改采样／预算，缓存按实际灯序隔离，不能用 shader 文本或绘制数外推 FPS。
- Finding：道路分支内隐式导数在混合覆盖片元可选择错误 mip。Disposition：WebGL2 先在分支外计算 UV 梯度再 textureGrad，WebGL1 原路径保留；真实 GPU 源码及兼容编译核实，关闭。
- Finding：反复清空并填充被 RTT hook 的 renderList 会把全场景灯源标为 dirty。Disposition：原全量列表保留不动，独立复用的 visible 只由 getCustomRenderList 提供，定向断言无 light dirty，关闭。
- Finding：未计入法线／深度 bias 与 texel 的精确边缘裁剪可能丢失影子。Disposition：保守扩展光视锥，跨界批次与不可靠边界保留，tiny-biased-edge、相机外物体及分区恢复断言通过，关闭。
- Finding（medium）：Babylon 可在新 renderId 重写相同矩阵，单用 updateFlag 不能复用内容。Disposition：新增独立 Matrix 内容缓存与 equals 快路径；三个真实 renderId observer 链不重筛，位移／高度变化仍重筛。Reviewer 再读当前 Plan 和源码，明确 Re-review 关闭。
- BRDF 分支经过严格预审：仅工厂登记的固定零强度 DirectionalLight，完整覆盖所有 lightingInfo 条件字段，保护 CUSTOMUSERLIGHTING，保留阴影／末尾累加，太阳仍计算。实际 GPU 与扩展组合编译通过，空近空同 Effect，灯序与同名外部灯身份隔离通过。静态及最终视觉 Review 无未解决 blocker／high／medium。
- 独立 Reviewer 自己经官方 Chrome DevTools MCP 打开最终 production，own context 桌面1440×900暗处、触屏844×390@2室外，actual ultra／volume0／ready=true，两张 PNG 亲自 view_image：15类物资颜色与部件可辨，相邻砖墙、道路、开口、天空、完整HUD／触控布局无新增退化／裁剪，console error/warn0。own页面全部关闭，preview／MCP／Chromium实际进程清理，4174／9345关闭，临时图／脚本／profile清理；未改源码／Git、未重复 Builder 验证。最终 Review 明确通过，允许正常提交。
- 性能 Review：真实光体积改变才 O(N) 选 caster，未变仅 16 元素常数比较；法线／shader slot 工作有界且释放安全。代表场景法线数量并未减少，缓存只消除相同输入的重复，不宣称本轮降低实际GPU纹理数。真实GPU BRDF与移动提交减少成立，稳态 draw／Effect／法线持平；无已识别需额外本机采样才能提交的>15%回退风险，不等于完整帧时间／FPS改善。新HEAD同runner三轮报告仍需 Review；非阻塞余地为大AABB合并批次、植被alpha-test和后处理，不扩大本轮规格／预算。
