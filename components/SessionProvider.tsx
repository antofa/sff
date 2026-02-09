'use client'

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react"
import { usePathname } from 'next/navigation'

interface Props {
  children: React.ReactNode
  enabled?: boolean
}

export function SessionProvider({ children, enabled = true }: Props) {
  const pathname = usePathname()
  const authRoute = pathname ? pathname.startsWith('/my-profile') : false
  const shouldEnable = enabled && authRoute
  const providerProps = {
    refetchInterval: 0,
    refetchOnWindowFocus: false,
  } as const

  if (!shouldEnable) {
    return (
      <NextAuthSessionProvider session={null} {...providerProps}>
        {children}
      </NextAuthSessionProvider>
    )
  }

  return (
    <NextAuthSessionProvider {...providerProps}>
      {children}
    </NextAuthSessionProvider>
  )
}
