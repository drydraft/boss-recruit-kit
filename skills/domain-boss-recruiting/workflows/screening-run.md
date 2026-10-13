# Screening run — cold start to handed-over list

> Read this file when running the task end to end. It carries the **order, checkpoints, artifacts, and exit criteria**; it carries no rubric values (→ `../references/screening-rubric.md`) and no page mechanism (→ `core-gated-web-automation`, `core-safe-batch-operations`, `../references/platform-notes.md`).

## Run record

Keep one working directory for the whole run and one delivery directory for the shipped artifacts. Nothing else is allowed in the delivery directory.

```
_过程文件/            # process only: extracted list, stage outputs, snapshots, chunk images, logs
输出/                 # deliverables only
├── 最终筛选名单_<岗位>.xlsx
├── 人才画像与筛选标准_<岗位>.docx
├── 在线简历汇编报告.pdf
└── 简历PDF/
```

| Placeholder | Meaning |
| --- | --- |
| `<会话id>` | the candidate's conversation id — unique, and the only valid targeting value |
| `<岗位>` | position name, used in file names |
| `<序号>` | rank by total score, used in resume file names |

Person-level examples in the run record use `候选人A`, `候选人B`; never paste a real name, credential, or resume body into notes, prompts, or logs.

---

## Phase 0 — Preflight

**Entry**: the operator has asked for screening, outreach, or a deliverable, on an account the operator owns.

**Steps**

1. Load `core-gated-web-automation` and `core-safe-batch-operations`; confirm both loads went out. Nothing in this playbook runs without them.
2. Reach the channel-PASS state the core skills define (session, window, connection readiness) and echo it: `[Phase 0] Preflight — preconditions: PASS/FAIL`.
3. Create the working and delivery directories listed above.

**Exit**: channel PASS. On FAIL, stop here and report the failing precondition; do not read a single candidate.

---

## Phase 1 — Smoke (3–5 candidates)

Purpose: prove the pipeline end to end. Deliberately ignore whether the candidates are good.

**Steps**

1. Extract a small list (`--limit 5`) and confirm the table carries 年龄 / 学历 / 年限 / 当前公司及岗位 / 期望城市薪资 **and the full greeting thread**. A missing greeting column means stage 1 cannot run at all.
2. Open one candidate by `<会话id>` and confirm the panel identity matches the record (mechanism: core skills).
3. Capture that candidate's online resume and **look at the resulting image**. Confirm it is a real resume, not the ~300×150 unrendered placeholder, and that no section is collapsed behind 「查看全部」 (→ `../references/platform-notes.md` §2).
4. Clear page leftovers with the platform's cleanup step.

**Exit**: all four steps green. Any failure is an environment problem — fix it before any batch; do not start stage 1 on a broken pipeline.

---

## Phase 2 — Stage 1 gates

**Steps**

1. Extract the full list into the working directory. Record **how many rows came back**; the list is bounded by the platform's rendered window, so the number is a lower bound on the pool (→ `../references/platform-notes.md` §7).
2. Concatenate the greeting thread per candidate, all turns.
3. Apply gates G1–G6 from `../references/screening-rubric.md` §1 to every candidate. Read the rubric first; do not apply gate values from memory.
4. Write one record per candidate: `pass`, `failedGates`, a restatable `reason`, and at least one verbatim quote.
5. Spot-check three rejections at random against their quotes.

**Exit**: pass/`reject` recorded for **100%** of extracted rows, and **0** rejections without a restatable quote-backed reason. If the pass count is far above or below what the run can handle, change the thresholds, record the change, and re-run this phase over the same extracted list — never adjust row by row.

---

## Phase 3 — Stage 2 scoring

**Steps**

1. Build the per-candidate work list from the stage-1 passers: each entry needs the `<会话id>` (required), the display name (search and display only), an index for same-name suggestions, and the expected identity fields. A wrong expected field will surface as an identity mismatch, which is the correct protective behaviour.
2. For each candidate: open by `<会话id>`, confirm identity, capture the resume with specified screens and scale, then clear the page. Extraction policy (tiling, size limits, focus validity) is owned by `core-gated-web-automation`; this playbook only fixes the loop order and the pacing. Keep the **specified interval between candidates** and take the cool-down when the continuous-work limit is reached (→ `../references/outreach-and-collection.md` §8).
3. Store each candidate's captures in their own folder; expect per-screen image chunks with the screen number zero-padded to three digits and the chunk index after a hyphen (`001-1`, …, `012-4`).
4. Score every captured candidate against `../references/screening-rubric.md` §2: eight dimensions by band, then deductions, then the tier. **Every dimension carries a verbatim quote and a locatable source.** A dimension without a quote is 0 and is logged `no-evidence`.
5. Record the tier counts for the round.

**Exit**: stage-2 rows contain **only** stage-1 passers (plus explicitly flagged manual-review entries); evidence coverage is 100%; every flagged 履历矛盾 carries both quotes and is handed to manual review rather than resolved. If a capture is unusable, apply the retry and abandon limits in the skill's Convergence section instead of looping.

---

## Phase 4 — Outreach and collection

Contact tiers **S and A** first; add **B** only when the operator asks or headcount is still open.

The write contract that gates this phase is the one `core-safe-batch-operations` requires before any action; the stage-2 tier list supplies its entity set, and `outreach-and-collection.md` §1 supplies the action order.

Per candidate, in this order, reading `../references/outreach-and-collection.md` first:

1. opener — one sentence of recognition, one request for a PDF resume, no arrival-date question;
2. resume request — two-step confirm, accepted only on the 「简历请求已发送」 system message;
3. favourite — read the current state before toggling;
4. attachment resume — resolve the real address from the preview iframe, download, verify the `%PDF` header, name by `<序号>_<姓名>.pdf` with an id suffix on collision, never overwrite;
5. thanks — only after a resume actually arrives.

Update the four tracking columns (已发送 / 已收藏 / 已收简历 / 已回复) as each step completes, not at the end from memory.

**Exit**: every written-to candidate has a confirmed acceptance signal, and the resumes received equal the rows with a real 已收简历 value.

---

## Phase 5 — Deliverables

Produce exactly four artifacts.

| Artifact | Requirement |
| --- | --- |
| `输出/最终筛选名单_<岗位>.xlsx` | columns: 序号 (by descending total), 姓名 + **会话id** (ids mandatory), 年龄, 学历, 年限, 当前公司, 当前岗位, 期望城市, 期望薪资, D1–D8 (one column each), 否定项扣分, 总分, 分级, 评分口径 (one line per candidate), the four tracking columns, 备注 (manual-review flags such as 履历矛盾) |
| `输出/人才画像与筛选标准_<岗位>.docx` | the only prose material: 人才画像 (what the position really needs, not a JD copy), the G1–G6 values actually used, the scoring rules, and the **面试验证清单** (what screening could not falsify) |
| `输出/在线简历汇编报告.pdf` | one page per candidate: score summary (`D1–D8` + total + tier) beside that candidate's own resume screens, in list order |
| `输出/简历PDF/` | the received attachments as `<序号>_<姓名>.pdf`, matching the list ranks one to one |

Before generating the spreadsheet, confirm it is not open in a spreadsheet application; if it is locked, report that explicitly and write a versioned copy instead of failing silently.

**Exit**: four artifacts present (or an explicit written gap note), **0** process files in the delivery directory, and the id list reconciles with the resume files.

---

## Phase 6 — Close

1. Clear page leftovers.
2. Archive the working directory so the next run starts clean.
3. Run the consistency audit over the work list and confirm: deliverables complete, evidence coverage 100%, identity mismatches 0, tracking columns consistent with the actual conversations.
4. Handle candidate data per the operator's compliance rules — the deliverable directory and the working directory both hold sensitive personal data, and neither belongs in version control.

---

## Domain failure map

| Observation | Where to look |
| --- | --- |
| List yields far fewer rows than the pool | `../references/platform-notes.md` §7 — rendered-window bound, use the search path |
| Captured resume is a ~300×150 blank | `../references/platform-notes.md` §8 — front window versus throttling; stop the round if throttled |
| Captured content stops at 「… 查看全部」 | `../references/platform-notes.md` §2 |
| A narrow stray text column appears mid-page | `../references/platform-notes.md` §3 — stacked popups |
| Interface returns the environment error code | `../references/platform-notes.md` §8 — check the environment, cool down, retry small |
| Attachment button disabled | `../references/outreach-and-collection.md` §6.4 — usually no attachment, not a fault |
| Downloaded file is not a PDF | `../references/outreach-and-collection.md` §6.2 |
| A dimension scored with no quote | `../references/screening-rubric.md` §2.6 — the score is void; re-derive or set 0 |
| AI/RAG experience moved the ranking | `../references/screening-rubric.md` §2.3 |
