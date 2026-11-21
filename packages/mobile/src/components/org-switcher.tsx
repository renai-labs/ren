import { ChatReact } from "@ren/chat/react"
import { ErrorText } from "@ren/util/error-text"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, Pressable, ScrollView } from "react-native"
import CheckIcon from "react-native-heroicons/mini/CheckIcon"
import ChevronUpDownIcon from "react-native-heroicons/mini/ChevronUpDownIcon"
import { Avatar } from "#components/avatar"
import { Icon } from "#components/icon"
import { Sheet } from "#components/sheet"
import { Text } from "#components/text"
import { Api } from "#lib/api"
import { Auth } from "#lib/auth"

function OrgSwitcher() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState<string>()
  const [error, setError] = useState("")
  const current = useQuery(Api.query.me.get.queryOptions()).data?.organization
  const organizations = useQuery({ ...Auth.organizationsOptions, enabled: open })
  const listed = organizations.data ?? []
  const all = !current || listed.some((each) => each.id === current.id) ? listed : [current, ...listed]

  const switchTo = async (organizationId: string) => {
    if (organizationId === current?.id || switching) return
    setSwitching(organizationId)
    setError("")
    const result = await Auth.client.organization.setActive({ organizationId })
    if (result.error) {
      setSwitching(undefined)
      setError(result.error.message ?? `Couldn’t switch organization (${result.error.status}). Try again.`)
      return
    }
    ChatReact.forget()
    await Auth.refreshSession(queryClient)
    setSwitching(undefined)
    setOpen(false)
    router.navigate("/")
  }

  return (
    <>
      <Pressable
        role="button"
        aria-label={`Organization: ${current?.name ?? "none"}`}
        className="min-h-12 flex-row items-center gap-3 px-4 py-3 active:bg-accent"
        onPress={() => setOpen(true)}
      >
        <Text className="flex-1">Organization</Text>
        <Text className="shrink text-muted-foreground" numberOfLines={1}>
          {current?.name ?? ""}
        </Text>
        <Icon as={ChevronUpDownIcon} className="size-4.5 text-muted-foreground" />
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)}>
        <Text role="heading" aria-level={2} className="px-5 pb-2 text-base font-semibold">
          Organizations
        </Text>
        {organizations.isPending ? (
          <ActivityIndicator colorClassName="accent-muted-foreground" className="py-6" />
        ) : null}
        {organizations.isError ? (
          <Text className="px-5 py-3 text-sm text-destructive">
            {ErrorText.of(organizations.error, "Couldn’t load your organizations.")}
          </Text>
        ) : null}
        <ScrollView role="radiogroup">
          {all.map((organization) => (
            <Pressable
              key={organization.id}
              role="radio"
              aria-checked={organization.id === current?.id}
              className="min-h-12 flex-row items-center gap-3 px-5 py-2.5 active:bg-accent"
              onPress={() => void switchTo(organization.id)}
            >
              <Avatar name={organization.name} />
              <Text className="flex-1" numberOfLines={1}>
                {organization.name}
              </Text>
              {switching === organization.id ? (
                <ActivityIndicator size="small" colorClassName="accent-muted-foreground" />
              ) : null}
              {organization.id === current?.id ? <Icon as={CheckIcon} className="size-4.5" /> : null}
            </Pressable>
          ))}
        </ScrollView>
        {error ? <Text className="px-5 pt-2 text-sm text-destructive">{error}</Text> : null}
      </Sheet>
    </>
  )
}

export { OrgSwitcher }
