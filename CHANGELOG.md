# Changelog

## 4.0.0

### Breaking

- Requires Frame-Master 4.x (`peerDependencies.frame-master` is now `^4.0.0-0`).
- Generated `@apply-react/*` bootstraps are declared on plugin-owned `virtualModules` instead of `buildConfig.files` and a custom runtime `onResolve`/`onLoad` loop.

### Added

- `requirement.frameMasterVersion` is derived from the package `frame-master` peer.
- `serverStop` closes HMR sockets and drops the live builder on reload, dispose, and process shutdown.
- `frame-master/testing` regression coverage for the v4 virtual-module registry.

## Unreleased

### Added

- Robust dependency-aware HMR invalidation: route rebuilds now trigger when shared project modules or reachable `node_modules` dependencies change, not only when route files change.
- Deduplicated dev-route build queue with deterministic processing order under burst edits.
- HMR client safeguards for malformed websocket payloads and callback failures.
- Graceful full-page reload fallback when a hot-updated route module fails to import.
- New plugin option `watchDirectories` to control which directories are watched for HMR changes.
- New plugin option `watchDirectoriesExclude` to exclude directories from HMR watching and override included watch directories.
- Development-only React Fast Refresh for route rebuilds, with stable identity for top-level exported React contexts across rebuilt module graphs.
- New `enableFastRefresh` option to opt out of React state/context preservation while retaining ordinary HMR route updates.
- New `HMROptions.websocket` (`"ws" | "wss" | "auto"`, default `"auto"`) so the client HMR socket uses `wss` on HTTPS pages (Cloudflare tunnels) and avoids mixed-content blocks.
- Recoverable RouterHost error fallback with development error details, custom `errorFallback`, and `onError` reporting APIs.

### Changed

- HMR watcher scope now covers project-level changes and dependency updates needed for route hot reload correctness.
- Compatible component and provider updates now retain React state; incompatible refresh boundaries remount according to React Fast Refresh safety rules.
- `@apply-react` placeholder modules now provide test-mode route/fallback defaults so both `bun test` and the tsconfig-override test command run consistently.

### Tests

- Added HMR robustness tests for malformed payload handling and callback error isolation.
- Added import-specifier extraction tests used by dependency tracking.
- Expanded HMR coverage for websocket reuse/reconnect, unknown-message handling, and non-404 build request failures.
- Added refresh runtime, source-transform, and active-route layout-state preservation regression tests.
