#!/usr/bin/env bun
/* oxlint-disable no-console -- the CLI writes its results to the terminal */
import { Ren } from "@renai-labs/sdk"

const usage = "Usage: ren health"

async function main(args: ReadonlyArray<string>) {
  const command = args.at(0)
  if (!command) {
    console.log(usage)
    return 0
  }
  if (command === "health") {
    const client = Ren.make({ baseUrl: process.env.REN_URL ?? "http://localhost:4000" })
    console.log(JSON.stringify(await client.health.get()))
    return 0
  }
  console.error(`Unknown command: ${command}\n${usage}`)
  return 1
}

process.exitCode = await main(process.argv.slice(2))
