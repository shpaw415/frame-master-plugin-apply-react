# Release Notes - v0.1.4

## 🐛 Bug Fixes

### Cloudflare Pages Compatibility

- **Hydration Import Fix** - Changed from direct hydration file import to a mock path, resolving an issue where Cloudflare Pages would fail to import the hydrate file correctly

### Router Improvements

- **Ctrl+Click Behavior** - When holding `Ctrl` while clicking anchor links, the routing system now correctly falls back to the browser's default behavior (opening links in a new tab)
- **Fail-Safe Navigation** - Added fail-safe mechanisms to the router to prevent navigation errors from breaking the application

## 📈 Improvements

### Error Handling

- Enhanced error handling throughout the plugin for more robust and predictable behavior

### Plugin Naming

- Renamed the plugin to a more accurate and descriptive name

## 📝 Summary

Version 0.1.4 focuses on stability and compatibility improvements. The key highlight is the fix for Cloudflare Pages deployments where hydration imports were failing. Additionally, the router now properly respects standard browser navigation patterns when modifier keys are held, and includes fail-safe mechanisms to ensure reliable navigation even in edge cases.
