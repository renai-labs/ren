import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))

await Bun.$`bun run generate`.cwd(`${root}/packages/server`)
await Bun.$`bun run generate`.cwd(`${root}/packages/protocol`)
await Bun.$`bun run generate`.cwd(`${root}/packages/client`)
await Bun.$`bun run script/format.ts`.cwd(root)
