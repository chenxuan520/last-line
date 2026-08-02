## Plan

### 背景

用户在本轮联机优化中追加三项局内体验需求：暂停卡增加返回大厅；桌面端按住 `Tab` 时滚轮滚动完整排行榜，松开后继续按历史语义切枪/切观战；真人断线或重连时，其他联机用户收到不泄露内部 ID 的连接状态提示。三项都必须保持单机/联机、桌面/移动端边界正确。

### 目标与边界

- 暂停卡提供第二个退出按钮；单机返回主菜单，联机关闭当前 match 连接并返回联机大厅，不向运行中房间发送无效 `lobby.leave`。
- 桌面/混合设备按住 `Tab` 时滚轮仅滚动排行榜；松开 `Tab` 后，存活玩家继续切枪、死亡玩家继续切换观战目标。
- 真人连接状态使用联机专属 sequenced event；只对其他真人展示规范化 display name，不显示 actor/player/account/token/epoch 等内部信息，不影响 Bot 和单机事件。
- 断线与重连必须按真实连接状态转换去重；旧 socket 的 stale close、重复 close 和 runtime restore 不得误报。
- 移动端暂停按钮保持可点击并适配安全区；连接提示使用独立紧凑 feed，不依赖当前在触屏布局中隐藏的 kill feed。

### 实现顺序

1. 补输入路由、HUD action/scroll、连接状态幂等与事件投影的失败测试。
2. 实现 pause action、Tab+wheel routing 和联机 connection feed。
3. 跑 shared/Worker/standalone 契约、桌面与手机 production browser 验收。
4. 完成静态审查、文档、提交、推送与生产 Worker smoke。

## Build

### 更新日志

- 2026-08-02 18:34：确认现状：暂停卡只有继续按钮；Tab 排行榜容器虽可滚动，但 pointer lock 下 wheel 被 `HumanController` 全部用于切枪/观战；运行中真人断线只更新 server connected/takeover 状态，其他客户端忽略 `lobby.state`，当前没有断线提示。确定采用模式化返回目的地、Tab 优先 wheel routing、协议附加 sequenced presence event 和独立移动端可见 connection feed。
- 2026-08-02 18:45：完成实现。暂停卡增加双按钮：单机返回主菜单，联机 dispose/close match 后返回联机大厅；Tab held 时 wheel 优先滚动榜单，松开后恢复切枪/观战。新增联机专属 `human-connection` sequenced event，runtime 仅对真实幂等转换发一次，restore 静默，GameRoom 统一处理 accept/close/account revoke 并用 epoch 屏蔽 stale close；客户端只用已知 display name，桌面复用 top-right feed，手机使用独立紧凑 feed。新增 shared、Worker 与 standalone 断线/重连回归及 HUD/input 纯函数测试，当前针对性测试与 typecheck 通过。
- 2026-08-02 20:13：最终自动与浏览器验收通过。桌面真实 Tab 榜单包含 50 行，wheel 后 `scrollTop 0→129`，松开后历史切枪路径由单测覆盖；单机暂停卡“返回大厅”回主菜单，联机暂停/结果卡回“联机大厅”并关闭连接。844×390 手机横屏双按钮完整无重叠；真人关闭连接后另一端显示规范化 display name 的断线提示，手机暂停状态仍能收到；Worker 与 standalone 均有真实 close/reconnect sequenced event 回归。完整 tests/builds/budgets 及最终无 console error/warn 证据同关联性能 plan。

## Review

### 2026-08-02 20:15 — Final static review

- 审查范围：暂停返回、Tab+wheel、human connection event 的 client/shared/Worker/standalone 全链，及桌面/844×390 手机布局；对照本 plan 的模式边界与信息泄露约束。
- 结论：通过，未发现明确 blocker/high/medium。Tab held 分支优先于死亡观战和存活切枪，松开后历史语义恢复；退出 callback 使用零参数 closure，单机/联机目的地分离，运行中不误发 `lobby.leave`。
- 连接复核：runtime 状态转换幂等且 restore 静默，GameRoom 在改变 member flag 前恢复 runtime，epoch 屏蔽旧 socket close，account revoke/close 不重复；事件与 gameplay 共用严格递增 sequence，客户端只解析已知 display name 并抑制自身/未知 ID。Worker 与 standalone 真实断线/重连、桌面和手机提示均通过，无剩余中高风险。
