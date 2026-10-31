const paths = [
  "M674.769 14.6123H596.325C544.865 14.6123 503.149 56.3285 503.149 107.788V691.749C503.149 743.208 544.865 784.925 596.325 784.925H674.769C726.228 784.925 767.944 743.208 767.944 691.749V107.788C767.944 56.3285 726.228 14.6123 674.769 14.6123Z",
  "M211.519 66.6589C226.177 17.3317 278.048 -10.7739 327.375 3.88454L402.569 26.229C451.897 40.8874 480.001 92.7583 465.343 142.086L299.002 701.859C284.344 751.186 232.473 779.288 183.146 764.631L107.952 742.288C58.6238 727.622 30.5192 675.756 45.1767 626.428L211.519 66.6589Z",
  "M0 965.005C0 944.423 16.6868 927.735 37.2703 927.735H838.581C859.164 927.735 875.851 944.423 875.851 965.005C875.851 985.588 859.164 1002.28 838.581 1002.28H37.2703C16.6868 1002.28 0 985.588 0 965.005Z",
]

export function Logomark(props: { className?: string | undefined; outline?: boolean | undefined }) {
  return (
    <svg
      viewBox={props.outline ? "-3 -3 882 1009" : "0 0 876 1003"}
      fill="none"
      aria-hidden
      className={props.className}
    >
      {paths.map((d) => (
        <path
          key={d}
          d={d}
          fill={props.outline ? "none" : "currentColor"}
          stroke={props.outline ? "currentColor" : undefined}
          strokeWidth={props.outline ? 3 : undefined}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}
