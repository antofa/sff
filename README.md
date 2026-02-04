# SolForge Fusion Deck Viewer

A Next.js app for browsing SolForge Fusion decks by player nickname with rich filtering, tagging, and detail views.

## Features
- Search decks by player nickname; fetches all pages from the official SolForge Fusion API.
- Deck and fused deck display with counts, tags, set info, scores/ELO, and expiry status highlighting.
- Filter panel with default `Deck Status` (defaults to active) and on-demand addable filters (faction, tags, card name/text, card set, rarity, counts, ELO/score, sort, etc.), sorted alphabetically and allowing duplicates.
- Per-filter include/exclude mode; filters persist in the URL so copying the address restores the same results.
- Debounced text filters and pagination for large result sets.
- Adaptive, dark-styled UI built with Mantine and Tailwind.

## Tech Stack
- Next.js 14 (App Router) + TypeScript
- Tailwind CSS for styling
- Mantine UI + @mantine/notifications + @tabler/icons-react
- Zustand for state
- Zod for validation

## Getting Started
```bash
npm install
npm run dev
# open http://localhost:3000
```

## Optional: Cloudflare R2 OG Cache Setup (Netlify)
Use this to cache pre-rendered OG PNGs for 24 hours so link previews (Discord/X/etc.) are served from cache instead of rendering from scratch.

### 1) Create R2 resources
- Create a bucket (for example: `sff-og-cache`).
- Create an R2 API token (S3-compatible) and copy:
  - Access Key ID
  - Secret Access Key
- Copy your Cloudflare Account ID.

### 2) Configure Netlify environment variables
In Netlify `Site settings -> Environment variables`, add:

```bash
OG_R2_ACCOUNT_ID=<cloudflare-account-id>
OG_R2_BUCKET=<r2-bucket-name>
OG_R2_ACCESS_KEY_ID=<r2-access-key-id>
OG_R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
```

Then redeploy the site.

### 3) Verify
1. Force-generate and upload one image:
   - `/api/og/deck/<deckId>?refresh=1`
2. Request the normal OG URL:
   - `/api/og/deck/<deckId>`
3. Confirm response header:
   - `X-OG-Cache: r2-hit`

### 4) Notes
- If R2 is not configured or unavailable, the app falls back to normal in-app OG rendering.
- Opening `/deck/<deckId>` pre-warms the OG route in the background.
- `?refresh=1` bypasses local/R2 cache reads for manual refresh.

## API Notes
- Endpoint: `https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main/deck/app`
- Params: `?inclPve=true&username={username}`
- Response: JSON with `Items` array and optional `LastEvaluatedKey` for pagination.

## Project Layout
```
app/
  api/decks/route.ts     # API route proxy for decks
  globals.css            # Global styles
  layout.tsx             # Root layout
  page.tsx               # Main page
components/
  BackgroundElements.tsx # Background visuals
  DeckList.tsx           # Deck list, filters, cards, pagination
  Header.tsx             # Top bar
store/
  deckStore.ts           # Zustand store for decks and filters
```

## Error Handling
- Handles missing players (empty list), network failures (notification), and schema mismatches (Zod validation).

## Notes on Filters
- `Deck Status` is always present by default.
- Add any other filter from the “Add filter” selector; removing a filter resets its values so hidden filters do not affect results.
