# AI Requests Log

This file tracks requests made to the coding agent and the commit that resulted from each request.

## Format
- Commit: <sha>
  Request: <user prompt>
  Date: YYYY-MM-DD

## Entries
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
