const root = new URL("..", import.meta.url).pathname
const goos = process.platform === "win32" ? "windows" : process.platform
const goarch = process.arch === "x64" ? "amd64" : process.arch
const child = Bun.spawn(["bun", "script/go.ts", "build", "-o", "bin/iron-proxy", "./cmd/iron-proxy"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: "0" },
})
process.exitCode = await child.exited
