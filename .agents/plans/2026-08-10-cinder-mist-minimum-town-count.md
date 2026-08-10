# Cinder Mist County Minimum Town Count

## Context

烬岚郡固定包含 1 个城镇、1 个农村和 1 个森林，另外 3 个区域当前可独立随机为城镇、农村或森林。这样会出现 3 个随机区域全部不是城镇的种子，导致整张地图只有 1 个城镇。用户要求烬岚郡每局至少包含 2 个城镇。

## Contract

- 烬岚郡仍然恰好包含 6 个命名区域，固定城镇、固定农村和固定森林保持不变。
- 3 个随机区域继续由 `mapSeed` 确定性生成，但其中至少 1 个必须是城镇，因此整张地图的城镇总数始终为 2–4 个。
- 农村和森林仍可在随机区域中出现；不得把随机区域全部固定成城镇。
- 相同 `mapId + mapSeed` 必须生成相同区域类型、名称、位置、建筑、道路、物资和权威几何。
- 随机区域名称继续从各自类型的名称池取得且保持唯一。
- 此变更会改变部分既有 mixed seed 的权威地图事实，必须提升严格联机协议和 checkpoint 版本，旧版本房间不得恢复到新地图几何。
- `AGENTS.md`、架构文档、部署文档和测试必须同步记录“至少 2 个城镇”合同。

## Plan

1. 添加失败回归，覆盖随机三区至少包含 1 个城镇、总城镇数至少为 2，以及允许的种子化类型组合。
2. 在 `createMixedRegionSpecs` 中对随机三区施加确定性的最小城镇约束，不改变固定三区。
3. 更新受影响的稳定地图哈希、代表种子断言和协议/checkpoint 版本回归。
4. 更新 `AGENTS.md`、`docs/architecture.md`、`docs/deployment.md` 和本 Plan。
5. 运行聚焦测试、完整 typecheck/test/build/budget 与 `git diff --check`；不运行 coverage。
6. 使用 production Chrome MCP 在音量 `0` 下检查一个原本只有 1 个城镇的代表 seed，确认现在至少出现 2 个城镇，区域命名、小地图、建筑和道路无重叠或异常；立即清理页面和服务。
7. 启动独立 Reviewer，解决所有 blocker/high/medium Finding 并完成 Re-review。
8. 创建准确英文 commit，普通 push 到现有 PR，重新请求 Codex 并监控 CI、Cloudflare Pages 和 Review thread。

## Build

- 2026-08-10：失败回归先在旧实现上以 seed `2` 复现：3 个随机区域不含城镇，整张烬岚郡只有固定的 1 个城镇。测试改为要求随机三区至少包含 1 个 `town`、总城镇数至少为 2，并在默认 5 秒门限内完整遍历 20,000 个 seed，得到全部 19 种至少含 1 个城镇的有序随机组合；测试用时约 1.67 秒，没有放宽 timeout。
- 2026-08-10：新增 `createMixedRandomRegionKinds(seed)` 作为轻量、确定性的随机三区类型选择器。它先保留原来的 3 次独立 town/rural/forest 抽取；仅当结果完全没有城镇时，继续使用同一个种子随机流选择 1 个槽位改为城镇。`createMixedRegionSpecs` 直接消费该结果，因此固定城镇/农村/森林、区域位置、名称池和其余随机类型仍按同一 seed 决定。
- 2026-08-10：代表 seed 结果确认：seed `11` 从 `rural/rural/rural` 变为 `rural/town/rural`，seed `38` 从 `forest/forest/forest` 变为 `forest/forest/town`；seed `16` 仍为 `town/town/town`。代表 seeds `0/1/2/11/16/38/42/2026/0xffffffff` 的总城镇数均为 2–4，且农村/森林仍可出现。
- 2026-08-10：权威 mixed 地图事实变化使严格联机协议从 11 提升到 12，checkpoint 从 10 提升到 11。协议客户端回归、checkpoint 兼容回归和 standalone SQLite 恢复 fixture 已同步；旧版本房间必须删除，禁止恢复到新区域类型、建筑、道路和物资事实。
- 2026-08-10：测试同步保留原断言强度。场景 seed `38` 的城镇视觉道路由 4 条变为 8 条，因为新增了第二个真实城镇；测试继续逐 seed 断言表现道路精确等于 `urbanRoadSegments` 并排除 5 条区域 connector。Checkpoint fixture 改用真实 `MatchRuntime` seed `1`，在新 mixed 布局下仍稳定产生三层弹药库，继续验证截断最后一条 canonical loot 时删除房间，没有放宽 roster 合同。
- 2026-08-10：Node 24.18.1 三目标 typecheck 通过。组合最终完整应用单元 `51 files / 583 tests`、standalone `3 files / 33 tests` 通过；本机 Worker runtime 仍在执行任何测试前被 glibc 2.28 阻止，明确缺少 GLIBC 2.29–2.35，Worker typecheck 与 dry-run build 已通过，push 后 Node 24 CI 必须补充真实 Worker `52/52` 证据。
- 2026-08-10：受影响地图/移动/战斗完整套件 `5 files / 112 tests` 通过；协议/checkpoint/地图选择 `4 files / 51 tests` 通过；seed 38 城镇道路场景回归 `1/1` 通过。完整生产 browser、Worker dry-run、server、same-origin standalone build 与最终 browser rebuild 均通过。
- 2026-08-10：加入 2.5 秒手雷引信组合增量后，最终确定性预算全部通过：browser entry `1,164,941 / 1,200,000`、最大非入口 JavaScript `599,667 / 700,000`、全部 browser JavaScript `3,847,712 / 4,000,000`、chunk `252 / 270`、CSS `45,225 / 50,000`、整个 `dist` `4,670,877 / 5,000,000`、Worker `613,992 / 615,000`、standalone `625,008 / 630,000`。
- 2026-08-10：production Chrome MCP 在音量 `0` 下使用真实 `createIslandScene` 检查原本只有 1 个城镇的 mixed seed `38`。无遮挡俯视截图中，`赤钟城区` 和新增的 `白塔旧城` 分别形成独立密集建筑/道路群；`风穗乡` 与 `沉杉岭/乌松岭/雾鹿峰` 仍保留，6 个区域标签无重叠，未见城镇建筑、森林或道路穿模。页面运行事实为 6 个区域、2 个城镇、1,483 个 scene mesh；console 仅 Babylon 启动日志与 SwiftShader 警告。每轮结束后立即回到 `about:blank`，停止 4173 并删除全部 `/tmp/last-line-min-town*` 临时文件。
- 2026-08-10：提交 `0453344` 后，push 与 PR 两条 Node 24 CI 都在 Worker `admin.test.ts` 的同一 canonical-loot fixture 失败。应用 `583/583` 与其余 Worker `51/52` 已通过；唯一失败是该 Worker fixture 仍用旧 mixed runtime seed `0` 并硬断言三层弹药库，而本轮新地图事实使该派生 seed 合法变为两层。Standalone 与 unit 的同类 fixture 已在提交前切换到新布局下稳定产生三层弹药库的 runtime seed `1`，Worker fixture 被遗漏。
- 2026-08-10：Worker follow-up 仅把该 fixture 的 `MatchRuntime` seed 从 `0` 改为 `1`，继续断言三层弹药库、删除最后一条 canonical loot 后房间与 checkpoint 必须被清除；没有删除断言、改成动态层数或放宽 canonical roster 合同。Node 24 `typecheck:worker` 通过；真实 `MatchRuntime` 复现得到派生 `mapSeed=2693262067`、三层弹药库、272 条 canonical loot。本机 Worker runtime 仍在任何测试前被 glibc 2.28 阻止，因此修复后的真实 Worker 用例必须由新 push 的 Node 24 CI 验证。
- 2026-08-10：Codex 在 follow-up CI 全绿后发现 seed `395` 的第二城镇 `白塔旧城` 只能生成 `35/36` 栋建筑。根因是提升后的随机城镇仍使用原有 5m 建筑额外间距；道路、降落区、最近区域归属和地形净空共同筛选后，最后一栋合法候选被额外间距拒绝。
- 2026-08-10：城镇生成改为两阶段消费同一批确定性候选：首轮继续使用原 5m 额外间距；只有不足 36 栋时才以 2m 额外间距重新检查未采用候选。道路肩、降落区、区域归属、地形净空和建筑实体 AABB 不重叠条件完全不变；农村和森林仍只执行原 5m 规则。
- 2026-08-10：seed `395` 已加入完整 mixed 结构回归，并逐区域逐对断言建筑实体 AABB 不重叠。Node 24 `typecheck:app` 与定向 mixed `1 file / 13 tests` 通过；额外扫描 seed `0–999` 的完整 blueprint，全部区域均达到 `36/9/2` 建筑配额且无实体重叠，用时约 51.6 秒。曾尝试的 20,000 个完整 blueprint 扫描因单核成本过高主动停止，没有把压力扫描写入测试。
- 2026-08-10：本轮最终 Node 24 三目标 typecheck、应用单元 `51 files / 583 tests`、standalone `3 files / 33 tests`、browser/Worker dry-run/server/same-origin standalone build 与普通 production rebuild 均通过。本机 Worker runtime 仍在执行任何测试前被 glibc 2.28 阻止；新 push 的 Node 24 CI 必须补充 Worker `52/52`。
- 2026-08-10：最终预算全部通过：browser entry `1,165,007 / 1,200,000`、最大非入口 JavaScript `599,667 / 700,000`、全部 browser JavaScript `3,847,778 / 4,000,000`、chunk `252 / 270`、CSS `45,225 / 50,000`、整个 `dist` `4,670,943 / 5,000,000`、Worker `614,433 / 615,000`、standalone `625,366 / 630,000`。
- 2026-08-10：production Chrome MCP 在音量 `0`、高画质下通过真实游戏入口固定进入 mixed seed `395`。俯视画面显示两个独立密集城镇；小地图明确显示 `赤钟城区`、`白塔旧城`、其余四区、`医院` 和 `弹药库`，标签无重叠。控制台只有本机 SwiftShader 警告。验收后立即回到 `about:blank`，停止 4173 并删除临时截图。

## Review

### 2026-08-10 Combined Final Review

- Reviewer 以 `064b2f7` 为基线，静态审查本 Plan 与 2.5 秒手雷引信 Plan 的完整未提交组合 diff；未重复外层已完成的测试、typecheck、build、budget、browser 或 coverage，也未修改文件或 Git。
- 结论：**通过，可提交并普通推送。** Blocker、high、medium、low 均为 0。
- mixed 随机三区保持原 3 次类型抽取，仅在完全没有 `town` 时使用同一随机流替换 1 个槽位；固定三区、位置随机流、名称池与后续几何随机流未被扰乱。20,000 seed 覆盖全部 19 种允许组合，城镇总数结构性保持 2–4，农村与森林组合仍存在。
- 协议 12、checkpoint 11 同时隔离至少两个城镇与 2.5 秒手雷引信的权威变化；Worker/standalone 共享 runtime 对旧房执行不兼容清理。场景道路、checkpoint fixture 和文档未放宽原合同。
- 本机 Worker runtime 的 glibc 限制必须由 push 后 Node 24 CI 的 Worker 套件补齐，但不构成静态 Finding。

### 2026-08-10 Worker CI Finding

- CI Finding：`tests/worker/admin.test.ts` 的 canonical-loot fixture 漏同步新 mixed seed，期望三层但实际为两层；push/PR 两条 run 均以同一断言失败，不属于随机超时。
- Disposition：改用与 unit/standalone 已验证一致的 runtime seed `1`，保留三层边界和截断最后 canonical loot 的完整拒绝断言。修复后必须进行独立 Re-review，并由新 Node 24 CI 实际执行 Worker `52/52`。

### 2026-08-10 Worker CI Re-review

- 结论：**通过，可提交并普通推送 follow-up。** Blocker、high、medium、low 均为 0。
- Reviewer 确认 seed `1` 仍明确生成三层弹药库；测试继续使用完整 `layout.lootSpawnPoints.length`，删除最后一条 canonical loot，并要求 `room-v1` 与 `checkpoint-v1` 都被清除，没有放宽恢复合同。
- 其余 Worker mixed fixtures 使用 seed `42` 或 `52`，不依赖三层弹药库或硬编码 canonical 数量，不需要同步。新 push 后 Node 24 Worker `52/52` 仍是最终门禁。

### 2026-08-10 Codex Seed 395 Finding

- Codex Finding：mixed seed `395` 中，被最小城镇约束提升为城镇的 `白塔旧城` 仅生成 `35/36` 栋建筑并抛错，说明区域类型合同虽然满足，但并非每个允许 seed 都能完成对应城镇几何。
- Disposition：保留原候选顺序和首轮 5m 额外间距；仅在城镇不足时使用 2m 额外间距补齐，同时继续严格禁止实体 AABB 重叠并保留全部道路、落点、区域归属和地形净空约束。seed `395` 回归和 seed `0–999` 完整 blueprint 扫描均通过。提交前必须完成独立 Re-review；新 push 后 Node 24 CI 和 Codex thread 必须再次全绿。

### 2026-08-10 Codex Seed 395 Re-review

- Reviewer 以 `origin/main` 理解整体任务背景，并重点静态审查 `6ece61f` 到当前工作区的实际增量；增量仅包含本 Plan、`src/config/mixedMap.ts` 和 `tests/unit/mixedMapLayout.test.ts`，未发现无关改动。未重复外层已记录的 typecheck、test、build、budget、browser 或 coverage 命令。
- 结论：**通过，可提交并普通推送 follow-up。** Blocker、high、medium、low 均为 0。
- 两轮使用同一个已生成的确定性候选数组。第二轮重新遇到首轮已选候选时，会被针对全局 `buildings` 的碰撞检查拒绝，不会重复添加；第二轮也不重新生成候选或额外消耗候选随机流，只有真正补入建筑时才按原规则确定楼层。
- 第二轮仍对全部既有区域建筑检查 2m 额外间距；后续区域继续按原 5m 规则检查已补入建筑。候选写入时的毫米取整误差远小于保留的 2m 间距，因此最终 `layout.obstacles` 不会因取整产生实体 AABB 重叠。道路肩、全部降落区、最近区域归属和地形坡差检查均位于共享 `tryCandidate` 中，两轮没有分叉或绕过。
- 2m fallback 仅在 `region.kind === "town"` 且原 5m 首轮不足 36 栋时运行；原本成功的城镇、全部农村和全部森林仍在首轮完成并保持原行为。自然障碍和物资继续以最终建筑集合为输入执行既有净空检查。
- seed `395` 已进入完整 `createMapLayout("mixed", seed)` 结构回归。新增断言检查最终权威 `layout.obstacles` 的实际中心和尺寸，而非只检查 blueprint 候选；既有同一测试继续覆盖建筑配额、道路净空、区域归属、地形安全和物资间距。外层记录的 seed `0–999` 完整 blueprint 扫描补充了更广的生成可行性证据。
- 本机 glibc 限制使 Worker runtime 仍须由 push 后 Node 24 CI 的 Worker `52/52` 补齐；这属于已明确的交付门禁，不构成本轮静态 Finding。Codex seed `395` thread 仍须在新 push 审查通过后关闭。
