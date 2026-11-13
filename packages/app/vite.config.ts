import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import type { Plugin } from "vite"

const base = "/app/"

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
            href: `${base}${output.fileName}`,
            as: "font",
            type: "font/woff2",
            crossorigin: true,
          },
          injectTo: "head",
        })),
  },
}

const pdfjsAssets: Plugin = (() => {
  const root = new URL("node_modules/pdfjs-dist/", import.meta.url).pathname
  const folders = ["cmaps", "standard_fonts", "wasm"]
  return {
    name: "ren:pdfjs-assets",
    configureServer: (server) => {
      server.middlewares.use(`${base}pdfjs`, (request, response, next) => {
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
  base,
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
