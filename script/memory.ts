import { parseArgs } from "util"
import { Budget } from "@ren/test-harness/budget"
import { Memory } from "@ren/test-harness/memory"

const usage = `Usage:
  bun run memory                              free memory and who holds the budget
  bun run memory queue [--mib=1536] [--units=1] -- <cmd>
                                              run cmd once the budget has room for at least one unit of mib,
                                              with TURBO_CONCURRENCY set to the units it got
  bun run memory profile -- <cmd>             run cmd and print how much memory it took at its peak`

const args = parseArgs({
  args: process.argv.slice(2),
  options: { mib: { type: "string", default: "1536" }, units: { type: "string", default: "1" } },
  allowPositionals: true,
})
const action = args.positionals[0] ?? "status"
const command = args.positionals.slice(1)
const run = (cmd: string[]) => {
  const child = Bun.spawn({ cmd, env: process.env, stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  process.once("SIGINT", () => child.kill("SIGINT"))
  process.once("SIGTERM", () => child.kill("SIGTERM"))
  return child.exited
}

if (action === "status") {
  const status = await Budget.status()
  console.log(
    `${Math.round(status.memory.availableMiB)} of ${Math.round(status.memory.limitMiB)} MiB free, ${status.floorMiB} MiB kept free`,
  )
  console.log(
    `${status.holders.reduce((total, holder) => total + holder.mib, 0)} of ${status.capacityMiB} MiB reserved`,
  )
  for (const holder of status.holders) console.log(`  ${holder.purpose}: ${holder.mib} MiB, pid ${holder.pid}`)
} else if (action === "queue" && command.length > 0) {
  const mib = Number(args.values.mib)
  if (!Number.isSafeInteger(mib) || mib < 1) throw new Error("--mib must be a positive whole number")
  const units = Number(args.values.units)
  if (!Number.isSafeInteger(units) || units < 1) throw new Error("--units must be a positive whole number")
  const lease = await Budget.acquire({ purpose: command.join(" "), unitMiB: mib, units, onWait: console.error })
  if (lease.units < units) console.error(`Running ${lease.units} of ${units} tasks at a time to fit the memory budget`)
  process.env.TURBO_CONCURRENCY = String(lease.units)
  process.exitCode = await run(command)
  lease.release()
} else if (action === "profile" && command.length > 0) {
  const baseline = await Memory.read()
  let lowest = baseline.availableMiB
  const sampler = setInterval(
    () =>
      void Memory.read().then((memory) => {
        lowest = Math.min(lowest, memory.availableMiB)
      }),
    250,
  )
  process.exitCode = await run(command)
  clearInterval(sampler)
  console.error(
    `Peak: ${Math.round(baseline.availableMiB - lowest)} MiB used, from ${Math.round(baseline.availableMiB)} MiB free at the start. Other processes count too, so profile on a quiet machine.`,
  )
} else {
  console.error(usage)
  process.exitCode = 1
}
