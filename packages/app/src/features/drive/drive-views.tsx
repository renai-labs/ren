import { useNavigate } from "@tanstack/react-router"
import { Tabs } from "@ren/ui/tabs"
import { PageTabsList, PageTabsTrigger } from "../../components/page.js"

export function DriveViews(props: { page: "files" | "artifacts"; space: string | undefined }) {
  const navigate = useNavigate()
  return (
    <Tabs
      value={props.page}
      onValueChange={(value: string) => {
        if (value === "artifacts") void navigate({ to: "/drive/artifacts", search: { space: props.space } })
        else void navigate({ to: "/drive", search: { space: props.space } })
      }}
    >
      <PageTabsList>
        <PageTabsTrigger value="files">Files</PageTabsTrigger>
        <PageTabsTrigger value="artifacts">Artifacts</PageTabsTrigger>
      </PageTabsList>
    </Tabs>
  )
}
