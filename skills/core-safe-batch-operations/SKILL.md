---
name: core-safe-batch-operations
description: "Use this skill when an agent must act on many entities in a live application and the actions are hard to undo — 批量给一批人发消息、批量改状态、逐个核对是否真的生效、怕认错人发错对象、重跑一遍不能重复发送、要给用户一份可审计的逐条结果。It owns identity confirmation before acting, verification of the effect after acting, idempotency across reruns, and the audit trail. Paired with core-gated-web-automation and exactly one domain skill. Not for read-only single-page inspection."
version: 0.1.0
disable-model-invocation: true
user-invocable: false
---

# Core — Safe Batch Operations

## Overview

Make irreversible actions on many entities **provably correct**: never act on the wrong entity, never report an action that did not take effect, and never duplicate work when a run is repeated.

## When to Use

- The run performs **writes** (messages, status changes, deletions, submissions) on more than one entity.
- Entities are identified by a human-visible label that may repeat.
- The user will re-run the batch, or the batch may be interrupted mid-way.
- The user needs a per-entity result they can audit.

## When NOT to Use

- Pure reading with no state change (identity rules still apply, but verification gates do not).
- A single action the user can confirm by eye in seconds.

## Execution Protocol (read first, applies to every phase)

1. **Sequential Lock** — Postconditions of a phase gate the next phase. Identity is confirmed *before* any write; effects are verified *before* any status is reported.
2. **State Echo** — print `[Phase N] <name> — preconditions: PASS/FAIL` before acting.
3. **No Silent Skips** — every skipped entity is recorded with a reason; silently dropping entities is a defect.
4. **No Fabrication** — a result may be reported only from an observation made in this run. "It should have worked" is not a result.

## Files — Load On Demand

| File | When to load |
| --- | --- |
| `{SKILL_ROOT}/references/identity-verification.md` | **MUST load** before the first write, and before retrying any entity |
| `{SKILL_ROOT}/references/effect-verification.md` | **MUST load** whenever reporting the outcome of a write |
| `{SKILL_ROOT}/references/idempotent-runner.md` | **MUST load** before designing the batch loop |
| `{SKILL_ROOT}/references/audit-and-evidence.md` | Load when the user asks for proof, or when reviewing someone else's run |
| `{SKILL_ROOT}/scripts/batch-ledger.mjs` | Run to summarise and validate a run ledger (execute it; do not read it into context) |

## Workflow

### Phase A — Contract before action
Write the batch contract to a file and get one explicit confirmation: the entity list with stable identifiers, the exact action per entity, and what counts as done. **Do not act before this exists.**
**Postconditions**: contract file exists; every entity has a stable identifier or is marked "identifier missing".

### Phase B — Identity gate (per entity)
Open the entity, read its attributes, and compare against the contract's expectation. On mismatch: skip, record the mismatch, and try the next candidate index if the identifier was absent.
**Postconditions**: an explicit `match | mismatch | unknown` per entity, with the attributes actually observed.

### Phase C — Pre-check for idempotency
Determine whether the effect already exists **before** performing it. If it does, mark `already-done` and move on.
**Postconditions**: no entity reaches the write step without a recorded pre-check result.

### Phase D — Act, then verify
Perform exactly one action, then observe the resulting state until the effect is visible (bounded polling). Record the observation, not the click.
**Postconditions**: every entity carries `verified | unverified | failed` with the raw evidence that decided it.

### Phase E — Reconcile
Re-open or re-read the entities that ended `unverified` or `failed`, and classify them as `done-on-recheck` or `needs-human`. Never leave an entity in an unknown state without saying so.
**Postconditions**: the counts of the three terminal states equal the entity count.

## Hard Gates (any failure → stop and fix before continuing)

1. **Zero** writes performed on an entity whose identity was not confirmed in this run.
2. Every reported success has an **effect observation**; `verified` count must equal the number of success claims.
3. Every entity appears in the ledger exactly once per phase, with a terminal status. Missing entities = defect.
4. `unverified + failed` must be **0** before reporting the batch as complete — otherwise report them explicitly as outstanding.
5. Re-running an identical batch must produce **0 new actions** (all `already-done`).

## Convergence

- At most **2** verification attempts per entity; then mark `needs-human` and continue the batch.
- Ignore sub-second timing noise; do not re-verify an entity that already produced a positive observation.
- Stop the whole batch after **3 consecutive** identity mismatches: that pattern means the identifier source is wrong, not that the entities are wrong.

## Forbidden Patterns

- Targeting by display name when a stable identifier exists.
- Treating a click that returned without error as a completed action.
- Reporting `sent` / `done` from a boolean returned by the UI call.
- Retrying a write whose effect was never checked.
- Touching a binary toggle without reading its current state.
- Dropping entities that failed to open, instead of recording them.
- Resuming a batch without re-reading the ledger.
