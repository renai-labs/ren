export * as Owners from "./owners.js"

import type { Glyph } from "@ren/ui/icon"

export type Option = { readonly value: string; readonly label: string; readonly glyph: Glyph }

// oxlint-disable-next-line ren/no-comments -- The owners a person can give a key: the org, each space they see, and themselves (owner-access §4). Ren checks the right again on save.
export const options = (
  spaces: ReadonlyArray<{ readonly id: string; readonly name: string }>,
): ReadonlyArray<Option> => [
  { value: "org", label: "Organization", glyph: "Building" },
  ...spaces.map((space) => ({ value: `space:${space.id}`, label: space.name, glyph: "Cube" as const })),
  { value: "person", label: "Only me, in my private space", glyph: "Lock" },
]
