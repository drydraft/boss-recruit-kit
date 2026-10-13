# The idempotent runner

## Contract

Running the same batch twice must produce **zero** new actions. Interrupting a run and restarting it must resume, not repeat.

## Design

```
load contract (entities + intended action)
load ledger (what already happened)
for each entity not terminal in ledger:
    open by key
    identity gate        → mismatch/unknown: record, skip
    pre-check effect     → already present: mark already-done, skip
    act once
    verify effect        → verified | unverified
    append ledger record (fsync before next entity)
reconcile unverified / failed
print summary (counts must add up to the contract size)
```

Four properties make this work:

1. **The effect, not the log, is the source of truth.** The pre-check reads the application; the ledger only saves time and explains history.
2. **Append-only ledger.** One JSON line per entity per attempt, written and flushed immediately. A crash then loses at most the in-flight entity.
3. **Terminal statuses only.** An entity leaves the loop with `verified`, `already-done`, `mismatch`, `needs-human`, or `failed`. "In progress" is not persisted.
4. **Deterministic order.** Iterate the contract order, so a resume pass is comparable with the previous run.

## Ledger record (minimum fields)

| Field | Why |
| --- | --- |
| `key` | Stable identifier; the join key for every later analysis |
| `label` | What the user asked for |
| `fingerprint` | What was actually opened (name + ≥2 attributes) |
| `resolution` | `id` or `search#n` — shows how the target was reached |
| `precheck` | `absent` / `already-present` |
| `action` | The exact action attempted, with payload hash or text |
| `effect` | `verified` / `unverified` / `failed` + the raw observation |
| `at` | Timestamp, for pacing evidence and audit |

## Resume rules

- Re-read the ledger at startup; do not trust an in-memory progress counter.
- An entity with `verified` or `already-done` is skipped.
- An entity with `unverified` is **re-opened and re-checked**, not re-sent.
- Never rewrite history: add a new record; the summary uses the latest record per key.

## Failure modes to expect

| Symptom | Cause | Handling |
| --- | --- | --- |
| Same action performed twice | Verification skipped or the pre-check removed | Add the pre-check back; reconcile by reading the entity |
| Ledger complete but the app disagrees | Success reported from click returns | Switch to effect verification |
| Resume misses entities | Contract changed between runs | Compare contract hash; refuse to resume on mismatch |
| Run stalls at one entity | An unhandled modal or an infinite poll | Bounded polling + `needs-human`, then continue |

## Interruption

On Ctrl-C or a crash: the last flushed record defines the resume point. Print it (`last key: ...`) so the user can restart with the same command and no ambiguity.
