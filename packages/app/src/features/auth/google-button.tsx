import { BrandMark } from "@ren/ui/brand-mark"
import { Button } from "@ren/ui/button"
import { Auth } from "../../lib/auth.js"
import { CompleteAuth } from "./complete-auth.js"

export function GoogleButton(props: { destination: CompleteAuth.Destination }) {
  const auth = Auth.useClient()
  const callbackURL = (href: string) => new URL(href, window.location.origin).href
  const afterAuth = callbackURL(CompleteAuth.href({ ...props.destination, join: true }))
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
