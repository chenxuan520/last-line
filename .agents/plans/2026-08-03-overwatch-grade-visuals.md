## 计划

### 目标

在独立分支中进行大规模表现升级，在保留权威玩法的前提下，让 Last Line 更接近精致、高保真的英雄射击 3D 体验。除非已有合同明确要求，否则改动必须限制在表现/UI 层。

### 范围

- `src/game/` 不得引入 DOM/Babylon 关注点。
- 保持岛屿/城镇地图权威、移动、战斗、视线、AI、联机协议和服务端语义不变。
- 通过 Babylon 场景设置、相机曝光、雾、色调映射、材质响应、静态视觉细节和 HUD 表现提升实时画质。
- 本轮避免大型新下载或脆弱外部资源；优先使用既有资源、程序化细节和 Babylon 能力。
- 保持画质设置有真实意义，只在安全范围内启用昂贵表现。

### 验收标准

- 场景必须呈现为更丰富的 3D 战场，而不是扁平程序化盒子：改善照明、空气纵深、材质变化、工业屋顶/立面细节、道路和地面层次，以及第一人称表现。
- 用户在首轮后明确提高标准：最终结果要尽可能逼真、观感优秀，形成可信的 3D 工业城镇。只增加装饰盒子不算完成；必须通过浏览器截图判断材质纵深、光照氛围和环境密度是否可信。
- UI 应更接近现代射击 HUD，但不增加说明文字，也不改变控制语义。
- 除既有权威几何外，新增表现必须不可拾取、不可碰撞。
- 单元、类型、构建和预算检查必须通过；环境缺口必须记录。
- 浏览器验证时音量必须为 `0`；结束后立即关闭页面/context 和本地服务。
- 提交或推送前必须完成独立审查者。

### 纠正验收：墙体、窗户与画质隔离

- 必须比较完整功能分支与 `origin/main@058988b`，不能只看最后一段未提交差异。除非本节明确接受，文档规定的高画质范围之外的表现变化都视为回归。
- 所有地图和画质恢复 `origin/main@058988b` 的场景照明、雾、清屏色和图像处理行为。任何画质都不得启用已否决的全场景 ACES/曝光/对比度/暗角调色；真实感只能来自局部几何和材质细节。
- 低/中画质不得获得高画质城镇视觉批次、剪影、HUD 调色或增强战斗特效。
- 高画质城镇窗户必须保留真实开口，不能呈现为不透明黑色阻挡。新增窗格必须不可拾取、不可碰撞、浅色、双面且高度透明（`alpha <= 0.2`）。
- 普通城镇墙体继续使用带 `texture.building.wall` 的权威程序化墙体几何；修正不得替换墙体几何、碰撞、视线、导航或地图 payload。已提交的医院白色表面行为保持不变。
- 高画质立面风化不得用大块近黑矩形覆盖墙体。只允许使用更浅、窄条状的雨痕/锈迹（`alpha <= 0.25`），底层墙面纹理必须保持视觉主导。
- 浏览器验收必须在音量 `0` 下同时覆盖中画质和高画质城镇：二者使用 main 场景照明/雾基线并关闭 Babylon 图像处理；中画质不得出现高画质 HUD/视觉批次；高画质必须显示透明窗户，墙面不得有黑色立面覆盖。每次检查后记录控制台并立即清理全部浏览器/服务资源。
- 三名独立审查者分别检查：(1) 墙体/窗户视觉材质；(2) island/town 与 low/medium/high 的画质隔离；(3) 完整分支相对 `origin/main` 是否存在无关或不兼容改动。所有 blocker/high/medium 审查发现都必须修复，并由三名审查者复审后才能提交/推送。

## 构建

- 2026-08-03：执行 `git pull --ff-only` 同步最新 `main`，随后创建 `visual/overwatch-grade-scene` 分支。
- 2026-08-03：在 `IslandScene` 中加入高画质城镇道路湿痕/标线、透明窗格、工业灯箱、屋顶设备、街道家具、架空线、立面管线、风化和工业天际线。全部新增细节合并为静态视觉批次，并标记为不可拾取、不可碰撞。
- 2026-08-03：用户明确重表现只能用于高画质。`town-visual-detail`、城镇剪影和高画质 HUD 均放在 `quality === "high"` 门禁后；低/中画质测试要求这些批次不存在。
- 2026-08-03：用户否决第一人称手臂外观后，完全删除 `view-arm`、手套、护腕和指关节网格；高画质第三人称肩甲、护膝和腰带保留。
- 2026-08-03：只做 payload 优化时删除未使用 CSS 变量并缩短只作用于 `#ui-root` 的选择器。合并 WebKit/Firefox range 伪元素被 审查者 判定不兼容后立即撤回；最终 CSS 预算从 `44,991/45,000` 降到 `44,511/45,000`。
- 2026-08-03：高画质岛屿新增海岸泡沫、道路湿痕和 POI 灯带；低画质明确不生成 `island-visual-detail` 和泡沫批次。
- 2026-08-03：合并 `origin/main@058988b` 的医院外墙白色修复，保留医院墙体、楼板、屋顶和剪影的白色无纹理合同。
- 2026-08-03：三轮交叉审查发现全场景暗色调色、城镇窗格材质泄漏到飞机驾驶舱，以及增强战斗粒子泄漏到低/中画质。最终恢复 `origin/main@058988b` 的照明、雾和清屏色，所有画质关闭 Babylon 全场景图像处理；高画质城镇窗格独立使用浅色双面 `town-window-material`（`alpha = 0.16`），驾驶舱继续使用不透明基线 `building-window-material`；`CombatEffects` 恢复 main 基线。
- 2026-08-03：中/高画质灰炉城 production Chrome 验收均使用音量 `0`、1440×757 画布且无页面控制台错误。像素分析得到中画质平均亮度 `0.284`、低于 10% 亮度像素 `5.9%`；高画质分别为 `0.370` 和 `6.7%`，证明移除全场景调色后高画质未整体变暗。
- 2026-08-04：Codex `discussion_r3709529388` 指出 3 个高画质批次合并多种源材质时只保留第一种。修复后仅在源材质不同的城镇视觉批次启用 Babylon multi-material/submesh 合并；测试锁定屋顶设备、工业管线和工业天际线的精确材质集合，普通开口批次继续使用 `StandardMaterial`。
- 2026-08-04：PR 评论 `discussion_r3706402564` 指出生产角色 GLB 会隐藏高画质肩/膝/腰装备。将 `high-detail-gear` 加入程序化角色保留类别，并用 base/LOD1 切换测试确认 5 个装备网格始终可见；低/中画质仍不创建这些网格。
- 2026-08-04：合并 `origin/main@addd672` 的灰炉城有机道路后，通过共享批处理 helper 回收约 1.58KB，保持浏览器入口在原预算内且不改变表现。
- 2026-08-04：PR 评论 `discussion_r3709318077`、`discussion_r3709318086` 要求装卸棚严格跟随权威一楼正门并把锈迹从普通风化材质中分离。最终 `createLoadingBayLayout` 成为渲染和测试共用的纯布局源，断言两根立柱内缘等于门洞边缘、雨棚底高于门顶，并覆盖偏移门洞；锈迹独立使用 `facade-rust` 批次和 `poiAccent` 材质。
- 最终 Node 24 验证覆盖完整 typecheck、场景/地图/standalone 测试、浏览器/Worker/服务端/standalone 构建和预算。最终记录预算为：浏览器入口 `1,074,965/1,075,000`、全部浏览器 JavaScript `3,771,620/3,900,000`、CSS `44,511/45,000`、`dist` `4,293,427/4,450,000`、Worker `455,919/460,000`、standalone `475,228/480,000`，未修改门槛。
- 每轮 production Chrome 验证均把音量设为 `0`，检查截图与控制台，然后立刻返回 `about:blank`、停止 Chrome/Vite preview，并确认 9222/8798 端口空闲。
- CI `30878384733` 曾在已知非确定性 Worker 大厅测试中出现一次 `room is not initialized`，第 2 次运行成功；同 SHA 的 PR CI `30878387115` 同时通过 Node 24 Worker、构建、预算和 Docker smoke。

## 审查

### 早期审查轮次

- 首轮发现城镇剪影在 `qualityLevel === "high"` 门禁之前生成，使低/中画质也获得重表现。修复后 `createTownBuildingSilhouettes` 与全部密集城镇细节共用高画质门禁；低画质断言剪影和 `town-visual-detail` 均不存在，高画质断言 6 个剪影批次和完整细节集合存在。
- 地面视角截图在当时的 headless/software WebGL 环境中受阻：真实触屏模式 80 秒只推进到 `航线部署 49%`、`1 FPS`，但音量 `0`、无页面控制台错误且完成清理。该项作为环境限制记录，不属于未解决代码审查发现。
- 工作流审查确认分支 push、面向 `main` 的 PR、`v*` tag 和手动触发都会运行核心 build；Pages 只允许非 PR 的 `refs/heads/main`，release/Docker 只允许 `refs/tags/v*`。
- CSS payload 审查发现把 `::-webkit-*` 与 `::-moz-*` range 伪元素放入同一 selector list 不具备跨浏览器等价性。最终恢复分离规则，只保留安全的变量删除和根选择器缩短。
- 岛屿高画质细节、第一人称手臂删除、灰炉城真实感扩展和医院白色表现合并均完成静态复审，没有遗留 blocker、high、medium。

### 画质与材质交叉审查

- Cross-review B 最初发现两个 medium：纠正补丁改变了高画质岛屿场景基线；透明城镇窗格错误复用 `materials.window`，使所有地图/画质的 `aircraft-cockpit` 变成浅青色双面透明材质。
- 最终 `configureScenePresentation` 不再按地图或画质分支，所有场景关闭 Babylon image processing、tone mapping、dithering 和 vignette，清屏色、雾、环境光和太阳参数与 `origin/main@058988b` 一致。低岛屿、中城镇、高岛屿、高城镇测试锁定该矩阵。
- 高画质城镇窗格独立使用浅色双面 `town-window-material`（`alpha = 0.16`）；飞机驾驶舱恢复完整 `building-window-material` 基线：diffuse `#26383b`、emissive `(0.025, 0.035, 0.034)`、默认派生 specular、`alpha = 1`、`backFaceCulling = true`。聚焦测试精确断言全部属性。
- Cross-review A 确认普通墙体继续消费权威 `layout.wallSegments` 和 `texture.building.wall`，门窗仍是真实分段开口；医院墙/楼板/屋顶/剪影保持白色无纹理；风化只使用 `#55584e`、`alpha = 0.24` 的窄雨痕，不再有大块近黑覆盖。最终 blocker 0、high 0、medium 0。

### 完整分支兼容审查

- Cross-review C 曾发现 1 个 high 和 3 个 medium：高画质城镇仍启用暗色全场景 ACES/曝光/暗角；窗格材质泄漏到驾驶舱；增强枪口/命中特效未按画质隔离；纠正后缺少完整验证和中/高画质浏览器验收。
- C-H1 通过删除全场景暗色调色并恢复 main 的照明/雾/清屏色关闭；C-M1 通过拆分 `townWindow` 与驾驶舱材质关闭；C-M2 通过让 `CombatEffects.ts` 与 `origin/main@058988b` 零差异关闭；C-M3 通过新 typecheck、28 个聚焦测试、完整应用/standalone 测试、各构建、预算、中/高画质截图、亮度分析、控制台检查和即时清理关闭。
- 本机 Debian glibc 2.28 无法启动要求 GLIBC 2.29–2.35 的 `workerd`；Worker typecheck 与 dry-run 通过，分支 CI 的 Node 24 Worker 套件作为最终门禁。最终 Cross-review C blocker 0、high 0、medium 0。

### PR 评论与最终复审

- `discussion_r3706402564`：生产角色 GLB 会让 `suppressProceduralCharacter` 隐藏 5 个 `high-detail-gear` 网格。修复后装备在 base/LOD1 切换和加载失败分支中保持，低/中画质仍不创建；复审通过。
- `discussion_r3709318077`：装卸棚测试只检查 `sourceCount`，无法证明立柱/雨棚跟随权威门洞。抽出 `createLoadingBayLayout` 作为渲染和测试共用源，断言立柱内缘等于门洞边缘、雨棚底高于门顶，并覆盖偏移门洞；审查者 A 复审通过。
- `discussion_r3709318086`：普通风化和锈迹错误共享材质。锈迹改为独立 `facade-rust`/`poiAccent` 批次，普通雨痕保持 `facade-weathering`/`#55584e`/`alpha = 0.24`；审查者 B 通过。
- `discussion_r3709529388`：多材质城镇视觉批次只保留第一材质。`mergeVisualDetailBatch` 仅在源材质对象不同的城镇批次启用 Babylon multi-material/submesh 路径；测试通过每个 submesh 的 `materialIndex` 锁定屋顶设备、工业管线和工业天际线的精确材质集合，普通单材质批次保持 `StandardMaterial`。
- 最终静态复审确认：高画质门禁、低/中画质隔离、墙体/开口权威一致性、医院白色合同、窗格/驾驶舱隔离、风化、装卸棚、多材质合并、角色 LOD 装备、非碰撞/不可拾取表现和预算均无剩余 blocker、high、medium。新 push 仍必须通过 CI 后才能报告交付完成。
