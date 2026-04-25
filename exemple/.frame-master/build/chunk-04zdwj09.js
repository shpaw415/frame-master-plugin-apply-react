import {
  require_jsx_dev_runtime
} from "./chunk-8sbccefb.js";
import {
  __toESM
} from "./chunk-3m06d5g0.js";

// src/pages/layout.tsx
var jsx_dev_runtime = __toESM(require_jsx_dev_runtime(), 1);
function MainLayout({
  children
}) {
  return /* @__PURE__ */ jsx_dev_runtime.jsxDEV("div", {
    children: [
      /* @__PURE__ */ jsx_dev_runtime.jsxDEV("h1", {
        children: "Main Layout"
      }, undefined, false, undefined, this),
      children,
      /* @__PURE__ */ jsx_dev_runtime.jsxDEV("h1", {
        children: "Main Layout"
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/pages/sub/index.tsx
var jsx_dev_runtime2 = __toESM(require_jsx_dev_runtime(), 1);
function SubPage() {
  return /* @__PURE__ */ jsx_dev_runtime2.jsxDEV("div", {
    children: /* @__PURE__ */ jsx_dev_runtime2.jsxDEV("h1", {
      children: "Sub Page"
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
}

// src/pages/index.tsx
var jsx_dev_runtime3 = __toESM(require_jsx_dev_runtime(), 1);
function MainPage() {
  return /* @__PURE__ */ jsx_dev_runtime3.jsxDEV("div", {
    children: /* @__PURE__ */ jsx_dev_runtime3.jsxDEV("h1", {
      children: "Main Page 1"
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
}

// src/pages/sub/[id].tsx
var jsx_dev_runtime4 = __toESM(require_jsx_dev_runtime(), 1);
function DynamicPageRoute() {
  return /* @__PURE__ */ jsx_dev_runtime4.jsxDEV("div", {
    children: "This is a dynamic page route."
  }, undefined, false, undefined, this);
}

// @apply-react/client-routes.ts
var client_routes_default = {
  "/layout": MainLayout,
  "/sub": SubPage,
  "/": MainPage,
  "/sub/[id]": DynamicPageRoute
};

export { client_routes_default };

//# debugId=433580A41F15153064756E2164756E21
//# sourceMappingURL=./chunk-04zdwj09.js.map
