## Plan

### 背景

用户要求在保持单机和联机性能的前提下，增加医院建筑变体，并修复观战 HUD、AI 跑毒和部署加载反馈问题。

### 目标

1. 每局按 seed 选择一栋现有建筑改造成白色两层医院，并显示医疗十字和小地图标记。
2. 医院一楼保证一个急救包记录和一个绷带记录（数量 2），从既有医疗物资额度调拨，总物资数量及类别额度不增加。
3. 医院碰撞、楼层、楼梯、AI 导航和物资拾取继续使用标准权威建筑链路。
4. 玩家死亡观战时，小地图位置和方向跟随当前观察角色。
5. Tab 排行榜底部显示本局由本玩家击杀的对象列表，并在 checkpoint/重连后保留。
6. AI 在毒圈外路径失败时持续向圈内移动，不被旧导航路径或旧强制迁移目标覆盖。
7. 点击开始部署后立即显示明确的加载动画和“正在准备战场”提示。
8. 不增加每帧全量扫描、高频寻路、额外建筑数量或额外 loot record。

### 实现顺序

1. 修复 HUD 观战与击杀记录数据契约。
2. 修复 AI 跑毒旧导航覆盖。
3. 生成医院 descriptor、建筑变体、额度内医疗物资和地图/场景标记。
4. 完善加载 UI。
5. 补测试、自检、浏览器性能验收。
6. 调用 reviewer 并闭环全部真实问题后推送上线。

## Build

### 更新日志

- 2026-07-21 01:20：完成现状梳理。观战小地图根因为 `GameHud` 仍使用死亡玩家；AI 跑毒根因为 zone path 失败后旧 navigation path 在 cached tick 覆盖向圈内命令；医院采用复用一栋现有建筑并调拨两条 supplemental medical 记录的方案；准备开始实现。
- 2026-07-21 02:03：完成第一轮实现。观战小地图改用当前 `viewedActor`；用户取消 Tab 击杀对象记录，相关状态/UI 未保留。AI zone path 失败会清旧导航，建筑内地面路径失败会经正门分段路径出入，圈外强制迁移会立即取消。医院按 seed 复用一栋现有建筑并占用既有多层配额，固定两层白墙、医疗十字、小地图标记和一楼 bandage ×2 / medkit ×1；supplemental 总数仍为 10、总 loot 仍为 250。部署加载页增加双帧让出、转圈动画和战场准备说明。类型检查及 97 项相关测试通过，等待完整测试、浏览器与性能自检。
- 2026-07-21 02:17：完成实现自检。应用 25 files / 246 tests、Worker 26 tests、`npm run typecheck`、`npm run build`、`npm run build:worker`、`git diff --check` 全部通过。production preview 静音、控制台无错误；加载提示在 6× CPU 降速下被观测到持续约 14.76 秒；单一 Babylon 页面中等画质 10 秒约 119.23 FPS、无 long task。医院 marker DOM、白墙/十字场景测试、医疗额度及正门导航测试均通过，准备进入 reviewer 闭环。
- 2026-07-21 02:31：reviewer 提出两个 blocker，均确认真实并已修复：高地建筑正门 waypoint 不再使用海平面高度，而读取门内外本地 terrain support；zone path 会复用现有有效路径，失败后 2 秒内只保持向圈内移动，避免单 Bot 最高约 80 次/秒重复寻路。新增 seed 99 高地医院建筑退出测试和失败路径寻路次数上限测试，类型检查与相关回归通过，准备再次 reviewer。
- 2026-07-21 02:50：第二轮 reviewer 指出分段路径碰撞过滤仍使用 supportY=0、缩圈连续 radius 会重置 retry 两个 blocker，均确认并修复。门内外分段现在分别使用本地 ground support；重试改为绝对时间节流，不受 center/radius 连续变化影响；若门外到远端圈目标搜索失败，先返回“室内到门外”的部分路径，出门后再规划。seed 99 高地医院向背门方向目标的 20 秒退出测试及动态缩圈寻路次数上限测试通过，准备第三轮 reviewer。
- 2026-07-21 02:59：第三轮 reviewer 无 findings，审查闭环完成。最终门禁通过：应用 25 files / 246 tests、Worker 26 tests、`npm run typecheck`、`npm run build`、`npm run build:worker`、`git diff --check` 全部成功；医院、观战小地图、AI 建筑逃生/跑毒、加载提示与性能要求均覆盖。等待生产无活动房间确认、提交推送和线上验收。
- 2026-07-21 03:10：部署前确认生产无活动房间，Worker 已部署 `c3b425f7-d955-46f4-bdfe-37d232384de0`，实现提交 `41983ad` 已推送。GitHub Actions `29770422565`、GitHub Pages 和 Cloudflare Pages production deployment `58ba537a-1c93-490b-b204-6425a439498f` 均成功。生产静态包 `index-p7FG0_iV.js`，静音浏览器确认加载提示可见约 2.24 秒、医院小地图 marker 存在、控制台无错误；Git 工作区与 `origin/main` 对齐。

## Review

待实现完成后由 reviewer 记录审查结论。

### 2026-07-21 02:25 CST

- 审查范围：当前未提交改动相对 `main@c444cf7` 的全部 16 个业务/测试/文档文件；按用户确认，Tab 击杀对象历史已取消，不作为缺项。
- 对照计划：`.agents/plans/2026-07-21-hospital-hud-ai.md`。
- 审查结论：**不通过，有阻塞问题。**
- 必须由 builder 处理：
  1. `GridNavigator.findGroundDoorPath` 把门内外 waypoint 按 `GROUND_LOCATION` 归一到固定 `y=1.76`；高地建筑中的角色实际眼高更高，`BotController` 又用三维距离判定 waypoint 到达，导致 AI 卡在门口。seed 99 医院复现：20 秒后仅向错误方向移动约 8.05m，距安全区从 150m 增至约 158.05m。门 waypoint 必须使用各自地形/支撑高度，并补高地医院、非正门方向的实际 MovementSystem 出楼回归。
  2. `navigateIntoZone` 在每次 AI 决策都重新对最多 10 个候选执行 `findPath`，未复用仍有效的 zone path。实测终局单 Bot 成功路径约 8 次/秒、全失败约 80 次/秒；这不满足“无高频寻路”和单双机性能合同。需要缓存/限频，并增加调用次数上界测试。
- 已参考验证：reviewer 实跑 `npm run typecheck`、6 个改动相关 Vitest 文件（103 tests）及 Worker 全套（26 tests）均通过；`git diff --check c444cf7` 通过。现有测试没有覆盖上述高地/非正门出楼及寻路调用频率问题。
- 其余核对：观战小地图改用 viewed actor；医院复用建筑和多层额度；supplemental 记录仍为 10、总 loot 仍为 250；医院白墙、视觉十字和小地图标记已实现；双 RAF 在重建场景前让加载提示获得绘制机会。未发现业务源码中的 `context.Background()`。

### 2026-07-21 02:36 CST 复审

- 审查范围：当前未提交改动相对 `main@c444cf7` 的完整 diff，并重点复核上一轮两个 blocker；Tab 击杀对象历史按用户取消，不作为缺项。
- 审查结论：**不通过，两个 blocker 均未完全闭环。**
- 必须由 builder 继续处理：
  1. 门内外 waypoint 已改为本地 terrain support，但 `findGroundDoorPath` 的室内/室外分段仍以 `GROUND_LOCATION(supportY=0)` 调用 `findSurfacePath`，高地建筑墙因此被 blocker 高度过滤掉。seed 99 医院向后墙方向跑毒复现：生成的路径从正门外直穿整栋建筑到北侧目标，Bot 20 秒后仍在建筑内并卡在后墙。现有测试把目标设为 `z-500`（该 seed 下约为 `-1324.48`，超出地图且正对前门），实际走的是 path 全失败后的直线 fallback，没有覆盖门分段路径。
  2. 2 秒重试节流以每次调用的 `center/radius` 拼成 key；终局 `targetRadius < 24` 时会改用正在收缩的 current zone，center/radius 持续变化，key 每个决策都变化并重置 retry。单 Bot、失败 navigator、current radius 每 tick 缩小 0.2 的复现仍为 1 秒 80 次 `findPath`；新增测试只覆盖静态安全区。
- 已参考验证：reviewer 实跑 `npm run typecheck`、6 个相关 Vitest 文件（103 tests）、Worker 全套（26 tests）及 `git diff --check c444cf7`，均通过；上述动态/高地反向场景未被现有测试覆盖。
- 待复审标准：高地医院从非正门方向实际经门离开并进入圈；收缩中的终局 current zone 在持续失败时仍满足 2 秒节流与搜索次数上界。

### 2026-07-21 02:55 CST 第三轮复审

- 审查范围：当前未提交改动相对 `main@c444cf7` 的完整 diff，重点复核前两轮 blocker；Tab 击杀对象历史按用户取消，继续排除。
- 审查结论：**通过。本次审查未发现 blocker 或高风险问题。**
- blocker 闭环：门内外 waypoint 与分段碰撞过滤均使用各自本地 ground support；门外长路径失败时返回到正门外的部分路径，Bot 出门后重新规划。reviewer 实际复现 seed 99 医院向北 500m 目标，20 秒后 Bot 已离开建筑并把剩余距离从 500m 降至约 302.01m。
- 性能闭环：zone path 复用仍有效；失败重试使用不随动态 center/radius 重置的绝对时间。reviewer 以终局单 Bot、current radius 每 tick 缩小 0.1、navigator 恒失败复现 1 秒仅 10 次候选搜索，符合 2 秒节流预期。
- 验证：reviewer 实跑 `npm run typecheck`、6 个相关 Vitest 文件（103 tests）、Worker 全套（26 tests）及 `git diff --check c444cf7`，均通过；plan 中既有完整测试、构建、静音浏览器和性能验收记录继续有效。
- 残余风险：本轮未重复完整 25-file app suite、生产 build 或浏览器验收，参考了 Build 记录；未发现业务源码中的 `context.Background()`。
