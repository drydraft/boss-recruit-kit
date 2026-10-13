---
name: core-gated-web-automation
description: "Use this skill when driving a real, logged-in web application whose pages punish automation signals (devtools detection, headless fingerprints, virtualised lists) or whose content is rendered into a canvas — 需要登录的站点自动化、站点检测 devtools、无头浏览器被跳转、内容画在 canvas 里没有 DOM 文本、列表滚动不加载更多、弹层叠加出现幽灵浮层。It owns the transport channel, extraction, navigation and DOM hygiene. Paired with core-safe-batch-operations and exactly one domain skill. Not for public static pages and not for sites with a sufficient official API."
version: 0.1.0
disable-model-invocation: true
user-invocable: false
---

# Core — Gated Web Automation

## Overview

Make the agent able to operate a hostile-but-legitimate web application **without tripping its automation defences**: a real visible browser, an injected extension, a local command bridge, and extraction techniques that work when the DOM is empty.

## When to Use

- The target punishes devtools/CDP, headless mode, or machine-like input cadence.
- Content is painted into a canvas (WASM/WebGL/PDF viewer) with no readable DOM text.
- The list is virtualised and programmatic scrolling stops loading rows.
- The agent must read or click from outside the page (CLI, MCP tool, another agent).

## When NOT to Use

- Public static content — fetch it.
- An official API covers the task — call it.
- The site's terms forbid the intended action — stop and report.

## Execution Protocol (read first, applies to every phase)

1. **Sequential Lock** — a phase's Postconditions are the next phase's gate. Do not start the next phase while any Postcondition fails.
2. **State Echo** — print `[Phase N] <name> — preconditions: PASS/FAIL` before acting.
3. **No Silent Skips** — an intentionally skipped phase requires a stated reason.
4. **No Fabrication** — never state a selector, port, size, or site behaviour that was not read from a reference file or observed in this run.

## Files — Load On Demand

| File | When to load |
| --- | --- |
| `{SKILL_ROOT}/references/no-cdp-channel.md` | **MUST load** before launching any browser or writing any bridge code |
| `{SKILL_ROOT}/references/canvas-extraction.md` | **MUST load** whenever the target renders into a canvas |
| `{SKILL_ROOT}/references/navigation-and-lists.md` | **MUST load** whenever the target is a list/inbox of entities |
| `{SKILL_ROOT}/references/dom-hygiene.md` | Load before opening any modal, and again when an unexpected overlay appears |
| `{SKILL_ROOT}/references/pacing-and-abuse-control.md` | **MUST load** before the first write, and before any run longer than 10 minutes |
| `{SKILL_ROOT}/scripts/preflight.mjs` | Run at Phase 0 of every session (execute it; do not read it into context) |

## Workflow

### Phase 0 — Preflight
Run the preflight script. It checks, in order: bridge reachable → extension connected → browser process alive → target tab on the expected origin → window focused → main pane non-empty.
**Postconditions**: every check reports PASS. A failed check is diagnosed from `references/no-cdp-channel.md`, never worked around by guessing.

### Phase 1 — Channel bring-up
Launch a **visible** browser with the extension loaded and a dedicated profile; start the bridge; confirm the extension handshake. Read `references/no-cdp-channel.md` for the launch-flags whitelist and the forbidden-flag list.
**Postconditions**: handshake version echoed back; bridge reports exactly one client.

### Phase 2 — Target acquisition
Resolve the entity to act on. Prefer a stable identifier read from the row; fall back to search-plus-index. Read `references/navigation-and-lists.md`.
**Postconditions**: the identifier came from the DOM (not from the agent's memory), and the search fallback is available.

### Phase 3 — Observation / extraction
Read what the page shows. If the pane has no text, switch to canvas extraction (`references/canvas-extraction.md`).
**Postconditions**: at least one artifact (screenshot tiles or text) exists on disk with non-zero bytes, and its identity can be re-derived.

### Phase 4 — Action
Hand off to `core-safe-batch-operations` for identity confirmation, the write, and effect verification. This skill only guarantees the channel is healthy.
**Postconditions**: reported by the core skill's own gates.

### Phase 5 — Teardown and hygiene
Clear stacked overlays, close modals, return the tab to a neutral state, and leave the browser open or closed exactly as the user asked.
**Postconditions**: overlay count 0; no orphan modal in the DOM; run summary printed.

## Hard Gates (any failure → fix the cause before continuing)

1. Launch command contains **zero** debug-port flags (grep the exact command string for `remote-debugging`, `headless`, `--auto-open-devtools`).
2. Window focus is **true** at the moment of every canvas read and every click. A capture taken while unfocused is invalid evidence — discard it.
3. Canvas reads use **≥ 2** tiles per viewport, each response ≤ **64 KB**; a single whole-canvas export is a violation.
4. Overlay instances before opening a modal and after closing it are both **0**.
5. Entity list progress: row count must **increase** on a scroll attempt, otherwise abandon scrolling and switch to search.
6. Every capture artifact is **non-empty** and **re-openable**; empty or placeholder-sized captures (e.g. a canvas stuck at its default 300×150) count as failure.

## Convergence

- At most **2** retries per phase. On the third failure, stop and report the phase, the gate, and the raw observation.
- Ignore ≤1 s timing noise; do not re-polish a passing phase.
- After two consecutive PASS preflights, proceed without re-running preflight.

## Forbidden Patterns

- Launching with a debug port "just to watch what happens".
- Explaining a blank canvas as "the site blocked us" before checking window focus.
- Fixed sleeps standing in for polling a switched view.
- One-shot whole-canvas or whole-list capture.
- Synthetic `click()` without a real pointer sequence on canvas-drawn affordances.
- Treating a display name as an identity.
- Retrying a rate-limit response immediately instead of cooling down.
