export * as Entrypoints from "./entrypoints.js"

// oxlint-disable-next-line ren/no-comments -- The file each process of a machine starts from, inside its unpacked bundle: the bundle build follows its imports, and start.js runs it.
export const brain = "packages/cell/src/bun.ts"

export const executor = "packages/executor/src/main.ts"
