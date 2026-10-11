# boss-recruit-kit

> 本文解决什么问题：让你在 10 分钟内明白这套工具**能做什么**、**为什么这么设计**，以及**怎么把它跑起来**。

**一句话定位**：在**你自己的 Boss 直聘（zhipin.com）招聘账号内**，把「筛人 → 看在线简历 → 触达 → 收简历 → 出名单」这条重复劳动自动化，并且**不和平台的风控体系正面冲突**。

> **非官方项目**：本项目与 Boss 直聘及其关联公司无任何关系，未获得其授权、认可或赞助。所有页面元素名称、接口路径、检测行为均来自公开可观察的页面行为，仅用于**理解并规避平台误判**。

---

## 目录

- [能力清单](#能力清单)
- [架构图](#架构图)
- [快速开始](#快速开始)
- [与 DSH Desktop 集成](#与-dsh-desktop-集成)
- [合规与风险声明](#合规与风险声明)
- [目录结构](#目录结构)
- [文档索引](#文档索引)
- [License](#license)

---

## 能力清单

> 全部能力通过 `boss <command>` 暴露。全局选项：`--json`（机器可读）、`--help`、`--version`。
> 运行 `boss --help` 可随时查看实现里的权威列表。

### 只读能力（不改动账号状态）

| 能力 | 命令 | 说明 |
| --- | --- | --- |
| 环境自检 | `boss doctor` | 检查 Node / 扩展文件 / 桥连通 / 扩展是否连上 / 页面是否可操作 |
| 桥状态 | `boss bridge status` | 桥进程与扩展连接状态 |
| 候选人列表 | `boss list [--limit 40]` | 列出沟通列表会话（年龄/学历/年限/公司岗位/打招呼留言） |
| 打开某人看指纹 | `boss open <会话id\|姓名> [--index N] [--messages N]` | 打开会话并打印**指纹字段与最近消息**，用于防重名核对 |
| 在线简历抓取 | `boss capture-resume <会话id\|姓名> --out DIR` | 打开在线简历（WASM canvas）→ 逐页切片导出 PNG |
| 附件简历下载 | `boss download-resume <会话id\|姓名> [--out-name 文件名]` | 从预览 iframe 解出真实下载地址 → 落盘 PDF → 校验 `%PDF` |
| 逐人核验 | `boss audit --people people.json` | 按名单逐人核验（指纹 + 话术 + 求简历 + 收藏） |
| 过程清理 | `boss cleanup` | 清理叠层弹层 / 幽灵浮窗 / 残留 DOM |

### 写操作能力（可核验、幂等）

| 能力 | 命令 | 核验方式 |
| --- | --- | --- |
| 发消息 | `boss send <会话id\|姓名> --text "..."` | 「输入框已清空」**且**「会话里出现这条消息」双验证；`--dry-run` 只做不发的预演 |
| 求简历 | `boss request-resume <会话id\|姓名>` | 会话里出现系统消息「简历请求已发送」 |
| 收藏候选人 | `boss favorite <会话id\|姓名>` | 先读当前收藏状态，避免把「已收藏」点成「取消收藏」 |

### 生命周期与配套

| 能力 | 命令 | 说明 |
| --- | --- | --- |
| 起桥 / 停桥 | `boss bridge start [--foreground]` / `boss bridge stop` | 默认后台运行；`--foreground` 便于看日志 |
| 起浏览器 | `boss browser open [--clear-cache] [--no-proxy]` | **可见窗口 + 加载扩展**，不含任何调试端口 |
| MCP 服务器 | `npm run mcp` | stdio，暴露 `mcp__boss__*` 工具 |
| 冒烟测试 | `npm run smoke` | 一键验证链路 |
| 打包 | `npm run package` | 产出可分发的 bundle |

### 筛选与评分口径

第一段硬门槛（G1–G6）与第二段八维度 100 分制**是一套作业口径**，写在 [docs/SOP.md](docs/SOP.md) 里，由你（或 Agent 按 [skills/boss-recruiting/SKILL.md](skills/boss-recruiting/SKILL.md)）执行，最终用 `boss audit` 逐人核验、把结果落到 `输出/`。口径与命令解耦，便于你按自己岗位改规则而不用改代码。

| 环节 | 怎么做 | 产出 |
| --- | --- | --- |
| 第一段硬门槛 | `boss list` 取列表 → 按 [SOP §1](docs/SOP.md#1-第一段列表级硬门槛g1g6) 的 G1–G6 判定 | 通过 / 淘汰 + 淘汰原因 |
| 第二段简历精筛 | `boss capture-resume` 抓图 → 按 [SOP §2](docs/SOP.md#2-第二段在线简历精筛八维度-100-分) 八维度打分（**每维必须附原文摘录**） | 分数 + 分级 + 证据 |
| 交付物 | 按 [SOP §4](docs/SOP.md#4-交付物契约) 的四项契约产出 | xlsx / docx / pdf / 简历PDF 目录 |
| 一致性核验 | `boss audit --people <名单>.json` | 逐人核验报告 |


---

## 架构图

```
┌───────────────────────────────────────────────────────────────────────────┐
│  你的机器 —— 所有组件只监听 127.0.0.1，不向任何第三方服务器回传数据          │
│                                                                           │
│   ┌──────────────────┐          ┌───────────────────────┐                 │
│   │  boss CLI        │          │  MCP server (stdio)   │                 │
│   │  packages/cli    │          │  packages/mcp-server  │                 │
│   │  boss list ...   │          │  mcp__boss__*         │                 │
│   └────────┬─────────┘          └───────────┬───────────┘                 │
│            │  HTTP + JSON                   │  HTTP + JSON                │
│            └───────────────┬────────────────┘                             │
│                            ▼                                              │
│              ┌──────────────────────────────┐                             │
│              │  Bridge   packages/bridge    │                             │
│              │  HTTP  127.0.0.1:8898  指令  │                             │
│              │  WS    127.0.0.1:8899  信令  │                             │
│              └──────────────┬───────────────┘                             │
│                             │ WebSocket（扩展主动连桥，桥不被动监听网络）  │
│                             ▼                                             │
│      ┌──────────────────────────────────────────────────┐                 │
│      │  Chrome（可见窗口，MV3 扩展 packages/bridge/     │                 │
│      │  extension，由 --load-extension 加载）            │                 │
│      │                                                  │                 │
│      │   service worker ──每 15s getPlatformInfo 心跳──► │                 │
│      │   content script ──页面内 DOM 操作 + canvas 抓图  │                 │
│      └────────────────────────┬─────────────────────────┘                 │
│                               │ 像真人一样在页面里点/滚/打字              │
│                               ▼                                           │
│                 ┌───────────────────────────────┐                         │
│                 │  zhipin.com 页面               │                         │
│                 │  DOM + WASM canvas 在线简历    │                         │
│                 └───────────────────────────────┘                         │
└───────────────────────────────────────────────────────────────────────────┘

  ✗ 全程不使用 CDP / --remote-debugging-port / --headless
```

**为什么要这么绕？** 因为这个站点内置了加固版 `disable-devtool`，一旦检测到 DevTools/CDP，会执行惩罚函数把页面关掉并上报。用 Playwright/CDP 的方案在这里**跑不起来**。完整原理见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## 快速开始

> 前置：Node.js >= 20、Chrome / Edge（Chromium 内核）、一个**已登录**的 Boss 直聘招聘账号。

### 第 1 步 · 装扩展

```bash
npm install
# 扩展是纯静态资源，不需要构建；直接加载目录：
#   chrome://extensions  →  打开「开发者模式」
#   →  「加载已解压的扩展程序」 →  选择 <repo>/packages/bridge/extension
```

### 第 2 步 · 起桥

```bash
npm run bridge
# 期望输出：
#   ws bridge on ws://127.0.0.1:8899
#   http control on http://127.0.0.1:8898  (GET /status, POST /cmd, POST /scrape)
```

### 第 3 步 · 起浏览器并自检

```bash
# 用带扩展的方式启动浏览器（必须可见窗口，绝不能加 --remote-debugging-port）
#   脚本方式见 docs/INSTALL.md；也可以直接用 CLI：
boss browser open --no-proxy

boss doctor
# 期望：Node ✓  扩展文件 ✓  桥连通 ✓  扩展已连上 ✓  页面可操作 ✓
```

### 第 4 步 · 跑第一个命令

```bash
boss list --limit 20
# 期望：列出 20 条沟通会话（年龄/学历/年限/公司岗位/打招呼留言）
```

跑通了，就按 [examples/runbook-初筛.md](examples/runbook-初筛.md) 一步步走完整流程。

---

## 与 DSH Desktop 集成

DSH Desktop 是**本项目维护者使用与测试的客户端**，不是运行本工具链的必需条件。两条路线任选其一：

### 路线 A · Skill 路线（推荐，最轻）

只把技能文件挂进去，让 Agent 按 SOP 驱动 CLI：

```
把 <repo>/skills/boss-recruiting/ 整个目录复制到 DSH 的技能目录
重启 DSH Desktop → 技能列表中应出现 boss-recruiting
```

特点：**零安装、可读可改**，Agent 直接调用 `boss <command>`。适合先跑通、再决定要不要上 MCP。

### 路线 B · 插件路线（配置型 bundle，挂载 MCP）

```
把 <repo>/packages/dsh-plugin/ 作为本地插件 bundle 挂载
它只做一件事：把 packages/mcp-server 注册为 stdio MCP server
重启后应出现 mcp__boss__* 工具
```

特点：Agent 直接拿到结构化工具，不用拼命令行。配置文件是纯声明式的，不含可执行逻辑，便于审计。

> 两条路线可以同时用。Skill 负责「怎么想」，插件负责「怎么调」。

---

## 合规与风险声明

**请在使用前完整阅读本节。使用本工具即表示你已理解并接受以下内容。**

1. **适用范围**：本工具仅用于**你自己合法持有的招聘账号**内，处理**你自己收到的**候选人打招呼与简历。不适用于任何非本人账号、批量注册账号、爬取非本人可见数据等场景。
2. **遵守平台条款**：使用前请阅读并遵守 Boss 直聘的用户协议、隐私政策及适用的《个人信息保护法》《数据安全法》等法律法规。**若平台条款与本文档冲突，以平台条款为准。**
3. **不要高频操作**：
   - 节奏控制在 **15–20 秒 / 人**；
   - 连续操作 **40–60 分钟**后主动冷却 **30–60 分钟**；
   - 平台存在短时限流机制，密集操作会导致**在线简历画布停止渲染**（且需要较长冷却才恢复）。
   - **不要用本工具做压力测试、并发扫描或任何形式的探测。**
4. **候选人数据是敏感个人信息**：
   - 简历、联系方式、对话记录**全部保存在你本地**，本工具不上传任何地方；
   - **严禁对外传播、二次销售或用于招聘以外的任何用途**；
   - 建议设置本地目录访问权限，用完后按你的合规流程清理。
5. **不使用规避安全机制的手段**：本工具**不做**以下事情——不伪造/破解登录态与风控 token、不绕过验证码、不使用代理池掩盖来源、不修改页面下发的安全脚本。它只是**用真实浏览器、真实登录态、以接近真人的节奏**完成你本来就要手动完成的操作，从而**避免因「不像真人」被风控误判**。
6. **风险自担**：平台的风控策略持续演进。本工具可能出现被识别、账号被限制、页面结构变化导致失效等情况。**请自行评估风险，建议先用小批量（≤10 人）验证，确认行为正常后再扩大。**
7. **不提供任何担保**：本项目按「现状」提供，不对可用性、准确性、合规性做任何明示或暗示担保。

---

## 目录结构

```
<repo>/
├── README.md                      # 你正在读的文件
├── LICENSE
├── package.json                   # npm workspaces 根（含 bridge / boss / mcp / smoke 脚本）
├── packages/
│   ├── bridge/                    # 本地桥（零依赖 Node，自实现 RFC6455）
│   │   ├── server/                #   boss-bridge-server.cjs：HTTP 8898 + WS 8899
│   │   ├── data/                  #   bridge.log、jobs-YYYYMMDD.jsonl（运行期生成）
│   │   ├── scripts/               #   reload-browser.ps1（重载扩展/浏览器）
│   │   └── extension/             #   MV3 扩展（直接加载此目录）
│   │       ├── manifest.json
│   │       ├── sw.js              #   service worker（15s 保活）
│   │       └── content.js         #   页面内 DOM / canvas 操作
│   ├── cli/                       # 统一命令行 boss <command>
│   │   ├── bin/boss.mjs           #   入口
│   │   └── src/commands/          #   doctor / list / open / capture-resume / send ...
│   ├── mcp-server/                # MCP 服务器（stdio）→ mcp__boss__* 工具
│   └── dsh-plugin/                # DSH Desktop 配置型插件 bundle（挂载 MCP）
├── scripts/                       # smoke-test.mjs、package.mjs
├── skills/
│   └── boss-recruiting/
│       └── SKILL.md               # 技能入口（YAML frontmatter + Markdown）
├── examples/
│   └── runbook-初筛.md            # 可照做的操作剧本（0 → 出名单）
└── docs/
    ├── INSTALL.md                 # 安装 / 启动 / 卸载
    ├── ARCHITECTURE.md            # 为什么是「扩展 + 桥」而不是 CDP
    ├── PITFALLS.md                # 坑清单（先读这个）
    ├── SOP.md                     # 招聘初筛作业 SOP
    ├── OPERATIONS.md              # 日常运维手册
    └── TROUBLESHOOTING.md         # 故障速查表
```

---

## 文档索引

| 文档 | 什么时候看 |
| --- | --- |
| [docs/INSTALL.md](docs/INSTALL.md) | 第一次装、换机器、要卸载时 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 想知道「为什么不用 Playwright/CDP」、要改扩展或桥时 |
| [docs/PITFALLS.md](docs/PITFALLS.md) | **开工前必读**。所有已知的坑与正确做法 |
| [docs/SOP.md](docs/SOP.md) | 要开始筛人了，需要评分口径与交付物契约时 |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | 日常跑批、控节奏、看日志、处理故障时 |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | 出错了，按症状查命令时 |
| [skills/boss-recruiting/SKILL.md](skills/boss-recruiting/SKILL.md) | 要交给 Agent 自动执行时 |
| [examples/runbook-初筛.md](examples/runbook-初筛.md) | 想照着一个完整剧本从头走到尾时 |

**推荐阅读顺序**：`README` → `INSTALL` → `PITFALLS` → `SOP` → 跑 `examples/runbook-初筛.md`。

---

## License

本项目以 **MIT License** 发布，详见仓库根目录 [LICENSE](LICENSE)。

使用本项目即表示你同意：[合规与风险声明](#合规与风险声明) 中的全部条款。**本项目与 Boss 直聘无关联，请勿以本项目名义向平台提出任何诉求。**
