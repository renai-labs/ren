import { BrandMark } from "@ren/ui/brand-mark"
import { Button } from "@ren/ui/button"
import { Auth } from "../../lib/auth.js"
import { Platform } from "../../platform/platform.js"
import { CompleteAuth } from "./complete-auth.js"

export function GoogleButton(props: { destination: CompleteAuth.Destination }) {
  const auth = Auth.useClient()
  const platform = Platform.usePlatform()
  const afterAuth = `${platform.appUrl}${CompleteAuth.href({ ...props.destination, join: true })}`
  return (
    <Button
      variant="secondary"
      className="h-10 w-full"
      onClick={() =>
        void auth.signIn.social({ provider: "google", callbackURL: afterAuth, newUserCallbackURL: afterAuth })
      }
    >
      <BrandMark brand="google" />
      Continue with Google
    </Button>
  )
}
