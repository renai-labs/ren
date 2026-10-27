export * as Directories from "./directories.js"

import { homedir } from "node:os"
import { join } from "node:path"

export const config = () => join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "ren2")
