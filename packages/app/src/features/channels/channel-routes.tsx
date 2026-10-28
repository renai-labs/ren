import type { ChannelInstallInfo, ChannelMappingInfo } from "@ren/client"
import { ConnectionBoard } from "@ren/ui/connection-board"
import { Icon } from "@ren/ui/icon"
import { toast } from "@ren/ui/toast"
import { useState } from "react"
import { Viewport } from "../../platform/viewport.js"
import { ChannelMappingData } from "./channel-mapping-data.js"
import { Channels } from "./channels.js"
import { RouteDialog } from "./route-dialog.js"

interface Route {
  readonly place: { readonly id: string; readonly name: string; readonly anyoneCanWrite: boolean }
  readonly space: { readonly id: string; readonly name: string }
  readonly mapping?: ChannelMappingInfo
}

export function ChannelRoutes(props: { install: ChannelInstallInfo; userId: string }) {
  const provider = Channels.byId[props.install.provider]
  const places = ChannelMappingData.usePlaces(props.install.id, { enabled: true }).data?.items ?? []
  const spaces = ChannelMappingData.useSpaces().data?.items ?? []
  const mappings = ChannelMappingData.useMappings(props.install.id).data?.items ?? []
  const changes = ChannelMappingData.useChanges()
  const [route, setRoute] = useState<Route>()
  const placeById = new Map(places.map((place) => [place.id, place]))
  const spaceById = new Map(spaces.map((space) => [space.id, space]))
  const byPlace = new Map(mappings.map((mapping) => [mapping.place, mapping]))
  const placeOf = (id: string, name: string) => {
    const found = placeById.get(id)
    return { id, name: found?.name ?? name, anyoneCanWrite: found?.anyoneCanWrite ?? false }
  }
  return (
    <>
      <ConnectionBoard
        viewport={Viewport.height}
        sources={places.map((place) => ({ id: place.id, title: place.name }))}
        targets={spaces
          .toSorted((left, right) => left.name.localeCompare(right.name))
          .map((space) => ({ id: space.id, title: space.name }))}
        links={mappings.map((mapping) => ({ sourceId: mapping.place, targetId: mapping.space.id }))}
        onConnect={(place, spaceId) =>
          setRoute({ place: placeOf(place, place), space: { id: spaceId, name: spaceById.get(spaceId)?.name ?? "" } })
        }
        onDisconnect={(place) => {
          const mapping = byPlace.get(place)
          if (mapping) changes.remove(mapping.id)
        }}
        onConfigure={(place) => {
          const mapping = byPlace.get(place)
          if (mapping) setRoute({ place: placeOf(place, mapping.placeName), space: mapping.space, mapping })
        }}
        sourceLabel={provider.board.label}
        sourceNodeIcon={<Icon glyph={provider.board.glyph} />}
        sourceNoun={provider.board.noun}
        targetLabel="Ren space"
        targetNoun="space"
        targetSharing={provider.board.targetSharing}
        busy={changes.pending}
      />
      {route ? (
        <RouteDialog
          key={`${route.place.id}:${route.space.id}`}
          provider={props.install.provider}
          place={route.place}
          space={route.space}
          mapping={route.mapping}
          userId={props.userId}
          busy={changes.creating}
          onSave={(settings) =>
            changes.save({ installId: props.install.id, place: route.place.id, spaceId: route.space.id }, settings, {
              onSuccess: () => {
                toast.add({ type: "success", title: "Connected" })
                setRoute(undefined)
              },
              onError: () => toast.add({ type: "error", title: "Could not connect" }),
            })
          }
          onClose={() => setRoute(undefined)}
        />
      ) : null}
    </>
  )
}
