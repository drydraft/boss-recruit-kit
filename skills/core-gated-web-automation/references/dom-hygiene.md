# DOM hygiene: overlays, modals and toggles

## The stacked-modal phantom

**Symptom**: a narrow strip of the page's own content appears to float over the UI, with a close affordance. It looks like a browser artefact or an "AI added panel". It is neither.

**Cause**: the app keeps **multiple modal instances** alive. Opening the modal again while a previous instance still exists creates a second instance. The new one is often laid out off-screen or at a reduced width, so its inner content (a canvas, a long document) reflows into a narrow column and paints over the live view.

Two details that mislead diagnosis:

- The inner element's inline height can be enormous (the full document height, e.g. `9624px`). That is **the app's normal sizing**, not leftover debug styling.
- The phantom is *not* in the interactive DOM path, so point-probing at its coordinates may still report the real element underneath.

**Rule**: before opening a modal and after closing it, run an overlay sweep that removes instances whose bounds are off-screen or absurdly tall, regardless of whether they are "the last one".

Implementation notes that matter:

- Sweep by bounds (`top < -80` or `height > 2×viewport` or `display:none`), not by index — the phantom is frequently the *last* wrapper.
- Do the sweep **after** the close call and **before** the next open call; a sweep only at teardown will let instances accumulate during a long run.
- After a sweep, re-assert the expected modal count (0 when idle, 1 when open).

## Binary UI state (favourites, follows, likes, pins)

These controls are toggles with **no confirmation**. Clicking an already-on control turns it off.

Rule: **read state → decide → click only if a change is needed → re-read to confirm**. A control whose label is ambiguous (both "on" and "off" strings present in the same container) is treated as **unknown** and skipped, with the ambiguity reported.

## Confirm dialogs

Actions that show a second confirmation step are **not complete** until the resulting state message exists. Treat the intermediate "are you sure" panel as a checkpoint:

1. activate the action;
2. assert the confirm panel appeared (its text identifies the action);
3. activate confirm;
4. assert the resulting **system message or state change**.

If step 4 cannot be observed, the action is unverified — never report success.

## Cleanup checklist (run at the end of every session)

1. Close any open modal; sweep overlays; assert count 0.
2. Clear the transient UI the run created (expanded sections, search boxes left filled, filter chips) so the next run starts clean.
3. Leave the browser open or closed exactly as the user asked — do not close a window the user was using.
4. Confirm no run-specific element remains in the page (sweep again after the last close).
