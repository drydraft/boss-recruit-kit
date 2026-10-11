# 日常运维手册

> 本文解决什么问题：每天开工/收工该做什么、节奏怎么控、日志在哪、出常见故障怎么就地处置、以及数据该怎么保管。

---

## 1. 每日启停顺序

### 开工（严格按顺序）

```
① 起桥           ← 必须最先
② 起浏览器        ← 必须晚于桥（带扩展、可见窗口）
③ 手动确认登录态
④ boss doctor    ← 全部 ✓ 才开工
```

```bash
# ① 起桥
npm run bridge
# 期望：HTTP 127.0.0.1:8898 / WS 127.0.0.1:8899 / extension connected

# ② 起浏览器（脚本内容见 docs/INSTALL.md §4）
#    Windows:  start-chrome.cmd
#    macOS:    ./start-chrome.sh

# ③ 打开招聘工作台并确认已登录

# ④ 自检
boss doctor
```

> **顺序反了会怎样**：桥没起来时扩展连不上，需要通过 `chrome://extensions` 点扩展卡片「刷新」或重启浏览器才能恢复。

### 收工

```bash
# 1. 跑一次一致性审计，确认交付物齐全
boss audit --people ./_过程文件/people.json --json

# 2. 清理页面残留（叠层弹窗 / 幽灵浮窗）
boss cleanup

# 3. 停桥：前台跑的按 Ctrl+C；后台起的需手动结束 node 进程（boss bridge stop 只提示），然后关浏览器
```

**收工检查**：

- [ ] 本轮名单已写入
- [ ] 每个分数都有原文摘录
- [ ] 简历 PDF 数量与「已收简历」列一致
- [ ] 过程文件已归档到 `_过程文件/`
- [ ] 交付目录只有交付物

---

## 2. 自检命令

| 命令 | 检查什么 | 期望 |
| --- | --- | --- |
| `boss doctor` | 全链路一次性自检 | 全 `[✓]` |
| `boss doctor --json` | 同上，机器可读 | 便于脚本判断 |
| `curl -s http://127.0.0.1:8898/status` | 桥 + 扩展连接状态 | `extensionConnected: true` |
| `boss cleanup` | 清理僵尸/屏幕外简历弹层 | 打印「移除弹层数 / 清除内联样式数」 |

```bash
boss doctor --json            # 机器可读，便于脚本或 Agent 判定
boss bridge status            # 单独看桥 + 扩展连接状态
```

**心跳新鲜度**：扩展每 15 秒上报一次心跳。`boss bridge status` 里若**长时间没有新心跳**，说明扩展侧 service worker 已休眠或断开 → 见 [TROUBLESHOOTING §1](TROUBLESHOOTING.md#1-extensionconnected-false)。

---

## 3. 日志

### 位置

桥的运行期数据写在 `packages/bridge/data/`（随桥进程，不在工作目录里）：

```
packages/bridge/data/
├── bridge.log               # 桥：连接、指令路由、超时、异常
└── jobs-YYYYMMDD.jsonl      # 指令级任务记录（按天切分）
```

CLI 的输出默认打到**终端**。需要留档就自己重定向到工作目录：

```bash
mkdir -p _过程文件/logs
boss list --limit 200 --json > _过程文件/logs/list-$(date +%F).json 2> _过程文件/logs/cli-$(date +%F).log
```

> 位置类行为可用环境变量覆盖：`BOSS_CAPTURE_DIR`（简历截图）、`BOSS_DOWNLOAD_DIR`（简历 PDF）、`BOSS_PROFILE_DIR`（浏览器 profile）。
> 完整环境变量表见 [INSTALL.md §11](INSTALL.md#11-环境变量)。

### 看日志

```bash
# 桥最近 50 行
tail -n 50 packages/bridge/data/bridge.log

# 只看今天的任务记录
cat packages/bridge/data/jobs-$(date +%Y%m%d).jsonl

# 找失败的指令
grep -i 'error\|timeout\|no extension' packages/bridge/data/bridge.log
```

Windows PowerShell 等价写法：

```powershell
Get-Content .\packages\bridge\data\bridge.log -Tail 50
Get-Content .\packages\bridge\data\jobs-$(Get-Date -Format 'yyyyMMdd').jsonl
Select-String -Path .\packages\bridge\data\bridge.log -Pattern 'error|timeout'
```

### 日志里有什么、没有什么

| 记录 | 不记录 |
| --- | --- |
| 指令 id、命令名、耗时、成功/失败 | **消息正文** |
| 候选人**会话 id** | **简历内容 / 截图内容** |
| 错误信息（如附件简历按钮不可用） | cookie / token / 账号名 |
| 连接建立与断开 | 登录凭据 |

> 这样设计是为了让日志**可以安全地用于排障**，不必担心日志本身泄露候选人隐私。

### 清理

日志会随运行累积（`jobs-*.jsonl` 含候选人会话 id，属敏感数据）：

```bash
# 只保留最近 7 天
find packages/bridge/data -name 'jobs-*.jsonl' -mtime +7 -delete
```

```powershell
Get-ChildItem .\packages\bridge\data\jobs-*.jsonl | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item
```

> 结束招聘流程后，建议按合规要求**整体清理** `packages/bridge/data/`、`_过程文件/`、`输出/`（见 §6）。

---

## 4. 节奏控制

> 这是**运维里最重要的一条**：绝大部分「工具坏了」其实是**被限流了**。

### 默认节奏

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| 单人操作间隔 | **15–20 秒** | 从打开候选人到下一个候选人的平均间隔 |
| 连续工作时长 | **40–60 分钟** | 达到后**必须**冷却 |
| 冷却时长 | **30–60 分钟** | 期间不要开在线简历 |
| 每轮建议规模 | **≤ 30 人** | 首轮建议 ≤ 10 人先验证 |

```bash
# 跑批是一个「逐人循环」，请你/Agent 按 §4 的间隔自己控节奏：
#   每个人之间 sleep 15–20 秒；连续 40–60 分钟后整体停下冷却
boss open <candidate-id>                       # 逐个目标
boss capture-resume <candidate-id> --out ./_过程文件/resume/<candidate-id>
boss send <candidate-id> --text "<开场话术>"
boss request-resume <candidate-id>
boss favorite <candidate-id>
# 循环里每次操作前建议先 boss bridge status，确认扩展还在线
```

### 限流信号与处置

| 信号 | 含义 | 处置 |
| --- | --- | --- |
| 简历画布停在 **300×150** 且重启浏览器无效 | **短时限流** | **立即停手，冷却 30–60 分钟**；不要重试 |
| 接口返回 `code:37` | 环境门控命中 | 确认无调试端口/无头/境外代理；冷却后再试 |
| 操作明显变慢、响应超时增多 | 接近限流 | 放慢到 25–30 秒/人，或提前冷却 |

> **反模式**：看到 300×150 就重启浏览器、反复重开简历——这会让冷却时间**变长**。
> **正确反应**：把它当作「今天到此为止」的信号。

### 首次使用建议

```
第 1 轮：3–5 人     ← 只为验证链路通不通，不看效果
第 2 轮：10 人      ← 验证评分口径是否合理
第 3 轮起：按节奏正常跑
```

---

## 5. 常见故障与处置

### 5.1 桥掉线

**症状**：所有命令报 `bridge-unreachable` / `ECONNREFUSED 127.0.0.1:8898`。

**处置**：

```bash
# 1. 确认桥进程是否还在
#    Windows:
Get-Process node | Select-Object Id, ProcessName, StartTime
#    macOS:
ps aux | grep boss-bridge | grep -v grep

# 2. 确认端口是否被占（占用了说明有残留进程）
#    Windows:
netstat -ano | findstr :8898
#    macOS:
lsof -nP -iTCP:8898 -sTCP:LISTEN

# 3. 重启桥，然后刷新扩展
npm run bridge
#    chrome://extensions → boss-bridge → 「刷新」
```

> **注意**：重启桥后**必须刷新扩展**或重启浏览器，否则扩展仍连着旧连接。

---

### 5.2 扩展未连上

**症状**：`boss doctor` 里 `extensionConnected: false`，或 `/status` 显示未连接。

**按序排查**：

1. **启动顺序**是否反了（浏览器早于桥）？→ 刷新扩展。
2. 扩展是否**已启用**？→ `chrome://extensions` 确认状态是「已启用」而非「已停用」。
3. 扩展是否被**改过代码没重载**？→ 点「刷新」+ **重新加载目标页面**。
4. 桥端口是否被改过而扩展里还是旧地址？→ 检查扩展的桥地址设置。
5. 是否装了**第二个**浏览器实例（不同 profile）？→ 扩展只装在其中一个里。

```bash
# 一键复位：刷扩展 → 重载页面 → 再自检
boss browser open --clear-cache
```

---

### 5.3 画布不渲染（300×150）

**症状**：在线简历抓出来是一张 300×150 的占位图，或抓图成功但内容空白。

**按序排查**：

1. **窗口是否在前台？** —— 这是最常见原因。手动点一下浏览器窗口，再抓一次试试。
2. **是否被限流了？** —— 手动打开同一个人的在线简历，如果**手动也渲染不出来**，就是限流 → 冷却 30–60 分钟。
3. **标签页是否是当前激活标签？** —— 后台标签页同样会被节流。
4. 是否开了多个浏览器窗口，操作的窗口被另一个盖住了？

```bash
# 强制置前 + 重新抓取
boss capture-resume <candidate-id> --out ./_过程文件/resume/<candidate-id>
```

> **判定口诀**：手动能看到 = 工具问题（查置前）；手动也看不到 = **限流**（去冷却）。

---

### 5.4 发送无反应

**症状**：`boss send` 返回成功，但会话里没有消息；或输入框里的文字没清空。

**按序排查**：

1. 看 `/status`，扩展是否还在线。
2. 指纹是否核对通过？—— 若面板上的人不是目标，工具会**拒绝发送**（这是正确行为）。
3. 输入框是否有**特殊字符/换行**导致发送被阻断？先试纯文本短句。
4. 页面是否有**浮层挡住**了发送按钮？

**处置**：

```bash
# 1. 清浮层
boss cleanup

# 2. 重试（工具内部会走多策略兜底：内层 .submit → 外层 .submit-content → Enter → 再点一次）
BOSS_DEBUG=1 boss send <candidate-id> --text "<开场话术>"

# 3. 用会话快照确认到底发了没
boss open <candidate-id>
```

> **判定标准**：**输入框已清空 且 会话里出现该消息** 才算成功。只要没在会话里看到，就当作**没发出去**，不要靠返回值判断。

**⚠️ 重要**：如果工具已经发出去但你没看到（如页面未刷新），**不要重复发送**。先用 `boss open <candidate-id> --messages 20` 拉一次会话记录确认。

---

### 5.5 弹层叠加（幽灵窄栏浮窗）

**症状**：页面中部出现一条窄窄的中文文字浮层，或简历显示成全宽/窄栏错乱。

**原因**：上一个人的简历弹层没彻底关掉就开了下一个，生成**第二个弹层实例**。

**处置**：

```bash
# 1. 一键清理所有叠层
boss cleanup

# 2. 验证：看一眼页面应该只剩一个简历弹层或全部关闭
boss cleanup

# 3. 若清理不干净：关闭目标标签页重新打开（登录态保留）
```

**预防**：

- 工具每次开简历前/关简历后都会自动调用 `cleanupResumeDom`；
- 若你自己写脚本，务必同样处理；
- **不要按 Esc 反复关**（可能只关掉最上层），用 `boss cleanup`。

---

### 5.6 其他

| 症状 | 处置 |
| --- | --- |
| 响应超时 / 调用卡死 | 见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md#4-响应超时--调用卡死) |
| 附件简历按钮不可点 | 见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md#6-附件简历按钮-disabled) |
| Excel 写不进去 | 关掉正在打开的 xlsx，或让工具另存版本号文件 |
| 下载文件名重复 | 用 `_id6` 后缀区分，不要覆盖 |

---

## 6. 数据与隐私

### 6.1 数据存在哪里

| 数据 | 位置 | 敏感度 |
| --- | --- | --- |
| 候选人列表快照 | `_过程文件/list-*.json` | **个人敏感信息** |
| 在线简历截图 | `_过程文件/resume/<candidate-id>/` | **个人敏感信息** |
| 附件简历 PDF | `输出/简历PDF/` | **个人敏感信息** |
| 评分与摘录 | `_过程文件/scores.json` | **个人敏感信息** |
| 指令日志 | `_过程文件/logs/` | 低（不含正文） |
| 浏览器登录态 | 专用 profile 目录 | **凭据** |

### 6.2 硬性要求

1. **全部本地存放**。本工具**不向任何第三方服务器发送数据**；桥只绑 `127.0.0.1`，局域网不可达。
2. **不要外传**：
   - 不要把简历/截图/名单发到公开群、网盘、个人邮箱；
   - 不要把 `_过程文件/` 或 `输出/` 提交进 Git；
   - 不要截图发到公开渠道（截图里含候选人姓名与经历）。
3. **不要把 profile 目录**拷贝给他人或放进仓库——里面有你的登录凭据。
4. **用完清理**：按你的组织合规流程，在招聘流程结束后删除`_过程文件/`与`输出/`中的个人数据。
5. **最小必要**：只收集与你当前岗位筛选直接相关的信息；**不要**为了「以后可能有用」而全量囤积简历。
6. **候选人有权**：若候选人要求删除其信息，按你的合规流程处理，并同步删除本地产出的所有副本与截图。

### 6.3 建议的防护动作

```bash
# 让 .gitignore 覆盖产出目录（如果还没覆盖）
printf '%s\n' '_过程文件/' '输出/' '*.log' > .gitignore.boss-append

# 收工后确认没有把敏感文件放进交付目录
boss audit --people ./_过程文件/people.json --json
```

Windows 上可对 `输出/` 与 `_过程文件/` 目录设置仅当前用户可读的 ACL（可选，视环境而定）。

---

## 7. 日常检查清单

**开工**

- [ ] 桥已启动，日志正常滚动
- [ ] 浏览器已启动（可见、带扩展、无调试端口）
- [ ] `boss doctor` 全 ✓
- [ ] 确认是**自己的招聘账号**且已登录

**跑批中**

- [ ] 节奏 15–20 秒/人
- [ ] 每 40–60 分钟冷却一次
- [ ] 看到 300×150 立即停手冷却
- [ ] 写操作都有核验（输入框清空 + 会话出现消息）
- [ ] 每步都留原文摘录

**收工**

- [ ] `boss audit` 通过
- [ ] `boss cleanup` 清完残留
- [ ] 交付目录干净
- [ ] 日志与过程文件已归档
- [ ] 本地敏感数据按合规要求处置

---

## 相关文档

- 故障速查表 → [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- 坑清单 → [PITFALLS.md](PITFALLS.md)
- 筛选口径 → [SOP.md](SOP.md)
