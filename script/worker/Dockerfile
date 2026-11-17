# Fork feature: a worker as a container, for a machine that has Docker instead of systemd. It carries the server,
# a real browser on a virtual screen, and the screen in a web page on port 6080. Built by
# `bun script/fork-worker-setup.ts --docker`, which puts the server binary beside this file.
FROM debian:13-slim

RUN apt-get update -qq \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    ca-certificates curl git openssh-client xvfb openbox x11vnc novnc websockify chromium nodejs npm \
  && npm install -g --silent --prefix /usr/local @playwright/mcp \
  && ln -sf ../lib/node_modules/@playwright/mcp/cli.js /usr/local/bin/playwright-mcp \
  && rm -rf /var/lib/apt/lists/* /root/.npm \
  && useradd --create-home --shell /bin/bash worker

COPY --chmod=755 opencode /usr/local/bin/opencode
COPY --chmod=755 entrypoint.sh /usr/local/bin/worker-entrypoint

USER worker
WORKDIR /home/worker/work
# The password, the config, the sessions and the work live here; mount a volume to keep them.
VOLUME /home/worker
EXPOSE 4096 6080
ENTRYPOINT ["/usr/local/bin/worker-entrypoint"]
