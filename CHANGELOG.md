# Changelog

All notable changes to this project will be documented in this file.
Dates use UTC and roll over at 00:00 UTC.

## [Unreleased] - 2026-02-04

### Added
- `AGENTS.md` with project notes and contribution rules.
- `CHANGELOG.md` to track notable changes.
- `AI_REQUESTS.md` to record agent requests and resulting commits.
- Added `*_DarkforgeCommon.png` rarity icons (B1, S1–S4) under `public/images/icons/rarity/`.
- `.env.example` with required environment variables.

### Changed
- Set the site changelog date manually and format it using the viewer's locale.
- Rename the OG label from "Creature Tags" to "Creature Types".
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
- Round ELO values in OG deck previews to whole numbers.
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
