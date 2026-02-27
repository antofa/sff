import { useEffect, useMemo, useState } from 'react'
import {
  CHANGELOG_HISTORY,
  CHANGELOG_LAST_VIEWED_UTC_KEY,
  parseChangelogDateToUtcTimestamp,
} from '@/lib/changelog'

export const useChangelogState = () => {
  const [changelogOpened, setChangelogOpened] = useState(false)
  const [lastViewedChangelogAt, setLastViewedChangelogAt] = useState<number | null>(null)

  const unreadChangelogCount = useMemo(() => {
    if (lastViewedChangelogAt === null) return CHANGELOG_HISTORY.length
    return CHANGELOG_HISTORY.filter((entry) => {
      const entryTimestamp = parseChangelogDateToUtcTimestamp(entry.date)
      return entryTimestamp !== null && entryTimestamp > lastViewedChangelogAt
    }).length
  }, [lastViewedChangelogAt])

  const handleOpenChangelog = () => {
    const nowUtc = Date.now()
    setChangelogOpened(true)
    setLastViewedChangelogAt(nowUtc)
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(CHANGELOG_LAST_VIEWED_UTC_KEY, String(nowUtc))
    } catch {
      // ignore localStorage failures
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = Number(window.localStorage.getItem(CHANGELOG_LAST_VIEWED_UTC_KEY))
      if (Number.isFinite(saved) && saved > 0) {
        setLastViewedChangelogAt(saved)
      }
    } catch {
      // ignore localStorage failures
    }
  }, [])

  return {
    changelogOpened,
    setChangelogOpened,
    unreadChangelogCount,
    handleOpenChangelog,
  }
}
