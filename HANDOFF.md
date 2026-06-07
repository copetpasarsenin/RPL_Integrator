# RPL Integrator Gateway — Final Handoff

## 1. What has been completed

### Authentication and token hardening

- Split dashboard session JWTs and API JWTs by issuer, audience, and token `type`.
- Added `issueApiToken()` for API JWT creation.
- `/generate-test-token` now issues API JWTs instead of dashboard-compatible JWTs.
- Normal users can no longer spoof arbitrary API token identity; admin/operator can customize identity for demos.
- Dashboard auth re-checks the database user on every authenticated dashboard request, so deleted users cannot keep using old session JWTs.
- API JWTs now include `jti` and can be revoked before expiry.
- Added `revoked_api_tokens` storage and validation.
- Dashboard session JWTs now include `jti` and can be revoked server-side.
- Added `revoked_session_tokens` storage and dashboard auth revocation checks.
- `/logout` and `/logout-all` revoke dashboard session tokens server-side before clearing cookies.

### API key hardening

- API key owner must exist before the key is accepted.
- Added `api_keys.user_id -> users.id` foreign key with `ON DELETE CASCADE`.
- API key daily quota check uses a database transaction and `SELECT ... FOR UPDATE`.
- API keys support scopes, including examples such as:
  - `*`
  - `proxy:*`
  - `proxy:smartbank`
  - `proxy:marketplace`
  - `validation:read`
  - `routing:read`
- Gateway proxy enforces API key `proxy:<service>` scopes.

### CSRF and dashboard safety

- CSRF cookie is `httpOnly`.
- CSRF token comparison is timing-safe.
- Dashboard mutations are protected by CSRF middleware.
- Helmet CSP is enabled.
- Reflected 404 URL output is escaped.
- Chart JSON output uses `safeJson()`.
- CSV exports protect against spreadsheet formula injection.

### Gateway proxy behavior

- Gateway forwards query strings to downstream services.
- Gateway preserves downstream HTTP status codes.
- Gateway validates `amount` and rejects negative/non-numeric values.
- Gateway disables redirects for proxy/fee/health requests.
- Gateway applies outbound request timeouts.
- Gateway does not forward `Authorization` to downstream services by default.
- `FORWARD_AUTHORIZATION_TO_SERVICES=true` is required to forward auth headers.
- Fee is attempted only after downstream success.
- Revenue is recorded only if fee debit succeeds.
- Gateway proxy checks target service URLs for SSRF risks before making outbound calls.
- Gateway fee debit URL is checked for SSRF risks before the SmartBank call.

### SSRF protection

- Added `utils/urlSafety.js`.
- Service URLs are validated for:
  - HTTP/HTTPS only.
  - No embedded credentials.
  - Localhost/local hostname blocking in production.
  - Private/reserved IPv4 blocking in production.
  - Private/reserved IPv6 blocking in production.
  - DNS resolution to private/reserved IP blocking in production.
- Added safe DNS lookup agents for axios calls to reduce DNS rebinding risk during the actual socket lookup.
- Private service URLs are allowed outside production by default.
- In production, private service URLs require:

```env
ALLOW_PRIVATE_SERVICE_URLS=true
```

### Idempotency

- Added `gateway_idempotency_keys` table.
- Gateway proxy now supports `Idempotency-Key` for non-GET/HEAD requests.
- Same user + route + payload + idempotency key replays the stored response.
- Same idempotency key with a different payload returns `409`.
- Duplicate in-progress requests return `409`.

### Rate limiting

- Existing in-memory per-user rate limiting remains the default.
- Added optional database-backed per-user rate limiting for multi-instance deployments:

```env
USER_RATE_BACKEND=db
```

- Added `api_rate_limits` table for DB-backed user request windows.
- API key daily quota remains DB-backed and transactional.

### Database/schema hardening

- Added/updated startup schema support for:
  - `revoked_api_tokens`
  - `revoked_session_tokens`
  - `gateway_idempotency_keys`
  - `api_rate_limits`
  - API key `scopes`
- Destructive schema changes require:

```env
ALLOW_DESTRUCTIVE_SCHEMA_CHANGES=true
```

- Default users are skipped in production unless:

```env
SEED_DEFAULT_USERS=true
```

### CSV handling

- Service CSV import no longer uses naive comma splitting.
- Added parser support for quoted commas, escaped quotes, comments, CRLF/LF line endings, and empty rows.

### OpenAPI documentation

- Added OpenAPI contract:

```text
public/openapi.json
```

- It is served by Express static middleware at:

```text
/openapi.json
```

It documents the main public/API gateway endpoints, including token generation, token revocation, API key creation, validation, routing, and dynamic proxying.

### Tests

- Added meaningful integration tests in:

```text
tests/integration.test.js
```

Coverage includes:

- API token validation.
- Dashboard session tokens rejected for API access.
- Normal user API token identity spoof prevention.
- API token revocation.
- Revoked API token rejection.
- Production SSRF blocking.
- API key daily quota enforcement.
- API key proxy scope enforcement.
- Gateway idempotency replay.
- Proxy query forwarding, status preservation, and `Authorization` stripping.

- Expanded structure tests in:

```text
tests/app-structure.test.js
```

### Testability

- `server.js` now exports the Express app and `startServer()`.
- Server startup is guarded by `require.main === module` so tests can import the app without starting a long-running server.

### Dependency/security status

- `axios` was updated to `^1.17.0`.
- `npm audit --omit=dev --audit-level=moderate` reports zero vulnerabilities.

## 2. What was validated

The following commands were run and passed:

```bash
npm run check
```

Result: passed.

```bash
npm test
```

Result:

```text
14 tests
14 passed
0 failed
```

```bash
npm audit --omit=dev --audit-level=moderate
```

Result:

```text
found 0 vulnerabilities
```

```bash
git --no-pager diff --check
```

Result: no whitespace errors. Git only reported existing LF -> CRLF working-copy warnings.

Editor diagnostics were refreshed and reported:

```text
No errors or warnings found
```

## 3. What could not be validated and why

### Docker Compose validation

Could not run:

```bash
docker compose config
```

Reason: Docker is not installed/available in the current environment.

### Real MySQL-backed integration tests

The integration tests currently mock the MySQL pool and use local test HTTP servers for downstream services.

Could not validate against a real MySQL instance because a dedicated test database/service was not available in this environment.

### Browser/dashboard end-to-end flows

Could not fully validate browser behavior such as manual login, dashboard navigation, forms, CSV upload UI, and client portal workflows.

Reason: no browser/E2E environment was used in this session.

### Production network behavior

SSRF checks and safe DNS lookup behavior were tested at the unit/integration level, but not against a real production DNS/network topology.

Reason: no production-equivalent DNS/network environment was available.

## 4. Remaining limitations

### No migration framework yet

Schema is still created/mutated from `config/database.js` at startup and mirrored in `config/init.sql`.

A proper migration framework is still needed before production hardening is complete.

### `server.js` is still too large

`server.js` still contains many dashboard/API routes and operational logic. It should be split into route/service modules after the current test coverage is preserved.

### CSP still allows inline scripts

Helmet CSP is enabled, but `unsafe-inline` remains because the EJS views still contain inline scripts and/or inline handlers.

Full CSP hardening requires moving inline JavaScript into static JS files and replacing inline handlers with event listeners.

### Fee/revenue flow is improved but not a full saga

The gateway now charges fees only after downstream success and records revenue only when fee debit succeeds. However, it still lacks a complete saga/outbox/refund/compensation workflow.

Remaining fee-flow gaps:

- durable transaction state machine,
- retry/outbox processing,
- compensation/refund path,
- downstream idempotency coordination,
- reconciliation tooling.

### Health state is still process-local

`global.serviceHealth` and `global.serviceHealthFailures` are still in-memory. This is not multi-instance safe.

### Rate limiting is only optionally DB-backed

`USER_RATE_BACKEND=db` is now available, but the default is still memory. Multi-instance deployments should explicitly configure DB-backed or Redis-backed limiting.

### API key scopes are basic

Scopes are string-based and enforced for proxy access. There is no dedicated normalized `api_key_scopes` table yet.

### OpenAPI document is static

`public/openapi.json` is manually maintained. It is not generated from route definitions.

### Nested duplicate directory remains

The untracked nested duplicate directory remains:

```text
RPL_Integrator-main/
```

It was intentionally not removed or modified.

## 5. Exact next steps for a developer with Docker and MySQL available

### A. Review current working tree

```bash
git status
```

Confirm the nested untracked directory still exists and do not remove it unless explicitly approved.

### B. Validate Docker Compose

```bash
docker compose config
```

If valid, optionally start services:

```bash
docker compose up -d
```

### C. Prepare MySQL test database

Create an isolated database, for example:

```sql
CREATE DATABASE rpl_integrator_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Use a dedicated user if possible.

### D. Run schema initialization against test DB

Set environment variables for the test DB:

```env
NODE_ENV=test
JWT_SECRET=replace_with_at_least_32_chars_for_test
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=<test_user>
DB_PASSWORD=<test_password>
DB_NAME=rpl_integrator_test
SEED_DEFAULT_USERS=true
ALLOW_PRIVATE_SERVICE_URLS=true
USER_RATE_BACKEND=db
```

Then start the app once or run whatever project-specific init path is preferred to create tables.

### E. Run validation commands

```bash
npm run check
npm test
npm audit --omit=dev --audit-level=moderate
```

### F. Manually test dashboard flows

1. Login as admin/operator/user.
2. Generate API token from client portal/dashboard.
3. Validate token:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/integrator/validasi_request
```

4. Revoke API token via `/api/tokens/revoke` and confirm it no longer works.
5. Logout and confirm old dashboard session cookie can no longer access dashboard routes.
6. Create API key with limited scope, for example:

```text
proxy:smartbank
```

7. Confirm it can proxy to `smartbank` and is rejected for another service.
8. Test API key daily quota.
9. Test `Idempotency-Key` replay behavior.
10. Test service CRUD and service health checks.
11. Test service CSV import with quoted commas.
12. Confirm `/openapi.json` is served and valid.

### G. Add real MySQL-backed integration tests

Add a test suite that:

1. Creates/drops a dedicated test schema.
2. Runs schema initialization.
3. Seeds test users/services/API keys.
4. Exercises the real DB instead of mocked `pool.query`.
5. Runs downstream test services on ephemeral ports.

Recommended new file:

```text
tests/mysql-integration.test.js
```

### H. Add a migration framework

Recommended direction:

1. Add a migrations folder:

```text
migrations/
```

2. Move schema changes out of `initDatabase()` into versioned migrations.
3. Keep `config/init.sql` as a bootstrap/dev convenience only.
4. Add commands such as:

```json
"db:migrate": "node scripts/migrate.js",
"db:rollback": "node scripts/migrate.js rollback"
```

### I. Refactor `server.js` after tests are stable

Suggested modules:

```text
routes/dashboard.js
routes/users.js
routes/apiKeys.js
routes/tokens.js
routes/services.js
routes/analytics.js
routes/docs.js
services/healthCheckService.js
services/auditService.js
services/csvService.js
services/tokenService.js
```

### J. Tighten CSP

1. Move inline scripts from EJS views into `public/js/*.js`.
2. Replace inline `onclick` handlers with event listeners.
3. Remove `unsafe-inline` from `script-src` and `script-src-attr`.
4. Consider nonce or hash-based CSP if inline scripts cannot be fully removed.

## 6. Risks that must be considered before production

### JWT secret risk

Production must use a strong secret:

```env
JWT_SECRET=<at least 32 random characters>
```

`NODE_ENV=production` rejects missing/short/default secrets.

### Legacy API JWT compatibility

Old API JWTs may break because API tokens now require issuer/audience/type validation.

Use this only temporarily if needed:

```env
ALLOW_LEGACY_API_JWT=true
```

### Authorization forwarding behavior

Downstream services no longer receive `Authorization` by default.

Enable only if downstream services truly need it:

```env
FORWARD_AUTHORIZATION_TO_SERVICES=true
```

### Private service URLs in production

Private/localhost service URLs are blocked in production unless explicitly allowed:

```env
ALLOW_PRIVATE_SERVICE_URLS=true
```

This is useful for Docker/internal networks but must be reviewed carefully because it relaxes SSRF protection.

### Startup schema mutation

The app still mutates schema at startup. This is risky in production until migrations are introduced.

### Process-local health state

Health/circuit-breaker state is process-local and will not be shared across multiple app instances.

### DB-backed rate limit performance

`USER_RATE_BACKEND=db` improves multi-instance consistency but adds database writes on every authenticated API request. Monitor DB load before production rollout.

### Idempotency storage

`gateway_idempotency_keys.response_body` stores response JSON. Ensure downstream responses do not include sensitive data that should not be retained.

### Fee/revenue consistency

The fee flow is not a full financial transaction saga. Before handling real money, implement durable transaction states, retries, reconciliation, and compensation/refund logic.

### Static OpenAPI drift

`public/openapi.json` can drift from implementation because it is manually maintained.

### Nested duplicate directory

The untracked nested `RPL_Integrator-main/` directory can cause duplicate grep/search results and developer confusion. Do not delete it without explicit approval, but it should be reviewed.

## 7. Concise continuation prompt for the next session

```text
Continue work on the Node.js Express/MySQL project `RPL_Integrator-main`.

Do not delete or modify the nested untracked `RPL_Integrator-main/` directory unless explicitly confirmed.
Do not commit unless explicitly asked.

Current completed hardening includes: split dashboard/API JWTs, API/session JWT revocation with jti, API key owner FK and scopes, CSRF hardening, API key quota transaction, SSRF URL safety with DNS/private-IP checks, gateway query/status/timeout/redirect/auth-forwarding hardening, idempotency-key response replay, optional DB-backed per-user rate limiting, safer CSV import, OpenAPI at `public/openapi.json`, and integration tests.

First run:
- git status
- npm run check
- npm test
- npm audit --omit=dev --audit-level=moderate

If Docker is available, run:
- docker compose config

If MySQL is available, add real MySQL-backed integration tests using a dedicated test DB. Then introduce a migration framework and begin refactoring `server.js` into route/service modules only after tests pass.

Remaining high-priority work: real DB integration tests, migration framework, server.js modularization, full CSP inline-script removal, durable fee saga/outbox/refund workflow, shared health state for multi-instance deployments, and review/removal/archive of the nested duplicate directory only with explicit approval.
```
