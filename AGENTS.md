# AGENTS.md

## Project summary
SolForge Fusion Deck Viewer is a Next.js App Router app for browsing SolForge Fusion decks with rich filtering, deck detail views, and player search. UI uses Mantine + Tailwind, state is managed with Zustand, and data is validated with Zod.

## Quick commands
- Install: `npm install`
- Dev server: `npm run dev` (runs via `run-with-nvm.sh`, uses Node 20)
- Build: `npm run build` (webpack build, Turbopack disabled)
- Start: `npm start`
- Lint: `npm run lint`

## Environment variables
Required when enabling auth or database features:
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (optional, falls back to anon key)

## Architecture map
- `app/` Next.js App Router routes and API handlers
  - `app/page.tsx` main page
  - `app/layout.tsx` root layout
  - `app/api/*` API routes (decks, logging, profiles, etc.)
- `components/` UI building blocks (filters, deck list/details, header, background)
- `store/deckStore.ts` Zustand store for decks/filters
- `lib/` data fetching, normalization, logging, and Supabase helpers
  - `lib/api.ts` SolForge Fusion API integration + normalization
  - `lib/supabase.ts` Supabase client and DB operations
- `types/` shared TS types (incl. Supabase)
- `public/` static assets

## Data and assets
- `card-database-cleaned.json` is large; avoid editing unless explicitly required.
- Icons and images live in `public/images`.

## Notes for changes
- Commit changes only after `npm run build` succeeds when frontend code has changed.
- Commit every change without prompting for confirmation.
- Update `CHANGELOG.md` with notable changes.
- Include a UTC date on `CHANGELOG.md` entries; dates roll over at 00:00 UTC.
- Add an entry to `AI_REQUESTS.md` with the resulting commit SHA and the user prompt.
  - Note: commit SHAs change if a commit is amended, so record the SHA in a follow-up commit that updates only `AI_REQUESTS.md`.
- When updating the in-app/site changelog in `components/Header.tsx`, use plain, user-friendly wording (avoid jargon like "OG") and describe the user-facing benefit (e.g., sharing deck details on social media).
- Write all code, comments, and text in all files in English.
- Use App Router conventions; server actions and API routes live under `app/`.
- When updating API behavior, check `lib/api.ts` and `app/api/*` for consistency.
- Keep styles consistent with Tailwind + Mantine usage in existing components.

## Changelog merge rule
- Update `CHANGELOG.md` and `lib/changelog.ts` only in `dev` before merging to `live`.
- `CHANGELOG.md` is the source of truth; the latest release entry must be summarized in plain user-friendly English in `lib/changelog.ts`.
- In `lib/changelog.ts`, keep release notes focused on user-visible outcomes. Skip low-level implementation details, internal refactors, and technical maintenance unless they directly affect the user experience.
- Do not create changelog-only commits in `live` after `dev` -> `live` merge (unless the user explicitly asks for an emergency hotfix).
- Trigger phrase for this task: `sync lib/changelog.ts from CHANGELOG.md` (short form: `up changelog from CHANGELOG.md`).
