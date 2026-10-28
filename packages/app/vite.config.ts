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

export default defineConfig((env) => ({
  base,
  plugins: [tanstackRouter(), react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss(), preloadFonts],
  define:
    env.command === "serve"
      ? {
          "import.meta.env.VITE_REN_API_URL": JSON.stringify(
            loadEnv(env.mode, process.cwd(), "VITE_").VITE_REN_API_URL ?? "http://localhost:4000",
          ),
        }
      : {},
}))
