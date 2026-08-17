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

Requires **Frame-Master 4.x** (`frame-master@^4.0.0-0`).

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

| Option                    | Type        | Default                 | Description                                                              |
| ------------------------- | ----------- | ----------------------- | ------------------------------------------------------------------------ |
| `style`                   | `"nextjs"`  | -                       | Routing convention style (currently supports Next.js style)              |
| `route`                   | `string`    | -                       | Base path to your routes directory                                       |
| `clientShellPath`         | `string?`   | -                       | Optional path to a custom client-side shell component                    |
| `enableHMR`               | `boolean`   | `true`                  | Enable Hot Module Replacement for development                            |
| `enableFastRefresh`       | `boolean?`  | `enableHMR`             | Preserve compatible React state and shared context identity during HMR   |
| `HMROptions.websocket`    | `"ws" \| "wss" \| "auto"?` | `"auto"`       | Client HMR socket scheme; `auto` uses `wss` on HTTPS pages (tunnels)     |
| `watchDirectories`        | `string[]?` | `['.', 'node_modules']` | Directories watched for HMR file changes (project-root relative)         |
| `watchDirectoriesExclude` | `string[]?` | -                       | Directories excluded from HMR watching; applied after `watchDirectories` |
| `hydration`               | `"hydrate"` | `"hydrate"`             | Hydration method to use on the client                                    |

## How It Works

### Static Generation + Client Hydration

1. **Build Time**: `react-to-html` plugin generates static HTML files from your React components
2. **Client Load**: Static HTML is served instantly from CDN for fast initial load
3. **Hydration**: `apply-react` plugin attaches React event listeners to the static markup
4. **Navigation**: Client-side routing takes over for seamless SPA-like navigation

### Development Workflow

During development, the HMR system:

- Watches for file changes in your pages directory
- Automatically updates the client without full page reload
- Uses React Fast Refresh to retain component and provider state when React marks the update boundary compatible
- Preserves the identity of top-level exported contexts created with `createContext`, including aliased and namespace React imports, so layouts and pages continue to share the same provider after a route rebuild
- Provides instant feedback via WebSocket connection

Fast Refresh instrumentation is development-only. Context identity is stabilized for top-level exported contexts such as `export const ThemeContext = createContext(...)`; function-local or dynamically-created contexts retain normal React behavior. When a hook signature or refresh boundary is incompatible, React remounts the affected boundary rather than retaining stale state.

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
  return <RouterHost errorResolvers={myResolvers}>{children}</RouterHost>;
}
```

If no resolver matches, `RouterHost` renders a recoverable built-in fallback. In development it includes the message, component stack, current pathname, and retry/reload/copy actions. Production uses a generic fallback without error details. The boundary resets on navigation and after a successful Fast Refresh update.

### Custom Fallbacks And Reporting

Use `errorFallback` to replace the built-in fallback, and `onError` to send error details to your logging service. Typed `errorResolvers` always take precedence over `errorFallback`.

```tsx
import {
  RouterHost,
  type RouterErrorFallbackProps,
} from "frame-master-plugin-apply-react/router";

function AppError({ error, reset }: RouterErrorFallbackProps) {
  return (
    <main>
      <h1>We could not load this page</h1>
      <p>{error.message}</p>
      <button type="button" onClick={reset}>Try again</button>
    </main>
  );
}

export default function ClientShell({ children }: { children: JSX.Element }) {
  return (
    <RouterHost
      errorFallback={AppError}
      onError={(error, { pathname, componentStack }) => {
        reportRouteError({ error, pathname, componentStack });
      }}
    >
      {children}
    </RouterHost>
  );
}
```

### `ErrorFallbackResolver` type

```ts
type ErrorFallbackResolver = (
  error: Error,
  pathname: string,
) => Promise<(() => JSX.Element) | null>;
```

```ts
type RouterErrorFallbackProps = {
  error: Error;
  componentStack: string | null;
  pathname: string;
  reset: () => void;
};
```

## Server-Only Modules

The plugin automatically protects server-only code from being bundled in the client build. Original exports are replaced with stubs that throw `Cannot use <export> on a client build (server-only)` if the module is imported client-side.

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
