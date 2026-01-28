# Changelog

All notable changes to this project will be documented in this file.
Dates use UTC and roll over at 00:00 UTC.

## [Unreleased] - 2026-01-28

### Added
- `AGENTS.md` with project notes and contribution rules.
- `CHANGELOG.md` to track notable changes.
- `AI_REQUESTS.md` to record agent requests and resulting commits.
- Added `*_DarkforgeCommon.png` rarity icons (B1, S1–S4) under `public/images/icons/rarity/`.

### Changed
- Updated contribution rules in `AGENTS.md` (build/commit flow and logging).
- Switched `AI_REQUESTS.md` request entries to English and added an English-only rule in `AGENTS.md`.
- Added a UTC date requirement for `CHANGELOG.md` entries.
- Require committing every change without prompting.
- Prefer forgeborn image URLs with spaces, falling back to dash variants (resized path).
- Skip forgeborn rotation when using `/resized/` images.
- Added a safe fallback auth provider when Discord credentials are missing.
- Disabled session polling when auth is not configured and added a dev secret fallback.
- Increased the display scale for unrotated forgeborn images.
- Apply forgeborn scaling even without rotation and increase the scale further.

### Fixed
