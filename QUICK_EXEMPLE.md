```tsx
// src/pages/index.tsx
import { useState } from "react";

export default function HomePage() {
  const [count, setCount] = useState(0);

  return (
    <section>
      <h1>Home</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
      <a href="/about">About</a>
    </section>
  );
}
```

```tsx
// src/client-shell.tsx
import { RouterHost } from "frame-master-plugin-apply-react/router";

export default function ClientShell({ children }: { children: JSX.Element }) {
  return <RouterHost>{children}</RouterHost>;
}
```
