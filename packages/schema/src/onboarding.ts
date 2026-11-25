export * as Onboarding from "./onboarding.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"

export const ID = Identifier.make("onb", "Onboarding.ID")
export type ID = typeof ID.Type

export const steps = {
  organization: {
    slackConnected: "slack.connected",
    githubConnected: "github.connected",
    memberJoined: "member.joined",
    artifactCreated: "artifact.created",
    scheduleCreated: "schedule.created",
    webhookCreated: "webhook.created",
    factoryCreated: "factory.created",
    customAppCreated: "custom-app.created",
    iacApplied: "iac.applied",
  },
  personal: {
    githubStarred: "github.starred",
    gmailConnected: "gmail.connected",
    granolaConnected: "granola.connected",
    githubAppConnected: "github.app.connected",
    driveConnected: "drive.connected",
    appsConnected: "apps.connected",
    memoryImported: "memory.imported",
  },
} as const

export const appSteps = {
  gmail: steps.personal.gmailConnected,
  granola: steps.personal.granolaConnected,
  github: steps.personal.githubAppConnected,
  "google-drive": steps.personal.driveConnected,
} as const satisfies Readonly<Record<string, string>>

export const appsNeeded = 3

export const OrganizationStep = Schema.Literals(Object.values(steps.organization)).annotate({
  identifier: "Onboarding.OrganizationStep",
  description: "An action that counts toward the organization’s onboarding, in the order the checklist shows it.",
})
export type OrganizationStep = typeof OrganizationStep.Type

export const PersonalStep = Schema.Literals(Object.values(steps.personal)).annotate({
  identifier: "Onboarding.PersonalStep",
  description: "An action that counts toward a person’s own onboarding in the organization, in checklist order.",
})
export type PersonalStep = typeof PersonalStep.Type

export const Step = Schema.Union([OrganizationStep, PersonalStep]).annotate({ identifier: "Onboarding.Step" })
export type Step = typeof Step.Type

export const ChecklistKind = Schema.Literals(["organization", "personal"]).annotate({
  identifier: "Onboarding.ChecklistKind",
})
export type ChecklistKind = typeof ChecklistKind.Type

export interface StepState extends Schema.Schema.Type<typeof StepState> {}
export const StepState = Schema.Struct({
  step: Step,
  completedAt: Schema.NullOr(Schema.DateTimeUtc).annotate({ description: "Null while the step is not done." }),
}).annotate({ identifier: "Onboarding.StepState" })

export interface Checklist extends Schema.Schema.Type<typeof Checklist> {}
export const Checklist = Schema.Struct({
  steps: Schema.Array(StepState).annotate({ description: "Every step of the checklist, in order." }),
  dismissedAt: Schema.NullOr(Schema.DateTimeUtc).annotate({ description: "When the checklist was hidden." }),
}).annotate({ identifier: "Onboarding.Checklist" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  organization: Checklist.annotate({
    description: "The organization’s checklist. Hiding it hides it for every member.",
  }),
  personal: Checklist.annotate({ description: "The caller’s own checklist in the organization." }),
}).annotate({ identifier: "Onboarding.Info", description: "The caller’s onboarding checklists." })

export const ReportedStep = Schema.Literals([steps.personal.githubStarred, steps.personal.memoryImported]).annotate({
  identifier: "Onboarding.ReportedStep",
  description: "A personal step the app marks done when the person does it. It pays no reward.",
})
export type ReportedStep = typeof ReportedStep.Type

export interface CompleteInput extends Schema.Schema.Type<typeof CompleteInput> {}
export const CompleteInput = Schema.Struct({ step: ReportedStep }).annotate({
  identifier: "Onboarding.CompleteInput",
})

export interface DismissInput extends Schema.Schema.Type<typeof DismissInput> {}
export const DismissInput = Schema.Struct({ checklist: ChecklistKind }).annotate({
  identifier: "Onboarding.DismissInput",
})
