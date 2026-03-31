import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from './db/client'
import * as schema from './db/schema'

const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean)

export const auth = betterAuth({
  session: {
    strategy: 'jwt',
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,       // refresh if older than 1 day
  },

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user:         schema.authUsers,
      account:      schema.authAccounts,
      verification: schema.authVerifications,
    },
  }),

  socialProviders: {
    microsoft: {
      clientId:     process.env.ENTRA_CLIENT_ID!,
      clientSecret: process.env.ENTRA_CLIENT_SECRET!,
      tenantId:     'common',
    },
  },

  callbacks: {
    async signIn({ user }: { user: { id: string; email?: string | null; name?: string | null } }) {
      if (!ALLOWED_EMAILS.includes(user.email ?? '')) {
        return false
      }

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
