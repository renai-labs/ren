import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import type { Plugin } from "vite"

const buildBase = "/app/"

const firstPaintFonts = new Set(["sf-pro.woff2"])

const preloadFonts: Plugin = {
  name: "ren:preload-fonts",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler: (_html, context) =>
      Object.values(context.bundle ?? {})
        .filter((output) => output.type === "asset" && output.names.some((name) => firstPaintFonts.has(name)))
        .map((output) => ({
          tag: "link",
          attrs: {
            rel: "preload",
            href: `${buildBase}${output.fileName}`,
            as: "font",
            type: "font/woff2",
            crossorigin: true,
          },
          injectTo: "head",
        })),
  },
}

const rootHas = /(^|[\s,>~+(])(html|body|:root)(\[[^\]]*\]|[.#:][\w-]+)*:has\(/u

const nestedHas = (selector: string) => {
  if (rootHas.test(selector)) return true
  const open: string[] = []
  for (const [index, char] of [...selector].entries()) {
    if (char === ")") open.pop()
    if (char !== "(") continue
    const name = /:([a-z-]+)$/u.exec(selector.slice(0, index))?.[1] ?? ""
    if (name === "has" && open.some((outer) => outer === "is" || outer === "not" || outer === "where")) return true
    open.push(name)
  }
  return false
}

const slowHas = (css: string) =>
  css
    .split("{")
    .map((part) => part.slice(Math.max(part.lastIndexOf("}"), part.lastIndexOf(";")) + 1).trim())
    .filter((selector) => !selector.startsWith("@") && nestedHas(selector))

const slowHasError = (found: ReadonlyArray<string>) =>
  `CSS puts :has() inside :is()/:not()/:where() or on html/body, which makes Chrome restyle the whole page on every DOM change:\n${found.join("\n")}`

// oxlint-disable-next-line ren/no-comments -- Chrome restyles the whole page on every DOM change while a rule nests :has() inside :is(), :not() or :where() (what Tailwind's group-has-* and not-has-* emit) or anchors it on html or body, so the build fails on one; @ren/ui/styles has custom variants with the plain forms.
const noSlowHas: Plugin = {
  name: "ren:no-slow-has",
  apply: "build",
  transformIndexHtml(html) {
    const found = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gu)].flatMap((match) => slowHas(match[1] ?? ""))
    if (found.length > 0) throw new Error(slowHasError(found))
  },
  generateBundle(_options, bundle) {
    const found = Object.values(bundle).flatMap((output) =>
      output.type === "asset" && output.fileName.endsWith(".css") ? slowHas(String(output.source)) : [],
    )
    if (found.length > 0) this.error(slowHasError(found))
  },
}

const pdfjsAssets: Plugin = (() => {
  const root = new URL("node_modules/pdfjs-dist/", import.meta.url).pathname
  const folders = ["cmaps", "standard_fonts", "wasm"]
  return {
    name: "ren:pdfjs-assets",
    configureServer: (server) => {
      server.middlewares.use("/pdfjs", (request, response, next) => {
        const target = path.join(root, path.normalize(request.url ?? "/"))
        if (!folders.some((folder) => target.startsWith(path.join(root, folder))) || !existsSync(target)) return next()
        response.end(readFileSync(target))
      })
    },
    generateBundle() {
      for (const folder of folders)
        for (const name of readdirSync(path.join(root, folder)))
          this.emitFile({
            type: "asset",
            fileName: `pdfjs/${folder}/${name}`,
            source: readFileSync(path.join(root, folder, name)),
          })
    },
  }
})()

export default defineConfig((env) => ({
  base: env.command === "build" ? buildBase : "/",
  resolve: {
    alias: [
      {
        find: /^@betteroffice\/fonts-cjk$/u,
        replacement: new URL("src/components/file-preview/office/fonts-cjk.ts", import.meta.url).pathname,
      },
      { find: /^@tabler\/icons-react$/u, replacement: new URL("src/icons/heroicons.tsx", import.meta.url).pathname },
    ],
  },
  plugins: [
    pdfjsAssets,
    tanstackRouter(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    preloadFonts,
    noSlowHas,
  ],
  build: { sourcemap: "hidden" },
  define:
    env.command === "serve"
      ? {
          "import.meta.env.VITE_REN_API_URL": JSON.stringify(
            loadEnv(env.mode, process.cwd(), "VITE_").VITE_REN_API_URL ?? "http://localhost:4000",
          ),
        }
      : {},
}))
