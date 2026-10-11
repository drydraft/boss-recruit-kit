# 操作剧本 · 从 0 到出一份初筛名单

> 本文解决什么问题：**照着做就行**。从零环境到拿到四项交付物，每一步都写清「命令 → 预期输出 → 检查点 → 失败了看哪篇文档」。

**这是一个模板剧本**：所有 `<...>` 都是占位，请替换成你自己的值。参数（门槛阈值、岗位名、节奏）按你的实际情况调整后，**写进人才画像文档**以保证口径可追溯。

| 占位符 | 含义 | 示例 |
| --- | --- | --- |
| `<repo>` | 本仓库根目录 | —— |
| `<JOB_ID>` | 目标职位 id | —— |
| `<candidate-id>` | 候选人**会话 id**（唯一） | —— |
| `<岗位>` | 岗位名称（用于文件名） | —— |

**总预计耗时**：链路验证 15 分钟 + 跑批（按人数，15–20 秒/人 + 冷却）+ 出报告 10 分钟。

---

## 目录

- [阶段 0 · 环境就绪](#阶段-0--环境就绪)
- [阶段 1 · 链路验证（3–5 人）](#阶段-1--链路验证35-人)
- [阶段 2 · 第一段：列表级硬门槛](#阶段-2--第一段列表级硬门槛)
- [阶段 3 · 第二段：在线简历精筛](#阶段-3--第二段在线简历精筛)
- [阶段 4 · 触达与收集](#阶段-4--触达与收集)
- [阶段 5 · 出报告与交付](#阶段-5--出报告与交付)
- [阶段 6 · 收工](#阶段-6--收工)
- [附 · 全程失败对照表](#附--全程失败对照表)

---

## 阶段 0 · 环境就绪

### 0.1 确认代码与依赖

```bash
cd <repo>
node -v          # 期望 v20.x 或更高
npm -v          # 期望 8.x 或更高
npm install
```

**预期输出**：`npm install` 无 error（warning 可忽略）。

**检查点**
- [ ] `node -v` ≥ 20
- [ ] `npm install` 退出码 0

**失败看哪** → [INSTALL.md §0](../docs/INSTALL.md#0-前置条件)

---

### 0.2 装扩展

```
chrome://extensions
→ 打开「开发者模式」
→ 「加载已解压的扩展程序」→ 选 <repo>/packages/bridge/extension
```

**预期输出**：出现扩展卡片「boss-bridge」，状态「已启用」。

**检查点**
- [ ] 扩展卡片存在且已启用
- [ ] 卡片上没有红色「错误」按钮

**失败看哪** → [INSTALL.md §2](../docs/INSTALL.md#2-加载浏览器扩展mv3)

---

### 0.3 起桥

```bash
npm run bridge
```

**预期输出**

```
[boss-bridge] HTTP listening on http://127.0.0.1:8898
[boss-bridge] WS   listening on ws://127.0.0.1:8899
[boss-bridge] waiting for extension to connect...
```

**检查点**
- [ ] 两行 listening 都出现
- [ ] 日志里稍后会出现 `extension connected`

**失败看哪** → [TROUBLESHOOTING.md §2](../docs/TROUBLESHOOTING.md#2-bridge-unreachable)

> ⚠️ **保持这个终端开着**。桥必须在整个流程中运行。

---

### 0.4 起浏览器（可见窗口 + 带扩展 + 无调试端口）

```bash
# Windows
start-chrome.cmd

# macOS
./start-chrome.sh
```

**预期输出**：浏览器窗口打开，直接落到招聘工作台页面。

**检查点**
- [ ] 窗口是**可见**的（不是无头）
- [ ] 启动参数**没有** `--remote-debugging-port`
- [ ] 页面停留 **> 10 秒**不自动变白
- [ ] 已登录（能看到自己的招聘工作台）

**失败看哪**
- 页面 5 秒后自己关掉 → [TROUBLESHOOTING.md §9](../docs/TROUBLESHOOTING.md#9-页面自己关闭跳到-aboutblank)
- 没登录 → [INSTALL.md §6](../docs/INSTALL.md#6-登录态与专用-profile)

---

### 0.5 自检

```bash
boss doctor
```

**预期输出**

```
[✓] Node version        v20.x.x  (>= 20)
[✓] Bridge HTTP         127.0.0.1:8898 reachable
[✓] Bridge WS           127.0.0.1:8899 reachable
[✓] Extension           connected (v<version>)
[✓] Browser heartbeat   last seen 3s ago
[✓] Login state         logged in
[✓] Target page         chat/index loaded
```

**检查点**
- [ ] 全部为 `[✓]`，尤其 `Extension` 与 `Login state`
- [ ] `Browser heartbeat` 显示 **< 20s**

**失败看哪**
- `extensionConnected: false` → [TROUBLESHOOTING.md §1](../docs/TROUBLESHOOTING.md#1-extensionconnected-false)
- 心跳很旧 → [OPERATIONS.md §2](../docs/OPERATIONS.md#2-自检命令)

---

### 0.6 建目录

```bash
mkdir -p _过程文件/logs 输出/简历PDF
```

**预期输出**：目录创建成功。

**检查点**
- [ ] `_过程文件/` 用于过程产物
- [ ] `输出/` 只放四项交付物（**此刻它是空的**）

**失败看哪** → [OPERATIONS.md §3](../docs/OPERATIONS.md#3-日志)

---

## 阶段 1 · 链路验证（3–5 人）

> **目的**：只验证链路通不通，**不看筛人效果**。这一步能把 80% 的环境问题挡在批量跑批之前。

### 1.1 拉一个小列表

```bash
boss list --limit 5 --json > ./_过程文件/list-smoke.json
```

**预期输出**：5 条候选人记录，每条含年龄、学历、年限、当前公司岗位、**打招呼留言全文**。

**检查点**
- [ ] 条数 == 5（少于 5 说明该职位候选人不足，换个职位）
- [ ] **留言字段非空**（空的话第一段筛不了）

**失败看哪**
- 超时/无响应 → [TROUBLESHOOTING.md §4](../docs/TROUBLESHOOTING.md#4-响应超时--调用卡死)
- 只有 40 行以内的数据 → [PITFALLS.md C2](../docs/PITFALLS.md#c2-虚拟列表--手势门控程序化滚动加载不出更多行)

---

### 1.2 打开一个人（含指纹核对）

```bash
boss open <candidate-id>
```

**预期输出**

```
[ok] opened candidate <candidate-id>
[ok] fingerprint matched: 姓名/年龄/学历/年限/公司+岗位
```

**检查点**
- [ ] 输出里**有指纹核对通过**的字样
- [ ] 面板上显示的人**就是你指定的那个人**

**失败看哪**
- `FINGERPRINT_MISMATCH` → 正常保护行为；确认会话 id 是否搞错，见 [PITFALLS.md C3](../docs/PITFALLS.md#c3-同名候选人会把消息发错人)
- 等不到面板切换 → [PITFALLS.md D2](../docs/PITFALLS.md#d2-读快照太早会读到上一个人的数据)

---

### 1.3 抓一份在线简历

```bash
boss capture-resume <candidate-id> --out ./_过程文件/smoke-resume --screens 12 --scale 0.9
```

**预期输出**

```
[ok] canvas exported 4/4 chunks (avg 48KB)
[ok] stitched -> ./_过程文件/smoke-resume/<candidate-id>.png
```

**检查点**
- [ ] 抓到 **4 块**（不是 1 块、也不是 0 块）
- [ ] 拼接后的图**不是 300×150**
- [ ] **打开这张图看一眼**，能读到候选人经历文字

**失败看哪**
- 图是 300×150 → [TROUBLESHOOTING.md §3](../docs/TROUBLESHOOTING.md#3-简历画布停在-300150)（先查窗口是否在前面）
- 调用不返回 → [TROUBLESHOOTING.md §4](../docs/TROUBLESHOOTING.md#4-响应超时--调用卡死)
- 内容被截断成「… 查看全部」 → [PITFALLS.md B3](../docs/PITFALLS.md#b3-查看全部必须点开否则内容被截断)

---

### 1.4 清理一下页面

```bash
boss cleanup
```

**预期输出**：`[ok] removed 0-N overlay nodes`

**检查点**
- [ ] 页面上没有多余的窄栏文字浮层

**失败看哪** → [TROUBLESHOOTING.md §12](../docs/TROUBLESHOOTING.md#12-页面出现窄栏幽灵浮窗)

> ✅ **链路验证通过**。如果这 4 步全绿，后面的批量跑批基本不会有环境问题。

---

## 阶段 2 · 第一段：列表级硬门槛

### 2.1 拉完整列表

```bash
boss list --limit 200 --json > ./_过程文件/list.json
```

**预期输出**：候选人列表 JSON（条数按实际）。

**检查点**
- [ ] 每条都有**打招呼留言全文**（多轮的都拼在一起）
- [ ] 记录实际拿到多少条（用于和后续逐段对账）

**失败看哪** → [PITFALLS.md C2](../docs/PITFALLS.md#c2-虚拟列表--手势门控程序化滚动加载不出更多行)

---

### 2.2 跑第一段筛选

```bash
# 第一段没有对应的 CLI 子命令：G1–G6 由你/Agent 按 SOP §1 判定
# 输入：./_过程文件/list.json（含打招呼留言全文）
# 输出：./_过程文件/stage1.json（通过 / 淘汰 + 原因 + 原文证据）
```

**预期输出**

```
[ok] stage1: 137 in / 42 pass / 95 rejected
淘汰分布: G4=41  G3=28  G2=17  G5=6  G6=3
```

**检查点**
- [ ] 通过人数是**可批量处理的规模**（建议 ≤ 60）
- [ ] **每条淘汰记录都有原因 + 原文证据**
- [ ] 抽 3 条人工复核，原因说得通

**失败看哪** → [SOP.md §1](../docs/SOP.md#1-第一段列表级硬门槛g1g6)

> **门槛口径**：G1 学历 / G2 年限 / G3 地域 / G4 薪资 / G5 方向 / G6 到岗。若通过人数太多或太少，**调整阈值后重新跑**，并把新阈值写进人才画像文档。

---

## 阶段 3 · 第二段：在线简历精筛

> 这是**最贵也最容易被限流**的阶段。**严格控节奏**：15–20 秒/人，跑 40–60 分钟必须冷却 30–60 分钟。

### 3.1 生成待核验名单 people.json

这份名单同时是 `boss audit` 的输入，也是后面 `boss open` 的逐人清单：

```bash
cat > ./_过程文件/people.json <<'JSON'
{
  "people": [
    { "id": "<candidate-id>", "name": "候选人A", "age": 0, "workExp0": "", "index": 0 }
  ]
}
JSON
```

**预期输出**：`people.json` 生成。

**检查点**
- [ ] 每个条目都有 **`id`**（会话 id，唯一）
- [ ] `name` 只用于搜索与显示，**不用于定位**
- [ ] 同名的多个人用不同的 `id`，必要时用 `index` 取第 N 个同名建议
- [ ] `age` / `workExp0` 填上期望指纹（写错会直接暴露指纹不符）

**失败看哪** → [SOP.md §2.6](../docs/SOP.md#26-证据要求硬规则)

---

### 3.2 逐人抓简历（或直接用 run 批量）

```bash
# 单个人（便于观察）
boss capture-resume <candidate-id> --out ./_过程文件/resume/<candidate-id> --screens 12 --scale 0.9

# 或按 people.json 逐人循环（请自己控节奏，见 docs/OPERATIONS.md §4）
while read -r id; do
  boss capture-resume "$id" --out "./_过程文件/resume/$id" --screens 12 --scale 0.9
  sleep 18
done < <(node -e 'const p=require("./_过程文件/people.json");p.people.forEach(x=>console.log(x.id))')
```

**预期输出**：每人一个目录，含**逐屏分块图**（每屏 4 块，命名形如 `001-1.png`……`012-4.png`，屏号 3 位补零）。

**检查点（每 10 人抽查一次）**
- [ ] 图**不是 300×150**
- [ ] 图里的人和 `expect` 指纹**一致**
- [ ] 节奏确实在 15–20 秒/人

**失败看哪**
- 300×150 → [TROUBLESHOOTING.md §3](../docs/TROUBLESHOOTING.md#3-简历画布停在-300150)
- 出现窄栏浮窗 → [TROUBLESHOOTING.md §12](../docs/TROUBLESHOOTING.md#12-页面出现窄栏幽灵浮窗)
- 明显变慢 → [OPERATIONS.md §4](../docs/OPERATIONS.md#4-节奏控制)

> ⏸️ **到 40–60 分钟就停下来冷却**。这不是建议，是硬要求。

---

### 3.3 八维度评分（人工/Agent 读图 + 打分）

```bash
# 八维度打分：读 ./_过程文件/resume/<candidate-id>/ 的图，按 SOP §2 逐维打分
# 每个维度必须附候选人原文摘录（无摘录按 0 分）→ 落 ./_过程文件/scores.json
```

**预期输出**

```
[ok] scored 42 candidates
分级分布: S=3  A=9  B=14  C=12  D=4
[!] 2 个维度缺原文证据 → 已按 0 分处理
```

**检查点**
- [ ] **每个候选人每个维度都有原文摘录**
- [ ] 缺证据的维度确实按 **0 分** 处理
- [ ] 没有给「AI/RAG/Agent 经历」加分
- [ ] 否定项（纯算法 −15 / 仅大厂细分 −10 / 近两段<1年 −15 / 履历矛盾 −20 / 大专 −5）已应用

**失败看哪** → [SOP.md §2](../docs/SOP.md#2-第二段在线简历精筛八维度-100-分)

---

### 3.4 一致性审计

```bash
boss audit --in ./_过程文件/scores.json
```

**预期输出**

```
[ok] 42 candidates, 42 with evidence for all 8 dimensions
[ok] 0 fingerprint mismatches
[warn] 1 candidate has conflicting timeline (flagged for manual review)
```

**检查点**
- [ ] **证据覆盖率 100%**
- [ ] 指纹不符数 == 0（>0 必须逐条查明原因）
- [ ] 履历矛盾项已 flag（**不要自行猜测**，交人工）

**失败看哪** → [SOP.md §4.5](../docs/SOP.md#45-交付前检查)

---

## 阶段 4 · 触达与收集

> 只对**分级 S/A**（必要时 B）的人触达。

### 4.1 开场话术

```bash
boss send <candidate-id> --text "<开场话术>"
```

**预期输出**

```
[ok] input cleared
[ok] message visible in conversation
[ok] verified
```

**检查点**
- [ ] **输入框已清空** ✅
- [ ] **会话里出现该消息** ✅
- [ ] 话术里**没有问到岗时间**

**失败看哪** → [TROUBLESHOOTING.md §13](../docs/TROUBLESHOOTING.md#13-发送无反应)

---

### 4.2 求简历（两步）

```bash
boss request-resume <candidate-id>
```

**预期输出**

```
[ok] confirm dialog accepted
[ok] system message found: 简历请求已发送
```

**检查点**
- [ ] 会话里出现系统消息「**简历请求已发送**」

**失败看哪** → [PITFALLS.md D4](../docs/PITFALLS.md#d4-求简历是两步)

---

### 4.3 收藏

```bash
boss favorite <candidate-id>
```

**预期输出**

```
[ok] read current state: not favorited
[ok] toggled -> favorited
```

**检查点**
- [ ] 输出里**先读了状态**再操作（防止把「已收藏」点成「取消」）

**失败看哪** → [SOP.md §3.3](../docs/SOP.md#33-收藏)

---

### 4.4 收附件简历

```bash
boss download-resume <candidate-id> --out-name '<序号>_<姓名>.pdf' --json
# 重名或同人多会话时改用：--out-name '<序号>_<姓名>_<id6>.pdf'
```

**预期输出**

```
[ok] resolved real download url from preview iframe
[ok] downloaded 输出/简历PDF/01_候选人A.pdf (2.1 MB)
[ok] verified PDF magic header (%PDF)
```

**检查点**
- [ ] 文件头校验通过（`%PDF`）
- [ ] **没有覆盖**已有文件
- [ ] 文件数与「已收简历」人数一致

**失败看哪**
- 按钮不可点 → [TROUBLESHOOTING.md §6](../docs/TROUBLESHOOTING.md#6-附件简历按钮-disabled)
- 文件名重复被覆盖 → [TROUBLESHOOTING.md §7](../docs/TROUBLESHOOTING.md#7-下载文件名重复--被覆盖)

---

### 4.5 致谢

```bash
boss send <candidate-id> --text "<致谢话术>"
```

**预期输出**：同 4.1 的双验证通过。

**检查点**
- [ ] 输入框清空 + 会话出现消息

**失败看哪** → [TROUBLESHOOTING.md §13](../docs/TROUBLESHOOTING.md#13-发送无反应)

---

## 阶段 5 · 出报告与交付

### 5.1 生成四项交付物

```bash
# 这三项是「产物契约」，没有对应的 CLI 子命令：
# 由你/Agent 按 SOP §4 生成到 输出/（可用 Office 技能/脚本产出）
#   输出/最终筛选名单_<岗位>.xlsx
#   输出/人才画像与筛选标准_<岗位>.docx
#   输出/在线简历汇编报告.pdf
# 生成前先确认目标 xlsx 没被 Excel/WPS 打开
```


**预期输出**

```
[ok] 输出/最终筛选名单_<岗位>.xlsx
[ok] 输出/人才画像与筛选标准_<岗位>.docx
[ok] 输出/在线简历汇编报告.pdf
```

**检查点**
- [ ] 三个文件都生成
- [ ] 名单里有 **D1–D8 各一列 + 否定项 + 总分 + 分级 + 四个跟踪列**
- [ ] 名单里有**会话 id 列**

**失败看哪** → [TROUBLESHOOTING.md §8](../docs/TROUBLESHOOTING.md#8-excel-文件被占用写不进去)

---

### 5.2 交付前审计

```bash
boss audit --people ./_过程文件/people.json --json
```

**预期输出**

```
[ok] 4/4 deliverables present
[ok] 输出/ contains no process artifacts
[ok] evidence coverage: 100%
[warn] 1 candidate flagged for manual review
```

**检查点**
- [ ] 四项交付物齐全（含 `简历PDF/` 目录）
- [ ] 交付目录**没有**过程文件
- [ ] 证据覆盖率 100%
- [ ] 名单会话 id 与简历 PDF **一一对应**

**失败看哪** → [SOP.md §4.5](../docs/SOP.md#45-交付前检查)

---

### 5.3 最终确认清单

```
输出/
├── 最终筛选名单_<岗位>.xlsx        [ ]
├── 人才画像与筛选标准_<岗位>.docx   [ ]
├── 在线简历汇编报告.pdf             [ ]
└── 简历PDF/                        [ ]
```

- [ ] 打开 xlsx 扫一遍：无空白的评分口径列
- [ ] 打开 docx 扫一遍：**面试验证清单**在
- [ ] 打开 pdf 扫一遍：**每人 1 页**，截图与评分对得上
- [ ] `简历PDF/` 里文件数与名单「已收简历」数一致
- [ ] 目录里**没有**任何过程文件

---

## 阶段 6 · 收工

```bash
# 1. 清理页面残留
boss cleanup

# 2. 归档过程文件（可选）
mv ./_过程文件 ./_过程文件_$(date +%F)

# 3. 停桥：在桥的终端按 Ctrl+C
```

**检查点**
- [ ] 页面没有残留弹层
- [ ] 敏感数据（简历、截图）按你的合规流程处置
- [ ] **没有**把 `_过程文件/` 或 `输出/` 提交进 Git

**失败看哪** → [OPERATIONS.md §6](../docs/OPERATIONS.md#6-数据与隐私)

---

## 附 · 全程失败对照表

| 阶段 | 症状 | 看哪 |
| --- | --- | --- |
| 0.4 | 页面 5 秒后自己关掉 | [TROUBLESHOOTING §9](../docs/TROUBLESHOOTING.md#9-页面自己关闭跳到-aboutblank) |
| 0.5 | `extensionConnected: false` | [TROUBLESHOOTING §1](../docs/TROUBLESHOOTING.md#1-extensionconnected-false) |
| 0.5 | `bridge-unreachable` | [TROUBLESHOOTING §2](../docs/TROUBLESHOOTING.md#2-bridge-unreachable) |
| 0.5 | 接口 `code:37` | [TROUBLESHOOTING §10](../docs/TROUBLESHOOTING.md#10-接口返回-code37) |
| 1.1 | 列表只有 40 行 | [PITFALLS C2](../docs/PITFALLS.md#c2-虚拟列表--手势门控程序化滚动加载不出更多行) |
| 1.2 | `FINGERPRINT_MISMATCH` | [TROUBLESHOOTING §5](../docs/TROUBLESHOOTING.md#5-把消息发给了同名的人) |
| 1.3 | 画布 300×150 | [TROUBLESHOOTING §3](../docs/TROUBLESHOOTING.md#3-简历画布停在-300150) |
| 1.3 | 抓图调用卡死 | [TROUBLESHOOTING §4](../docs/TROUBLESHOOTING.md#4-响应超时--调用卡死) |
| 1.3 | 内容截断「… 查看全部」 | [PITFALLS B3](../docs/PITFALLS.md#b3-查看全部必须点开否则内容被截断) |
| 1.4 | 窄栏幽灵浮窗 | [TROUBLESHOOTING §12](../docs/TROUBLESHOOTING.md#12-页面出现窄栏幽灵浮窗) |
| 3.2 | 跑批中途整体变慢 | [OPERATIONS §4](../docs/OPERATIONS.md#4-节奏控制) |
| 4.1 | 发送无反应 | [TROUBLESHOOTING §13](../docs/TROUBLESHOOTING.md#13-发送无反应) |
| 4.1 | 消息发给了同名的人 | [TROUBLESHOOTING §5](../docs/TROUBLESHOOTING.md#5-把消息发给了同名的人) |
| 4.2 | 求简历没效果 | [PITFALLS D4](../docs/PITFALLS.md#d4-求简历是两步) |
| 4.4 | 附件简历按钮 disabled | [TROUBLESHOOTING §6](../docs/TROUBLESHOOTING.md#6-附件简历按钮-disabled) |
| 4.4 | 文件名重复/被覆盖 | [TROUBLESHOOTING §7](../docs/TROUBLESHOOTING.md#7-下载文件名重复--被覆盖) |
| 5.1 | xlsx 写不进去 | [TROUBLESHOOTING §8](../docs/TROUBLESHOOTING.md#8-excel-文件被占用写不进去) |
| 5.2 | 交付物不全 | [SOP §4](../docs/SOP.md#4-交付物契约) |
| 任意 | 扩展改了没生效 | [TROUBLESHOOTING §11](../docs/TROUBLESHOOTING.md#11-扩展改了代码没生效) |

**还查不出来** → 按 [TROUBLESHOOTING §0 通用排查三连](../docs/TROUBLESHOOTING.md#0-通用排查三连) 收集信息，再对照 [PITFALLS.md](../docs/PITFALLS.md) 全文。

---

## 相关文档

- 坑清单（**开工前必读**）→ [docs/PITFALLS.md](../docs/PITFALLS.md)
- 评分口径全文 → [docs/SOP.md](../docs/SOP.md)
- 安装与启动 → [docs/INSTALL.md](../docs/INSTALL.md)
- 运维与节奏 → [docs/OPERATIONS.md](../docs/OPERATIONS.md)
- 故障速查 → [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)
- 原理设计 → [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
