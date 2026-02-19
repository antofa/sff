# AI Requests Log

This file tracks requests made to the coding agent and the commit that resulted from each request.

## Format
- Commit: <sha>
  Request: <user prompt>
  Date: YYYY-MM-DD

## Entries
- Commit: c58052c
  Request: When searching decks for nickname `themanly1`, not all decks are added to the database. Move this process to a server-side background flow (not client-side); currently decks are written in small batches while the browser page remains open.
  Date: 2026-02-18
- Commit: a01e1ea
  Request: Install Playwright (headless Chromium) and verify directly whether the deck-count issue is gone.
  Date: 2026-02-18
- Commit: 1b0d317
  Request: The process completes, but the deck count became smaller: API logs show 6258 regular decks for `traveller`, while the UI shows only 1946. Fix this regression.
  Date: 2026-02-18
- Commit: 2c3ed2a
  Request: Implement SSE deck pagination/chunking: send `decks-chunk` batches (50-100 decks) instead of one giant `decks-ready` payload, accumulate chunks on the client, and finalize on `done`.
  Date: 2026-02-18
- Commit: ab14847
  Request: Fix these issues: broken `all-decks` due missing `/api/saved-decks`, `503` failures on player pages when Supabase is disabled, unnecessary bulk half-deck API loads when opening fused decks from list, and duplicate `/api/auth/session` requests.
  Date: 2026-02-09
- Commit: 2e0481d
  Request: With an opened fused deck, are there still continuous identical requests to half-deck endpoints?
  Date: 2026-02-09
- Commit: 33b99c3
  Request: Proceed with reducing duplicate fused deck resource loading requests.
  Date: 2026-02-09
- Commit: 97186aa
  Request: Do not do extra optimizations; keep all header elements in their final positions during loading so an extra row does not appear.
  Date: 2026-02-09
- Commit: eb51c5f
  Request: Revert the last couple of PNG rendering changes; only commit `61a0250` is considered working.
  Date: 2026-02-09
- Commit: 12e22b1
  Request: `http://trumpumpum.duckdns.org:3000/api/og/deck/00fceeenogc6goaiajiaumf1qj9sla?refresh=1` — now the text does not fit.
  Date: 2026-02-09
- Commit: f0dd231
  Request: Let's try optimizing `image_png_render` without removing icons: reduce JSX node count, keep icon set, make icon rendering more uniform/lightweight, and replace part of `<img>` icons with inline SVG where possible.
  Date: 2026-02-08
- Commit: 61a0250
  Request: Let's fix the OG image issue; Forgeborn abilities are clipped in deck previews.
  Date: 2026-02-08
- Commit: 1f3ba68
  Request: Revert the latest changes related to Forgeborn image sizing; this was intended for OG deck image issues where Forgeborn abilities are clipped.
  Date: 2026-02-08
- Commit: ed15b54
  Request: Can you install everything you need for this?
  Date: 2026-02-08
- Commit: 9fc4566
  Request: On `https://solforgefusion.netlify.app/deck/s4-abiaggaxrazxb1tb1ubnuboucg6cj7`, the Forgeborn ability text does not fit completely in the card frame.
  Date: 2026-02-08
- Commit: e498453
  Request: The changelog is missing details like OG image/title/description changes and the new filter; clarify whether the summary covered only today or the full period since the last merge.
  Date: 2026-02-08
- Commit: 342074d
  Request: The header changelog must keep full history: all previous versions and their changes should remain visible.
  Date: 2026-02-08
- Commit: 8ec860c
  Request: Keep this log only in dev (`NODE_ENV !== 'production'`).
  Date: 2026-02-08
- Commit: 2e10096
  Request: Decks are fetched quickly in stream logs, but in the UI they appear only after late background stages (`supabase sync done` and `owner cache done`); remove this perceived blocking.
  Date: 2026-02-08
- Commit: 27e7e83
  Request: Fused deck navigation became unstable: after switching between fused and half decks, header/meta and card content could stay from a previous view, and opening the second half from a direct fused link sometimes required multiple clicks.
  Date: 2026-02-08
- Commit: 3a3777f
  Request: After opening a fused deck by direct link, going into a half deck, and returning via `Back to Fused`, the fused view repaints from scratch (expire date, faction icons, sets, ELO, score) as if full data was not already loaded.
  Date: 2026-02-08
- Commit: 883212d
  Request: For fused decks opened by direct link, `Expire date` still does not appear (example: `http://trumpumpum.duckdns.org:3000/deck/Fused_93hi52mfig65sm`).
  Date: 2026-02-08
- Commit: b66c591
  Request: The debug payload still includes `allDecksIds` and can be heavy; reduce this log while keeping it informative.
  Date: 2026-02-08
- Commit: b897745
  Request: For fused deck `http://trumpumpum.duckdns.org:3000/deck/Fused_93hi52mfig65sm`, there is no `Expire date` tag even though one of its halves has an expiry date.
  Date: 2026-02-08
- Commit: a7de86a
  Request: I checked this deck URL and the non-fused deck `Expire date` still does not load in the background; is it missing in Supabase or is the issue elsewhere?
  Date: 2026-02-08
- Commit: 9cf2bb9
  Request: Change direct deck-link loading so data priority is external API first, then missing fields from Upstash, then from Supabase, with no full owner-wide deck search; also clarify whether expire date and tags can be read directly from the external deck API.
  Date: 2026-02-08
- Commit: 1af0f2c
  Request: All information in all files must be in English, including `AI_REQUESTS.md`.
  Date: 2026-02-08
- Commit: 8a7cf8c
  Request: During player deck search, a "saving decks to database" step appeared; it must not block showing already found decks and should run in the background.
  Date: 2026-02-08
- Commit: 826757a
  Request: Fix the second and third points.
  Date: 2026-02-08
- Commit: e679242
  Request: When opening a fused deck by direct link, you can open a half deck by clicking it, but cannot navigate back (the "Back to Fused" button is missing; it exists when opening the same fused deck from the player's loaded deck list).
  Date: 2026-02-08
- Commit: 7692b8a
  Request: [2026-02-08T17:40:14.384Z] GET /deck/Fused_1d4jjh2mkpba06f?sdf=234egvc 200 in 9.8s (proxy.ts: 598ms) — how can this be sped up?
  Date: 2026-02-08
- Commit: d7d2960
  Request: Remove text shadow and measure results on any three decks of player `fong`.
  Date: 2026-02-08
- Commit: 8098e5a
  Request: Add precise OG generation stage profiling to explain why rendering takes ~8 seconds, then test and show the timing breakdown.
  Date: 2026-02-08
- Commit: 27cd78f
  Request: Reduce cold OG image generation time for all decks; auto-fit can be simplified/removed, but all text (all card names and all forgeborn abilities) must always fit within the image bounds.
  Date: 2026-02-08
- Commit: 8cc11fc
  Request: For `http://trumpumpum.duckdns.org:3000/api/og/deck/s3-a9eaece4xe63ehdep8flqgcbgcrgiq?refresh=1`, improve non-fused OG auto-fit further: reduce remaining bottom empty space in the first column and reduce perceived empty space between columns by better per-column font and width balancing.
  Date: 2026-02-08
- Commit: f4a8f4f
  Request: For `http://trumpumpum.duckdns.org:3000/api/og/deck/s3-a9eaece4xe63ehdep8flqgcbgcrgiq?refresh=1`, fix regular-deck OG auto-fit because vertical and horizontal fitting was weak, with too much empty space between columns and at the bottom (especially in the first column).
  Date: 2026-02-08
- Commit: df906ec
  Request: Change OG generation so each column is maximally filled (allowing slight adaptive column-boundary shifts), then verify on the same 20 decks and tighten further for `Fused_1qrav2mfzdk9b9` where columns had too much bottom empty space.
  Date: 2026-02-08
- Commit: 461a001
  Request: Ignore browser-extension (MetaMask) runtime errors in global client error logging so they are not sent to `/api/log-error` or written to server logs.
  Date: 2026-02-08
- Commit: b27ee3e
  Request: Remove `Creatures` and `Spells` labels from regular-deck OG images.
  Date: 2026-02-07
- Commit: 800eccd
  Request: Count `Creature Types` in OG descriptions for all decks exactly like in the modal, so compound subtypes (e.g. `Zombie Warrior`) are split into separate types.
  Date: 2026-02-07
- Commit: bdcab9f
  Request: Fix remaining slight bottom clipping and improve non-fused OG auto-alignment by width as well as height to reduce unused space between columns.
  Date: 2026-02-07
- Commit: 7720d96
  Request: Fix regular OG second-column overflow where forgeborn ability text does not fit (`/api/og/deck/epjfotg0jhjnhzrjdfjnqpm3r06rea`).
  Date: 2026-02-07
- Commit: dbcd15f
  Request: Also make `og:title` and `og:description` for regular decks analogous to fused decks.
  Date: 2026-02-07
- Commit: a3d501c
  Request: Re-check the real half-deck OG URL and fix remaining bottom clipping where the last card line was cut off.
  Date: 2026-02-07
- Commit: 28ccc44
  Request: Make OG for half-decks work analogously to fused decks.
  Date: 2026-02-07
- Commit: bb4f550
  Request: Only one logo is used in the header; cache just that file, not all logo assets.
  Date: 2026-02-07
- Commit: c4b957c
  Request: Cache the header logo for one day.
  Date: 2026-02-07
- Commit: 22ab805
  Request: Re-check real remote OG images for remaining bottom empty space and fix fused auto-fit to improve column height fill without overlap.
  Date: 2026-02-07
- Commit: 0372f1c
  Request: Verify on actual remote OG images before reporting completion; fix fused OG text overlap and center rarity icons relative to two-line card names.
  Date: 2026-02-07
- Commit: 9bc6e66
  Request: In fused OG card lists, keep rarity icons vertically aligned with text and make icon size match the card font size.
  Date: 2026-02-07
- Commit: 4efc6eb
  Request: Re-check and fix fused OG where first-column letters were still clipped by the bottom image edge on `Fused_u9912mkvb9mqm`.
  Date: 2026-02-07
- Commit: 557ea2d
  Request: Fix fused OG clipping where the 10th card in the first column could render beyond the bottom edge for `Fused_u9912mkvb9mqm`.
  Date: 2026-02-07
- Commit: 0bb53a6
  Request: Fix fused OG auto-fit so at least one column fully fills vertical space for each of three specific fused deck URLs, while checking the full image for artifacts and allowing bounded automatic column-width adjustments.
  Date: 2026-02-07
- Commit: 4b20faf
  Request: Fix fused OG auto-fit for multiple specific deck URLs, maximizing column fill across full height (or at least one column) without artifacts, and allow bounded automatic column-width adjustments if needed.
  Date: 2026-02-06
- Commit: 528db89
  Request: Review the whole fused OG image for anomalies, not just bottom spacing; detect and fix any strange layout artifacts.
  Date: 2026-02-06
- Commit: affc143
  Request: Fix fused OG auto-fit inconsistency where `Fused_28e2ml15qmam` looked correct but `Fused_u9912mkvb9mqm` still left bottom empty space.
  Date: 2026-02-06
- Commit: 0df8fff
  Request: In fused OG descriptions, do not show the `Solbind` card-type count when it is 0.
  Date: 2026-02-06
- Commit: e15b918
  Request: Increase fused OG vertical fill because previous change still looked unchanged; keep text inside image bounds.
  Date: 2026-02-06
- Commit: 38750c8
  Request: Adjust fused OG so at least one column fills the image vertically while ensuring text never overflows outside the image bounds.
  Date: 2026-02-06
- Commit: ae88f70
  Request: Fix fused OG image overflow where second-column card text goes beyond image bounds for `http://hadoop21.click:3000/api/og/deck/Fused_28e2ml15qmam?refresh=1`.
  Date: 2026-02-06
- Commit: 424c4de
  Request: Reduce the `Rarities` block in fused OG descriptions by using short rarity initials (for example, `C 8`, `DL 1`).
  Date: 2026-02-06
- Commit: 41a4bd5
  Request: Add proactive handling for Supabase database-full/read-only mode so deck search does not fail when writes are blocked.
  Date: 2026-02-06
- Commit: 6308f02
  Request: Do not touch `player_profiles` for now during deck search synchronization.
  Date: 2026-02-06
- Commit: f3c0479
  Request: Make all database tables populate automatically when searching decks by player nickname on the site.
  Date: 2026-02-06
- Commit: 03d3a79
  Request: Create a separate `cards` table with `card_id` and `card_name`, and link `player_deck_cards` to it by `card_id`.
  Date: 2026-02-06
- Commit: 5e9239e
  Request: PLEASE IMPLEMENT THIS PLAN: Redesign `player_decks` to compact fields, move cards to `player_deck_cards`, enforce exactly 10 cards with deferred constraint trigger, add `upsert_player_deck` RPC, migrate data with hard cutover, and update types.
  Date: 2026-02-06
- Commit: f12cc61
  Request: PLEASE IMPLEMENT THIS PLAN: Updated `player_fused_decks` schema without `api_created_at`/`api_updated_at`, with `synced_at`, source deck IDs, check/indexes, and upsert behavior.
  Date: 2026-02-06
- Commit: 5703412
  Request: Make the homepage OG image use the same logo size as in the header.
  Date: 2026-02-06
- Commit: 7832761
  Request: Add a dedicated `180x180` apple-touch-icon and use square favicon assets for the site.
  Date: 2026-02-06
- Commit: 3ded23c
  Request: Add a favicon using the three-card mark from the site logo, and use the smaller header logo (not the full-size icon) for the homepage OG image.
  Date: 2026-02-06
- Commit: fa6ffc1
  Request: Change OG metadata for the homepage (`http://hadoop21.click:3000/`): set the title to "Too Many Decks" and use the site icon as the image.
  Date: 2026-02-06
- Commit: 3a560c1
  Request: Add a CHANGELOG.md file to track changes; add another file to keep a history of all AI requests, including the commit ID and the request that led to it.
  Date: 2026-01-28
- Commit: bd6a274
  Request: Translate all AI_REQUESTS.md entries to English; add a rule in AGENTS.md to write all code, comments, and text in English.
  Date: 2026-01-28
- Commit: 10340a1
  Request: Commit every change without prompting for confirmation.
  Date: 2026-01-28
- Commit: e095953
  Request: Download https://solforgefusion.com/images/cards/rarity/S4_DarkforgeCommon.png for all sets and place it next to the other rarity icons on the server.
  Date: 2026-01-28
- Commit: 638dfd1
  Request: Change the forgeborn image URL to try the space-encoded variant first, then fall back to the dash variant.
  Date: 2026-01-28
- Commit: 671f307
  Request: If a forgeborn image is loaded from a /resized/ URL, do not rotate it when displaying.
  Date: 2026-01-28
- Commit: 15a5ba0
  Request: Fix the NextAuth dev error by allowing auth to run without Discord credentials.
  Date: 2026-01-28
- Commit: ea36456
  Request: Fix the NextAuth dev error that still appears by skipping session fetch when auth is not configured and adding a dev secret fallback.
  Date: 2026-01-28
- Commit: cd1ca5b
  Request: Increase the on-screen size of forgeborn images (they appear too small).
  Date: 2026-01-28
- Commit: 6ed913c
  Request: Forgeborn images are still too small; increase their displayed size.
  Date: 2026-01-28
- Commit: d9c018a
  Request: Set the forgeborn image scale to 2.2.
  Date: 2026-01-28
- Commit: 39d1fca
  Request: Keep the forgeborn image size but make top and bottom padding inside the frame equal.
  Date: 2026-01-28
- Commit: 4503b7c
  Request: The forgeborn image is stuck to the bottom edge; adjust vertical alignment.
  Date: 2026-01-28
- Commit: e0af813
  Request: The forgeborn image is too high; reduce the vertical offset.
  Date: 2026-01-28
- Commit: 687cc51
  Request: Set the forgeborn top offset to 0% and report the objectPosition value.
  Date: 2026-01-28
- Commit: 4289606
  Request: Vertically align the forgeborn image within the frame.
  Date: 2026-01-28
- Commit: a8d6d0d
  Request: Move the forgeborn image down by a couple of percent.
  Date: 2026-01-28
- Commit: cc7f248
  Request: Fix direct deck links failing with JSON parse errors (likely due to missing Supabase config).
  Date: 2026-01-28
- Commit: 030e621
  Request: Fix /all-decks failing with HTTP 500 from /api/saved-decks when Supabase is not configured.
  Date: 2026-01-28
- Commit: 9bcc337
  Request: Replace deck link previews with a short deck summary and forgeborn image.
  Date: 2026-01-28
- Commit: 478dce7
  Request: Use only card names in deck preview text and avoid a stretched forgeborn image.
  Date: 2026-01-28
- Commit: 7691a09
  Request: Use the deck name as the preview title and generate a larger, non-stretched forgeborn image.
  Date: 2026-01-28
- Commit: dcf6e1a
  Request: Fix the deck preview forgeborn image being rotated 90 degrees clockwise.
  Date: 2026-01-28
- Commit: cde4a76
  Request: The deck preview image is rotated 90 degrees counterclockwise; keep it horizontal.
  Date: 2026-01-28
- Commit: 73074e1
  Request: Make the deck preview image larger to reduce empty background space.
  Date: 2026-01-28
- Commit: 4b6e3fa
  Request: Set the OG preview image scale to 1.5.
  Date: 2026-01-28
- Commit: e2b952d
  Request: Add a header with faction/set/format, composition chips, and a footer line to the deck preview.
  Date: 2026-01-28
- Commit: 294d729
  Request: Fix the OG deck image error requiring explicit flex display on divs with multiple children.
  Date: 2026-01-28
- Commit: 66bd971
  Request: Revert the rich OG deck preview (header chips, composition chips, footer, gradient frame) and keep only the image.
  Date: 2026-01-28
- Commit: 61da1a6
  Request: Shift the deck preview image right and add a left column with creatures/spells/solbind plus owner, score (x100 rounded), and expiry.
  Date: 2026-01-28
- Commit: 25e00af
  Request: Add set info above the column, plus rarity counts and creature tags below the deck composition.
  Date: 2026-01-28
- Commit: da700bc
  Request: Add ELO under score and double the font size for the entire left column.
  Date: 2026-01-28
- Commit: 2c77130
  Request: Reduce the left column font sizes by 1.5x and include Solbind cards in the deck list text.
  Date: 2026-01-28
- Commit: ec35720
  Request: Order the deck list as forgeborn, creatures, spells, then solbind.
  Date: 2026-01-28
- Commit: 48de35e
  Request: Fix the deck list so it includes all cards (not just the forgeborn).
  Date: 2026-01-28
- Commit: b4787e2
  Request: Prevent deck searches from restarting when the tab loses and regains focus.
  Date: 2026-01-28
- Commit: d8eb603
  Request: Add the new B2 set everywhere, including tags and filters.
  Date: 2026-01-28
- Commit: ad02edf
  Request: Rename the player deck search button text to \"Load Decks\".
  Date: 2026-01-28
- Commit: ca497f7
  Request: Fix deck card wrapping when the viewport only fits two columns.
  Date: 2026-01-28
- Commit: bbc804e
  Request: Improve deck details modal layout on narrow browser widths.
  Date: 2026-01-28
- Commit: 675b777
  Request: Fix forgeborn image clipping in the narrow deck details layout.
  Date: 2026-01-28
- Commit: 731b9b9
  Request: Allow deck detail header text (API/SFF/ELO/score/etc.) to wrap on narrow windows.
  Date: 2026-01-28
- Commit: deed9e0
  Request: Ensure the entire deck detail header (title, icons, owner badge, etc.) wraps to new lines.
  Date: 2026-01-28
- Commit: 9acd006
  Request: In narrow mode, show the selected card image inline under its list item (default to Forgeborn).
  Date: 2026-01-28
- Commit: 1f9db28
  Request: In narrow mode, show the full card frame (with level controls) inline under the selected list item and move it with the selection.
  Date: 2026-01-28
- Commit: 3ab9a81
  Request: In narrow mode, show rarity/type/tag badges after the last card in the list.
  Date: 2026-01-28
- Commit: 8dc805c
  Request: Remove extra nested scrollbars in the narrow deck details view.
  Date: 2026-01-28
- Commit: 4b0765c
  Request: Reduce the deck details view to a single scrollbar in narrow mode.
  Date: 2026-01-28
- Commit: 0852316
  Request: Remove the extra scrollbar by relying on the modal's own scroll behavior.
  Date: 2026-01-28
- Commit: 5b81dec
  Request: Auto-scroll the selected card into view on click and increase the card frame height so level buttons fit.
  Date: 2026-01-28
- Commit: 9ab4355
  Request: Add the alternate forgeborn form name and abilities to OG deck images when a second form exists.
  Date: 2026-02-05
- Commit: 8b731b4
  Request: Revert the latest change so OG previews do not pull forgeborn from another deck.
  Date: 2026-02-05
- Commit: f75fd28
  Request: Ensure OG ability stat icons do not replace letters inside words (e.g., \"Damage\") for Fused_4bhmw2mkebmvfd.
  Date: 2026-02-05
- Commit: 5623c88
  Request: Reduce empty space in narrow card frames and ensure level buttons are fully visible.
  Date: 2026-01-28
- Commit: abdae70
  Request: Scroll to the card label on selection and keep narrow frame height stable across viewport sizes.
  Date: 2026-01-28
- Commit: e40206e
  Request: Reduce vertical padding around narrow card images and scroll to keep card titles visible.
  Date: 2026-01-28
- Commit: d4f050f
  Request: Add B3 set detection (using cardSetId) across the app, and ensure B2 is detected the same way, including tags, filters, and rarity icons.
  Date: 2026-01-28
- Commit: 2f0cd98
  Request: Fix the search input so URL params no longer overwrite a new username when loading decks.
  Date: 2026-01-28
- Commit: ad7dbe8
  Request: Make force refresh bypass cached deck pages and fused deck requests.
  Date: 2026-01-28
- Commit: 8e07196
  Request: Fix deck list set badges to prefer explicit cardSetId/cardSetNo so B3/B2 display correctly.
  Date: 2026-01-28
- Commit: 2e64dac
  Request: Set deck list pagination to 100 per page for all deck types.
  Date: 2026-01-28
- Commit: 2342e43
  Request: Keep spinner controls visible in filter number inputs and place the clear button next to them.
  Date: 2026-01-28
- Commit: bde3f71
  Request: Fix narrow card auto-scroll offset and reduce empty space around the card image.
  Date: 2026-01-28
- Commit: 4055ac5
  Request: Keep the card image and tag panels fixed in wide deck detail modals while the card list scrolls.
  Date: 2026-01-28
- Commit: 17cc31d
  Request: Fix fused deck creature tags in the deck list to match the detail view.
  Date: 2026-01-28
- Commit: 188dba1
  Request: Fetch fused deck details when subtype data is missing so creature tags match the direct deck view.
  Date: 2026-01-28
- Commit: 42a30e1
  Request: Sum fused creature tags from cached regular deck halves and add a .env example.
  Date: 2026-01-29
- Commit: 078be22
  Request: Reset deck search state when clicking the header logo to return to a clean home page.
  Date: 2026-01-29
- Commit: 8acc624
  Request: Add retries for 5xx fused deck fetches, keep progress moving on fused errors, and keep build dependency updates.
  Date: 2026-01-29
- Commit: 1599cb1
  Request: Fix fused creature tags by resolving half deck ids/names and computing locally when cached tags are missing.
  Date: 2026-01-29
- Commit: 000d863
  Request: Fetch half-deck details on demand to correct fused creature tags in lists and modals.
  Date: 2026-01-29
- Commit: 3b1c69c
  Request: Refresh fused creature tags by retrying half-deck lookups and preserving detailed cards.
  Date: 2026-01-29
- Commit: 75d5ef5
  Request: Prefer subtype-rich half deck data over cached fused tags when summing creature types.
  Date: 2026-01-29
- Commit: e034b3d
  Request: Prefer cached half-deck creature tags over fused data and skip owner merges when fetching half details.
  Date: 2026-01-29
- Commit: 14cd194
  Request: Disable Supabase usage across the project.
  Date: 2026-01-29
- Commit: 72808de
  Request: Remove Supabase deck save/load code paths and APIs.
  Date: 2026-01-29
- Commit: 4badf94
  Request: Fix fused deck modal hang by avoiding repeated creature tag updates.
  Date: 2026-01-29
- Commit: 85dfd64
  Request: Add an isFused URL parameter to persist fused view selection on reload.
  Date: 2026-01-29
- Commit: 4637a6e
  Request: Stop auto-search from restarting a previous player after a manual search.
  Date: 2026-01-29
- Commit: d5dfea5
  Request: Fix card set filtering for fused decks in the list view.
  Date: 2026-01-29
- Commit: 0aebcd0
  Request: Fix S-set card set filtering for fused decks by normalizing numeric sets.
  Date: 2026-01-29
- Commit: 8096311
  Request: Normalize selected card set filters so fused S-sets match.
  Date: 2026-01-29
- Commit: 5058c39
  Request: Fix fused set filtering when format flag is missing.
  Date: 2026-01-29
- Commit: d6e1049
  Request: Ensure fused set filtering always uses half decks.
  Date: 2026-01-29
- Commit: be93cde
  Request: Fix fused deck filter returning zero results for S99 despite an existing fused deck.
  Date: 2026-01-29
- Commit: a93a121
  Request: Make social preview metadata render for fused decks too.
  Date: 2026-01-29
- Commit: 45338f0
  Request: Fix fused deck previews still showing fallback metadata.
  Date: 2026-01-29
- Commit: 326a943
  Request: Fix fused deck previews by ignoring invalid deck responses in metadata.
  Date: 2026-01-29
- Commit: 357dbf6
  Request: Fix missing forgeborn image in fused deck previews.
  Date: 2026-01-29
- Commit: 570d131
  Request: Add a set icon before the set value in OG previews for half decks.
  Date: 2026-01-29
- Commit: 23d5142
  Request: Fix missing set icons in OG previews.
  Date: 2026-01-29
- Commit: c044bdc
  Request: Fix OG preview crash and restore set icon rendering.
  Date: 2026-01-29
- Commit: d4f4d43
  Request: Use faction icon instead of set icon in OG previews.
  Date: 2026-01-29
- Commit: 5670daf
  Request: Show fused set labels with per-faction icons in OG previews.
  Date: 2026-01-29
- Commit: d9eacd0
  Request: Add a versioned changelog icon under feedback in the header.
  Date: 2026-01-29
- Commit: 02094b0
  Request: Expand the header changelog to show full entries and update the merge date.
  Date: 2026-01-29
- Commit: 8d23d55
  Request: Summarize the changelog modal instead of mirroring CHANGELOG.md.
  Date: 2026-01-29
- Commit: 127547e
  Request: Use the dev→master merge commit date for the changelog version.
  Date: 2026-01-29
- Commit: b8fc019
  Request: Make the site changelog more understandable to non-technical users (avoid jargon like OG and describe social sharing in plain language).
  Date: 2026-01-30
- Commit: 8ca5eee
  Request: Add guidance in AGENTS.md for writing the site changelog in user-friendly language.
  Date: 2026-01-30
- Commit: 977e2e5
  Request: Merge the dev branch into master and ensure the site changelog date reflects today.
  Date: 2026-01-30
- Commit: 320e244
  Request: Round the ELO value to a whole number in the OG card.
  Date: 2026-02-04
- Commit: d2e074d
  Request: Rename "Creature tags" to "Creature types" in the OG image.
  Date: 2026-02-04
- Commit: 3908cbb
  Request: Remove the automatic changelog build date; set version 0.0.1 to January 30, 2026 and show it in the viewer's locale format.
  Date: 2026-02-04
- Commit: fcf7608
  Request: Speed up OG image generation so it completes within 2 seconds to avoid Discord timeouts.
  Date: 2026-02-04
- Commit: a11f41c
  Request: Remove the forgeborn image from OG and render the forgeborn name and abilities in a vertical list instead.
  Date: 2026-02-04
- Commit: 961dc7b
  Request: Add 24-hour server caching for deck details opened in the modal (including fused halves and direct links) to avoid repeated API calls.
  Date: 2026-02-04
- Commit: 51292be
  Request: Populate OG forgeborn ability text from the deck (Nova abilities were missing and showed as unavailable).
  Date: 2026-02-04
- Commit: fffb4e4
  Request: Remove the local card database fallback and split the changelog into 0.0.1 (through Jan 30) and 0.0.2 for new changes.
  Date: 2026-02-04
- Commit: 6a606c0
  Request: Download level 1-4 icons and use them before forgeborn ability levels in OG images.
  Date: 2026-02-04
- Commit: c8faee7
  Request: Diagnose why forgeborn abilities were missing and render them from deck JSON fields.
  Date: 2026-02-04
- Commit: a420be3
  Request: Render OG ability text on the same line as the level icon without repeating the level label.
  Date: 2026-02-04
- Commit: 6efd966
  Request: Download armor/attack/health icons and replace A/H/D letters with icons in OG forgeborn abilities.
  Date: 2026-02-04
- Commit: db64428
  Request: Fix OG render failure caused by unsupported inline-flex in ability text rendering.
  Date: 2026-02-04
- Commit: fc78c56
  Request: Replace [l1]-[l4] tokens in forgeborn ability text with level icons in OG images.
  Date: 2026-02-04
- Commit: 0819077
  Request: Replace the OG left column stats with the non-forgeborn card list like the modal.
  Date: 2026-02-04
- Commit: ad17201
  Request: Make OG stat icons slightly larger (except level icons) and align all icons with text.
  Date: 2026-02-04
- Commit: 51c4272
  Request: In the OG image, add icons before each card name like in the modal, and add a space before `+` in forgeborn ability text.
  Date: 2026-02-04
- Commit: 9b6ec79
  Request: Make both OG image columns equal width, wrap forgeborn ability text to avoid right-edge clipping, add spaces before `+` and `-` in forgeborn abilities, increase attack/health/armor icons by 1.5x, and increase card-list icon/font sizes by 1.5x.
  Date: 2026-02-04
- Commit: 15391b8
  Request: http://hadoop21.click:3000/deck/s4-a7hainaunav6awkayfbxzcfscgmcll has no OG image; check and fix.
  Date: 2026-02-04
- Commit: aced616
  Request: Implement all listed OG speed improvements (remove internal API hop, add OG payload and icon caches, increase CDN cache, optimize fast API path, and pre-warm OG on deck page open).
  Date: 2026-02-04
- Commit: 7a254c5
  Request: Set payload/icon cache TTL to one day and add safeguards: cache only full payloads, cap cache size with LRU, and add manual bypass with `refresh=1`.
  Date: 2026-02-04
- Commit: a3cf189
  Request: Enable sliding expiration for icon cache TTL (refresh TTL on icon use).
  Date: 2026-02-04
- Commit: 904221b
  Request: Implement the Netlify + Cloudflare R2 plan: prewarm OG on deck open, keep OG cached for a day, and serve Discord from cache instead of rendering from scratch.
  Date: 2026-02-04
- Commit: 3ffa846
  Request: Add the Netlify + Cloudflare R2 setup checklist to README.
  Date: 2026-02-04
- Commit: a7f065e
  Request: Remove Cloudflare R2 everywhere (including .env.example and README.md) and add Upstash instead.
  Date: 2026-02-04
- Commit: daf14ef
  Request: I will remove quotes everywhere; if needed, update the code.
  Date: 2026-02-04
- Commit: a2760c9
  Request: Do you see the forgeborn ability rendering issue (overlap and clipping in OG)? Finish fixing it.
  Date: 2026-02-04
- Commit: 9a4b339
  Request: For this OG URL, forgeborn ability text still goes past the right edge; fix wrapping/clipping.
  Date: 2026-02-04
- Commit: 4e63e43
  Request: Make forgeborn abilities a full-width top section in OG; move card list below; for fused decks render card list in two columns (one half per column).
  Date: 2026-02-04
- Commit: 7ed4e7c
  Request: Keep card names on one line up to the middle of the image and remove stray "\" symbols from forgeborn ability text.
  Date: 2026-02-04
- Commit: 71d0566
  Request: Card names disappeared in OG; restore visible one-line card names.
  Date: 2026-02-04
- Commit: 77fbed1
  Request: Set one equal medium font size for both forgeborn ability text and card list text in OG image.
  Date: 2026-02-04
- Commit: a4070ff
  Request: Keep card-type counts on the same line as the type label and move the card list up closer under forgeborn abilities.
  Date: 2026-02-04
- Commit: 632b9db
  Request: For fused OG columns, replace Half1/Half2 with faction icon, set name, rounded score (x100), and rounded ELO.
  Date: 2026-02-04
- Commit: 65563e6
  Request: In fused OG image, show deck name in parentheses after the forgeborn name.
  Date: 2026-02-04
- Commit: 3220e01
  Request: [2026-02-04T09:33:14.241Z] Error: Failed to find Server Action "x". This request might be from an older or newer deployment.
  Date: 2026-02-04
- Commit: 652975c
  Request: In fused OG image, increase all typography by 20%.
  Date: 2026-02-04
- Commit: f348c33
  Request: Redesign fused OG into 3 equal columns: half 1 stats/cards, half 2 stats/cards, and forgeborn name/deck + abilities.
  Date: 2026-02-04
- Commit: 15bdd19
  Request: Fused OG still rendered like one column with overlap; fix to true three-column layout.
  Date: 2026-02-04
- Commit: 1075fb1
  Request: Increase all fonts in fused OG images by 20%.
  Date: 2026-02-04
- Commit: 05ad24f
  Request: In fused OG image, remove the deck name and keep only the forgeborn name in the title.
  Date: 2026-02-04
- Commit: d5b887a
  Request: Third column text in fused OG formats strangely; fix forgeborn column typography/wrapping.
  Date: 2026-02-04
- Commit: 73bfb47
  Request: In fused OG, third-column text does not use full column width; make forgeborn content fill the whole third column.
  Date: 2026-02-04
- Commit: 39d06de
  Request: OG route fails with "Expected <div> to have explicit display:flex"; fix fused third-column wrapper rendering.
  Date: 2026-02-04
- Commit: 40c50da
  Request: Strange line breaks in fused OG third column; fix ability text wrapping to use full line flow.
  Date: 2026-02-04
- Commit: 2d70745
  Request: OG returns 500 due to unsupported CSS display:inline-block in ability rendering; remove unsupported styles.
  Date: 2026-02-04
- Commit: dd61336
  Request: The fused OG URL does not load; continue and fix the rendering stall.
  Date: 2026-02-04
- Commit: ee5f024
  Request: Also fix text wrapping in the other fused OG columns for this URL.
  Date: 2026-02-04
- Commit: b390193
  Request: Continue fixing fused OG column wrapping so long card names wrap instead of clipping/truncating.
  Date: 2026-02-04
- Commit: a8007ad
  Request: Third fused OG column is clipped at the right edge and ability icons are missing; fix both.
  Date: 2026-02-04
- Commit: 843ca64
  Request: The fused OG third column still needs to be tightened so ability text does not clip on the right edge.
  Date: 2026-02-04
- Commit: 7a4dd0a
  Request: Reduce fused OG third-column width (not font size) so text stays inside the image bounds.
  Date: 2026-02-04
- Commit: b742f89
  Request: Set fused OG column widths to 1.1 / 1.1 / 1.0 and make third-column text wrapping normal.
  Date: 2026-02-04
- Commit: f18f27b
  Request: Fix third fused OG column wrapping so lines do not leave large empty gaps.
  Date: 2026-02-04
- Commit: ec5e476
  Request: In fused OG third column, stat icons disappeared and text overflowed right edge again; restore icons and constrain overflow.
  Date: 2026-02-04
- Commit: 2ae505c
  Request: For fused OG (`/api/og/deck/Fused_4bu6z8m0h1nq0m?refresh=1`), restore the missing level icon on the level-2 forgeborn ability and keep third-column ability text inside the image bounds.
  Date: 2026-02-04
- Commit: a5da6cc
  Request: `/api/og/deck/Fused_4bu6z8m0h1nq0m?refresh=1` stopped loading; fix OG route so it returns reliably while keeping third-column icons and bounds.
  Date: 2026-02-04
- Commit: ca91027
  Request: Increase OG image font size everywhere by 10%.
  Date: 2026-02-05
- Commit: c2bafa6
  Request: Color card names in OG by faction so all four faction colors remain readable and do not blend into the OG background.
  Date: 2026-02-05
- Commit: 5b018f3
  Request: Color the forgeborn name in OG image with the forgeborn faction color.
  Date: 2026-02-05
- Commit: 132e8f8
  Request: Remove faction icons from all cards in OG image.
  Date: 2026-02-05
- Commit: 03ef7d1
  Request: Increase all OG image font sizes by another 5%.
  Date: 2026-02-05
- Commit: 9d9ced3
  Request: For `Fused_1d4jjh2mkpba06f`, render `[l1]-[l4]` forgeborn ability tokens as level icons in OG text.
  Date: 2026-02-05
- Commit: 53113a7
  Request: For `Fused_4bu6z8m0h1nq0m`, fix OG endpoint not opening and improve forgeborn ability line wrapping that breaks too early.
  Date: 2026-02-05
- Commit: 43deab7
  Request: Improve fused OG forgeborn ability wrapping so lines do not end too early.
  Date: 2026-02-05
- Commit: a96332a
  Request: Fix fused OG third-column forgeborn ability wrapping so line breaks are more natural.
  Date: 2026-02-05
- Commit: 1b9265e
  Request: Implement the plan to remove activeFilters, derive filter order from URL, and use _1 suffixes for repeated filters.
  Date: 2026-02-05
- Commit: 74e50d3
  Request: Make the filter picker searchable so typing filters the available filters.
  Date: 2026-02-05
- Commit: 39dcbba
  Request: Rename the rarity filter to "Rarity (Specific)" and add comparison operators for rarity count.
  Date: 2026-02-05
- Commit: d40428d
  Request: Add a "Rarity (Words)" filter that matches decks by rarity tokens with operator + count.
  Date: 2026-02-05
- Commit: 38147c6
  Request: Remove pluralized rarity labels in deck list tags for fused decks.
  Date: 2026-02-05
- Commit: 6129a0a
  Request: Keep CHANGELOG.md on version 0.0.2 instead of auto-incrementing versions.
  Date: 2026-02-05
- Commit: aae59a3
  Request: Remove pluralization of rarity labels in deck details.
  Date: 2026-02-05
- Commit: 5bd785f
  Request: Pick better names for rarity filters (Exact/Word).
  Date: 2026-02-05
- Commit: 4b0941f
  Request: Add Darkforge Common and Darkforge_LS rarities to decks and filters.
  Date: 2026-02-05
- Commit: 2cc9d62
  Request: Directly opened deck modal should return to the home page when closed.
  Date: 2026-02-05
- Commit: 1db867d
  Request: Explain why the ELO filter adds long query parameters and reduce the number of URL parameters.
  Date: 2026-02-05
- Commit: 0ac35aa
  Request: Add Darkforge_LS rarity icons for all sets and use them in the deck details modal.
  Date: 2026-02-05
- Commit: 846e185
  Request: Rename Darkforge_LS to Darkforge LS everywhere and treat it as two words in rarity word filtering.
  Date: 2026-02-05
- Commit: 4218bc2
  Request: Fix the Darkforge Common exact rarity filter returning zero results.
  Date: 2026-02-05
- Commit: 24b1de5
  Request: Add Min/Max fields to multi-select filters so they require at least N of the selected values (default any-match).
  Date: 2026-02-06
- Commit: da75b41
  Request: Add clear buttons for Min/Max inputs and make filter scrollbars three times wider.
  Date: 2026-02-06
- Commit: 1f2f91e
  Request: Swap the site logo to the Too Many Decks transparent mark and size it appropriately.
  Date: 2026-02-06
- Commit: ec646cb
  Request: Replace the logo file and regenerate the resized header asset.
  Date: 2026-02-06
- Commit: 72e0d82
  Request: Replace the logo file again and regenerate the resized header asset.
  Date: 2026-02-06
- Commit: b06d962
  Request: Move the Too Many Decks logo assets into a dedicated logo folder.
  Date: 2026-02-06
- Commit: 63e4506
  Request: Move solforge-logo.png into the logo folder.
  Date: 2026-02-06
- Commit: 9a7aab3
  Request: Add a 1Y column to the crypto tracker with year-over-year percent change.
  Date: 2026-02-06
- Commit: 5d28956
  Request: Reduce empty spacing in the site header.
  Date: 2026-02-06
- Commit: ef09182
  Request: "In fused OG images, remove faction/set/score/ELO details for the half decks, remove the Creatures/Spells labels, and increase the card list font size by 5%."
  Date: 2026-02-06
- Commit: 07e6005
  Request: Increase the card list font size by another 5%.
  Date: 2026-02-06
- Commit: 802a17d
  Request: Increase the rarity icons by 30%.
  Date: 2026-02-06
- Commit: 16b67c9
  Request: Set the font scale for all columns in fused OG images to 1.1.
  Date: 2026-02-06
- Commit: ab111f7
  Request: Revert the last change.
  Date: 2026-02-06
- Commit: 8d1d24a
  Request: Increase the forgeborn ability font size to match the card list font size.
  Date: 2026-02-06
- Commit: 16326ae
  Request: Ensure all file content is in English; translate the recent Russian AI request log entries.
  Date: 2026-02-06
- Commit: ec27c42
  Request: Auto-fit font sizes for each fused OG column so text fills the column without overflowing.
  Date: 2026-02-06
- Commit: 7d62a81
  Request: Fix fused OG auto-fit so the third column text does not overflow.
  Date: 2026-02-06
- Commit: f53b8c9
  Request: Remove the forgeborn name from the third column.
  Date: 2026-02-06
- Commit: e76c2ab
  Request: Increase the maximum fused OG auto-fit scale to 1.3.
  Date: 2026-02-06
- Commit: 71fd106
  Request: Remove spaces before periods at the end of forgeborn ability sentences.
  Date: 2026-02-06
- Commit: df2a1b5
  Request: Reduce fused OG empty bottom space by relaxing auto-fit spacing.
  Date: 2026-02-06
- Commit: c5b6dc0
  Request: Raise fused OG auto-fit max scale to 1.35, use full height, and reduce vertical padding.
  Date: 2026-02-06
- Commit: 1374f67
  Request: Reduce fused OG bottom whitespace by allowing larger auto-fit scaling and tighter padding.
  Date: 2026-02-06
- Commit: 883ad5f
  Request: Inline forgeborn level icons with the ability text in the third column.
  Date: 2026-02-06
- Commit: 0c491f4
  Request: Ensure forgeborn level icons do not create a separate column with no text beneath them.
  Date: 2026-02-06
- Commit: 2228f33
  Request: Fix fused OG third-column abilities so text continues under Roman level icons (II-IV) instead of leaving an empty icon gutter.
  Date: 2026-02-06
- Commit: bf029a4
  Request: Fix OG renderer error requiring explicit `display: flex` on multi-child ability row containers.
  Date: 2026-02-06
- Commit: ce39265
  Request: Prevent wrapped lines in the fused OG third column from starting with punctuation such as a period or closing quote.
  Date: 2026-02-06
- Commit: c8aac5a
  Request: Fix fused OG third-column wrapping so lines do not break too early and follow natural inline flow.
  Date: 2026-02-06
- Commit: f28aa68
  Request: Fix OG render crash caused by unsupported `display: inline-block` in ability text styles.
  Date: 2026-02-06
- Commit: c783980
  Request: Fix fused OG third-column wrapping that became too aggressive and normalize punctuation spacing.
  Date: 2026-02-06
- Commit: ccf87ee
  Request: Continue fixing fused OG third-column layout and verify rendered output until stable.
  Date: 2026-02-06
- Commit: d7e72af
  Request: Continue iterating and visually verifying the fused OG third column until wrapping and punctuation look correct.
  Date: 2026-02-06
- Commit: 2613807
  Request: Update fused deck link preview text metadata (not OG image): prepend half-deck metadata (name, faction, set, score, ELO) to Open Graph and Twitter descriptions.
  Date: 2026-02-06
- Commit: 9f5e237
  Request: For fused deck link previews, set title to `Deck Name (Forgeborn, Owner if available)`, remove card list from description, remove `Half 1/Half 2` labels, and try a newline between first and second half descriptions.
  Date: 2026-02-06
- Commit: a2c1894
  Request: Refine fused link preview formatting: in title use `owner: <nick>`, and in half descriptions remove half deck names, parentheses, and the `Faction` label.
  Date: 2026-02-06
- Commit: cfd1675
  Request: If available, append each half deck's expire date at the end of its description; then add a new description line with creatures/spells/solbind counts, deck rarity counts, and creature type counts.
  Date: 2026-02-06
- Commit: 9f171b7
  Request: Increase all icons in the OG image third column by 1.5x.
  Date: 2026-02-06
- Commit: a4874f3
  Request: In fused preview descriptions, move `Rarities` and `Creature Types` to new lines.
  Date: 2026-02-06
- Commit: 66304b8
  Request: Improve OG image text sharpness/readability in social previews.
  Date: 2026-02-06
- Commit: 28cb681
  Request: Cache deck page link-preview metadata (title/description/image alt) in memory with in-flight request deduplication, not just the OG image.
  Date: 2026-02-06
- Commit: ff2bbf6
  Request: Improve OG image text sharpness in compressed Discord previews.
  Date: 2026-02-06
- Commit: 8b7182e
  Request: Reduce forgeborn ability level icon size in the OG image third column by 5%.
  Date: 2026-02-06
- Commit: 7185ec3
  Request: Revert the latest OG icon-size tweak and find/fix why descenders like "g" are slightly clipped in the fused OG third column.
  Date: 2026-02-06
- Commit: 6608b07
  Request: The card modals show a window scrollbar even when it is not needed (example: http://hadoop21.click:3000/deck/Fused_u9912mkvb9mqm).
  Date: 2026-02-06
- Commit: 23a6b14
  Request: For fused decks, show the earliest expiry date from the two halves at the top if available (example: http://hadoop21.click:3000/deck/Fused_93hi52mfig65sm).
  Date: 2026-02-06
- Commit: 5d01410
  Request: Fix fused deck card lists so Solbind cards from both halves appear (example: http://hadoop21.click:3000/deck/Fused_u9912mkvb9mqm).
  Date: 2026-02-06
- Commit: 77fb157
  Request: The fused deck modal still hides the second Solbind card; check and fix list scrolling (example: http://hadoop21.click:3000/deck/Fused_u9912mkvb9mqm).
  Date: 2026-02-06
- Commit: b798195
  Request: Ensure the metadata description shows the correct Solbind count for fused decks (example: http://hadoop21.click:3000/deck/Fused_u9912mkvb9mqm).
  Date: 2026-02-06
- Commit: 7e61c3e
  Request: For http://hadoop21.click:3000/deck/Fused_u9912mkvb9mqm, verify and fix metadata description Solbind count from nested card Solbind links.
  Date: 2026-02-06
- Commit: ae8fd32
  Request: Verify whether Solbind should be 2 for the same fused deck and align metadata counting logic with the modal behavior.
  Date: 2026-02-06
- Commit: 9121606
  Request: For http://hadoop21.click:3000/deck/Fused_93hi52mfig65sm, include half-deck expiry dates in metadata description when available.
  Date: 2026-02-06
- Commit: fa7bc89
  Request: Change the half-deck metadata label from `Expires` to `Expire date`.
  Date: 2026-02-06
- Commit: 8bac17c
  Request: Improve fused OG auto-fit fill for underfilled columns and render attack/health/armor icons for standalone uppercase A/H/D tokens inside ability text.
  Date: 2026-02-06
- Commit: ac3817e
  Request: Continue improving fused OG auto-fit so at least one column fills near the bottom edge for http://hadoop21.click:3000/api/og/deck/Fused_93hi52mfig65sm?refresh=1.
  Date: 2026-02-06
- Commit: c21f182
  Request: http://hadoop21.click:3000/deck/epjfotg0jhjnhzrjdfjnqpm3r06rea?ss=224&sdfgbg=42&dsfs=wrew shows an old Discord preview image even with extra URL params; check whether stale OG cache in Upstash is the cause and fix cache invalidation.
  Date: 2026-02-07
- Commit: f5eaa89
  Request: For regular decks, OG description should include owner like fused decks; use Upstash-cached opened deck data to persist/reuse owner info for OG metadata.
  Date: 2026-02-07
- Commit: 14569c4
  Request: Owner still did not appear in regular-deck OG description after verification; fix reliability so owner is consistently available.
  Date: 2026-02-07
- Commit: 51a51da
  Request: Next.js dev overlay shows SSE error and HTTP 502 from deck stream in `store/deckStore.ts`; reduce noisy console errors and handle stream failures more gracefully.
  Date: 2026-02-07
- Commit: 1355d43
  Request: Owner still does not appear in regular deck OG description after opening the deck modal first; make owner propagation reliable from real player search flow.
  Date: 2026-02-07
- Commit: 8cda8d5
  Request: For http://hadoop21.click:3000/api/og/deck/Fused_1qrav2mfzdk9b9?refresh=1 the third column text is clipped; allow per-column font sizing so text fully fits within each column.
  Date: 2026-02-07
- Commit: 0df629f
  Request: http://hadoop21.click:3000/api/og/deck/Fused_1qrav2mfzdk9b9?refresh=1 still clips the third column; make auto-fit reliably fit full text per column.
  Date: 2026-02-07
- Commit: d389ad7
  Request: Apply per-column font auto-fit for regular decks (fill columns without overflow/bottom clipping) and investigate OG cache not refreshing on deck URLs with extra query params.
  Date: 2026-02-07
- Commit: 3e2781a
  Request: Review 10 regular and 10 fused OG images for cutiehammer and ensure all cards/abilities are fully visible without bottom clipping; fix any remaining clipping cases.
  Date: 2026-02-07
- Commit: 6ab82cd
  Request: Opening a deck by direct link is slow; can this be improved?
  Date: 2026-02-08
- Commit: 6ac9e35
  Request: Can we speed up OG image generation for all decks?
  Date: 2026-02-08
- Commit: 651b3eb
  Request: 3 seconds seems too long. Can we speed it up, and what takes the most time?
  Date: 2026-02-08
- Commit: 1f6e578
  Request: 3 seconds seems too long. Can we speed it up, and what takes the most time?
  Date: 2026-02-08
- Commit: d06ab12
  Request: Let's do it.
  Date: 2026-02-08
- Commit: b86a87d
  Request: Add the site changelog entry in the header including all changes since the last merge, and label it version 0.0.2a.
  Date: 2026-02-09
- Commit: b14e0da
  Request: Merge everything from dev into master.
  Date: 2026-02-09
