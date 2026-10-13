# The no-CDP channel

## Why not CDP

Sites that ship devtools detection respond to a debug port with **punishment, not blocking**: they close the page, blank the DOM, and report a risk event. The observed sequence on such sites is: debug port opens → detection fires within seconds → the page calls `window.open('','_self')` and `window.close()`, empties `document.body`, and posts an event to the site's logging endpoint.

Consequences that matter more than the closed tab:

- A run that had already performed writes cannot tell **which writes landed**.
- Re-opening the page looks like "the site is broken", which pushes agents into redesigning the wrong layer.

**Rule**: when devtools detection is present, the transport is an **injected extension plus a local bridge** — never CDP.

## Channel anatomy

```
agent / CLI / MCP tool
        │  HTTP (localhost control plane)
        ▼
   local bridge  ──WS──▶  extension service worker  ──▶  content script in the page
        │                                                  (DOM + canvas, real user input)
        └── command queue, per-command timeout, result relay
```

| Layer | Owns | Never owns |
| --- | --- | --- |
| Content script | Reading the DOM, canvas, dispatching real input events | Business rules, retry policy |
| Service worker | Routing commands to the right tab, keepalive | Selector knowledge |
| Bridge | Command queue, timeouts, one-client discipline, logging | Page knowledge |
| Agent | Decisions, identity confirmation, verification | Direct page access |

## Launch flags

Required:

- `--user-data-dir=<dedicated profile>` — preserves login across restarts; keep it out of version control.
- `--load-extension=<absolute path>` and `--disable-extensions-except=<same path>` — isolates the automation extension from the user's own extensions.

Forbidden (each is a detection or instability source):

- `--remote-debugging-port`, `--remote-debugging-pipe`, `--auto-open-devtools-for-tabs`
- `--headless`, `--headless=new` (fingerprinted; also breaks canvas painting in some builds)
- Realistic-looking but wrong UA/`--user-agent` spoofs — they mismatch the runtime and are themselves a fingerprint.

## Keepalive and connection hygiene

- MV3 service workers sleep. Send a trivial runtime call every **15 s** to keep the worker alive for the duration of a run.
- The bridge must treat connections as **owned by one client**: a stale socket that never replies will consume commands. On every reconnect, drop clients that fail a liveness probe.
- Symptom of zombie clients: commands time out while a manual page action still works, and the client count keeps climbing. Fix: restart the bridge, verify `clients=1`.

## Payload ceiling

The relay path (worker → bridge → agent) degrades on large frames. Observed behaviour: responses above roughly **64 KB** stop arriving while small commands keep answering instantly — the page is fine, the channel is not.

Mitigations, in order of preference:

1. **Chunk the payload** at the source (tile a canvas, page a list) to ≤64 KB per response.
2. Reduce quality/size at capture time (JPEG instead of PNG for photographic canvas content).
3. Only if neither is possible, stream to disk inside the page and return a path.

## After changing extension code

The browser caches extension scripts. Always: stop the browser → clear `Service Worker`, `Code Cache`, `GPUCache` under the profile → relaunch with the same flags. Skipping this yields "my fix did nothing" with no error.

## Fallback when the bridge is unavailable

If the bridge cannot be started, do **not** silently switch to CDP. Options, in order: report the blocker; run the same steps through the extension's own UI; or reduce the task to a single manual action by the user.
