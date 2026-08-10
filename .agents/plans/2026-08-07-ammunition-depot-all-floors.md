# 弹药库全楼层物资

## 背景

PR #4 已为每座弹药库提供完整内置楼梯和所有楼层的权威通路，但四份弹药库专属弹药仍全部放在一楼。本轮目标是让弹药库的每个室内楼层都有完整专属物资。

这是基于已提交基线 `3312ec799d53ad88c90d9e457d8fbe258c0d1a84` 的新一轮后续实现。此前已提交的计划保持只读。

## 合同

- 选中的弹药库建筑每个室内楼层都包含四种枪械弹药各一份：
  - `ammo.rifle × 90`
  - `ammo.light × 96`
  - `ammo.shell × 18`
  - `ammo.sniper × 16`
- 室内楼层编号为 `0` 到 `storyCount - 1`。屋顶不属于室内弹药楼层。
- 一层弹药库保留 4 份，两层有 8 份，三层有 12 份，四层有 16 份。
- `AmmunitionDepotPoi` 显式记录每层物资索引。大逃杀初始化直接消费这些索引，不从数组尾部推断。
- 原有 250 条全局物资记录保持不变。弹药库记录从索引 250 开始，按楼层优先，再按步枪弹/轻型弹/霰弹/狙击弹顺序追加。
- 每份弹药位于对应楼层的权威支撑面上，留在建筑内部，避开楼梯井/坡道占地，可站立，并可从一楼门通过 Movement 与 GridNavigator 共用的内置楼梯到达。
- 单机、Worker 和 standalone 根据同一地图/种子得到相同的初始物资数量。
- 因该 PR 尚未合并，checkpoint 版本保持 7、协议保持 8；发布前更新其最终未合并合同。
- checkpoint 恢复要求包含该 checkpoint 显式 `mapId + mapSeed` 对应的全部规范初始物资键，同时继续允许合法额外动态掉落/死亡记录。
- 非目标地图事实和前 250 条物资记录与 `main` 完全一致。

## 计划

1. 为一至四层弹药库添加先失败的布局与大逃杀测试。
2. 用显式逐层记录替换单个四索引弹药库记录。
3. 在每个室内楼层的正确支撑高度生成 4 个无阻挡点。
4. 按楼层初始化固定弹药记录。
5. 让 checkpoint 规范名单校验通过 `createMapLayout(mapId, mapSeed)` 推导所需数量。
6. 为缺少最高楼层最后一条规范记录增加单元及真实 standalone/Worker 恢复覆盖，同时继续接受合法动态记录。
7. 对非目标字段和前 250 个点重新运行相对 main 的零漂移比较。
8. 运行 Node 24 typecheck、完整单元/standalone 测试、Worker dry-run、浏览器/服务端/standalone 构建、预算和 `git diff --check`；不运行覆盖率。
9. 在音量 `0` 下使用 production Chrome 验证一层、两层、三层弹药库，包括逐层物资高度和内置通路证据。
10. 后续提交前运行独立审查者，推送到 PR #4，重新运行 CI/Pages/Codex，并保持 PR 开放。

## 构建

- 2026-08-07：完成度审计发现缺口。代表种子中的弹药库有一至三层，但全部显式索引都指向高度约 `0.11–0.23` 的一楼位置，上层没有弹药库专属弹药。
- 2026-08-07：新增按楼层优先的显式 `AmmunitionDepotLevel` 记录。每个室内楼层现在都在不变的 250 条全局前缀后追加步枪弹/轻型弹/霰弹/狙击弹索引，`BattleRoyaleMode` 为每个记录楼层创建四份固定弹药。
- 2026-08-07：上层点使用共享权威楼板支撑，一楼点跟随地形。9 个覆盖岛屿/城镇/混合地图的一至三层 fixture 通过高度、索引、门到楼层导航、可站立和 3D 拾取检查。
- 2026-08-07：checkpoint 兼容性现在根据持久化的 `mapId + mapSeed` 重建规范初始物资数量；它要求每个规范键，同时仍允许合法动态记录。单元和真实 standalone SQLite 测试使用三层混合弹药库，并拒绝缺少最后 `loot-261` 记录的 checkpoint。等价 Worker Durable Object 回归已存在并通过类型检查，但本机 glibc 2.28 无法启动当前 `workerd`；推送后仍必须以 GitHub Node 24 Worker 套件为证据。
- 2026-08-07：分离的 `3312ec7` 对比覆盖 island/town/mixed 的种子 `0, 1, 2, 4, 7, 19, 42, 99, 2026`；所有非弹药库名单布局事实和 `lootSpawnPoints[0..249]` 都逐字节 JSON 一致。
- 2026-08-07：Node 24 验证通过完整单元 `46 files / 472 tests`、完整 standalone `3 files / 26 tests`、三目标 typecheck、浏览器构建、Worker dry-run、服务端构建、同源 standalone 构建、预算和 `git diff --check`。一次并行 standalone 运行使未修改的 malformed-members 测试在 5.127 秒超时；单 worker 完整套件不改代码即通过。未运行覆盖率。
- 2026-08-07：Production Chrome DevTools MCP 在音量 `0` 下验证一至三层岛屿弹药库。场景分别显示 `4 / 8 / 12` 个启用的弹药库标记；每个上层都有位于自身支撑高度的四种弹药，一楼标记跟随地形。弹药库标牌、专用表面批次、楼板批次和内置坡道批次均存在。控制台只有本地 SwiftShader 警告，全部请求资源成功加载。
- 2026-08-07：每轮浏览器验证使用独立 context，并立即关闭页面和 preview 服务。最终只剩 page 1 `about:blank`，8798 端口无监听，没有任务 preview 进程和临时基线 worktree。

## 审查

### 2026-08-07 最终独立审查

- 范围：静态审查基线 `3312ec799d53ad88c90d9e457d8fbe258c0d1a84` 上尚未提交的后续差异，并将完整分支与 `origin/main@feea36a` 比较。检查本计划、根 `AGENTS.md`、`README.md`、架构/部署指南、地图生成、逐层物资索引、`BattleRoyaleMode`、AI 导航和 3D 拾取、checkpoint 兼容性、Worker/standalone 恢复调用方及受影响测试。
- 结论：**不通过；提交继续阻塞。**
- 审查发现：blocker 0、high 0、medium 1、low 0。

1. **Medium — 合法四层混合地图弹药库未进入文档和测试合同，直接大逃杀初始化测试甚至没有覆盖计划中的三层边界。**
   - 位置：`src/config/mixedMap.ts:38`、`src/config/mixedMap.ts:852`、`src/config/map.ts:1987`、`tests/unit/mapLayout.test.ts:140`、`tests/unit/battleRoyaleMode.test.ts:50`、`tests/unit/battleRoyaleMode.test.ts:133`、`docs/architecture.md:45` 以及本计划第 1 步和三层合同。
   - 混合地图城镇建筑可以合法拥有 `storyCount: 4`，弹药库选择不会限制首选 warehouse/factory 的层数。只读 blueprint 扫描在 mixed 种子 `0..127` 中找到 13 个四层弹药库；`createMapLayout("mixed", 5)` 选择四层 `mixed-building-0-30`，有 266 条规范记录，顶层索引为 `loot-262..loot-265`。
   - 当前实现按 `building.storyCount` 循环；针对 seed 5 的检查显示 level 3 支撑正确且门到物资路径非空。因此这是缺失合同/回归边界，而不是当前循环已经运行失败。
   - 9 个显式布局 fixture 只覆盖一至三层。更重要的是，`battleRoyaleMode.test.ts` 的固定弹药直接断言在 `() => 0.5` 时只命中两层弹药库，种子化物资顺序 fixture 命中一层弹药库；它们没有验证三层或合法四层顶层的物品、数量、顺序和最终索引。三层 checkpoint 测试只证明合法名单包含 `loot-261` 且删除会被拒绝，不能独立证明最高层四份大逃杀物品语义。
   - `docs/architecture.md` 只列出 254/258/262 条规范记录，遗漏真实的四层 266 条情况；计划也只描述一至三层。未来固定数量校验可能因此退回 262，即使 mixed seed 5 需要 `loot-265`。
   - 修复要求：保持所有室内楼层行为，增加确定性四层 mixed 布局/可站立/导航/3D 拾取 fixture；增加真正覆盖计划三层和合法四层顶层的 `BattleRoyaleMode` 初始化断言；记录 266 条情况。重跑受影响聚焦测试并复审。除非产品合同明确改变且审查种子弹药库身份/零漂移影响，否则不得为迎合现有 fixture 把选择限制为三层。

- 静态实现路径未发现其他 blocker/high/medium。逐层索引从 250 起按楼层优先和四种弹药顺序连续；已审查的一至三层 fixture 位于权威楼板/地形上并避开楼梯占地；AI 与拾取使用 3D 距离；Worker 与 standalone 共用 `isMatchCheckpointCompatible`；合法额外物资继续接受；在有界 8 项地图布局缓存使用前校验 `mapId` 与 uint32 `mapSeed`，未发现 checkpoint 输入导致无界数量/缓存行为。
- 审查接受而未重复外层证据：单元 `46/472`、standalone `3/26`、三目标 typecheck、全部构建、预算、27 布局基线比较和音量 `0` 的 Chrome 检查。审查者 仅使用只读 fixture/种子检查补充未覆盖层数和顶层风险，没有重跑完整测试、构建、预算、Worker runtime 或浏览器命令。

### 最终审查发现处置

- **Medium（合法四层混合弹药库和缺失顶层直接语义）— 已解决。**
  - 保留全楼层实现，并将 mixed seed `5` 加为确定性四层边界。布局合同现在覆盖 island/town 一至三层和合法 mixed 四层，包括连续到 `loot-265` 的楼层优先索引、支撑高度、门到楼层导航和总规范数量 `266`。
  - 为 island seed `4`（三层）和 mixed seed `5`（四层）增加直接 `BattleRoyaleMode` 初始化断言。二者都验证顶层四种弹药记录、精确数量、位置、稳定物资 ID、来源、可用状态和动态总数。
  - 增加聚焦 mixed seed `5` 回归，证明最高层全部四个物资位置从权威门可导航，并可通过普通 3D `InventorySystem` 拾取路径交互。
  - 更新 `docs/architecture.md` 记录合法四层/266 条情况，不改变弹药库选择或任何种子化布局事实。
  - 聚焦 Node 24 验证通过：布局边界 `10 passed`、顶层大逃杀初始化 `2 passed`、四楼导航/拾取 `1 passed`、app typecheck 和 `git diff --check`。最初启动的三文件命令因会重跑无关的长时间 49 Bot 模拟而提前停止，不宣称该中断命令的结果。

### 2026-08-07 第 2 轮独立审查

- 范围：只复审“最终独立审查”唯一 Medium 审查发现及 `tests/unit/mapLayout.test.ts`、`tests/unit/battleRoyaleMode.test.ts`、`tests/unit/aiLootReachability.test.ts`、`docs/architecture.md` 和本计划中的增量处置差异，不重新打开更广实现范围。
- 结论：**通过；Medium 审查发现已关闭。**
- 审查发现：blocker 0、high 0、medium 0、low 0。
- mixed seed `5` 布局 fixture 将合法四层边界锁定为 266 条规范记录，验证连续到 `loot-265` 的楼层优先索引、权威支撑高度，以及从一楼门到每个弹药库点的非空路径。
- island seed `4` 与 mixed seed `5` 初始化 fixture 直接验证三层和四层顶层的四种弹药 ID、数量、位置、稳定物资 ID、generation、source、availability 和随地图变化的总记录数。
- 聚焦 mixed seed `5` 可达性 fixture 从权威门检查顶层四个点，并让角色位于该点的三维交互高度，通过普通 `InventorySystem` 交互路径拾取。
- `docs/architecture.md` 现在记录 254/258/262/266 条规范初始记录，本计划的审查发现处置准确反映修复和证据。
- 接受而未重复既有外层证据：布局 `10 passed`、大逃杀 `2 passed`、AI 拾取 `1 passed`、Node 24 app typecheck 和 `git diff --check`。本轮没有运行测试、构建、浏览器或其他验证命令。

## 2026-08-08 小地图视觉对齐后续

### 背景

弹药库小地图标记已经存在，并使用正确图标和位置，但其 wrapper 类遗漏在共享 POI 标签和 fallback 圆形 CSS 选择器之外。这是弹药库功能自身的视觉缺陷，因此继续记录在本计划中，不另建计划。

### 合同

- 弹药库小地图标签必须与普通 POI 和医院使用完全相同的字体族、字号、字重、填充、字距、文本锚点、描边、绘制顺序和纵向偏移。
- fallback 圆形必须使用与其他 POI fallback 标记相同的填充、描边和描边宽度。
- 专用图标和权威位置保持不变。
- 每项可见改动完成前都必须在音量 `0` 下截取 production Chrome/Edge 截图，检查受影响区域，并与相邻同角色元素明确比较。

### 计划

1. 保留修复前截图，以及普通 POI、医院和弹药库标签的 computed-style 对比。
2. 编辑 CSS 前添加聚焦失败的样式表回归。
3. 把弹药库 wrapper 加入既有共享 POI 文本和 fallback 圆形选择器，不增加特殊覆盖。
4. 运行聚焦单元测试、app typecheck、production build、预算和 `git diff --check`；不运行覆盖率。
5. 在音量 `0` 下打开 production build，截取修复后小地图，检查字体/颜色/大小/对齐/重叠，并确认 computed style 与医院和普通 POI 完全一致。
6. 运行独立审查者，解决 blocker/high/medium 审查发现，提交并推送本轮修复，然后要求最新 SHA 的 CI、Pages 和 Codex 通过。

### 构建

- 2026-08-08：修复前 production 截图 `/tmp/last-line-minimap-before.png` 直接显示缺陷：黑色默认大小的“弹药库”覆盖小地图中心，而其他标签都是小号描边战术文字。
- 2026-08-08：computed style 确认普通 POI 和医院标签使用 `6.5px`、字重 `700`、`rgb(220, 226, 215)`、居中、战术字体和描边优先绘制。弹药库错误使用 `16px`、字重 `400`、黑色填充、起始对齐、Inter/系统字体和普通绘制顺序。
- 2026-08-08：根 `AGENTS.md` 现在要求每项可见功能改动都必须通过真实 production 截图检查，并与相邻同角色元素视觉对齐；DOM、测试或 computed style 不能替代截图审查。
- 2026-08-08：共享字体/颜色修复后，实现 Agent 亲自打开 `/tmp/last-line-minimap-island-after.png`；岛屿弹药库标签与周围 POI 一致，不再覆盖地图中心。字体、大小、字重、填充、间距、锚点、描边和绘制顺序的 computed style 与普通 POI 和医院完全一致。
- 2026-08-08：第二张必需截图没有接受仅 CSS 修复，而是发现剩余灰炉城缺陷。`/tmp/last-line-minimap-town-after.png` 中弹药库标签样式正确，但过于靠近右上密集标签。浏览器边界框确认“弹药库”与“仓储港区”重叠，因此必须增加确定性标签避碰。
- 2026-08-08：标签布局扩展为所有命名小地图标记，而不是增加弹药库专用偏移。所有 POI、医院和弹药库共用相同视觉样式与确定性候选放置；标签避开其他标签和所有 12px 图标，同时留在地图边框内。
- 2026-08-08：聚焦样式表/小地图回归 `23/23` 通过。三图各扫描 `160` 个种子（共 `480` 个布局），确认所有命名标签两两不交、每个标签避开每个图标且留在小地图边框内。app typecheck、production build、预算和 `git diff --check` 通过；未运行覆盖率。
- 2026-08-08：实现 Agent 亲自打开最终 MCP 截图 `/tmp/last-line-minimap-town-zero-overlap.png`、`/tmp/last-line-minimap-island42-zero-overlap.png` 和 `/tmp/last-line-minimap-mixed-zero-overlap.png`。灰炉城密集标签、岛屿 seed 42 几乎重合的弹药库/仓库标记，以及混合地图都使用一致战术字体、大小、字重、颜色、对齐和可见图标间距。
- 2026-08-08：真实浏览器边界框确认三张最终截图均为零标签/标签和零标签/图标相交（分别 `10/10`、`10/10`、`8/8` 个标签/图标），音量 `0`。控制台只有本地 SwiftShader 警告。每个隔离 context 和 preview 服务立即关闭；最终 MCP 回到唯一不可避免的 `about:blank`，8798 端口无监听。
- 2026-08-08：最终 Node 24 验证通过完整单元 `46 files / 483 tests`、完整 standalone `3 files / 26 tests`、三目标 typecheck、production build、预算和 `git diff --check`。在并发完整单元测试负载下，一次并行 standalone 运行使两个 SQLite 恢复测试超过未修改的 5 秒限制（`5.232s / 5.280s`）；单 worker 完整 standalone 套件不改代码即通过。未运行覆盖率。

### 审查

#### 2026-08-08 小地图视觉对齐独立审查

- 范围：静态审查基线 `ed1624da3a86c6dc752579f43ea49edc8285b7e0` 上尚未提交的小地图视觉对齐差异，并将完整功能分支与 `main` 比较。检查后续合同和已记录证据、根 `AGENTS.md`、共享小地图 CSS、确定性标签放置、`GameHud` 标记到 SVG 调用链和聚焦回归。没有重复测试、typecheck、构建、预算、种子扫描或浏览器命令。
- 结论：**通过；提交不再阻塞。**
- 审查发现：blocker 0、high 0、medium 0、low 0。
- 弹药库 fallback 圆形和文本现在与普通 POI、医院共用完全相同的 CSS 声明块，后续没有选择器覆盖字体族、大小、字重、填充、间距、锚点、描边、绘制顺序或标记颜色。
- 每个普通 POI、医院和弹药库进入同一稳定布局序列；贪心候选顺序确定，标签放置前所有标记图标已作为阻挡物，已接受标签按序成为新阻挡物，选择的偏移通过 `x` 和 `y` 直接传入各 SVG `<text>` 元素。
- 当前宽度模型对受控全中文标记名采用保守估算，基于共享 `6.5px` 字体、`0.04em` 字距和 `2px` 居中描边；9px 纵向框同样包含字号框和描边。12px 图标阻挡框与渲染图片尺寸一致，fallback 圆形使用刻意更大的保守阻挡框。
- 候选耗尽时会回退到历史偏移；若未来地图增加大量标记、更长名称或不同字体度量，这是残余考虑。当前不构成阻塞：已记录的 480 布局扫描覆盖每个生成标记且未耗尽候选，三个 production 浏览器边界案例用真实渲染边界框确认零标签/标签和标签/图标相交。
- 聚焦测试覆盖共享布局输入中的每类标记、island/town/mixed fixture 的成对标签与图标净空、稳定视觉资源和共享 CSS 选择器回归。静态调用链审查与已记录 production 截图共同确认纯放置结果进入真实 HUD 渲染器。
- 新 `AGENTS.md` 规则明确要求实现 Agent 在音量 `0` 下截取并亲自打开 production MCP 截图，列出必需视觉比较，并明确拒绝用 DOM、computed style、单元测试、控制台或第二 Agent 报告替代截图审查。
- 接受而未重复既有外层证据：聚焦 `23/23`、app typecheck、production build、预算、`git diff --check`、480 布局扫描、3 张亲自检查的 production 截图、3 次真实浏览器零相交检查、音量 `0`、控制台检查和即时 MCP/preview 清理。
