import type { Meta, StoryObj } from "@storybook/react-vite"
import { FormSection } from "@ren/ui/form-section"
import { Text } from "@ren/ui/text"

const meta = {
  component: FormSection,
  args: {
    title: "Advanced settings",
    children: <Text>Packages install before the build command runs.</Text>,
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FormSection>

export default meta

type Story = StoryObj<typeof meta>

export const Closed: Story = {}
export const Open: Story = { args: { open: true } }
export const Description: Story = { args: { description: "Packages, build commands, and networking" } }
export const LongDescription: Story = {
  args: {
    description: "Packages, build commands, networking rules, environment variables and the cache policy for every run",
  },
}
