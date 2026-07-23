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

## Review

- 2026-07-23 16:55：最终自审完成，No findings。逐项确认：Bot 只从当前布局生成 fallback 且 seed 切换会清理旧落点；账号缓存保存原始账号状态并按成员 revision 判断；共享规则数值与历史值完全一致；手机背包不创建第二份状态且不进入 `TouchInputAdapter` 动作协议；协议、checkpoint 和权威行为无需版本升级；`.gitignore` 未触碰；MCP 页面与预览服务已清理；GitHub 元数据回读与预期一致。
