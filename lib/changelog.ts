export type ChangelogEntry = {
  version: string
  date: string
  added: string[]
  changed: string[]
  fixed: string[]
}

export const CHANGELOG_LAST_VIEWED_UTC_KEY = 'sff:changelog:last-viewed-utc'

export const CHANGELOG_HISTORY: ChangelogEntry[] = [
  {
    version: '0.0.2i',
    date: '2026-03-05',
    added: [],
    changed: [],
    fixed: [
      'Short set labels now keep their original letter casing instead of being forced to uppercase.',
    ],
  },
  {
    version: '0.0.2h',
    date: '2026-03-05',
    added: [],
    changed: [
      'Card Set filters now show full set names, so it is easier to pick the exact set you want.',
      'Deck set badges now use the new short set codes across deck cards, deck details, and shared deck preview metadata.',
    ],
    fixed: [],
  },
  {
    version: '0.0.2g',
    date: '2026-03-05',
    added: [],
    changed: [],
    fixed: [
      'Changing deck filters now updates the URL without triggering a page navigation.',
      'Your loaded deck results now stay on screen while filters apply locally on the client.',
    ],
  },
  {
    version: '0.0.2f',
    date: '2026-02-27',
    added: [],
    changed: [],
    fixed: [
      'Changing URL filters (including Dissipating) no longer restarts deck loading in a loop.',
      'Deck filters now stay local to already loaded results, and reloading is triggered only when you press Load Decks (or open a new player link).',
      'Deck Status filtering now treats Dissipating as part of Expiring, so Expiring includes all decks that have an expiry date.',
    ],
  },
  {
    version: '0.0.2e',
    date: '2026-02-27',
    added: [],
    changed: [
      'Deck Status filters are clearer now: you can use All, Permanent, Expiring, Dissipating, and Expired.',
      'You can now sort decks by expire date in both directions: soonest first or latest first.',
      'When less than 24 hours remain, expire labels now show a live-style time format (for example, hours and minutes left) instead of a date.',
    ],
    fixed: [],
  },
  {
    version: '0.0.2d',
    date: '2026-02-24',
    added: [
      'The changelog button now shows an unread-count badge so you can quickly spot new updates.',
    ],
    changed: [
      'Opening the changelog now marks updates as read using your browser local storage, so the New badge clears after you review updates.',
    ],
    fixed: [],
  },
  {
    version: '0.0.2a',
    date: '2026-02-09',
    added: [
      'The "What\'s new" window now keeps previous versions, so you can review update history in one place.',
      'The All Decks page now has a reliable player-based loading path even when saved-deck storage is unavailable.',
    ],
    changed: [
      'Deck details now use fewer background requests, so opening fused and direct-link decks feels smoother.',
      'Header loading is visually stable: layout placeholders now keep the final structure from first paint.',
      'Player pages now stay usable when database features are disabled, instead of surfacing hard API errors.',
    ],
    fixed: [
      'Fixed repeated fused half-deck background fetch loops that could keep network activity running.',
      'Fixed the broken All Decks flow caused by a missing API endpoint dependency.',
      'Fixed clipped Forgeborn ability text in shared deck preview images for long ability lines.',
      'Removed duplicate public-page session checks that caused unnecessary API calls.',
    ],
  },
  {
    version: '0.0.2',
    date: '2026-02-08',
    added: [
      'New rarity filtering options were added, including exact rarity matching and keyword-based rarity search.',
      'Min/Max controls were added to key filters to narrow large deck lists faster.',
      'Direct deck links now open with richer details more often, including fused deck context.',
    ],
    changed: [
      'Shared link previews (OG images) now load faster and look cleaner in messengers and social feeds.',
      'Preview titles and descriptions are more informative: they now better reflect deck, forgeborn, owner, and summary details.',
      'Preview image text fitting and readability were improved, so long names and ability text are less likely to look cramped.',
      'Player deck search now shows found decks sooner while background saving continues quietly.',
    ],
    fixed: [
      'Fixed multiple fused-preview issues where some shared links could show incomplete or inconsistent details.',
      'Fixed several cases where direct-link deck views could miss important fields like expire date.',
      'Fixed cases where fused deck and half-deck data could mix after switching views.',
      'Back to Fused navigation from a half deck now works more reliably.',
    ],
  },
  {
    version: '0.0.1',
    date: '2026-01-30',
    added: [
      'Header now includes a quick "What\'s new" window with recent highlights.',
      'New rarity icons for Darkforge sets (B1, S1-S4).',
      'Deck links now generate a shareable preview image for social media.',
    ],
    changed: [
      'Deck link preview images are cleaner and better centered, so shared links look polished.',
      'Browsing decks feels smoother with clearer pagination, filters, and a more responsive details window.',
      'Fused deck tags and creature types are now calculated more consistently.',
      'Search is steadier with smarter refresh and caching behavior.',
      "Features that need Supabase now stay quietly off when it isn't configured.",
    ],
    fixed: [
      'Fused deck filtering and set detection now behave reliably.',
      'Shared preview images for fused decks now show the correct art.',
      'Share preview rendering no longer breaks on unsupported styles or missing icons.',
    ],
  },
]

export const CHANGELOG_SUMMARY = {
  version: CHANGELOG_HISTORY[0]?.version || '0.0.0',
  date: CHANGELOG_HISTORY[0]?.date || '',
}

export const formatChangelogDate = (value: string) => {
  if (!value) return '—'
  const parts = value.split('-').map((part) => Number(part))
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return value
  const [year, month, day] = parts
  const date = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export const parseChangelogDateToUtcTimestamp = (value: string) => {
  if (!value) return null
  const parts = value.split('-').map((part) => Number(part))
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return null
  const [year, month, day] = parts
  const timestamp = Date.UTC(year, month - 1, day)
  return Number.isNaN(timestamp) ? null : timestamp
}
