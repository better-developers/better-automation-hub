# 06 — Auth (BetterAuth + Microsoft Entra ID, multi-tenant, JWT sessions)

## Architecture decisions

| Decision | Choice | Reason |
|---|---|---|
| Provider | Microsoft Entra ID (multi-tenant) | Works for personal + work accounts across any tenant |
| Session storage | JWT (stateless) | No `auth_sessions` table needed — simpler schema, works well for a single-user app |
| Access control | Email allowlist in env var | Multi-tenant means *any* Microsoft account could log in — we lock it down to your email |
| BetterAuth tables | `auth_users` + `auth_accounts` only | JWT sessions don't need `auth_sessions` or `auth_verifications` |

---

## Entra app registration (from scratch)

1. Go to [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**
2. **Name:** `Better Automation Hub`
3. **Supported account types:** `Accounts in any organizational directory and personal Microsoft accounts` ← multi-tenant
4. **Redirect URI:**
   - Platform: **Web**
   - URI: `https://your-app.yourdomain.com/api/auth/callback/microsoft`
   - Also add for local dev: `http://localhost:3000/api/auth/callback/microsoft`
5. Click **Register**. Note:
   - **Application (client) ID** → `ENTRA_CLIENT_ID`
   - **Directory (tenant) ID** → this will be `common` for multi-tenant (not your specific tenant ID)
6. Go to **Certificates & secrets** → **Client secrets** → **New client secret**
   - Description: `claude-hub-prod`
   - Expiry: 24 months
   - Copy the **Value** immediately → `ENTRA_CLIENT_SECRET`
7. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated**:
   - `openid`, `profile`, `email`, `offline_access` (auth baseline)
   - `Mail.ReadWrite`, `Mail.Send` (Outlook integration)
   - `ChannelMessage.Read.All`, `ChannelMessage.Send` (Teams integration)
   - Click **Grant admin consent for [your org]**

> **Multi-tenant note:** With `accounts in any org`, anyone with a Microsoft account can attempt login. The email allowlist in the BetterAuth callback is the gate that stops anyone but you from getting in.

---

## Install

```bash
npm install better-auth
```

---

## `lib/auth.ts`

```typescript
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from './db/client'
import * as schema from './db/schema'
import { eq } from 'drizzle-orm'

const ALLOWED_EMAILS = process.env.ALLOWED_EMAILS!.split(',').map(e => e.trim())

export const auth = betterAuth({
  // JWT sessions — no session table in Postgres
  session: {
    strategy: 'jwt',
    // JWT is signed with BETTER_AUTH_SECRET, expires after 30 days
    expiresIn: 60 * 60 * 24 * 30,
    updateAge:  60 * 60 * 24,       // refresh if older than 1 day
  },

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user:    schema.authUsers,
      account: schema.authAccounts,
      // No session or verification tables — JWT mode
    },
  }),

  socialProviders: {
    microsoft: {
      clientId:     process.env.ENTRA_CLIENT_ID!,
      clientSecret: process.env.ENTRA_CLIENT_SECRET!,
      // 'common' = multi-tenant (any Microsoft org or personal account)
      tenantId: 'common',
    },
  },

  callbacks: {
    async signIn({ user }) {
      // Hard gate — only your email(s) can log in
      if (!ALLOWED_EMAILS.includes(user.email ?? '')) {
        return { error: 'Access denied' }
      }

      // Upsert into app users table (separate from BetterAuth's auth_users)
      await db
        .insert(schema.users)
        .values({ id: user.id, email: user.email!, name: user.name ?? '' })
        .onConflictDoUpdate({
          target: schema.users.id,
          set: { name: user.name ?? '' },
        })

      return true
    },
  },
})
```

---

## Drizzle schema additions

JWT sessions don't need `auth_sessions` or `auth_verifications`. Only two BetterAuth tables are required. Add to `lib/db/schema.ts`:

```typescript
// BetterAuth user table (managed by BetterAuth — do not rename columns)
export const authUsers = pgTable('auth_users', {
  id:            text('id').primaryKey(),
  name:          text('name').notNull(),
  email:         text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image:         text('image'),
  createdAt:     timestamp('created_at').notNull(),
  updatedAt:     timestamp('updated_at').notNull(),
})

// BetterAuth OAuth accounts (stores Microsoft access + refresh tokens)
export const authAccounts = pgTable('auth_accounts', {
  id:                    text('id').primaryKey(),
  accountId:             text('account_id').notNull(),
  providerId:            text('provider_id').notNull(),
  userId:                text('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  accessToken:           text('access_token'),
  refreshToken:          text('refresh_token'),
  idToken:               text('id_token'),
  accessTokenExpiresAt:  timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope:                 text('scope'),
  password:              text('password'),
  createdAt:             timestamp('created_at').notNull(),
  updatedAt:             timestamp('updated_at').notNull(),
})
```

`authUsers.id` and `users.id` share the same value (the Entra object ID). Your app's `users` table foreign keys all reference `users.id`.

---

## API route handler

```typescript
// app/api/auth/[...all]/route.ts
import { auth } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'

export const { GET, POST } = toNextJsHandler(auth)
```

---

## Auth guard for API routes

```typescript
// lib/auth-guard.ts
import { auth } from './auth'
import { headers } from 'next/headers'

export async function requireSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })
  if (!session?.user) {
    throw new Response('Unauthorized', { status: 401 })
  }
  return session   // session.user.id is your Postgres users.id
}
```

---

## Browser client

```typescript
// lib/auth-client.ts
import { createAuthClient } from 'better-auth/react'

export const { signIn, signOut, useSession } = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL!,
})
```

### Sign-in page — `app/login/page.tsx`

```typescript
'use client'
import { signIn } from '@/lib/auth-client'

export default function LoginPage() {
  return (
    <div className="flex h-screen items-center justify-center">
      <button
        onClick={() => signIn.social({ provider: 'microsoft', callbackURL: '/board' })}
        className="flex items-center gap-2 rounded-lg border px-6 py-3 text-sm font-medium hover:bg-muted"
      >
        Sign in with Microsoft
      </button>
    </div>
  )
}
```

---

## Middleware

```typescript
// middleware.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

export async function middleware(req: NextRequest) {
  const isAuthRoute = req.nextUrl.pathname.startsWith('/api/auth')
  const isLoginPage = req.nextUrl.pathname === '/login'

  if (isAuthRoute || isLoginPage) return NextResponse.next()

  const session = await auth.api.getSession({ headers: req.headers })
  if (!session?.user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

---

## Using the stored Microsoft token in the agent (bonus)

BetterAuth stores the Microsoft `access_token` from the OAuth flow in `auth_accounts`. The agent can read this and pass it directly to the ms-365-mcp-server, skipping a separate MCP auth flow:

```typescript
// packages/agent/src/ms-token.ts
import { db } from './db'
import { authAccounts } from '../../apps/web/lib/db/schema'
import { and, eq } from 'drizzle-orm'

export async function getMsAccessToken(userId: string): Promise<string> {
  const [account] = await db
    .select({
      accessToken:  authAccounts.accessToken,
      expiresAt:    authAccounts.accessTokenExpiresAt,
      refreshToken: authAccounts.refreshToken,
    })
    .from(authAccounts)
    .where(and(
      eq(authAccounts.userId, userId),
      eq(authAccounts.providerId, 'microsoft')
    ))

  if (!account?.accessToken) throw new Error('No Microsoft token found — user must log in first')

  // Token expiry check — if expired, trigger refresh via BetterAuth
  const expired = account.expiresAt && new Date(account.expiresAt) < new Date()
  if (expired) {
    // BetterAuth handles refresh automatically on next API call,
    // but for the agent you may need to call the refresh endpoint manually
    // or ensure the user has recently logged in.
    console.warn('[ms-token] access token expired — refresh needed')
  }

  return account.accessToken
}
```

Then in the integration:
```typescript
const token = await getMsAccessToken(trigger.userId)
const mcpServers = [{
  type: 'url' as const,
  url: process.env.MS365_MCP_URL!,
  name: 'ms365',
  headers: { Authorization: `Bearer ${token}` },
}]
```

This is the cleanest path since both the web app and the agent share the same Postgres — one login, one token, no separate credential management for the MCP server.

---

## Environment variables

```env
# Entra (multi-tenant)
ENTRA_CLIENT_ID=<Application (client) ID>
ENTRA_CLIENT_SECRET=<Client secret value>
# Note: no ENTRA_TENANT_ID needed — tenantId is hardcoded to 'common' in auth.ts

# BetterAuth
BETTER_AUTH_SECRET=<openssl rand -hex 32>
BETTER_AUTH_URL=https://your-app.yourdomain.com

# Allowlist — comma-separated, only these emails can log in
ALLOWED_EMAILS=casper@betterdevelopers.dk

# Browser
NEXT_PUBLIC_APP_URL=https://your-app.yourdomain.com
```

---

## Migration

```bash
# Generate migration for the two new BetterAuth tables
npx drizzle-kit generate
npx drizzle-kit migrate
```

---

## Tasks checklist

### Entra app registration
- [ ] Create new app registration in portal.azure.com
- [ ] Set supported account types: multi-tenant (any org + personal)
- [ ] Add redirect URIs (prod + localhost)
- [ ] Add MS Graph delegated permissions + grant admin consent
- [ ] Copy `ENTRA_CLIENT_ID` and `ENTRA_CLIENT_SECRET`

### Code
- [ ] `npm install better-auth`
- [ ] Add `authUsers` + `authAccounts` tables to Drizzle schema
- [ ] Run `npx drizzle-kit migrate`
- [ ] Create `lib/auth.ts` — JWT strategy, `tenantId: 'common'`, email allowlist
- [ ] Create `app/api/auth/[...all]/route.ts`
- [ ] Create `lib/auth-client.ts`
- [ ] Create `lib/auth-guard.ts`
- [ ] Create `middleware.ts`
- [ ] Create `app/login/page.tsx`
- [ ] Add env vars to Coolify + local `.env.local`

### Testing
- [ ] Sign in with your Microsoft account → redirected to `/board`
- [ ] Attempt sign in with a different Microsoft account → blocked with "Access denied"
- [ ] `session.user.id` is your Entra object ID and matches `users.id` in Postgres
- [ ] JWT cookie is set (check browser devtools → Application → Cookies)
- [ ] (Optional) `auth_accounts` row has `access_token` — verify via Postgres query
