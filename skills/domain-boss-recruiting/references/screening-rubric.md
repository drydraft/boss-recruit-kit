# Screening rubric — sole authority

> Read this file before scoring anyone, at either stage. Every gate, weight, deduction, tier boundary, and evidence requirement used anywhere in this skill resolves here. When another file disagrees with this one, this one wins.

Thresholds below are **defaults for one hiring position**. Changing a default is allowed; record the new value in the position's 人才画像 document so the calibration stays traceable. Never change a default mid-run without recording it.

---

## 0. Two-stage shape

```
Stage 1  list-level gates G1–G6      open no resume; decide pass / reject
   |     output: pass + rejects, each reject restatable and quote-backed
   v
Stage 2  online-resume precision     only stage-1 passers; 100 points
   |     output: per-dimension score + tier + verbatim quote per dimension
   v
Stage 3  outreach (a conversion step, not screening) — see outreach-and-collection.md
```

**Why staged**: opening an online resume is the most expensive and most throttle-sensitive action in the whole run. Kill the obvious mismatches with list-level fields first, then spend resume reads only on people who can still qualify. The cost model itself belongs to `core-gated-web-automation`; the gate definitions below belong here.

---

## 1. Stage 1 — list-level gates (G1–G6)

### 1.1 Field source

Take every gate input from **list and conversation-panel fields only** — never open an online resume in this stage:

| Field | Note |
| --- | --- |
| 年龄 | as displayed |
| 学历 | highest stated |
| 工作年限 | formal experience only |
| 当前公司及岗位 | fingerprint field |
| 期望城市 / 期望薪资 | range text as written |
| **打招呼留言全文** | **concatenate every turn of the greeting** |

⛔ HARD RULE — read the **whole** greeting thread. Candidates often split it across several messages; reading only the last one silently loses the salary, location, or availability statement the gates depend on.

### 1.2 Gate definitions

| ID | Gate | Pass condition | On failure |
| --- | --- | --- | --- |
| **G1** | 学历 | 本科及以上 | 大专: **pass with a −5 deduction** (see §2.4); below 大专: reject |
| **G2** | 工作年限 | **≥ 1 year** of formal experience | reject; internships and in-school work do not count |
| **G3** | 地域 | 大湾区, **深圳 preferred** | outside 大湾区: reject; 大湾区 but not 深圳: pass, ranked lower |
| **G4** | 期望薪资 | expected **upper bound ≤ 16K** | over budget: reject; if the greeting says the figure is negotiable, route to manual review |
| **G5** | 岗位方向 | development role matching the open direction | other direction: reject |
| **G6** | 到岗 | can start; not an explicit 「暂不考虑机会」 | explicitly unavailable: reject |

### 1.3 Gate exceptions

- G4 and G6 are **superseded by the greeting text**. A candidate who states 「薪资可谈」or 「随时到岗」 in the greeting enters the manual-review queue instead of being auto-rejected.
- Gates are hard. Never admit a candidate because the overall impression is good — that reasoning belongs to stage 2, and admitting it here defeats the cost saving that justifies the split.

### 1.4 Stage-1 record

One record per candidate. Every rejection carries a reason that can be repeated back to the operator without re-reading anything.

```jsonc
{
  "candidateId": "<会话id>",
  "stage1": {
    "pass": false,
    "failedGates": ["G4"],
    "reason": "期望上限 20K，超出岗位预算 16K",
    "evidence": ["打招呼留言原文：「期望 18–20K」"]
  }
}
```

⛔ HARD RULE — every rejection record carries at least one **verbatim** quote from the list fields or the greeting. A rejection without a quote is not a rejection; re-derive it or drop it.

---

## 2. Stage 2 — online resume, 8 dimensions, 100 points

Runs on stage-1 passers only.

### 2.1 Dimensions and weights

| ID | Dimension | Max | What it reads |
| --- | --- | --- | --- |
| **D1** | 独立闭环交付 | **25** | carried one thing end to end: 需求 → 设计 → 开发 → 上线 → 维护; look for a system or module owned alone |
| **D2** | 业务理解与需求拆解 | **20** | understands the business goal and can split a fuzzy request into executable tasks; the resume says **why**, not only **what** |
| **D3** | 技术栈重合度 | **15** | overlap with the position's required stack |
| **D4** | 稳定性与性价比 | **15** | length of each stint, job-change cadence, expected salary versus demonstrated ability |
| **D5** | 工程化交付 | **12** | version control, tests, CI/CD, code standards, release process, monitoring and triage |
| **D6** | 接手维护旧系统 | **5** | took over someone else's legacy system and kept it running or migrated it in steps |
| **D7** | ERP / 低代码 / 二开 | **4** | ERP, low-code platforms, secondary development |
| **D8** | AI 辅助编码实操 | **4** | **traces of using AI tooling to raise coding throughput** — see §2.3 |

Total: **100**.

### 2.2 Scoring bands

Score each dimension by band, then round. Never assign a dimension by feel.

| Band | Share of max | Meaning |
| --- | --- | --- |
| 优秀 | 0.85–1.0 | specific, concrete, verifiable experience supports it |
| 良好 | 0.65–0.85 | relevant experience, but thin on detail or depth |
| 一般 | 0.4–0.65 | the concept is named, no actual outcome |
| 弱 | 0.15–0.4 | mentioned in passing only |
| 无证据 | **0** | **no quote available → forced 0** |

### 2.3 AI / RAG / Agent

⛔ HARD RULE — **AI / RAG / Agent is not a bonus by itself.**

- A resume claiming 「做过 RAG 知识库」or 「做过 Agent 工作流」earns nothing for the claim.
- Only **D8** recognises **operational traces** of using AI tooling to code faster: which concrete steps it covered, what changed in throughput, how the AI output was validated.
- Directional capability is judged by **D1/D2 only** — delivered business systems, not technology-name heat.

Rationale: AI vocabulary is cheap to package and cannot be falsified during screening, whereas "independently delivered a business system" can be cross-checked against resume detail.

### 2.4 Deductions

Applied **after** the eight dimensions, on top of the sum.

| Deduction | Points | Test |
| --- | --- | --- |
| 纯算法, no business-system delivery | **−15** | every stint is model/algorithm research with no engineering delivery |
| 仅大厂细分模块 | **−10** | only a very narrow module at a large employer, no end-to-end view |
| 近两段经历每段 **< 1 年** | **−15** | "近两段" = the two most recent formal stints |
| 履历矛盾 | **−20** | timeline does not add up, years mismatch the described history, company or title contradicts itself |
| 大专 | **−5** | mirrors G1: a 大专 candidate may still be pooled, at this cost |

### 2.5 Total and tiers

```
总分 = Σ(D1..D8) − Σ(扣分项)，下限 0

S  ≥ 70     强烈推荐, contact first
A  55–69    推荐, front of the backup list
B  40–54    观望, depends on the open headcount gap
C  25–39    暂不推进, keep on file
D  < 25     淘汰
```

### 2.6 Evidence rule

⛔ HARD RULE — **every dimension must carry a verbatim quote from the candidate. A dimension without a quote scores 0.**

- The quote is **word for word** from the resume or the greeting; a paraphrase or a summary is not a quote.
- The quote is **locatable** — which screen, which section, which module.
- One quote may carry the main judgement of **one** dimension; reusing it for a second dimension requires a written justification in that row.
- The score table and its quotes ship together so the operator can re-check every number.

```jsonc
{
  "dimension": "D1",
  "score": 21,
  "max": 25,
  "evidence": [
    { "source": "在线简历 · 工作经历 · 第 2 段", "quote": "<候选人原文逐字摘录>" }
  ],
  "rationale": "独立负责过完整系统的需求到上线"
}
```

### 2.7 Resume conflicts

⛔ HARD RULE — on 履历矛盾, never guess the resolution. Flag the contradiction, attach **both** quotes, and hand the row to manual review. Record the manual-review flag in the list's 备注 column.

---

## 3. Calibration and traceability

- Write the actual G1–G6 values used, and every changed default, into the position's 人才画像 document.
- If stage 1 passes far more or far fewer people than the run can handle, change the thresholds, **record them**, then re-run stage 1 over the same extracted list. Do not change them row by row.
- Record the tier counts at the end of stage 2; a distribution concentrated in one tier usually means a band was misapplied, not that the pool is unusual.

## 4. Handoff to the operator

Screening cannot falsify everything. Carry these into the 面试验证清单 in the 人才画像 document instead of pretending they were settled:

- the real boundary of an "independent end-to-end" claim (what was actually owned alone);
- any 履历矛盾 flagged in §2.7;
- salary expectations that only appeared as negotiable in the greeting (G4 exception rows);
- availability that was only implied (G6 exception rows).
