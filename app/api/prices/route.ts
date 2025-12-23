import { NextResponse } from 'next/server'

type TokenPrice = {
  price: number | null
  change1h: number | null
  change24h: number | null
  change7d: number | null
  change30d: number | null
}

const CACHE_TTL_MS = 60 * 1000
const priceCache = new Map<string, { data: Record<string, TokenPrice>; fetchedAt: number }>()
const inFlight = new Map<string, Promise<Record<string, TokenPrice>>>()

const fetchPricesForIds = async (idsKey: string, ids: string[]) => {
  const existing = inFlight.get(idsKey)
  if (existing) return existing

  const promise = (async () => {
    const params = new URLSearchParams({
      vs_currency: 'usd',
      ids: ids.join(','),
      price_change_percentage: '1h,24h,7d,30d',
    })
    const url = `https://api.coingecko.com/api/v3/coins/markets?${params.toString()}`
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
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
    return next
  })()

  inFlight.set(idsKey, promise)
  try {
    return await promise
  } finally {
    inFlight.delete(idsKey)
  }
}

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const idsParam = searchParams.get('ids') || ''
  const rawIds = idsParam
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id.length > 0 && /^[a-z0-9-]+$/.test(id))

  if (rawIds.length === 0) {
    return NextResponse.json({ error: 'ids required' }, { status: 400 })
  }

  const uniqueIds = Array.from(new Set(rawIds))
  if (uniqueIds.length > 20) {
    return NextResponse.json({ error: 'too many ids' }, { status: 400 })
  }

  const idsKey = uniqueIds.slice().sort().join(',')
  const now = Date.now()
  const cached = priceCache.get(idsKey)
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(
      { prices: cached.data, updatedAt: cached.fetchedAt, cached: true },
      { headers: { 'Cache-Control': 'public, max-age=60' } }
    )
  }

  try {
    const data = await fetchPricesForIds(idsKey, uniqueIds)
    const fetchedAt = Date.now()
    priceCache.set(idsKey, { data, fetchedAt })
    return NextResponse.json(
      { prices: data, updatedAt: fetchedAt },
      { headers: { 'Cache-Control': 'public, max-age=60' } }
    )
  } catch (error) {
    if (cached) {
      return NextResponse.json(
        { prices: cached.data, updatedAt: cached.fetchedAt, stale: true },
        { headers: { 'Cache-Control': 'public, max-age=60' } }
      )
    }
    return NextResponse.json({ error: 'price feed unavailable' }, { status: 502 })
  }
}
