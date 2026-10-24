const root = new URL("..", import.meta.url).pathname
const wanted = [1, 27]

const local = Bun.which("go")
  ? (await Bun.$`go env GOVERSION`.quiet().nothrow()).stdout.toString().trim()
  : ""
const version = /^go(\d+)\.(\d+)/u.exec(local)
const usesLocal =
  version !== null &&
  (Number(version[1]) > wanted[0] || (Number(version[1]) === wanted[0] && Number(version[2]) >= wanted[1]))

const env = Object.fromEntries(
  ["GOOS", "GOARCH", "CGO_ENABLED"].flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : [])),
)

const command = usesLocal
  ? ["go", ...Bun.argv.slice(2)]
  : [
      "docker",
      "run",
      "--rm",
      "-v",
      `${root}:/src`,
      "-v",
      "ren-egress-gocache:/go",
      "-w",
      "/src",
      ...Object.entries(env).flatMap((entry) => ["-e", `${entry[0]}=${entry[1]}`]),
      "golang:1.27",
      "go",
      ...Bun.argv.slice(2),
    ]

const child = Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit", env: { ...process.env, ...env } })
process.exitCode = await child.exited
