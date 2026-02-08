'use client'

import { useEffect } from 'react'
import { setupErrorHandling } from '@/lib/errorHandler'
import { logErrorToFile } from '@/lib/errorLogger'
import { logWithTimestamp } from '@/lib/logger'
import { installConsoleTimestamp } from '@/lib/consoleTimestamp'
import { isBrowserExtensionError } from '@/lib/clientErrorFilters'

export function ErrorHandler() {
  useEffect(() => {
    installConsoleTimestamp()
    logWithTimestamp('[ErrorHandler] Component mounted, setting up error handling')
    setupErrorHandling()
    
    // Also intercept Next.js dev overlay errors
    if (typeof window !== 'undefined') {
      // Try to intercept Next.js dev overlay errors
      const originalConsoleError = console.error
      console.error = (...args: any[]) => {
        originalConsoleError.apply(console, args)

        // Check if this is a React/Next.js error (but skip image loading errors and ResizeObserver errors)
        const errorStringRaw = args.map(arg => {
          if (typeof arg === 'string') return arg
          if (arg instanceof Error) return arg.message
          return String(arg)
        }).join(' ')
        const errorString = errorStringRaw.toLowerCase()

        // Ignore browser extension errors (for example MetaMask inpage script failures)
        if (isBrowserExtensionError({ message: errorStringRaw, args })) {
          return
        }
        
        // Skip ResizeObserver errors - these are benign browser warnings
        if (errorString.includes('resizeobserver') || 
            errorString.includes('resizeobserver loop') ||
            errorString.includes('resizeobserver loop completed')) {
          return
        }
        
        // Skip image loading errors - they're expected for missing images
        if (errorString.includes('image failed') || 
            errorString.includes('image not found') ||
            errorString.includes('Image failed') ||
            errorString.includes('Solbind image failed') ||
            errorString.includes('Image error')) {
          // These are expected errors for missing images, don't log them
          return
        }
        
        if (errorString.includes('error:') || errorString.includes('warning:')) {
          // Try to extract error message
          const errorMatch = errorStringRaw.match(/(?:error|warning):\s*(.+?)(?:\n|$)/i)
          if (errorMatch) {
            const errorMessage = errorMatch[1]
            logWithTimestamp('[ErrorHandler] Intercepted console error:', errorMessage)
            logErrorToFile(new Error(errorMessage), {
              type: 'console-error',
              originalArgs: args.map(arg => String(arg)),
            })
          }
        }
      }
      
      // Also listen for Next.js runtime errors
      if ((window as any).__NEXT_DATA__) {
        logWithTimestamp('[ErrorHandler] Next.js data available')
      }
      
      // Listen for React errors that might not be caught by ErrorBoundary
      const handleUnhandledError = (event: ErrorEvent) => {
        // Skip ResizeObserver errors - these are benign browser warnings
        const errorMessage = event.message || ''
        const lowerMessage = errorMessage.toLowerCase()
        
        if (lowerMessage.includes('resizeobserver') || 
            lowerMessage.includes('resizeobserver loop') ||
            lowerMessage.includes('resizeobserver loop completed')) {
          // Silently ignore ResizeObserver errors
          return
        }

        if (
          isBrowserExtensionError({
            message: event.message,
            filename: event.filename,
            stack: event.error?.stack,
          })
        ) {
          return
        }

        console.error('[ErrorHandler] Unhandled error event:', event.message, event.filename, event.lineno)
        logErrorToFile(event.error || new Error(event.message || 'Unknown error'), {
          type: 'unhandled-error-event',
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        })
      }
      
      window.addEventListener('error', handleUnhandledError)
      
      return () => {
        console.error = originalConsoleError
        window.removeEventListener('error', handleUnhandledError)
      }
    }
  }, [])

  return null
}
