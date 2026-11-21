import { cn } from "cn"
import { ScrollView } from "react-native"
import { Text } from "#components/text"

function CodeBlock(props: {
  readonly children: string
  readonly tone?: "destructive" | undefined
  readonly maxHeight?: number
  readonly className?: string
}) {
  const destructive = props.tone === "destructive"
  return (
    <ScrollView
      className={cn(
        "grow-0 rounded-lg border",
        destructive ? "border-destructive/30" : "border-input",
        props.className,
      )}
      style={{ maxHeight: props.maxHeight ?? 256 }}
      contentContainerClassName="p-3"
      nestedScrollEnabled
    >
      <Text selectable className={cn("font-mono text-xs leading-relaxed", destructive && "text-destructive")}>
        {props.children}
      </Text>
    </ScrollView>
  )
}

export { CodeBlock }
