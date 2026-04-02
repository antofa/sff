# Changelog

All notable changes to this project will be documented in this file.
Dates use UTC and roll over at 00:00 UTC.

## [0.0.2k] - 2026-04-02

### Changed
- (2026-04-02 UTC) Added a centralized deck parser at `store/parsers/deck.ts` that resolves deck set data once and stores `setCode` / `setShortCode` on each deck object.
- (2026-04-02 UTC) Updated deck ingestion in Zustand (`store/deckStore.ts`) to parse decks before caching/rendering, so set badges and set filtering reuse the precomputed set fields.
- (2026-04-02 UTC) Added shared deck entity types in `types/entities.ts`: `DeckRaw` (external API payload) and `Deck` (normalized app-wide model), and switched app components to use the shared `Deck` type.
- (2026-04-02 UTC) Updated `parseDeck` to accept `DeckRaw` and return `Deck`, and moved reusable deck set-resolution helpers into `utils/deck.ts` so parser modules keep only parsing logic.
- (2026-04-02 UTC) Added `types/index.ts` barrel exports and switched project type imports to `@/types` for consistent, shorter import paths.

### Fixed
- (2026-04-02 UTC) Removed duplicated deck-set parsing logic from `DeckList`, `DeckDetails`, and `/api/decks/stream`, reducing inconsistent set resolution between list cards, deck details, and streamed tag payloads.

## [0.0.2j] - 2026-03-05

### Changed
- (2026-03-05 UTC) Updated Card Set filter labels to show full set names (for example, `Set 3 - The Last Winter` and `LD - Axes and Allies`) so set selection is clearer.
- (2026-03-05 UTC) Updated deck set badges in deck previews, deck details, and deck share preview metadata to use the new short set codes (`S0`, `A`, `BfWP`, `TLW`, `SoS`, `TnC`, `AnA`, `BnB`).

### Fixed
- (2026-03-05 UTC) Fixed deck-list filter URL syncing to update the browser URL without triggering Next.js route navigation, so changing filters no longer restarts player deck loading.
- (2026-03-05 UTC) Kept deck filtering fully client-side after the first load: filter changes now keep the current deck results and filter panel state instead of resetting the page.
- (2026-03-05 UTC) Stopped forcing uppercase on short set codes and set-code badges, so mixed-case labels (like `BfWP`, `SoS`, and `AnA`) display correctly.

## [0.0.2f] - 2026-02-27

### Fixed
- (2026-02-27 UTC) Fixed repeated deck reload loops when opening player links with filter query params (for example, `expiryFilter=dissipating`): changing filters now keeps deck data client-side and does not trigger another player fetch unless `Load Decks` is pressed (or a new username link is opened).
- (2026-02-27 UTC) Fixed Deck Status filtering so `Expiring` now includes all decks with an expiry date, while `Dissipating` remains a subset for decks that expire in less than 3 days.

## [0.0.2e] - 2026-02-27

### Changed
- (2026-02-27 UTC) Updated Deck Status filtering options to `All`, `Permanent`, `Expiring`, `Dissipating`, and `Expired`, with `Dissipating` now showing decks that expire in less than 3 days and backward-compatible URL handling for old `active` filter links.
- (2026-02-27 UTC) Added two new deck sorting options by expire date (`soonest first` and `latest first`) for both regular and fused deck views.
- (2026-02-27 UTC) Updated expire-date labels in deck cards to show remaining time as `X hours Y mins` when less than 24 hours remain, instead of a calendar date.
- (2026-02-27 UTC) Fixed regular deck list cards to use the same under-24-hours expire label formatting (`X hours Y mins`) as other deck card paths.
- (2026-02-27 UTC) Refactored the header changelog implementation by separating changelog data, changelog read-state handling, and changelog modal rendering into dedicated modules, while keeping the same user-facing behavior.

## [0.0.2d] - 2026-02-24

### Added
- (2026-02-24 UTC) Added a compact unread-count badge on the header changelog button, showing how many release versions were added since the user's last changelog view.

### Changed
- (2026-02-24 UTC) Opening the changelog now stores the current UTC timestamp in browser local storage and clears the `New` indicator when all listed release timestamps are older than the saved read timestamp.

## [0.0.2c] - 2026-02-24

### Fixed
- (2026-02-24 UTC) Added a visible red-question-mark placeholder icon for missing card rarity assets in deck details, so card rows no longer show broken image icons when a rarity file is unavailable.
- (2026-02-24 UTC) Hardened deck OG image generation to fall back to the same rarity placeholder and log missing rarity asset paths instead of failing or producing incomplete previews.
- (2026-02-24 UTC) Improved `/deck/[id]` metadata fallback behavior so Open Graph and Twitter image tags continue to point to the deck OG endpoint even when enriched metadata generation fails.

## [0.0.2b] - 2026-02-18

### Changed
- (2026-02-18 UTC) Reworked streamed deck delivery in `/api/decks/stream` to send deck data in `decks-chunk` events (75 decks per chunk) plus a compact `decks-complete` signal, replacing the previous single huge `decks-ready` payload.
- (2026-02-18 UTC) Updated client SSE handling to accumulate `decks-chunk` batches, deduplicate by deck ID, and finalize rendering/cache once all chunks arrive, preserving realtime deck loading while avoiding giant stream frames.
- (2026-02-18 UTC) Fixed chunked-stream deck undercounting by replacing deck-ID deduplication with chunk-index assembly, so reconnect retries no longer drop valid decks that share IDs across stream payloads.
- (2026-02-18 UTC) Added explicit `playwright` dev dependency and provisioned headless Chromium runtime dependencies to support repeatable browser-based deck-load regression checks.
- (2026-02-18 UTC) Moved deck persistence scheduling to server-side `after()` jobs in `/api/decks` and `/api/decks/stream`, so Supabase syncing and owner caching continue on the server even after the response is sent.
- (2026-02-18 UTC) Increased Supabase sync throughput by processing regular and fused deck RPC upserts in bounded parallel batches, reducing the chance of partial persistence for very large player searches.

## [0.0.2a] - 2026-02-09

### Added
- (2026-02-09 UTC) Updated the in-app header changelog to version `0.0.2a` and preserved full release history so players can review both current and previous updates from the same window.

### Changed
- (2026-02-09 UTC) Improved direct and fused deck opening flow by deduplicating client deck-detail requests, reducing unnecessary background traffic, and making details load feel steadier.
- (2026-02-09 UTC) Stabilized header startup layout by rendering final-size placeholder rows during price loading, preventing temporary line jumps in the top bar.
- (2026-02-09 UTC) Made `/players` and `/player/[username]` tolerant to disabled Supabase setups by returning an empty successful response instead of surfacing blocking API errors.

### Fixed
- (2026-02-09 UTC) Fixed fused deck detail views repeatedly refetching half-decks in the background, which could keep network activity running longer than expected.
- (2026-02-09 UTC) Fixed the broken `/all-decks` loading path by replacing the missing `/api/saved-decks` dependency with a working player-based fetch path.
- (2026-02-09 UTC) Fixed clipped Forgeborn ability text in deck share preview images by tightening OG fit safety and refreshing the OG image version.
- (2026-02-09 UTC) Removed duplicate public-page auth session checks that were causing extra API requests on initial page load.

## [0.0.2] - 2026-02-06

### Changed
- (2026-02-09 UTC) Fixed the All Decks page data source by replacing the missing `/api/saved-decks` dependency with a working `/api/decks` player-based load path and adding a clear in-page prompt when no player name is provided.
- (2026-02-09 UTC) Reworked `/api/players` behavior for disabled Supabase environments to return a successful empty result set instead of `503`, preventing noisy errors on `/players` and `/player/[username]`.
- (2026-02-09 UTC) Removed background half-deck creature-type fetches from fused deck cards in list view, preventing unnecessary bulk `/api/deck/*?skipOwnerMerge=1` requests when browsing fused results.
- (2026-02-09 UTC) Eliminated repeated session polling on public pages by removing header auth-session usage and enabling NextAuth session provider only on auth-required routes.
- (2026-02-09 UTC) Stopped repeated half-deck refetch loops in fused deck details by adding retry cooldown and stricter update guards in `DeckDetails`, so opening a fused deck no longer spams the same half-deck API requests.
- (2026-02-09 UTC) Deduplicated client-side deck-detail requests by introducing a shared in-flight cache for `/api/deck/[id]` calls across deck page loading and modal enrichment flows, reducing repeated same-deck fetch bursts when opening fused deck links.
- (2026-02-09 UTC) Stabilized header loading layout by rendering the full price panel structure from the first paint (with placeholder values) and removing transient loader swaps, preventing the temporary extra header row during startup.
- (2026-02-08 UTC) Fixed clipped Forgeborn ability text in deck OG images by making forgeborn fit calculations more conservative (token width/line-height safety, extra bottom reserve, tighter fit budget, and final render safety scaling), plus bumped OG image version to refresh stale cached previews.
- (2026-02-08 UTC) Added automated visual-regression tooling for large deck rendering checks by installing Playwright (`@playwright/test` + Chromium) and image diff helpers (`pixelmatch`, `pngjs`) for batch validation runs.
- (2026-02-08 UTC) Expanded header changelog `0.0.2` notes with clearer user-facing highlights from the full release period (including OG preview image/title/description improvements and new filtering options), so the in-app changelog better matches what players actually notice.
- (2026-02-08 UTC) Updated the in-app header changelog modal to keep version history visible (including previous releases) instead of showing only the latest entry, so users can review past updates directly from the header icon.
- (2026-02-08 UTC) Updated the in-app header changelog to version `0.0.2` with concise, player-focused release notes that explain user-visible improvements in deck loading, fused/half navigation stability, and direct-link detail reliability.
- (2026-02-08 UTC) Limited `DeckDetails` fused-source diagnostic logging to non-production builds by skipping `/api/log` dispatch when `NODE_ENV === 'production'`, removing this extra network request from production deck-detail opens.
- (2026-02-08 UTC) Removed late UI blocking after streamed deck fetches: the client store now applies `decks-ready` payloads immediately (`loading=false`) and reuses that prepared result at `done` instead of running a second full validation/computation pass, so large player searches no longer wait for the final stream phase to show decks.
- (2026-02-08 UTC) Fixed fused/half detail-view state races in `DeckDetails`: async responses are now ignored when deck context changes, and full-deck payload merging now requires matching deck IDs, preventing stale header/meta/card data from leaking between half and fused views and improving half-link click reliability.
- (2026-02-08 UTC) Added short-lived in-memory page-state caching in `DeckPageClient` so returning from a half deck back to a recently opened fused deck restores enriched data immediately instead of replaying a cold fast-to-full repaint sequence.
- (2026-02-08 UTC) Fixed fused direct-link half enrichment in `/api/deck/[id]`: source halves now also run through the fallback chain (external data, then Upstash, then Supabase by deck ID), so half-level fields such as `Expire date` are no longer skipped just because card and score data already exist.
- (2026-02-08 UTC) Trimmed `DeckDetails` fused-source debug logging payload to compact diagnostics (counts + small ID samples + source presence flags) and limited this log path to fused decks only, reducing `/api/log` request size and noise.
- (2026-02-08 UTC) Fixed fused deck `Expire date` visibility for direct links by prioritizing internal `/api/deck/[id]` lookups (with fallback enrichment) when `DeckDetails` loads source halves, so half-deck expiry data is no longer lost when the upstream deck endpoint omits it.
- (2026-02-08 UTC) Fixed direct non-fused deck view data precedence in `DeckDetails`: when full external details load first, UI now preserves enriched fields from `/api/deck/[id]` (including `Expire date`) instead of dropping them.
- (2026-02-08 UTC) Reworked direct `/api/deck/[id]` loading to use strict source priority (external deck API first, then Upstash fallback data, then Supabase by deck ID), removed owner-wide deck listing lookups, and kept fused half enrichment on direct ID requests only.
- (2026-02-08 UTC) Standardized repository text language to English for user-facing/project docs and notes by translating the Russian content in `QUICKSTART.md`, `AI_REQUESTS.md`, and remaining non-English inline comments in `components/HomePage.tsx`.
- (2026-02-08 UTC) Made deck persistence non-blocking during player search: `/api/decks/stream` now emits deck results before Supabase save/owner-cache work, removed the blocking "Saving decks to database..." progress stage, and moved `/api/decks` persistence helpers to background execution; deck lists now render immediately when results arrive (including on the player profile page) while database writes continue in the background.
- (2026-02-08 UTC) Reduced UI jank during URL-based reset by deferring the homepage reset state updates into a queued transition, and removed unstable fused-deck set memoization so list filtering/rendering remains responsive under React Compiler checks.
- (2026-02-08 UTC) Preserved fused-to-half navigation context on direct deck links: opening a fused source half now carries `parentFused` in the URL so the half view shows `Back to Fused` and returns to the original fused deck.
- (2026-02-08 UTC) Sped up `/deck/[id]` page responses for regular browser visits by using a lightweight metadata path and reserving the heavier enriched metadata generation for social crawlers.
- (2026-02-08 UTC) Removed OG text shadows from card and forgeborn text blocks to reduce PNG rendering cost and speed up `/api/og/deck/[id]` image generation.
- (2026-02-08 UTC) Added OG route stage profiling for precise latency breakdowns: responses now include `Server-Timing` metrics (payload fetch, icon loading, layout solve, image response creation, PNG render, cache stages), and `?trace=1` writes one-line server timing logs per request.
- (2026-02-08 UTC) Reworked OG generation to a fast deterministic fit path: removed heavy multi-candidate auto-fit loops, switched to single-pass per-column scale/spacing solving with bounded width balancing, and tightened fused/regular API fetch routing (skip wrong-type probes and expensive fused half-detail fan-out) to cut cold OG render latency while keeping full text visible inside image bounds.
- (2026-02-08 UTC) Added shared Upstash caching for deck page metadata preview payloads (`title`, `description`, OG alt text, owner/fused flags) so `generateMetadata` can reuse preview data across process restarts and across multiple app instances, not only from in-memory caches.
- (2026-02-08 UTC) Reduced slow first-hit deck page metadata generation for fused decks by switching half-deck enrichment in `generateMetadata` to the fast internal deck API path (`fast=1`, `skipOwnerMerge=1`) and deduplicating repeated half-detail fetches within one metadata build.
- (2026-02-08 UTC) Accelerated OG image generation for all decks by prioritizing the internal fast deck API path before upstream fallbacks, adding in-memory OG PNG caching for immediate repeat hits, and reducing CPU-heavy OG auto-fit search/estimation overhead while preserving existing no-clipping layout behavior.
- (2026-02-08 UTC) Improved direct `/deck/[id]` load speed by using a fast internal deck payload for first render (and metadata lookup), showing deck details immediately from that payload, and moving slower full deck enrichment to a background client refresh.
- (2026-02-08 UTC) Further retuned regular (non-fused) OG fitting for sparse-name decks: tightened inter-column gap, shifted width balance toward stronger horizontal use in the card column, and added a stronger adaptive card spacing pass so left-column bottom empty space is reduced while forgeborn text still fits without clipping.
- (2026-02-08 UTC) Retuned regular (non-fused) OG column auto-fit to reduce empty space: narrowed the gap between columns, shifted more width to the card list, made the forgeborn column typography/icons more compact, and added a final spacing-and-scale pass so columns fill more of the available height without text clipping.
- (2026-02-08 UTC) Retuned OG column auto-fit to maximize vertical fill in each column (cards and forgeborn) with reduced conservative estimation overhead and adaptive width balancing, so fused and regular previews use much more of the available height without clipping text.
- (2026-02-08 UTC) Ignored browser-extension runtime errors (including MetaMask `chrome-extension://...` failures) in global client error handlers so those external errors are no longer forwarded to `/api/log-error` and server error logs.
- (2026-02-07 UTC) Hardened regular (non-fused) OG bottom-safety fitting on live player samples: separated card/forgeborn safety padding, increased non-fused vertical reserve, and tightened final forgeborn conservative guards to prevent clipped descenders in the right ability column.
- (2026-02-07 UTC) Improved regular (non-fused) OG per-column auto-fit: card and ability columns now get independent final render-fit scaling, with stricter bottom safety to prevent clipped descenders while maximizing vertical fill per column.
- (2026-02-07 UTC) Updated deck-page OG cache busting: `og:image` now includes a query-derived variant token (`uq`) and the OG API treats it as a refresh hint, so sharing deck links with different query params can force fresh image regeneration; also bumped OG image version key to refresh stale caches.
- (2026-02-07 UTC) Added explicit top/bottom safety padding for OG forgeborn ability columns and included that padding in fit calculations, plus stricter final conservative scaling factors, to prevent third-column bottom clipping on fused previews.
- (2026-02-07 UTC) Strengthened OG auto-fit for fused third-column abilities: per-column fitting now uses a more conservative minimum scale and extra wrapped-line padding, plus a final fused forgeborn width/height guard to prevent bottom clipping of descenders and inline-icon lines.
- (2026-02-07 UTC) Fixed missing owner in regular deck OG metadata after player search: `/api/decks/stream` now stores owner mappings in Upstash too (not only `/api/decks`), and owner-less regular metadata cache entries now expire quickly and auto-refresh instead of persisting for a full day.
- (2026-02-07 UTC) Improved deck-stream resilience in the client store: SSE `error` events now log as warnings, stream failures automatically retry once through `/api/decks` HTTP fallback, and background restart refreshes now catch errors to avoid unhandled rejection noise in Next.js dev overlay.
- (2026-02-07 UTC) Hardened regular-deck OG owner propagation: owner writes from `/api/decks` to Upstash are now awaited before response, metadata preview cache key was version-bumped to invalidate stale owner-less entries, and metadata fallback now calls `/api/deck/[id]` without `skipOwnerMerge`.
- (2026-02-07 UTC) Added Upstash deck-owner caching for regular and fused deck IDs and wired metadata generation to reuse cached owner names, so regular deck OG descriptions now include `owner: ...` consistently like fused previews.
- (2026-02-07 UTC) Added OG image versioning for deck pages and Upstash cache keys: `og:image` URLs now include a version query string and Upstash keys include the same version, so Discord and upstream caches stop serving stale OG images after layout updates.
- (2026-02-07 UTC) Removed `Creatures` and `Spells` section labels from non-fused OG card columns (the same behavior already used for fused), so regular deck OG images show only card rows without those headers.
- (2026-02-07 UTC) Matched OG deck description creature-type counting to modal logic for all decks by using whitespace-based subtype tokenization (for example, `Zombie Warrior` now counts as `Zombie` + `Warrior`) and the same spell exclusion rules.
- (2026-02-07 UTC) Improved half-deck OG auto-layout to optimize both height and width: added width-usage scoring for non-fused two-column balancing, expanded flex candidate ranges to shift more space to the ability column when needed, and strengthened final non-fused bottom-clipping safeguards.
- (2026-02-07 UTC) Hardened half-deck OG forgeborn column fitting to prevent second-column bottom clipping on long ability text by using a more conservative width reserve, tighter non-fused height budget, and a final non-fused render-scale safeguard.
- (2026-02-07 UTC) Aligned regular (non-fused) deck link previews with fused formatting: OG/Twitter title now appends forgeborn and owner when available, and description now uses compact summary lines (deck details, card-type counts, rarity initials, creature types) instead of a raw card-name list.
- (2026-02-07 UTC) Fixed half-deck OG bottom clipping in dense card lists by tightening the final non-fused card-column render safety scale so the last card line remains visible.
- (2026-02-07 UTC) Updated non-fused (half-deck) OG rendering to use the same side-by-side auto-fit approach as fused OG (cards column + forgeborn column), with adaptive width/scale balancing and spacing fill, and fixed ability-token spacing so words/icons no longer collapse together.
- (2026-02-07 UTC) Narrowed the 24-hour logo cache rule to the single header logo file (`/images/logo/too-many-decks-logo.png`) instead of all files under `/images/logo/*`.
- (2026-02-07 UTC) Set a 24-hour cache policy for header logo assets under `/images/logo/*` by sending `Cache-Control: public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400`.
- (2026-02-07 UTC) Improved fused OG auto-fit line-wrap estimation with character-width aware text measurement, reducing conservative overestimation and substantially increasing bottom fill across card and forgeborn columns while avoiding overlap.
- (2026-02-07 UTC) Fixed fused OG card-row overlap by tightening line-wrap estimation and changed rarity icon vertical alignment so icons are centered against multi-line card names instead of anchoring to the first text line.
- (2026-02-07 UTC) Realigned fused OG rarity icons to the card text baseline and set icon size to match the rendered card font size for consistent row alignment.
- (2026-02-07 UTC) Tightened fused OG lower-bound safety by adding a larger fused height reserve and a stronger final card-column render-scale guard, eliminating bottom-edge glyph clipping in the first column on dense fused decks.
- (2026-02-07 UTC) Added a final fused OG render safety pass to prevent bottom-edge clipping of the last card row in dense lists, and aligned root image box sizing to keep layout math consistent with rendered bounds.
- (2026-02-07 UTC) Reworked fused OG vertical auto-fit to independently tune left/middle card columns and forgeborn column with bounded adaptive widths and spacing so each tested fused deck now has at least one column effectively filling full image height without overflow or overlap artifacts.
- (2026-02-06 UTC) Reworked fused OG auto-fit with bounded adaptive column widths and per-column spacing normalization to increase vertical fill across diverse fused decks while keeping all content inside image bounds.
- (2026-02-06 UTC) Removed a fused OG layout artifact that could create an unnatural large gap inside a card column, and switched back to natural section flow while raising fused auto-fit scale limits.
- (2026-02-06 UTC) Improved sparse fused OG card layouts by anchoring the last section to the bottom in one card column, reducing visible empty space at the bottom edge.
- (2026-02-06 UTC) Updated fused deck OG descriptions to omit the `Solbind` count from the card-type summary when the value is zero.
- (2026-02-06 UTC) Tuned fused OG fill balancing to use a tighter estimate allowance so card and ability text scale up more aggressively while still staying inside image bounds.
- (2026-02-06 UTC) Improved fused OG column auto-fit to maximize vertical fill (at least one column closely fills the frame) while keeping all column content within image bounds.
- (2026-02-06 UTC) Tightened fused OG auto-fit sizing for card columns to prevent long second-column card names from overflowing beyond the image bounds.
- (2026-02-06 UTC) Shortened fused deck OG rarity summary labels to compact initials (for example, `Common` -> `C`, `Darkforge LS` -> `DL`) to reduce description length.
- (2026-02-06 UTC) Added write-block protection for Supabase deck sync: when database writes fail due to read-only/disk-full conditions, deck search responses continue normally and sync attempts are temporarily paused.
- (2026-02-06 UTC) Stopped updating `player_profiles` during automatic deck search sync; profile data is now left untouched.
- (2026-02-06 UTC) Automatically sync searched player decks into Supabase tables (`player_decks`, `player_deck_cards`, `cards`, and `player_fused_decks`) during `/api/decks` and `/api/decks/stream` requests.
- (2026-02-06 UTC) Added a new `cards` table (`card_id`, `card_name`), linked `player_deck_cards.card_id` via foreign key, and updated `upsert_player_deck` to auto-register missing cards.
- (2026-02-06 UTC) Redesigned Supabase `player_decks` to a compact schema and moved deck card IDs into a dedicated `player_deck_cards` table with strict 10-card validation and an upsert RPC.
- (2026-02-06 UTC) Added a compact Supabase `player_fused_decks` model for fused decks with upsert support, case-insensitive owner lookup, and source-half indexes.
- Set the homepage OG/Twitter image to a dedicated `256x130` logo asset so preview dimensions match the header logo size.
- Add generated square site icons (`32x32`, `192x192`) and a dedicated `180x180` apple-touch icon from the three-card logo mark.
- Add a site favicon based on the three-card logo mark and wire it through root metadata icons.
- Keep homepage OG/Twitter preview image pinned to the smaller header logo variant instead of the full-size logo asset.
- Update homepage OG metadata title to `Too Many Decks` and use the site logo as the Open Graph/Twitter preview image.
- Fix slight descender clipping in fused OG third-column forgeborn ability text by removing row-level `overflow: hidden`.
- Improve OG text clarity in Discord previews by replacing blur-based text shadow with crisp edge shadowing and a heavier body font weight.
- Add an in-memory cache with in-flight deduplication for deck page Open Graph/Twitter metadata (title/description/alt), separate from OG image caching.
- Improve OG image text legibility under social preview compression by slightly increasing body text weight and adding a subtle text shadow for card and ability text.
- Split fused link preview deck-summary text so `Rarities` and `Creature Types` each render on their own line.
- Extend fused link preview descriptions with half-deck expiry dates (when available) and add a new summary line for creatures/spells/solbind counts, rarity counts, and creature type counts.
- Refine fused link preview metadata: format owner as `owner: <name>` in title and render half summaries as plain value lines (no half names, no parentheses, no `Faction:` label).
- For fused deck link previews, set metadata title to `Deck Name (Forgeborn, Owner)` and description to half-deck summaries only (with newline separation when supported).
- Prepend fused half-deck metadata (name, faction, set, score, ELO) to deck page Open Graph and Twitter descriptions.
- Increase fused OG third-column ability icon sizes (level and stat icons) by 1.5x.
- Preserve punctuation/quote attachment across OG ability text, level icons, and stat icons during wrapping.
- Tokenize OG ability text by words with explicit spacing and punctuation attachment for stable wrapping.
- Use normal whitespace collapse for OG ability text segments to avoid exaggerated wraps.
- Tighten OG ability punctuation normalization around commas/quotes.
- Remove unsupported `inline-block` display styles from OG ability rendering.
- Render OG ability text in an inline flow to improve natural line wrapping.
- Stop splitting OG ability text into per-word nowrap spans to prevent punctuation-led wrapped lines.
- Add explicit `display: flex` on OG ability rows to satisfy the renderer layout requirement.
- Render forgeborn level icons from inline `[lN]` tokens so wrapped lines use full width.
- Make OG forgeborn ability text truly inline with the level icons.
- Inline forgeborn level icons with ability text in OG previews.
- Reduce fused OG vertical padding to 12px and allow larger auto-fit scaling.
- Raise fused OG auto-fit max scale to 1.35 and use full-height budget.
- Reduce fused OG vertical padding to 16px.
- Relax fused OG auto-fit sizing to better fill vertical space.
- Strip stray spaces before periods in OG forgeborn ability text.
- Allow fused OG auto-fit to scale up to 1.3.
- Remove forgeborn names from the fused OG third column.
- Make the fused OG auto-fit typography more conservative to prevent overflow.
- Auto-fit OG fused column typography to maximize space without overflow.
- Match OG forgeborn ability font size to the card list.
- Increase OG rarity icons by 30% in the card list.
- Increase OG card list font size by another 5%.
- Remove fused half faction/set/score/ELO metadata and hide creatures/spells headers in OG images.
- Increase OG card list font size by 5%.
- Stop pluralizing rarity labels in deck list rarity tags.
- Stop pluralizing rarity labels in deck detail rarity tags.
- Add Darkforge_LS rarity icons for all sets and use them in deck detail card lists.
- Rename Darkforge_LS labels to Darkforge LS in rarity tags and filters.
- Add Min/Max limits to multi-select filters (Forgeborn, Card Name, Tags, Card Set) with any-match defaults.
- Add clear buttons for Min/Max inputs and widen filter scrollbars.
- Replace the header logo with the Too Many Decks mark and size it for the nav bar.
- Move Too Many Decks logo assets into a dedicated logo folder.
- Add a 1Y column to the crypto tracker with year-over-year percent change.
- Tighten header spacing to reduce empty horizontal gaps.
- Add a "Rarity (Word)" filter that matches decks by rarity tokens (e.g., Common matches Common Rare).
- Rename the rarity filter to "Rarity (Exact)" and add comparison operators for rarity counts.
- Add Darkforge Common and Darkforge_LS to rarity tags and filters.
- Close direct deck links back to the home page.
- Allow typing to filter the "Add filter" dropdown list.
- Derive filter blocks from URL order and use `_1` suffixes for repeated filters without `activeFilters`.
- Shorten filter URLs by omitting per-filter instance IDs when only one block is active.
- Round ELO values in OG deck previews to whole numbers.
- Rename the OG label from "Creature Tags" to "Creature Types".
- Set the site changelog date manually and format it using the viewer's locale.
- Speed up OG image generation by using a fast deck lookup, timeouts, and caching.
- Replace the OG forgeborn art with the forgeborn name and abilities.
- Cache deck detail responses on the server for 24 hours, including fused half-decks.
- Render forgeborn ability text only from the deck JSON (no local card database fallback).
- Show level icons next to forgeborn abilities in OG previews.
- Read forgeborn ability text from deck `levels`/`a2t` fields so abilities render reliably.
- Render OG ability text on the same line as the level icon without duplicating the level label.
- Replace A/H/D stat letters with attack/health/armor icons in OG ability text.
- Replace `[l1]`–`[l4]` tokens in OG ability text with level icons.
- Show the full non-forgeborn card list in the OG left column instead of deck stats.
- Increase non-level icon sizes and align OG icons with text.
- Show faction and rarity icons before each card name in the OG card list, matching the deck details modal style.
- Insert a space before `+` in forgeborn ability text so stat boosts are easier to read in OG previews.
- Split OG layout into two equal-width columns so card list and forgeborn ability text have balanced space.
- Allow forgeborn ability text to wrap onto new lines in OG previews to avoid clipping at the right edge.
- Insert a space before both `+` and `-` modifiers in forgeborn ability text.
- Increase OG stat icon sizes (attack/health/armor) by 1.5x.
- Increase OG card-list icon and font sizes by 1.5x for better readability.
- Add hard OG request/read timeouts so slow deck/icon fetches fall back instead of hanging the image response.
- Fetch OG deck data directly from the upstream SolForge API instead of calling the internal `/api/deck` route first.
- Add a 10-minute in-memory cache for computed OG payloads and reuse in-flight OG payload fetches per deck.
- Cache OG icon data URLs in memory and reuse in-flight icon fetches to avoid repeated icon downloads.
- Extend OG CDN cache (`s-maxage`) from 10 minutes to 60 minutes.
- Add a lighter fast path in `/api/deck/[id]` by reducing candidate IDs and using shorter timeouts for `fast=1`.
- Pre-warm `/api/og/deck/[id]` when opening `/deck/[id]` so sharing is faster right after viewing a deck.
- Extend in-memory OG payload and icon cache TTL to 24 hours.
- Cache only complete OG payloads (with card list + forgeborn name + abilities) to avoid persisting fallback/incomplete results.
- Add LRU limits to OG payload and icon caches to bound memory usage.
- Add manual OG cache bypass via `?refresh=1`.
- Refresh icon cache TTL on each icon cache hit (sliding expiration) to keep frequently used icons warm.
- Replace the previous object-storage OG cache integration with optional Upstash Redis OG cache integration.
- Read/write Upstash-cached OG images in a best-effort mode and keep in-app OG generation as fallback when Upstash is unavailable.
- Document Upstash + Netlify OG cache setup and verification steps in `README.md`.
- Normalize Upstash env values by trimming whitespace and optional wrapping quotes.
- Sanitize forgeborn ability HTML text in OG previews and stabilize OG-safe rendering so iconized ability lines render without overlap.
- Tighten OG forgeborn ability typography and enforce flex item width constraints so long ability text wraps within the right column.
- Rework OG ability line rendering into flex-wrapped text/icon tokens so forgeborn ability text no longer overflows the right edge.
- Redesign OG layout: move forgeborn abilities into a full-width top section and place the card list below it.
- Render fused deck card lists in two columns (one half-deck per column) in OG previews.
- Keep OG card names on a single line with ellipsis truncation instead of wrapping.
- Unescape stray backslash-escaped quotes in OG forgeborn ability text.
- Force single-line OG card names via pre-truncation + nowrap to keep names visible in the card list.
- Use one shared medium font size for OG forgeborn ability text and card list entries.
- Keep OG section labels and counts on one line and tighten the gap between abilities and the card list.
- Replace fused OG column headers with faction icon + set + rounded score (x100) + rounded ELO.
- Show fused deck name in parentheses next to the forgeborn name in OG previews.
- Scale all fused OG typography up by 20% for better readability.
- Redesign fused OG layout into three equal columns: half-deck 1, half-deck 2, and forgeborn details.
- Force explicit 33.33% widths for fused OG columns to prevent single-column overlap rendering.
- Increase fused OG typography by another 20% to improve readability in the 3-column layout.
- Show only the forgeborn name in fused OG titles (remove deck name suffix).
- Tune fused OG third-column typography (forgeborn title and ability text) to avoid cramped wrapping.
- Make fused OG forgeborn column use the full third-column width instead of content-sized width.
- Ensure fused OG third-column wrapper is an explicit flex container to satisfy OG renderer constraints.
- Render OG ability text as inline flow tokens (instead of wrapped flex items) to prevent odd line breaks in the fused third column.
- Remove unsupported `display: inline-block` styles from OG ability tokens to prevent 500 rendering errors in Satori.
- Skip base64 icon fetches for local `/images/*` assets in OG rendering to avoid self-fetch stalls and restore fast responses.
- Let OG text wrap naturally across all three fused columns (cards and forgeborn abilities) instead of truncating to one line.
- Allow long fused OG card names to wrap within their columns instead of truncating with ellipsis.
- Restore iconized forgeborn ability rendering in fused OG and constrain third-column text wrapping to prevent right-edge clipping.
- Further tighten fused OG third-column typography and add right padding so forgeborn abilities fit without clipping.
- Rebalance fused OG column widths to make the third (forgeborn) column narrower while preserving readable text and icon layout.
- Set fused OG column ratios to 1.1 / 1.1 / 1.0 and smooth third-column wrapping with less aggressive word breaks.
- Improve fused third-column line wrapping by rendering ability text as inline flow (no flex token wrapping) and stripping leftover `[l*]` markers.
- Fix fused third-column stat icon rendering and reapply hard width constraints to prevent right-edge overflow.
- Ensure fused forgeborn abilities always show level icons, render `[1-4]` inline level tokens as icons, and wrap third-column text in block flow to prevent right-edge clipping.
- Fix OG route stalls by resolving local `/images/*` assets to data URLs and returning a fully buffered PNG response.
- Move OG rendering to Node runtime and keep Satori-safe `display:flex` wrappers to avoid hidden 500 failures.
- Increase all OG image typography by 10% for better readability.
- Color OG card names by faction with high-contrast shades so all four factions remain readable on the dark background.
- Color the forgeborn name in OG using the forgeborn faction color with the same high-contrast palette.
- Remove per-card faction icons from OG card rows, keeping only rarity icons and colored card names.
- Increase OG image typography by an additional 5%.
- Restore inline forgeborn `[l1]-[l4]` ability token rendering as level icons in OG text.
- Improve fused forgeborn ability text wrapping to reduce premature line breaks around inline icons.
- Fix fused OG generation stalls by using a Satori-safe flex wrapper for forgeborn ability text tokens.
- (2026-02-05 UTC) Improve fused forgeborn third-column wrapping by rendering ability tokens in inline flow instead of flex-wrapped items.
- (2026-02-05 UTC) Show alternate forgeborn form names and abilities in OG previews when available.
- (2026-02-05 UTC) Prevent OG ability stat icons from replacing letters inside words like "Damage".

### Fixed
- Include Solbind cards from both halves in fused deck modal lists.
- Ensure the deck modal list pane can scroll to the final items without clipping.
- Fix fused deck metadata descriptions so Solbind counts reflect both halves.
- Count nested Solbind references from card-level `solbindCards` and `solbindId*` fields in fused metadata descriptions.
- Add an internal half-deck fallback in fused metadata generation so half expiry dates appear when upstream deck details omit expiry.
- Rename fused metadata half expiry label from `Expires` to `Expire date`.
- Allow fused OG auto-fit to upscale further when all columns are still underfilled at the default max scale.
- Add a fused OG post-fit fill boost so the tallest column scales toward full-height usage.
- Render attack/health/armor icons for standalone uppercase `A`, `H`, and `D` tokens inside OG ability text.
- Show the earliest half-deck expiry date for fused decks in the card modal header.
- Remove the extra modal scrollbar in deck card views when the content already fits.
- Avoid unsupported `inline-flex` styles in OG ability rendering to prevent preview failures.
- Reject invalid `next-action` POST requests in proxy middleware to prevent repeated "Failed to find Server Action" runtime errors.
- Fix exact rarity filtering by including Darkforge Common and Darkforge LS in computed rarity counts.

## [0.0.1] - 2026-01-30

### Added
- `AGENTS.md` with project notes and contribution rules.
- `CHANGELOG.md` to track notable changes.
- `AI_REQUESTS.md` to record agent requests and resulting commits.
- Added `*_DarkforgeCommon.png` rarity icons (B1, S1–S4) under `public/images/icons/rarity/`.
- `.env.example` with required environment variables.

### Changed
- Updated contribution rules in `AGENTS.md` (build/commit flow and logging).
- Switched `AI_REQUESTS.md` request entries to English and added an English-only rule in `AGENTS.md`.
- Added a UTC date requirement for `CHANGELOG.md` entries.
- Require committing every change without prompting.
- Rewrote the header changelog highlights in plain, user-friendly wording.
- Documented how to write the in-app changelog in user-friendly language.
- Prefer forgeborn image URLs with spaces, falling back to dash variants (resized path).
- Skip forgeborn rotation when using `/resized/` images.
- Added a safe fallback auth provider when Discord credentials are missing.
- Disabled session polling when auth is not configured and added a dev secret fallback.
- Increased the display scale for unrotated forgeborn images.
- Apply forgeborn scaling even without rotation and increase the scale further.
- Increased the forgeborn scale to 2.2.
- Nudge forgeborn image positioning to balance top and bottom padding.
- Adjust forgeborn image vertical offset to avoid sticking to the bottom edge.
- Soften the forgeborn vertical offset.
- Reset forgeborn vertical offset to 0%.
- Center forgeborn images vertically by anchoring and translating to the frame center.
- Lower forgeborn images slightly within the frame.
- Make `/api/deck/[id]` resilient when Supabase env vars are missing.
- Make `/api/saved-decks` return empty data when Supabase is not configured.
- Add deck-specific Open Graph metadata with forgeborn image and composition summary.
- Switch deck link previews to list card names only and use a non-stretched forgeborn image.
- Use a custom OG image for deck links and set the preview title to the deck name.
- Auto-rotate OG forgeborn images when they are landscape.
- Flip OG rotation logic to keep images horizontal.
- Scale up OG forgeborn images to reduce empty space.
- Increase OG forgeborn image scale to 1.5.
- Add richer OG deck previews with header chips, composition stats, and a styled frame.
- Revert OG deck previews to the image-only layout.
- Shift the OG deck image to the right and add a left column with counts and metadata.
- Add set, rarity counts, and creature tags to the OG left column.
- Add ELO to the OG metadata and scale the left column typography.
- Reduce OG left column font sizes and include Solbind cards in deck list text.
- Order deck list text as forgeborn, creatures, spells, then solbind cards.
- Fix deck list ordering so non-forgeborn cards are included again.
- Stop restarting deck searches when the tab regains focus.
- Add B2 set support in set detection, tags, filters, and rarity icons.
- Rename the player deck search button to "Load Decks".
- Fix deck grid wrapping when the viewport only allows two columns.
- Make the deck details modal responsive at narrow widths.
- Reduce forgeborn scale on narrow modals to avoid image clipping.
- Allow modal header badges/links to wrap on narrow widths.
- Allow deck title and header badges to wrap on all widths when needed.
- Show the selected card image inline under its name on narrow modals.
- Render the full card frame inline under the selected list item in narrow mode.
- Show rarity and tag badges after the card list on narrow modals.
- Remove the nested scroll area in deck details to avoid multiple scrollbars.
- Lock background scroll while the deck details modal is open.
- Drop manual body scrolling so the modal uses a single scroll container.
- Auto-scroll the selected card into view on narrow layouts and give the card frame more height.
- Reduce empty space in narrow card frames and ensure level buttons fit.
- Scroll to the card label on selection and keep narrow frame height consistent across viewport sizes.
- Tighten narrow card frame padding and align auto-scroll to keep card titles visible.
- Add B3 set detection across APIs, UI filters, and rarity icons.
- Prevent URL auto-search from overwriting manual username input.
- Ensure force refresh bypasses cached deck pages and fused deck requests.
- Prefer explicit cardSetId/cardSetNo over computed deckSet in deck list display.
- Set deck list pagination size to 100 for regular and fused decks.
- Keep number input spinners visible while showing a separate clear button in filters.
- Improve narrow card scroll offset and tighten card frame spacing.
- Keep the card detail frames fixed in wide deck modals while the card list scrolls.
- Use fused deck cards to compute creature tags in list view.
- Fetch fused deck details when subtype data is missing to keep creature tags accurate.
- Compute fused creature tags by summing cached tags from the two source decks.
- Reset deck search state when navigating home from the header logo.
- Keep deck search progress moving when fused deck fetch fails.
- Retry fused deck fetches on 5xx responses.
- Resolve fused creature tags from half deck ids/names and compute locally when cache is missing.
- Fetch half-deck details on demand to correct fused creature tags in list and modal views.
- Preserve detailed deck cards when enriching from player listings.
- Retry fused half tag fetches when cached creature tags are missing.
- Prefer subtype-rich half deck data over cached tags when summing fused creature tags.
- Cache corrected half-deck creature tags separately and prefer them for fused tags.
- Disable Supabase-backed routes and clients when Supabase is turned off.
- Remove Supabase deck storage/loading endpoints and delete Supabase deck helpers.
- Avoid repeated creature tag updates that caused fused deck modal hangs.
- Persist fused view selection in the URL using an isFused query parameter.
- Prevent URL auto-search from overriding a just-submitted manual player search.
- Fix card set filtering for fused decks by resolving sets from source halves.
- Normalize numeric card set values to S* so fused set filtering matches S3/S4.
- Normalize selected card set filters to match fused set labels.
- Detect fused decks by id/flags when resolving card sets for filters.
- Always resolve fused card sets from halves even when fused cards are present.
- Derive the header changelog merge date from git merge commits via a release API.

### Fixed
- Populate fused deck card set values from source halves to keep card-set filtering reliable.
- Generate deck preview metadata for fused decks by falling back to the internal deck API.
- Force deck pages to render metadata dynamically so fused previews resolve at request time.
- Ignore non-deck API responses when building deck metadata so fused fallbacks can run.
- Populate fused deck forgeborn data from source halves to render OG images.
- Add a faction icon before the set value in OG previews for non-fused decks.
- Show fused half set labels with per-faction icons in OG previews.
- Allow OG set icons to render from direct URLs when base64 fetches fail.
- Fix OG renderer crash by removing unsupported inline-flex display values.
- Add a header changelog modal with versioned highlights.
- Summarize header changelog content instead of mirroring the full CHANGELOG.
