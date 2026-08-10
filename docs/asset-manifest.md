# 资源清单合同

资源清单位于 `public/assets/asset-manifest.json`。玩法和 UI 通过 `AssetCatalog` 请求稳定 ID。

## 条目结构

```json
{
  "id": "model.character.enemy",
  "type": "model",
  "url": "./assets/models/enemy.glb",
  "fallback": "fallback.model",
  "metadata": {
    "scale": 1,
    "offsetX": 0,
    "offsetY": -1.76,
    "offsetZ": 0,
    "requiredNodes": "root,weapon_socket,backpack_socket",
    "armorMeshes": "character-merged-armor",
    "helmetMeshes": "character-merged-helmet"
  }
}
```

必填字段：

- `id`：稳定且唯一的资源 ID
- `type`：`svg`、`image`、`model` 或 `procedural-model`

由 URL 提供内容的条目还必须包含 `url`。可替换条目应定义类型兼容的 `fallback`。

## 支持格式

- UI：SVG、PNG、WebP
- 环境纹理、POI/品牌贴花和等距柱状天空图：WebP
- 模型：二进制 GLB
- 回退模型：由 metadata 描述的程序化几何

## 加载与回退

资源目录会预加载由 URL 提供的 UI 和图片资源并缓存字节。中/高画质场景需要角色 GLB 时才按需加载并缓存；低画质保留程序化角色回退且不下载 GLB。第一人称和第三人称手持武器始终使用程序化模型。资源目录会校验清单结构、重复 ID、fallback 是否存在、fallback 类型、SVG 结构和浏览器图片解码。

地形、道路、立面和屋顶条目只能通过稳定的 `texture.*` ID 使用。渲染器按有界语义材质族复用它们，禁止为每栋建筑创建独立材质。地图种子和混合区域事实会在所有画质等级中稳定选择同一材质族；该选择只影响表现，不写入 checkpoint。图片 payload 不可用、解码失败或 Babylon 上传失败时，语义材质必须保留可读的程序化回退色，禁止把跨类型 UI fallback 用作世界纹理，也禁止把地形变成白色。

浏览器原始产物预算包含这些生成式世界纹理。确定性的 `dist/` 上限为 4.70 MB；JavaScript、JavaScript chunk、CSS、Worker 和 standalone 服务端上限相互独立且保持不变。

破片手雷在背包、HUD 和触摸控制中使用稳定的 `ui.item.grenade` WebP 条目。地面、手持、飞行、轨迹和爆炸网格仍使用有界程序化表现。仓库也包含可用图片资源 `ui.item.smoke-grenade`，但烟雾弹不是权威物品或玩法规则。

GLB 加载还要求至少存在一个可渲染网格。存在 `requiredNodes` 时，每个逗号分隔节点都必须存在。网络、解码、网格或节点失败时记录资源 ID，并保留程序化回退。

角色 GLB 使用 `root,weapon_socket,backpack_socket`。角色条目还必须声明精确的逗号分隔 `armorMeshes` 和 `helmetMeshes` 名称，避免装备可见性依赖任意网格命名。加载时会校验这些命名网格可渲染。角色基础 ID 必须存在匹配的 `.lod1` ID，例如 `model.character.enemy.lod1`。可选 metadata `uniformDarkColor`、`uniformColor`、`uniformLightColor`、`armorColor`、`strapColor` 和 `helmetColor` 只重着色匹配的作者 PBR 材质，不改变皮肤。客户端按相机距离选择角色基础/LOD1 组；该行为只影响表现，绝不进入权威比赛状态。

远端人类角色使用 `model.character.player`，Bot 使用 `model.character.enemy`，本地第一人称角色不渲染第三人称身体。第一/第三人称手持武器都使用稳定程序化 `model.weapon.*` 条目。基础角色缺失或无效时，所有距离都保留程序化身体回退；角色 LOD1 缺失时，只让有效基础模型在远处继续显示。

版本化部署短暂把 HTML 返回给动态导入 JavaScript chunk 时，浏览器最多通过重新加载重试两次。重试预算耗尽后仍保留正常模型回退，玩法不得被阻塞。

## 玩法隔离

GLB metadata 只能调整视觉比例和偏移。导入网格必须不可拾取。权威命中胶囊、视线、伤害、射速、弹匣容量、手雷轨迹/引信/半径/伤害和背包行为由规则层定义，不能通过资源清单改变。

## 替换流程

1. 把文件加入 `public/assets/`。
2. 只把对应清单条目从程序化模型或旧 URL 改为新 URL。
3. 模型合同需要命名挂点时添加 `requiredNodes`。角色模型条目还必须提供非空 `armorMeshes` 和 `helmetMeshes`，内容为精确的可渲染网格名。
4. 运行 `npm run typecheck`、`npm run test` 和 `npm run build`。
5. 使用本机 Chrome/Edge 打开 `npm run preview`，音量设为 `0`，验证比例、偏移和回退行为。
