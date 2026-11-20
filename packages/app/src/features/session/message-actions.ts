// oxlint-disable-next-line ren/no-comments -- A message's actions stay out of the way until the pointer is over the message or focus is inside it; on touch they always show.
export const revealOnHover =
  "transition-opacity duration-150 ease-out motion-reduce:transition-none pointer-fine:opacity-0 pointer-fine:group-focus-within/message:opacity-100 pointer-fine:group-hover/message:opacity-100"
