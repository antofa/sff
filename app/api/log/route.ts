import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { getWritableLogsDir } from '@/lib/logPaths'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { message, data, timestamp } = body

    // Create logs directory if it doesn't exist
    const logsDir = getWritableLogsDir()
    try {
      await mkdir(logsDir, { recursive: true })
    } catch (error) {
      // Directory might already exist, ignore
    }

    // Create log file with current date
    const date = new Date().toISOString().split('T')[0]
    const logFile = join(logsDir, `deck-details-${date}.log`)

    // Format log entry
    const logEntry = `[${new Date().toISOString()}] ${message}\n${JSON.stringify(data, null, 2)}\n\n`

    // Append to log file
    await writeFile(logFile, logEntry, { flag: 'a' })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Log API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to write log' },
      { status: 500 }
    )
  }
}
