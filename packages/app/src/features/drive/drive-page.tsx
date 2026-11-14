import { Page } from "../../components/page.js"
import { SourceFiles } from "../../components/source-files.js"

export function DrivePage() {
  return (
    <Page title="Drive" description="Files every chat in your organization can read." width="full">
      <SourceFiles
        scope={{ source: "drive" }}
        pins={["spaces", "memory"]}
        empty="Open a file from your organization’s drive to read it here."
      />
    </Page>
  )
}
