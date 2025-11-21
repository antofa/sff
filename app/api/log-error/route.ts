import { NextRequest, NextResponse } from 'next/server'
import { logErrorToFileServer } from '@/lib/errorLogger.server'

export async function POST(request: NextRequest) {
  try {
    console.log('[API Route] Received error log request')
    const body = await request.json()
    const { error, context } = body

    console.log('[API Route] Error data:', { 
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
    console.log('[API Route] Logging error to file:', errorObj.message)
    logErrorToFileServer(errorObj, context)
    console.log('[API Route] Error logged successfully')

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API Route] Error logging error:', error)
    return NextResponse.json(
      { error: 'Failed to log error' },
      { status: 500 }
    )
  }
}

