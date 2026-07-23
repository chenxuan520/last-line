<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./public/assets/ui/logo.svg">
    <img src="./public/assets/ui/logo-readme-light.svg" alt="最后防线 / LAST LINE" width="420">
  </picture>
</p>

<p align="center">
  <strong>空降孤岛，搜集武器，穿过枪火与毒圈，成为 50 人中最后的幸存者。</strong>
</p>

<p align="center">
  <a href="https://lastline.011203.xyz/"><strong>立即开战</strong></a>
  ·
  <a href="#怎么玩">怎么玩</a>
  ·
  <a href="#操作">操作</a>
  ·
  <a href="#本地运行">本地运行</a>
</p>

<p align="center">
  <a href="https://github.com/chenxuan520/last-line/actions/workflows/ci.yml"><img src="https://github.com/chenxuan520/last-line/actions/workflows/ci.yml/badge.svg" alt="CI and GitHub Pages"></a>
  <a href="https://hub.docker.com/r/chenxuan520/last-line"><img src="https://img.shields.io/docker/pulls/chenxuan520/last-line?logo=docker&label=Docker%20Hub" alt="Docker Hub image"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-739c45.svg" alt="MIT License"></a>
</p>

![最后防线孤岛战场](./public/assets/ui/menu-backdrop.webp)

## 这是什么

《最后防线》是一款打开浏览器就能玩的第一人称大逃杀：

- **单人作战：** 你与 49 名 AI 同场竞技，AI 会跳伞、搜集、跑毒、交火和治疗。
- **在线联机：** 2–10 名真人同房竞技，其余席位由 AI 补满至 50 人。
- **完整战局：** 从飞机航线、跳伞搜集一路打到决赛圈和唯一胜者，单局约 10 分钟。
- **跨端游玩：** 桌面端支持键鼠，手机端支持横屏触控，无需安装客户端。

## 怎么玩

1. **选择落点**：观察航线，决定何时跳伞，避开人群或抢占高价值据点。
2. **武装自己**：搜索步枪、冲锋枪、霰弹枪、狙击枪、弹药、护甲和药品。
3. **保持移动**：安全区会持续缩小；留意小地图，别让搜集变成跑毒。
4. **听声辨位**：利用建筑、山地、树干、岩石和栅栏掩护；树干会真实阻挡移动与子弹。
5. **活到最后**：击败遭遇的玩家与 AI，穿过最终安全区，成为唯一幸存者。

> 第一次玩？建议选择单人模式，保持默认的“初始绷带”和“禁用 AI 狙击枪”，先熟悉跳伞、拾取与缩圈节奏。

## 现在就玩

- **[正式入口](https://lastline.011203.xyz/)**：支持单人及在线联机。
- **[Cloudflare Pages](https://last-line.pages.dev/)**：备用游戏入口。
- **[GitHub Pages](https://chenxuan520.github.io/last-line/)**：纯静态单人版。

桌面端推荐使用最新版 Chrome 或 Edge。手机可竖屏浏览菜单；点击开始后游戏会在浏览器允许时申请全屏并锁定横屏，失败时可用对局内按钮重试。

## 操作

| 输入 | 动作 |
| --- | --- |
| `WASD` | 移动 |
| `Shift` | 冲刺 |
| `Space` | 跳伞 / 跳跃；淘汰后切换观战角色 |
| 鼠标左键 | 开火 |
| 鼠标右键 | 狙击枪瞄准镜 |
| `R` | 换弹 |
| `F` | 拾取 |
| `1` / `2` 或鼠标滚轮 | 切换主武器 |
| `Q` | 使用绷带 |
| `H` | 使用急救包 |
| `G` | 丢弃当前武器 |
| 按住 `Tab` | 查看本局排行榜 |

**手机横屏：** 左侧摇杆移动，右侧空白区域滑动视角；屏幕按钮提供开火、瞄准、跳跃、拾取、换弹、切枪、治疗、背包和暂停。点击“背包”可查看当前武器与物资；若浏览器退出全屏，可点击“进入全屏”恢复。淘汰后可用结果卡左右箭头切换观察目标。

## 本地运行

需要 Node.js 24 或更高版本：

```bash
npm ci
npm run dev
```

打开终端显示的地址，点击“开始游戏”即可进入单人对局。

<details>
<summary><strong>本地联机与自托管</strong></summary>

启动 Cloudflare Worker 本地联机后端：

```bash
npm run dev:worker
```

如需运行 Node.js + SQLite 全栈自托管版本，可使用 [`chenxuan520/last-line`](https://hub.docker.com/r/chenxuan520/last-line) 多架构镜像，具体环境变量、持久卷和 HTTPS 配置请参阅 [部署指南](docs/deployment.md)。Cloudflare 与自托管后端的数据相互独立。

</details>

<details>
<summary><strong>开发与验证</strong></summary>

```bash
npm run typecheck
npm run test
npm run test:coverage
npm run build
npm run build:worker
npm run build:server
npm run check:budgets
```

测试仅使用 Vitest，不会下载浏览器。`test:coverage` 会分别检查应用、Cloudflare Worker 和 standalone 的覆盖率基线并输出加权总值；`check:budgets` 会检查三套产物的体积和分块预算。GitHub Actions 还会实际构建 Docker 镜像并启动容器验证 `/health`。手动验收前请将游戏音量设为 `0`。

- [架构说明](docs/architecture.md)
- [素材替换](docs/asset-manifest.md)
- [部署指南](docs/deployment.md)
- [开发约定](AGENTS.md)

</details>

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。
