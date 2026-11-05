import { Budget } from "../../src/budget.js"

const directory = process.argv[2]
if (!directory) throw new Error("A budget directory is required")
const reservation = await Budget.reserve({
  directory,
  purpose: "holder",
  capacityMiB: 1,
  floorMiB: 0,
  availableMiB: 1,
  unitMiB: 1,
  units: 1,
})
if (reservation._tag !== "Acquired") throw new Error("The fixture could not reserve its budget")
process.stdout.write("ready")
await Bun.stdin.text()
reservation.release()
