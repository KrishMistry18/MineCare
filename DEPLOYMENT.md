# MineCare — Production Cloud Deployment Guide

This document details the production cloud deployment architecture, configuration, health monitoring, and security boundaries for MineCare.

---

## 1. Target Architecture Overview

```
                      +-----------------------------+
                      |   Vercel Edge Network       |
                      |   (MineCare React Frontend)  |
                      |   SPA on Vite + HTTPS       |
                      +--------------+--------------+
                                     |
               REST / Realtime SSE   |  Safe Browser Calls:
               via VITE_API_URL      |  VITE_SUPABASE_URL + ANON_KEY
                                     v
                      +-----------------------------+
                      |    Render Web Service       |
                      |    (MineCare Node.js API)   |
                      |    0.0.0.0:PORT (Render)    |
                      +--------------+--------------+
                                     |
                 Pooled PostgreSQL   |  GoTrue Admin API:
                 via DATABASE_URL    |  SUPABASE_SERVICE_ROLE_KEY
                                     v
                      +-----------------------------+
                      |   Supabase Cloud Platform   |
                      |  - Managed PostgreSQL 17    |
                      |  - GoTrue Auth Service      |
                      |  - Row Level Security (RLS) |
                      |  - Realtime Changefeed Bus  |
                      +-----------------------------+
```

| Component | Cloud Host | Role & Responsibilities |
|---|---|---|
| **Frontend** | **Vercel** | SPA static hosting, client routing rewrite (`index.html`), security headers, public Supabase anon client |
| **Backend** | **Render** | Versioned REST API (`/api/v1/*`), health & readiness probes (`/livez`, `/readyz`), CORS policy enforcement, rate limiting, safety & alert engines, device auth boundary |
| **Database & Auth** | **Supabase** | Authoritative PostgreSQL database, GoTrue user password auth, RLS enforcement, persistent token revocations |

---

## 2. Environment Variables Specification

### A. Frontend Environment Variables (Configure in Vercel Dashboard)

> [!IMPORTANT]
> Only variables prefixed with `VITE_` are bundled into the client bundle and served to web browsers. **NEVER** expose backend secrets (such as `DATABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`) with a `VITE_` prefix.

| Variable Name | Required | Example / Description |
|---|:---:|---|
| `VITE_API_URL` | **Yes** | `https://minecare-api.onrender.com` — Base URL of the backend API deployed on Render (no trailing slash). |
| `VITE_SUPABASE_URL` | **Yes** | `https://<project-ref>.supabase.co` — Remote Supabase project URL for browser-side auth session synchronization. |
| `VITE_SUPABASE_ANON_KEY` | **Yes** | `eyJhbGciOiJIUz...` — Public Supabase Anonymous Key (safe for client-side distribution). |

### B. Backend Environment Variables (Configure in Render Dashboard)

> [!CAUTION]
> These variables are strictly server-side. Do not expose them in client environments or commit them to public version control repositories.

| Variable Name | Required | Example / Description |
|---|:---:|---|
| `NODE_ENV` | **Yes** | `production` — Disables demo auth fallbacks and strictly requires real database connectivity. |
| `HOST` | **Yes** | `0.0.0.0` — Binds to all network interfaces for containerized environments. |
| `PORT` | Auto | Provided dynamically by Render (defaults to `3001` if unset). |
| `DATABASE_URL` | **Yes** | `postgresql://postgres.[ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true` — Supabase PostgreSQL connection string (Transaction Pooler port 6543 or Session Direct port 5432). |
| `SUPABASE_URL` | **Yes** | `https://<project-ref>.supabase.co` — Server-side endpoint for Supabase Auth admin API. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | `eyJhbGciOiJIUz...` — Service-role secret for administrative GoTrue user management and server verification. |
| `SUPABASE_ANON_KEY` | Optional | `eyJhbGciOiJIUz...` — Public anon key for fallback client initialization. |
| `SUPABASE_JWT_SECRET` | Optional | Secret key used for symmetric HMAC-SHA256 JWT validation. |
| `CORS_ORIGIN` | **Yes** | `https://minecare.vercel.app` — Comma-separated list of permitted frontend origins. Wildcard `*` is strictly blocked in production. |
| `MINECARE_DEVICE_SECRET` | Optional | Shared gateway secret for hardware gateway token authentication. |
| `MINECARE_REVOKED_DEVICE_TOKENS` | Optional | Comma-separated list of revoked hardware tokens. |

---

## 3. Step-by-Step Setup Guides

### Step 1: Supabase Setup (Database & Authentication)

1. Create a Supabase Project at [database.new](https://database.new).
2. Retrieve connection strings from **Project Settings > Database**:
   - Connection string (URI) using **Transaction Pooler** (`port 6543`) or **Direct connection** (`port 5432`).
3. Retrieve API keys from **Project Settings > API**:
   - **Project URL**: `https://<project-ref>.supabase.co`
   - **anon public**: Publishable key.
   - **service_role secret**: Secret key.
4. Run schema migrations and fleet seeding:
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
5. Verify live database and auth functionality:
   ```bash
   npm run verify:supabase
   ```

### Step 2: Render Setup (Backend API Web Service)

1. Connect your GitHub repository to [Render](https://render.com).
2. Create a new **Web Service**:
   - **Name**: `minecare-backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/readyz`
3. Configure the Environment Variables listed in **Section 2.B**:
   - Set `NODE_ENV=production`
   - Set `HOST=0.0.0.0`
   - Set `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGIN`.
4. Deploy the service.
5. Verify health:
   - Request `https://<render-service-url>/livez` -> Expect HTTP 200 `{ "status": "ALIVE", "live": true }`
   - Request `https://<render-service-url>/readyz` -> Expect HTTP 200 `{ "status": "READY", "ready": true, "database": "CONNECTED" }`

### Step 3: Vercel Setup (Frontend Web Application)

1. Connect your GitHub repository to [Vercel](https://vercel.com).
2. Create a new Project:
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Configure Environment Variables listed in **Section 2.A**:
   - `VITE_API_URL`: `https://<render-service-url>`
   - `VITE_SUPABASE_URL`: `https://<project-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: `<anon-key>`
4. Deploy the project.
5. In your Render backend dashboard, update `CORS_ORIGIN` to match your Vercel deployment URL (e.g. `https://minecare.vercel.app`).

---

## 4. Health, Liveness & Readiness Probes

MineCare exposes three health endpoints designed for cloud load balancers and orchestrators:

| Endpoint | HTTP Success | HTTP Failure | Dependency Scope | Purpose |
|---|:---:|:---:|---|---|
| `GET /livez` | `200 OK` | N/A | None (Process runtime only) | **Liveness Probe**: Confirms Node.js event loop is responsive. Never checks database or external services. |
| `GET /readyz` | `200 OK` | `503 Service Unavailable` | PostgreSQL database connection | **Readiness Probe**: Confirms database connection is operational. If PostgreSQL disconnects, returns 503 so traffic is temporarily rerouted. |
| `GET /healthz` | `200 OK` | `503 Service Unavailable` | Full system health report | **Operational Health**: Detailed diagnostic breakdown including uptime and service statuses. |

---

## 5. Production Security Requirements & Hardening

1. **Strict CORS Policy**:
   - In production, cross-origin requests from origins NOT in `CORS_ORIGIN` are immediately rejected with HTTP 403 `CORS origin not allowed`.
   - Wildcard `*` origin is strictly forbidden in production.
2. **Credential Segregation**:
   - `DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` reside exclusively on Render.
   - Browser client receives only `VITE_SUPABASE_ANON_KEY` subject to Row Level Security (RLS).
3. **Hardware Boundary Isolation**:
   - Sensor nodes authenticate via dedicated `X-Device-Token` headers.
   - Tokens are bound to helmet identifiers (format: `mc_dev_<helmetId>`).
   - Mismatched, fake, or revoked device tokens are rejected with HTTP 401/403.
4. **Sanitized Error Envelopes**:
   - Internal database query errors and stack traces are suppressed in production.
   - Client responses receive uniform `{ error: { code, message, requestId } }` envelopes with `X-Request-ID` correlation.
5. **Multi-Tier Rate Limiting**:
   - `AUTH`: 5 attempts per 15 minutes per IP/email.
   - `TELEMETRY`: 120 packets per minute per device/IP.
   - `ADMIN`: 60 requests per minute per admin account.
   - `GENERAL`: 300 requests per minute per IP.

---

## 6. ESP8266 Device Provisioning, Revocation & Rotation Procedures

### A. Device Credential Architecture

Each physical MineCare helmet node (ESP8266) is provisioned with a dedicated, high-entropy cryptographic hardware credential:
- **Format**: `mc_live_<helmetId>_<64-character-hex-entropy>` (e.g. `mc_live_MC-001_...`).
- **Entropy**: 256 bits of cryptographically secure pseudo-random entropy generated via Node.js `crypto.randomBytes(32)`.
- **Storage Policy (Zero Plaintext Secrets)**:
  - The raw token is returned **EXACTLY ONCE** in the HTTP 201 response body upon provisioning.
  - The database persistently stores only the cryptographic **SHA-256 digest** (`token_hash`), a safe 16-character prefix (`token_prefix`), helmet binding (`helmet_id`), creation metadata, and revocation state.
  - Raw tokens are **NEVER** stored in any database table, configuration file, browser response (other than the initial 201 response), or server log.
- **Telemetry Boundary Enforcement**:
  - Microcontrollers provide credentials via HTTP header: `X-Device-Token: <raw-device-token>`.
  - In production mode (`NODE_ENV=production`), incoming telemetry packets are strictly validated against persistent hashed credentials in PostgreSQL.
  - Strict helmet binding is enforced: using Helmet A's token to send telemetry for Helmet B results in `403 Forbidden`.
  - Human user JWTs (`Bearer ...` or `eyJ...`) are rejected with `401 Unauthorized`.
  - Prototype dev fallback tokens (`mc_dev_*`) are blocked in production.

### B. Device Provisioning Procedure

To commission a physical ESP8266 helmet node:

1. Authenticate as a user with the `ADMIN` role and obtain a valid session access token.
2. Send an administrative provisioning request:
   ```http
   POST /api/v1/admin/helmets/MC-001/device-token
   Host: api.minecare.local
   Authorization: Bearer <ADMIN_SESSION_TOKEN>
   Content-Type: application/json

   {
     "name": "MineCare Helmet MC-001 ESP8266 Node"
   }
   ```
3. Receive the one-time provisioning response:
   ```http
   HTTP/1.1 201 Created
   Content-Type: application/json

   {
     "success": true,
     "message": "Device token provisioned successfully. Record this token immediately; it cannot be retrieved again.",
     "token": "mc_live_MC-001_a9f3b8c2d1e0f4...",
     "helmetId": "MC-001",
     "tokenPrefix": "mc_live_MC-001_a",
     "createdAt": "2026-10-09T11:00:00.000Z",
     "name": "MineCare Helmet MC-001 ESP8266 Node"
   }
   ```
4. Securely flash or write the raw token into the ESP8266 non-volatile EEPROM/SPIFFS storage during hardware commissioning.
5. Inspect device token metadata (safe public verification):
   ```http
   GET /api/v1/admin/helmets/MC-001/device-token
   Authorization: Bearer <ADMIN_SESSION_TOKEN>
   ```

### C. Safe Atomic Rotation Procedure

When rotating credentials (scheduled maintenance or firmware re-flashing):

1. Submit a new provisioning request for the target helmet:
   ```http
   POST /api/v1/admin/helmets/MC-001/device-token
   Authorization: Bearer <ADMIN_SESSION_TOKEN>
   ```
2. The backend executes an atomic database transaction:
   - Any currently active token for `MC-001` is marked with `revoked_at = NOW()` and `revocation_reason = 'ROTATED'`.
   - The newly generated token hash is inserted and activated.
   - Historical telemetry packets and helmet database records are **never deleted or altered**.
3. Flash the new token to the physical ESP8266 helmet.
4. Old credentials are now rejected with `401 Unauthorized` while telemetry resumes with the new credential.

### D. Emergency Revocation Procedure

If a helmet is reported lost, stolen, or compromised:

1. Issue an immediate administrative revocation:
   ```http
   POST /api/v1/admin/helmets/MC-001/device-token/revoke
   Authorization: Bearer <ADMIN_SESSION_TOKEN>
   Content-Type: application/json

   {
     "reason": "Hardware node reported lost in Sector 4"
   }
   ```
2. The backend immediately revokes the active token in PostgreSQL.
3. Subsequent telemetry submissions using the revoked credential are automatically rejected (`401 Unauthorized`).
4. An audit log entry (`DEVICE_TOKEN_REVOKED`) is permanently written with timestamp and admin identity.

### E. Recovery & Re-Commissioning Procedure

1. Inspect the physical unit or verify hardware integrity.
2. Perform standard device provisioning as described in Section 6.B to issue a fresh credential.
3. Flash the new credential to the helmet microcontroller.
4. Verify telemetry reception and helmet transition to `ONLINE`.
