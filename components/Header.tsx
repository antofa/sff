'use client'

import { Container, Group, Button, Text, Tooltip, Paper } from '@mantine/core'
import { IconMail, IconArrowUpRight, IconArrowDownRight, IconNotes } from '@tabler/icons-react'
import Image from 'next/image'
import Link from 'next/link'
import { memo, useEffect, useMemo, useState } from 'react'
import { ChangelogModal } from '@/components/header/ChangelogModal'
import { useChangelogState } from '@/lib/useChangelogState'

type TokenInfo = {
  id: string
  symbol: string
  label: string
}

type TokenPrice = {
  price: number | null
  change1h: number | null
  change24h: number | null
  change7d: number | null
  change30d: number | null
  change1y: number | null
}

type PriceCacheEntry = {
  prices: Record<string, TokenPrice>
  updatedAt: number
}

type PriceFetchLock = {
  startedAt: number
}

type CoinGeckoMarketEntry = {
  id?: string
  current_price?: number | null
  price_change_percentage_1h_in_currency?: number | null
  price_change_percentage_24h_in_currency?: number | null
  price_change_percentage_7d_in_currency?: number | null
  price_change_percentage_30d_in_currency?: number | null
  price_change_percentage_1y_in_currency?: number | null
}

const COINGECKO_MARKETS_URL = 'https://api.coingecko.com/api/v3/coins/markets'
const PRICE_CACHE_KEY = 'sff:token-prices:v1'
const PRICE_FETCH_LOCK_KEY = 'sff:token-prices:fetching:v1'
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000
const PRICE_FETCH_LOCK_TTL_MS = 15 * 1000
const PRICE_HEADER_CELLS = ['', '1H', '1D', '1W', '1M', '1Y']
const TOKENS: TokenInfo[] = [
  { id: 'bitcoin', symbol: 'BTC', label: 'BTC' },
  { id: 'ethereum', symbol: 'ETH', label: 'ETH' },
  { id: 'solforge-fusion', symbol: 'SFG', label: 'SFG' },
]

const formatPrice = (value?: number | null) => {
  if (value === undefined || value === null || Number.isNaN(value)) return '—'
  if (value < 1) {
    return `$${value.toLocaleString('en-US', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    })}`
  }
  const rounded = Math.round(value)
  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

const renderChange = (value?: number | null) => {
  if (value === undefined || value === null || Number.isNaN(value)) return null
  const positive = value >= 0
  return (
    <Text
      size="sm"
      fw={600}
      c={positive ? 'teal.3' : 'red.4'}
      lh={1}
      style={{ fontVariantNumeric: 'tabular-nums', transition: 'color 150ms ease' }}
    >
      {Math.abs(value).toFixed(2)}%
    </Text>
  )
}

const readPriceCache = (): PriceCacheEntry | null => {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(PRICE_CACHE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    const updatedAt = Number(parsed?.updatedAt)
    if (!Number.isFinite(updatedAt)) return null
    if (!parsed?.prices || typeof parsed.prices !== 'object') return null

    return {
      prices: parsed.prices as Record<string, TokenPrice>,
      updatedAt,
    }
  } catch {
    return null
  }
}

const writePriceCache = (prices: Record<string, TokenPrice>, updatedAt: number) => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify({ prices, updatedAt }))
  } catch {
    // ignore localStorage failures
  }
}

const readPriceFetchLock = (): PriceFetchLock | null => {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(PRICE_FETCH_LOCK_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    const startedAt = Number(parsed?.startedAt)
    if (!Number.isFinite(startedAt)) return null

    return { startedAt }
  } catch {
    return null
  }
}

const writePriceFetchLock = (startedAt: number) => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(PRICE_FETCH_LOCK_KEY, JSON.stringify({ startedAt }))
  } catch {
    // ignore localStorage failures
  }
}

const clearPriceFetchLock = () => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.removeItem(PRICE_FETCH_LOCK_KEY)
  } catch {
    // ignore localStorage failures
  }
}

const buildCoinGeckoMarketsUrl = () => {
  const params = new URLSearchParams({
    vs_currency: 'usd',
    ids: TOKENS.map((token) => token.id).join(','),
    price_change_percentage: '1h,24h,7d,30d,1y',
  })

  return `${COINGECKO_MARKETS_URL}?${params.toString()}`
}

const parseTokenPrices = (payload: unknown) => {
  const next: Record<string, TokenPrice> = {}

  if (!Array.isArray(payload)) return next

  payload.forEach((entry) => {
    const marketEntry = entry as CoinGeckoMarketEntry
    const id = marketEntry.id
    if (!id) return

    next[id] = {
      price: marketEntry.current_price ?? null,
      change1h: marketEntry.price_change_percentage_1h_in_currency ?? null,
      change24h: marketEntry.price_change_percentage_24h_in_currency ?? null,
      change7d: marketEntry.price_change_percentage_7d_in_currency ?? null,
      change30d: marketEntry.price_change_percentage_30d_in_currency ?? null,
      change1y: marketEntry.price_change_percentage_1y_in_currency ?? null,
    }
  })

  return next
}

const PriceHeader = memo(function PriceHeader({ gridTemplate }: { gridTemplate: string }) {
  return (
    <div
      className="grid items-center uppercase tracking-wide text-[11px]"
      style={{ gridTemplateColumns: gridTemplate, columnGap: 6, color: 'rgba(226, 232, 240, 0.7)' }}
    >
      {PRICE_HEADER_CELLS.map((label) => {
        const align = label ? 'center' : 'left'
        return (
          <Text key={label} size="xs" fw={600} ta={align} lh={1}>
            {label}
          </Text>
        )
      })}
    </div>
  )
})

const TokenLabel = memo(function TokenLabel({ label }: { label: string }) {
  return (
    <Text fw={700} size="sm" lh={1}>
      {label}
    </Text>
  )
})

type PriceRowProps = {
  token: TokenInfo
  quote?: TokenPrice
  gridTemplate: string
}

const PriceRow = memo(function PriceRow({ token, quote, gridTemplate }: PriceRowProps) {
  const priceDelta1h = quote?.change1h
  const priceColor = priceDelta1h === null || priceDelta1h === undefined ? 'white' : priceDelta1h >= 0 ? 'teal.3' : 'red.4'
  const changes = [
    { label: '1D', value: quote?.change24h },
    { label: '1W', value: quote?.change7d },
    { label: '1M', value: quote?.change30d },
    { label: '1Y', value: quote?.change1y },
  ]

  return (
    <div
      className="grid items-center"
      style={{ gridTemplateColumns: gridTemplate, columnGap: 6 }}
    >
      <TokenLabel label={token.label} />
      <Text
        size="sm"
        c={priceColor}
        lh={1}
        style={{ fontVariantNumeric: 'tabular-nums', transition: 'color 150ms ease' }}
      >
        {formatPrice(quote?.price)}
      </Text>
      {changes.map(({ label, value }) => (
        <div key={`${token.id}-${label}`} style={{ display: 'flex', alignItems: 'center' }}>
          {renderChange(value) || (
            <Text size="sm" c="gray.5" lh={1} style={{ fontVariantNumeric: 'tabular-nums' }}>
              —
            </Text>
          )}
        </div>
      ))}
    </div>
  )
})

export function Header() {
  const [logoError, setLogoError] = useState(false)
  const [prices, setPrices] = useState<Record<string, TokenPrice>>({})
  const [loadingPrices, setLoadingPrices] = useState(false)
  const [errorPrices, setErrorPrices] = useState<string | null>(null)
  const { changelogOpened, setChangelogOpened, unreadChangelogCount, handleOpenChangelog } =
    useChangelogState()
  const logoSrc = '/images/logo/too-many-decks-logo.png'

  useEffect(() => {
    let cancelled = false

    const fetchPrices = async () => {
      const cached = readPriceCache()
      const now = Date.now()

      if (cached) {
        setPrices(cached.prices)
      }

      if (cached && now - cached.updatedAt < PRICE_CACHE_TTL_MS) {
        setErrorPrices(null)
        return
      }

      const fetchLock = readPriceFetchLock()
      if (fetchLock && now - fetchLock.startedAt < PRICE_FETCH_LOCK_TTL_MS) {
        return
      }

      try {
        if (!cancelled) {
          setLoadingPrices(true)
        }
        setErrorPrices(null)
        writePriceFetchLock(now)
        const res = await fetch(buildCoinGeckoMarketsUrl(), {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const next = parseTokenPrices(data)
        const updatedAt = Date.now()
        if (!cancelled) {
          setPrices(next)
        }
        writePriceCache(next, updatedAt)
      } catch (err) {
        console.error('[Header] Failed to load token prices', err)
        if (!cancelled) {
          setErrorPrices('Price feed unavailable')
        }
      } finally {
        clearPriceFetchLock()
        if (!cancelled) {
          setLoadingPrices(false)
        }
      }
    }

    fetchPrices()
    const interval = window.setInterval(fetchPrices, PRICE_CACHE_TTL_MS)
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== PRICE_CACHE_KEY) return
      const cached = readPriceCache()
      if (cached) {
        setPrices(cached.prices)
        setErrorPrices(null)
      }
    }
    window.addEventListener('storage', handleStorage)

    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const pricePanel = useMemo(() => {
    const bitcoinPrice = prices['bitcoin']?.price ?? null
    const isHighPrice = bitcoinPrice !== null && bitcoinPrice >= 100000
    const gridTemplate = isHighPrice
      ? '30px 72px 45px 47px 47px 47px'
      : '30px 56px 45px 47px 47px 47px'
    const minWidth = isHighPrice ? 320 : 300

    return (
      <Paper
        radius={0}
        shadow="none"
        className="text-white bg-transparent"
        style={{
          width: 'fit-content',
          maxWidth: '100%',
          overflow: 'hidden',
          padding: '0 10px',
          backgroundColor: 'transparent',
        }}
      >
        <div style={{ minWidth: minWidth }}>
          <PriceHeader gridTemplate={gridTemplate} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
            {TOKENS.map((token) => (
              <PriceRow
                key={token.id}
                token={token}
                quote={prices[token.id]}
                gridTemplate={gridTemplate}
              />
            ))}
          </div>
        </div>
      </Paper>
    )
  }, [prices])
  return (
    <>
      <ChangelogModal opened={changelogOpened} onClose={() => setChangelogOpened(false)} />

      <header className="w-full py-4 px-6 bg-slate-800/60 backdrop-blur-md border-b border-sf-primary/20">
        <Container size="xl">
          <div
            style={{
              width: '100%',
              maxWidth: '36rem', // align with search panel width
              margin: '0 auto',
            }}
          >
            <Group
              justify="space-between"
              align="center"
              wrap="wrap"
              gap="sm"
            >
            <Group gap="sm" align="center" wrap="nowrap">
              <Link href="/?reset=1" aria-label="Go to home" className="flex items-center no-underline">
                {!logoError ? (
                  <Image
                    src={logoSrc}
                    alt="Too Many Decks"
                    width={256}
                    height={130}
                    className="h-18 w-auto"
                    style={{ objectFit: 'contain' }}
                    onError={() => setLogoError(true)}
                    priority
                  />
                ) : (
                  <Text
                    size="xl"
                    fw={700}
                    className="text-white"
                    style={{
                      textShadow: '0 0 15px rgba(74, 144, 226, 0.4)',
                    }}
                  >
                    Too Many Decks
                  </Text>
                )}
              </Link>
            </Group>

            <Group gap="xs" wrap="wrap" align="center" justify="flex-start">
              <div
                style={{
                  opacity: loadingPrices ? 0.85 : 1,
                  transition: 'opacity 150ms ease',
                }}
                aria-label={errorPrices ? 'Price feed unavailable' : undefined}
              >
                {pricePanel}
              </div>
            </Group>

            <Group gap="xs" wrap="nowrap">
              <Button
                component="a"
                href="/"
                variant="light"
              size="sm"
              className="bg-slate-700/40 text-white border border-sf-primary/30 hover:border-sf-primary/60"
            >
              Decks
            </Button>
            {/* Temporarily hidden: My profile entry point; functionality intact */}
            {/*
            <Button
              component="a"
              href="/my-profile"
              variant="light"
              size="sm"
              className="bg-slate-700/40 text-white border border-sf-primary/30 hover:border-sf-primary/60"
            >
              My profile
            </Button>
            */}
            {/*
            <Button
              component="a"
              href="/players"
              variant="light"
              size="sm"
              className="bg-slate-700/40 text-white border border-sf-primary/30 hover:border-sf-primary/60"
            >
              Players
            </Button>
            <Button
              component="a"
              href="/all-decks"
              variant="light"
              size="sm"
              className="bg-slate-700/40 text-white border border-sf-primary/30 hover:border-sf-primary/60"
            >
              All decks
            </Button>
            */}
          </Group>

            <Group gap="xs" wrap="nowrap">
            <div className="flex flex-col items-center gap-1">
              <Tooltip label="Leave Feedback" position="bottom" withArrow>
                <Button
                  component="a"
                  href="https://j5e8zoao.forms.app/sffd-feedback"
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="subtle"
                  color="gray"
                  size="sm"
                  className="text-white hover:bg-sf-primary/20 transition-colors"
                  aria-label="Leave Feedback form"
                >
                  <IconMail size={18} />
                </Button>
              </Tooltip>
              <div className="relative">
                <Button
                  variant="subtle"
                  color="gray"
                  size="sm"
                  className="text-white hover:bg-sf-primary/20 transition-colors"
                  aria-label="Changelog"
                  onClick={handleOpenChangelog}
                >
                  <IconNotes size={18} />
                </Button>
                {unreadChangelogCount > 0 && (
                  <span
                    className="pointer-events-none absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-blue-500 text-white text-[10px] font-bold leading-4 text-center"
                    aria-hidden="true"
                  >
                    {Math.min(unreadChangelogCount, 99)}
                  </span>
                )}
              </div>
            </div>

            {/* Auth controls are intentionally hidden */}
          </Group>
          </Group>
          </div>
        </Container>
      </header>
    </>
  )
}
