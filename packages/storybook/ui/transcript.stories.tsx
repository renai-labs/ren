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
export const ToolCommandEntering: Story = {
  decorators: inList,
  args: { kind: "command", title: "Running", subtitle: "Writing command…", status: "running", entrance: "animated" },
}
function LiveCommand() {
  const [lines, setLines] = useState(["$ bun test --watch"])
  return (
    <>
      <List.Root>
        <Transcript.Tool kind="command" title="Running" subtitle="bun test --watch" status="running" defaultOpen>
          <Transcript.ToolDetail label="Output" value={lines.join("\n")} appearance="code" follow />
        </Transcript.Tool>
      </List.Root>
      <Button
        onClick={() =>
          setLines((previous) => [
            ...previous,
            ...Array.from({ length: 20 }, (_, index) => `test ${previous.length + index} passed`),
          ])
        }
      >
        Print more
      </Button>
    </>
  )
}

export const ToolCommandLive: Story = { render: () => <LiveCommand /> }

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

const reportHunks: ReadonlyArray<Transcript.DiffHunk> = [
  {
    collapsedBefore: 0,
    lines: [
      { type: "context", text: 'import { revenue } from "./revenue"', oldLine: 1, newLine: 1 },
      { type: "deletion", text: "export const growth = revenue.total * 0.1", oldLine: 2, newLine: undefined },
      { type: "addition", text: "export const growth = revenue.total * 0.12", oldLine: undefined, newLine: 2 },
      { type: "addition", text: "export const churn = 0.024", oldLine: undefined, newLine: 3 },
    ],
  },
  {
    collapsedBefore: 12,
    lines: [{ type: "context", text: "export default growth", oldLine: 15, newLine: 16 }],
  },
]

export const FileChanges: Story = {
  render: () => (
    <Transcript.FileChanges>
      <Transcript.FileChange path="src/report/summary.ts" change="modified" additions={2} deletions={1}>
        <Transcript.Diff file="src/report/summary.ts" hunks={reportHunks} />
      </Transcript.FileChange>
      <Transcript.FileChange path="src/report/churn.ts" change="created" additions={1} deletions={0}>
        <Transcript.Diff
          file="src/report/churn.ts"
          hunks={[
            {
              collapsedBefore: 0,
              lines: [{ type: "addition", text: "export const churn = 0.024", oldLine: undefined, newLine: 1 }],
            },
          ]}
        />
      </Transcript.FileChange>
      <Transcript.FileChange path="src/report/legacy.ts" change="deleted" additions={0} deletions={3} />
    </Transcript.FileChanges>
  ),
}

export const Subagent: Story = {
  decorators: inList,
  render: () => (
    <Transcript.Subagent
      title="Explore"
      description="Find where revenue is computed"
      status="completed"
      tools={4}
      onOpen={() => undefined}
    />
  ),
}
export const SubagentRunning: Story = {
  decorators: inList,
  render: () => (
    <Transcript.Subagent
      title="Explore"
      description="Find where revenue is computed"
      status="running"
      background
      needsInput
      tools={1}
      activity="grep revenue"
      onOpen={() => undefined}
    />
  ),
}
export const SubagentDenied: Story = {
  decorators: inList,
  render: () => (
    <Transcript.Subagent
      title="Explore"
      description="Find where revenue is computed"
      status="denied"
      failure="Subagent denied: explore"
      onOpen={() => undefined}
    />
  ),
}
export const SubagentRetrying: Story = {
  decorators: inList,
  render: () => (
    <Transcript.Subagent
      title="Explore"
      description="Find where revenue is computed"
      status="running"
      retry="The provider is rate limiting requests"
      tools={2}
      onOpen={() => undefined}
    />
  ),
}

export const Links: Story = {
  render: () => (
    <Transcript.Links
      label="Search results"
      links={Array.from({ length: 12 }, (_, index) => `https://docs.example.com/revenue/${index + 1}`)}
    />
  ),
}

export const Answers: Story = {
  render: () => (
    <Transcript.Answers
      items={[
        { question: "Which package manager should the new workspace use?", answer: "Bun" },
        { question: "Which checks should run before each commit?", answer: "Lint, Typecheck" },
      ]}
    />
  ),
}

export const ResponseWithLinks: Story = {
  render: () => (
    <Transcript.Response
      content="The subagent ses_01JZ8Q3RVK7M2N4P6S8T0W2Y4A finished. The docs live at `https://docs.example.com/revenue`."
      streaming={false}
      onOpenSession={() => undefined}
    />
  ),
}

export const UserText: Story = {
  render: () => (
    <Transcript.UserText
      text="Ask @review to check @src/report/summary.ts before Friday"
      highlights={[
        { start: 4, end: 11 },
        { start: 21, end: 43 },
      ]}
    />
  ),
}
