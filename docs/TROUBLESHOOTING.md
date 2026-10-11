# 故障速查表

> 本文解决什么问题：**出错了按症状直接跳到对应小节**，照着「排查命令 → 修复」做，不用通读文档。

---

## 速查总表

| # | 症状 | 最可能的原因 | 一步修复 |
| --- | --- | --- | --- |
| [1](#1-extensionconnected-false) | `extensionConnected: false` | 启动顺序反了 / 扩展未重载 | 刷新扩展 + 重载页面 |
| [2](#2-bridge-unreachable) | `bridge-unreachable` / `ECONNREFUSED 8898` | 桥没起 / 端口被占 | 重启桥，再刷新扩展 |
| [3](#3-简历画布停在-300150) | 简历画布停在 300×150 | **窗口不在前台** 或 **已被限流** | 窗口置前；手动也渲染不出 → 冷却 30–60 分钟 |
| [4](#4-响应超时--调用卡死) | 响应超时 / 调用卡死 | 单块响应过大 / 僵尸连接 | 分块抓取；重启桥 + 刷新扩展 |
| [5](#5-把消息发给了同名的人) | 消息发给了同名的人 | 按姓名定位而非会话 id | 立即核对并纠正，**不要重复发** |
| [6](#6-附件简历按钮-disabled) | 附件简历按钮 disabled | 候选人没上传附件简历 / 面板未就绪 | 等指纹一致再判；确认是否有附件 |
| [7](#7-下载文件名重复--被覆盖) | 文件名重复被覆盖 | 重名候选人 / 同人多条会话 | 加会话 id 后 6 位后缀 |
| [8](#8-excel-文件被占用写不进去) | xlsx 写不进去 | 文件被 Excel/WPS 打开 | 关掉文件，或另存版本号 |
| [9](#9-页面自己关闭跳到-aboutblank) | 页面 5 秒后自己关掉 | 用了 CDP / 调试端口 | **去掉** `--remote-debugging-port` |
| [10](#10-接口返回-code37) | `code:37 环境存在异常` | 环境门控命中 | 查无头/调试端口/代理，冷却后重试 |
| [11](#11-扩展改了代码没生效) | 改了扩展行为没变 | MV3 多层缓存 | 刷新扩展 + **重新加载页面** |
| [12](#12-页面出现窄栏幽灵浮窗) | 中部窄条文字浮层 | 简历弹层叠加 | `boss cleanup` |
| [13](#13-发送无反应) | 发送后会话里没消息 | 浮层遮挡 / 面板未就绪 | 清浮层 → 重试 → `snapshot` 核对 |

---

## 0. 通用排查三连

任何异常，先跑这三条：

```bash
# ① 全链路自检
boss doctor

# ② 桥与扩展状态
curl -s http://127.0.0.1:8898/status

# ③ 最近失败指令
grep '"ok":false' _过程文件/logs/cli-$(date +%F).log | tail -n 20
```

```powershell
# Windows 等价
boss doctor
curl.exe -s http://127.0.0.1:8898/status
Select-String -Path .\_过程文件\logs\cli-*.log -Pattern '"ok":false' | Select-Object -Last 20
```

---

## 1. `extensionConnected: false`

**症状**

```json
{ "ok": true, "extensionConnected": false }
```

`boss doctor` 报扩展未连接；所有指令报「no extension connection」。

**原因**

| 可能性 | 说明 |
| --- | --- |
| 启动顺序反了 | 浏览器先起，桥后起 → 扩展连不上 |
| 扩展被停用 | `chrome://extensions` 上状态是「已停用」 |
| 扩展改了代码没重载 | 仍在跑旧的 SW |
| 浏览器用的是**另一个 profile** | 扩展只装在其中一个实例里 |
| 桥端口被改过 | 扩展里还是旧地址 |

**排查命令**

```bash
# 桥是否在监听
netstat -ano | findstr :8898        # Windows
lsof -nP -iTCP:8898 -sTCP:LISTEN    # macOS

# 桥日志里有没有 connection 记录
tail -n 30 _过程文件/logs/bridge-$(date +%F).log
```

```powershell
netstat -ano | findstr :8898
Get-Content .\_过程文件\logs\bridge-$(Get-Date -Format 'yyyy-MM-dd').log -Tail 30
```

**修复（按序）**

```bash
# 1. 一键复位
boss browser open --clear-cache

# 2. 手动：chrome://extensions
#    → 找到 boss-bridge
#    → 点卡片上的「刷新 / Reload」
#    → 若无效，点 Service Worker 旁的「终止 / terminate」

# 3. 重新加载目标页面（旧注入的 content script 不会自动更新）

# 4. 再自检
boss doctor
```

若仍为 `false`：**关闭浏览器 → 重启桥 → 重新用启动脚本打开浏览器**（顺序不能反）。

---

## 2. `bridge-unreachable`

**症状**

```
Error: bridge-unreachable
  connect ECONNREFUSED 127.0.0.1:8898
```

**原因**：桥进程没在跑 / 崩了 / 端口被别的进程占用 / 绑到了别的地址。

**排查命令**

```bash
# 进程还在吗
ps aux | grep boss-bridge | grep -v grep          # macOS
Get-Process node | Select-Object Id, StartTime     # Windows

# 端口被谁占了
lsof -nP -iTCP:8898 -sTCP:LISTEN                   # macOS
netstat -ano | findstr :8898                       # Windows
tasklist /FI "PID eq <PID>"                        # Windows，看占用者
```

**修复**

```bash
# 1. 起桥（前台跑，方便看日志）
npm run bridge

# 2. 端口被残留进程占用时，先结束它
taskkill /PID <PID> /F                             # Windows
kill -9 <PID>                                      # macOS

# 3. 端口确实要换就同时改扩展里的桥地址
BOSS_BRIDGE_HTTP=http://127.0.0.1:8898 npm run bridge

# 4. 桥起来后必须刷新扩展（或重启浏览器）
```

> **别忘第 4 步**：桥重启后旧连接已失效，不刷扩展会表现为「桥好好的但扩展连不上」。

---

## 3. 简历画布停在 300×150

**症状**：抓出来的简历图是 300×150 的占位尺寸；或抓图成功但一片空白。

**原因（两个，先分清）**

| 原因 | 判据 |
| --- | --- |
| **A. 窗口不在前台**（浏览器节流非前台渲染） | **手动**打开该简历**能**正常显示 |
| **B. 已被短时限流** | **手动**打开该简历**也**渲染不出来（重启浏览器无效） |

**排查命令**

```bash
# 先强制置前再抓一次
boss capture-resume <candidate-id> --out ./_过程文件/resume/<candidate-id>

# 看这次抓到的图尺寸
boss capture-resume <candidate-id> --out ./_过程文件/resume/<candidate-id> --json
```

**修复**

- **情形 A（工具问题）**：
  ```bash
  # 手动点一下浏览器窗口使其获得焦点，然后重跑
  boss capture-resume <candidate-id> --out ./_过程文件/resume/<candidate-id>
  ```
  并确认：跑批期间**不要最小化窗口**、不要把窗口移到另一台显示器、macOS 上关掉「台前调度」影响。
- **情形 B（限流）**：
  ```
  立即停手 → 冷却 30–60 分钟 → 从下一个人继续
  ```
  **不要**重启浏览器、**不要**反复重开简历——那会延长冷却。

> **判定口诀**：手动能看到 = 查置前；手动也看不到 = 去冷却。

---

## 4. 响应超时 / 调用卡死

**症状**

- 某条指令**永远不返回**，但**其它指令仍然秒回**；
- 或者跑一段时间后所有指令都超时。

**原因**

| 症状特征 | 原因 |
| --- | --- |
| 只有抓图卡住，其它命令秒回 | **单条响应体过大**（> 约 55KB 通道就不返回） |
| 所有命令都超时 | **僵尸连接**吃掉了指令（桥的连接表里有已死连接） |
| 偶发、重试就好 | 页面切换未完成（缺轮询等待） |

**排查命令**

```bash
# 看桥的连接表与心跳新鲜度
curl -s http://127.0.0.1:8898/status | jq '.connections'

# 看超时的指令
grep '"code":"TIMEOUT"' _过程文件/logs/cli-$(date +%F).log | tail

# 看是否有僵尸连接被清理
grep -i 'zombie\|prune\|stale' _过程文件/logs/bridge-$(date +%F).log
```

**修复**

```bash
# 情况一：抓图超时 → 用分块（工具默认已开启 2×2）
boss capture-resume <candidate-id> --out ./_过程文件/resume/<candidate-id> --screens 12 --scale 0.9

# 情况二：僵尸连接 → 重启桥 + 刷新扩展
#   停桥（前台 Ctrl+C / 后台手动结束 node 进程）→ npm run bridge
#   → chrome://extensions 点「刷新」
#   → 重新加载目标页面

# 情况三：偶发超时 → 提高超时并加轮询等待
boss send <candidate-id> --text "<开场话术>" --json

# 情况四：彻底复位
boss browser open --clear-cache
```

> **不要在卡死时反复重发同一条指令**——写操作可能已经成功，重发会重复发送。先用 `boss open <candidate-id> --messages 20` 确认。

---

## 5. 把消息发给了同名的人

**症状**：会话里出现了一条发给**另一个同名候选人**的消息。

**原因**：用姓名定位（点列表行 / 选搜索建议）而没有用**会话 id**；同名或占位型昵称（如只写「先生」「女士」）时点错了。

**立即处置（按序）**

```bash
# 1. 不要重复发送！先拉取会话快照，确认实际打开到的是谁
boss open <candidate-id-actual>

# 2. 核对指纹：姓名 + 年龄 + 学历 + 年限 + 当前公司及岗位
boss open <candidate-id-actual> --json

# 3. 确认发错后，记录事故（写进 _过程文件/incidents.log）
echo "mis-send <candidate-id-actual> expected <candidate-id-target>" >> ./_过程文件/incidents.log

# 4. 如需补救：向被误发的人发一条澄清（请自行判断是否合适）
boss send <candidate-id-actual> --text "<澄清话术>"

# 5. 再给正确的目标发
boss send <candidate-id-target> --text "<开场话术>"
```

**根因修复（必须做）**

1. **一律按会话 id 打开**，姓名只用于搜索：
   ```bash
   boss open <candidate-id>
   ```
2. **打开后强制指纹核对**，任何一项不符立即中止：
   ```
   姓名 + 年龄 + 学历 + 工作年限 + 当前公司及岗位
   ```
3. **结果里记录「实际打开到的人是谁」**，让每次操作可审计。
4. 搜索路径支持「取第 N 个同名建议」逐个试。

**容易误判的情形**：**同一个人可能有多条会话**（不同职位 / 重复打招呼），表现为「同名 + 同年龄 + 同学历 + 同年限，公司名差一两个字」→ 这属于**同一人**，不是发错。核对时以**公司+岗位+年限+年龄**组合判断。

**预防检查**

- [ ] 所有写操作都传**会话 id**（`boss send <会话id>`），不要传姓名
- [ ] 姓名只用于搜索；重名时用 `--index N` 取第 N 个同名建议
- [ ] 指纹不符时工具**必须**拒绝执行，不要绕过

---

## 6. 附件简历按钮 disabled

**症状**：`.btn.resume-btn-file`（附件简历）呈灰色不可点，或点了没反应。

**原因**

| 可能性 | 说明 |
| --- | --- |
| 候选人**没有上传**附件简历 | 最常见。只有在线简历，没有 PDF |
| 面板**还没切换到目标人** | 读到的是上一个人的面板状态（上一个人无附件） |
| 浮层遮挡 | 弹层盖住了工具栏 |
| 会话未选中 | 打开了会话列表但没点进具体会话 |

**排查命令**

```bash
# 看按钮当前状态与面板指纹
boss open <candidate-id> --json

# 看是否还有残留浮层
boss cleanup
```

**修复**

```bash
# 1. 清浮层
boss cleanup

# 2. 重开该候选人，并等待指纹一致
boss open <candidate-id>

# 3. 再看按钮状态
boss open <candidate-id> --json
```

若确认按钮已 enabled 但仍下载失败，检查：

```bash
# 扩展是否声明了 downloads 权限（应看到 "downloads"）
grep downloads packages/bridge/extension/manifest.json

# 看下载流程细节（含解析出的 URL、文件名、字节数、最终状态）
boss download-resume <candidate-id> --json
```

**若候选人确实没有附件简历**：这是正常情况，**不是故障**。在名单的「已收简历」列标 `N/A（仅在线简历）`，并保留在线简历汇编报告里的截图作为替代材料。

---

## 7. 下载文件名重复 / 被覆盖

**症状**：两个不同候选人的 PDF 互相覆盖，或文件数比预期少。

**原因**

1. **重名候选人**（几百人池子里有多组重名）；
2. **同一个人有多条会话**（不同职位/重复打招呼），都会被下载一次；
3. 命名规则里没有唯一标识。

**排查命令**

```bash
# 统计下载目录里的文件数与重名情况
ls 输出/简历PDF | wc -l
ls 输出/简历PDF | sed 's/_[^_]*$//' | sort | uniq -d

# 核对哪些候选人没有对应文件
boss audit --people ./_过程文件/people.json --json
```

```powershell
Get-ChildItem .\输出\简历PDF | Measure-Object
Get-ChildItem .\输出\简历PDF | Group-Object { ($_.BaseName -split '_')[1] } | Where-Object Count -gt 1
```

**修复**

```bash
# 重新下载，命名带会话 id 后 6 位（避免覆盖）
boss download-resume <candidate-id> --out-name <序号>_<姓名>_<id6>.pdf

# 一键检查并补下缺失的
boss audit --people ./_过程文件/people.json --json
```

**推荐命名规则**

```
<序号>_<姓名>.pdf                 # 无重名时
<序号>_<姓名>_<id6>.pdf           # 有重名或同人多会话时
```

> **永远不要覆盖**：同名人物的简历内容完全不同，覆盖等于丢数据。`boss download-resume` 用 `--out-name` 指定文件名（会自动清理 `\ / : * ? " < > |` 等非法字符）；同名冲突时**自己加 id 后缀**，不要依赖工具的默认行为。

**同人多会话的处理**：在名单里**合并为一行**，会话 id 用逗号分隔列出；简历 PDF 只保留任一份（内容相同），备注说明。

---

## 8. Excel 文件被占用写不进去

**症状**

```
Error: EBUSY / EPERM: resource busy or locked
  最终筛选名单_<岗位>.xlsx
```

或报告生成成功但数据不全（静默失败）。

**原因**：目标 xlsx 正在被 Excel / WPS 打开，Windows 上会加排他锁。

**排查命令**

```powershell
# Windows：看哪个进程占用了文件
Get-Process EXCEL, wps, et | Select-Object Id, ProcessName, MainWindowTitle
```

```bash
# macOS：看是否被占用
lsof "输出/最终筛选名单_<岗位>.xlsx"
```

**修复**

```bash
# 方案一（推荐）：关掉 Excel/WPS，再重新生成名单表
#   → 输出/最终筛选名单_<岗位>.xlsx

# 方案二：另存为带版本号的新文件（写到 _过程文件/ 再移动）
#   → _过程文件/最终筛选名单_<岗位>_v2.xlsx → 确认可打开 → 移到 输出/

# 方案三：先在 输出/ 的副本上验证内容完整，再替换正式文件
```

**预防**

- 生成报告前统一提示「请先关闭正在打开的名单文件」；
- 工具**不允许静默失败**：写不进去必须报错并保留已有文件；
- 需要频繁查看时，**导出副本**查看，不要直接开着交付文件。

**顺带**：核对交付物时，把「名单里的会话 id 列表」和「`简历PDF/` 里的文件名」逐一对齐一遍，能识别出「看起来生成了但内容其实是上一轮」的情况。

---

## 9. 页面自己关闭跳到 `about:blank`

**症状**：打开目标站点约 **5 秒**后页面变白，地址栏跳到 `about:blank` 或上一个页面，**没有任何报错**。

**原因**：站点内置的**加固版 `disable-devtool`** 检测到了 DevTools/CDP 环境，命中后执行惩罚逻辑（关闭页面 + 清空文档），并上报一次埋点事件。检测器包括 `RegToString` / `DefineId` / `Size` / `DateToString` / `FuncToString` / `Der` / `Performance` / `DLB` 等。

**排查命令**

```bash
# 检查浏览器启动参数里有没有调试端口
# Windows
wmic process where "name='chrome.exe'" get CommandLine | findstr /i "remote-debugging"
# macOS
ps aux | grep -i "remote-debugging" | grep -v grep
```

**修复**

```bash
# 1. 关掉浏览器
# 2. 从启动脚本中去掉 --remote-debugging-port（以及任何 CDP 相关参数）
# 3. 确认脚本带 --load-extension 与 --no-proxy-server
# 4. 用启动脚本重新打开
```

> 本项目的设计就是**完全不用 CDP**：扩展 + 本地 WebSocket 桥。详见 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

## 10. 接口返回 `code:37`

**症状**

```json
{ "code": 37, "message": "您的环境存在异常.", "zpData": { "seed": "...", "name": "...", "ts": 0 } }
```

**原因**：服务端环境门控命中。相关风控 cookie（`__zp_stoken__` / `__zp_sseed__` / `__zp_sname__` / `__zp_sts__`），以及会探测客户端运行时信息的 `BstCookie`。

**排查（逐条确认）**

- [ ] 浏览器**没有**用 `--remote-debugging-port`
- [ ] 浏览器**不是**无头模式
- [ ] **没有**挂境外代理（启动脚本带 `--no-proxy-server`）
- [ ] 用的是**专用 profile**，且是**手动正常登录**的
- [ ] 没有在极短时间内高频请求

**修复**

```bash
# 1. 完全按 INSTALL.md §4 的脚本重启浏览器
# 2. 冷却 30–60 分钟后小批量（3–5 人）试跑
# 3. 先验证链路，再放大规模
```

> **本项目不做**：不伪造/破解风控 token、不绕过验证码、不使用代理池。若持续出现 `code:37`，请**停下来**检查环境，而不是加大绕过力度。

---

## 11. 扩展改了代码没生效

**症状**：改了 `content.js` / `sw.js`，页面行为完全没变。

**原因**：MV3 的多层缓存。

| 缓存层 | 是否需要清 |
| --- | --- |
| Service Worker 实例 | 是（终止 + 刷新） |
| Extension State | 是（刷新扩展） |
| Code Cache（磁盘字节码缓存） | 视情况 |
| **已注入页面的旧 content script** | **是（必须重新加载页面）** |

**修复（严格按序）**

```
1. chrome://extensions
2. 找到 boss-bridge → 点「刷新 / Reload」
3. 点 Service Worker 旁的「终止 / terminate」（可选，但强烈建议）
4. 关闭目标站点所有标签页
5. 重新打开目标页面          ← 这一步最容易被漏掉
6. 确认新代码生效
```

**仍不生效**（较少见）：

```
chrome://settings/clearBrowserData
→ 时间范围：全部时间
→ 只勾「缓存的图片和文件」（即 Code Cache）
→ 清除 → 重启浏览器
```

> 清 Code Cache **不会**丢登录态；**清 cookie 才会**。

---

## 12. 页面出现窄栏幽灵浮窗

**症状**：页面中部出现一条**窄窄的中文文字浮层**（看似乱码或「多余的窄栏」）。

**原因**：那是**第二个简历弹层 iframe**（宽约 300–650px）把简历按窄宽重排了——**上一个人的简历弹层没彻底关闭就再开了一次**，产生了叠层实例。

> 注意：简历 iframe 的 `height` 会被撑到「简历全文高度」（如 3246px / 9624px），这是**站点自身行为**，不是遗留样式，不要去「修」。

**修复**

```bash
# 1. 看有哪些残留
boss cleanup

# 2. 清理全部叠层
boss cleanup

# 3. 若清理不干净：关闭目标标签页重新打开（登录态保留）
```

**预防**：工具在每次开简历前/关简历后都会调用 `cleanupResumeDom`；自己写脚本时务必同样处理。**不要按 Esc 反复关**（可能只关掉最上层）。

---

## 13. 发送无反应

**症状**：`boss send` 返回成功但会话里没有消息；或输入框文字没清空。

**修复（按序）**

```bash
# 1. 看扩展还在不在线
curl -s http://127.0.0.1:8898/status

# 2. 清浮层（最常见的遮挡原因）
boss cleanup

# 3. 带调试重试（内部会走兜底：内层 .submit → 外层 .submit-content → Enter → 再点一次）
BOSS_DEBUG=1 boss send <candidate-id> --text "<开场话术>"

# 4. 用会话快照确认到底发没发出去
boss open <candidate-id>
```

**判定标准**：**输入框已清空 且 会话里出现该消息** 才算成功。只要会话里没有，就当作**没发出去**。

**⚠️ 不要重复发送**：如果工具其实已发出但页面未刷新，重复发送会真的发两条。先 `boss open <candidate-id> --messages 20` 确认。

---

## 附：错误码速查

| 错误码 | 含义 | 处置 |
| --- | --- | --- |
| `bridge-unreachable` | 连不上桥 | [§2](#2-bridge-unreachable) |
| `NO_EXTENSION` | 没有可用扩展连接 | [§1](#1-extensionconnected-false) |
| `TIMEOUT` | 指令超时 | [§4](#4-响应超时--调用卡死) |
| `FINGERPRINT_MISMATCH` | 面板指纹与目标不符 | 正常保护行为；确认会话 id 是否正确 |
| `NOT_LOGGED_IN` | 登录态失效 | 在专用 profile 里重新登录 |
| `RATE_LIMITED` | 疑似限流 | 冷却 30–60 分钟 |
| `CANVAS_EMPTY` | canvas 未渲染 | [§3](#3-简历画布停在-300150) |
| `RESPONSE_TOO_LARGE` | 单条响应过大 | [§4](#4-响应超时--调用卡死)，减小分块 |
| `NO_ATTACHMENT` | 候选人无附件简历 | 正常情况，标 `N/A` |
| `EBUSY` / `EPERM` | 目标文件被占用 | [§8](#8-excel-文件被占用写不进去) |
| `DOWNLOAD_FAILED` | 下载失败/校验不过 | 检查下载地址与 `%PDF` 文件头 |

---

## 相关文档

- 全部已知的坑 → [PITFALLS.md](PITFALLS.md)
- 安装与启动参数 → [INSTALL.md](INSTALL.md)
- 节奏控制与日常运维 → [OPERATIONS.md](OPERATIONS.md)
- 原理设计 → [ARCHITECTURE.md](ARCHITECTURE.md)
