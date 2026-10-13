---
name: web-automation-router
description: "Use this skill when a task requires operating a real, logged-in web application on the user's behalf and it is unclear which automation skills to load — for example 浏览器自动化、自动操作某个网站、批量处理后台里的记录、抓取需要登录才能看的页面、脚本帮我在XX网站里做一批操作、site blocks devtools or headless browsers. It selects exactly one domain skill and pairs it with the two core skills, and states explicitly when automation is the wrong approach. Not for reading public static pages (fetch them directly), and not for copying text the user can copy themselves."
version: 0.1.0
disable-model-invocation: true
user-invocable: true
---

# Web Automation Router

## Overview

Route a browser-automation request to the smallest skill set that can do it safely. This skill owns **which skills to load**, never the procedure itself.

## When to Use

- The task needs a **logged-in session** the agent cannot obtain by fetching a URL.
- The target site is known or suspected to **punish automation signals** (devtools/CDP, headless, unusual input cadence).
- The work is a **batch over entities** (records, candidates, orders, tickets, contacts) rather than a single page read.

## When NOT to Use

- Public, unauthenticated content → fetch it directly; do not start a browser.
- An official API exists and covers the task → use the API.
- The user only needs a few values copied → ask for them; automation costs more than it saves.
- The site's terms forbid the intended action entirely → report that; do not load any automation skill.

## Execution Protocol (read first)

1. **Sequential Lock** — do not load a domain skill before the two core skills are loaded.
2. **State Echo** — open every phase with one line: `[Phase N] <name> — preconditions: PASS/FAIL`.
3. **No Silent Skips** — state the reason whenever a phase is skipped.
4. **No Fabrication** — never assert a site's behaviour, selector, or ID from memory. Read it from a reference file or observe it.

## Pairing Rules (⛔ HARD RULE)

1. Load **exactly one** domain skill — never two at once.
2. Always load **both core skills** with it. They are complementary: `core-gated-web-automation` owns the channel and extraction, `core-safe-batch-operations` owns identity, verification, and idempotency.
3. Issue **separate skill loads** — one per skill. **Intending to load three is not loading three: confirm three loads actually went out before touching the page.**
4. On conflict, the **domain skill wins for domain judgements** (who qualifies, what the message says); the **core skills win for mechanism** (how to click, how to verify, when to stop).

## Files — Load On Demand

| File | When to load |
| --- | --- |
| `{SKILL_ROOT}/references/routing-matrix.md` | When the request is ambiguous, or when deciding whether automation is warranted at all |
| Core: `core-gated-web-automation/SKILL.md` | **MUST load** for any task that touches a live page |
| Core: `core-safe-batch-operations/SKILL.md` | **MUST load** for any task that writes, or that acts on more than one entity |
| Domain: one `domain-*/SKILL.md` | **MUST load exactly one** — the one matching the target application |

## Routing Matrix

| Request shape | Domain skill | Notes |
| --- | --- | --- |
| Recruiting / candidate screening on Boss 直聘 | `domain-boss-recruiting` | Ships with this repository |
| Any other logged-in application | none shipped | Load the two core skills only; derive the domain layer from the user's own rules, and write it back as a new domain skill once it stabilises |

## Hard Gates (any failure → stop and report)

1. Fewer than **two** core skills loaded before the first page action.
2. More than **one** domain skill loaded in the same task.
3. Domain judgements (eligibility, message wording) taken from a core skill.

## Convergence

- Attempt at most **2** routing corrections per request; if the request still does not resolve, ask one compact question instead of guessing.
- Do not re-route once a page action has been taken — finish or abort the current run first.

## Forbidden Patterns

- Loading a domain skill "just in case" alongside another.
- Inventing a site's selectors or IDs in the routing step.
- Treating this repository's shipped domain skill as the only possible domain.
- Starting a browser for content that a plain fetch returns.
