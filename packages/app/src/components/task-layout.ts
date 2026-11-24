export * as TaskLayout from "./task-layout.js"

export const header = "h-15 gap-2.5 border-b pt-1 text-sm"
export const scroller = "@container flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
export const body =
  "flex w-full flex-col gap-8 px-4 pb-12 @3xl:flex-row @3xl:gap-20 @3xl:pr-8 @3xl:pb-0 @3xl:pl-[clamp(--spacing(8),10cqw,--spacing(36))]"
export const article = "flex w-full max-w-184 min-w-0 flex-1 flex-col gap-6 self-start pt-12 pb-24"
export const aside = "flex shrink-0 flex-col gap-6 @3xl:w-64 @3xl:pt-12 @6xl:w-80"
export const sectionTitle = "mb-1 text-sm text-muted-foreground"
export const property =
  "-ml-2.5 h-8 w-fit max-w-full min-w-0 justify-start gap-2 rounded-full px-2.5 font-normal data-popup-open:bg-muted [&_svg:not([class*='text-'])]:text-muted-foreground"
