import mdx from "@astrojs/mdx"
import { unified } from "@astrojs/markdown-remark"
import react from "@astrojs/react"
import tailwind from "@tailwindcss/vite"
import { defineConfig } from "astro/config"
import { rehypeCode, remarkHeading } from "fumadocs-core/mdx-plugins"
import { rehypeAutolinkHeadings } from "./src/lib/docs/rehype-autolink.ts"

export default defineConfig({
  site: "https://v2.useren.ai",
  output: "static",
  compressHTML: true,
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  vite: { plugins: [tailwind()] },
  integrations: [
    react(),
    mdx({
      syntaxHighlight: false,
      processor: unified({
        remarkPlugins: [remarkHeading],
        rehypePlugins: [
          rehypeAutolinkHeadings,
          [rehypeCode, { themes: { light: "github-light", dark: "github-dark" } }],
        ],
      }),
    }),
  ],
})
