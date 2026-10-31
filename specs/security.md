# Security and privacy

### SEC-1: Access token

Phase: 1. Verified by: test.

Every `/api/*` and `/setup/*` request shall carry a `Cf-Access-Jwt-Assertion` token signed by the team's Access keys, with the expected issuer and audience. Any other request shall get `403`, including when the Access settings are missing.

### SEC-2: Cross-site requests

Phase: 1. Verified by: test.

A state-changing request without a non-form content type, such as `application/json`, or from another origin shall get `403`.

### SEC-3: Local development bypass

Phase: 1. Verified by: test.

`DEV_AUTH_BYPASS=1` shall skip SEC-1 only when the host is exactly `localhost`.

### SEC-4: Secrets and VIN

Phase: 1. Verified by: test.

The tracker shall keep only the last part of a problem `type` from error responses, because other fields can contain the VIN. The API key and VIN shall come from secrets and shall not appear in stored data, responses or logs.

### SEC-5: Position privacy

Phase: 1. Verified by: test.

Snapshots shall store only `at_home`, never coordinates or an address. No route shall return the home position.

### SEC-6: Edge protection

Phase: 1. Verified by: manual.

Cloudflare Access shall cover all traffic to the Worker, and preview URLs shall be off. To check, open the Worker's URL in a private window and confirm the Access login appears.

### SEC-7: Public repository

Phase: 1. Verified by: manual.

The public repository shall contain no API key, real VIN, raw API output or home position. To check, read the staged diff before each commit.

### SEC-8: Car state privacy

Phase: 4. Verified by: test.

The stored latest car state shall hold only the fields listed in POLL-12. It shall never hold the VIN, licence plate, vehicle name or coordinates, even when the API response contains them.
