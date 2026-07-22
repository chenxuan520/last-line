## Plan

### 背景

现有角色和枪械 GLB 已生成，但角色由 28 个 mesh 部件组成，后续 50 人同场时绘制批次偏高；模型还需要提供远景版本，方便后续接入 LOD。

### 目标

1. 保持现有模型外观和挂点契约不变。
2. 将基础 GLB 的静态部件按材质合并，降低 mesh / draw call 数量。
3. 生成角色和枪械的远景 LOD GLB，移除不影响轮廓的小部件。
4. 不修改资源清单、渲染接入和权威玩法逻辑。

## Build

### 更新日志

- 2026-07-22 17:03：确认当前分支为 `main`，工作区已有 `.gitignore` 修改和上一轮模型资源；本次只覆盖 `public/assets/models/`，保留现有未提交改动。
- 2026-07-22 17:06：完成模型优化。基础角色由 28 个 mesh 合并为 8 个，基础枪械为 4–5 个；新增角色和枪械 `*-lod1.glb` 远景版本，角色为 6 个 mesh、枪械为 4–5 个。最终目录全部通过 Babylon.js 9.16.2 NullEngine GLB 解码、可渲染 mesh、`root` 和角色/枪械挂点校验；未修改资源清单、渲染接入或玩法代码，未提交/推送。
- 2026-07-22 18:56：按用户要求开始接入全部 12 个 GLB，并落实两组展示层优化。资源清单已声明 player/enemy 与四类武器的 base/`.lod1` 稳定 ID 和 required nodes；远端真人/AI 分别使用 player/enemy 模型，第一人称使用 base 武器，第三人称武器按 `grip` 对齐 `weapon_socket`，角色按画质距离切换 LOD。HUD 重计算降至 10Hz、排行榜按排名字段缓存，安全区复用单一 position buffer；树/灌木/装饰岩改硬件实例，低/中/高细节递增并采用 60/90/120 FPS 上限。定向 app typecheck 及 HUD/场景/固定步/资源清单相关测试已推进，修复了导入武器被 fallback 抑制逻辑误伤的问题；尚待完整门禁、MCP 静音画面/LOD/性能验收、review、提交和推送。用户要求已同步进 `AGENTS.md`：每轮 Chrome/Edge MCP 验证结束必须立即关闭本轮页面/context、停止本轮服务并确认只剩 `about:blank`，不得拖到任务末尾。
- 2026-07-22 19:31：完成最终实现和自动门禁。按用户补充口径，低画质完全跳过 GLB 替换并保留程序化角色/武器，资源目录也不再在菜单阶段预载 model；中/高画质才按需下载、校验和缓存当前场景需要的角色以及四类武器 base/LOD1。完整 `npm run typecheck`、应用 **30 files / 278 tests**、Worker **3 files / 27 tests**、standalone **2 files / 15 tests**、应用 build、Worker dry-run、Node server bundle及 `git diff --check` 全部通过；构建仅保留既有大 chunk warning。实现自检确认 `src/game/`、命中/碰撞、AI、协议和服务端权威规则未改，30Hz 固定步在 60/90/120 render cap 下保持不变。用户要求删除所有 MCP/调试启动的 Chrome，本轮已终止全部相应 headless Chrome 并通过进程检查得到 `NO_MCP_CHROME_PROCESSES`；因此最终版本不再重新启动浏览器，视觉验收缺口明确保留，不伪造浏览器结论。当前尚未提交/推送。

## Review

待资源生成和 Babylon GLB 加载校验完成后记录。
