'use client'

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react"

interface Props {
  children: React.ReactNode
  enabled?: boolean
}

export function SessionProvider({ children, enabled = true }: Props) {
  if (!enabled) {
    return (
      <NextAuthSessionProvider session={null} refetchInterval={0} refetchOnWindowFocus={false}>
        {children}
      </NextAuthSessionProvider>
    )
  }

  return (
    <NextAuthSessionProvider>
      {children}
    </NextAuthSessionProvider>
  )
}
