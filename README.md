# Budget

Self-hosted workspace budget & approval tracker. SvelteKit 2 (Svelte 5 runes) + Bun +
PostgreSQL 17 + Drizzle, auth via an external [Pocket ID](https://pocket-id.org) instance
(OIDC, passkeys only). Single app container + database behind your reverse proxy.

## Status

- ✅ **Phase 0 — Foundation**: Docker Compose, migrations on boot (advisory-locked),
  `Money` value object (bigint minor units, banker's rounding), `Clock`/`IdGenerator`
  ports, env validation, `/healthz`, sharp-under-Bun-in-container verified.
- ✅ **Phase 1 — Identity & workspaces**: OIDC login (PKCE + state + nonce), server-side
  sessions, orphan-user landing, workspace create/join via invite codes, roles,
  workspace switcher, membership enforced in `hooks.server.ts`.
- ✅ **Phase 2 — Core loop**: purchase state machine with append-only `approval_event`
  audit log, per-member approval policies (none/threshold/always + any_of routing),
  overage re-approval, edit invalidation, derived staleness.
- ✅ **Phase 3 — Sealed purchases**: `visibility` domain module, seal filter enforced in
  the repository on every read (list, detail, aggregates, images), approval×seal
  conflict rule (route around concealed approvers, else _disclosed_ auto-approval),
  requester-only early unseal, boot + 5-minute unseal sweep, audit-logged seals.
  Decisions taken: no seal amount cap in v1; no owner force-unseal.
- ✅ **Phase 4 — Images**: content-addressed filesystem `BlobStore`, magic-byte
  validation, rotate-then-strip-EXIF, 400px/1600px WebP derivatives (originals
  discarded), seal-aware authorized serving route.
- ✅ **Phase 5 — PWA & notifications**: manifest + icons + service worker (push,
  deep-link notification clicks, asset cache), Web Push with VAPID
  (subscribe/upsert-by-endpoint/410-prune/failure-count), ntfy channel, composite
  `Notifier` honoring per-member × per-event × per-channel prefs, seal-filtered
  payloads, workspace SSE stream (per-subscriber seal filtering) with live page
  invalidation, stale-nudge sweep (threshold, then daily, cap 5), iOS
  Add-to-Home-Screen onboarding + gesture-gated permission flow on
  `/w/{slug}/settings/notifications`.
- ✅ **Phase 6 — Recurring**: purpose-built RRULE subset (daily/weekly/monthly/yearly,
  intervals, BYDAY, last-day-of-month) anchored by DTSTART, timezone-correct
  occurrence times, materialization sweep with capped catch-up after downtime,
  pause/resume/end, price changes (future occurrences only), auto-complete vs
  confirm-at-actual-price. Recurring purchases bypass approval; sealing them is
  impossible by construction.
- ✅ **Phase 7 — Analytics**: computed on the fly, every query seal-filtered
  (`visibleTo`). Month vs last-month comparison, daily trend (hand-built SVG),
  category and member breakdowns, monthly budgets (overall + per category) with
  seal-filtered actuals. All bucketing in the workspace timezone.
- ✅ **Phase 8 — Income & net position**: one-off entries plus recurring templates
  expanded at query time (no materialization state), net cash flow and savings
  rate on the analytics page. Income is workspace-open by design.
- ✅ **Phase 9 (core) — Export & ops**: seal-aware CSV export, backup docs.
  Remaining polish: strict CSP, rate limiting, offline shell beyond asset cache,
  seed script.

## Development

```sh
bun install
docker compose up -d db          # postgres 17 on :5432
bun scripts/dev-oidc.ts &        # fake OIDC provider on :9443 (dev only)
POCKET_ID_ISSUER=http://localhost:9443 \
POCKET_ID_CLIENT_ID=budget-local \
POCKET_ID_CLIENT_SECRET=dev-secret \
OIDC_REDIRECT_URI=http://localhost:5173/auth/callback \
bun run dev
```

The fake IdP auto-approves logins. Switch identities with
`curl http://localhost:9443/_as/bob` (alice / bob / carol).

- `bun run test` — domain unit tests (vitest)
- `bun run test:e2e` — Playwright: approval + sealing flows (needs the db container)
- `bun run seed` — demo workspace for the fake-IdP users
- `bun run check` — svelte-check
- `bun run lint` / `bun run format`
- `bun run db:generate` — create a migration after editing `src/lib/server/db/schema.ts`

Migrations run automatically on app boot (single-flight via Postgres advisory lock).

## Production

```sh
cp .env.example .env   # fill in Pocket ID + origin values
docker compose up -d --build
```

See `.env.example` for the full env contract. Notes:

- **Pocket ID issuer** is the instance's base URL, no trailing slash, no path.
- Create a **confidential** OIDC client in Pocket ID (Administration → OIDC Clients)
  and register `https://your-host/auth/callback` exactly.
- Blobs live in the `blobs` volume (`/data/blobs`); back up the DB first, then the
  blob dir (blobs are content-addressed and append-only, so that order is safe).

## Backup & restore

```sh
# 1. Database first
docker compose exec db pg_dump -U root -Fc local > backup/budget-$(date +%F).dump
# 2. Then blobs (append-only, so dumping after the DB never strands a reference)
docker run --rm -v budget-app_blobs:/data/blobs -v "$PWD/backup:/backup" \
  alpine tar czf /backup/blobs-$(date +%F).tgz -C /data blobs

# Restore (reverse order is fine; blobs are content-addressed)
docker compose exec -T db pg_restore -U root -d local --clean < backup/budget-YYYY-MM-DD.dump
docker run --rm -v budget-app_blobs:/data/blobs -v "$PWD/backup:/backup" \
  alpine tar xzf /backup/blobs-YYYY-MM-DD.tgz -C /data
```

## Architecture

```
src/lib/domain/        pure TS, no I/O — money, purchase state machine,
                       approval policy evaluation, staleness (all unit-tested)
src/lib/application/   use-cases: create/join workspace, submit/approve/deny/
                       cancel/complete/edit purchase (transactional + audit event)
src/lib/ports/         Clock, IdGenerator
src/lib/infra/         system clock, UUIDv7 generator
src/lib/server/        env validation, db client, migrations, auth (OIDC, sessions),
                       repositories (every purchase read takes workspaceId + viewerId)
src/routes/            thin routes; authorization resolved once in hooks.server.ts
```
