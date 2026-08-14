# Ledger

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
  confirm-at-actual-price, optional charging to a bucket (drawn down on
  completion). Recurring purchases bypass approval; sealing them is
  impossible by construction.
- ✅ **Phase 7 — Analytics**: computed on the fly, every query seal-filtered
  (`visibleTo`). Month vs last-month comparison, daily trend (hand-built SVG),
  category and member breakdowns, monthly budgets (overall + per category) with
  seal-filtered actuals. All bucketing in the workspace timezone.
- ✅ **Phase 8 — Income & net position**: one-off entries plus recurring templates
  expanded at query time (no materialization state), net cash flow and savings
  rate on the analytics page. Income is workspace-open by design.
- ✅ **Phase 9 — Export & ops**: seal-aware CSV export (formula-injection safe),
  CSP with split `style-src-elem`/`style-src-attr`, per-IP rate limiting on auth
  and per-session on uploads, seed script, backup docs.
- ✅ **Phase 10 — Buckets**: per-member sinking funds accruing on the same RRULE
  subset as recurring purchases (daily/weekly/monthly/yearly, intervals, BYDAY,
  start dates, optional backfill), materialized by the sweep under a row lock
  with capped catch-up. Withdrawals and manual adjustments are owner-only.
  Purchases can be charged to a bucket, optionally skipping approval per workspace.
- ✅ **Phase 11 — Intelligence & command palette**: a local intent parser (no LLM)
  over spending questions, net-position questions, bucket creation, and navigation,
  reachable from the palette in the header. Same-origin enforced like `/push`.
- ✅ **Phase 12 — Merchants & accents**: merchant extraction and per-merchant
  grouping on purchases; a per-workspace accent color that drives the whole theme.
- ✅ **Phase 13 — Interaction polish**: navigation progress bar, toast feedback,
  in-flight form state and confirm gates via `use:submit`, Escape-dismissable
  popovers via `use:dismiss`.
- ✅ **Phase 14 — Reconciliation**: import a bank CSV or PDF and tick it against
  what is recorded. PDFs are parsed in the browser (pdf.js), so the document
  never leaves the device — only the date/amount/description columns are posted,
  rejoining the same `parse-csv` pipeline. Matching is pure and deliberately
  refuses to guess: a line with two equally good candidates stays unmatched and
  carries its ranked shortlist for a person to pick from. Importing never
  creates, edits or deletes a purchase; confirming a match writes `cleared_at`
  and nothing else. Seal-aware throughout — a line belonging to a concealed
  purchase reads _accounted for, hidden from you_ and carries no id to follow.
- ✅ **Phase 15 — Optional assist (LLM as a port)**: a narrow `LlmAssist` port with
  a null adapter as the default, plus Ollama and OpenAI-compatible adapters. The
  model is a _fuzzy reducer_, never an approver: it picks from an option set the
  caller already owns, or transcribes glyphs the app's own parsers then read.
  Every output crosses `domain/intelligence/constrain` or
  `domain/intelligence/read-fields` before it counts, so a hallucination becomes
  _no suggestion_ rather than a wrong one. Nothing it produces is written without
  a person confirming, and every surface degrades to its deterministic behaviour
  with the assist off — which is the property the test suite pins down.

  Vision is reachable only through two constrained methods (`readFields`,
  `readRows`) — never an open-ended `describeImage` — and every value returns as
  a **string** for `parseAmount`/`findDates`/`sanitizeLabel` to interpret. That
  buys scanned bills, receipt photos and scanned statements; a figure the app
  cannot read cleanly becomes an empty field, never a plausible wrong number.
  Model capability is gated three ways (has it / provably lacks it / never
  established), failing open on the third because no OpenAI-compatible endpoint
  publishes what its models can do.

  > **Note for self-hosters:** Ollama does not decode WebP, and fails _silently_
  > — the image is dropped and the model answers from priors. Images are
  > therefore re-encoded to JPEG at a single choke point (`toModelImage`) before
  > any model sees them.

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
- **Basemap tiles are not a blob.** `TILE_CACHE_DIR` (`/data/tiles` by default)
  holds disposable third-party imagery keyed by coordinate, with a 30-day TTL.
  Do **not** back it up — it would carry hundreds of megabytes of somebody
  else's map into every archive — and deleting it at any time is safe.

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
                       cancel/complete/edit purchase (transactional + audit event),
                       recurring materialization, bucket accruals, budget alerts
src/lib/intelligence/  intent parser for the command palette (pure TS, no network)
src/lib/ports/         Clock, IdGenerator, Notifier, BlobStore
src/lib/infra/         system clock, UUIDv7, filesystem blob store, image pipeline,
                       notifiers (web push, ntfy, composite), in-process SSE bus
src/lib/actions/       Svelte actions — money input masking, use:submit, use:dismiss
src/lib/server/        env validation, db client, migrations, auth (OIDC, sessions),
                       rate limiting, repositories (every purchase read takes
                       workspaceId + viewerId)
src/routes/            thin routes; authorization resolved once in hooks.server.ts
```

The periodic sweep lives in `hooks.server.ts`: unseal due purchases, materialize
recurring rules and bucket accruals, send stale nudges and budget alerts. It runs
on boot and every 5 minutes, never overlapping itself, and stops on SIGTERM.
