import { useEffect, useState, type ReactNode } from "react"
import { Dimensions, Modal, Pressable, View } from "react-native"
import { GestureDetector, GestureHandlerRootView, usePanGesture } from "react-native-gesture-handler"
import { KeyboardAvoidingView } from "react-native-keyboard-controller"
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { scheduleOnRN } from "react-native-worklets"
import { withUniwind } from "uniwind"

const AvoidingView = withUniwind(KeyboardAvoidingView)
const RootView = withUniwind(GestureHandlerRootView)

function Sheet(props: { readonly open: boolean; readonly onClose: () => void; readonly children: ReactNode }) {
  const open = props.open
  const reduced = useReducedMotion()
  const [mounted, setMounted] = useState(open)
  const [dragging, setDragging] = useState(false)
  const progress = useSharedValue(0)
  const height = useSharedValue(Dimensions.get("window").height)
  if (open && !mounted) setMounted(true)
  useEffect(() => {
    if (dragging) return
    progress.set(
      withTiming(open ? 1 : 0, { duration: open ? 260 : 200, easing: Easing.out(Easing.cubic) }, (finished) => {
        "worklet"
        if (finished === true && !open) scheduleOnRN(setMounted, false)
      }),
    )
  }, [open, dragging, progress])
  const release = (dismiss: boolean) => {
    setDragging(false)
    if (dismiss) props.onClose()
  }
  const pan = usePanGesture({
    enabled: !reduced,
    hitSlop: { bottom: 12 },
    onActivate: () => {
      "worklet"
      scheduleOnRN(setDragging, true)
    },
    onUpdate: (event) => {
      "worklet"
      progress.set(Math.min(1, Math.max(0, progress.get() - event.changeY / height.get())))
    },
    onDeactivate: (event) => {
      "worklet"
      scheduleOnRN(
        release,
        !event.canceled && (event.velocityY > 800 || (event.velocityY > -800 && progress.get() < 0.7)),
      )
    },
  })
  const scrimStyle = useAnimatedStyle(() => {
    "worklet"
    return { opacity: progress.get() }
  })
  const panelStyle = useAnimatedStyle(() => {
    "worklet"
    return {
      opacity: reduced ? progress.get() : 1,
      transform: [{ translateY: reduced ? 0 : (1 - progress.get()) * height.get() }],
    }
  })
  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={props.onClose}
    >
      <RootView className="flex-1">
        <AvoidingView behavior="padding" className="flex-1 justify-end">
          <Animated.View className="absolute inset-0 bg-black/30 dark:bg-black/60" style={scrimStyle}>
            <Pressable className="flex-1" aria-label="Close" onPress={props.onClose} />
          </Animated.View>
          <Animated.View
            aria-modal
            className="max-h-[85%] rounded-t-2xl bg-card pb-safe-offset-2"
            style={panelStyle}
            onLayout={(event) => height.set(event.nativeEvent.layout.height)}
          >
            <GestureDetector gesture={pan}>
              <View className="items-center py-2">
                <View aria-hidden className="h-1 w-9 rounded-full bg-muted-foreground/30" />
              </View>
            </GestureDetector>
            {props.children}
          </Animated.View>
        </AvoidingView>
      </RootView>
    </Modal>
  )
}

export { Sheet }
