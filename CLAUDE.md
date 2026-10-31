# PHEV Cost Tracker

This project uses spec-driven development. `specs/` is the source of truth for behaviour. See [specs/README.md](specs/README.md).

For any behaviour change, work in this order: spec, failing test with the requirement ID in its title, code, `pnpm check`, then commit all three together. If a spec seems wrong, raise it with the user before changing it.

- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) is the build order. Work through it task by task.
- Commit on `main` and push. Never force-push. A push to `main` that passes `pnpm check` deploys to production and applies migrations.
- The repository is public. Never commit the API key, the real VIN, raw API output or the home position.
