export const STEPPER = [
  "docs-steps",
  "[&>ol]:[counter-reset:step] [&>ol]:list-none [&>ol]:ps-0",
  "[&>ol>li]:relative [&>ol>li]:m-0 [&>ol>li]:ps-10 [&>ol>li]:pb-5 [&>ol>li]:[counter-increment:step]",
  "[&>ol>li:last-child]:pb-0",
  "[&>ol>li>p]:my-0 [&>ol>li>p+*]:mt-3 [&>ol>li>*+p]:mt-3",
  "[&>ol>li]:before:absolute [&>ol>li]:before:start-0 [&>ol>li]:before:top-px",
  "[&>ol>li]:before:grid [&>ol>li]:before:size-6 [&>ol>li]:before:place-items-center [&>ol>li]:before:rounded-full",
  "[&>ol>li]:before:bg-fd-accent [&>ol>li]:before:text-fd-foreground",
  "[&>ol>li]:before:text-xs [&>ol>li]:before:font-medium [&>ol>li]:before:leading-none [&>ol>li]:before:tabular-nums",
  "[&>ol>li]:before:content-[counter(step)]",
].join(" ")
