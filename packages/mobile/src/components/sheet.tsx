import type { ReactNode } from "react"
import { Modal, Pressable, View } from "react-native"
import { KeyboardAvoidingView } from "react-native-keyboard-controller"
import { withUniwind } from "uniwind"

const AvoidingView = withUniwind(KeyboardAvoidingView)

function Sheet(props: { readonly open: boolean; readonly onClose: () => void; readonly children: ReactNode }) {
  return (
    <Modal
      visible={props.open}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={props.onClose}
    >
      <AvoidingView behavior="padding" className="flex-1 justify-end">
        <Pressable className="absolute inset-0 bg-foreground/30" aria-label="Close" onPress={props.onClose} />
        <View aria-modal className="max-h-[85%] rounded-t-2xl bg-card pt-2 pb-safe-offset-2">
          <View aria-hidden className="mb-2 h-1 w-9 self-center rounded-full bg-muted-foreground/30" />
          {props.children}
        </View>
      </AvoidingView>
    </Modal>
  )
}

export { Sheet }
