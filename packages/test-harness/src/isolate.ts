export * as Isolate from "./isolate.js"

import { mkdir, mkdtemp } from "node:fs/promises"
import { join } from "node:path"

const root = process.env.REN_TEST_HOME_ROOT
if (root) {
  const home = await mkdtemp(join(root, "file-"))
  const temporary = join(home, "tmp")
  await mkdir(temporary)
  Object.assign(process.env, {
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    TMPDIR: temporary,
  })
}
