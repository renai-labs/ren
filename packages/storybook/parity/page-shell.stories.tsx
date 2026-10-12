import { PageShell } from "ren-v1/shells/page-shell"
import { Surface } from "../../ui/src/components/surface.js"
import { Text } from "../../ui/src/components/text.js"
import meta from "../../ui/src/components/page-shell.stories.js"

export default { ...meta, title: "Parity/Page Shell", component: PageShell }

export const Settings = {
  args: {
    layout: "settings",
    title: "General",
    subtitle: undefined,
    actions: undefined,
    children: (
      <>
        <PageShell.Section title="Profile" description="How teammates see you across Ren.">
          <Surface.Panel padding="medium">
            <Text>Ada Lovelace</Text>
          </Surface.Panel>
        </PageShell.Section>
        <PageShell.Section title="Security" frame="divided">
          <Text>Password</Text>
          <Text>Two-factor authentication</Text>
        </PageShell.Section>
      </>
    ),
  },
}

export const Record = {
  render: () => (
    <PageShell
      layout="record"
      banner={<Text purpose="heading">Draft the quarterly report</Text>}
      aside={
        <div className="flex flex-col gap-2">
          <Text purpose="label">Status</Text>
          <Text tone="secondary">In progress</Text>
        </div>
      }
    >
      <Text>Summarise revenue, churn and expansion for the last quarter.</Text>
    </PageShell>
  ),
}

export const SectionDivided = {
  render: () => (
    <PageShell title="Account">
      <PageShell.Section title="Devices" description="Where you’re signed in." frame="divided">
        <Text>MacBook Pro · This device</Text>
        <Text>iPhone 17</Text>
      </PageShell.Section>
    </PageShell>
  ),
}

export {
  Collection,
  Detail,
  Workspace,
  Board,
  Untitled,
  WithScope,
  WithNavigation,
} from "../../ui/src/components/page-shell.stories.js"
