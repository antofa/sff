import "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id?: string
      name?: string | null
      email?: string | null
      image?: string | null
      discordId?: string
      username?: string
      avatar?: string
      discriminator?: string
    }
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    discordId?: string
    username?: string
    avatar?: string
    discriminator?: string
  }
}

