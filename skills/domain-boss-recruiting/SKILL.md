---
name: domain-boss-recruiting
description: "This skill should be used when the task is candidate screening, outreach, or resume collection inside the operator's own Boss 直聘 (zhipin.com) 招聘账号 — for example 帮我筛一下这批候选人、按我的标准给这些人打分、批量看在线简历、给候选人发开场话术、求简历、收藏候选人、把简历下载下来、出一份初筛名单和人才画像. Owns the Boss-specific screening rubric, outreach wording, deliverable contract, and platform phenomena only; carries no general browser-automation mechanism. Not for other job boards, not for resume files already on local disk, and not for any account the operator does not own."
version: 0.1.0
disable-model-invocation: true
user-invocable: false
---

# Boss 直聘 Candidate Screening — Domain Layer

## Overview

Act as a Boss-直聘 screening specialist: qualify a candidate pool in two stages, speak in this platform's outreach register, and hand back one fixed four-file deliverable. This skill decides **who qualifies and what gets said**; it never decides **how to act on a page**.

## When to Use / When NOT to Use

Use when the task touches the operator's own Boss 直聘 recruiting account and any of these appear:

- 「帮我筛一下这批候选人」/「按我的标准给这些人打分」/「这批人谁值得约面」
- 「批量看在线简历」/「把这些人的简历抓下来」/「下载候选人的附件简历」
- 「给候选人发个开场白」/「求一下简历」/「帮我收藏这几个」
- 「出一份初筛名单」/「写一份人才画像和筛选标准」
- Any request to decide eligibility, message wording, tier assignment, or deliverable shape.

Do NOT load for:

- Any other job board, or any site the operator's account does not own → no shipped domain layer; derive one from the operator's own rules.
- Resume files already on local disk → read them locally; starting a browser costs more than it saves.
- Judgements the operator has not delegated (final hiring decisions, offer terms).
- Channel, extraction, navigation, DOM hygiene, throttling, identity, idempotency → owned by the two core skills.

## Execution Protocol (read first)

1. **Sequential Lock** — load `core-gated-web-automation` and `core-safe-batch-operations` before this skill's references; confirm both loads actually went out.
2. **State Echo** — open every phase with one line: `[Phase N] <name> — preconditions: PASS/FAIL`.
3. **No Silent Skips** — every skipped candidate, dimension, or phase states its reason in the run record.
4. **No Fabrication** — never produce a score, a quote, a candidate field, or a selector from memory; read it from a reference file or observe it.

## Files — Load On Demand

| File | When to load |
| --- | --- |
| `{SKILL_ROOT}/references/screening-rubric.md` | ⛔ HARD RULE — MUST load before scoring any candidate, at either stage. Sole authority for the gates, dimension weights, deductions, tiers, and the evidence rule |
| `{SKILL_ROOT}/references/outreach-and-collection.md` | MUST load before the first write to a candidate: opener, resume request, favourite, attachment download, thanks |
| `{SKILL_ROOT}/references/platform-notes.md` | MUST load when a capture looks empty, short, or wrong, or when locating a control on the page |
| `{SKILL_ROOT}/workflows/screening-run.md` | MUST load when running the task end to end, from cold start to the four deliverables |
| `core-gated-web-automation`, `core-safe-batch-operations` | MUST load for any task that touches a live page or performs a write; absolute paths arrive with the injection. Generic mechanism is never restated in this skill |

## Workflow

```
[Phase 0] Preflight   — channel, login and window state PASS before any candidate read
[Phase 1] Smoke       — 3–5 candidates end to end; proves the pipeline, not the rubric
[Phase 2] Stage 1     — list-level gates; pass/reject + restatable reason + verbatim quote
[Phase 3] Stage 2     — stage-1 passers only: resume capture -> dimension scores -> deductions -> tier
[Phase 4] Outreach    — tiers S/A first, B on request: opener -> resume request -> favourite -> attachment -> thanks
[Phase 5] Deliver     — four artifacts; process files stay outside the delivery directory
[Phase 6] Close       — consistency audit, then sensitive-data handling
```

Step detail → `{SKILL_ROOT}/workflows/screening-run.md`. Rubric → `{SKILL_ROOT}/references/screening-rubric.md`.

## Hard Gates (any failure → rework)

1. Dimension rows carrying a score but **no** verbatim candidate quote: **0**. A dimension without a quote scores 0 and is logged `no-evidence`.
2. Stage-1 rejections with **no** restatable reason: **0**.
3. Points awarded for AI / RAG / Agent **nouns**: **0**.
4. Quotes reused as primary support for a second dimension without written justification: **0**.
5. Stage-2 candidates that never passed stage 1: **0**, unless the row is an explicit manual-review entry.
6. Deliverables present: **4**, or fewer with a written gap note. Process files inside the delivery directory: **0**.
7. Outreach rows outside tiers S/A: **0** without a written reason.
8. Openers asking for arrival date or pushing on salary: **0**.

## Convergence

- Repair a candidate at most **2** times per stage; after the second pass score the dimension 0 and mark `no-evidence` instead of re-reading.
- Ignore total-score drift of **≤ 2** points on a re-score; never re-open a resume for it — re-opening is the expensive, throttled action.
- Stop scoring and ask one compact question about the rubric once the same disagreement appears in **≥ 3** rows, instead of guessing per row.
- Retry a front-window capture **1** time, then report the observed signal; abandon the session after **3** consecutive empty captures rather than retrying.
- Stop at the tier boundary when two rows are separated by **≤ 2** points: report both with their evidence and let the operator order them.

## Forbidden Patterns

- Crediting a framework name (RAG, Agent, 大模型) in place of a delivered business system.
- Putting a paraphrase, a summary, or an inference into an evidence field — only the candidate's own words.
- Targeting a candidate by display name, or by a placeholder nickname such as 「先生」/「女士」/「求职者」.
- Rejecting on general impression instead of a numbered gate.
- Declaring 「无附件简历」 before the open panel's identity matches the target row.
- Asking arrival date, or negotiating salary, in the opener.
- Letting an AI-written abstract replace the candidate's own resume screens in the compiled report.
- Leaving chunk images, list JSON, snapshots, or score drafts inside the delivery directory.
