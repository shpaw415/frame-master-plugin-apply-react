import { builder } from "frame-master/build";
import {
  directiveToolSingleton,
  type FrameMasterPlugin,
} from "frame-master/plugin";
import { join } from "path";
import { version } from "../package.json";

/**
 * Configuration options for the Apply-React plugin
 */
export type ApplyReactPluginOptions = {
  /** Routing style convention (currently supports "nextjs") */
  style: "nextjs";

  /** Base path to the routes directory (e.g., "src/pages") */
  route: string;

  /**
   * Optional path to a custom client-side shell component
   *
   * Used as a wrapper for the RouterHost or global shell during hydration.
   * If not provided, the default client shell will be used.
   */
  clientShellPath?: string;

  /**
   * Enable Hot Module Replacement for development
   *
   * @default true
   */
  enableHMR?: boolean;

  /**
   * Hydration method to use on the client
   *
   * - `"hydrate"`: Attaches event listeners to existing server-rendered HTML (default)
   * - `"render"`: Fully re-renders the component tree on the client
   *
   * @default "hydrate"
   */
  hydration?: "hydrate" /* | "render"*/;
};

function isJsFile(filePath: string) {
  const jsExtensions = [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"];
  return jsExtensions.some((ext) => filePath.endsWith(ext));
}

async function toEmptyFileFromFilePath(filePath: string): Promise<{
  contents: string;
  loader?: Bun.Loader;
}> {
  const transpiler = new Bun.Transpiler();

  if (isJsFile(filePath)) {
    const moduleContent = await Bun.file(filePath).text();
    const moduleData = transpiler.scan(moduleContent);
    return {
      contents: new Bun.Transpiler({
        exports: {
          replace: moduleData.exports.reduce(
            (prev, curr) => ({
              ...prev,
              [curr]: "<THROW_SERVER_ONLY>",
            }),
            {}
          ),
        },
      })
        .transformSync(moduleContent)
        .replaceAll(
          `"<THROW_SERVER_ONLY>"`,
          `() => throw new Error("This module is server-only and cannot be imported on the client-side.");`
        ),
      loader: "js",
    };
  } else {
    return {
      contents: "",
    };
  }
}

/**
 * Apply React Plugin for Frame Master
 *
 * Enables React support with client-side hydration.
 *
 * **use with frame-master-plugin-react-to-html** for full SSR.
 *
 * @features
 * - Server-side rendering (SSR) of React components
 * - Client-side hydration for interactive components
 * - File-based routing with automatic route generation
 * - Hot Module Replacement (HMR) in development mode
 * - Server-only module protection and tree-shaking
 * - CDN-ready production builds with optimized React imports
 * - WebSocket-based live reload for route changes
 *
 * @param props - Plugin configuration options
 * @param props.style - Routing style convention (currently supports "nextjs")
 * @param props.route - Base path for route files (e.g., "src/pages")
 * @param props.shellPath - Path to the main shell/layout wrapper component
 * @param props.clientShellPath - Optional custom shell for client-side hydration
 * @param props.enableHMR - Enable Hot Module Replacement (default: true on dev & false on prod)
 *
 * @returns Frame Master plugin instance with React integration
 *
 * @example
 * ```sh
 * # Development with HMR
 * NODE_ENV=development frame-master dev
 * ```
 *
 * @example
 * ```sh
 * # Production build
 * NODE_ENV=production frame-master build
 * ```
 */
export default function applyReactPluginToHTML(
  props: ApplyReactPluginOptions
): FrameMasterPlugin {
  const {
    style,
    route,
    enableHMR = process.env.NODE_ENV != "production",
  } = props;
  process.env.PUBLIC_HMR_ENABLED = enableHMR ? "true" : "false";
  const cwd = process.cwd();
  const pathToHydrate = join(`${import.meta.dir}`, "hydrate.tsx");

  const pathToClientShell = props.clientShellPath
    ? join(cwd, props.clientShellPath)
    : join(import.meta.dir, "client-shell.tsx");

  const fileRouter = new Bun.FileSystemRouter({
    dir: join(cwd, route),
    style,
    fileExtensions: [".tsx", ".jsx"],
  });

  async function reWriteHTMLFiles(
    result: Bun.BuildOutput,
    buildConfig: Bun.BuildConfig
  ) {
    const hydratePath = result.outputs
      .find((output) => output.path.endsWith("hydrate.js"))
      ?.path.replace(join(cwd, buildConfig.outdir!), "");

    if (!hydratePath) return;

    const rewriter = new HTMLRewriter().on("head", {
      element(element) {
        [`<script src="${hydratePath}" type="module"></script>`].forEach(
          (injectElement) => element.append(injectElement, { html: true })
        );
      },
    });
    await Promise.all(
      result.outputs
        .filter((output) => output.path.endsWith(".html"))
        .map(async (file) => {
          return Bun.file(file.path).write(
            rewriter.transform(await file.text())
          );
        })
    );
  }

  const ReactEntryPoints = ["react", "react-dom"];
  const DevReactEntryPoints = [
    "node_modules/react/cjs/react-jsx-dev-runtime.development.js",
    "node_modules/react/jsx-dev-runtime.js",
    "node_modules/react/cjs/react.development.js",
    "node_modules/react-dom/cjs/react-dom.development.js",
  ];
  const wsList: Bun.ServerWebSocket[] = [];
  return {
    name: "apply-react-to-html-plugin",
    version,
    build: {
      buildConfig: () => ({
        entrypoints: [
          pathToHydrate,
          ...(process.env.NODE_ENV === "production"
            ? []
            : [...ReactEntryPoints, ...DevReactEntryPoints]),
          join("routes", "client:routes"),
        ],
        plugins: [
          {
            name: "apply-routes-to-hydrate",
            setup(build) {
              // remove server-only module from client bundle
              build.onLoad(
                {
                  filter: /.*/,
                },
                async (args) => {
                  const isServerOnlyModule =
                    await directiveToolSingleton.pathIs(
                      "server-only",
                      args.path
                    );
                  if (isServerOnlyModule) {
                    return {
                      contents: "",
                      loader: "js",
                    };
                  }
                }
              );
              // get the original file instead of the parsed file from other plugins
              build.onResolve(
                {
                  filter: /^original:\.*/,
                },
                (args) => {
                  const realPath = args.path.replace("original:", "");

                  const ext = realPath.split(".").pop()!;

                  const splitedPath = realPath.split("/");

                  const fileName = splitedPath.pop()?.split(".").shift()!;

                  splitedPath.push(`_${fileName}_.${ext}`);

                  return {
                    namespace: "__ORIGINAL__",
                    path: splitedPath.join("/"),
                  };
                }
              );

              build.onLoad(
                {
                  filter: /.*/,
                  namespace: "__ORIGINAL__",
                },
                async (args) => {
                  const splitedPath = args.path.split("/");
                  const fileNameWithExt = splitedPath.pop()!;

                  const ext = fileNameWithExt.split(".").pop()!;
                  const fileName = fileNameWithExt.split(".").shift()!;

                  const realFilePath = join(
                    "/",
                    ...splitedPath,
                    `${fileName.slice(1, -1)}.${ext}`
                  );

                  const fileContent = await Bun.file(realFilePath).text();

                  const isServerOnlyModule =
                    await directiveToolSingleton.pathIs(
                      "server-only",
                      realFilePath
                    );
                  if (isServerOnlyModule) {
                    return {
                      loader: realFilePath.split(".").pop() as Bun.Loader,
                      ...toEmptyFileFromFilePath(realFilePath),
                    };
                  }
                  return {
                    contents: fileContent,
                    loader: "tsx",
                  };
                }
              );

              build.onResolve({ filter: /client:shell/ }, (args) => {
                return { path: pathToClientShell };
              });

              build.onResolve({ filter: /^.*client:routes$/ }, (args) => {
                return {
                  path: "client-routes",
                  namespace: "client-routes",
                };
              });
              build.onLoad(
                { filter: /.*/, namespace: "client-routes" },
                async (args) => {
                  const routePathname = Object.keys(fileRouter.routes);

                  const parsedFileNames = Object.assign(
                    {},
                    ...routePathname.map((pathname) => ({
                      [pathname]: {
                        defaultExport: fileRouter.routes[pathname]!.replaceAll(
                          "/",
                          "_"
                        )
                          .replaceAll(" ", "_")
                          .replaceAll(".", "_")
                          .replaceAll("-", "_"),
                        filePath: fileRouter.routes[pathname]!,
                      },
                    }))
                  ) as Record<
                    string,
                    { filePath: string; defaultExport: string }
                  >;

                  const toRouteObject = () => {
                    return `const _ROUTES_ = { ${Object.entries(
                      parsedFileNames
                    ).map(
                      ([key, value]) => `"${key}": ${value.defaultExport}`
                    )} }  `;
                  };
                  return {
                    contents: [
                      ...Object.entries(parsedFileNames).map(([_, v]) => {
                        return `import {default as ${v.defaultExport}} from "original:${v.filePath}";`;
                      }),
                      toRouteObject(),
                      `export default _ROUTES_;`,
                    ].join("\n"),
                    loader: args.loader,
                  };
                }
              );

              build.onEnd(async (result) => {
                await reWriteHTMLFiles(result, build.config);
              });
            },
          },
        ],
      }),
    },
    serverConfig: {
      routes: {
        "/_REACT_HMR/ws": enableHMR
          ? (req, server) =>
              server.upgrade(req, { data: { react_hmr: true } as any })
                ? new Response("ws upgraded", { status: 101 })
                : new Response("upgrade failed", { status: 400 })
          : new Response("HMR disabled", { status: 503 }),
      },
    },
    websocket: {
      onOpen(ws) {
        if (!ws.data || !(ws.data as any)["react_hmr"]) return;
        wsList.push(ws);
      },
      onClose(ws) {
        const index = wsList.indexOf(ws);
        if (index > -1) {
          wsList.splice(index, 1);
        }
      },
    },
    fileSystemWatchDir: enableHMR ? [join(cwd, route)] : undefined,
    onFileSystemChange(event, filepath, absolutePath) {
      if (!absolutePath.startsWith(join(cwd, route)) || builder?.isBuilding())
        return;
      builder?.build().then(() => {
        wsList.forEach((ws) => {
          ws.send("update-routes");
        });
      });
    },
    router: {
      before_request(master) {
        master.setGlobalValues({
          HMR_ENABLED: process.env.NODE_ENV == "production" ? false : true,
        });
      },
    },
  };
}
