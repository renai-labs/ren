import { readdirSync } from "fs"
import path from "path"
import type { StorybookConfig } from "@storybook/react-vite"
import tailwindcss from "@tailwindcss/vite"
import type { Plugin } from "vite"

const renV1 = process.env.REN_V1_PATH === undefined ? undefined : path.resolve(process.env.REN_V1_PATH)
const baseUi = readdirSync(path.resolve(import.meta.dirname, "../node_modules/@base-ui/react"), { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && !["docs", "internals", "types", "utils", "floating-ui-react"].includes(entry.name),
  )
  .map((entry) => `@base-ui/react/${entry.name}`)
const previewCss = path.resolve(import.meta.dirname, "preview.css")

const parity = (root: string): Plugin => ({
  name: "ren:parity",
  enforce: "pre",
  transform(code, id) {
    if (id !== previewCss) return
    return `${code}\n@source "${path.join(root, "packages/ui/src")}";\n`
  },
})

const config: StorybookConfig = {
  framework: { name: "@storybook/react-vite", options: {} },
  stories: [
    { directory: "../ui", files: "*.stories.tsx", titlePrefix: "UI" },
    { directory: "../app", files: "**/*.stories.tsx", titlePrefix: "App" },
    ...(renV1 === undefined ? [] : [{ directory: "../parity", files: "*.stories.tsx", titlePrefix: "Parity" }]),
  ],
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  typescript: { reactDocgen: false },
  viteFinal: (vite) => ({
    ...vite,
    plugins: [...(renV1 === undefined ? [] : [parity(renV1)]), tailwindcss(), ...(vite.plugins ?? [])],
    resolve: {
      ...vite.resolve,
      dedupe: ["react", "react-dom", "@base-ui/react"],
      alias:
        renV1 === undefined ? [] : [{ find: /^ren-v1\/(.*)$/, replacement: path.join(renV1, "packages/ui/src/$1") }],
    },
    optimizeDeps: { ...vite.optimizeDeps, include: [...(vite.optimizeDeps?.include ?? []), ...baseUi] },
    server: {
      ...vite.server,
      fs: {
        ...vite.server?.fs,
        allow: [path.resolve(import.meta.dirname, "../../.."), ...(renV1 === undefined ? [] : [renV1])],
      },
    },
  }),
}

export default config
