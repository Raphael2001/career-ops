# career-ops container
# Base: Playwright image with Chromium preinstalled (matches playwright@1.64.1 in package.json).
# Host kernels that block Playwright's chromium installer (e.g. Ubuntu 26.04) work fine here
# because the browser ships in the image and runs under the image's userland.

FROM mcr.microsoft.com/playwright:v1.64.1-jammy

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=development \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PATH=/usr/local/go/bin:$PATH

# Optional: Go toolchain for the dashboard TUI (./dashboard).
# Small footprint, keeps full feature parity with the README setup.
# Must be >= the `go` line in dashboard/go.mod (checked by tests/go-floor.test.mjs), or
# `go build` fetches a newer toolchain over the network and fails offline.
# Bumping GO_VERSION means updating both checksums too, from the
# linux-amd64 and linux-arm64 archives listed at https://go.dev/dl/.
ARG GO_VERSION=1.27.2
ARG GO_SHA256_AMD64=ecbadb99091a3f46e31f5f934b068b1864eafa7995211b39eaddf76996045fe5
ARG GO_SHA256_ARM64=94f3e30b8e374bc285e7dadc11e0865726b9bc6e85b841ccceaabc0214c6b7c8
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl git tini cron sudo jq latexmk texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended texlive-xetex; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64)  go_arch=amd64; go_sha256="$GO_SHA256_AMD64" ;; \
      arm64)  go_arch=arm64; go_sha256="$GO_SHA256_ARM64" ;; \
      *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${go_arch}.tar.gz" -o /tmp/go.tgz; \
    echo "${go_sha256}  /tmp/go.tgz" | sha256sum -c -; \
    tar -C /usr/local -xzf /tmp/go.tgz; \
    rm /tmp/go.tgz; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Prime npm deps in a layer so rebuilds stay fast.
# Pin playwright to the version that matches the base image's bundled chromium.
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund \
 && npm install --no-audit --no-fund --save-exact playwright@1.64.1

# Claude Code CLI -- lets headless automation (deploy/discover-companies.sh,
# cron) run `/career-ops scan` itself instead of needing an interactive
# session. See deploy/litellm/README.md for pointing it at LiteLLM/NVIDIA
# instead of a real Anthropic key.
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code

# The rest of the project is bind-mounted at runtime via docker compose,
# so we don't COPY sources here — keeps the image generic and lets local
# edits show up instantly inside the container.

# Everything below runs as pwuser (uid 1000, matches the host's `claw` user),
# not root -- the whole project is bind-mounted from the host (docker-compose.yml
# `.:/app`), so a root-default container meant every file the app touched
# (output/, data/, portals.yml, ...) came out root-owned on the host and
# blocked the host user from writing those same paths outside Docker. This
# applies to the main process AND to `docker compose exec`/`./cops exec`,
# since both default to whatever USER is set here.
#
# The one thing that still needs root is starting the cron daemon itself
# (binding /var/run/crond.pid, reading every user's crontab) -- container-start.sh
# does that via this narrowly-scoped NOPASSWD sudo rule instead of running the
# whole container as root for it. pwuser's own crontab needs no privilege at
# all; cron then runs pwuser's jobs as pwuser once the daemon is up.
RUN echo 'pwuser ALL=(root) NOPASSWD: /usr/sbin/cron' > /etc/sudoers.d/pwuser-cron \
 && chmod 0440 /etc/sudoers.d/pwuser-cron

# docker-compose mounts named volumes over /app/node_modules and
# /app/web/node_modules. A FRESH named volume copies the ownership of the image
# directory it covers, and that directory is root-owned unless created here --
# so on a new host `npm ci` (run as pwuser by container-start.sh) died with
# EACCES. Pre-create both mount points owned by pwuser.
RUN mkdir -p /app/node_modules /app/web/node_modules \
 && chown pwuser:pwuser /app/node_modules /app/web/node_modules

USER pwuser

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash"]
