import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from './db/client'
import * as schema from './db/schema'

// Trusted origins for post-login redirects.
// Covers prod + all Coolify preview subdomains (e.g. 8.agents-hub.betterdevelopers.dk).
// Add extra origins via BETTER_AUTH_TRUSTED_ORIGINS (comma-separated).
const TRUSTED_ORIGINS = [
  'https://agents-hub.betterdevelopers.dk',
  'https://auth.agents-hub.betterdevelopers.dk',
  ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
]

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL!, // https://agents-hub.betterdevelopers.dk in prod

  session: {
    strategy: 'jwt',
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,       // refresh if older than 1 day
  },

  advanced: {
    // Cookie scoped to root domain so every *.betterdevelopers.dk subdomain
    // (prod + all preview deployments) shares the same session.
    defaultCookieAttributes: {
      domain:   process.env.NODE_ENV === 'production' ? '.betterdevelopers.dk' : undefined,
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production',
    },
    // BetterAuth validates callbackURL against this list before redirecting.
    // Preview URLs pass `window.location.origin` as callbackURL — add each one here
    // or set BETTER_AUTH_TRUSTED_ORIGINS in Coolify with the preview origin.
    trustedOrigins: TRUSTED_ORIGINS,
  },

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user:         schema.authUsers,
      account:      schema.authAccounts,
      session:      schema.authSessions,
      verification: schema.authVerifications,
    },
  }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },

  socialProviders: {
    microsoft: {
      clientId:     process.env.ENTRA_CLIENT_ID!,
      clientSecret: process.env.ENTRA_CLIENT_SECRET!,
      tenantId:     'common',
    },
  },

  callbacks: {
    async signIn({ user }: { user: { id: string; email?: string | null; name?: string | null } }) {
      // Upsert the app-level users row — id mirrors authUsers.id
      await db
        .insert(schema.users)
        .values({
          id:    user.id,
          email: user.email!,
          name:  user.name ?? '',
        })
        .onConflictDoUpdate({
          target: schema.users.id,
          set:    { name: user.name ?? '' },
        })

      return true
    },
  },
})
