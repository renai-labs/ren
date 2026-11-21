import { setStringAsync } from "expo-clipboard"
import { useState } from "react"
import CheckIcon from "react-native-heroicons/mini/CheckIcon"
import DocumentDuplicateIcon from "react-native-heroicons/mini/DocumentDuplicateIcon"
import { Button } from "#components/button"
import { Icon } from "#components/icon"

function useCopy() {
  const [copied, setCopied] = useState(false)
  return {
    copied,
    copy: (text: string) =>
      void setStringAsync(text).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }),
  }
}

function CopyButton(props: { readonly text: string }) {
  const clipboard = useCopy()
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={clipboard.copied ? "Copied" : "Copy"}
      onPress={() => clipboard.copy(props.text)}
    >
      <Icon as={clipboard.copied ? CheckIcon : DocumentDuplicateIcon} className="size-4 text-muted-foreground" />
    </Button>
  )
}

export { CopyButton, useCopy }
