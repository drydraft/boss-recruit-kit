# Effect verification

## Why clicks are not evidence

A UI call returning `ok` means "the event was dispatched". Sampled in practice, the same call silently did nothing in a meaningful fraction of attempts — the text stayed in the input box, the toggle did not change, the dialog never appeared. Reporting those as success produced a ledger that disagreed with the application.

**Rule**: an action is complete only when its **effect is observable**.

## Effect classes and their observation

| Action | Observable effect | Bounded search |
| --- | --- | --- |
| Send a message | The message appears in the conversation transcript, attributed to the user | re-read transcript, ≤5 polls, ~1.2 s apart |
| Submit a request (two-step dialog) | A **system message** or state change specific to that request | re-read transcript |
| Toggle a state (favourite / follow / pin) | The control's own state flips to the expected value | re-read control state |
| Change a record field | The field shows the new value on a fresh read | re-open or refresh the record |
| Trigger a download | A file exists with non-zero bytes and the expected type | check the destination, not the click |

## Rules

1. **Two conditions, not one.** For text actions require both "the input cleared" and "the text appears in the transcript". Either alone has produced false positives.
2. **Poll, do not sleep once.** Effects land asynchronously; a single fixed wait plus one read gives false negatives that then trigger duplicate sends.
3. **Bound the polling.** On timeout, classify as `unverified` — never as success, and never as failure either.
4. **Verify before retrying.** A retry without verification duplicates the action when the first attempt actually succeeded.
5. **Record the raw observation**, not a summary. Store the matched text (or the state value) so an auditor can compare.

## Unverified is a real outcome

Keep three terminal states and never collapse them:

- `verified` — the effect was observed.
- `unverified` — the action may or may not have landed.
- `failed` — the action was not performed (a precondition failed, or an explicit error was returned).

`unverified` requires a **reconciliation pass**: re-open the entity and re-read. On a second run, many `unverified` entities resolve into `done-on-recheck`; the rest go to the user as `needs-human` with the raw evidence.

## Signals that the channel (not the action) failed

- The command timed out, but a manual check shows the action landed → channel problem; reconcile rather than resend.
- Several entities in a row return unverified while a manual action works → suspect payload size or a stale connection, not the site.
- Verification succeeds for reads but never for writes → suspect the write path (input handling), not the verification logic.
