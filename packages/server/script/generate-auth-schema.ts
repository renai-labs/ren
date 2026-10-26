import { format } from "oxfmt"

const target = new URL("../../db/src/auth.sql.ts", import.meta.url).pathname

await Bun.$`bun --bun x auth generate --config script/auth-config.ts --output ${target} --yes`
  .cwd(new URL("..", import.meta.url).pathname)
  .quiet()

const formatted = await format(target, await Bun.file(target).text(), { semi: false, printWidth: 120 })
if (formatted.errors.length > 0) throw new Error(formatted.errors.map((error) => error.message).join("\n"))
await Bun.write(target, formatted.code)
