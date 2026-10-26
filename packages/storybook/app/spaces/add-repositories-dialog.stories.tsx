import type { Meta, StoryObj } from "@storybook/react-vite"
import type { Reference } from "@ren/schema/reference"
import { Button } from "@ren/ui/button"
import { Text } from "@ren/ui/text"
import { useState } from "react"
import { AddRepositoriesDialog } from "../../../app/src/features/spaces/add-repositories-dialog.js"
import type { Places } from "../../../app/src/features/spaces/add-repositories-dialog.js"

const installed: Places = {
  kind: "installed",
  state: "ready",
  items: [
    { url: "https://github.com/acme/docs", name: "acme/docs" },
    { url: "https://github.com/acme/secret", name: "acme/secret" },
    { url: "https://github.com/acme/web", name: "acme/web", description: "The marketing site" },
  ],
}

const notInstalled: Places = {
  kind: "not-installed",
  install: (
    <Button appearance="secondary" size="small">
      Install GitHub App
    </Button>
  ),
}

// oxlint-disable-next-line ren/no-comments -- Stands in for PATCH /space-settings: Ren refuses acme/secret as it refuses a repository the installation cannot read (R13).
function AddRepositoriesExample(props: { places: Places }) {
  const [saved, setSaved] = useState<ReadonlyArray<Reference.Info>>()
  if (saved) return <Text purpose="body">{`Saved ${saved.map((each) => each.alias).join(", ")}`}</Text>
  return (
    <>
      <Text purpose="body">Repositories of the Acme space</Text>
      <AddRepositoriesDialog
        places={props.places}
        existing={[]}
        onClose={() => undefined}
        onSave={async (added) => {
          const secret = added.find((each) => each.repository === "https://github.com/acme/secret")
          if (secret)
            throw Object.assign(
              new Error(
                "the GitHub App cannot read acme/secret: add the repository to the installation, or acme/secret does not exist",
              ),
              { _tag: "InvalidRequestError", field: `references.${secret.alias}` },
            )
          setSaved(added)
        }}
      />
    </>
  )
}

const meta = { component: AddRepositoriesExample, args: { places: installed } } satisfies Meta<
  typeof AddRepositoriesExample
>
export default meta
type Story = StoryObj<typeof meta>

export const Installed: Story = {}
export const NotInstalled: Story = { args: { places: notInstalled } }
