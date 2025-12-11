import type React from "react";

export default function Shell({ children }: { children: React.ReactElement }) {
  return (
    <html>
      <head>
        <title>Frame Master App</title>
      </head>
      <body id="root">{children}</body>
    </html>
  );
}
