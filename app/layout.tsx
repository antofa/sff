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

const headerLogoImage = '/images/logo/too-many-decks-logo.png'
const favicon32Image = '/favicon-32x32.png'
const favicon192Image = '/favicon-192x192.png'
const appleTouchIconImage = '/apple-touch-icon.png'

export const metadata: Metadata = {
  metadataBase: new URL('http://hadoop21.click:3000'),
  title: 'Too Many Decks',
  description: 'SolForge Fusion Player Deck Viewer',
  icons: {
    icon: [
      { url: favicon32Image, sizes: '32x32', type: 'image/png' },
      { url: favicon192Image, sizes: '192x192', type: 'image/png' },
    ],
    shortcut: favicon32Image,
    apple: [{ url: appleTouchIconImage, sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title: 'Too Many Decks',
    description: 'SolForge Fusion Player Deck Viewer',
    type: 'website',
    images: [
      {
        url: headerLogoImage,
        alt: 'Too Many Decks',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Too Many Decks',
    description: 'SolForge Fusion Player Deck Viewer',
    images: [headerLogoImage],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const authEnabled = Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET)

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
        <SessionProvider enabled={authEnabled}>
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
