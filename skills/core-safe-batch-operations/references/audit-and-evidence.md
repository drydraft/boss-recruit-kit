# Audit and evidence

## Purpose

An audit answers one question per entity: **"was the intended action applied to the right entity, and how do we know?"** The answer must be re-derivable from artifacts, not from the agent's recollection.

## The audit pass

Re-read the application for every entity in the contract and classify independently of the original run:

| Classification | Definition |
| --- | --- |
| `confirmed` | Identity fingerprint matches **and** the effect is currently observable |
| `identity-mismatch` | The identifier resolves to an entity whose fingerprint differs from the contract |
| `effect-absent` | Identity matches but the effect is not observable |
| `unreachable` | The entity could not be opened (removed, renamed, blocked) |

**Rule**: an audit never writes. If it finds `effect-absent`, the remedy is proposed to the user, not applied silently.

## Evidence chain

Keep three layers, each independently openable:

1. **Ledger** — one line per entity per attempt (see `idempotent-runner.md`). Cheap, greppable, and the basis of all counts.
2. **Raw observations** — for canvas apps, the captured tiles per entity; for DOM apps, the matched text. Named so the entity is recoverable from the filename.
3. **Summary** — counts per terminal status plus the list of entities that need a human.

A claim in the summary must be traceable to layer 1, and every layer-1 success claim must be traceable to a layer-2 observation.

## Reporting numbers that survive scrutiny

- Report **denominators**: "28 of 30 verified" is auditable; "verified" is not.
- Separate **performed** from **effective**: `attempted = verified + unverified + failed`.
- Never round a partial batch up to complete. State the outstanding entities by identifier.
- When a re-run changes a count, present both runs and the reconciliation, rather than silently replacing the number.

## Evidence hygiene

- Candidate/customer data is sensitive: keep artifacts local, and never commit them. Exclude the capture directory and ledger from version control by default.
- Log identifiers, not personal content, where possible; when content must be stored, store it under the run directory, not in the repository.
- Strip secrets (session cookies, tokens, one-time URLs) from anything retained.
- Keep the run directory named by date + purpose so a later audit can find it without the agent's help.

## Common audit findings and what they mean

| Finding | Usually means |
| --- | --- |
| Many `identity-mismatch` in one run | The identifier source was wrong (name-based targeting) |
| Many `effect-absent` after "successful" writes | Success was reported from click returns |
| Duplicate actions on some entities | Missing pre-check or retry after an unverified write |
| Entities missing from the ledger | The loop dropped failures instead of recording them |
| Counts that do not add up | Summary computed from a different source than the ledger |
