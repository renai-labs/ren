import { createContext } from "react"

export const COLUMN_WIDTH = 326
export const ColumnWidthContext = createContext(COLUMN_WIDTH)

export type MotionMode = "live" | "replay"
export const MotionModeContext = createContext<MotionMode>("live")

export type BoardIds = { previous: Set<string>; current: Set<string> }
export const BoardIdsContext = createContext<BoardIds>({ previous: new Set(), current: new Set() })
