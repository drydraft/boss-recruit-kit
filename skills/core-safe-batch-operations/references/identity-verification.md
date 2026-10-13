# Identity verification

## The failure this prevents

Two entities in the same list can carry the same human label. Observed in a live pool of ~700 entities: five separate duplicate labels, including a pair whose display name was a generic word. Acting on the first search hit sends real messages to the wrong person.

**Rule**: a display label is a *hint for finding*, never a *key for acting*.

## Two-level identity

| Level | Source | Use |
| --- | --- | --- |
| **Key** | A machine identifier on the row element (`data-id`, `uid`, `data-testid`) | Every lookup, every retry, every log line |
| **Fingerprint** | ≥ 3 stable attributes rendered for that entity (e.g. name + age + education + years + current employer/role) | Confirmation that the opened view is really that entity |

Both are required. The key finds the entity; the fingerprint proves the view switched.

## Confirmation procedure (per entity, before any write)

1. Resolve the key. If the list row is unreachable (virtualised list), fall back to search and keep the **match index**.
2. Activate the entity.
3. **Poll until the view reports the expected label** (bounded, ~15 s). A fixed sleep is not a substitute: the classic bug is reading the previous entity's data.
4. Read the fingerprint attributes from the now-current view.
5. Compare against the contract expectation, field by field. Normalise before comparing (strip whitespace, punctuation, and corporate suffixes that differ between records).
6. Decide: `match` → proceed; `mismatch` → do not act, record what was actually opened; `unknown` (fewer than 3 comparable fields) → do not act.

## Duplicate labels

On a name collision, some duplicates are **the same person with two records** (same age, same education, same employer differing by a suffix) and some are **different people**. Decide with the fingerprint, not with the label:

- All comparable attributes equal → treat as the same person; act on the record named in the contract, and note the duplicate.
- Any attribute differs → different people; act only on the one whose fingerprint matches.

Cap the index walk at 3 candidates. Beyond that, report the ambiguity to the user instead of guessing.

## What to record

For every entity, log: the requested identifier, the label requested, **the fingerprint actually observed**, the decision, and the resolution path used (`id` | `search#n`). This is what makes an audit possible after the fact — and it is the only way to answer "did you message the right person?".

## Anti-patterns

- Acting on the first search hit without opening it.
- Confirming with a single field (name only).
- Comparing fingerprints against values the agent typed from memory rather than values stored in the contract.
- Treating a mismatch as "the site glitched" and retrying the same way.
