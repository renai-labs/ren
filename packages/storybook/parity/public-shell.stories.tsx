import { Button } from "../../ui/src/components/button.js"
import { IconButton } from "../../ui/src/components/icon-button.js"
import { Icon } from "../../ui/src/components/icon.js"
import { Logotype } from "../../ui/src/components/logotype.js"
import { Surface } from "../../ui/src/components/surface.js"
import { Text } from "../../ui/src/components/text.js"
import { PublicShell } from "ren-v1/shells/public-shell"
import meta from "../../ui/src/components/public-shell.stories.js"

export default { ...meta, title: "Parity/Public Shell", component: PublicShell }

export const Centered = {
  render: () => (
    <PublicShell layout="centered">
      <div className="flex flex-col gap-2">
        <Text purpose="title" alignment="center">
          Join Northwind on Ren
        </Text>
        <Text tone="secondary" alignment="center">
          Ada Lovelace invited you to collaborate on the Northwind workspace.
        </Text>
      </div>
      <Button appearance="primary">Accept invitation</Button>
    </PublicShell>
  ),
}

export const CenteredUnframed = {
  render: () => (
    <PublicShell layout="centered" frame="none">
      <Text tone="secondary" element="div" alignment="center">
        Loading invitation…
      </Text>
    </PublicShell>
  ),
}

export const Status = {
  render: () => (
    <PublicShell
      layout="status"
      brand={<Logotype size="large" tone="subdued" />}
      title="404"
      description="We couldn’t find the page you were looking for."
    >
      <Button appearance="primary">Go to homepage</Button>
    </PublicShell>
  ),
}

export const StatusWithoutTransition = {
  render: () => (
    <PublicShell
      layout="status"
      transition="none"
      brand={<Logotype size="medium" tone="subdued" activity="loading" label="Loading Ren" />}
      title="Waiting for connection…"
    />
  ),
}

export const Auth = {
  render: () => (
    <PublicShell
      layout="auth"
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
    </PublicShell>
  ),
}

export const Document = {
  render: () => (
    <PublicShell
      layout="document"
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
    </PublicShell>
  ),
}
