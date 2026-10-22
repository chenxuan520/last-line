# Single Player Start Ads

## Goal

按用户确认的功能分支／PR 流程，预接 Google H5 Games Ad Placement，仅在单机点击开始后的战场准备阶段提供广告机会。开关默认关闭，未完成 Google 账号接入时生产行为保持不变；PR 通过 Codex 和 required checks 后停止，由用户手动合并。

## Context

- 用户先要求研究广告和首次下载量，随后明确重点是单机、有网才尝试广告，并同意放在“正在准备战场”页、飞机部署之前。当前实现任务原话为“可以你先代码写一下不过开关默认是关的, 我没接好 google 的广告, 代码你先写好”。
- 用户确认 Vite 环境开关、预留 publisher ID、首次可播、成功展示间隔至少 5 分钟、SDK 初始化最多 2 秒、失败跳过、广告和场景准备并行、实际展示后重新点击进入、关闭或跳过保持一键开局、联机不接广告。
- 用户另确认频控使用当前标签页的 sessionStorage，刷新后保留，不修改账号、比赛 checkpoint 或游戏设置。
- 基线 main@85c923d，工作区干净；同步后创建 feat/single-player-start-ads。已检查完整 GameApp、BattleRoyaleSession、资源目录、输入／音频／全屏链路、场景准备、相邻 UI 和响应式样式，分析超过 10 秒。
- 菜单已预加载非模型图片，比赛创建才按需加载角色模型和着色器。Google API 使用 type: start，因为菜单已经呈现；不能使用只适用于首次 UI 呈现前的 preroll。广告与现有模型下载／场景异步准备重叠，不把同步地图构建描述为多线程并行。

## Contract

- VITE_SINGLE_PLAYER_ADS_ENABLED 默认 false；VITE_GOOGLE_ADS_CLIENT 默认为空，仅显式启用且 publisher ID 格式合法时才能请求 SDK。关闭、不完整配置、离线或频控命中不加载 Google 脚本、不等待广告、不新增进入按钮。
- 单机每次开局仍先释放上一会话；广告请求只发生在单机准备链。联机菜单、等待房、倒计时、比赛、死亡观战和协议不接入广告。
- SDK 初始化及未展示请求有界等待，最多 2 秒；无广告、脚本失败、异常或超时直接跳过。正在展示的广告不由初始化超时截断；SDK 回调完成后才允许进入。
- 成功展示后的 5 分钟频控保存在当前标签页 sessionStorage；没有实际展示的请求不占频控。存储不可用时页面内频控仍有效。
- 广告与战场准备独立完成，比赛模拟、HUD、角色输入和逐帧战场渲染不得在广告或进入确认前启动。实际广告开始时静音并释放鼠标锁定，停止旧方向锁操作；广告结束且场景就绪后通过真实“进入战场”点击获取输入／全屏权限。
- 广告被跳过时保留原始开始点击取得的输入权限，不添加二次确认；拒绝权限时沿用现有继续游戏／手动横屏回退。
- 准备 UI 区分场景进度和广告状态，不伪造广告等待为下载进度。按钮、字号、颜色、留白和响应式布局沿用既有加载页及菜单样式。
- 退出、应用释放及场景失败使本次请求失效；迟到回调不得修改新 UI、启动旧场景或退出新对局权限。Google API 没有公开的卸载／取消接口，已开始的广告仍由 SDK 负责关闭，不擅自操作其内部 iframe。
- 不新增激励奖励、复活、装备、广告投放后台、资产预加载重构或新的持久比赛字段，不改变画质或任何预算／性能采样合同。

## Plan

1. 增加最小客户端广告适配与配置，接入单机准备／进入屏障；定向覆盖开关、无网、无填充、频控、超时和取消。
2. 覆盖广告与准备的两种完成顺序、默认一键开局、输入权限、重复点击、失败释放和联机隔离；逐次只运行一个明确测试名。
3. 同步现有 AGENTS、README、架构与部署说明；执行 typecheck、production build、三套产物原 budget。
4. 用已有 Chrome MCP 静音验收关闭及受控广告流程、桌面与移动端；Builder 和独立 Reviewer 各自截图并亲自看图，清理各自临时资源。
5. 完成独立审查／复审闭环，将提交前事实写入本 Plan 并与实现一起提交；推送、创建 PR、请求 @codex，等待精确 HEAD 的 CI／性能和 Codex 完全通过，不合并或部署生产。

## Build

- 已实现纯配置解析与客户端 SinglePlayerStartAds：仅精确 true 和 ca-pub-16 位合法 ID 启用，默认生产与示例均 false／空 ID；SDK 仅开局请求时插入。初始化／未显示请求使用合计 2 秒 deadline；开始展示后移除超时，adBreakDone 收口，只有实际开始且 viewed 才写频控。取消、无网、失败、存储受限和迟到回调均有有界处理，不改服务端／协议／checkpoint。
- 单机准备会话保持局部持有，不挂入渲染循环；角色输入从构造移到 start，HUD 与模拟仍在 start 才启动。实际播放后提供与现有加载页／主按钮一致的进入卡，权限操作继续由真实点击同步触发。
- 18 个新增用例分别用测试名过滤、每次只运行 1 个用例通过：广告适配 9 个，GameApp 开局 7 个，真实 BattleRoyaleSession 生命周期 2 个。覆盖关闭／无配置／离线、script 与 onReady 区分、2 秒超时、脚本／SDK 异常、无填充、展示后等待、刷新频控／边界、存储失败、取消／迟到 callback、两种准备顺序、重复点击、失败／释放和联机隔离。未在本机运行完整 suite、performance 或 coverage。
- 全量 app／Worker／server typecheck、production build、Worker dry-run 与 standalone server bundle 通过；Worker 产物 634,872B，server 644,922B，没有新增服务端可执行逻辑。原 budget 通过：入口 910,333B，全 browser JavaScript 4,095,386B／273 chunks，CSS 47,862B，dist 4,922,654B；相对基线约增加 4.7KB JS 与 170B CSS，预算和性能合同未放宽。项目未定义 lint 命令；使用 Node 24.18.1，非默认 Node 22。
- Builder 用已有 Chrome MCP／独立 context、音量 0 验收：默认关闭 1440×900 单点击直接进场，没有 Google script／请求；启用构建只用受控假 SDK，1440×900 的准备等待／进入卡／实际进场、390×844 竖屏与 844×390 触屏横屏进入卡及实际进场通过。无填充 1280×720 保留一键开局、原锁和空频控，没有 Google 网络请求。亲自打开所有截图，检查完整加载卡、按钮、文字、背景与相邻 HUD 的字号／字重／颜色／间距／裁剪／重叠；未请求真实广告，Chrome 软件 WebGL 警告不作为实机性能证据。
- 首轮浏览器验证发现首次 pointer lock 在 beforeAd 之后迟到，导致进入按钮不可点；已追加仅广告等待期间的 pointerlockchange 释放监听，进入点击前移除，失败／取消／finally 清理，定向补充迟到与新锁断言并复验通过。测试初始化脚本曾因新文档尚无 head 报错，改为只在受控脚本中拦截 Element.append，最终无应用 console error。
- 每轮浏览器页面／context 与自有 preview 服务已关闭，4177／4178 无监听，仅剩 about:blank；截图已亲自查看后清理。启用构建保存在临时目录供独立 Reviewer 验收，结束后清理；不作为生产启用。CI 完整 suite、main／HEAD 性能采样及 Codex 属于提交后的门禁。

## Review

独立审查／复审已完成，Round 1／2 Finding 在以下 Disposition 中修复并由 Round 3 确认闭环；剩余 Blocker／High／Medium／Low 均为 0，允许提交。

### Round 1 — 2026-10-22 08:29 UTC

- 对照本 Plan 和用户原始要求／明确确认，审查 `feat/single-player-start-ads` 相对 `origin/main@85c923d` 的全部工作区改动及 6 个新增文件；HEAD、主分支和 merge-base 相同，无额外历史提交。业务代码与 Git 状态未修改。
- 结论：**不通过**。没有 Blocker／High／Low Finding；以下两项 Medium 均为提交前待 Builder 处理项，不能写通过结论。
- Medium 1：`src/client/SinglePlayerStartAds.ts:128–140` 永久缓存初始化失败的 Promise。首次脚本错误或初始化超时后，后续合法开局始终得到 false；网络／SDK 恢复也不再提交 placement。独立启用 production 浏览器以首次受控脚本 error、随后恢复 SDK 并真实返回菜单／再次开始复现：脚本插入累计 1 次、placement 仍为 0、频控为空。Builder 应只复用成功初始化或允许下一次显式开局恢复，仍保留每次最多 2 秒、不做后台重试，并补失败／超时后下一次开局的定向回归。
- Medium 2：`src/client/SinglePlayerStartAds.ts:98–106` 在 active 已失效时先返回，导致实际展示后因场景失败／退出 abort 的广告，即使随后收到 viewed 也不写频控。独立受控 production 验证 `beforeAd → abort → viewed` 后 storage 仍为 null；`GameApp.ts:142–144` 的准备失败会触发同一 abort 路径。Builder 应把实际成功展示的频控记账与旧开局 UI／权限的失效隔离，补展示后取消／准备失败再 viewed 的定向回归，保持迟到回调不启动旧场景或干扰新权限。
- 独立 UI 验收：默认 `http://127.0.0.1:4190/`，入口 `index-AG4tigIn.js`；启用 `http://127.0.0.1:4191/`，入口 `index-DjWZgX-P.js`；两者 CSS 为 `index-CLrL8Ai8.css`。全程 island／medium／volume 0，仅拦截 Google 脚本并使用受控 SDK，实际 Google 请求为 0。1440×900、390×844 和 844×390 的完整组件／相邻上下文共 10 张自有整屏截图均通过 Read 亲自查看，字体、字号／字重、颜色、间距、对齐、位置、裁剪、重叠和行列结构未发现明确问题；移动端加载卡沿用原位置／留白。
- 行为证据：默认单点击直接进场；启用等待期间没有 HUD／角色输入，场景 render frame 为 0；真实复现 beforeAd 后初始 pointer lock 迟到且立即释放，进入点击后新锁保持、比赛启动。触屏不请求 pointer lock，真实进入后恢复横屏触控。未见应用 console error，仅有软件 WebGL 警告，不将软件 FPS 作为真机门禁。
- 性能／最小性：配置、SDK 适配与开局门禁只增加启动阶段 O(1) 状态／有界计时器和事件监听；默认不产生广告 I/O，成功初始化复用脚本；单机会话只移动输入创建时机，场景／模型／导航构建次数和稳态 update 不变，没有循环或请求放大、无关历史语义修改或可删除的额外框架。初始化失败缓存需按 Medium 1 简化为可恢复状态。引用 Build 的约 4.7KB JS／170B CSS 增量及原 budget 通过记录；未见默认运行时超过 15% 的明确风险。
- 验证边界：参考外层 18 个逐次定向用例、全量 typecheck、三套产物构建和 budget，未重复执行 test／typecheck／build／budget／performance。完整 CI、同 runner main／HEAD 性能和 Codex 仍待 PR 门禁；真实 Google 投放、下载及 SDK 峰值资源成本留待账号接入后验证。
- 清理：本轮两个页面／context 已关闭，仅剩 about:blank；仅终止核实的自有 preview PID 529418／537402，4190／4191 无监听；10 张自有截图和两个自有日志已删除，未删除外层启用产物或初始化脚本。

### Disposition — Round 1

- Medium 1 已核实：首次初始化 false 被永久复用确实违反“本次失败跳过”的含义。先新增失败后再次显式开局的回归，确认失败再修复；只缓存成功就绪，失败 Promise 下次显式开局重新登记 onReady。超时保留同一 script、避免重复初始化上游；真正 script error 才移除并允许下次重插。preloadAdBreaks 只配置一次，旧就绪回调不会发起广告。新增超时后再次登记且不新增第二个 script 的回归通过，不增加后台重试。
- Medium 2 已核实：已开始的广告并未因比赛 abort 被 SDK 取消，成功 viewed 应独立记账。先新增展示／abort／viewed 回归确认失败，再将幂等频控记录与活跃请求的完成分离；重复 viewed 不重复更新时间，取消后的 promise 仍 false，旧 UI／权限不恢复。回归通过。
- 本轮新增 3 个定向用例逐个通过，另重跑初始化超时、迟到 callback 与刷新频控用例各自通过。共 21 个新增定向用例，不执行完整套件。全量 typecheck、默认与受控启用 production build 和原 budget 再次通过：默认入口 910,559B，总 JS 4,095,612B／273 chunks，CSS 47,862B，dist 4,922,880B；Worker／server 仍 634,872B／644,922B，门禁不变。等待独立 Re-review。

### Re-review — Round 2 — 2026-10-22 09:23 UTC

- 先回看本 Plan Disposition、用户原始要求及确认，再核对当前分支相对 `origin/main@85c923d` 的完整改动和新增广告实现／回归；HEAD 和 merge-base 未变。结论：**不通过，剩余 1 项 Medium**，无 Blocker／High／Low Finding。
- 原 Medium 1 的失败 Promise 永久缓存已修复。独立最终 production 验证首次超时跳过、迟到旧 onReady 不发 placement、真实返回菜单／再次开始成功恢复：脚本插入 1 次、就绪登记 2 次、placement 1 次，preloadAdBreaks 仅 1 次。但恢复路径尚未完整闭环，见下项。
- Medium：`src/client/SinglePlayerStartAds.ts:136–149` 的超时通过 finish(false) 移除 script error 监听，却保留 this.script。网络请求若在 2 秒后才报 error，失败脚本不再被清理；下一次明确开局只登记 onReady、不重插脚本，仍无法恢复。独立受控浏览器复现首次等待超时、随后触发脚本 error、真实返回菜单再次开始：插入累计 1 次、登记 2 次、placement 0、频控为空。Builder 必须将 error 清理绑定到脚本生命周期，而非单次就绪等待，并按脚本身份防止迟到旧 error 清除替换脚本；下一次显式开局仍保持有界等待、不增加后台重试。补 timeout → late error → next startup 的定向回归后请求复审。
- 原 Medium 2 已闭环：最终 production 受控 `beforeAd → abort → viewed` 写入频控，重复 viewed 不更新时间，无 HUD／进入按钮复活；同标签页刷新再真实开始时频控保留，script／placement 均为 0，一键进场。
- 独立 UI：默认 `http://127.0.0.1:4190/` 为 `index-CJJrOiUX.js`；启用 `http://127.0.0.1:4191/` 为 `index-DVE38-_E.js`；CSS 仍 `index-CLrL8Ai8.css`。全程 island／medium／volume 0，Element.append 完全拦截 Google script，未请求真实 Google SDK／广告。最终构建 1440×900 进入卡／实际进场、390×844 进入卡、844×390 进入卡／实际进场共 5 张自有整屏截图均通过 Read 亲自打开；完整组件与相邻背景／HUD 的字体、字号、字重、颜色、间距、对齐、位置、裁剪、重叠、行列和留白未发现明确问题。等待期间场景 frame 为 0、无 HUD；真实进入恢复桌面锁或触控，不提前开局。无应用 console error，仅软件 WebGL 警告。
- 性能／最小性：本轮修复仅增加启动阶段 O(1) 状态和 Promise 清理；默认广告 I/O 为 0，超时复用同一脚本，无后台轮询，稳态 update、场景／模型／导航次数和服务端不变。引用本轮原 budget 通过及相对上一轮 226B JS 增量，未见默认运行时超过 15% 的明确风险。没有无关业务改动、可删除额外框架或调用放大；待修项可通过分离脚本生命周期最小收敛。
- 已参考外层 21 个新增定向用例、相关重跑、全量 typecheck、最终构建和 budget，不重复执行测试／构建／预算／性能采样。真实 Google 投放和 SDK 成本尚未验收，属于正式启用前残余风险；PR 的完整 CI、同 runner main／HEAD 性能与 Codex 门禁仍须等待。
- 清理：本轮两个独立页面／context 已关闭，仅剩 about:blank；仅终止核实的自有 PID 588266／591685，4190／4191 无监听；5 张自有截图、两个自有日志均删除，未删除外层启用产物或 init 脚本。仅增量记录 Review，未改业务代码或 Git 状态。

### Disposition — Round 2

- 已核实超时移除 script error 监听会遗失真正加载失败；新增 timeout／late error／next startup 回归，确认失败后修复。改为每个 script 一个一次性错误监听，按 event.currentTarget 与当前 script 身份校验；超时只释放当前就绪等待，不删除脚本生命周期监听，真正 error 清除当前 script 和 ready，下次显式开局可以重插。替换后的旧 error 不清除新 script，dispose 清理监听；没有后台重试。
- 新增用例及失败恢复／普通超时再登记／dispose 3 个相关用例各自定向通过，共 22 个新增用例。最终全量 typecheck、默认和受控启用 production build、原 budget 再次通过：默认入口 910,829B，总 JS 4,095,882B／273 chunks，CSS 47,862B，dist 4,923,150B；Worker／server 不变。等待 Re-review，尚未提交。

### Re-review — Round 3 — 2026-10-22 09:40 UTC

- 基于本 Plan Disposition Round 2、原始需求及确认，对照 `origin/main@85c923d`，复核完整广告实现、新增回归和其余 diff；结论：**通过，本次审查未发现明确问题，剩余 Blocker／High／Medium／Low 均为 0**。脚本错误监听现按脚本生命周期一次登记，超时保留，身份检查隔离旧脚本，dispose 显式清理；Round 1／2 Finding 全部闭环。
- 独立最终 production 受控验证 `timeout → late error → 返回菜单 → 真实再次开始` 成功恢复：脚本插入 2 次、就绪登记 2 次、placement 1 次、preloadAdBreaks 1 次；再次触发旧脚本 error 不影响新请求，等待时无 HUD 且场景 frame 为 0，广告完成后真实进入点击启动部署。全程 island／medium／volume 0，Google 脚本完全拦截，真实 Google 请求 0，无应用 console error。默认入口 `index-ChqzYfcg.js`；独立打开 `http://127.0.0.1:4191/` 的启用入口 `index-CvN4SFrE.js`，CSS 仍为 `index-CLrL8Ai8.css`。
- 本轮没有 UI／布局或进入逻辑变更，沿用 Round 2 独立桌面／移动整屏截图及 Read 亲眼检查事实。参考外层 22 个定向用例、全量 typecheck、最终构建与原 budget，不重复执行测试／构建／预算／性能采样。修复增加一个 O(1) 脚本监听和身份检查，稳态、场景／模型／导航次数不变，无后台重试或调用放大；本轮 JS 仅增 270B，未见超过 15% 的明确性能风险。改动最小，没有必要增加框架或进一步抽象。
- 本轮页面／context 已关闭，仅剩 about:blank；仅终止核实的自有 PID 616907，4190／4191 无监听，自有日志已删除，无新增截图或脚本，外层产物未删除。仅增量写入 Review，未改业务代码或 Git 状态。允许外层按功能分支流程提交；PR 完整 CI、同 runner main／HEAD 性能及 Codex 仍须等待，真实 Google 接入／SDK 成本仍为正式启用前验证项，不授权合并或生产启用。
