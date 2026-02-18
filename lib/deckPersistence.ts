import { putDeckOwnersToUpstashCache } from '@/lib/deckOwnerUpstashCache'
import { logWithTimestamp } from '@/lib/logger'
import { syncDeckSearchToSupabase } from '@/lib/supabaseDeckSync'

type DeckPersistenceLog = (message: string) => void

type RunDeckPersistenceJobOptions = {
  playerName: string
  regularDecks: any[]
  fusedDecks: any[]
  log?: DeckPersistenceLog
  logPrefix?: string
}

const resolveDeckId = (deck: any): string | null => {
  const raw = deck?.id ?? deck?.deckId ?? deck?.deck_id ?? null
  if (!raw) return null
  const normalized = String(raw).trim()
  return normalized || null
}

const resolveOwnerName = (deck: any, fallbackOwnerName: string): string => {
  const candidate =
    deck?.playerName ??
    deck?.player_name ??
    deck?.ownerName ??
    deck?.owner ??
    deck?.username ??
    deck?.userName ??
    deck?.myUser?.username ??
    deck?.users?.[0]?.username ??
    deck?.users?.[0]?.user?.username ??
    fallbackOwnerName
  return String(candidate || fallbackOwnerName).trim()
}

const createLogger = (log?: DeckPersistenceLog, logPrefix?: string): DeckPersistenceLog => {
  if (log) return log
  const prefix = logPrefix || '[Deck persistence]'
  return (message: string) => {
    logWithTimestamp(`${prefix} ${message}`)
  }
}

const cacheDeckOwnersBestEffort = async (
  playerName: string,
  decks: any[],
  log: DeckPersistenceLog
) => {
  const entries = decks
    .map((deck) => {
      const deckId = resolveDeckId(deck)
      if (!deckId) return null
      return {
        deckId,
        ownerName: resolveOwnerName(deck, playerName),
      }
    })
    .filter((entry): entry is { deckId: string; ownerName: string } => !!entry)

  if (entries.length === 0) return

  await putDeckOwnersToUpstashCache(entries).catch((error) => {
    log(`owner cache failed: ${error instanceof Error ? error.message : String(error)}`)
  })
}

export const runDeckPersistenceJob = async ({
  playerName,
  regularDecks,
  fusedDecks,
  log,
  logPrefix,
}: RunDeckPersistenceJobOptions) => {
  const ownerName = playerName.trim()
  if (!ownerName) return

  const logger = createLogger(log, logPrefix)
  const normalizedRegularDecks = Array.isArray(regularDecks) ? regularDecks : []
  const normalizedFusedDecks = Array.isArray(fusedDecks) ? fusedDecks : []

  try {
    const summary = await syncDeckSearchToSupabase(ownerName, normalizedRegularDecks, normalizedFusedDecks)
    if (summary.enabled) {
      if (summary.writeBlocked) {
        logger(
          `supabase sync write-blocked until ${summary.writeBlockedUntil || 'unknown'} regular=${summary.persistedRegular}/${normalizedRegularDecks.length} (skipped=${summary.skippedRegular}) fused=${summary.persistedFused}/${normalizedFusedDecks.length} (skipped=${summary.skippedFused})`
        )
      } else {
        logger(
          `supabase sync done regular=${summary.persistedRegular}/${normalizedRegularDecks.length} (skipped=${summary.skippedRegular}) fused=${summary.persistedFused}/${normalizedFusedDecks.length} (skipped=${summary.skippedFused})`
        )
      }
    } else {
      logger('supabase sync skipped (env missing)')
    }
  } catch (syncErr) {
    logger(`supabase sync error: ${syncErr instanceof Error ? syncErr.message : 'unknown'}`)
  }

  await cacheDeckOwnersBestEffort(ownerName, normalizedRegularDecks, logger)
  await cacheDeckOwnersBestEffort(ownerName, normalizedFusedDecks, logger)
  logger(`owner cache done regular=${normalizedRegularDecks.length} fused=${normalizedFusedDecks.length}`)
}
