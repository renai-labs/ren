import { mkdir } from "node:fs/promises"
import { join } from "node:path"

const dir = Bun.argv.at(2) ?? join(new URL("..", import.meta.url).pathname, ".dev", "certs")
await mkdir(dir, { recursive: true })

const openssl = async (args: ReadonlyArray<string>) => {
  const run = Bun.spawn(["openssl", ...args], { cwd: dir, stdout: "ignore", stderr: "pipe" })
  if ((await run.exited) !== 0) throw new Error(`openssl ${args.join(" ")}: ${await new Response(run.stderr).text()}`)
}

const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"]
const ca = ["-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"]
await Promise.all(
  ["ca", "mitm-ca"].map((name) =>
    openssl(["req", "-x509", ...ec, ...ca, "-keyout", `${name}.key`, "-out", `${name}.pem`, "-days", "365", "-subj", `/CN=ren dev ${name}`]),
  ),
)
await Bun.write(
  join(dir, "leaf.ext"),
  "subjectAltName=DNS:localhost,DNS:host.docker.internal,DNS:egress,DNS:ren,IP:127.0.0.1\nextendedKeyUsage=serverAuth,clientAuth\n",
)
await openssl(["req", ...ec, "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", "/CN=localhost"])
await openssl(["x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "leaf.pem", "-days", "365", "-extfile", "leaf.ext"])
console.log(dir)
