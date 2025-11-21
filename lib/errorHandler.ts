import { logErrorToFile } from './errorLogger'

/**
 * Global error handler for Next.js
 * This will catch unhandled errors and log them to file
 */
export function setupErrorHandling() {
  if (typeof window !== 'undefined') {
    console.log('[Error Handler] Setting up client-side error handling')
    
    // Client-side error handling
    window.addEventListener('error', (event) => {
      // Skip ResizeObserver errors - these are benign browser warnings
      const errorMessage = event.message || ''
      const lowerMessage = errorMessage.toLowerCase()
      
      if (lowerMessage.includes('resizeobserver') || 
          lowerMessage.includes('resizeobserver loop') ||
          lowerMessage.includes('resizeobserver loop completed')) {
        // Silently ignore ResizeObserver errors - don't log or console.error
        return
      }
      
      console.error('[Error Handler] Window error caught:', event.message, event.filename, event.lineno)
      const error = event.error || new Error(event.message || 'Unknown error')
      logErrorToFile(error, {
        type: 'window-error',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      })
    })

    window.addEventListener('unhandledrejection', (event) => {
      console.error('[Error Handler] Unhandled rejection caught:', event.reason)
      const error = event.reason instanceof Error 
        ? event.reason 
        : new Error(String(event.reason || 'Unhandled promise rejection'))
      logErrorToFile(error, {
        type: 'unhandled-rejection',
      })
    })
    
    console.log('[Error Handler] Client-side error handlers registered')
  }

  if (typeof process !== 'undefined' && typeof window === 'undefined') {
    // Server-side error handling - use dynamic import to avoid bundling fs in client
    import('./errorLogger.server').then(({ logErrorToFileServer }) => {
      process.on('uncaughtException', (error) => {
        logErrorToFileServer(error, {
          type: 'uncaught-exception',
        })
      })

      process.on('unhandledRejection', (reason) => {
        const error = reason instanceof Error 
          ? reason 
          : new Error(String(reason || 'Unhandled promise rejection'))
        logErrorToFileServer(error, {
          type: 'unhandled-rejection',
        })
      })
    }).catch((err) => {
      console.error('[Error Handler] Failed to load server logger:', err)
    })
  }
}

