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
