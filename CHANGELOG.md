# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 结构，版本号遵循语义化版本。

## [0.2.0] - 2025-XX-XX

### 变更

- **技能重构为「路由器 / 核心 / 领域」三层家族**（skills/），并改为四级渐进披露：
  - 新增 web-automation-router（路由器：该加载哪些技能、何时根本不该自动化）
  - 新增 core-gated-web-automation（核心：无 CDP 通道、画布取数、列表导航、DOM 卫生、节奏与滥用控制）
  - 新增 core-safe-batch-operations（核心：身份核对、按效果核验、幂等运行器、审计与证据）
  - 新增 domain-boss-recruiting（领域：筛选判据、触达与收集、平台现象、端到端剧本）
  - 被取代的 skills/boss-recruiting（单文件）已移除
- 技能自带可执行资产：preflight.mjs（Phase 0 就绪门）与 atch-ledger.mjs（台账校验与汇总）
- 新增 
pm run validate:skills：校验目录名与 
ame 一致、hyphen-case、description 第三人称且无 <>、SKILL.md 字数预算、路由表目标存在、SKILL.md 与 references 不重复；已并入 
pm run smoke
- README 增补「技能家族：可移植的是机制，不可移植的是判断」一节，明确可移植边界

### 设计约束（新增）

- 核心技能只写机制，领域技能只写判断；两者冲突时领域赢判断、核心赢机制
- SKILL.md 只做路由与硬门禁，知识一律下沉 
eferences/；重复即校验失败
- 技能里的质量要求必须可数（比例、阈值、上限、次数）

## [0.1.0] - 2025-XX-XX

首个公开版本。经过一次真实招聘季的完整实战（200 名打招呼候选人 → 两段式筛选 → 30 人触达与简历收集）后沉淀而成。

### 新增

- **`packages/bridge`**：MV3 扩展 + 本地 WebSocket/HTTP 桥（零外部依赖）
  - 扩展命令覆盖：会话列表/滚动、按 id 或姓名搜索打开、会话快照、打开在线简历、按块抓取 WASM 画布、展开"查看全部"、附件简历预览与下载地址解析、收藏状态读写、发消息、求简历、清理僵尸弹层等
  - **不使用 CDP/远程调试端口**，适配站点 disable-devtool 检测
  - MV3 service worker 心跳保活；窗口置前（解决 Chromium 对非前台窗口的渲染节流）
  - 跨平台启动脚本（自动探测 Chrome/Chromium/Edge，专用 profile 保留登录态）
- **`packages/cli`**：统一命令行 `boss`
  - `doctor` 环境自检、`bridge start|status`、`browser open`
  - `list` / `open`（指纹核对）/ `capture-resume`（分块抓取）/ `download-resume`
  - `send` / `request-resume` / `favorite` / `cleanup` / `audit`
  - 所有写操作**以会话消息核验**，而非"点击成功"
  - 所有按人操作**优先使用会话 id**，姓名仅作搜索，指纹不符即中止（防重名错发）
- **`packages/mcp-server`**：MCP 服务器（stdio），暴露 `mcp__boss__*` 工具
- **`packages/dsh-plugin`**：DSH 配置型插件 bundle（一条补丁挂载 MCP）
- **`skills/boss-recruiting`**：技能文件（触发场景 + 铁律 + SOP + 交付契约）
- **`docs/`**：架构、安装、坑清单、SOP、运维、故障速查
- **`scripts/`**：冒烟测试（含脱敏自检）与打包脚本

### 已知限制

- 在线简历是 WASM 画布，输出为图片分块，不做 OCR；语义判断需要多模态能力
- 界面若改版，扩展内的选择器需要同步更新（见 `docs/TROUBLESHOOTING.md`）
- 未做多账号/多岗位并行调度
