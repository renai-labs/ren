import type { Meta, StoryObj } from "@storybook/react-vite"
import { Time } from "@ren/ui/time"

const meta = {
  component: Time,
  args: { value: "2026-03-05T14:30:00Z", format: "date" },
} satisfies Meta<typeof Time>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const ShortDate: Story = { args: { format: "short-date" } }
export const DateTime: Story = { args: { format: "date-time" } }
export const DateTimeInZone: Story = { args: { format: "date-time", timeZone: "Asia/Kolkata" } }
export const DateTimeInUnknownZone: Story = { args: { format: "date-time", timeZone: "Mars/Olympus" } }
export const TimeOfDay: Story = { args: { format: "time-of-day" } }
export const TimeOfDayInZone: Story = { args: { format: "time-of-day", timeZone: "Asia/Kolkata" } }
export const Relative: Story = { args: { format: "relative", value: "2019-03-05T14:30:00Z" } }
export const RelativeNarrow: Story = {
  args: { format: "relative", value: "2019-03-05T14:30:00Z", relativeStyle: "narrow" },
}
export const Elapsed: Story = { args: { format: "elapsed", value: "2019-03-05T14:30:00Z" } }
export const Invalid: Story = { args: { value: "not a date" } }
