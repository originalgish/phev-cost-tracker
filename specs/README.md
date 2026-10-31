# Specs

The files here are the source of truth for how the tracker behaves. If code, a test or another document disagrees with a spec, the spec wins until someone changes it on purpose.

## Workflow

Every behaviour change follows the same order:

1. **Spec.** Add or change the requirement here. Use a new ID for new behaviour.
2. **Test.** Write a test with the requirement ID in its title, and watch it fail.
3. **Code.** Change only what the test needs.
4. **Check.** Run `pnpm check`.
5. **Commit.** Commit the spec, test and code together.

A bug fix follows the same order. If the spec was right, skip step 1. If the spec missed the case, fix the spec first.

Changes that do not affect behaviour, such as refactors, need no spec change.

## Requirement format

```markdown
### SES-1: Open a session

Phase: 2. Verified by: test.

When ..., the tracker shall ...
```

- **ID:** a prefix and a number. Never reuse or renumber an ID. To remove a requirement, keep the heading, replace the text with `Removed: reason`, and set `Verified by: manual`.
- **Phase:** the build phase that delivers it.
- **Verified by:** `test` or `manual`. Use `manual` only when an automated test cannot cover it, and say how to check it.
- **Text:** one behaviour that can be checked, using "shall". Say what, not how.

## Traceability

A test covers a requirement by putting its ID in the title of an `it` or `describe`:

```ts
describe("SES-1 opening", () => { ... });
```

`pnpm check:specs` fails if a test names an ID that does not exist. `pnpm check:specs <phase>` also fails if a `test` requirement up to that phase has no test.

## Files

| File | Prefix | Covers |
|---|---|---|
| [collector.md](collector.md) | `POLL` | Polling, backoff, snapshots |
| [location.md](location.md) | `HOME` | Deciding whether the car is at home |
| [sessions.md](sessions.md) | `SES` | Charge sessions and energy estimates |
| [cost.md](cost.md) | `COST` | Prices, VAT and cost |
| [api.md](api.md) | `API` | HTTP routes |
| [security.md](security.md) | `SEC` | Access, secrets and privacy |
| [alerts.md](alerts.md) | `ALERT` | Warnings to the owner |
| [dashboard.md](dashboard.md) | `DASH` | The web page |
| [operations.md](operations.md) | `OPS` | Running within the free tier |
| [skoda-api.md](skoda-api.md) | none | Facts about the Škoda API |
| [decisions.md](decisions.md) | none | The design choices behind the specs, and why |
