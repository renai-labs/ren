export type ClipBox = { x: number; y: number; width: number; height: number }

export type ClipTimeline = {
  viewport: { width: number; height: number }
  cursor: { t: number; x: number; y: number }[]
  events: {
    start: number
    at: number
    end: number
    box?: ClipBox
    note?: string
  }[]
}

type Camera = { zoom: number; x: number; y: number }

const MAX_ZOOM = 1.6
const TARGET_SHARE = 0.6
const MERGE_GAP_SECONDS = 2.5
const HOLD_SECONDS = 1.2
const NOTE_HOLD_SECONDS = 2
const LOOP_FADE_SECONDS = 0.35
const SPRING_FREQUENCY = 7
const MAX_STEP_SECONDS = 1 / 120

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)
const centre = (box: ClipBox) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
})

function pointerAt(timeline: ClipTimeline, time: number) {
  const next = timeline.cursor.findIndex((key) => key.t > time)
  const to = timeline.cursor.at(next)
  const from = next > 0 ? timeline.cursor.at(next - 1) : undefined
  if (!to) return { x: timeline.viewport.width / 2, y: timeline.viewport.height / 2 }
  if (!from || next === -1) return { x: to.x, y: to.y }
  const progress = easeInOut((time - from.t) / (to.t - from.t))
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  }
}

const zoomFor = (box: ClipBox, timeline: ClipTimeline) =>
  clamp(
    Math.min(
      (TARGET_SHARE * timeline.viewport.width) / box.width,
      (TARGET_SHARE * timeline.viewport.height) / box.height,
    ),
    1,
    MAX_ZOOM,
  )

function isNear(from: ClipBox, to: ClipBox, zoom: number, timeline: ClipTimeline) {
  const a = centre(from)
  const b = centre(to)
  return (
    Math.abs(a.x - b.x) < (timeline.viewport.width / zoom) * 0.35 &&
    Math.abs(a.y - b.y) < (timeline.viewport.height / zoom) * 0.35
  )
}

function headingAway(timeline: ClipTimeline, time: number, box: ClipBox, zoom: number) {
  const destination = timeline.cursor.at(timeline.cursor.findIndex((key) => key.t > time))
  if (!destination) return false
  return !isNear(box, { x: destination.x, y: destination.y, width: 0, height: 0 }, zoom, timeline)
}

function zoomAt(timeline: ClipTimeline, time: number) {
  let previous: { box: ClipBox; end: number; zoom: number } | undefined
  for (const step of timeline.events) {
    if (!step.box || step.start > time) continue
    if (step.at > time) {
      return previous &&
        step.start - previous.end < MERGE_GAP_SECONDS &&
        isNear(previous.box, step.box, previous.zoom, timeline)
        ? previous.zoom
        : 1
    }
    previous = {
      box: step.box,
      end: step.end,
      zoom: zoomFor(step.box, timeline),
    }
  }
  if (!previous || time > previous.end + HOLD_SECONDS) return 1
  return headingAway(timeline, time, previous.box, previous.zoom) ? 1 : previous.zoom
}

export function clipTarget(timeline: ClipTimeline, time: number) {
  const noted = timeline.events.findLast((event) => event.note && time >= event.start)
  const note = noted && time <= noted.end + NOTE_HOLD_SECONDS ? noted.note : undefined
  const current = timeline.events.findLast((event) => event.box && time >= event.start)
  return {
    camera: { zoom: zoomAt(timeline, time), ...pointerAt(timeline, time) },
    note,
    anchor: current?.box ?? noted?.box,
  }
}

function spring(initial: number) {
  let value = initial
  let velocity = 0
  return (target: number, dt: number, options: { snap: boolean }) => {
    if (options.snap) {
      value = target
      velocity = 0
      return value
    }
    const elapsed = Math.min(dt, 0.1)
    const steps = Math.max(1, Math.ceil(elapsed / MAX_STEP_SECONDS))
    const h = elapsed / steps
    for (let step = 0; step < steps; step++) {
      velocity += (SPRING_FREQUENCY ** 2 * (target - value) - 2 * SPRING_FREQUENCY * velocity) * h
      value += velocity * h
    }
    return value
  }
}

export function cameraSpring(initial: Camera) {
  const zoom = spring(initial.zoom)
  const x = spring(initial.x)
  const y = spring(initial.y)
  return (target: Camera, dt: number, options: { snap: boolean }): Camera => ({
    zoom: zoom(target.zoom, dt, options),
    x: x(target.x, dt, options),
    y: y(target.y, dt, options),
  })
}

export function boxSpring(initial: ClipBox) {
  const x = spring(initial.x)
  const y = spring(initial.y)
  const width = spring(initial.width)
  const height = spring(initial.height)
  return (target: ClipBox, dt: number, options: { snap: boolean }): ClipBox => ({
    x: x(target.x, dt, options),
    y: y(target.y, dt, options),
    width: width(target.width, dt, options),
    height: height(target.height, dt, options),
  })
}

export function cameraTransform(camera: Camera, timeline: ClipTimeline) {
  const zoom = Math.max(1, camera.zoom)
  const x = clamp(50 - (camera.x / timeline.viewport.width) * zoom * 100, 100 - zoom * 100, 0)
  const y = clamp(50 - (camera.y / timeline.viewport.height) * zoom * 100, 100 - zoom * 100, 0)
  return { zoom, x, y, css: `translate(${x}%, ${y}%) scale(${zoom})` }
}

export function calloutPoint(view: { zoom: number; x: number; y: number }, box: ClipBox, timeline: ClipTimeline) {
  const x = view.x + ((box.x + box.width / 2) / timeline.viewport.width) * view.zoom * 100
  const below = view.y + ((box.y + box.height) / timeline.viewport.height) * view.zoom * 100
  const above = view.y + (box.y / timeline.viewport.height) * view.zoom * 100
  return below < 78 ? { x, y: below, placement: "below" as const } : { x, y: above, placement: "above" as const }
}

export function loopOpacity(time: number, duration: number) {
  if (!Number.isFinite(duration) || duration === 0) return 1
  return clamp(Math.min(time, duration - time) / LOOP_FADE_SECONDS, 0, 1)
}
