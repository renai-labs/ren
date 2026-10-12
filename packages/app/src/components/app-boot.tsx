import { Logotype } from "@ren/ui/logotype"
import { PublicShell } from "@ren/ui/public-shell"

export function AppBoot() {
  return (
    <PublicShell.Status brand={<Logotype size="medium" tone="subdued" activity="loading" label="Loading Ren…" />} />
  )
}
