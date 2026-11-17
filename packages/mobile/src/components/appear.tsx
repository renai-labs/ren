import type { ReactNode } from "react"
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated"
import { withUniwind } from "uniwind"

const StyledView = withUniwind(Animated.View)

const ease = Easing.out(Easing.cubic)

const rise = FadeInDown.duration(240).easing(ease)

const fade = FadeIn.duration(200).easing(ease)

const leave = FadeOut.duration(160)

const move = LinearTransition.duration(220).easing(ease)

function Appear(props: { readonly className: string; readonly rise?: boolean; readonly children: ReactNode }) {
  return (
    <StyledView className={props.className} entering={props.rise === false ? fade : rise} exiting={leave} layout={move}>
      {props.children}
    </StyledView>
  )
}

function Morph(props: { readonly className: string; readonly children: ReactNode }) {
  return (
    <StyledView className={props.className} layout={move}>
      {props.children}
    </StyledView>
  )
}

export { Appear, Morph }
