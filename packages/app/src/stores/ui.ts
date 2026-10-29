import type { SessionModel } from "@ren/schema/session/model"
import { create } from "zustand"
import { persist } from "zustand/middleware"

export type TaskDisplay = {
  layout: string
  groupBy: string
  orderBy: string
  direction: string
  showEmpty: boolean
  properties: string[]
}

export type ChatDetail = "compact" | "detailed"

export type FollowUp = "steer" | "queue"

export type Theme = "system" | "light" | "dark"

export type ModelPickerLook = "classic" | "gumloop" | "plane" | "split" | "cursor"

interface Ui {
  readonly taskDisplay: TaskDisplay
  readonly chatDetail: ChatDetail
  readonly notify: boolean
  readonly followUp: FollowUp
  readonly model: SessionModel.Ref | null
  readonly homeSpaceId: string | null
  readonly newTask: { readonly spaceId?: string } | null
  readonly searchOpen: boolean
  readonly theme: Theme
  readonly modelPickerLook: ModelPickerLook
}

const initial: Ui = {
  taskDisplay: {
    layout: "list",
    groupBy: "space",
    orderBy: "created",
    direction: "desc",
    showEmpty: false,
    properties: ["status", "priority", "assignee", "labels"],
  },
  chatDetail: "compact",
  notify: true,
  followUp: "steer",
  model: null,
  homeSpaceId: null,
  newTask: null,
  searchOpen: false,
  theme: "dark",
  modelPickerLook: "classic",
}

const useUi = create<Ui>()(
  persist(() => initial, {
    name: "ren.ui",
    version: 3,
    migrate: () => initial,
    partialize: (state) => ({
      taskDisplay: state.taskDisplay,
      chatDetail: state.chatDetail,
      notify: state.notify,
      followUp: state.followUp,
      model: state.model,
      homeSpaceId: state.homeSpaceId,
      theme: state.theme,
      modelPickerLook: state.modelPickerLook,
    }),
  }),
)

export const useTaskDisplay = () => useUi((state) => state.taskDisplay)
export const useChatDetail = () => useUi((state) => state.chatDetail)
export const useNotify = () => useUi((state) => state.notify)
export const readNotify = () => useUi.getState().notify
export const useFollowUp = () => useUi((state) => state.followUp)
export const useChosenModel = () => useUi((state) => state.model)
export const useHomeSpaceId = () => useUi((state) => state.homeSpaceId)
export const useNewTask = () => useUi((state) => state.newTask)
export const useSearchOpen = () => useUi((state) => state.searchOpen)
export const useTheme = () => useUi((state) => state.theme)
export const useModelPickerLook = () => useUi((state) => state.modelPickerLook)

export const changeTaskDisplay = (taskDisplay: TaskDisplay) => useUi.setState({ taskDisplay })

export const chooseChatDetail = (chatDetail: ChatDetail) => useUi.setState({ chatDetail })
export const chooseFollowUp = (followUp: FollowUp) => useUi.setState({ followUp })
export const chooseNotify = (notify: boolean) => useUi.setState({ notify })
export const chooseModel = (model: SessionModel.Ref | null) => useUi.setState({ model })
export const chooseHomeSpace = (homeSpaceId: string) => useUi.setState({ homeSpaceId })
export const chooseTheme = (theme: Theme) => useUi.setState({ theme })
export const chooseModelPickerLook = (modelPickerLook: ModelPickerLook) => useUi.setState({ modelPickerLook })

export const openNewTask = (spaceId?: string) => useUi.setState({ newTask: spaceId ? { spaceId } : {} })
export const closeNewTask = () => useUi.setState({ newTask: null })

export const openSearch = () => useUi.setState({ searchOpen: true })
export const toggleSearch = () => useUi.setState((state) => ({ searchOpen: !state.searchOpen }))
export const closeSearch = () => useUi.setState({ searchOpen: false })
