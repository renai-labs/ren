import type { Group, Option } from "@ren/ui/combobox"
import { Icon } from "@ren/ui/icon"
import { StatusDot } from "@ren/ui/status-dot"
import type { StatusTone } from "@ren/ui/status-dot"

const space = (value: string, label: string, projects: readonly string[], detail?: string): Option => ({
  value: `space:${value}`,
  label,
  detail,
  icon: <Icon glyph={value === "me" ? "User" : "Users"} />,
  options: [
    { value: `space:${value}:all`, label: `All of ${label}`, icon: <Icon glyph="Box" /> },
    ...projects.map((project) => ({
      value: `project:${value}:${project.toLowerCase().replaceAll(" ", "-")}`,
      label: project,
      icon: <Icon glyph="Folder" />,
    })),
  ],
})

export const scopes: readonly Group[] = [
  {
    value: "personal",
    label: "Personal",
    items: [space("me", "My space", ["Reading list", "Side projects"], "Only you")],
  },
  {
    value: "teams",
    label: "Teams",
    items: [
      space("platform", "Platform", ["Billing", "Search", "Storage"]),
      space("design", "Design", ["Brand refresh", "Design system"]),
    ],
  },
]

export const colors: readonly { value: StatusTone; label: string }[] = [
  { value: "neutral", label: "Gray" },
  { value: "accent", label: "Blue" },
  { value: "success", label: "Green" },
  { value: "warning", label: "Yellow" },
  { value: "danger", label: "Red" },
]

export type Label = { value: string; label: string; color: StatusTone }

export const initialLabels: readonly Label[] = [
  { value: "bug", label: "Bug", color: "danger" },
  { value: "feature", label: "Feature", color: "accent" },
  { value: "docs", label: "Documentation", color: "neutral" },
  { value: "performance", label: "Performance", color: "warning" },
]

export const swatch = (value: string, label: string, tone: StatusTone): Option => ({
  value,
  label,
  icon: <StatusDot tone={tone} />,
})

export const filterProperties = [
  {
    value: "status",
    label: "Status",
    glyph: "CircleCheck",
    selection: "single",
    options: [
      { value: "any", label: "Any status" },
      { value: "open", label: "Open" },
      { value: "progress", label: "In progress" },
      { value: "done", label: "Done" },
    ],
  },
  {
    value: "label",
    label: "Labels",
    glyph: "Tag",
    selection: "multiple",
    options: initialLabels.map((label) => ({ value: label.value, label: label.label })),
  },
  {
    value: "assignee",
    label: "Assignee",
    glyph: "User",
    selection: "multiple",
    options: [
      { value: "ada", label: "Ada Lovelace" },
      { value: "alan", label: "Alan Turing" },
      { value: "grace", label: "Grace Hopper" },
    ],
  },
] as const

export const defaultFilters = ["status:any"]
