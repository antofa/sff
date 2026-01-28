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
