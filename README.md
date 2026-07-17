# 最后防线

[![CI and GitHub Pages](https://github.com/chenxuan520/last-line/actions/workflows/ci.yml/badge.svg)](https://github.com/chenxuan520/last-line/actions/workflows/ci.yml)

桌面浏览器单人 AI 大逃杀 FPS。每局包含 1 名玩家和 19 名 AI，完整覆盖航线、跳伞、搜集、战斗、缩圈、淘汰和结算。

## 功能

- 800m × 800m 小岛，按对局 seed 随机丘陵、建筑和物资布局，包含城镇、仓库、港口和高地
- 随机航线、手动跳伞、滑翔和自动落地
- 步枪、冲锋枪、霰弹枪，统一即时命中和固定时间步规则
- 可见曳光、枪口焰、墙地火花、尘土和弹痕反馈
- 双主武器槽、弹药、两级护甲/头盔、绷带和急救包
- 19 名 AI 自主跳伞、搜集、进圈、战斗、换弹和治疗
- 六阶段安全区、圈外伤害、击杀信息、唯一胜者和无刷新重开
- 固定战术小地图，显示航线、POI、玩家朝向和当前/下一安全区
- 画质、音量和鼠标灵敏度设置，保存到 `localStorage`
- SVG/PNG/WebP/GLB 资源清单、预加载、校验、缓存和失败回退

## 技术栈

- TypeScript、Vite
- Babylon.js、WebGL2
- 原生 HTML/CSS HUD
- Vitest

## 环境

- Node.js 24 或更高版本
- 桌面版 Chrome / Edge，WebGL2

## 本地运行

```bash
npm ci
npm run dev
```

打开终端输出的本地地址，点击“开始游戏”进入对局。

## 操作

| 输入 | 动作 |
| --- | --- |
| `WASD` | 移动 |
| `Shift` | 冲刺 |
| `Space` | 跳伞 / 跳跃 |
| 鼠标左键 | 开火 |
| `R` | 换弹 |
| `F` | 拾取 |
| `1` / `2` 或鼠标滚轮 | 切换主武器 |
| `Q` | 使用绷带 |
| `H` | 使用急救包 |
| `G` | 丢弃当前武器 |

## 验证

```bash
npm run typecheck
npm run test
npm run build
npm run preview
```

`npm run test` 只运行 Vitest 单元与规则集成测试，不使用 Playwright，也不会下载浏览器。浏览器验收使用本机已安装的 Chrome / Edge；测试前请把菜单主音量设为 `0`。

当前回归覆盖固定时间步、三类武器射速、同时结算公平性、规则射线、背包与治疗、完整缩圈、AI 多 seed 搜集、19 Bot 完整加速局、资源回退、GLB contract 和场景重建释放。

## 架构

```text
src/
├── app/          # 菜单、会话创建、重开和生命周期
├── assets/       # 资源清单、预加载、校验和缓存
├── client/       # Babylon 渲染、音频和原生 HUD
├── config/       # 武器、物品、地图、模式和设置数值
├── controllers/  # 玩家与 AI 的统一指令生产者
├── ai/           # 导航和 AI 决策
└── game/         # 无 DOM/Babylon 依赖的权威规则状态与系统
```

`src/game/` 是权威规则层，只保存可序列化状态并消费统一角色指令。命中、视野、移动、物资和胜负均不依赖 Babylon mesh，素材替换不会改变玩法结果。

更多说明见：

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/asset-manifest.md`](docs/asset-manifest.md)
- [`docs/deployment.md`](docs/deployment.md)
- [`AGENTS.md`](AGENTS.md)

## 在线部署

- GitHub Pages：<https://chenxuan520.github.io/last-line/>
- Cloudflare Pages：<https://last-line.pages.dev/>
- 正式域名：<https://lastline.011203.xyz/>

GitHub Actions 在每次 PR 和 `main` 推送时执行类型检查、Vitest 和生产构建；`main` 通过后自动部署 GitHub Pages。Cloudflare Pages 使用 GitHub App 直接关联同一仓库并自动更新，配置见 [`docs/deployment.md`](docs/deployment.md)。

## 素材替换

所有素材由 `public/assets/asset-manifest.json` 的稳定 ID 引用。SVG、PNG、WebP 或 GLB 加载/解码失败时使用对应 fallback。

角色和武器 GLB 可通过清单元数据设置 `scale`、`offsetX`、`offsetY`、`offsetZ`，并用逗号分隔的 `requiredNodes` 校验必要节点。GLB 只影响视觉，命中盒和玩法数值由规则层固定定义。

## 当前边界

- 仅支持桌面键鼠，不支持移动端和触屏
- 当前为单机 AI 对局，无账号、后端、真人联网和匹配
- 不包含载具、投掷物、枪械配件、复杂弹道和可破坏场景
- 生产构建中的 Babylon/GLTF 按需 chunk 仍较大，但占位素材对局不会加载 GLTF chunk
