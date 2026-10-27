import react from "@astrojs/react"
import tailwind from "@tailwindcss/vite"
import { defineConfig } from "astro/config"

export default defineConfig({
  site: "https://v2.useren.ai",
  output: "static",
  compressHTML: true,
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  vite: { plugins: [tailwind()] },
  integrations: [react()],
})
