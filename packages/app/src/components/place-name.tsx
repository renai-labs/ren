import { Channels } from "../lib/channels.js"

export function PlaceName(props: { provider: Channels.Provider; name: string }) {
  const slash = props.name.lastIndexOf("/")
  if (props.provider === "github" && slash > 0)
    return (
      <>
        <span className="text-muted-foreground">{props.name.slice(0, slash + 1)}</span>
        {props.name.slice(slash + 1)}
      </>
    )
  return <>{Channels.label(props.provider, props.name)}</>
}
