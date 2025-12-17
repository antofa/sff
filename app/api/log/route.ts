import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { getLogDirs, shouldFallbackToTmp } from '@/lib/logPaths'
import { pruneOldLogs } from '@/lib/logRotation'
import { logWithTimestamp } from '@/lib/logger'

const loggedLogFiles = new Set<string>()

const logTargetOnce = (logFile: string) => {
  if (loggedLogFiles.has(logFile)) return
  loggedLogFiles.add(logFile)
  logWithTimestamp('[Log API] Writing logs to', logFile)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { message, data, timestamp } = body

    const { primary, fallback } = getLogDirs()
    let logsDir = primary
    // Create log file with current date
    const date = new Date().toISOString().split('T')[0]
    let logFile = join(logsDir, `deck-details-${date}.log`)

    const ensureDir = async (dir: string) => {
      try {
        await mkdir(dir, { recursive: true })
        return true
      } catch (error: any) {
        if (shouldFallbackToTmp(error) && dir !== fallback) {
          logsDir = fallback
          logFile = join(logsDir, `deck-details-${date}.log`)
          await mkdir(logsDir, { recursive: true })
          return true
        }
        throw error
      }
    }

    await ensureDir(logsDir)
    await pruneOldLogs(logsDir)
    logTargetOnce(logFile)

    // Format log entry
    const logEntry = `[${new Date().toISOString()}] ${message}\n${JSON.stringify(data, null, 2)}\n\n`

    // Append to log file
    try {
      await writeFile(logFile, logEntry, { flag: 'a' })
    } catch (error: any) {
      if (shouldFallbackToTmp(error) && logsDir !== fallback) {
        logsDir = fallback
        logFile = join(logsDir, `deck-details-${date}.log`)
        await mkdir(logsDir, { recursive: true })
        await pruneOldLogs(logsDir)
        logTargetOnce(logFile)
        await writeFile(logFile, logEntry, { flag: 'a' })
      } else {
        throw error
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Log API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to write log' },
      { status: 500 }
    )
  }
}
