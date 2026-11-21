import fs from "fs/promises"
import path from "path"

const root = path.join(import.meta.dir, "../../..")
const pages = path.join(import.meta.dir, "../src/pages")
const function_ = await Bun.file(path.join(root, "infra/aws/app.tf")).text()
const list = /var site = \[(?<paths>[^\]]*)\]/u.exec(function_)?.groups?.paths
if (list === undefined) throw new Error("infra/aws/app.tf has no `var site = [...]` list")
const routed = new Set([...list.matchAll(/"(?<path>[^"]+)"/gu)].flatMap((match) => match.groups?.path ?? []))

const missing = (await fs.readdir(pages, { withFileTypes: true }))
  .map((entry) => (entry.isDirectory() ? entry.name : entry.name.replace(/\.(?:astro|md|mdx|html|ts|js)$/u, "")))
  .filter((name) => name !== "index" && !name.startsWith("_") && !name.includes("."))
  .map((name) => `/${name}`)
  .filter((section) => !routed.has(section))

if (missing.length > 0) {
  console.error(
    [
      `The site has pages that CloudFront would send to the app: ${missing.join(", ")}.`,
      "Add each one to `var site` in infra/aws/app.tf, then run `terraform apply` in infra/aws.",
    ].join("\n"),
  )
  process.exit(1)
}
