import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { SessionProvider } from '@/components/SessionProvider'
import { ErrorHandler } from './error-handler'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './globals.css'

const inter = Inter({ subsets: ['latin', 'cyrillic'] })

export const metadata: Metadata = {
  title: 'SolForge Fusion - Deck Viewer',
  description: 'SolForge Fusion Player Deck Viewer',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body className={inter.className}>
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var _colorScheme = window.localStorage.getItem("mantine-color-scheme") || "dark";
                var _defaultColorScheme = "dark";
                var colorScheme = _colorScheme || _defaultColorScheme;
                document.documentElement.setAttribute("data-mantine-color-scheme", colorScheme);
              } catch (e) {}
            `,
          }}
        />
        <SessionProvider>
          <MantineProvider
            defaultColorScheme="dark"
            theme={{
              defaultRadius: 'md',
              components: {
                Paper: {
                  defaultProps: {
                    style: {
                      backgroundColor: 'rgba(30, 41, 59, 0.6)',
                    },
                  },
                },
              },
            }}
          >
            <ErrorHandler />
            <ErrorBoundary>
              <Notifications position="top-right" />
              {children}
            </ErrorBoundary>
          </MantineProvider>
        </SessionProvider>
      </body>
    </html>
  )
}

