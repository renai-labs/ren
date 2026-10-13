import { definePlugin } from "@oxlint/plugins"
import { featureBoundaries } from "./rules/feature-boundaries.ts"
import { interfaceCopy } from "./rules/interface-copy.ts"
import { noComments } from "./rules/no-comments.ts"
import { noLookupInLoop } from "./rules/no-lookup-in-loop.ts"
import { noSortForExtremum } from "./rules/no-sort-for-extremum.ts"
import { requireCompanionClass } from "./rules/require-companion-class.ts"
import { requirePassiveListener } from "./rules/require-passive-listener.ts"
import { requireSuppressionReason } from "./rules/require-suppression-reason.ts"
import { storyCoverage } from "./rules/story-coverage.ts"
import { storyLocation } from "./rules/story-location.ts"

export const rules = {
  "feature-boundaries": featureBoundaries,
  "interface-copy": interfaceCopy,
  "no-comments": noComments,
  "no-lookup-in-loop": noLookupInLoop,
  "no-sort-for-extremum": noSortForExtremum,
  "require-companion-class": requireCompanionClass,
  "require-passive-listener": requirePassiveListener,
  "require-suppression-reason": requireSuppressionReason,
  "story-coverage": storyCoverage,
  "story-location": storyLocation,
}

export default definePlugin({ meta: { name: "ren" }, rules })
