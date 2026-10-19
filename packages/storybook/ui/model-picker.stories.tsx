import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { ModelPicker } from "@ren/ui/model-picker"
import type { Selection } from "@ren/ui/model-picker"

const models = [
  {
    value: "anthropic/claude-sonnet",
    label: "Claude Sonnet",
    group: "Anthropic",
    variants: [
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ],
  },
  { value: "anthropic/claude-haiku", label: "Claude Haiku", group: "Anthropic", variants: [] },
  { value: "openai/gpt", label: "GPT", group: "OpenAI", variants: [] },
]

const meta = {
  component: ModelPicker,
  args: {
    models,
    value: { model: "anthropic/claude-haiku" },
    onValueChange: () => undefined,
  },
  render: function Render(args) {
    const [value, setValue] = useState<Selection | undefined>(args.value)
    return (
      <div className="flex flex-col items-start gap-2 pt-60">
        <ModelPicker {...args} value={value} onValueChange={setValue} />
        <output aria-label="Selection">{value ? [value.model, value.variant].filter(Boolean).join(" ") : ""}</output>
      </div>
    )
  },
} satisfies Meta<typeof ModelPicker>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithEffort: Story = { args: { value: { model: "anthropic/claude-sonnet", variant: "high" } } }
export const Loading: Story = { args: { loading: true } }
export const Disabled: Story = { args: { disabled: true } }
