await Bun.$`bun fmt`.cwd(new URL("..", import.meta.url).pathname)
