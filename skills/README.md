# Skills — a router / core / domain family

This directory ships a small skill family, not a single skill. **The project is scoped to Boss 直聘 recruiting automation**; the split exists for maintainability: a platform change touches only the mechanism layer, a change in hiring criteria touches only the domain layer, and neither leaks into the other.

```
skills/
├─ web-automation-router/         router  — decides which skills to load (user-invocable)
├─ core-gated-web-automation/     core    — HOW the channel, extraction, navigation, hygiene work
├─ core-safe-batch-operations/    core    — HOW identity, verification, idempotency, audit work
└─ domain-boss-recruiting/        domain  — WHAT qualifies / what to say (Boss recruiting only)
```

## Progressive disclosure (four levels)

| Level | What | When in context | Budget |
| --- | --- | --- | --- |
| 1 | `name` + `description` (frontmatter) | always | ~100 words |
| 2 | `SKILL.md` body — routing, execution protocol, hard gates | when the skill triggers | ≤ 5k words |
| 3 | `references/`, `workflows/` | only when a branch needs it | no limit |
| 4 | `scripts/` | never read; executed | no limit |

**Rule**: `SKILL.md` carries no domain knowledge. If a paragraph is only needed by one branch, it belongs in `references/`. `SKILL.md` and its references must not duplicate the same information — run `npm run validate:skills` to check.

## Injection matrix

| Role | `disable-model-invocation` | `user-invocable` | Injected |
| --- | --- | --- | --- |
| router | `true` | `true` | alone, when the request type is unclear |
| core | `true` | `false` | always paired with exactly one domain |
| domain | `true` | `false` | always paired with both cores |

Load order: **router (if needed) → both cores → one domain**. Each is a separate skill load; intending to load three is not loading three.

## Responsibility split

- **Cores own mechanism** — transport, extraction, navigation, DOM hygiene, identity, verification, idempotency, pacing. They contain nothing about recruiting.
- **Domain owns judgement** — who qualifies, what the message says, what the deliverable looks like.
- **On conflict**, the domain skill wins for domain judgement and the cores win for mechanism.

## Boundary contract

Scope is **Boss 直聘 recruiting automation**. The boundary rule keeps it maintainable: mechanism changes go into the cores, Boss-specific judgement goes into `domain-boss-recruiting`. If a core paragraph gets copied into the domain skill, the boundary is wrong — fix the core instead. The cores happen to contain nothing application-specific, which is a side effect of that rule, not a goal of this project.

## Validating this family

```bash
npm run validate:skills        # frontmatter, naming, size budget, routing table, duplication
npm run smoke                  # includes validate:skills
```

Checks enforced (see `scripts/validate-skills.mjs`): directory name equals `name`; `name` matches `^[a-z0-9]+(-[a-z0-9]+)*$` and is ≤ 40 chars; `description` exists, is third-person, and contains no `<` or `>`; `SKILL.md` is within the word budget; a “load on demand” table exists; every file referenced by the table exists on disk; no paragraph is duplicated between `SKILL.md` and its references.
