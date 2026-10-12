import { BrandMark } from "@ren/ui/brand-mark"
import { Button } from "@ren/ui/button"
import { Auth } from "../../lib/auth.js"
import { Platform } from "../../platform/platform.js"
import { CompleteAuth } from "./complete-auth.js"

export function GoogleButton(props: { destination: CompleteAuth.Destination }) {
  const auth = Auth.useClient()
  const platform = Platform.usePlatform()
  const afterAuth = new URL(CompleteAuth.href({ ...props.destination, join: true }), platform.serverUrl).href
  return (
    <Button
      appearance="secondary"
      size="large"
      width="full"
      leadingIcon={<BrandMark brand="google" />}
      onClick={() =>
        void auth.signIn.social({ provider: "google", callbackURL: afterAuth, newUserCallbackURL: afterAuth })
      }
    >
      Continue with Google
    </Button>
  )
}
