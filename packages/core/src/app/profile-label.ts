export * as ProfileLabel from "./profile-label.js"

import { Credential } from "@ren/schema/credential"

const upper = (slug: string) => slug.toUpperCase().replaceAll("-", "_")

// oxlint-disable-next-line ren/no-comments -- §8 (P7, P22): the only builders of server names and labels. A slug never holds `__`, so `<mcp>__<profile>` never equals another app's `<mcp>`, and every `__` in a label marks the profile.
export const serverOf = (mcp: string, slug?: string) => (slug ? `${mcp}${Credential.profileSeparator}${slug}` : mcp)

export const labelOf = (item: Credential.Item, slug: string) =>
  "mcp" in item
    ? `${Credential.connectedPrefix}${upper(item.mcp)}${Credential.profileSeparator}${upper(slug)}`
    : `${item.env}${Credential.profileSeparator}${upper(slug)}`

export const suffixOf = (slug: string) => `${Credential.profileSeparator}${upper(slug)}`
