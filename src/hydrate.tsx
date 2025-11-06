/// <reference path="./ambient.d.ts" />

import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import Shell from "client:shell";
import _ROUTES_ from "client:routes";
import { getRelatedLayoutFromPathname } from "./layout";

globalThis._ROUTES_ = _ROUTES_;

document.addEventListener("DOMContentLoaded", () => {
  const rootElement = document.getElementById("root");
  if (rootElement) {
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
