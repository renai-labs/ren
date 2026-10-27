import { definePlugin } from "@oxlint/plugins"
import { interfaceCopy } from "./rules/interface-copy.ts"
import { noComments } from "./rules/no-comments.ts"
import { noNodeModulesImport } from "./rules/no-node-modules-import.ts"
import { noLookupInLoop } from "./rules/no-lookup-in-loop.ts"
import { noSortForExtremum } from "./rules/no-sort-for-extremum.ts"
import { requireCompanionClass } from "./rules/require-companion-class.ts"
import { requirePassiveListener } from "./rules/require-passive-listener.ts"
import { requireSuppressionReason } from "./rules/require-suppression-reason.ts"

export const rules = {
  "interface-copy": interfaceCopy,
  "no-comments": noComments,
  "no-node-modules-import": noNodeModulesImport,
  "no-lookup-in-loop": noLookupInLoop,
  "no-sort-for-extremum": noSortForExtremum,
  "require-companion-class": requireCompanionClass,
  "require-passive-listener": requirePassiveListener,
  "require-suppression-reason": requireSuppressionReason,
}

export default definePlugin({ meta: { name: "ren" }, rules })
