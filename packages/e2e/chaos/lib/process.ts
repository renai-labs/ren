export * as Process from "./process.js"

export const childPids = (pid: number): ReadonlyArray<number> => {
  const children = Bun.spawnSync(["pgrep", "-P", String(pid)], { stdout: "pipe", stderr: "ignore" })
    .stdout.toString()
    .split("\n")
    .flatMap((line) => (/^\d+$/.test(line.trim()) ? [Number(line.trim())] : []))
  return [...children, ...children.flatMap(childPids)]
}

export const killTree = (pid: number) => {
  for (const member of [pid, ...childPids(pid)]) Bun.spawnSync(["kill", "-KILL", String(member)], { stderr: "ignore" })
}

const cleanups = new Set<() => unknown>()

export const onInterrupt = (cleanup: () => unknown) => {
  cleanups.add(cleanup)
  return () => cleanups.delete(cleanup)
}

export const interrupt = () => Promise.allSettled([...cleanups].map((cleanup) => Promise.resolve().then(cleanup)))
