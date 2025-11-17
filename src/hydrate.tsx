/// <reference path="./ambient.d.ts" />

import { StrictMode, type JSX } from "react";
import { hydrateRoot } from "react-dom/client";
import Shell from "client:shell";
import { getRelatedLayoutFromPathname } from "./layout";

document.addEventListener("DOMContentLoaded", async () => {
  const rootElement = document.getElementById("root");
  if (rootElement) {
    const _ROUTES_ = (await import("/routes/client:routes" as string))
      .default as Record<string, () => JSX.Element>;
    const PageToRender = _ROUTES_[window.location.pathname];
    if (!PageToRender) throw new Error("pathname does not exists");
    const WrappedPage = getRelatedLayoutFromPathname(window.location.pathname)
      .reverse()
      .reduce((Prev, Curr) => <Curr>{Prev}</Curr>, <PageToRender />);

    hydrateRoot(
      rootElement,
      <StrictMode>
        <Shell>{WrappedPage}</Shell>
      </StrictMode>
    );
  }
});
