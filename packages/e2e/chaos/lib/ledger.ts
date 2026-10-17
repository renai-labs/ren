export * as Ledger from "./ledger.js"

import type { ExecutorAdapter } from "./adapters/executor.js"

export const file = ".chaos-ledger"

export const marker = (label: string) => `ledger_${label}_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`

export const append = (value: string) => `printf '%s\\n' ${value} >> ${file}`

export const count = async (hand: Pick<ExecutorAdapter.Instance, "observe">, value: string) =>
  (await hand.observe(["sh", "-c", `cat ${file} */${file} 2>/dev/null || true`])).stdout
    .split("\n")
    .filter((line) => line === value).length
