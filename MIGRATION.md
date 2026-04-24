# Migration — NorthStar → Starward infrastructure

Run these steps in order. Each step has a **verify** line — run the verify command and eyeball the output before moving on. Don't skip verify.

The code in this repo already points at the new names (`starward-api`, `starward-redis`, `starward://` protocol, `com.abby101010.starward` app ID). This runbook creates the deployed resources so the code works.

**Everything costs money or is destructive** — commands are marked ⚠ for the irreversible ones.

---

## 0. Pre-flight

Confirm the old deployment is healthy and capture what you're about to copy.

```bash
# Sanity: you're logged in as the expected user/org
fly auth whoami

# Capture the old app's secret KEYS (values are redacted; you'll re-paste them later)
fly secrets list -a northstar-api

# Confirm old app is reachable
curl -fsS https://northstar-api.fly.dev/health
# expected: {"ok":true,"db":"connected"}

# Remember which region + org the old app lives in
fly status -a northstar-api
```

Keep that terminal open — you'll reference the secret names and org in later steps.

---

## 1. Create the new Fly app (`starward-api`)

```bash
# From the repo root (where fly.toml lives).
# The --no-deploy flag stops it from trying to deploy on create;
# we'll deploy explicitly in step 3 once secrets are set.
fly apps create starward-api --org <your-fly-org>
```

**Verify:**
```bash
fly status -a starward-api
# expected: app exists, 0 machines, no deployments yet
```

If your `fly.toml` is already set to `app = "starward-api"` (it is — we edited it), `fly status` without `-a` from the repo root also works.

---

## 2. Copy secrets from old app to new app

Fly doesn't copy secrets between apps automatically. You must re-set each one on the new app.

Look at `fly secrets list -a northstar-api` and replicate each secret. The typical set for this app (from `backend/.env.example` and `ARCHITECTURE_UPGRADES.md`):

| Secret | Source | Notes |
|---|---|---|
| `DATABASE_URL` | Supabase dashboard → Project → Settings → Database → Connection String (URI) | Points to the same Supabase — no DB migration needed. |
| `ANTHROPIC_API_KEY` | `console.anthropic.com` → Keys | Same key works. |
| `VOYAGE_API_KEY` | `voyageai.com` account | Used by the RAG retrieval layer. |
| `DEV_USER_ID` | `sophie` (per existing deployment) | Phase-1 auth bypass. |
| `SUPABASE_JWT_SECRET` | Supabase → Settings → API → JWT Secret | Auth middleware uses this. |
| `REDIS_URL` | **Leave unset for now** — we'll set it in step 5 after creating the new Redis instance. |

Get each value from the old environment, then set it on the new app:

```bash
# Read each value. For secrets already on the old app, SSH in and print them:
fly ssh console -a northstar-api -C "sh -c 'printenv DATABASE_URL'"
# (repeat for each secret)

# Paste each value into the `fly secrets set` command for the new app:
fly secrets set DATABASE_URL='postgres://...' -a starward-api
fly secrets set ANTHROPIC_API_KEY='sk-ant-...' -a starward-api
fly secrets set VOYAGE_API_KEY='pa-...' -a starward-api
fly secrets set DEV_USER_ID='sophie' -a starward-api
fly secrets set SUPABASE_JWT_SECRET='...' -a starward-api
```

**Verify:**
```bash
fly secrets list -a starward-api
# expected: all keys present except REDIS_URL. digest values should be non-empty.
```

---

## 3. Deploy the backend to the new app

```bash
# From the repo root (fly.toml is picked up automatically).
fly deploy -a starward-api
```

This builds the Docker image from `backend/Dockerfile`, pushes to Fly's registry, and rolls out machines. Takes ~3–6 min.

**Verify:**
```bash
# Health check against the NEW URL
curl -fsS https://starward-api.fly.dev/health
# expected: {"ok":true,"db":"connected"}

# Check at least one machine is running
fly status -a starward-api
```

If the health check fails with a DB error, double-check `DATABASE_URL` on the new app.

---

## 4. (Optional now) Provision the new Redis instance (`starward-redis`)

Only needed if you actually use the BullMQ queue (regenerate-goal-plan, adaptive-reschedule, adjust-all-overloaded-plans run as async jobs). If `REDIS_URL` is unset the queue module is a no-op and those commands still work synchronously.

```bash
# Create a new Upstash Redis instance on Fly in the same region as the app.
fly redis create --name starward-redis --org <your-fly-org> --region yyz --plan free
# (or --plan pay-as-you-go if you expect sustained traffic)
```

Fly prints a connection URL after creation. Copy it.

**Set `REDIS_URL` on the new app:**
```bash
fly secrets set REDIS_URL='redis://default:<password>@starward-redis.upstash.io:6379' -a starward-api
# (use the exact URL Fly printed)
```

**Verify:**
```bash
# After the secrets change, Fly rolls the app. Wait ~30s.
fly logs -a starward-api --no-tail | tail -30 | grep -i 'bullmq\|redis\|queue'
# expected: a line indicating the queue connected (look for "[bullmq]" or similar)
```

The BullMQ queue name is `starward-bg` (we already updated the code). First use of any async command will create it in Redis.

---

## 5. Update Supabase OAuth redirect URIs (dashboard — manual)

Go to https://supabase.com/dashboard → your project → **Authentication** → **URL Configuration**.

- **Site URL**: no change needed unless you redirect through a website.
- **Additional Redirect URLs**: add `starward://auth/callback` (keep `northstar://auth/callback` too during transition so old installs still work).

Save.

If you configured your OWN Google OAuth client (not just using Supabase's default), also update:

Google Cloud Console → **APIs & Services** → **Credentials** → your OAuth client → **Authorized redirect URIs**:
- Add `starward://auth/callback`
- Keep `northstar://auth/callback` until all installed apps have updated.

**Verify:** in a fresh Electron dev build (`npm --workspace @starward/desktop run electron:dev`), click "Sign in with Google" and confirm the callback opens the app. The deep-link log line `[main] Received deep link: starward://auth/callback...` appears in the Electron terminal on success.

---

## 6. Cutover — flip clients to the new URL

The code already references `https://starward-api.fly.dev`. Nothing to edit here — just verify a fresh build hits the new backend.

```bash
# Build a new Electron binary from repo state
npm --workspace @starward/desktop run electron:build:mac   # or :win / :linux
```

Install the resulting `.dmg` / `.exe` / `.AppImage`. The app's title bar should say **Starward 星程**, sign-in should work via `starward://auth/callback`, and the Electron dev console should show requests going to `https://starward-api.fly.dev`.

**Existing installed apps** (built before this migration) still talk to `https://northstar-api.fly.dev`. They keep working as long as `northstar-api` is up. See step 7.

---

## 7. Dual-run window (keep old app alive during transition)

Keep `northstar-api` running until you're confident no users are on the old Electron build. Recommended dual-run: **2 weeks** after releasing a Starward-signed build.

During this window:
- Both `https://northstar-api.fly.dev` and `https://starward-api.fly.dev` read/write the **same Supabase Postgres** — users don't see a split.
- Both apps use their respective Redis instances. Old app writes to old Redis (`northstar-redis`), new app writes to `starward-redis`. Queues don't cross.
- If you see any traffic on the old app after a week, investigate before decommissioning.

---

## 8. ⚠ Decommission the old resources (point of no return)

Once old-app traffic is ~zero:

```bash
# 1. Scale old app to 0 first (reversible)
fly scale count 0 -a northstar-api
# wait 24h and watch logs for any surprise traffic
fly logs -a northstar-api --no-tail | tail -20

# 2. Destroy the old app (IRREVERSIBLE)
fly apps destroy northstar-api

# 3. Destroy the old Redis (IRREVERSIBLE — any jobs still in the old queue are lost)
fly redis destroy northstar-redis
```

After step 2, DNS for `northstar-api.fly.dev` stops resolving. Any old-build users on that release will see connection errors and must upgrade.

---

## 9. Cleanup — remove `northstar://` from Supabase dashboard

Once the dual-run window closes and you've decommissioned the old app:

Supabase dashboard → Authentication → URL Configuration → **remove** `northstar://auth/callback` from Additional Redirect URLs. Save.

Google Cloud Console → OAuth client → remove `northstar://auth/callback`.

---

## Rollback

If anything goes wrong in steps 1–6, rollback is cheap:

- **Bad deploy**: `fly releases -a starward-api` → `fly rollback <version>`.
- **Want to abandon the new app entirely**: edit `fly.toml` `app = "northstar-api"`, revert `frontend/package.json` + `frontend/.env.production` + `frontend/index.html` to `northstar-api`, rebuild, ship. Old infrastructure still works.
- **Bad Redis config**: `fly secrets unset REDIS_URL -a starward-api` → app falls back to no-queue mode.

Only step 8 is irreversible.

---

## Quick reference — what the code expects

| Resource | Expected name | File |
|---|---|---|
| Fly app | `starward-api` | `fly.toml:9` |
| API URL | `https://starward-api.fly.dev` | `frontend/package.json` scripts, `frontend/.env.production`, `frontend/index.html` CSP |
| Redis instance | `starward-redis` (name only; `REDIS_URL` is the actual connection) | `ARCHITECTURE_UPGRADES.md:112` |
| BullMQ queue | `starward-bg` | `backend/src/jobs/queue.ts:23` |
| Electron app ID | `com.abby101010.starward` | `frontend/package.json:54` |
| Deep-link protocol | `starward://` | `frontend/electron/main.ts:41`, `frontend/package.json:65` |

If any of these diverge from the expected value, runtime breaks until you fix it.
