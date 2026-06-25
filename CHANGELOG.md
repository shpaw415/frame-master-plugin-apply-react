# Changelog

## Unreleased

### Added

- Robust dependency-aware HMR invalidation: route rebuilds now trigger when shared project modules or reachable `node_modules` dependencies change, not only when route files change.
- Deduplicated dev-route build queue with deterministic processing order under burst edits.
- HMR client safeguards for malformed websocket payloads and callback failures.
- Graceful full-page reload fallback when a hot-updated route module fails to import.

### Changed

- HMR watcher scope now covers project-level changes and dependency updates needed for route hot reload correctness.
- `@apply-react` placeholder modules now provide test-mode route/fallback defaults so both `bun test` and the tsconfig-override test command run consistently.

### Tests

- Added HMR robustness tests for malformed payload handling and callback error isolation.
- Added import-specifier extraction tests used by dependency tracking.
- Expanded HMR coverage for websocket reuse/reconnect, unknown-message handling, and non-404 build request failures.
