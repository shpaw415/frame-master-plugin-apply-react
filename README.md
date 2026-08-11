# Apply React Plugin

A Frame-Master plugin that adds React client-side hydration and interactivity to static HTML files, enabling dynamic single-page applications with SSG (Static Site Generation) and CDN deployment.

## Features

- ⚡ **Client-Side Hydration** - Transforms static HTML into interactive React applications
- 🔄 **Client-Side Navigation** - Seamless SPA routing without full page reloads
- 🔥 **Hot Module Replacement** - Live reload during development for instant feedback
- 📦 **SSG + React** - Combines static site generation with dynamic React functionality
- 🌐 **CDN Ready** - Optimized builds suitable for CDN distribution
- 🎯 **File-Based Routing** - Automatic route generation from file structure
- 🛡️ **Server-Only Protection** - Prevents server-side code from bundling client-side

## Installation

```bash
bun add frame-master-plugin-apply-react
```

## Quick Start

### 1. Configure the Plugin

Use this plugin together with `frame-master-plugin-react-to-html` for full SSG + React functionality.

```typescript
// frame-master.config.ts
import type { FrameMasterConfig } from "frame-master/server/types";
import ReactToHtml from "frame-master-plugin-react-to-html";
import ApplyReact from "frame-master-plugin-apply-react/plugin";

const config: FrameMasterConfig = {
  HTTPServer: { port: 3000 },
  plugins: [
    ReactToHtml({
      outDir: ".frame-master/build",
      srcDir: "src/pages",
      shellPath: "src/shell.tsx",
    }),
    ApplyReact({
      style: "nextjs",
      route: "src/pages",
      enableHMR: true,
      hydration: "hydrate",
    }),
  ],
};

export default config;
```

### 2. Create a Client Shell (Optional)

```tsx
// src/client-shell.tsx
import { RouterHost } from "frame-master-plugin-apply-react/router";

export default function ClientShell({ children }: { children: JSX.Element }) {
  return <RouterHost>{children}</RouterHost>;
}
```

### 2b. Server shell import map (recommended with per-file HMR)

Bare `react` / `react/jsx-dev-runtime` imports need an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap)
**before** any `type="module"` script. The plugin injects one via `build.finally("html")`
and runtime HTML rewrite; you can also place it explicitly in your SSR shell:

```tsx
// src/shell.tsx (react-to-html document shell)
import { ApplyReactImportMap } from "frame-master-plugin-apply-react/import-map";

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <ApplyReactImportMap />
        <meta charSet="utf-8" />
        <title>App</title>
      </head>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
```

### 3. Build Interactive Pages

```tsx
// src/pages/index.tsx
import { useState } from "react";

export default function HomePage() {
  const [count, setCount] = useState(0);

  return (
    <section>
      <h1>Welcome to My Interactive Site</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
      <a href="/about">Learn More</a>
    </section>
  );
}
```

### 4. Add Layouts

```tsx
// src/pages/layout.tsx
export default function MainLayout({ children }: { children: JSX.Element }) {
  return (
    <>
      <header>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
        </nav>
      </header>
      <main>{children}</main>
      <footer>
        <p>&copy; 2024 My Company</p>
      </footer>
    </>
  );
}
```

## Configuration Options

| Option            | Type        | Default     | Description                                                 |
| ----------------- | ----------- | ----------- | ----------------------------------------------------------- |
| `style`           | `"nextjs"`  | -           | Routing convention style (currently supports Next.js style) |
| `route`           | `string`    | -           | Base path to your routes directory                          |
| `clientShellPath` | `string?`   | -           | Optional path to a custom client-side shell component       |
| `enableHMR`               | `boolean`   | `true` in dev | Enable Hot Module Replacement for development                          |
| `moduleRoot`              | `string \| string[]?` | inferred | App source root(s) for per-file modules (e.g. `"src"` or `["src","packages/ui"]`) |
| `hydration`               | `"hydrate" \| "render"` | `"hydrate"` | `hydrate` attaches to SSG HTML; `render` uses `createRoot` |
| `watchDirectories`        | `string[]?` | `[moduleRoot]` in per-file HMR | Directories watched for HMR file changes |
| `watchDirectoriesExclude` | `string[]?` | -           | Directories excluded from HMR watching                                 |
| `hmr`                     | `object?`   | -           | See HMR options below |
| `debug`                   | `boolean?`  | `false`     | Verbose Apply-React logs (`DEBUG_APPLY_REACT=1`)                        |

### HMR / per-file module graph

When HMR is on (dev), `hmr.moduleGraph` defaults to **`per-file`**:

- Every source file under `moduleRoot` is a **real Bun build entrypoint** (default `hmr.entrypointMode: "all"`; use `"reachable"` to limit to the route/shell graph).
- Outputs are path-stable: `.frame-master/build/@apply-react/mod/<rel>.js` (served at `/@apply-react/mod/...`).
- Other Frame-Master plugins’ `onLoad` transforms run on those real source paths.
- Cross-module imports are rewritten to stable public `/@apply-react/mod/*.js` URLs (no shared hashed app chunks).
- On file change: **rebuild →** WebSocket `invalidate-module` → client cache-bust with `?t=` (no live transpile).
- Missing artifacts return **404** and kick a rebuild (never on-the-fly transpile).

| `hmr` field | Default | Description |
| --- | --- | --- |
| `moduleGraph` | `per-file` (dev) | `per-file` multi-entrypoint graph, or `bundled` legacy route bundles |
| `entrypointMode` | `all` | `all` files under `moduleRoot`, or `reachable` from routes + shell |
| `entrypointExclude` | `[]` | Regex (or string patterns) — matching modules are not entrypoints |
| `preserveState` | `true` | Prefer soft page swaps without remounting ErrorWrapper |
| `debounceMs` | `75` | FS change debounce before rebuild |
| `overlay` | `true` | Client error overlay |

```ts
ApplyReact({
  style: "nextjs",
  route: "src/pages",
  moduleRoot: ["src", "packages/ui"],
  hmr: {
    entrypointExclude: [/\.test\.[tj]sx?$/, /\/stories\//],
  },
});
```

### Dev HMR: per-file modules (default)

When HMR is on, modules under `moduleRoot` are served at stable URLs:

`/@apply-react/mod/<path-relative-to-moduleRoot>`

Editing a **page** re-imports only that file (`?t=`). Shared modules (e.g. `createContext` files) keep the same URL so React context identity is preserved. Put durable providers in `client-shell.tsx` **above** `RouterHost`.

## How It Works

### Static Generation + Client Hydration

1. **Build Time**: `react-to-html` plugin generates static HTML files from your React components
2. **Client Load**: Static HTML is served instantly from CDN for fast initial load
3. **Hydration**: `apply-react` plugin attaches React event listeners to the static markup
4. **Navigation**: Client-side routing takes over for seamless SPA-like navigation

### Development Workflow

During development, the HMR system:

- Watches project files (configurable via `watchDirectories`) with debounced rebuilds
- Uses `ws` / `wss` automatically, reconnects with backoff, and heartbeats the socket
- Selectively rebuilds routes needed by connected clients
- Applies updates with a failsafe ladder: soft swap → route remount → full reload
- Surfaces build failures in a dev overlay and status chip
- Classifies `layout` / `loading` / `404` edits correctly (no bogus page routes)

## Client-Side Router

The plugin provides a `RouterHost` component that handles:

- **Link Interception**: Automatically intercepts `<a>` tag clicks for client-side navigation
- **History Management**: Integrates with browser history API (back/forward buttons)
- **Layout Wrapping**: Automatically wraps pages with their corresponding layouts
- **HMR Integration**: Updates routes dynamically during development
- **Error Fallback**: Catches errors thrown inside page components and maps them to fallback pages

```tsx
import { RouterHost } from "frame-master-plugin-apply-react/router";

export default function ClientShell({ children }: { children: JSX.Element }) {
  return <RouterHost>{children}</RouterHost>;
}
```

## Fallback Pages & Error Handling

`RouterHost` wraps every rendered page inside an `ErrorWrapper` — a React error boundary. When a page component throws, the error is passed through a **resolver chain** that maps it to a fallback page component.

### Built-in: `NotFoundError`

Throw `ThrowNotFound()` (or `new NotFoundError()`) anywhere inside a page to trigger the nearest co-located `404.tsx` file, exactly like a route miss.

```tsx
// src/pages/users/[userId].tsx
import { ThrowNotFound } from "frame-master-plugin-apply-react/utils";

export default function UserProfile() {
  const user = useUser();

  if (!user) ThrowNotFound(); // renders src/pages/users/404.tsx

  return <div>{user.name}</div>;
}
```

```tsx
// src/pages/users/404.tsx
export default function UserNotFound() {
  return <h1>User not found</h1>;
}
```

### Custom Error Resolvers

Pass an `errorResolvers` array to `RouterHost` to handle your own error types. Each resolver is an async function `(error, pathname) => (() => JSX.Element) | null`. Return a component to handle the error, or `null` to fall through to the next resolver.

```tsx
import {
  RouterHost,
  defaultErrorResolvers,
  type ErrorFallbackResolver,
} from "frame-master-plugin-apply-react/router";

class UnauthorizedError extends Error {}

const myResolvers: ErrorFallbackResolver[] = [
  async (error, pathname) => {
    if (error instanceof UnauthorizedError) {
      return () => <LoginPage />;
    }
    return null; // fall through
  },
  ...defaultErrorResolvers, // keep built-in NotFoundError handling
];

export default function ClientShell({ children }: { children: JSX.Element }) {
  return (
    <RouterHost errorResolvers={myResolvers}>{children}</RouterHost>
  );
}
```

If no resolver matches the thrown error, the boundary renders `null` (blank page). The `ErrorWrapper` is automatically reset on every navigation so stale error state never leaks between pages.

### `ErrorFallbackResolver` type

```ts
type ErrorFallbackResolver = (
  error: Error,
  pathname: string,
) => Promise<(() => JSX.Element) | null>;
```

## Server-Only Modules

The plugin automatically protects server-only code from being bundled in the client build. Any module that should only run on the server will throw an error if accidentally imported client-side.

## Best Practices

### 1. Use React Hooks

Unlike the static `react-to-html` plugin, `apply-react` fully supports React hooks and state management:

```tsx
import { useState, useEffect } from "react";

export default function InteractivePage() {
  const [data, setData] = useState([]);

  useEffect(() => {
    fetch("/api/data")
      .then((res) => res.json())
      .then(setData);
  }, []);

  return <div>{/* Interactive content */}</div>;
}
```

### 2. Optimize for CDN

- Keep your build output small by code-splitting
- Use dynamic imports for large components
- Leverage the static HTML for SEO and initial load performance

### 3. Development vs Production

- **Development**: Enable HMR for fast iteration
- **Production**: Disable HMR and optimize for bundle size

## Deployment

The generated build can be deployed to any CDN:

1. Run your build process
2. Upload the `.frame-master/build` directory to your CDN
3. Configure your CDN to serve `index.html` for SPA routing

## Comparison with react-to-html

| Feature                | react-to-html | apply-react  |
| ---------------------- | ------------- | ------------ |
| Static HTML Generation | ✅            | ❌           |
| React Hooks            | ❌            | ✅           |
| Client-Side State      | ❌            | ✅           |
| Client-Side Navigation | ❌            | ✅           |
| Event Handlers         | ❌            | ✅           |
| HMR                    | ❌            | ✅           |
| CDN Ready              | ✅            | ✅           |
| SEO Friendly           | ✅            | ✅ (via SSG) |

**Recommendation**: Use both plugins together for the best of both worlds - fast initial load with static HTML and full React interactivity after hydration.

## License

MIT
