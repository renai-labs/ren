import { Fragment } from "react"

const BASE_DELAY = 0.4
const STAGGER = 0.033

function revealWords(words: string[], offset: number) {
  return words.map((word, index) => (
    <Fragment key={word}>
      <span
        className="inline-block animate-blur-reveal"
        style={{ "--animation-delay": `${BASE_DELAY + (offset + index) * STAGGER}s` }}
      >
        {word}
      </span>
      {index < words.length - 1 ? " " : null}
    </Fragment>
  ))
}

export function HeroSection(props: { title: string; description: string }) {
  const lines = props.title.split("\n").map((line) => line.split(" "))
  const words = lines.flat()

  return (
    <section className="relative w-full">
      <div className="mx-auto w-full max-w-(--page-wide-max) px-(--page-inset) pt-40 lg:pt-48">
        <h1 className="max-w-3xl font-medium text-foreground">
          <span className="text-title-5 md:hidden">
            <span className="block">{revealWords(words.slice(0, 2), 0)}</span>
            <span className="mt-2 block">{revealWords(words.slice(2), 2)}</span>
          </span>
          <span className="hidden text-title-6 md:block lg:text-title-7">
            {lines.map((line, index) => (
              <span key={line.join(" ")} className="block">
                {revealWords(line, lines.slice(0, index).flat().length)}
              </span>
            ))}
          </span>
        </h1>
        <p
          className="mt-4 max-w-lg animate-blur-reveal text-body text-muted-foreground"
          style={{ "--animation-delay": `${BASE_DELAY + words.length * STAGGER + 0.1}s` }}
        >
          {props.description}
        </p>
      </div>
    </section>
  )
}
