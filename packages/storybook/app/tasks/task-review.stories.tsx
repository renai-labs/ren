import type { Meta, StoryObj } from "@storybook/react-vite"
import { Text } from "@ren/ui/text"
import { useState } from "react"
import type { ComponentProps } from "react"
import { ReviewDecisionForm } from "../../../app/src/features/tasks/task-review.js"

function ReviewExample(props: { decision: "approved" | "changes_requested" }) {
  const [result, setResult] = useState<Parameters<ComponentProps<typeof ReviewDecisionForm>["onSubmit"]>[0] | null>(
    null,
  )
  if (result)
    return (
      <Text purpose="body">
        {result.decision === "approved" ? "Approved" : "Changes requested"}
        {" · "}
        {result.start ?? "Default continuation"}
        {result.comment && ` · ${result.comment}`}
      </Text>
    )
  return (
    <ReviewDecisionForm
      decision={props.decision}
      onSubmit={async (input) => {
        setResult(input)
      }}
      onCancel={() => undefined}
    />
  )
}

const meta = { component: ReviewExample, args: { decision: "approved" } } satisfies Meta<typeof ReviewExample>
export default meta
type Story = StoryObj<typeof meta>

export const Approve: Story = { render: () => <ReviewExample decision="approved" /> }
export const RequestChanges: Story = { render: () => <ReviewExample decision="changes_requested" /> }
