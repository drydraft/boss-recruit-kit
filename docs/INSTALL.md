# 安装与启动

> 本文解决什么问题：从零把这套工具装起来并**确定它真的连通了**，以及事后怎么干净卸载。

---

## 0. 前置条件

| 项目 | 要求 | 检查命令 |
| --- | --- | --- |
| Node.js | **>= 20**（LTS 优先） | `node -v` |
| 包管理器 | npm >= 9（仓库使用 **npm workspaces**） | `npm -v` |
| 浏览器 | Chrome / Edge / 其它 Chromium 内核，**支持 MV3** | `chrome://version` |
| 账号 | 一个**已正常登录**的 Boss 直聘**招聘方**账号 | 手动打开确认 |
| 网络 | 建议**境内直连**，不加系统代理 | 见 [§5 网络](#5-网络与代理) |

> **不需要**：Python、Docker、Playwright、Puppeteer、任何浏览器驱动。

---

## 1. 获取代码与安装依赖

```bash
git clone <REPO_URL> boss-recruit-kit
cd boss-recruit-kit
npm install
```

```bash
# 验证 CLI 可用
node packages/cli/bin/boss.mjs --version
# 期望：打印版本号，无报错
```

> 扩展（`packages/bridge/extension`）是**纯静态资源 + 原生 JS**，**不需要构建步骤**。若未来加入构建，`npm install` 会通过根 `package.json` 的 `prepare` 自动触发。

---

## 2. 加载浏览器扩展（MV3）

### 步骤

1. 打开浏览器，地址栏输入 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 打开右上角的 **「开发者模式 / Developer mode」**。
3. 点 **「加载已解压的扩展程序 / Load unpacked」**。
4. 选择目录：

   ```
   <repo>/packages/bridge/extension
   ```

   > Windows 示例：`%USERPROFILE%\boss-recruit-kit\packages\bridge\extension`
   > macOS 示例：`$HOME/boss-recruit-kit/packages/bridge/extension`

5. 加载后应出现名为 **boss-bridge** 的卡片，状态为「已启用」。

### 验证扩展已就绪

```bash
# 桥起来之后（见 §3），检查扩展是否已连上
curl -s http://127.0.0.1:8898/status
```

期望包含：

```json
{ "ok": true, "extensionConnected": true, "version": "<extension-version>" }
```

若 `extensionConnected` 为 `false`，见 [TROUBLESHOOTING.md §1](TROUBLESHOOTING.md#1-extensionconnected-false)。

### 扩展需要的最小权限

扩展的 `manifest.json` 实际申请如下（可自行打开 `packages/bridge/extension/manifest.json` 审计）：

| 权限 | 用途 |
| --- | --- |
| `tabs` | 定位并激活目标标签页（非前台标签页的 WASM canvas 会被节流不重绘） |
| `activeTab` | 对当前激活标签页执行操作 |
| `storage` | 保存桥地址等本地配置 |
| `downloads` | 保存附件简历 PDF（文件名可控、可等完成回调） |

| host 权限 | 用途 |
| --- | --- |
| `https://www.zhipin.com/*` | 主站页面操作 |
| `https://*.zhipin.com/*` | 子域页面操作 |

> 扩展**不申请** `<all_urls>`、**不申请** `debugger`/`webRequest`、不读取浏览器历史。
> content script **只在 `https://www.zhipin.com/*` 上注入**，`all_frames: false`（只注入主框架）。

---

## 3. 启动本地桥

```bash
npm run bridge
```

期望输出：

```
ws bridge on ws://127.0.0.1:8899
http control on http://127.0.0.1:8898  (GET /status, POST /cmd, POST /scrape)
```

桥的 HTTP 接口只有三个：

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `/status` | GET | 桥自身 + 扩展连接状态 |
| `/cmd` | POST | 下发指令并同步等结果 |
| `/scrape` | POST | 关键词/城市分页抓取辅助 |

```bash
# 直接验证
curl -s http://127.0.0.1:8898/status
curl -s -X POST http://127.0.0.1:8898/cmd \
  -H "content-type: application/json" -d '{"cmd":"status"}'
```

**桥的端口只绑定 `127.0.0.1`**，不监听 `0.0.0.0`，局域网内其它机器无法访问。

桥地址可用环境变量覆盖：`BOSS_BRIDGE_HTTP`（默认 `http://127.0.0.1:8898`）、`BOSS_BRIDGE_WS`（默认 `ws://127.0.0.1:8899`）。改地址后要同步改扩展里的桥地址。完整环境变量表见 [§11](#11-环境变量)。

运行期数据落在 `packages/bridge/data/`：`bridge.log`（日志）、`jobs-YYYYMMDD.jsonl`（任务记录）。

### 常驻运行

```bash
# CLI 方式：默认后台运行
boss bridge start                  # 后台起桥
boss bridge start --foreground     # 前台起桥，实时看日志
boss bridge status                 # 看桥 + 扩展连接状态

# 开发用：直接前台跑，Ctrl+C 退出
npm run bridge

# 长期用：建议交给系统服务或进程管理器（例如 pm2）
pm2 start "npm run bridge" --name boss-bridge
pm2 delete boss-bridge             # 由 pm2 托管时才这样停
```

> **关于 `boss bridge stop`**：该子命令**只做提示，不会强行杀掉进程**（避免误杀你其它的 node 进程）。
> 要真正停掉后台桥，请**手动结束对应的 node 进程**：
>
> ```powershell
> # Windows：先找到占用 8898 的 PID，再结束它
> netstat -ano | findstr :8898
> taskkill /PID <PID> /F
> ```
>
> ```bash
> # macOS
> lsof -nP -iTCP:8898 -sTCP:LISTEN
> kill <PID>
> ```
>
> 如果你是用 `npm run bridge` 前台跑的，直接在该终端 **Ctrl+C** 即可。


### 启动顺序很重要

> **先起桥，再起浏览器。** 顺序反了扩展会连不上桥，需要重启扩展（在 `chrome://extensions` 点扩展卡片上的「刷新」）或重启浏览器。

---

## 4. 启动浏览器（关键：可见窗口 + 带扩展 + 不要调试端口）

### 为什么必须这样启动

| 做法 | 结果 |
| --- | --- |
| `--headless` 无头模式 | ❌ 会被站点跳转走或弹验证码，无法操作 |
| `--remote-debugging-port=9222`（CDP） | ❌ 站点检测到后执行惩罚函数关闭页面，约 5 秒后跳 `about:blank` |
| 可见窗口 + `--load-extension` | ✅ 正常工作 |

详见 [ARCHITECTURE.md](ARCHITECTURE.md)。

### Windows 启动脚本

新建 `start-chrome.cmd`（路径按需修改）：

```bat
@echo off
setlocal
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
set PROFILE=%USERPROFILE%\boss-recruit-profile
set EXT=%~dp0packages\bridge\extension

start "" %CHROME% ^
  --user-data-dir="%PROFILE%" ^
  --load-extension="%EXT%" ^
  --no-proxy-server ^
  --disable-features=Translate ^
  --new-window "https://www.zhipin.com/web/chat/index"

endlocal
```

### macOS 启动脚本

新建 `start-chrome.sh` 并 `chmod +x start-chrome.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="$HOME/boss-recruit-profile"
EXT="$(cd "$(dirname "$0")" && pwd)/packages/bridge/extension"

"$CHROME" \
  --user-data-dir="$PROFILE" \
  --load-extension="$EXT" \
  --no-proxy-server \
  --new-window "https://www.zhipin.com/web/chat/index"
```

### 参数逐条说明

| 参数 | 必要性 | 作用 |
| --- | --- | --- |
| `--user-data-dir=<专用目录>` | **必须** | 登录态隔离在专用 profile，不污染日常浏览器 |
| `--load-extension=<扩展目录>` | **必须** | 加载 MV3 扩展 |
| `--no-proxy-server` | **强烈建议** | 不经过系统代理，走境内直连（见 §5） |
| `--new-window <url>` | 可选 | 直接打开招聘工作台 |
| ~~`--remote-debugging-port`~~ | **绝对不要加** | 触发站点反调试惩罚 |
| ~~`--headless`~~ | **绝对不要加** | 无头会被跳转/验证码拦截 |

---

## 5. 网络与代理

- 本工具**只连本机**（`127.0.0.1:8898` / `8899`），不需要任何外网服务。
- 页面本身的请求由浏览器按你的正常网络发出。
- **不要给浏览器挂境外代理**：访问境内站点时，境外出口会显著提高被风控判定为异常的概率。招聘场景**务必境内直连**（脚本里已带 `--no-proxy-server`）。
- 如果你有系统级 VPN，请确认它没有劫持 Chromium 的流量。

---

## 6. 登录态与专用 Profile

- 专用 profile 目录（上文的 `boss-recruit-profile`）会保存 **cookie、localStorage、扩展的本地配置**。
- **首次启动后请手动完成登录**，并勾选「记住登录」。
- 之后每次用同一脚本启动，登录态会保留，**不需要重复登录**。
- 不要用日常主力 profile 目录跑本工具：一是会互相干扰扩展，二是风险操作不要污染日常环境。
- 不要把 profile 目录提交到 Git、也不要拷贝给他人（其中含你的登录凭据）。

---

## 7. 自检

```bash
boss doctor
```

期望输出（`boss doctor` 检查 5 项）：

```
[✓] Node version        v20.x.x  (>= 20)
[✓] Extension files     packages/bridge/extension 完整
[✓] Bridge              http://127.0.0.1:8898 连通
[✓] Extension           connected (桥看到扩展已连上)
[✓] Page                zhipin.com 页面可操作
```

任何一条为 `[✗]` 时，先看 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。

`boss` 支持 `--json`，便于脚本串联：

```bash
boss doctor --json
npm run doctor          # 等价快捷方式
```

> 调试时设 `BOSS_DEBUG=1` 可打印错误堆栈。

---

## 8. 平台差异速查

| 项目 | Windows | macOS |
| --- | --- | --- |
| 扩展管理页 | `chrome://extensions` | `chrome://extensions` |
| 默认 Chrome 路径 | `C:\Program Files\Google\Chrome\Application\chrome.exe` | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| Profile 占位 | `%USERPROFILE%\boss-recruit-profile` | `$HOME/boss-recruit-profile` |
| 启动脚本 | `.cmd` / `.bat` | `.sh` + `chmod +x` |
| 路径分隔符 | 建议脚本内用 `%~dp0` 拼接（避免手写 `\`） | 建议 `$(cd "$(dirname "$0")" && pwd)` |
| 长路径问题 | Windows 长路径可能导致 profile 报错，把 profile 放在浅目录 | 无此问题 |
| 窗口置前 | 需要脚本不要在最小化状态 | 若开启了「台前调度」，可能影响窗口焦点，建议关掉或全屏单窗口 |

> **macOS 补充**：若脚本被执行策略拦截，运行 `xattr -d com.apple.quarantine start-chrome.sh` 或用「右键 → 打开」首次放行。

---

## 9. 升级

```bash
git pull
npm install
```

**扩展改动后必须重载**（MV3 有脚本缓存，不重载会继续跑旧代码）：

1. `chrome://extensions` → 找到 boss-bridge
2. 点卡片上的 **「刷新 / Reload」**
3. 若行为仍异常：点「Service Worker」旁的 **「终止 / terminate」**，再到 `chrome://settings/clearBrowserData` 只清 **「缓存的图片和文件」**（会清 Code Cache）
4. 重启浏览器

> 清缓存**不会**丢失登录态；清 cookie 才会。

---

## 10. 卸载

按顺序执行：

```bash
# 1. 停掉桥
#    - 如果是 `npm run bridge` 前台跑的：在该终端 Ctrl+C
#    - 如果是 `boss bridge start` 后台起的：boss bridge stop 只提示，
#      需手动结束后台 node 进程（Windows: netstat -ano | findstr :8898 → taskkill /PID <PID> /F）
#    - 如果是 pm2 托管的：pm2 delete boss-bridge

# 2. 移除扩展
#    chrome://extensions → boss-bridge → 「移除 / Remove」

# 3. 删除专用 profile（含登录态与本地配置）
#    Windows:
#      rmdir /s /q "%USERPROFILE%\boss-recruit-profile"
#    macOS:
#      rm -rf "$HOME/boss-recruit-profile"
```

```bash
# 4. 删除仓库目录（含本地产出的名单与简历，请先确认已按合规流程处理）
rm -rf <repo>
```

> **删除前提醒**：profile 目录、`packages/bridge/data/` 与本仓库输出目录中包含候选人个人信息与你的登录凭据。删除是不可恢复的，请确认不再需要留档，或已按你的组织合规流程归档。

---

## 11. 环境变量

**全部可选**，都有合理默认值。跨平台通用（Windows 下 PowerShell 用 `$env:NAME="..."`，`cmd` 用 `set NAME=...`）。

### 桥与指令

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BOSS_BRIDGE_HTTP` | `http://127.0.0.1:8898` | CLI/MCP 访问桥的 HTTP 地址 |
| `BOSS_BRIDGE_WS` | `ws://127.0.0.1:8899` | 扩展连桥的 WebSocket 地址 |
| `BOSS_TOOL_TIMEOUT` | 实现内默认值 | 单条指令的超时（毫秒） |
| `BOSS_CALL_TIMEOUT_MS` | 实现内默认值 | 底层调用超时（毫秒） |
| `BOSS_DEBUG` | 未设置 | 设为 `1` 打印错误堆栈，便于排障 |
| `BOSS_BROWSER_PATH` | 自动探测 | Chrome/Edge 可执行文件的绝对路径 |

### 目录

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BOSS_PROFILE_DIR` | 实现内默认值 | 浏览器专用 profile 目录（**含登录态，勿外传**） |
| `BOSS_DOWNLOAD_DIR` | 实现内默认值 | 附件简历 PDF 的落盘目录 |
| `BOSS_CAPTURE_DIR` | 实现内默认值 | 在线简历截图的落盘目录 |

### 用例

```bash
# 换桥端口（同时要改扩展里的桥地址）
BOSS_BRIDGE_HTTP=http://127.0.0.1:9898 BOSS_BRIDGE_WS=ws://127.0.0.1:9899 npm run bridge

# 排障：打印堆栈
BOSS_DEBUG=1 boss send <candidate-id> --text "<开场话术>"

# 指定浏览器与独立 profile
BOSS_BROWSER_PATH="/path/to/chrome" BOSS_PROFILE_DIR="/path/to/profile" boss browser open --no-proxy

# 把简历落到指定目录
BOSS_DOWNLOAD_DIR="./输出/简历PDF" boss download-resume <candidate-id>
```

> 环境变量会影响**行为与落盘位置**。跑批前确认自己没有残留的旧变量设置（尤其是 `BOSS_PROFILE_DIR`——换了 profile 就等于换了一个未登录的浏览器）。

---

## 12. MCP 服务器（零依赖）

`packages/mcp-server` 是**零依赖的自实现 stdio MCP 服务器**，不引入任何官方 SDK 或第三方包：

```bash
npm run mcp        # 直接以 stdio 方式启动
```

因此**不需要**为 MCP 额外 `npm install` 任何东西——`npm install` 只会装根 workspace 与各 package 自身声明的依赖（当前全部为零依赖）。挂载方式见 [README · 与 DSH Desktop 集成](../README.md#与-dsh-desktop-集成)。

---

## 相关文档

- 为什么不能用 CDP → [ARCHITECTURE.md](ARCHITECTURE.md)
- 装完跑不动 → [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- 开工前的坑清单 → [PITFALLS.md](PITFALLS.md)
- 日常运维与节奏控制 → [OPERATIONS.md](OPERATIONS.md)
