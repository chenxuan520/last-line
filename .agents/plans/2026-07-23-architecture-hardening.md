## Plan

### 背景

项目当前架构边界总体清晰，但只读审查确认了两处可能影响正确性的隐式契约：Bot 初始落点仍读取 seed-0 全局地图数据；房间账号状态缓存把成员 session revision 计算结果缓存到 account 维度。部分权威规则也存在多处重复定义，后续单边修改可能导致移动、命中、预测或伤害语义漂移。

### 目标

- 修复 Bot 落点与当前 `MapLayout` 不一致的问题，并正确处理地图 seed 切换。
- 修复 `GameRoom` 账号状态缓存粒度，缓存账号原始状态并逐成员校验 session revision。
- 在不改变现有表现、协议和存档语义的前提下，收口确认重复的权威规则。
- 更新 GitHub 仓库描述、Homepage 和 Topics，使其准确反映 50 人、联机和移动端能力。

### 实现范围

1. 为 Bot 保存索引，并始终从当前布局生成 fallback 落点；地图切换时清理旧落点相关缓存。
2. 将账号状态缓存改为保存 `enabled` 与 `sessionRevision`，保留现有 5 秒缓存和失败语义。
3. 优先收口不会改变行为的规则：伤害减免计算、Actor 权威尺寸、30 Hz 模拟时序、战利品交互距离与标记高度；仅在确认调用语义完全一致时合并。
4. 补充定向回归并运行完整类型检查、测试、浏览器/Worker/standalone 构建和预算检查。
5. 不修改用户已有的 `.gitignore` 改动。

### 非目标

- 不拆分 `IslandScene`、`BotController`、`GameRoom` 等大文件。
- 不改变 AI 决策优先级、地图生成随机序列、武器数值、碰撞尺寸或网络协议。
- 不在本轮引入覆盖率 provider 或覆盖率阈值。

### 验收标准

- 非 seed-0 Bot fallback 落点只来源于当前布局，切换 seed 后不保留旧布局目标。
- 同账号不同 session revision 的成员不会共享派生后的 active/revoked 结果。
- 重复规则只有一个权威来源，现有行为回归全部通过。
- GitHub 描述、Homepage、Topics 与 README 当前能力一致。

## Build

### 更新日志

- 2026-07-23 16:08：确认当前与目标分支均为 `main`，`HEAD=origin/main=6e6a649`；工作区仅有用户自己的 `.gitignore` 改动，本任务不触碰、不提交。完成只读架构审查并锁定上述最小实现范围。
- 2026-07-23 16:22：先补充失败回归，确认 Bot fallback 落点读取 seed-0 全局布局、地图切换保留旧目标，以及账号缓存复用成员派生状态三个问题。实现后 Bot fallback 改为从当前 `MapLayout` 派生并在 seed 切换时重置落点/跳伞缓存；`GameRoom` 改为按账号缓存原始 enabled/revision，并逐成员比较 session revision。新增 `actorGeometry.ts`、`damage.ts`、`loot.ts`、`simulationTiming.ts`，收口权威 Actor 尺寸、伤害减免、战利品交互/高度和 30 Hz 时序，不改变数值。类型检查及 152 个相关单元测试、7 个 Worker lobby 测试通过。
- 2026-07-23 16:55：按用户追加需求，为手机横屏 HUD 增加“背包”按钮，复用现有武器槽和背包渲染；弹层支持关闭按钮、背景关闭、ARIA 展开状态，并在暂停、旋转、淘汰或结果状态自动关闭。Chrome DevTools MCP 在 667×375、音量 0 下确认按钮、空武器槽、初始绷带、弹层尺寸和开关状态正常，无横向溢出；修复关闭时焦点仍位于 `aria-hidden` 弹层导致的浏览器警告后，最终控制台无 warning/error。验收后页面已回到唯一 `about:blank`，4173 预览服务及一处此前遗留的同端口 Vite 进程均已明确终止。
- 2026-07-23 16:55：最终验证通过：typecheck；应用 34 files / 317 tests、Worker 4 / 30、standalone 3 / 20，共 367 tests；浏览器、Worker dry-run、standalone server 构建及 `check:budgets` 均通过。最终预算为 entry 1,022,547、largest non-entry 613,551、all JS 3,719,202、252 chunks、CSS 43,052、dist 4,239,550、Worker 385,009、server 407,189。完整 Worker 首轮因新增房间回归暴露 `serverMetrics.test.ts` 依赖执行顺序，补充 `beforeEach(reset)` 后全套稳定通过。
- 2026-07-23 16:55：GitHub 元数据已更新：描述改为准确的 50-player / 49 AI / online / desktop & mobile 文案；Homepage 改为 `https://lastline.011203.xyz/`；新增 battle-royale、fps、browser-game、multiplayer、babylonjs、typescript、cloudflare-workers、websocket、mobile-game、ai-bots topics，并通过 `gh repo view` 回读确认。
- 2026-07-23 18:04：处理正式 review Round 1 的全部真实问题：地图 seed 切换现在同时调用 `clearForcedRelocation()`，清除旧布局 origin/target/deadline，并扩展 Bot 回归覆盖；`IslandScene` 的本地胶囊中心和相机椭球偏移改为从 `ACTOR_HEIGHT`/`ACTOR_EYE_HEIGHT` 派生，NullEngine 回归锁定共享尺寸；手机背包显式关闭时在弹层隐藏后把焦点归还仍可见的“背包”按钮，暂停/旋转/淘汰等自动关闭路径不会聚焦隐藏控件。验证通过：typecheck、Bot 56 tests、IslandScene 12 tests。按用户要求未重新启动 MCP，当前仍仅保留已清理后的 `about:blank`，无本地预览服务。
- 2026-07-23 18:11：处理 review Round 2 的 Low：`setMobileInventoryVisible` 新增显式 `restoreFocus` 参数，仅按钮、关闭键和背景点击等用户主动关闭路径把焦点归还仍可见的背包按钮；暂停、旋转、淘汰、结果卡等状态驱动关闭不再聚焦即将隐藏的控件。验证通过：typecheck、Bot/IslandScene 2 files / 68 tests；未启动 MCP 或本地服务。
- 2026-07-23 18:18：Round 3 reviewer 返回 No findings 后完成最终全量门禁：typecheck；应用 34 files / 317 tests、Worker 4 / 30、standalone 3 / 20，共 367 tests；浏览器、Worker dry-run、standalone server 构建及 `check:budgets` 全部通过。最终预算：entry 1,022,686、largest non-entry 613,551、all JS 3,719,341、252 chunks、CSS 43,052、dist 4,239,689、Worker 385,045、server 407,225。未启动 MCP 或预览服务。

## Review

- 2026-07-23 16:55：最终自审完成，No findings。逐项确认：Bot 只从当前布局生成 fallback 且 seed 切换会清理旧落点；账号缓存保存原始账号状态并按成员 revision 判断；共享规则数值与历史值完全一致；手机背包不创建第二份状态且不进入 `TouchInputAdapter` 动作协议；协议、checkpoint 和权威行为无需版本升级；`.gitignore` 未触碰；MCP 页面与预览服务已清理；GitHub 元数据回读与预期一致。
- 2026-07-23 17:59：正式 review `6e6a649..eb964f5`（基于本 plan，对照 `main`）结论为**不通过**。需 builder 处理两项 Medium：① `src/controllers/BotController.ts:148-168` 的 seed 切换重置仍未清理 `forcedRelocationOrigin/Target/Until`；旧 target 在 `1061-1064` 可继续复用，而它的高度由旧布局在 `1093-1096` 生成，故“地图切换不保留旧布局目标”尚未完整满足，现有新增测试只覆盖落点缓存；② `src/client/render/scenes/IslandScene.ts:1378,1513` 仍以 `-0.86`、`-0.88` 重复编码 Actor capsule/ellipsoid 的派生垂直偏移，修改共享尺寸后会与权威胶囊漂移，也使 `docs/architecture.md:25` 的“presentation 无独立数值副本”表述过早。另有一项 Low：`src/client/ui/GameHud.ts:496-508` 关闭背包时仅 blur 弹层内焦点，未将焦点归还 `inventory-toggle`，触控辅助技术/键盘用户会丢失关闭后的焦点位置。独立验证通过：`npm run typecheck`；定向单元 68 tests；Worker lobby/serverMetrics 8 tests；`check:budgets`；CI 29993225581 为 success，GitHub metadata 回读符合计划。风险提示（非额外阻塞）：CSS 为 43,052/45,000 bytes，仅余 1,948 bytes；新增 GameRoom 回归直接注入私有缓存，真实 force/404/unavailable/active-socket 路径主要依赖代码审查与既有 admin 契约测试。本轮未启动浏览器或服务器，按要求复用 plan 已记录的 MCP 验收；`.gitignore` 未纳入审查或改动。
- 2026-07-23 18:08：Round 2 复审当前 worktree（基线 `eb964f5`）结论为**不通过，剩余 1 项 Low**。Round 1 两项 Medium 已完整关闭：seed 切换调用 `clearForcedRelocation()`，新增回归确实锁定 origin/target/deadline 清空，且同一重置路径中其余布局目标均已重建或清理，未发现新的 blocker；`IslandScene` 两个偏移均从共享 Actor 几何派生，数值仍为 `-0.86`/`-0.88`，NullEngine 回归覆盖胶囊和相机。剩余 Low：`GameHud.showResultCard()` 在 `src/client/ui/GameHud.ts:356-359` 先自动关闭背包，此时 touch controls 仍带 `is-visible`，`496-512` 因而会把焦点归还背包按钮；随后 `update()` 在 `199-201` 隐藏 controls，但背包已关闭导致 early return，焦点最终仍留在隐藏控件上。需 builder 区分显式关闭与自动关闭并补定向回归；当前 Build 中“淘汰自动关闭不聚焦隐藏控件”的记录尚不准确。独立验证通过：`npm run typecheck`、Bot/IslandScene 2 files / 68 tests、`git diff --check`；README 与 architecture 仍准确。本轮未运行浏览器或启动服务器，`.gitignore` 继续排除。
- 2026-07-23 18:13：Round 3 最终复审当前 worktree（基线 `eb964f5`）通过，**No findings**。确认 `setMobileInventoryVisible(visible, restoreFocus)` 仅在 toggle/close/backdrop 三个用户显式事件传入 `true`，并且仍要求 touch controls 可见才归还焦点；`update()` 与 `showResultCard()` 等暂停、旋转、淘汰、结果自动路径使用默认 `false`，不会聚焦即将隐藏的按钮。Round 1 的 forced-relocation seed 重置、定向回归及 Actor 胶囊/相机共享几何派生均保持完整，未发现新增 blocker/high/medium/low；18:11 Build 记录准确。独立验证通过：`npm run typecheck`、Bot/IslandScene 2 files / 68 tests、`git diff --check`。本轮未运行浏览器或启动服务器，`.gitignore` 继续排除。
