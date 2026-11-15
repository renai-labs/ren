import { ErrorText } from "@ren/util/error-text"
import type { QueryObserverBaseResult } from "@tanstack/react-query"
import { ActivityIndicator, View } from "react-native"
import { Button } from "#components/button"
import { Text } from "#components/text"

function QueryStatus(props: {
  readonly result: Pick<QueryObserverBaseResult, "isPending" | "fetchStatus" | "error" | "data">
  readonly offline: string
  readonly failure: string
  readonly onRetry: () => void
}) {
  const result = props.result
  if (result.isPending && result.fetchStatus === "paused")
    return <Text className="p-6 text-center text-muted-foreground">{props.offline}</Text>
  if (result.isPending) return <ActivityIndicator className="mt-8" />
  if (!result.error || result.data) return null
  return (
    <View className="items-center gap-3 p-6">
      <Text className="text-center font-medium">{props.failure}</Text>
      <Text className="text-center text-sm text-muted-foreground">
        {ErrorText.of(result.error, "Check your connection and try again.")}
      </Text>
      <Button variant="outline" onPress={props.onRetry}>
        <Text>Try again</Text>
      </Button>
    </View>
  )
}

export { QueryStatus }
