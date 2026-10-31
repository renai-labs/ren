export * as SpaceSections from "./space-sections.js"

export const all = [
  {
    value: "overview",
    label: "Overview",
    glyph: "Dashboard",
    to: "/spaces/$spaceId",
    description: (space: string) => `The name and description of ${space}.`,
  },
  {
    value: "members",
    label: "Members",
    glyph: "Users",
    to: "/spaces/$spaceId/members",
    description: (space: string) => `People who can use ${space}.`,
  },
  {
    value: "apps",
    label: "Apps",
    glyph: "LayoutGrid",
    to: "/spaces/$spaceId/apps",
    description: (space: string) => `Apps every chat in ${space} can use.`,
  },
  {
    value: "credentials",
    label: "Credentials",
    glyph: "Key",
    to: "/spaces/$spaceId/credentials",
    description: (space: string) => `Keys every chat in ${space} can use.`,
  },
  {
    value: "channels",
    label: "Channels",
    glyph: "AtSign",
    to: "/spaces/$spaceId/channels",
    description: (space: string) => `Channels where people can mention @Ren to work in ${space}.`,
  },
  {
    value: "repositories",
    label: "Repositories",
    glyph: "GitBranch",
    to: "/spaces/$spaceId/repositories",
    description: (space: string) => `Repositories Ren can read in ${space}. To change code, ask Ren to clone one.`,
  },
  {
    value: "factory",
    label: "Factory",
    glyph: "Building",
    to: "/spaces/$spaceId/factory",
    description: (space: string) => `Agents that work on tasks in ${space}.`,
  },
] as const

export type Section = (typeof all)[number]

export const of = (pathname: string): Section =>
  all.find((section) => section.value === pathname.split("/").at(3)) ?? all[0]
