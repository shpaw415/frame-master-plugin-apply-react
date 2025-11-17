/// <reference path="./ambient.d.ts" />

import { StrictMode, type JSX } from "react";
import { hydrateRoot } from "react-dom/client";
import Shell from "client:shell";
import { getRelatedLayoutFromPathname } from "./layout";
import _ROUTES_ from "routes/client:routes";

document.addEventListener("DOMContentLoaded", async () => {
  const rootElement = document.getElementById("root");
  if (rootElement) {
    const PageToRender = _ROUTES_[formatPathname(window.location.pathname)];
    if (!PageToRender) {
      console.error("No page found for pathname:", window.location.pathname);
      console.error("Available routes:", _ROUTES_);
      throw new Error("pathname does not exists");
    }
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

function formatPathname(pathname: string) {
  if (pathname === "/") return pathname;
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}
