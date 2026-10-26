import { join } from "node:path"
import { Homes } from "../../src/homes.js"

const directory = process.argv[2]
if (!directory) throw new Error("A run directory is required")
const home = await Homes.create(directory)
await Bun.write(join(home, "marker"), "ready")
process.stdout.write(home)
await Bun.stdin.text()
