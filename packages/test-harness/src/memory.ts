export * as Memory from "./memory.js"

import os from "node:os"
import { join } from "node:path"

export interface Reading {
  readonly limitMiB: number
  readonly availableMiB: number
}

const mebibyte = 1024 ** 2
const optional = (file: string) =>
  Bun.file(file)
    .text()
    .catch(() => "")
const number = (pattern: RegExp, text: string) => Number(pattern.exec(text)?.at(1) ?? 0)

export const read = async (): Promise<Reading> => {
  if (process.platform === "darwin") {
    const stat = await new Response(Bun.spawn(["vm_stat"], { stdout: "pipe", stderr: "ignore" }).stdout).text()
    const pages = ["free", "inactive", "speculative", "purgeable"].reduce(
      (total, name) => total + number(new RegExp(`^Pages ${name}:\\s+(\\d+)`, "m"), stat),
      0,
    )
    return {
      limitMiB: os.totalmem() / mebibyte,
      availableMiB: (pages * (number(/page size of (\d+) bytes/, stat) || 4096)) / mebibyte,
    }
  }
  const meminfo = await optional("/proc/meminfo")
  if (!meminfo) return { limitMiB: os.totalmem() / mebibyte, availableMiB: os.freemem() / mebibyte }
  const parts =
    /^0::\/(.*)$/m
      .exec(await optional("/proc/self/cgroup"))
      ?.at(1)
      ?.split("/")
      .filter(Boolean) ?? []
  const limits = await Promise.all(
    ["", ...parts].map(async (_, index) => {
      const files = await Promise.all(
        ["memory.max", "memory.current", "memory.stat"].map((name) =>
          optional(join("/sys/fs/cgroup", ...parts.slice(0, index), name)),
        ),
      )
      const max = Number.parseInt(files.at(0) ?? "", 10)
      const current = Number.parseInt(files.at(1) ?? "", 10)
      if (!Number.isFinite(max) || !Number.isFinite(current)) return []
      const inactive = number(/^inactive_file (\d+)$/m, files.at(2) ?? "")
      return [{ limitMiB: max / mebibyte, availableMiB: (max - current + inactive) / mebibyte }]
    }),
  )
  return limits.flat().reduce(
    (total, limit) => ({
      limitMiB: Math.min(total.limitMiB, limit.limitMiB),
      availableMiB: Math.min(total.availableMiB, limit.availableMiB),
    }),
    {
      limitMiB: number(/^MemTotal:\s+(\d+) kB$/m, meminfo) / 1024,
      availableMiB: number(/^MemAvailable:\s+(\d+) kB$/m, meminfo) / 1024,
    },
  )
}
