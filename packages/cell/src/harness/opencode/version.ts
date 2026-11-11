export * as OpenCodeVersion from "./version.js"

// oxlint-disable-next-line ren/no-node-modules-import -- @opencode/core exports no package.json and no version, and the harness version must be the installed one.
import opencode from "../../../node_modules/@opencode/core/package.json"

export const installed = opencode.version
