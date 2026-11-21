"use client"

import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "cn"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  step = 1,
  thumbAlignment = "edge",
  marks,
  getAriaValueText,
  ...props
}: SliderPrimitive.Root.Props & Pick<SliderPrimitive.Thumb.Props, "getAriaValueText"> & { marks?: boolean }) {
  const range = value ?? defaultValue
  const thumbs = Array.isArray(range) ? range.length : 1
  const steps = Math.floor((max - min) / step)
  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      step={step}
      thumbAlignment={thumbAlignment}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-horizontal:h-5 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative overflow-hidden rounded-full bg-input select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-ring select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {marks && steps > 0 ? (
          <div
            aria-hidden
            data-slot="slider-marks"
            className={cn(
              "pointer-events-none absolute top-1/2",
              thumbAlignment === "center" ? "inset-x-0" : "inset-x-2",
            )}
          >
            {Array.from({ length: steps + 1 }, (_, index) => min + index * step)
              .filter((mark) => mark !== range)
              .map((mark) => (
                <span
                  key={mark}
                  data-slot="slider-mark"
                  data-passed={typeof range === "number" && mark < range ? "" : undefined}
                  style={{ left: `${((mark - min) / (max - min)) * 100}%` }}
                  className="absolute size-1.5 -translate-1/2 rounded-full bg-muted-foreground ring-2 ring-background data-passed:bg-ring"
                />
              ))}
          </div>
        ) : null}
        {Array.from({ length: thumbs }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            aria-label={props["aria-label"]}
            getAriaValueText={getAriaValueText}
            // oxlint-disable-next-line react/no-array-index-key -- thumbs have no identity beyond their position
            key={index}
            className="relative block size-4 shrink-0 rounded-full border border-foreground/15 bg-white shadow-sm ring-ring/50 transition-shadow duration-150 ease-out select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
