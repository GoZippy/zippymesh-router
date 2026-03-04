# Port Allocation & Admin/User System Plan

## Current State

### Ports in Use
| Project | Port | Script | Notes |
|---------|------|--------|-------|
| **ZippyMesh LLM Router** | 20128 | `next dev -p 20128` | Portal + dashboard |
| **ZippyMesh Website** | 21280 | `next dev -p 21280` | Marketing site |
| Next.js default | 3000 | (unused) | Reserved by user |

Neither ZippyMesh project uses port 3000. If another tool (e.g. another Next.js app, Cursor, or dev server) uses 3000, the current setup already avoids it.

### Auth Today
- **Login**: Single password (`INITIAL_PASSWORD` from .env, or bcrypt hash in `db.data.settings.password`)
- **No users table**: Single implicit owner
- **JWT**: `{ authenticated: true }` — no username, no role
- **Proxy** (`src/proxy.js`): Protects `/dashboard` and management APIs; redirects to `/login` when unauthenticated

### Dashboards
- **Sidebar**: One nav for all (Endpoint, Marketplace, Network, Monetization, Wallet, Providers, Routing, Pools, Combos, Analytics, Usage, CLI Tools, Settings)
- **Usage** (`/dashboard/usage`): Reconciliation, provider limits — no per-user or admin-only views
- **Profile** (`/dashboard/profile`): Password change, routing settings, require-login toggle — currently available to any authenticated user
- **No admin vs public separation**

---

## 1. Port Change (If Needed)

If you want to move the **portal** (ZippyMesh LLM Router) off any port that conflicts:

**Option A — Keep 20128**: Already avoids 3000. Only change if 20128 conflicts.

**Option B — New port**: Use a different port (e.g. 20130, 30280) by updating:

- `package.json`: `next dev -p 20130`, `next start -p 20130`
- `.env`, `.env.example`: `PORT=20130`, `ZIPPY_PORT=20130`
- `.env`: `NEXT_PUBLIC_BASE_URL=http://localhost:20130`
- Docs, docker-compose, sidecar config if they hardcode the port

---

## 2. Admin/User System — What to Add

### 2a. Users & Roles

| Role | Purpose |
|------|---------|
| **superadmin** | Full control, user management, system config, all usage data |
| **admin** | User management (non-super), usage monitoring, most settings |
| **user** | Own providers, routing, usage; no user mgmt or system config |
| **viewer** (optional) | Read-only dashboard |

### 2b. Super Admin Credentials

**Bootstrap options:**

1. **Env-based**: `ADMIN_USERNAME` + `ADMIN_PASSWORD` or `SUPERADMIN_PASSWORD`
   - On first run, seed a superadmin from env
   - Change on first login (optional)

2. **CLI seed**: `node scripts/seed-admin.js` to create first superadmin

3. **First-run wizard**: First successful login becomes superadmin

**Recommendation**: Use `ADMIN_USERNAME` and `ADMIN_PASSWORD` (or `SUPERADMIN_PASSWORD`) in `.env`; seed superadmin into new `users` table on startup if no users exist.

### 2c. Data Model

**New SQLite table: `users`**

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',  -- superadmin | admin | user | viewer
  email TEXT,
  is_active BOOLEAN DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
);
```

**LowDB / settings**: Keep `settings.password` for backward compatibility during migration, or remove once all logins go through `users`.

### 2d. Login Flow

- Extend login: `username` + `password` (support legacy single-password for transition)
- Validate against `users` table (or `INITIAL_PASSWORD` / `settings.password` if no users)
- JWT payload: `{ authenticated: true, userId, username, role }`
- Cookie: same `auth_token`; add optional `auth_user` for display

---

## 3. Dashboard & Route Access by Role

### 3a. Sidebar Filtering

| Route | superadmin | admin | user | viewer |
|-------|------------|-------|------|--------|
| Endpoint, Marketplace, Network, Wallet, Providers, Routing, Pools, Combos | ✓ | ✓ | ✓ | ✓ (read) |
| Analytics, Usage | ✓ | ✓ | ✓ (own) | ✓ (read) |
| Monetization | ✓ | ✓ | ✓ | — |
| **Admin** (new) | ✓ | ✓ | — | — |
| **Settings** (profile) | ✓ | ✓ (limited) | ✓ (own only) | — |
| Shutdown | ✓ | — | — | — |

### 3b. New Admin Dashboard (`/dashboard/admin`)

**Superadmin / Admin only**

- **Users**: List, create, edit, deactivate; set role
- **Usage overview**: Total tokens, cost, requests; by user (admin+); by provider
- **System**: Port, require-login, cloud sync; superadmin can change
- **Activity**: Recent logins, API usage (if logged)
- **Pricing / reconciliation**: Config visibility; edit for admin

### 3c. API Protection

| API | superadmin | admin | user | viewer |
|-----|------------|-------|------|--------|
| `GET /api/providers`, `/api/settings` (own) | ✓ | ✓ | ✓ | ✓ |
| `PATCH /api/settings` (system) | ✓ | limited | — | — |
| `POST /api/shutdown` | ✓ | — | — | — |
| `GET /api/users` | ✓ | ✓ | — | — |
| `POST /api/users` | ✓ | ✓ | — | — |
| `PATCH /api/users/:id` | ✓ | ✓ (not self-role-upgrade) | — | — |
| `GET /api/usage/*` (all users) | ✓ | ✓ | own | — |
| `GET /api/usage/reconciliation` | ✓ | ✓ | own | — |

---

## 4. Usage Monitoring for Admins

**Existing**

- `GET /api/usage/reconciliation`
- `GET /api/usage/limits`
- `GET /api/usage/history`
- `GET /api/usage/request-logs`
- `GET /api/usage/[connectionId]`

**Needed for admin**

1. **Per-user attribution**: Link usage to `userId` (from JWT or API key metadata).
2. **Admin aggregation API**: e.g. `GET /api/admin/usage/summary` with optional `?userId=` filter.
3. **UI**: Admin dashboard section with tables/charts for total and per-user usage.
4. **API keys**: If keys are per-user, tag requests with `userId` for attribution.

---

## 5. Implementation Order

1. **Port** (if changing): Update `package.json`, `.env`, `.env.example`, `NEXT_PUBLIC_BASE_URL`.
2. **Users table + migration**: Add `users` to SQLite; migration for existing data.
3. **Superadmin bootstrap**: Read `ADMIN_USERNAME` + `ADMIN_PASSWORD`; seed if no users.
4. **Auth**: Extend login for username+password; JWT with `userId`, `role`.
5. **Proxy/middleware**: Add role checks for protected routes and APIs.
6. **Sidebar**: Filter nav by role.
7. **Admin dashboard**: New `/dashboard/admin` with users and usage.
8. **API protection**: Enforce role on management and admin endpoints.
9. **Usage attribution**: Add `userId` to usage records; admin aggregation API and UI.

---

## 6. Files to Create/Modify

| Area | Files |
|------|-------|
| **Port** | `package.json`, `.env`, `.env.example` |
| **Users** | `src/lib/localDb.js` (users table), migration |
| **Auth** | `src/app/api/auth/login/route.js`, `src/lib/auth/login.js` |
| **Proxy** | `src/proxy.js` (or middleware) for role checks |
| **Admin UI** | `src/app/(dashboard)/dashboard/admin/page.js`, users table, usage summary |
| **Sidebar** | `src/shared/components/Sidebar.js` (role-based nav) |
| **Admin APIs** | `src/app/api/admin/users/route.js`, `src/app/api/admin/usage/route.js` |
| **Usage** | Usage storage to include `userId` where applicable |

---

## 7. Env Additions

```bash
# Superadmin bootstrap (optional if using seed script)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme_on_first_login

# Or keep existing for backward compat during migration
INITIAL_PASSWORD=admin
```

---

## 8. Open Questions

1. **Multi-tenant vs single-node**: Is this one router instance per machine with multiple dashboard users, or one central portal serving many nodes?
2. **API keys**: Are keys global or per-user? Affects usage attribution.
3. **Port**: Which app must move off 3000? Router (20128) and Website (21280) already use other ports.
4. **Backward compatibility**: Support legacy single-password during migration?
