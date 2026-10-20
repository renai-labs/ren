import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Button } from "@ren/ui/button"
import { Notice } from "@ren/ui/notice"
import { Questionnaire } from "@ren/ui/questionnaire"
import type { QuestionnaireProgress, QuestionnaireQuestion } from "@ren/ui/questionnaire"

const permission: QuestionnaireQuestion = {
  name: "permission",
  title: "Allow Ren to run this command?",
  detail: "bun run --cwd packages/storybook test -- ui/questionnaire.spec.ts",
  required: true,
  choices: [
    { value: "Allow once", label: "Allow once" },
    { value: "Always allow", label: "Always allow", description: "Don’t ask again for bun run *" },
    { value: "Deny", label: "Deny" },
  ],
  customAnswer: {
    name: "instructions",
    label: "Deny and tell Ren what to do instead",
    placeholder: "Deny and tell Ren what to do instead…",
  },
}

const customAnswer = { label: "Type your own answer", placeholder: "Something else…" }

const questions: ReadonlyArray<QuestionnaireQuestion> = [
  {
    name: "q0",
    title: "Which package manager should the new workspace use?",
    choices: [
      { value: "Bun", label: "Bun", description: "Matches the rest of the monorepo." },
      { value: "pnpm", label: "pnpm", description: "Strict, content-addressed installs." },
      { value: "npm", label: "npm" },
    ],
    customAnswer,
  },
  {
    name: "q1",
    title: "Which checks should run before each commit?",
    multiple: true,
    choices: [
      { value: "Lint", label: "Lint" },
      { value: "Typecheck", label: "Typecheck" },
      { value: "Unit tests", label: "Unit tests", description: "Adds about 40 seconds to each commit." },
    ],
    customAnswer,
  },
]

const meta = {
  component: Questionnaire,
  args: { questions: [permission], onSubmit: () => undefined },
  render: function Render(args) {
    const [answers, setAnswers] = useState<ReadonlyArray<string>>()
    return (
      <div className="flex w-120 flex-col gap-4">
        <Questionnaire
          {...args}
          onSubmit={(data) =>
            setAnswers(
              [...data.entries()].flatMap((entry) =>
                typeof entry[1] === "string" ? [`${entry[0]}: ${entry[1]}`] : [],
              ),
            )
          }
        />
        {answers === undefined ? null : <Notice title="Answer sent">{answers.join(", ")}</Notice>}
      </div>
    )
  },
} satisfies Meta<typeof Questionnaire>

export default meta

type Story = StoryObj<typeof meta>

export const Permission: Story = { args: { submitLabel: "Continue" } }
export const MultiStep: Story = { args: { questions } }
export const Pending: Story = { args: { submitLabel: "Continue", pending: true } }
export const LeadingAction: Story = {
  args: {
    questions,
    leadingAction: (
      <Button appearance="plain" size="small">
        Dismiss
      </Button>
    ),
  },
}

function DismissibleQuestionnaire() {
  const [dismissed, setDismissed] = useState(false)
  return (
    <div className="flex w-120 flex-col gap-4">
      <Questionnaire
        questions={questions}
        onSubmit={() => undefined}
        onDismiss={() => setDismissed(true)}
        collapsible
      />
      {dismissed ? <Notice title="Dismissed">The question was dismissed.</Notice> : null}
    </div>
  )
}

export const Dismissible: Story = { render: () => <DismissibleQuestionnaire /> }

function SavedQuestionnaire() {
  const [saved, setSaved] = useState<QuestionnaireProgress>()
  return (
    <div className="flex w-120 flex-col gap-4">
      <Questionnaire
        questions={questions}
        onSubmit={() => undefined}
        progress={{
          step: 1,
          answers: {
            q0: { choices: ["Bun"], custom: "", skipped: false },
            q1: { choices: ["Lint"], custom: "", skipped: false },
          },
        }}
        onProgressChange={setSaved}
      />
      {saved === undefined ? null : (
        <Notice title="Saved">
          {`Step ${saved.step + 1}: ${Object.entries(saved.answers)
            .map((entry) => `${entry[0]} ${entry[1].choices.join(", ")}`)
            .join(", ")}`}
        </Notice>
      )}
    </div>
  )
}

export const SavedProgress: Story = { render: () => <SavedQuestionnaire /> }
