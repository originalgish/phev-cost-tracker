# Operations

### OPS-1: Free tier

Phase: 3. Verified by: manual.

The tracker shall stay within the Cloudflare free tier, including 10 ms of CPU time per invocation. To check, read CPU time in the Worker's **Metrics** tab after a few days of use.

### OPS-2: API quota

Phase: 1. Verified by: manual.

Normal polling shall stay well under the Škoda quota of 20 requests per hour per VIN. To check, read `rate_limit_remaining` in `/api/health`.

### OPS-3: Cost accuracy

Phase: 3. Verified by: manual.

Billed energy shall be compared with a full month of the electricity bill. To check, compare `kwh` from `/api/months` with the bill. See the open items in `IMPLEMENTATION_PLAN.md` if the bill is clearly higher.
