export * as Process from "./process.js"

export const alive = (pid: number): Promise<boolean> =>
  Promise.try(() => process.kill(pid, 0)).then(
    () => true,
    (error: unknown) => !(error instanceof Error && "code" in error && error.code === "ESRCH"),
  )
