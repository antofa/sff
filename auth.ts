import NextAuth from "next-auth"
import Discord from "next-auth/providers/discord"

export const { handlers, signIn, signOut, auth } = NextAuth({
  debug: process.env.NODE_ENV !== "production",
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "identify email",
        },
      },
    }),
  ],
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
