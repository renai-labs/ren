import type { CompleteAuth } from "./complete-auth.js"
import { GoogleButton } from "./google-button.js"
import { SocialButton } from "./social-button.js"

export function ProviderButtons(props: { destination: CompleteAuth.Destination }) {
  return (
    <div className="flex flex-col gap-2">
      <GoogleButton destination={props.destination} />
      <SocialButton provider="github" destination={props.destination} />
      <SocialButton provider="slack" destination={props.destination} />
    </div>
  )
}
