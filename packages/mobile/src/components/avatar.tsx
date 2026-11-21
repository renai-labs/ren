import { Initials } from "@ren/util/initials"
import { cn } from "cn"
import { View } from "react-native"
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg"
import { useCSSVariable } from "uniwind"
import { Text } from "#components/text"

function Avatar(props: { readonly name: string; readonly size?: "sm" | "lg" }) {
  const small = props.size === "sm"
  const large = props.size === "lg"
  const from = useCSSVariable("--color-avatar-from")
  const to = useCSSVariable("--color-avatar-to")
  return (
    <View
      className={cn(
        "items-center justify-center overflow-hidden rounded-full bg-avatar-to",
        small && "size-5",
        large && "size-12",
        !small && !large && "size-8",
      )}
    >
      {typeof from === "string" && typeof to === "string" ? (
        <View className="absolute inset-0">
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="avatar" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={from} />
                <Stop offset="1" stopColor={to} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#avatar)" />
          </Svg>
        </View>
      ) : null}
      <Text
        className={cn(
          "font-semibold text-avatar-foreground",
          small && "text-2xs",
          large && "text-base",
          !small && !large && "text-xs",
        )}
      >
        {Initials.of(props.name)}
      </Text>
    </View>
  )
}

export { Avatar }
