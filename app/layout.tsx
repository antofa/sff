import type { Metadata } from 'next'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { SessionProvider } from '@/components/SessionProvider'
import { ErrorHandler } from './error-handler'
import { installConsoleTimestamp } from '@/lib/consoleTimestamp'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './globals.css'

installConsoleTimestamp()

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
      <body>
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
              <Notifications
                position="top-right"
                limit={1}
                autoClose={4000}
                containerWidth={420}
                notificationMaxHeight={240}
                transitionDuration={0}
                zIndex={4500}
                styles={{
                  root: {
                    minWidth: 360,
                  },
                }}
              />
              {children}
            </ErrorBoundary>
          </MantineProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
