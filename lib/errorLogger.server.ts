import fs from 'fs'
import path from 'path'
import { logWithTimestamp } from './logger'

const ERROR_LOG_DIR = path.join(process.cwd(), 'logs')
const ERROR_LOG_FILE = path.join(ERROR_LOG_DIR, 'nextjs-errors.log')

// Ensure logs directory exists
if (!fs.existsSync(ERROR_LOG_DIR)) {
  fs.mkdirSync(ERROR_LOG_DIR, { recursive: true })
}

/**
 * Log error to file (server-side only)
 */
export function logErrorToFileServer(error: Error | string, context?: Record<string, any>) {
  try {
    const timestamp = new Date().toISOString()
    const errorMessage = error instanceof Error ? error.message : error
    const errorStack = error instanceof Error ? error.stack : undefined
    
    const logEntry = {
      timestamp,
      error: errorMessage,
      stack: errorStack,
      context: context || {},
    }
    
    const logLine = JSON.stringify(logEntry, null, 2) + '\n' + '---\n'
    
    logWithTimestamp('[Error Logger Server] Writing error to file:', ERROR_LOG_FILE)
    logWithTimestamp('[Error Logger Server] Error message:', errorMessage)
    
    // Append to log file
    fs.appendFileSync(ERROR_LOG_FILE, logLine, 'utf-8')
    
    logWithTimestamp('[Error Logger Server] Error written to file successfully')
    
    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('[Error Logger]', logEntry)
    }
  } catch (logError) {
    // Fallback to console if file logging fails
    console.error('[Error Logger] Failed to write to log file:', logError)
    console.error('[Error Logger] File path:', ERROR_LOG_FILE)
    console.error('[Error Logger] File exists:', fs.existsSync(ERROR_LOG_FILE))
    console.error('[Error Logger] Directory exists:', fs.existsSync(ERROR_LOG_DIR))
    console.error('[Error Logger] Original error:', error)
  }
}
