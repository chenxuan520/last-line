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

《最后防线》是一款打开浏览器即可开战的 50 人第一人称大逃杀：

- **即开即玩：** 单人模式无需排队，打开页面即可进入完整战局。
- **好友联机：** 2–10 名玩家可快速匹配或创建私人房间，随时空降同一座战场。
- **战场不会冷场：** AI 会补齐空缺席位并自主跳伞、搜集、转移与交火，持续推动战局进入决赛圈。
- **跨端无门槛：** 桌面端支持键鼠，手机端支持横屏触控，无需安装客户端。
- **双地图选择：** 保留山地村落战场“苍岬岛”，新增高密工业城区“灰炉城”；单人和联机房间都使用显式地图选择。

## 怎么玩

1. **选择落点**：观察航线，决定何时跳伞，避开人群或抢占高价值据点。
2. **武装自己**：搜索步枪、冲锋枪、霰弹枪、狙击枪、弹药、护甲和药品。
3. **保持移动**：安全区会持续缩小；留意小地图，别让搜集变成跑毒。
4. **听声辨位**：利用建筑、山地、树干、岩石和栅栏掩护；树干会真实阻挡移动与子弹。
5. **活到最后**：击败沿途对手，穿过最终安全区，成为唯一幸存者。

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
| `4`–`9` | 丢弃背包第 1–6 格 |
| `Q` | 使用绷带 |
| `H` | 使用急救包 |
| `G` | 丢弃当前武器 |
| 按住 `Tab` | 查看本局排行榜；滚轮滚动完整榜单 |

**手机横屏：** 左侧摇杆移动，右侧空白区域滑动视角；左右两侧都可开火，右侧开火键按住后可继续拖动瞄准。屏幕按钮还提供瞄准、跳跃、拾取、换弹、切枪、治疗、背包和暂停。菜单中的视角灵敏度会即时显示并保存倍率；画质档位按设备像素比提升移动端清晰度，同时限制最高渲染倍率。点击“背包”可查看当前武器与物资；暂停卡可继续游戏或返回大厅；若浏览器退出全屏，可点击“进入全屏”恢复。淘汰后可用结果卡左右箭头切换观察目标。

背包槽位已满时，玩家需要先主动丢弃一组弹药或药品。桌面端使用 `4`–`9` 丢弃背包第 1–6 格，手机端打开“背包”后点击对应物品的“丢弃”按钮。每次会丢弃所选的整组堆叠。

**灰炉城：** 2400m 高密工业城市，包含 448 栋建筑、54 栋 4–5 层厂办楼与工业塔楼、32 条二楼跨楼连廊。每个 seed 会确定性生成不同宽度的道路带、随机分割的工业地块、错位街墙、退线院落、POI 和道路掩体，而不是复用固定方格；高楼每层、连廊桥面/护栏和门洞都属于服务端权威移动、射击遮挡与 AI 导航几何。

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
npm run test:multiplayer:production
npm run test:coverage
npm run build
npm run build:worker
npm run build:server
npm run check:budgets
```

测试仅使用 Vitest，不会下载浏览器。`test:multiplayer:production` 会在正式 Worker 创建一个私人房间，验证真实 HTTP/WebSocket welcome 协议与大厅状态后立即退出；`test:coverage` 会分别检查应用、Cloudflare Worker 和 standalone 的覆盖率基线并输出加权总值；`check:budgets` 会检查三套产物的体积和分块预算。GitHub Actions 定时运行正式联机 smoke；主 CI 还会实际构建 Docker 镜像并启动容器验证 `/health`。手动验收前请将游戏音量设为 `0`。

- [架构说明](docs/architecture.md)
- [素材替换](docs/asset-manifest.md)
- [部署指南](docs/deployment.md)
- [开发约定](AGENTS.md)

</details>

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。
