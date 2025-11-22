/**
 * Log error to file (server-side) or send to API (client-side)
 * This function works on both client and server
 */
export function logErrorToFile(error: Error | string, context?: Record<string, any>) {
  const timestamp = new Date().toISOString()
  const errorMessage = error instanceof Error ? error.message : error
  const errorStack = error instanceof Error ? error.stack : undefined
  
  const logEntry = {
    timestamp,
    error: errorMessage,
    stack: errorStack,
    context: context || {},
  }

  // Client-side: send to API route
  if (typeof window !== 'undefined') {
    console.log('[Error Logger] Attempting to log error to API:', errorMessage)
    fetch('/api/log-error', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: {
          message: errorMessage,
          stack: errorStack,
        },
        context,
      }),
    })
    .then(async (response) => {
      if (!response.ok) {
        console.error('[Error Logger] API returned error status:', response.status, response.statusText)
        const text = await response.text()
        console.error('[Error Logger] API error response:', text)
        return
      }
      console.log('[Error Logger] Error successfully logged to API')
      return response.json()
    })
    .catch((fetchError) => {
      console.error('[Error Logger] Failed to send error to API:', fetchError)
      console.error('[Error Logger] Original error:', logEntry)
    })
    return
  }

  // Server-side: this should not be called directly from client components
  // Server-side logging is handled by errorLogger.server.ts
  console.error('[Error Logger] Server-side logging should use logErrorToFileServer')
  console.error('[Error Logger] Original error:', logEntry)
}

/**
 * Log React error boundary error
 */
export function logReactError(error: Error, errorInfo?: { componentStack?: string }) {
  logErrorToFile(error, {
    type: 'react-error-boundary',
    componentStack: errorInfo?.componentStack,
  })
}

/**
 * Log Next.js runtime error
 */
export function logNextJsError(error: Error, context?: Record<string, any>) {
  logErrorToFile(error, {
    type: 'nextjs-runtime',
    ...context,
  })
}

