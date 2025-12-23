import { NextRequest, NextResponse } from 'next/server'
import { logErrorToFileServer } from '@/lib/errorLogger.server'
import { logWithTimestamp } from '@/lib/logger'

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 30

type RateLimitEntry = { count: number; resetAt: number }
const rateLimitMap = new Map<string, RateLimitEntry>()

const getClientKey = (request: NextRequest) => {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown'
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  const cfIp = request.headers.get('cf-connecting-ip')
  if (cfIp) return cfIp.trim()
  return request.ip || 'unknown'
}

const checkRateLimit = (key: string) => {
  const now = Date.now()
  const existing = rateLimitMap.get(key)
  let entry = existing
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
  }
  entry.count += 1
  rateLimitMap.set(key, entry)
  return {
    allowed: entry.count <= RATE_LIMIT_MAX,
    resetAt: entry.resetAt,
  }
}

export async function POST(request: NextRequest) {
  const clientKey = getClientKey(request)
  const rate = checkRateLimit(clientKey)
  if (!rate.allowed) {
    const retryAfterSec = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      {
        status: 429,
        headers: {
          'Retry-After': retryAfterSec.toString(),
        },
      }
    )
  }

  try {
    logWithTimestamp('[API Route] Received error log request')
    const body = await request.json()
    const { error, context } = body

    logWithTimestamp('[API Route] Error data:', { 
      hasError: !!error, 
      errorMessage: error?.message,
      contextType: context?.type 
    })

    if (!error) {
      console.error('[API Route] No error provided in request')
      return NextResponse.json(
        { error: 'Error message is required' },
        { status: 400 }
      )
    }

    // Create Error object from the error data
    const errorObj = error.message 
      ? new Error(error.message)
      : new Error(String(error))

    if (error.stack) {
      errorObj.stack = error.stack
    }

    // Log to file
    logWithTimestamp('[API Route] Logging error to file:', errorObj.message)
    logErrorToFileServer(errorObj, context)
    logWithTimestamp('[API Route] Error logged successfully')

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API Route] Error logging error:', error)
    return NextResponse.json(
      { error: 'Failed to log error' },
      { status: 500 }
    )
  }
}
