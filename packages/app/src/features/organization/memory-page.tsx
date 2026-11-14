import { Page } from "../../components/page.js"
import { SourceFiles } from "../../components/source-files.js"

export function MemorySettingsPage() {
  return (
    <Page title="Memory" description="What every chat in your organization remembers." width="full">
      <SourceFiles
        scope={{ source: "memory" }}
        pins={[]}
        empty="Open a file from your organization’s memory to read it here."
      />
    </Page>
  )
}
