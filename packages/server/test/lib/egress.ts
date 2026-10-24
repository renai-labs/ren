export * as EgressHarness from "./egress.js"

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const egressRoot = new URL("../../../../repos/iron-proxy/", import.meta.url).pathname

export interface Certificates {
  readonly dir: string
  readonly ca: string
  readonly serverCert: string
  readonly serverKey: string
  readonly clientCert: string
  readonly clientKey: string
  readonly mitmCa: string
  readonly mitmKey: string
}

export const certificates = async (): Promise<Certificates> => {
  const dir = await mkdtemp(join(tmpdir(), "ren-egress-"))
  const run = Bun.spawn(["bun", "run", "certificates", dir], { cwd: egressRoot, stdout: "ignore", stderr: "pipe" })
  if ((await run.exited) !== 0) throw new Error(`egress certificates failed: ${await new Response(run.stderr).text()}`)
  return {
    dir,
    ca: join(dir, "ca.pem"),
    serverCert: join(dir, "leaf.pem"),
    serverKey: join(dir, "leaf.key"),
    clientCert: join(dir, "leaf.pem"),
    clientKey: join(dir, "leaf.key"),
    mitmCa: join(dir, "mitm-ca.pem"),
    mitmKey: join(dir, "mitm-ca.key"),
  }
}

export const freePort = () => {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => {} } })
  const port = probe.port
  probe.stop(true)
  return port
}

export const build = async () => {
  const run = Bun.spawn(["bun", "run", "build"], { cwd: egressRoot, stdout: "ignore", stderr: "pipe" })
  if ((await run.exited) !== 0) throw new Error(`egress build failed: ${await new Response(run.stderr).text()}`)
  return join(egressRoot, "bin", "iron-proxy")
}

export interface Instance {
  readonly tunnel: number
  readonly control: number
  readonly logs: () => string
  readonly stop: () => Promise<void>
}

const waitForPort = async (
  port: number,
  process: Bun.Subprocess,
  logs: () => string,
  deadline = Date.now() + 15_000,
): Promise<void> => {
  if (process.exitCode !== null) throw new Error(`egress exited: ${logs()}`)
  const open = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data: () => {} } }).then(
    (socket) => (socket.end(), true),
    () => false,
  )
  if (open) return
  if (Date.now() > deadline) throw new Error(`egress did not listen on ${port}: ${logs()}`)
  await Bun.sleep(50)
  return waitForPort(port, process, logs, deadline)
}

// oxlint-disable-next-line ren/no-comments -- The fork's own DNS server answers every name with 127.0.0.1 and is the fork's upstream resolver, so `api.stripe.test` reaches a local upstream. Loopback is allowed upstream for the test only.
export const start = async (input: {
  readonly binary: string
  readonly certificates: Certificates
  readonly hook: string
  readonly drain?: string
}): Promise<Instance> => {
  const ports = {
    tunnel: freePort(),
    control: freePort(),
    dns: freePort(),
    http: freePort(),
    https: freePort(),
    metrics: freePort(),
  }
  const config = join(input.certificates.dir, `egress-${ports.tunnel}.yaml`)
  await Bun.write(
    config,
    [
      "dns:",
      `  listen: "127.0.0.1:${ports.dns}"`,
      `  proxy_ip: "127.0.0.1"`,
      `  upstream_resolver: "127.0.0.1:${ports.dns}"`,
      "proxy:",
      `  http_listen: "127.0.0.1:${ports.http}"`,
      `  https_listen: "127.0.0.1:${ports.https}"`,
      `  tunnel_listen: "127.0.0.1:${ports.tunnel}"`,
      "  upstream_deny_cidrs: []",
      "tls:",
      `  ca_cert: "${input.certificates.mitmCa}"`,
      `  ca_key: "${input.certificates.mitmKey}"`,
      "metrics:",
      `  listen: "127.0.0.1:${ports.metrics}"`,
      "log:",
      "  level: debug",
      "ren:",
      `  hook: "${input.hook}"`,
      `  ca_cert: "${input.certificates.ca}"`,
      `  cert: "${input.certificates.clientCert}"`,
      `  key: "${input.certificates.clientKey}"`,
      `  control_listen: "127.0.0.1:${ports.control}"`,
      `  drain: "${input.drain ?? "2s"}"`,
      "",
    ].join("\n"),
  )
  const process = Bun.spawn([input.binary, "--config", config], { stdout: "pipe", stderr: "pipe" })
  const output: Array<string> = []
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) output.push(new TextDecoder().decode(chunk))
  }
  void collect(process.stdout)
  void collect(process.stderr)
  const logs = () => output.join("")
  await waitForPort(ports.tunnel, process, logs)
  await waitForPort(ports.control, process, logs)
  return {
    tunnel: ports.tunnel,
    control: ports.control,
    logs,
    stop: async () => {
      process.kill("SIGKILL")
      await process.exited
    },
  }
}

export const cleanup = (certificates: Certificates) => rm(certificates.dir, { recursive: true, force: true })

export const curl = async (args: ReadonlyArray<string>, env: Readonly<Record<string, string>> = {}) => {
  const run = Bun.spawn(["sh", "-c", `curl -sS --max-time 10 -D - ${args.join(" ")}`], {
    env: { PATH: process.env.PATH ?? "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()])
  await run.exited
  const separator = stdout.lastIndexOf("\r\n\r\n")
  const head = stdout.slice(0, separator)
  const statuses = [...head.matchAll(/^HTTP\/[\d.]+ (\d{3})/gmu)].map((match) => Number(match[1]))
  return { status: statuses.at(-1) ?? 0, head, body: stdout.slice(separator + 4), stderr }
}
