import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const SERVER_ACTION_HEADER = 'next-action'

export function proxy(request: NextRequest) {
  // This app does not use Next.js Server Actions.
  // Reject stray/stale Next-Action POST requests early to avoid noisy runtime errors.
  if (request.method === 'POST' && request.headers.has(SERVER_ACTION_HEADER)) {
    return NextResponse.json(
      {
        error: 'Invalid server action request for this deployment. Please reload the page and try again.',
      },
      {
        status: 409,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Exclude static assets and API routes.
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
}

