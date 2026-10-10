await Bun.$`bun run prettier --ignore-unknown --write .`.cwd(new URL("..", import.meta.url).pathname)
