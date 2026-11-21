import { cn } from "cn"
import { useState } from "react"
import { Image, View } from "react-native"
import { Text } from "#components/text"

const glyph = /lucide-static|\/skill-icons\/|@tabler\/icons|\/heroicons@|\.svg(\?|$)/u

function AppIcon(props: {
  readonly name: string
  readonly icon: string | null | undefined
  readonly className?: string
}) {
  const [failed, setFailed] = useState<string>()
  const icon = props.icon && props.icon !== failed && !glyph.test(props.icon) ? props.icon : undefined
  return (
    <View
      className={cn(
        "size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted",
        props.className,
      )}
    >
      {icon ? (
        <Image
          source={{ uri: icon }}
          accessibilityIgnoresInvertColors
          className="size-full"
          resizeMode="cover"
          onError={() => setFailed(icon)}
        />
      ) : (
        <Text className="font-semibold text-muted-foreground">{props.name.slice(0, 1).toUpperCase()}</Text>
      )}
    </View>
  )
}

export { AppIcon }
