export * as Owners from "./owners.js"

import type { Select } from "@ren/ui/select"

// oxlint-disable-next-line ren/no-comments -- The owners a person can give a key: the org, each space they see, and themselves (owner-access §4). Ren checks the right again on save.
export const options = (spaces: ReadonlyArray<{ readonly id: string; readonly name: string }>) =>
  [
    { value: "org", label: "Everyone in the organization" },
    ...spaces.map((space) => ({ value: `space:${space.id}`, label: `Everyone in ${space.name}` })),
    { value: "person", label: "Only me" },
  ] satisfies ReadonlyArray<Select.Option>
