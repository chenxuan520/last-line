# 调试能力生产构建防护

## 目标

确保旧 shell 或 CI 环境变量绝不能把单机调试能力编译进 production 产物。

## 验收

- `VITE_SINGLE_PLAYER_DEBUG=true` 只在 Vite 开发服务命令中启用调试。
- 所有 Vite build 命令无论继承什么环境都强制 `__SINGLE_PLAYER_DEBUG__ = false`。
- Unit 直接覆盖 serve/build 行为。
- 显式执行 `VITE_SINGLE_PLAYER_DEBUG=true npm run build` 后，产物不含调试面板文本、样式或 chunk。
- 独立审查、最新 CI 和 Codex 无未解决 blocker/high/medium。

## 实现

- 编译期常量同时由 Vite `command` 与显式环境值决定。
- 命令决策放在 Vite 配置与 unit 共用的纯 helper 中。

## 构建

- Node.js 24 聚焦验证 5 文件 71 测试通过，覆盖 `serve/build × true/false` 四种组合。
- 应用、Worker/test、standalone typecheck 通过。
- 污染环境构建通过，`dist/` 不含 `LOCAL DEBUG`、`单机调试面板`、`debug-menu-badge`、`debug-panel` 或 `SinglePlayerDebug`。

## 审查

- 独立静态审查检查 Vite 命令语义、纯防护函数、unit、污染环境产物和 preview。
- 审查者 报告 blocker/high/medium/low 均为 0，并批准提交。
