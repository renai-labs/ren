import type { AgentInfo, LabelInfo, SpaceInfo, TaskInfo } from "@ren/client"
import { IconAntennaBars5, IconCube, IconHandStop, IconProgress, IconTag, IconUserCircle } from "@tabler/icons-react"
import { Tasks } from "@ren/client/react"
import { IconAgent } from "@ren/ui/heroicons"
import { spaceOptions, type FilterProperty } from "../../components/filter-menu.js"
import { PersonAvatar } from "../../components/person-avatar.js"
import { cn } from "cn"
import {
  PriorityIcon,
  StatusGlyph,
  UnassignedIcon,
  labelColor,
  priorities,
  statuses,
} from "../../components/task-meta.js"
import type { Member } from "../../lib/use-members.js"

type Task = TaskInfo

export interface TaskLookups {
  readonly spaces: ReadonlyArray<SpaceInfo>
  readonly agents: ReadonlyArray<AgentInfo>
  readonly members: ReadonlyArray<Member>
  readonly labels: ReadonlyArray<LabelInfo>
}

const propertiesFor = (lookups: TaskLookups): FilterProperty[] => [
  {
    key: "space",
    label: "Space",
    any: "All spaces",
    icon: IconCube,
    single: true,
    options: spaceOptions(lookups.spaces),
  },
  {
    key: "status",
    label: "Status",
    any: "Any",
    icon: IconProgress,
    options: Object.entries(statuses).map(([value, status]) => ({
      value,
      label: status.label,
      icon: (glyph: { className?: string | undefined }) => <StatusGlyph status={value} className={glyph.className} />,
    })),
  },
  {
    key: "priority",
    label: "Priority",
    any: "Any",
    icon: IconAntennaBars5,
    options: [
      { value: "none", label: "No priority" },
      ...Object.entries(priorities).map(([value, label]) => ({ value, label })),
    ].map((option) => ({
      value: option.value,
      label: option.label,
      icon: (glyph: { className?: string | undefined }) => (
        <PriorityIcon priority={option.value === "none" ? null : option.value} className={glyph.className} />
      ),
    })),
  },
  {
    key: "agent",
    label: "Agent",
    any: "Any",
    icon: IconAgent,
    options: [
      ...lookups.agents.map((agent) => ({
        value: agent.id,
        label: agent.name,
        icon: IconAgent,
      })),
      {
        value: "none",
        label: "No agent",
        icon: (glyph: { className?: string | undefined }) => (
          <IconAgent className={cn("text-muted-foreground/50", glyph.className)} />
        ),
      },
    ],
  },
  {
    key: "owner",
    label: "Assignee",
    any: "Any",
    icon: IconUserCircle,
    options: [
      { value: "me", label: "Me", icon: IconUserCircle },
      ...lookups.members.map((member) => ({
        value: member.id,
        label: member.name,
        icon: () => <PersonAvatar name={member.name} image={member.image} />,
      })),
      { value: "none", label: "No assignee", icon: UnassignedIcon },
    ],
  },
  {
    key: "label",
    label: "Label",
    any: "Any",
    icon: IconTag,
    options: lookups.labels.map((label) => ({
      value: label.name,
      label: label.name,
      color: labelColor(label.color, label.name),
    })),
  },
  {
    key: "review",
    label: "Review",
    any: "Any",
    icon: IconHandStop,
    single: true,
    options: [
      {
        value: "needed",
        label: "Needs review",
        icon: (glyph: { className?: string | undefined }) => (
          <IconHandStop className={cn("text-chart-3", glyph.className)} />
        ),
      },
    ],
  },
]

export const taskProperties = (lookups: TaskLookups): FilterProperty[] => propertiesFor(lookups)

export const countedTaskProperties = (
  lookups: TaskLookups,
  tasks: ReadonlyArray<Task>,
  userId: string,
): FilterProperty[] =>
  propertiesFor(lookups).map((property) => ({
    key: property.key,
    label: property.label,
    any: property.any,
    icon: property.icon,
    single: property.single,
    options: property.options.map((option) => ({
      value: option.value,
      label: option.label,
      icon: option.icon,
      color: option.color,
      count: tasks.filter((task) => (Tasks.filterValues(task, userId)[property.key] ?? []).includes(option.value))
        .length,
    })),
  }))
