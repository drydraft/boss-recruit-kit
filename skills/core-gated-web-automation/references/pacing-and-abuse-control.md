# Pacing, cooldowns and abuse control

## Principle

The goal is to be **indistinguishable from a diligent human doing the same job**, not to maximise throughput. Every hard block below exists because exceeding it produced a visible failure.

## Pacing budget

| Dimension | Default | Hard block |
| --- | --- | --- |
| Gap between two entities | 15–20 s | < 8 s |
| Gap between two writes to the same entity | 2 s | < 1 s |
| Continuous run length | 40 min | > 60 min without a cooldown |
| Cooldown after a burst | 10 min | skipping it after a rate-limit signal |
| Concurrent entity operations | 1 | > 1 |

Add jitter (roughly ±30 %) to every gap; perfectly periodic intervals are themselves a signal.

## Recognising a soft rate limit

The tell is not an error page but a **capability that quietly stops working** while everything else answers. Observed pattern: after intense modal/canvas activity, the canvas stops repainting at its placeholder size while ordinary requests still succeed — for tens of minutes, and surviving a browser restart.

Rule: on the first such signal, **stop the run**, record the last successful entity, and cool down before resuming. Do not "retry harder": retries during a soft limit extend it and can escalate it.

Distinguish carefully from the two lookalikes:

| Observation | Real cause |
| --- | --- |
| Canvas at placeholder size while the window is unfocused | Render throttling (fix: focus) |
| Canvas at placeholder size while focused, after a long burst | Soft rate limit (fix: cooldown) |
| Requests returning a distinct "environment" error code | Server-side risk gate on client signals (fix: stop; report) |

## Retry policy

- Retry only **transient** failures (timeouts, one-off navigation races): at most **2** times, with backoff.
- Never retry an action that already produced a write, before verifying its effect — verification first, retry only if the effect is absent.
- Never retry a rate-limit response inside the same burst.

## Idempotency as abuse control

An idempotent runner is also a politeness device: it performs each action **once**, so re-running a crashed batch does not re-send anything. Achieve this by making every write conditional on an observed absence of its effect (see `core-safe-batch-operations/references/idempotent-runner.md`).

## Evidence of consent

Keep a per-run log containing, for each entity: identifier, the action taken, the verification result, and the timestamp. This is what turns "the script did something" into "this specific action was verified on this entity at this time" — required both for the user's audit and for any later dispute.

## When the user asks to speed up

Explain the tradeoff once, in terms of their own risk: a rate limit can block the account or the current batch mid-write, and mid-write blocks are the expensive kind. Offer the compliant lever instead: run overnight in chunks, or reduce the per-entity work (skip canvas reads that are not needed).
