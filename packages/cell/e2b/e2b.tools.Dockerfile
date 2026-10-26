# The full toolset for a deployed brain, whose hand shares its sandbox: the tools of ren-v1's
# Software Factory environment (registry/blueprints/pods/software-factory/blueprint.yaml) on top of
# ren-v1's sandbox base (packages/api/src/sandbox/providers/local/image/Dockerfile). Appended to
# e2b.Dockerfile when E2B_TEMPLATE_TOOLS=full.

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    sudo build-essential golang-go python3 python3-pip python3-venv sqlite3 unzip jq \
    ffmpeg docker.io docker-compose \
    xvfb xdg-utils chromium libgtk-3-0 libnss3 libgbm1 libasound2 \
  && rm -rf /var/lib/apt/lists/* \
  && ln -sf /usr/bin/python3 /usr/local/bin/python

RUN curl -fsSL -o /tmp/node.tar.gz https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.gz \
  && echo "eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c  /tmp/node.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1 --no-same-owner \
  && rm -f /tmp/node.tar.gz \
  && test "$(node --version)" = "v24.22.1"

RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    >/etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install --yes --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# The sandbox user runs Docker without sudo; sudo covers the rest.
RUN (id -u user >/dev/null 2>&1 || useradd --create-home --shell /bin/bash user) \
  && usermod --append --groups docker user \
  && echo 'user ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/user \
  && chmod 0440 /etc/sudoers.d/user

# agent-browser keeps its browser in the home of the user that runs it.
RUN npm install --global agent-browser@0.38.1 \
  && HOME=/home/user agent-browser install --with-deps \
  && chown -R user:user /home/user/.agent-browser

# Paper's desktop app, run under a virtual display.
RUN cd "$(mktemp -d)" \
  && curl -fsSL https://download.paper.design/linux/appImage -o paper.AppImage \
  && chmod +x paper.AppImage \
  && ./paper.AppImage --appimage-extract >/dev/null \
  && mv squashfs-root /opt/paper

# Cua Driver operates Paper's sign-in browser. Pinned and checksummed; telemetry off.
RUN cd "$(mktemp -d)" \
  && curl -fsSL -o cua.tgz https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.32.0/cua-driver-rs-0.32.0-linux-x86_64-binary.tar.gz \
  && echo "bb006010864e9a93b9f67035e345c3a076f0908d42fbe493bb21ede5f82f39a6  cua.tgz" | sha256sum -c - \
  && mkdir -p /opt/cua-driver \
  && tar xzf cua.tgz -C /opt/cua-driver cua-driver libcua_driver_sdk.so \
  && ln -sf /opt/cua-driver/cua-driver /usr/local/bin/cua-driver \
  && HOME=/home/user cua-driver telemetry disable \
  && chown -R user:user /home/user
