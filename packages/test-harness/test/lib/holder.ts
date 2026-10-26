import { Budget } from "../../src/budget.js"

const directory = process.argv[2]
if (!directory) throw new Error("A budget directory is required")
const reservation = await Budget.reserve({ directory, capacityMiB: 1, costMiB: 1 })
if (reservation._tag !== "Acquired") throw new Error("The fixture could not reserve its budget")
process.stdout.write("ready")
await Bun.stdin.text()
reservation.release()
