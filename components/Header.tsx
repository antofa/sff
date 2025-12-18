'use client'

import { Container, Group, Button, Text, Avatar, Menu, Loader, Tooltip, Paper } from '@mantine/core'
import { IconMail, IconBrandDiscord, IconLogout, IconUser, IconArrowUpRight, IconArrowDownRight } from '@tabler/icons-react'
import { useSession, signIn, signOut } from 'next-auth/react'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

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

export function Header() {
  const { data: session, status } = useSession()
  const [logoError, setLogoError] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [prices, setPrices] = useState<Record<string, TokenPrice>>({})
  const [loadingPrices, setLoadingPrices] = useState(false)
  const [errorPrices, setErrorPrices] = useState<string | null>(null)
  const logoSrc = '/images/solforge-logo.png'

  const handleDiscordLogin = () => {
    signIn('discord')
  }

  const handleLogout = () => {
    signOut()
  }

  const tokens: TokenInfo[] = useMemo(
    () => [
      { id: 'bitcoin', symbol: 'BTC', label: 'BTC' },
      { id: 'ethereum', symbol: 'ETH', label: 'ETH' },
      { id: 'solforge-fusion', symbol: 'SFG', label: 'SFG' },
    ],
    []
  )

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
      <Text size="sm" fw={600} c={positive ? 'teal.3' : 'red.4'} lh={1}>
        {Math.abs(value).toFixed(2)}%
      </Text>
    )
  }

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        setLoadingPrices(true)
        setErrorPrices(null)
        const ids = tokens.map((t) => t.id).join(',')
        const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=1h,24h,7d,30d`
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const next: Record<string, TokenPrice> = {}
        if (Array.isArray(data)) {
          data.forEach((entry: any) => {
            const id = entry?.id
            if (!id) return
            next[id] = {
              price: entry?.current_price ?? null,
              change1h: entry?.price_change_percentage_1h_in_currency ?? null,
              change24h: entry?.price_change_percentage_24h_in_currency ?? null,
              change7d: entry?.price_change_percentage_7d_in_currency ?? null,
              change30d: entry?.price_change_percentage_30d_in_currency ?? null,
            }
          })
        }
        setPrices(next)
        setLastUpdated(Date.now())
      } catch (err) {
        console.error('[Header] Failed to load token prices', err)
        setErrorPrices('Price feed unavailable')
      } finally {
        setLoadingPrices(false)
      }
    }

    fetchPrices()
    const interval = setInterval(fetchPrices, 60 * 1000) // refresh every minute
    return () => clearInterval(interval)
  }, [tokens])

  const pricePanel = useMemo(() => {
    const bitcoinPrice = prices['bitcoin']?.price ?? null
    const isHighPrice = bitcoinPrice !== null && bitcoinPrice >= 100000
    const gridTemplate = isHighPrice ? '30px 72px 45px 47px 47px' : '30px 56px 45px 47px 47px'
    const minWidth = isHighPrice ? 280 : 260
    const headerCells = ['', '1H', '1D', '1W', '1M']

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
          <div
            className="grid items-center uppercase tracking-wide text-[11px]"
            style={{ gridTemplateColumns: gridTemplate, columnGap: 6, color: 'rgba(226, 232, 240, 0.7)' }}
          >
            {headerCells.map((label) => {
              const align = label ? 'center' : 'left'
              return (
                <Text key={label} size="xs" fw={600} ta={align} lh={1}>
                  {label}
                </Text>
              )
            })}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
            {tokens.map((token) => {
              const quote = prices[token.id]
              const priceDelta1h = quote?.change1h
              const priceColor = priceDelta1h === null || priceDelta1h === undefined ? 'white' : priceDelta1h >= 0 ? 'teal.3' : 'red.4'
              const changes = [
                { label: '1D', value: quote?.change24h },
                { label: '1W', value: quote?.change7d },
                { label: '1M', value: quote?.change30d },
              ]

              return (
                <div
                  key={token.id}
                  className="grid items-center"
                  style={{ gridTemplateColumns: gridTemplate, columnGap: 6 }}
                >
                  <Text fw={700} size="sm" lh={1}>
                    {token.label}
                  </Text>
                  <Text size="sm" c={priceColor} lh={1}>
                    {formatPrice(quote?.price)}
                  </Text>
                  {changes.map(({ label, value }) => (
                    <div key={`${token.id}-${label}`} style={{ display: 'flex', alignItems: 'center' }}>
                      {renderChange(value) || (
                        <Text size="sm" c="gray.5" lh={1}>
                          —
                        </Text>
                      )}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </Paper>
    )
  }, [prices, tokens, formatPrice, renderChange])

  // Get Discord avatar URL
  const getDiscordAvatarUrl = () => {
    if (session?.user?.discordId && session?.user?.avatar) {
      return `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatar}.png`
    }
    return session?.user?.image || null
  }

  return (
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
              <Link href="/" aria-label="Go to home" className="flex items-center no-underline">
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
              {loadingPrices ? (
                <Loader size="sm" color="blue" />
              ) : errorPrices ? (
                <Text size="xs" c="red.3">
                  {errorPrices}
                </Text>
              ) : (
                pricePanel
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
  )
}
