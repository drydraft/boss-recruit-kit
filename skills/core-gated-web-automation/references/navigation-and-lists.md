# Navigation, lists and entity targeting

## Virtualised lists

Observation to expect: the list renders a fixed window of rows (commonly 30–50) and **stops growing** when the container's `scrollTop` is set programmatically. Wheel/keyboard gestures may advance it, programmatic jumps usually do not.

Consequences and rules:

- **Do not** build a "walk the whole list" routine on programmatic scrolling. It will silently return a truncated slice.
- Prefer **search-first navigation**: type the identifier/name into the list's search box, then activate the suggestion entry.
- Where a list must be paged, drive it with real wheel events over the container, and treat "row count unchanged after a scroll attempt" as end-of-data — never as an error to retry.

## Identity in rows

Each row usually carries a stable machine identifier (`data-id`, `data-uid`, `data-testid`). Rules:

1. Read the identifier from the row element itself; never construct it.
2. Store `{id, displayName, secondaryAttributes}` as the run-time handle.
3. Use the identifier for every subsequent lookup. Display names are for humans, not for targeting: the same string can map to several distinct rows, and some accounts deliberately use non-unique display names.
4. Re-read the identifier after any page reload; do not assume stability across sessions.

## Ambiguous matches

When a search returns more than one candidate row:

- Enumerate the matches with an index (`0..n-1`) instead of taking the first.
- Confirm identity **after** opening (see `core-safe-batch-operations/references/identity-verification.md`); on mismatch, return and try the next index.
- Cap the attempts (3 is enough in practice) and report the ambiguity instead of looping.

## Snapshot staleness

Opening a row is asynchronous. Fixed sleeps produce the classic bug: the agent reads the **previous** entity's data and acts on it.

Rule: after requesting a switch, **poll until the view reports the expected entity**, then read. A useful poll predicate is "the pane's own label equals the requested label" with a ~15 s ceiling; a timeout is a failure, not a reason to proceed.

## Session shape

- Keep the tab on the list view between entities; deep-linking per entity is slower and re-triggers page-load detection.
- Return to the list after finishing an entity so the next open starts from a known state.
- If the site keeps a read/unread marker, do not rely on it for progress; keep your own ledger.

## Rate and volume

Cost per entity on a virtualised list is dominated by the open-switch-read cycle, not by transfer. Budget ~15–20 s per entity for a read-only pass, more when a modal must load a canvas. Use that budget to size batches before promising a completion time.
