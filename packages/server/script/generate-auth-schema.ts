import { format, resolveConfig } from "prettier"

const target = new URL("../../db/src/auth.sql.ts", import.meta.url).pathname

await Bun.$`bun --bun x auth generate --config script/auth-config.ts --output ${target} --yes`
  .cwd(new URL("..", import.meta.url).pathname)
  .quiet()

await Bun.write(
  target,
  await format(await Bun.file(target).text(), { ...(await resolveConfig(target)), parser: "typescript" }),
)
