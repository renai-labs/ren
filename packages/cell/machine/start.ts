export * as MachineStart from "./start.js"

import { ExecutorVariables } from "@ren/hand-api/executor-variables"
import { Bundle } from "@ren/schema/bundle"
import { Schema } from "effect"
import { closeSync, openSync } from "node:fs"
import { mkdir, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Entrypoints } from "./entrypoints.js"

// oxlint-disable-next-line ren/no-comments -- What a machine runs: a brain with its tools' executor, a brain whose tools run on remote hands (no executor), or a remote hand (the executor only, open to the brains).
type Mode = "brain" | "brain-remote" | "hand"

const modeOf = (env: Readonly<Record<string, string | undefined>>): Mode => {
  if (env.REN_HAND) return "hand"
  return env.REN_HAND_PLACEMENT === "remote" ? "brain-remote" : "brain"
}

const isRunning = (pid: number) => Bun.spawnSync(["kill", "-0", String(pid)]).exitCode === 0

const exists = (path: string) => Bun.file(path).exists()

const readText = (path: string) =>
  Bun.file(path)
    .text()
    .then(
      (text) => text.trim(),
      () => "",
    )

const writeAtomic = async (path: string, content: string) => {
  await Bun.write(`${path}.next`, content)
  await rename(`${path}.next`, path)
}

// oxlint-disable-next-line ren/no-comments -- Takes the lock, or waits a second and tries again. A lock whose process is gone is free.
const acquire = async (lock: string, options: { readonly hasSaid: boolean }): Promise<void> => {
  if (
    await mkdir(lock).then(
      () => true,
      () => false,
    )
  )
    return Bun.write(join(lock, "pid"), String(process.pid)).then(() => {})
  const holder = Number(await readText(join(lock, "pid")))
  if (holder > 0 && !isRunning(holder)) await rm(lock, { recursive: true, force: true })
  else {
    if (!options.hasSaid) process.stderr.write("Another prepare runs; this one waits\n")
    await Bun.sleep(1000)
  }
  return acquire(lock, { hasSaid: true })
}

// oxlint-disable-next-line ren/no-comments -- One prepare at a time: an update can arrive while a slow download of the last one runs. mkdir is atomic.
const withLock = async <A>(code: string, run: () => Promise<A>) => {
  const lock = join(code, ".lock")
  await mkdir(code, { recursive: true })
  await acquire(lock, { hasSaid: false })
  try {
    return await run()
  } finally {
    await rm(lock, { recursive: true, force: true })
  }
}

const sha256Of = async (path: string) => {
  const hasher = new Bun.CryptoHasher("sha256")
  // oxlint-disable-next-line no-await-in-loop -- the chunks of one file, in order
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk)
  return hasher.digest("hex")
}

const download = async (bundle: Bundle.Download, archive: string) => {
  const response = await fetch(bundle.url)
  if (!response.ok) throw new Error(`The bundle ${bundle.kind} ${bundle.version} answered ${response.status}`)
  await mkdir(dirname(archive), { recursive: true })
  await Bun.write(`${archive}.part`, response)
  if ((await sha256Of(`${archive}.part`)) !== bundle.sha256) {
    await rm(`${archive}.part`, { force: true })
    throw new Error(`The bundle ${bundle.kind} ${bundle.version} does not match its sha256`)
  }
  await rename(`${archive}.part`, archive)
}

// oxlint-disable-next-line ren/no-comments -- A source bundle unpacks onto a hard-linked copy of the dependencies, so most deploys download only the sources. The tree appears whole or not at all.
const unpack = async (archive: string, target: string, dependencies: string | undefined) => {
  const part = `${target}.part`
  await rm(part, { recursive: true, force: true })
  await mkdir(dirname(target), { recursive: true })
  if (dependencies) {
    const linked = await Bun.$`cp -al ${dependencies} ${part}`.nothrow().quiet()
    if (linked.exitCode !== 0) await Bun.$`cp -R ${dependencies} ${part}`.quiet()
    await rm(join(part, ".ready"), { force: true })
  } else await mkdir(part, { recursive: true })
  await Bun.$`tar -xzf ${archive} -C ${part}`.quiet()
  await rm(target, { recursive: true, force: true })
  await rename(part, target)
  await Bun.write(join(target, ".ready"), "")
  await rm(archive, { force: true })
}

const versionsIn = (home: string) =>
  Promise.all(["brain", "executor"].map((kind) => readText(join(home, ".ren", `${kind}.version`))))

// oxlint-disable-next-line ren/no-comments -- Keeps the code that the brain and the executor run now, and the code they ran before this prepare: the old brain still runs for a moment after an update.
const removeUnused = async (code: string, kept: ReadonlySet<string>) => {
  const trees = await Array.fromAsync(
    new Bun.Glob("{brain,executor,dependencies}/*").scan({ cwd: code, onlyFiles: false }),
  )
  const isKept = (tree: string) => {
    const name = tree.slice(tree.indexOf("/") + 1)
    if (name.endsWith(".part")) return true
    return tree.startsWith("dependencies/") ? [...kept].some((each) => each.endsWith(`-${name}`)) : kept.has(name)
  }
  await Promise.all(
    trees.filter((tree) => !isKept(tree)).map((tree) => rm(join(code, tree), { recursive: true, force: true })),
  )
}

// oxlint-disable-next-line ren/no-comments -- Unpacks one bundle unless it is there already. A source bundle becomes current; a new executor stops the running one, which its supervisor starts again on the new tree. The brain stops itself (CodeUpdate).
const install = async (home: string, bundle: Bundle.Download, dependencies: Bundle.Download | undefined) => {
  const code = join(home, ".ren", "code")
  const target = join(code, bundle.kind, bundle.tree)
  if (!(await exists(join(target, ".ready")))) {
    const archive = join(code, "downloads", `${bundle.kind}-${bundle.version}.tar.gz`)
    await download(bundle, archive)
    const base =
      bundle.kind === "dependencies" || !dependencies ? undefined : join(code, "dependencies", dependencies.tree)
    await unpack(archive, target, base)
  }
  if (bundle.kind === "dependencies") return
  const file = join(home, ".ren", `${bundle.kind}.version`)
  const previous = await readText(file)
  await writeAtomic(file, bundle.tree)
  const executor = Number(await readText(join(home, ".ren", "executor.pid")))
  if (bundle.kind === "executor" && previous && previous !== bundle.tree && executor > 0)
    Bun.spawnSync(["kill", "-TERM", String(executor)])
}

export const prepare = (home: string, bundles: ReadonlyArray<Bundle.Download>) =>
  withLock(join(home, ".ren", "code"), async () => {
    const before = await versionsIn(home)
    const ordered = bundles.toSorted(
      (left, right) => Number(right.kind === "dependencies") - Number(left.kind === "dependencies"),
    )
    const dependencies = ordered.find((bundle) => bundle.kind === "dependencies")
    // oxlint-disable-next-line no-await-in-loop -- the dependencies unpack before the sources that copy them
    for (const bundle of ordered) await install(home, bundle, dependencies)
    await removeUnused(join(home, ".ren", "code"), new Set([...before, ...(await versionsIn(home))].filter(Boolean)))
  })

const prepareUntilReady = async (home: string, bundles: ReadonlyArray<Bundle.Download>): Promise<void> => {
  const isReady = await prepare(home, bundles).then(
    () => true,
    (error: unknown) => {
      process.stderr.write(`The bundles are not ready; the next try is in 5 s: ${String(error)}\n`)
      return false
    },
  )
  if (isReady) return
  await Bun.sleep(5000)
  return prepareUntilReady(home, bundles)
}

const caVariables = [
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "CURL_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  "AWS_CA_BUNDLE",
]

const attempt = async (description: string, command: Promise<{ readonly exitCode: number }>) => {
  if ((await command).exitCode !== 0) process.stderr.write(`${description} failed; the machine goes on without it\n`)
}

// oxlint-disable-next-line ren/no-comments -- Ren uploads the egress CA before brain.env. Every client trusts the system store plus that CA, from a bundle in the user's home, so no root is needed (C44). Docker reads only the system store and Chromium only its NSS store; the full template has both.
const trustEgress = async (home: string): Promise<Readonly<Record<string, string>>> => {
  const ca = join(home, ".ren", "egress-ca.pem")
  if (!(await exists(ca))) return {}
  const bundle = join(home, ".ren", "ca-bundle.pem")
  await Bun.write(bundle, `${await Bun.file("/etc/ssl/certs/ca-certificates.crt").text()}${await Bun.file(ca).text()}`)
  if ((await Bun.$`sudo -n true`.nothrow().quiet()).exitCode === 0) {
    await attempt(
      "Adding the egress CA to the system store",
      Bun.$`sudo cp ${ca} /usr/local/share/ca-certificates/ren-egress.crt && sudo update-ca-certificates`
        .nothrow()
        .quiet(),
    )
    if ((await Bun.$`sudo systemctl is-active --quiet docker`.nothrow().quiet()).exitCode === 0)
      await attempt("Restarting Docker for the egress CA", Bun.$`sudo systemctl restart docker`.nothrow().quiet())
  }
  if (Bun.which("certutil")) {
    const nssdb = join(home, ".pki", "nssdb")
    await mkdir(nssdb, { recursive: true })
    if (!(await exists(join(nssdb, "cert9.db"))))
      await attempt(
        "Making Chromium's certificate store",
        Bun.$`certutil -d sql:${nssdb} -N --empty-password`.nothrow().quiet(),
      )
    await Bun.$`certutil -d sql:${nssdb} -D -n ren-egress`.nothrow().quiet()
    await attempt(
      "Adding the egress CA to Chromium",
      Bun.$`certutil -d sql:${nssdb} -A -t C,, -n ren-egress -i ${ca}`.nothrow().quiet(),
    )
  }
  return Object.fromEntries(caVariables.map((name) => [name, bundle]))
}

// oxlint-disable-next-line ren/no-comments -- In split mode (REN_EGRESS_FORWARD) the machine's forwarder takes all its outbound TCP and sends only credential requests to the egress (egress-split.md §3.1). It runs as ren-forward, whose own traffic the rules let through. Its CA is made once and goes where Ren puts the egress CA in proxy mode, so trustEgress trusts it. When the forwarder cannot start, start.js stops: the machine does not boot, and Ren replaces it.
const forward = { port: "15001", user: "ren-forward", dir: "/etc/ren-forward" }

// oxlint-disable-next-line ren/no-comments -- One nf_tables table, loaded at once by `nft -f`: the redirect is in only with its exceptions. E2B's kernel has no xt_owner, so the forwarder's user is matched natively (meta skuid). Declaring and deleting the table first makes a second start replace it.
const forwardRules = `
table ip ren_forward
delete table ip ren_forward
table ip ren_forward {
  chain output {
    type nat hook output priority -100; policy accept;
    ip daddr 127.0.0.0/8 return
    meta skuid "${forward.user}" return
    meta l4proto tcp redirect to :${forward.port}
  }
  chain prerouting {
    type nat hook prerouting priority -100; policy accept;
    iifname "docker0" meta l4proto tcp redirect to :${forward.port}
  }
}
`

const forwardCA = `
if [ ! -s ${forward.dir}/ca.crt ]; then
  rm -rf ${forward.dir} && mkdir -p ${forward.dir}
  /opt/ren/iron-proxy generate-ca --outdir ${forward.dir} --name "Ren sandbox forwarder" --alg rsa4096 >/dev/null
  chown -R ${forward.user} ${forward.dir} && chmod 0700 ${forward.dir} && chmod 0644 ${forward.dir}/ca.crt
fi
cat ${forward.dir}/ca.crt
`

const isListening = (port: string) =>
  Bun.connect({ hostname: "127.0.0.1", port: Number(port), socket: { data: () => {} } }).then(
    (socket) => {
      socket.end()
      return true
    },
    () => false,
  )

const waitForPort = async (port: string, tries: number): Promise<boolean> => {
  if (await isListening(port)) return true
  if (tries <= 0) return false
  await Bun.sleep(100)
  return waitForPort(port, tries - 1)
}

const startForwarder = async (home: string, egress: string) => {
  if ((await Bun.$`sudo -n true`.nothrow().quiet()).exitCode !== 0)
    throw new Error("Split mode needs sudo for the forwarder")
  const ca = await Bun.$`sudo -n sh -c ${forwardCA}`.nothrow().quiet()
  if (ca.exitCode !== 0) throw new Error(`Making the forwarder's CA failed: ${ca.stderr.toString()}`)
  await Bun.write(join(home, ".ren", "egress-ca.pem"), ca.stdout)
  const command = [
    "sudo",
    "-n",
    "-u",
    forward.user,
    "/opt/ren/iron-proxy",
    "forward",
    "--listen",
    `0.0.0.0:${forward.port}`,
    "--egress",
    egress,
    "--ca-cert",
    `${forward.dir}/ca.crt`,
    "--ca-key",
    `${forward.dir}/ca.key`,
  ]
  void supervise(
    "forwarder",
    async () => spawnLogged(command, { log: join(home, ".ren", "forwarder.log"), env: { PATH: process.env.PATH } }),
    home,
  )
  if (!(await waitForPort(forward.port, 100))) throw new Error("The forwarder did not listen within 10 s")
  const rules = await Bun.$`sudo -n nft -f - < ${new Response(forwardRules)}`.nothrow().quiet()
  if (rules.exitCode !== 0) throw new Error(`Sending outbound TCP to the forwarder failed: ${rules.stderr.toString()}`)
}

// oxlint-disable-next-line ren/no-comments -- The executor runs in the ren-tools slice when the machine has systemd, so the tools' memory has its own limit (75%) and the brain survives a tool that fills memory. OOMPolicy=continue: an out-of-memory kill stops one process, not the whole scope. setpriv gives the user's groups (docker); systemd-run --uid gives root's.
const toolsOf = async (home: string) => {
  const slice = ["systemd-run", "--quiet", "--scope", "--slice=ren-tools.slice", "-p", "OOMPolicy=continue"]
  if ((await Bun.$`sudo -n ${slice} true`.nothrow().quiet()).exitCode !== 0) return { prefix: [], env: {} }
  return {
    prefix: [
      "sudo",
      "-E",
      "env",
      `PATH=${process.env.PATH ?? ""}`,
      `HOME=${home}`,
      ...slice,
      "--",
      "setpriv",
      `--reuid=${process.getuid?.() ?? 0}`,
      `--regid=${process.getgid?.() ?? 0}`,
      "--init-groups",
      "--",
    ],
    env: { REN_TOOLS_MEMORY_EVENTS: "/sys/fs/cgroup/ren.slice/ren-tools.slice/memory.events" },
  }
}

// oxlint-disable-next-line ren/no-comments -- Starts a process with its output appended to its log.
const spawnLogged = (
  command: ReadonlyArray<string>,
  options: { readonly log: string; readonly cwd?: string; readonly env: Readonly<Record<string, string | undefined>> },
) => {
  const log = openSync(options.log, "a")
  const child = Bun.spawn([...command], {
    ...(options.cwd && { cwd: options.cwd }),
    env: options.env,
    stdout: log,
    stderr: log,
  })
  closeSync(log)
  return child
}

// oxlint-disable-next-line ren/no-comments -- Runs the process once; the next delay is 1 s after a run of a minute or more, else double the last one, up to 30 s.
const runOnce = async (name: string, start: () => Promise<Bun.Subprocess>, home: string, delay: number) => {
  const startedAt = Date.now()
  const code = await (await start()).exited
  await Bun.write(join(home, ".ren", `${name}.exit`), String(code))
  const next = Date.now() - startedAt >= 60_000 ? 1000 : Math.min(delay * 2, 30_000)
  await Bun.sleep(next)
  return next
}

const supervise = async (name: string, start: () => Promise<Bun.Subprocess>, home: string) => {
  let delay = 500
  // oxlint-disable-next-line no-await-in-loop -- a supervisor runs its process again for the life of the machine
  for (;;) delay = await runOnce(name, start, home, delay)
}

// oxlint-disable-next-line ren/no-comments -- A brain that does not answer /ren/state for a minute is stopped with SIGKILL, so its supervisor starts it again; brain.stuck tells Ren why it ended.
const probe = async (brain: Bun.Subprocess, port: string, home: string, missed: number) => {
  await Bun.sleep(5000)
  const answered = await fetch(`http://127.0.0.1:${port}/ren/state`, { signal: AbortSignal.timeout(5000) }).then(
    () => true,
    () => false,
  )
  const next = answered ? 0 : missed + 1
  if (next >= 12 && brain.exitCode === null) {
    await Bun.write(join(home, ".ren", "brain.stuck"), "120")
    brain.kill("SIGKILL")
  }
  return next
}

const watch = async (brain: Bun.Subprocess, port: string, home: string) => {
  let missed = 0
  // oxlint-disable-next-line no-await-in-loop -- one probe every 5 s while the brain runs
  while (brain.exitCode === null) missed = await probe(brain, port, home, missed)
}

const main = async (env: Readonly<Record<string, string | undefined>>) => {
  const home = env.HOME ?? "/home/user"
  const ren = join(home, ".ren")
  await mkdir(join(home, "workspace"), { recursive: true })
  if (env.REN_EGRESS_FORWARD) await startForwarder(home, env.REN_EGRESS_FORWARD)
  const trusted = await trustEgress(home)
  await prepareUntilReady(home, Schema.decodeUnknownSync(Bundle.Downloads)(env.REN_BUNDLES))
  // oxlint-disable-next-line ren/no-comments -- The download links are for this start only. An update brings its own, so the brain, the executor and the agent's commands do not get them.
  const base = { ...Object.fromEntries(Object.entries(env).filter((entry) => entry[0] !== "REN_BUNDLES")), ...trusted }
  const mode = modeOf(env)
  const tools = await toolsOf(home)
  const executor = async () => {
    const tree = await readText(join(ren, "executor.version"))
    const own = {
      ...tools.env,
      PORT: env.EXECUTOR_PORT ?? "4100",
      EXECUTOR_HOST: mode === "hand" ? "0.0.0.0" : "127.0.0.1",
      EXECUTOR_WORKSPACE: join(home, "workspace"),
    }
    const child = spawnLogged([...tools.prefix, "bun", join(ren, "code", "executor", tree, Entrypoints.executor)], {
      log: join(ren, "executor.log"),
      env: {
        ...base,
        ...own,
        ...ExecutorVariables.hiding([...ExecutorVariables.hiddenIn(env), ...Object.keys(own)]),
      },
    })
    await Bun.write(join(ren, "executor.pid"), String(child.pid))
    return child
  }
  const port = env.BRAIN_PORT ?? "4800"
  const brain = async () => {
    const tree = await readText(join(ren, "brain.version"))
    const child = spawnLogged(["bun", join(ren, "code", "brain", tree, Entrypoints.brain)], {
      log: join(ren, "brain.log"),
      cwd: join(home, "workspace"),
      env: { ...base, REN_HOME: home, PORT: port, REN_BRAIN_VERSION: tree },
    })
    void watch(child, port, home)
    return child
  }
  await Promise.all([
    ...(mode === "brain-remote" ? [] : [supervise("executor", executor, home)]),
    ...(mode === "hand" ? [] : [supervise("brain", brain, home)]),
  ])
}

if (import.meta.main) {
  const home = process.env.HOME ?? "/home/user"
  if (process.argv[2] === "prepare") {
    const isPrepared = await prepare(home, Schema.decodeUnknownSync(Bundle.Downloads)(process.argv[3])).then(
      () => true,
      (error: unknown) => {
        process.stderr.write(`${String(error)}\n`)
        return false
      },
    )
    process.exit(isPrepared ? 0 : 1)
  }
  await main(process.env)
}
