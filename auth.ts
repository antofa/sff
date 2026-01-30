import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import Discord from "next-auth/providers/discord"

const discordClientId = process.env.DISCORD_CLIENT_ID
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET
const discordConfigured = Boolean(discordClientId && discordClientSecret)

const authSecret =
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  (process.env.NODE_ENV === "development" ? "dev-secret" : undefined)

const providers = discordConfigured
  ? [
      Discord({
        clientId: discordClientId!,
        clientSecret: discordClientSecret!,
        authorization: {
          params: {
            scope: "identify email",
          },
        },
      }),
    ]
  : [
      Credentials({
        name: "Disabled",
        credentials: {},
        async authorize() {
          return null
        },
      }),
    ]

export const { handlers, signIn, signOut, auth } = NextAuth({
  debug: process.env.NODE_ENV !== "production",
  secret: authSecret,
  providers,
  trustHost: true,
  callbacks: {
    async jwt({ token, account, profile }) {
      // Save Discord data to token on first login
      if (account && profile) {
        token.discordId = profile.id
        token.username = profile.username
        token.avatar = profile.avatar
        token.discriminator = profile.discriminator
      }
      return token
    },
    async session({ session, token }) {
      // Pass Discord data to session
      if (session.user) {
        session.user.discordId = token.discordId as string
        session.user.username = token.username as string
        session.user.avatar = token.avatar as string
        session.user.discriminator = token.discriminator as string
      }
      return session
    },
  },
})
