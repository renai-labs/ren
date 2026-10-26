import type { CompleteAuth } from "./complete-auth.js"
import { GitHubButton } from "./github-button.js"
import { GoogleButton } from "./google-button.js"

export function ProviderButtons(props: { destination: CompleteAuth.Destination }) {
  return (
    <div className="flex flex-col gap-2">
      <GoogleButton destination={props.destination} />
      <GitHubButton destination={props.destination} />
    </div>
  )
}
