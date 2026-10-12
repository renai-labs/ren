import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "@ren/ui/button"
import { IconButton } from "@ren/ui/icon-button"
import { Icon } from "@ren/ui/icon"
import { Logotype } from "@ren/ui/logotype"
import { PublicShell } from "@ren/ui/public-shell"
import { Surface } from "@ren/ui/surface"
import { Text } from "@ren/ui/text"

const meta = {
  component: PublicShell.Centered,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-180 w-320 overflow-hidden">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PublicShell.Centered>

export default meta

type Story = StoryObj<typeof meta>

const invitation = (
  <>
    <div className="flex flex-col gap-2">
      <Text purpose="title" alignment="center">
        Join Northwind on Ren
      </Text>
      <Text tone="secondary" alignment="center">
        Ada Lovelace invited you to collaborate on the Northwind workspace.
      </Text>
    </div>
    <Button appearance="primary">Accept invitation</Button>
  </>
)

export const Centered: Story = { render: () => <PublicShell.Centered>{invitation}</PublicShell.Centered> }

export const CenteredUnframed: Story = {
  render: () => (
    <PublicShell.Centered frame="none">
      <Text tone="secondary" element="div" alignment="center">
        Loading invitation…
      </Text>
    </PublicShell.Centered>
  ),
}

export const Status: Story = {
  render: () => (
    <PublicShell.Status
      brand={<Logotype size="large" tone="subdued" />}
      title="404"
      description="We couldn’t find the page you were looking for."
    >
      <Button appearance="primary">Go to homepage</Button>
    </PublicShell.Status>
  ),
}

export const StatusWithoutTransition: Story = {
  render: () => (
    <PublicShell.Status
      transition="none"
      brand={<Logotype size="medium" tone="subdued" activity="loading" label="Loading Ren" />}
      title="Waiting for connection…"
    />
  ),
}

export const Auth: Story = {
  render: () => (
    <PublicShell.Auth
      title="Welcome to Ren"
      description="Self-improving software"
      footer={
        <Text purpose="caption" alignment="center">
          By continuing, you agree to the Terms of Service and Privacy Policy
        </Text>
      }
    >
      <div className="flex flex-col gap-2">
        <Button appearance="primary">Continue with Google</Button>
        <Button>Continue with email</Button>
      </div>
    </PublicShell.Auth>
  ),
}

export const Document: Story = {
  render: () => (
    <PublicShell.Document
      header={
        <>
          <Text purpose="heading" truncation="single-line" element="h1">
            Draft the quarterly report
          </Text>
          <IconButton label="Switch theme">
            <Icon glyph="Moon" />
          </IconButton>
        </>
      }
      footer={
        <div className="flex justify-end">
          <Button appearance="primary">Try it yourself</Button>
        </div>
      }
    >
      <div className="mx-auto flex w-full max-w-content flex-col gap-4 p-6">
        <Surface.Panel padding="medium">
          <Text>Summarise the sales figures for the last quarter.</Text>
        </Surface.Panel>
        <Text>Revenue grew 12% quarter over quarter, led by the enterprise plan.</Text>
      </div>
    </PublicShell.Document>
  ),
}
