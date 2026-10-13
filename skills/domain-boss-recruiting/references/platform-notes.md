# Platform notes — Boss 直聘 (zhipin.com)

> Read this file when a capture looks empty, short, or wrong, or when a control must be located. Everything here is a **platform-specific observable** of the Boss 直聘 recruiting workspace. Channel policy, chunking, verification, and DOM hygiene are owned by `core-gated-web-automation`; this file only supplies the facts that are true of *this* site and not of another.

---

## 1. Where the online resume actually lives

| Observable | Consequence |
| --- | --- |
| The resume body is rendered by WASM into a `<canvas>`; the pane's `innerText` is empty and text selection yields nothing | Do not look for DOM text, and do not trust an empty `innerText` as "resume failed to load" |
| The resume is served inside a **same-origin** iframe (path shape `/web/frame/c-resume/`) | The frame's content document is directly readable; the canvas must be found *inside that frame*, not in the top document |
| The whole resume renders onto **one** canvas whose height equals the resume length | Read it as one tall image, sliced by height; not as one canvas per screen |
| Canvas **internal pixel size** and **CSS display size** differ | Export at internal size, otherwise the image is soft |
| An unrendered canvas sits at the initial placeholder size **300×150** | Treat a canvas under roughly 600×300 as unrendered, never as a real resume |

A capture whose width/height is around 300×150 is the platform's "nothing rendered yet" state, not a small resume. Never score from it.

## 2. Collapsed content on the resume canvas

- Long sections collapse behind a 「… 查看全部」 control that is **painted into the canvas**, not a DOM element.
- It is drawn in the theme cyan `rgb(16, 160, 160)` as a **wide, flat, low-height** block — that colour plus that shape is the locating rule.
- It can only be activated by **coordinates inside the resume frame**, and it needs a full pointer+mouse event sequence (over → down → up → click). A bare `click`, or `mousedown` alone, is frequently ignored.
- Capture **after** the redraw settles, not immediately; each activation may raise a popup that must be dismissed before continuing.
- ⛔ HARD RULE — never press the resume popup's own close control to clear those popups: that closes the entire resume and the capture must be redone.

## 3. Stacked popups and the ghost narrow column

| Symptom | Cause |
| --- | --- |
| A narrow (~300–650 px) column of Chinese text appears mid-page — reads like a stray panel or a broken layout | A **second** resume popup instance exists because the previous one was not fully closed before the next open. The resume reflows into the narrower frame; it is not corrupt text and nothing was "added by the AI" |

- Live popups are those matching `.boss-popup__wrapper:not(.deactive)`.
- A resume iframe whose inline `height` is stretched to the full resume height (e.g. `3246px`, `9624px`) is **the site's own behaviour**, not leftover styling and not a defect to repair.
- Pass once before opening a resume and once after closing it, removing off-screen, over-tall, and hidden popup instances.
- Do not press Esc repeatedly to close layers; that usually removes only the topmost one.

## 4. Conversation panel fields used by the rubric

| Field | Where it is read |
| --- | --- |
| Row in the candidate list | `.geek-item`, display name in `.geek-name` |
| Candidate list container | `.user-list` (also `.chat-user-list`) |
| Panel display name | `.conversation-box .base-name .name-box`, falling back to `.conversation-box .base-name` |
| Panel identity block | `.base-info-single-container`; last-active text in `.active-time` |
| Current company and role | `.position-content .job-content .position-name` |
| Expectation (city / salary) | `.position-content .position-item.expect .value` |
| Timeline entries | `.experience-content.time-list .time-content li`, text in `.time`; an `.icon.shool` child marks an education entry |
| Work-history entries | `.experience-content.detail-list .work-content li`, value in `.value` |

The greeting thread lives in the message list, not in the panel header — collect **all** turns before applying the gates (see `screening-rubric.md` §1.1).

## 5. Message list and send controls

| Item | Selector |
| --- | --- |
| Candidate message | `.item-friend .text-content` |
| Operator message | `.item-myself .text-content`, with `.item-boss` / `.item-me` as fallbacks |
| System card title (e.g. 「简历请求已发送」) | `.message-card-top-title` |
| Message timestamp | `.message-time .time` |
| Composer | `.boss-chat-editor-input`, falling back to `[contenteditable="true"]` |

**Send fallback order** when the composer keeps its text: click `.submit` → click `.submit-content` (the outer wrapper) → dispatch Enter → click `.submit` once more. Then re-check the composer and the conversation; a click that "succeeded" while the conversation stayed unchanged is the most common false success. Clear leftover overlays before retrying — they are the usual cause of a blocked submit.

## 6. Attachment resume viewer

- Toolbar buttons: `.resume-btn-online` (online resume) and `.resume-btn-file` / `.btn.resume-btn-file` (attachment resume).
- Clicking the attachment button opens a **preview dialog**, not a download. The dialog contains an iframe matching `iframe[src*="pdf-viewer"]`, with a source shaped like:

  ```
  /bzl-office/pdf-viewer-b?url=/wflow/zpgeek/download/preview4boss/...
  ```

- The real address is the URL-decoded `url` query parameter; when it is a path rather than an absolute URL, prefix the current origin. A `geekId` parameter is also present in the source and is useful for cross-checking which candidate the viewer belongs to.
- The browser download API needs the extension's `downloads` permission to be declared; verify the `%PDF` header afterwards (see `outreach-and-collection.md` §6).

## 7. Navigation and list behaviour

| Observable | Consequence |
| --- | --- |
| The candidate list renders only about **40 rows**, and setting `scrollTop` programmatically loads no more | Scroll-based paging is not a viable way to reach the whole pool |
| Typing into the search box does **not** filter the list | The input is not a filter; do not expect the list to shrink |
| The search **dropdown suggestions** do work and open candidates normally | Preferred path: search suggestion → open → confirm identity against the target record |
| Opening by conversation id cannot always find a row | Fall back to the search path automatically; never abort the run because a row was not in the rendered window |
| Several suggestions can share one display name | Keep an index for same-name suggestions and try them in order until the identity matches |

Search controls: `.chat-search-btn` and `.search-input`.

## 8. Signals this platform raises

| Signal | Reading | Response |
| --- | --- | --- |
| Canvas frozen at ~300×150 while a **manual** open of the same resume renders fine | The window is backgrounded or the tab is not active; rendering is throttled | Bring the window forward and the tab active, then capture again |
| Canvas frozen at ~300×150 while a **manual** open also renders nothing, and a browser restart does not help | Short-window throttling: this site lowers the rendering priority of this one feature while everything else stays normal | Stop the round, cool down 30–60 min, then resume |
| Operations slow down, timeouts multiply | Approaching the throttle | Widen the interval, or cool down early |
| Interface returns `{"code":37,"message":"您的环境存在异常."}` | Server-side environment gate | Confirm no debug port, no headless, no out-of-region proxy; cool down and retry at small scale |
| Risk cookies shaped `__zp_stoken__` / `__zp_sseed__` / `__zp_sname__` / `__zp_sts__`, plus a `BstCookie` probing the client runtime | This site asserts environment trust server-side | ⛔ HARD RULE — never forge, replay, or reverse these values; use the real logged-in session and ordinary browser behaviour |

Restarting the browser or repeatedly reopening a throttled resume **extends** the cool-down. Treat the frozen canvas as "stop for today", not as a bug to fight.

## 9. Out of scope for this file

- Chunked capture of large responses, response-size limits, and stitching → `core-gated-web-automation`.
- Identity verification, write evidence, idempotency, and batch pacing policy → `core-safe-batch-operations`.
- Scoring gates, dimension weights, tiers, and message wording → `screening-rubric.md` and `outreach-and-collection.md`.
