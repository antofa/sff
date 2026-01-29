'use client'

import { Container, Group, Button, Text, Avatar, Menu, Loader, Tooltip, Paper, Divider, Modal, ScrollArea } from '@mantine/core'
import { IconMail, IconBrandDiscord, IconLogout, IconUser, IconArrowUpRight, IconArrowDownRight, IconNotes } from '@tabler/icons-react'
import { useSession, signIn, signOut } from 'next-auth/react'
import Image from 'next/image'
import Link from 'next/link'
import { memo, useEffect, useMemo, useState } from 'react'

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
}

const PRICE_CACHE_KEY = 'sff:token-prices:v1'
const PRICE_CACHE_TTL_MS = 60 * 1000
const PRICE_HEADER_CELLS = ['', '1H', '1D', '1W', '1M']
const TOKENS: TokenInfo[] = [
  { id: 'bitcoin', symbol: 'BTC', label: 'BTC' },
  { id: 'ethereum', symbol: 'ETH', label: 'ETH' },
  { id: 'solforge-fusion', symbol: 'SFG', label: 'SFG' },
]

const CHANGELOG_SUMMARY = {
  version: '0.0.1',
  date: '2026-01-29',
}

const CHANGELOG_FULL = {
  version: CHANGELOG_SUMMARY.version,
  date: CHANGELOG_SUMMARY.date,
  added: [
    'AGENTS.md with project notes and contribution rules.',
    'CHANGELOG.md to track notable changes.',
    'AI_REQUESTS.md to record agent requests and resulting commits.',
    'Added *_DarkforgeCommon.png rarity icons (B1, S1–S4) under public/images/icons/rarity/.',
    '.env.example with required environment variables.',
  ],
  changed: [
    'Updated contribution rules in AGENTS.md (build/commit flow and logging).',
    'Switched AI_REQUESTS.md request entries to English and added an English-only rule in AGENTS.md.',
    'Added a UTC date requirement for CHANGELOG.md entries.',
    'Require committing every change without prompting.',
    'Prefer forgeborn image URLs with spaces, falling back to dash variants (resized path).',
    'Skip forgeborn rotation when using /resized/ images.',
    'Added a safe fallback auth provider when Discord credentials are missing.',
    'Disabled session polling when auth is not configured and added a dev secret fallback.',
    'Increased the display scale for unrotated forgeborn images.',
    'Apply forgeborn scaling even without rotation and increase the scale further.',
    'Increased the forgeborn scale to 2.2.',
    'Nudge forgeborn image positioning to balance top and bottom padding.',
    'Adjust forgeborn image vertical offset to avoid sticking to the bottom edge.',
    'Soften the forgeborn vertical offset.',
    'Reset forgeborn vertical offset to 0%.',
    'Center forgeborn images vertically by anchoring and translating to the frame center.',
    'Lower forgeborn images slightly within the frame.',
    'Make /api/deck/[id] resilient when Supabase env vars are missing.',
    'Make /api/saved-decks return empty data when Supabase is not configured.',
    'Add deck-specific Open Graph metadata with forgeborn image and composition summary.',
    'Switch deck link previews to list card names only and use a non-stretched forgeborn image.',
    'Use a custom OG image for deck links and set the preview title to the deck name.',
    'Auto-rotate OG forgeborn images when they are landscape.',
    'Flip OG rotation logic to keep images horizontal.',
    'Scale up OG forgeborn images to reduce empty space.',
    'Increase OG forgeborn image scale to 1.5.',
    'Add richer OG deck previews with header chips, composition stats, and a styled frame.',
    'Revert OG deck previews to the image-only layout.',
    'Shift the OG deck image to the right and add a left column with counts and metadata.',
    'Add set, rarity counts, and creature tags to the OG left column.',
    'Add ELO to the OG metadata and scale the left column typography.',
    'Reduce OG left column font sizes and include Solbind cards in deck list text.',
    'Order deck list text as forgeborn, creatures, spells, then solbind cards.',
    'Fix deck list ordering so non-forgeborn cards are included again.',
    'Stop restarting deck searches when the tab regains focus.',
    'Add B2 set support in set detection, tags, filters, and rarity icons.',
    'Rename the player deck search button to "Load Decks".',
    'Fix deck grid wrapping when the viewport only allows two columns.',
    'Make the deck details modal responsive at narrow widths.',
    'Reduce forgeborn scale on narrow modals to avoid image clipping.',
    'Allow modal header badges/links to wrap on narrow widths.',
    'Allow deck title and header badges to wrap on all widths when needed.',
    'Show the selected card image inline under its name on narrow modals.',
    'Render the full card frame inline under the selected list item in narrow mode.',
    'Show rarity and tag badges after the card list on narrow modals.',
    'Remove the nested scroll area in deck details to avoid multiple scrollbars.',
    'Lock background scroll while the deck details modal is open.',
    'Drop manual body scrolling so the modal uses a single scroll container.',
    'Auto-scroll the selected card into view on narrow layouts and give the card frame more height.',
    'Reduce empty space in narrow card frames and ensure level buttons fit.',
    'Scroll to the card label on selection and keep narrow frame height consistent across viewport sizes.',
    'Tighten narrow card frame padding and align auto-scroll to keep card titles visible.',
    'Add B3 set detection across APIs, UI filters, and rarity icons.',
    'Prevent URL auto-search from overwriting manual username input.',
    'Ensure force refresh bypasses cached deck pages and fused deck requests.',
    'Prefer explicit cardSetId/cardSetNo over computed deckSet in deck list display.',
    'Set deck list pagination size to 100 for regular and fused decks.',
    'Keep number input spinners visible while showing a separate clear button in filters.',
    'Improve narrow card scroll offset and tighten card frame spacing.',
    'Keep the card detail frames fixed in wide deck modals while the card list scrolls.',
    'Use fused deck cards to compute creature tags in list view.',
    'Fetch fused deck details when subtype data is missing to keep creature tags accurate.',
    'Compute fused creature tags by summing cached tags from the two source decks.',
    'Reset deck search state when navigating home from the header logo.',
    'Keep deck search progress moving when fused deck fetch fails.',
    'Retry fused deck fetches on 5xx responses.',
    'Resolve fused creature tags from half deck ids/names and compute locally when cache is missing.',
    'Fetch half-deck details on demand to correct fused creature tags in list and modal views.',
    'Preserve detailed deck cards when enriching from player listings.',
    'Retry fused half tag fetches when cached creature tags are missing.',
    'Prefer subtype-rich half deck data over cached tags when summing fused creature tags.',
    'Cache corrected half-deck creature tags separately and prefer them for fused tags.',
    'Disable Supabase-backed routes and clients when Supabase is turned off.',
    'Remove Supabase deck storage/loading endpoints and delete Supabase deck helpers.',
    'Avoid repeated creature tag updates that caused fused deck modal hangs.',
    'Persist fused view selection in the URL using an isFused query parameter.',
    'Prevent URL auto-search from overriding a just-submitted manual player search.',
    'Fix card set filtering for fused decks by resolving sets from source halves.',
    'Normalize numeric card set values to S* so fused set filtering matches S3/S4.',
    'Normalize selected card set filters to match fused set labels.',
    'Detect fused decks by id/flags when resolving card sets for filters.',
    'Always resolve fused card sets from halves even when fused cards are present.',
  ],
  fixed: [
    'Populate fused deck card set values from source halves to keep card-set filtering reliable.',
    'Generate deck preview metadata for fused decks by falling back to the internal deck API.',
    'Force deck pages to render metadata dynamically so fused previews resolve at request time.',
    'Ignore non-deck API responses when building deck metadata so fused fallbacks can run.',
    'Populate fused deck forgeborn data from source halves to render OG images.',
    'Add a faction icon before the set value in OG previews for non-fused decks.',
    'Show fused half set labels with per-faction icons in OG previews.',
    'Allow OG set icons to render from direct URLs when base64 fetches fail.',
    'Fix OG renderer crash by removing unsupported inline-flex display values.',
    'Add a header changelog menu with versioned highlights.',
  ],
}

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
  const { data: session, status } = useSession()
  const [logoError, setLogoError] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [prices, setPrices] = useState<Record<string, TokenPrice>>({})
  const [loadingPrices, setLoadingPrices] = useState(false)
  const [errorPrices, setErrorPrices] = useState<string | null>(null)
  const [changelogOpened, setChangelogOpened] = useState(false)
  const logoSrc = '/images/solforge-logo.png'

  const handleDiscordLogin = () => {
    signIn('discord')
  }

  const handleLogout = () => {
    signOut()
  }

  useEffect(() => {
    const readPriceCache = () => {
      if (typeof window === 'undefined') return null
      try {
        const raw = window.localStorage.getItem(PRICE_CACHE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        const updatedAt = Number(parsed?.updatedAt)
        if (!Number.isFinite(updatedAt)) return null
        if (!parsed?.prices || typeof parsed.prices !== 'object') return null
        return { prices: parsed.prices as Record<string, TokenPrice>, updatedAt }
      } catch {
        return null
      }
    }

    const writePriceCache = (nextPrices: Record<string, TokenPrice>, updatedAt: number) => {
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(
          PRICE_CACHE_KEY,
          JSON.stringify({ prices: nextPrices, updatedAt })
        )
      } catch {
        // ignore localStorage failures
      }
    }

    const fetchPrices = async () => {
      const cached = readPriceCache()
      const now = Date.now()
      if (cached && now - cached.updatedAt < PRICE_CACHE_TTL_MS) {
        setPrices(cached.prices)
        setLastUpdated(cached.updatedAt)
        setErrorPrices(null)
        return
      }

      try {
        setLoadingPrices(true)
        setErrorPrices(null)
        const ids = TOKENS.map((t) => t.id).join(',')
        const url = `/api/prices?ids=${encodeURIComponent(ids)}`
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const next: Record<string, TokenPrice> = data?.prices ?? {}
        const updatedAt = Number(data?.updatedAt) || Date.now()
        setPrices(next)
        setLastUpdated(updatedAt)
        writePriceCache(next, updatedAt)
      } catch (err) {
        console.error('[Header] Failed to load token prices', err)
        setErrorPrices('Price feed unavailable')
      } finally {
        setLoadingPrices(false)
      }
    }

    fetchPrices()
    const interval = setInterval(fetchPrices, 60 * 1000) // refresh every minute
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== PRICE_CACHE_KEY) return
      const cached = readPriceCache()
      if (cached) {
        setPrices(cached.prices)
        setLastUpdated(cached.updatedAt)
      }
    }
    window.addEventListener('storage', handleStorage)

    return () => {
      clearInterval(interval)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const pricePanel = useMemo(() => {
    const bitcoinPrice = prices['bitcoin']?.price ?? null
    const isHighPrice = bitcoinPrice !== null && bitcoinPrice >= 100000
    const gridTemplate = isHighPrice ? '30px 72px 45px 47px 47px' : '30px 56px 45px 47px 47px'
    const minWidth = isHighPrice ? 280 : 260

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
  const hasPrices = Object.keys(prices).length > 0

  // Get Discord avatar URL
  const getDiscordAvatarUrl = () => {
    if (session?.user?.discordId && session?.user?.avatar) {
      return `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatar}.png`
    }
    return session?.user?.image || null
  }

  return (
    <>
      <Modal
        opened={changelogOpened}
        onClose={() => setChangelogOpened(false)}
        title={`Changelog ${CHANGELOG_FULL.version}`}
        size="lg"
        centered
      >
        <Text size="xs" c="dimmed" mb="sm">
          Merge date: {CHANGELOG_FULL.date}
        </Text>
        <ScrollArea h={420} offsetScrollbars>
          <div className="space-y-4">
            <div>
              <Text size="xs" fw={700} c="teal.3" tt="uppercase">
                Added
              </Text>
              <div className="mt-2 space-y-1">
                {CHANGELOG_FULL.added.map((item) => (
                  <Text key={`added-${item}`} size="xs" c="gray.1">
                    • {item}
                  </Text>
                ))}
              </div>
            </div>
            <Divider />
            <div>
              <Text size="xs" fw={700} c="yellow.3" tt="uppercase">
                Changed
              </Text>
              <div className="mt-2 space-y-1">
                {CHANGELOG_FULL.changed.map((item) => (
                  <Text key={`changed-${item}`} size="xs" c="gray.1">
                    • {item}
                  </Text>
                ))}
              </div>
            </div>
            <Divider />
            <div>
              <Text size="xs" fw={700} c="blue.3" tt="uppercase">
                Fixed
              </Text>
              <div className="mt-2 space-y-1">
                {CHANGELOG_FULL.fixed.map((item) => (
                  <Text key={`fixed-${item}`} size="xs" c="gray.1">
                    • {item}
                  </Text>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      </Modal>

      <header className="w-full py-4 px-6 bg-slate-800/60 backdrop-blur-md border-b border-sf-primary/20">
        <Container size="xl">
          <div
            style={{
              width: '100%',
              maxWidth: '42rem', // align with search panel width
              margin: '0 auto',
            }}
          >
            <Group
              justify="space-between"
              align="center"
              wrap="wrap"
              gap="md"
            >
            <Group gap="sm" align="center" wrap="nowrap">
              <Link href="/?reset=1" aria-label="Go to home" className="flex items-center no-underline">
                {!logoError ? (
                  <Image
                    src={logoSrc}
                    alt="SolForge Fusion"
                    width={194}
                    height={63}
                    className="h-16 w-auto"
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
                    SolForge Fusion
                  </Text>
                )}
              </Link>
            </Group>

            <Group gap="xs" wrap="wrap" align="center" justify="flex-start">
              {!hasPrices && loadingPrices ? (
                <Loader size="sm" color="blue" />
              ) : errorPrices && !hasPrices ? (
                <Text size="xs" c="red.3">
                  {errorPrices}
                </Text>
              ) : (
                <div
                  style={{
                    opacity: loadingPrices && hasPrices ? 0.85 : 1,
                    transition: 'opacity 150ms ease',
                  }}
                >
                  {pricePanel}
                </div>
              )}
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
              <Button
                variant="subtle"
                color="gray"
                size="sm"
                className="text-white hover:bg-sf-primary/20 transition-colors"
                aria-label="Changelog"
                onClick={() => setChangelogOpened(true)}
              >
                <IconNotes size={18} />
              </Button>
            </div>

            {status === 'loading' ? (
              <Loader size="sm" color="blue" />
            ) : session ? (
              // User is authenticated
              <Menu shadow="md" width={200} position="bottom-end">
                <Menu.Target>
                  <Button
                    variant="subtle"
                    color="gray"
                    size="sm"
                    className="text-white hover:bg-sf-primary/20 transition-colors"
                    leftSection={
                      <Avatar
                        src={getDiscordAvatarUrl()}
                        size={24}
                        radius="xl"
                        alt={session.user?.name || 'User'}
                      >
                        <IconUser size={14} />
                      </Avatar>
                    }
                  >
                    <Text size="sm" truncate maw={100}>
                      {session.user?.username || session.user?.name || 'User'}
                    </Text>
                  </Button>
                </Menu.Target>

                <Menu.Dropdown>
                  <Menu.Label>
                    <Group gap="xs">
                      <IconBrandDiscord size={14} />
                      <Text size="xs">{session.user?.email || 'Discord'}</Text>
                    </Group>
                  </Menu.Label>
                  <Menu.Item
                    component="a"
                    href="/my-profile"
                    leftSection={<IconUser size={14} />}
                  >
                    My profile
                  </Menu.Item>
                  <Menu.Divider />
                  <Menu.Item
                    color="red"
                    leftSection={<IconLogout size={14} />}
                    onClick={handleLogout}
                  >
                    Sign Out
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            ) : (
              // User is not authenticated
              // Temporarily hidden: Discord auth button; keep logic for future re-enable
              null
            )}
          </Group>
          </Group>
          </div>
        </Container>
      </header>
    </>
  )
}
