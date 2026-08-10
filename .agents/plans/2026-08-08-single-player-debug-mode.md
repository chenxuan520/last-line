# 单机调试模式

## 目标

添加显式启用的本地调试模式，方便检查单机玩法，同时不改变联机行为或协议。

## 验收

- `npm run dev -- --debug=true` 启用；普通开发和 production build 保持关闭。
- 主菜单明确显示单机调试已启用。
- 只有本地单机会话获得调试行为；联机会话、共享协议、Worker 和 standalone 权威逻辑不变。
- 调试模式下本地玩家免疫枪火、手雷和圈伤。
- 对局内面板显示阶段、部署、位置、生命、护甲、击杀、武器和背包。
- 面板支持立即落地、设置生命/护甲/击杀、完整测试套装、清背包和按合法 stack 发放任意 `ITEMS`。
- Unit 覆盖参数解析、默认关闭、免伤、所有物品类型、合法拆栈、立即落地和联机隔离。
- 提交前完成 typecheck、unit/Worker/standalone、构建、预算、静音浏览器截图和独立审查。

## 实现

- 小型 Vite 启动器在启动前剥离应用专用 `--debug=true`，并导出 `VITE_SINGLE_PLAYER_DEBUG=true`。
- 状态修改放在无 DOM 单机调试系统；面板只发动作，不拥有权威状态。
- 向单机战斗、投掷物和大逃杀模式注入同一个调试感知 `DamageSystem`。
- 只有 `BattleRoyaleSession` 创建面板和调试系统，标志不传给 `MultiplayerSession`。

## 构建

- Node.js 24.18.1 三项目 typecheck 通过。
- 聚焦调试/共享伤害 5 文件 70 测试，完整 unit 49 文件 524 测试，standalone 3 文件 32 测试通过。
- 本机 glibc 2.28 无法启动 `workerd`；Worker TypeScript 通过，真实 Worker 由 GitHub CI 门禁。
- 浏览器、Worker dry-run、服务端、standalone 构建和预算通过。
- 普通 production 不含调试文本、样式或 chunk；调试构建单独产生 `SinglePlayerDebugPanel` chunk 并动态加载样式。
- 音量 `0` 的 Chrome 验证确认菜单徽章、F10 释放 pointer lock、面板真实点击、立即落地、测试套装、修改击杀、合法拆栈发手雷、选择/消耗手雷和爆炸后生命/护甲；默认开发不显示面板。Console 只有软件 WebGL 警告。
- 每轮截图后返回 `about:blank`、关闭隔离页并停止 8797 端口。

## 审查

- 第 1 轮发现 1 个 medium 旧测试合同和 1 个 low 文档措辞，均修复。
- 第 2 轮发现同时致死预测可能给 Bot 1 HP，尽管调试玩家免伤；`DamageSystem.wouldBeLethal()` 统一处理免伤感知预测，并增加 3 条系统回归。
- 第 3 轮独立复审通过，blocker/high/medium/low 均为 0。
