import type { AgentInfo, LabelInfo, SpaceInfo, TaskInfo } from "@ren/client"
import { IconAntennaBars5, IconCube, IconEye, IconProgress, IconTag, IconUsers } from "@tabler/icons-react"
import { Tasks } from "@ren/client/react"
import { IconAgent } from "../../icons/heroicons.js"
import type { FilterProperty } from "../../components/filter-menu.js"
import { PriorityIcon, StatusGlyph, priorities, statuses } from "../../components/task-meta.js"
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
    options: lookups.spaces.map((space) => ({
      value: space.id,
      label: space.name,
    })),
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
      ...lookups.agents.map((agent) => ({ value: agent.id, label: agent.name })),
      { value: "none", label: "No agent" },
    ],
  },
  {
    key: "owner",
    label: "Owner",
    any: "Any",
    icon: IconUsers,
    options: [
      { value: "me", label: "Me" },
      ...lookups.members.map((member) => ({ value: member.id, label: member.name })),
      { value: "none", label: "No owner" },
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
    })),
  },
  {
    key: "review",
    label: "Review",
    any: "Any",
    icon: IconEye,
    single: true,
    options: [{ value: "needed", label: "Needs review" }],
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
      count: tasks.filter((task) => (Tasks.filterValues(task, userId)[property.key] ?? []).includes(option.value))
        .length,
    })),
  }))
