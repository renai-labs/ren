const root = new URL("..", import.meta.url).pathname

await Bun.$`bun run generate`.cwd(`${root}/packages/server`)
await Bun.$`bun run generate`.cwd(`${root}/packages/protocol`)
await Bun.$`bun run generate`.cwd(`${root}/packages/client`)
await Bun.$`bun run generate`.cwd(`${root}/packages/ui`)
await Bun.$`bun run generate`.cwd(`${root}/packages/app`)
await Bun.$`bun run script/format.ts`.cwd(root)
