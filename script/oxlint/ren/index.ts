import { definePlugin } from "@oxlint/plugins"
import { featureBoundaries } from "./rules/feature-boundaries.ts"
import { jsxNoLeakedRender } from "./rules/jsx-no-leaked-render.ts"
import { noComments } from "./rules/no-comments.ts"
import { noBooleanModeProps } from "./rules/no-boolean-mode-props.ts"
import { noDynamicImportPath } from "./rules/no-dynamic-import-path.ts"
import { noLookupInLoop } from "./rules/no-lookup-in-loop.ts"
import { noQueryKeyLiteral } from "./rules/no-query-key-literal.ts"
import { noRenderProps } from "./rules/no-render-props.ts"
import { noSortForExtremum } from "./rules/no-sort-for-extremum.ts"
import { preferLazyStateInit } from "./rules/prefer-lazy-state-init.ts"
import { requirePassiveListener } from "./rules/require-passive-listener.ts"
import { requireSuppressionReason } from "./rules/require-suppression-reason.ts"

export const rules = {
  "feature-boundaries": featureBoundaries,
  "jsx-no-leaked-render": jsxNoLeakedRender,
  "no-boolean-mode-props": noBooleanModeProps,
  "no-comments": noComments,
  "no-dynamic-import-path": noDynamicImportPath,
  "no-lookup-in-loop": noLookupInLoop,
  "no-query-key-literal": noQueryKeyLiteral,
  "no-render-props": noRenderProps,
  "no-sort-for-extremum": noSortForExtremum,
  "prefer-lazy-state-init": preferLazyStateInit,
  "require-passive-listener": requirePassiveListener,
  "require-suppression-reason": requireSuppressionReason,
}

export default definePlugin({ meta: { name: "ren" }, rules })
