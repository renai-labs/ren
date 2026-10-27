#!/usr/bin/env bun
/* oxlint-disable no-console -- the CLI writes its results to the terminal */
import { Connection } from "./connection.js"
import { InfraCommand } from "./infra/command.js"

const usage = `Usage: ren health\n       ${InfraCommand.usage.replace("Usage: ", "")}`

async function main(args: ReadonlyArray<string>) {
  const command = args.at(0)
  if (!command) {
    console.log(usage)
    return 0
  }
  if (command === "infra") return InfraCommand.run(args.slice(1))
  if (command === "health") {
    console.log(JSON.stringify(await Connection.run((client) => client.health.get())))
    return 0
  }
  console.error(`Unknown command: ${command}\n${usage}`)
  return 1
}

process.exitCode = await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  return 1
})
