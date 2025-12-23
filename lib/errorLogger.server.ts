import fs from 'fs'
import path from 'path'
import { logWithTimestamp } from './logger'
import { shouldFallbackToTmp } from './logPaths'
import { pruneOldLogs } from './logRotation'

const DEFAULT_ERROR_LOG_DIR = path.join(process.cwd(), 'logs')
const FALLBACK_ERROR_LOG_DIR = process.env.LOGS_FALLBACK_DIR || '/tmp/sff-logs'
let resolvedErrorLogDir: string | null = null

const ensureLogDir = (dir: string) => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return true
  } catch (error: any) {
    if (!shouldFallbackToTmp(error)) {
      console.error('[Error Logger] Failed to ensure log dir:', dir, error)
    }
    return false
  }
}

const resolveErrorLogDir = () => {
  if (resolvedErrorLogDir) return resolvedErrorLogDir
  if (ensureLogDir(DEFAULT_ERROR_LOG_DIR)) {
    resolvedErrorLogDir = DEFAULT_ERROR_LOG_DIR
    return resolvedErrorLogDir
  }
  if (ensureLogDir(FALLBACK_ERROR_LOG_DIR)) {
    console.warn('[Error Logger] Falling back to log dir:', FALLBACK_ERROR_LOG_DIR)
    resolvedErrorLogDir = FALLBACK_ERROR_LOG_DIR
    return resolvedErrorLogDir
  }
  return null
}

/**
 * Log error to file (server-side only)
 */
export function logErrorToFileServer(error: Error | string, context?: Record<string, any>) {
  const timestamp = new Date().toISOString()
  const dateStamp = timestamp.slice(0, 10)

  try {
    const errorMessage = error instanceof Error ? error.message : error
    const errorStack = error instanceof Error ? error.stack : undefined
    const errorLogDir = resolveErrorLogDir()
    if (!errorLogDir) {
      console.error('[Error Logger] Log dir unavailable; falling back to console only')
      console.error('[Error Logger] Original error:', { errorMessage, errorStack, context })
      return
    }

    const errorLogFile = path.join(errorLogDir, `nextjs-errors-${dateStamp}.log`)
    
    const logEntry = {
      timestamp,
      error: errorMessage,
      stack: errorStack,
      context: context || {},
    }
    
    const logLine = JSON.stringify(logEntry, null, 2) + '\n' + '---\n'
    
    logWithTimestamp('[Error Logger Server] Writing error to file:', errorLogFile)
    logWithTimestamp('[Error Logger Server] Error message:', errorMessage)
    void pruneOldLogs(errorLogDir)
    
    // Append to log file
    fs.appendFileSync(errorLogFile, logLine, 'utf-8')
    
    logWithTimestamp('[Error Logger Server] Error written to file successfully')
    
    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('[Error Logger]', logEntry)
    }
  } catch (logError) {
    // Fallback to console if file logging fails
    console.error('[Error Logger] Failed to write to log file:', logError)
    if (resolvedErrorLogDir) {
      const errorLogFile = path.join(resolvedErrorLogDir, `nextjs-errors-${dateStamp}.log`)
      console.error('[Error Logger] File path:', errorLogFile)
      console.error('[Error Logger] File exists:', fs.existsSync(errorLogFile))
      console.error('[Error Logger] Directory exists:', fs.existsSync(resolvedErrorLogDir))
    }
    console.error('[Error Logger] Original error:', error)
  }
}
