# Linux Chrome 下拉框对比度

## 目标

修复 Linux Chrome 主菜单地图与画质原生下拉框出现浅色弹层、灰字对比度不足的问题，不替换原生 select，也不改变 macOS、移动端、持久化值或玩法语义。

## 验收

- 设置下拉框显式使用深色原生控件配色。
- Chrome 允许 option 样式时，弹层使用确定性深色背景和可读浅色前景。
- 原生键盘导航、焦点、箭头、持久化值和菜单布局不变。
- 修改只涉及 CSS，不影响玩法、地图、画质、联机或权威状态。
- 聚焦测试、production build、预算和 Linux Chrome 截图通过。

## 构建

- 在 `tests/unit/gameHudActions.test.ts` 添加 CSS 合同红测，修复后 4/4 通过。
- 只修改 `.settings-grid select` 与 `option`：保留 `appearance: auto`，使用 `color-scheme: dark`、前景 `var(--ink)` 和背景 `#111714`。
- 完整 typecheck、聚焦测试、standalone 21/21、浏览器/Worker dry-run/standalone 构建和预算通过；CSS 为 `44,643 / 45,000` 字节。
- 完整应用测试唯一未通过项是既有地图用例在高 CPU 负载下超过墙钟超时；原断言单独运行通过，未修改业务阈值。
- 本机 glibc 2.28 无法启动 `workerd`；Worker typecheck、dry-run 和 Node 24 CI 作为门禁。
- 音量 `0` 的 Linux Chrome production 截图确认地图/画质弹层为深色、文字可读，console 无应用错误；验证后返回 `about:blank` 并释放端口。

## 审查

- 第 1 轮发现 1 个 medium：测试正则错误依赖 `color` 与 `background` 的声明顺序。
- 修复为先提取 option 声明块，再分别断言两个属性，避免等价重排导致假失败。
- 第 2 轮复审通过；剩余 blocker/high/medium 均为 0。
