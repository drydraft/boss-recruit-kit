# 贡献指南

感谢你愿意改进这个项目。它解决的是一个**很具体**的问题：招聘方想把自己账号里的候选人筛选与触达流程自动化，同时不能把账号搞进风控。

## 开发环境

```bash
node -v            # 需要 >= 20
npm run check      # 全量语法检查
npm run smoke      # 冒烟测试（静态，不需要浏览器）
npm run doctor     # 环境自检（需要桥 + 浏览器）
```

## 目录职责（改代码前先看这个）

| 目录 | 职责 | 改动注意 |
|---|---|---|
| `packages/bridge/extension` | 页面内操作（content script）与后台路由（sw.js） | 站点 DOM 改版时改这里；**改完必须重载浏览器并清扩展缓存** |
| `packages/bridge/server` | 本地 HTTP/WS 桥 | 保持零外部依赖 |
| `packages/cli` | 命令行与业务编排 | 新命令要同时补：`--json` 输出、错误提示、`bin/boss.mjs --help` |
| `packages/mcp-server` | MCP 工具面 | 工具名与 CLI 命令保持一致语义 |
| `docs/` | 知识与流程 | 遇到新坑请**先补 `PITFALLS.md`**，再改代码 |
| `skills/` | 给模型的打法 | 只写"怎么判/怎么走"，不写实现细节 |

## 提交前自查

1. `npm run check && npm run smoke` 全绿（冒烟里含**脱敏自检**）。
2. 新增/修改的写操作命令，必须**核验**（会话里查到消息 / 系统消息 / 状态读回），不允许只返回"点击成功"。
3. 涉及"某个人"的操作，必须优先使用会话 id；用姓名时必须带指纹核对。
4. 不要提交任何候选人数据、简历、日志、浏览器 profile 或本机绝对路径。
5. 文档里出现的命令与代码保持一致（命令名、参数名以 `boss --help` 为准）。

## 新增一个扩展命令的标准流程

1. 在 `packages/bridge/extension/content.js` 的 `DOM_FNS` 里实现，并在 `case` 分发里注册；
2. 在 `packages/bridge/extension/sw.js` 加路由（很多命令需要先 `zhipinTab()`）；
3. 在 CLI 的 `packages/cli/src/commands/*.mjs` 里包一层用户可见命令；
4. 若属于高频/有副作用的能力，在 `packages/mcp-server/src/server.mjs` 同步暴露工具；
5. 在 `docs/` 与 `CHANGELOG.md` 记录；
6. `npm run check && npm run smoke`。

## 报告问题

请附上：`boss doctor` 输出、`docs/TROUBLESHOOTING.md` 里对应条目的排查结果、以及**脱敏后**的最小复现步骤。
请勿粘贴真实候选人信息、会话 id 或 cookie。
