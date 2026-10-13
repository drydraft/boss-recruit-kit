# Routing matrix and the automation-warranted test

## The automation-warranted test

Start a browser only when **all four** hold. Otherwise pick the cheaper route in the right-hand column.

| Condition | If false, do this instead |
| --- | --- |
| The content or action needs a **logged-in session** | Fetch the URL directly |
| The site exposes **no API** that covers the task | Use the API |
| The volume is **≥ 10 entities**, or the action must repeat on a schedule | Ask the user for the values, or do it once by hand |
| The user's own account owns the data being touched | Stop and report — do not automate |

## Anti-signal inventory (decide the channel before designing anything)

Observe these before choosing a transport. Each is evidence, not folklore.

| Signal you observe | What it implies | Channel to use |
| --- | --- | --- |
| Page closes itself / navigates to `about:blank` shortly after a debug port opens | Devtools/CDP detection with a punitive response | Extension + local bridge; **no** CDP |
| Requests carry a device/anti-bot token that changes per session | Server-side risk gate on client signals | Real logged-in browser; never forge the token |
| Same page behaves differently in headless mode | Headless fingerprinting | Visible window |
| A list renders ~40 rows and stops loading | Virtualised list | Search-first navigation |
| `innerText` of the main pane is empty while pixels are non-empty | Canvas/WebGL/PDF rendering | Canvas extraction |
| The user reports "a narrow floating panel appeared" after agent activity | Stacked overlay instances | DOM hygiene pass |

## Choosing the domain layer

- **Shipped domain exists** → load it, never re-derive it.
- **No shipped domain** → load the two core skills, then:
  1. extract the user's own acceptance rules (who/what qualifies, what the message says, what the deliverable is);
  2. write them to a **contract file** and get one explicit confirmation;
  3. only then act in batch;
  4. once the rules stabilise, promote them into a new `domain-<app>/` skill so the next run is cheap.

## Cost of the wrong route

| Wrong route | Typical consequence |
| --- | --- |
| CDP on a detecting site | Session killed mid-run; partial writes with no way to tell which landed |
| Headless on a fingerprinting site | Silent redirects; empty captures that look like "no data" |
| Name-based targeting in a batch | Writes applied to the wrong entity; unrecoverable once sent |
| Click-return-based success | "Successful" logs over actions that never took effect |
