# Changelog

## Unreleased

### Added

- Robust dependency-aware HMR invalidation: route rebuilds now trigger when shared project modules or reachable `node_modules` dependencies change, not only when route files change.
- Deduplicated dev-route build queue with deterministic processing order under burst edits.
- HMR client safeguards for malformed websocket payloads and callback failures.
- Graceful full-page reload fallback when a hot-updated route module fails to import.
- New plugin option `watchDirectories` to control which directories are watched for HMR changes.
- New plugin option `watchDirectoriesExclude` to exclude directories from HMR watching and override included watch directories.
- Development-only React Fast Refresh for route rebuilds, with stable identity for top-level exported React contexts across rebuilt module graphs.

### Changed

- HMR watcher scope now covers project-level changes and dependency updates needed for route hot reload correctness.
- Compatible component and provider updates now retain React state; incompatible refresh boundaries remount according to React Fast Refresh safety rules.
- `@apply-react` placeholder modules now provide test-mode route/fallback defaults so both `bun test` and the tsconfig-override test command run consistently.

### Tests

- Added HMR robustness tests for malformed payload handling and callback error isolation.
- Added import-specifier extraction tests used by dependency tracking.
- Expanded HMR coverage for websocket reuse/reconnect, unknown-message handling, and non-404 build request failures.
- Added refresh runtime, source-transform, and active-route layout-state preservation regression tests.
