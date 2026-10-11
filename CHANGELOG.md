# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 结构，版本号遵循语义化版本。

## [0.1.0] - 2025-XX-XX

首个公开版本。经过一次真实招聘季的完整实战（200 名打招呼候选人 → 两段式筛选 → 30 人触达与简历收集）后沉淀而成。

### 新增

- **`packages/bridge`**：MV3 扩展 + 本地 WebSocket/HTTP 桥（零外部依赖）
  - 扩展命令覆盖：会话列表/滚动、按 id 或姓名搜索打开、会话快照、打开在线简历、按块抓取 WASM 画布、展开"查看全部"、附件简历预览与下载地址解析、收藏状态读写、发消息、求简历、清理僵尸弹层等
  - **不使用 CDP/远程调试端口**，规避站点 disable-devtool 检测
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
