import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Button } from "@ren/ui/button"
import { List } from "@ren/ui/list"
import { Transcript } from "@ren/ui/transcript"

const answer = `The report is ready. Revenue grew **12%** this quarter, led by the enterprise plan.

- Churn fell from 3.1% to 2.4%
- Expansion revenue doubled in the EMEA region`

const reasoning = `**Checking the revenue sources**

The finance export has one row per invoice, so I can group by plan and quarter before comparing totals.`

const meta = {
  component: Transcript.Tool,
  args: {
    kind: "file",
    title: "Read",
    subtitle: "revenue.csv",
    status: "completed",
    children: (
      <>
        <Transcript.ToolDetail label="Input" value={JSON.stringify({ filePath: "/data/revenue.csv" }, null, 2)} />
        <Transcript.ToolDetail label="Output" value={"plan,quarter,revenue\nenterprise,Q3,1200000"} />
      </>
    ),
  },
} satisfies Meta<typeof Transcript.Tool>

export default meta

type Story = StoryObj<typeof meta>

const inList: Story["decorators"] = [
  (Story) => (
    <List.Root>
      <Story />
    </List.Root>
  ),
]

export const Tool: Story = { decorators: inList }
export const ToolRunning: Story = {
  decorators: inList,
  args: { title: "Reading", status: "running" },
}
export const ToolFailed: Story = {
  decorators: inList,
  args: {
    title: "Reading",
    status: "failed",
    failure: "File not found",
    children: <Transcript.ToolDetail label="Error" value="File not found: /data/revenue.csv" />,
  },
}
export const ToolCommand: Story = {
  decorators: inList,
  args: {
    kind: "command",
    title: "Ran",
    subtitle: "bun test src/report",
    defaultOpen: true,
    children: (
      <>
        <Transcript.ToolDetail label="Input" value="bun test src/report" appearance="code" />
        <Transcript.ToolDetail label="Output" value={"12 pass\n0 fail"} appearance="code" />
      </>
    ),
  },
}
export const ToolUnknown: Story = {
  decorators: inList,
  args: { kind: "tool", title: "Linear search", subtitle: "open bugs" },
}

export const ToolGroup: Story = {
  decorators: inList,
  render: () => (
    <Transcript.ToolGroup title="Used 2 Read and Grep" working={false}>
      <Transcript.Tool kind="file" title="Read" subtitle="revenue.csv" status="completed">
        <Transcript.ToolDetail label="Output" value="plan,quarter,revenue" />
      </Transcript.Tool>
      <Transcript.Tool kind="search" title="Searched" subtitle="src" status="completed">
        <Transcript.ToolDetail label="Output" value="src/report.ts" />
      </Transcript.Tool>
    </Transcript.ToolGroup>
  ),
}
export const ToolGroupWorking: Story = {
  decorators: inList,
  render: () => (
    <Transcript.ToolGroup title="Used 1 Grep" working>
      <Transcript.Tool kind="search" title="Searching" subtitle="src" status="running">
        <Transcript.ToolDetail label="Input" value={JSON.stringify({ pattern: "revenue" }, null, 2)} />
      </Transcript.Tool>
    </Transcript.ToolGroup>
  ),
}

export const Reasoning: Story = {
  decorators: inList,
  render: () => <Transcript.Reasoning content={reasoning} streaming={false} duration="4s" />,
}
export const ReasoningStreaming: Story = {
  decorators: inList,
  render: () => <Transcript.Reasoning content={reasoning} streaming heading="Checking the revenue sources" />,
}

export const Response: Story = {
  render: () => <Transcript.Response content={answer} streaming={false} />,
}

function StreamingResponse() {
  const [content, setContent] = useState("The report is ready.")
  const [streaming, setStreaming] = useState(true)
  return (
    <>
      <Transcript.Response content={content} streaming={streaming} />
      <Button onClick={() => setContent(answer)}>Stream the rest</Button>
      <Button onClick={() => setStreaming(false)}>Finish</Button>
    </>
  )
}

export const ResponseStreaming: Story = { render: () => <StreamingResponse /> }

export const Working: Story = { render: () => <Transcript.Working /> }

export const Retry: Story = {
  render: () => (
    <Transcript.Retry attempt={2} message="The model provider is overloaded" next={Date.UTC(2026, 0, 1, 12, 0, 10)} />
  ),
}
