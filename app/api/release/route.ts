import { NextResponse } from 'next/server'
import { execSync } from 'node:child_process'

export const runtime = 'nodejs'

const findMergeDate = (): string | null => {
  try {
    const output = execSync('git log --merges --pretty=%ad|%s --date=short --all', {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    })
    const lines = output.split('\n').map((line) => line.trim()).filter(Boolean)
    const matchLine = lines.find((line) => {
      const parts = line.split('|')
      const subject = parts.slice(1).join('|')
      if (!subject) return false
      const lower = subject.toLowerCase()
      return (
        (lower.includes('merge') && lower.includes('dev') && lower.includes('master')) ||
        lower.includes("merge branch 'dev'") ||
        lower.includes('merge branch \"dev\"') ||
        lower.includes('merge remote-tracking branch') && lower.includes('dev')
      )
    })
    if (!matchLine) return null
    const [date] = matchLine.split('|')
    return date || null
  } catch {
    return null
  }
}

export async function GET() {
  const mergeDate = findMergeDate()
  return NextResponse.json({
    version: '0.0.1',
    mergeDate,
  })
}
