export * as Invalidation from "./invalidation.js"

const groups: Readonly<Record<string, ReadonlyArray<string>>> = {
  agent: ["agent", "space", "schedule", "webhook"],
  app: ["app", "onboarding"],
  space: ["space", "onboarding"],
  task: ["task", "task-activity", "label", "link"],
  "task-comment": ["task-activity"],
  "space-member": ["space-member", "space"],
  "space-join-request": ["space-join-request", "space-member", "space"],
  "app-profile": ["app-profile", "app-profile-reach", "app"],
  "app-profile-reach": ["app-profile", "app-profile-reach", "app"],
  credential: ["credential", "app-profile", "app-profile-reach"],
  "credential-connect": ["app-profile", "app-profile-reach"],
  schedule: ["schedule", "schedule-run", "onboarding"],
  webhook: ["webhook", "webhook-request", "onboarding"],
  "channel-mapping": ["channel-mapping", "channel-connect"],
  "channel-install": ["channel-install", "channel-mapping", "channel-connect"],
  chat: [],
  me: [],
  memory: ["memory", "files"],
  files: ["files", "memory"],
}

export const affected = (group: string) => groups[group] ?? [group]
