const DEFAULT_RETENTION_DAYS = 10
const PRUNE_INTERVAL_MS = 60 * 60 * 1000
const lastPruneAt = new Map<string, number>()

export const pruneOldLogs = async (dir: string, retentionDays: number = DEFAULT_RETENTION_DAYS) => {
  if (typeof window !== 'undefined') return

  const now = Date.now()
  const last = lastPruneAt.get(dir) ?? 0
  if (now - last < PRUNE_INTERVAL_MS) return
  lastPruneAt.set(dir, now)

  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000

  try {
    const fs = await import('fs/promises')
    const path = await import('path')
    const entries = await fs.readdir(dir, { withFileTypes: true })

    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isFile() || !entry.name.endsWith('.log')) return
        const fullPath = path.join(dir, entry.name)
        const stats = await fs.stat(fullPath)
        if (stats.mtimeMs < cutoff) {
          await fs.unlink(fullPath)
        }
      })
    )
  } catch (error: any) {
    if (error?.code === 'ENOENT') return
    console.warn('[logger] Failed to prune old logs:', error)
  }
}
