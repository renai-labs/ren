import type { Meta, StoryObj } from "@storybook/react-vite"
import { MarkdownEditor } from "@ren/ui/markdown-editor"
import { useState } from "react"

const meta = {
  component: MarkdownEditor,
  args: {
    label: "Description",
    value: "## Migration plan\n\nKeep **rollback** available.\n\n- Back up the database\n- Verify the deployment",
    onChange: () => undefined,
  },
  render: function Render(args) {
    const [value, setValue] = useState(args.value)
    return <MarkdownEditor {...args} value={value} onChange={setValue} />
  },
} satisfies Meta<typeof MarkdownEditor>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Empty: Story = { args: { value: "" } }
export const ReadOnly: Story = { args: { readOnly: true } }
export const Placeholder: Story = {
  args: { value: "", placeholder: "Sign-in fails after the 2.4 upgrade when SSO is on" },
}
export const CodeBlock: Story = {
  args: {
    value:
      "Run the migration with `bun run migrate`.\n\n```bash\nbun run migrate --dry-run\nbun run migrate\n```\n\n### Rollback\n\nRestore the backup taken before the run.",
  },
}
