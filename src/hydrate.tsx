/// <reference path="./ambient.d.ts" />

import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import Shell from "client:shell";
import { getRelatedLayoutFromPathname } from "./layout";
import _ROUTES_ from "routes/client:routes";
import { formatPathname } from "./utils";

document.addEventListener("DOMContentLoaded", async () => {
  const rootElement = document.getElementById("root");
  if (rootElement) {
    const pathname = formatPathname(window.location.pathname);

    const PageToRender = _ROUTES_[pathname];
    if (!PageToRender) {
      console.error("No page found for pathname:", window.location.pathname);
      console.error("Available routes:", _ROUTES_);
      throw new Error("pathname does not exists");
    }
    const WrappedPage = getRelatedLayoutFromPathname(pathname, _ROUTES_)
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
