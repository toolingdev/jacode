#!/usr/bin/env bash
# Fork feature: starts a worker inside its container: the virtual screen, the browser's window manager, the screen
# share, then the server. The password is made on first start and kept in the volume; the app is connected with the
# pairing link this prints. Pass a model provider's key into the container as an environment variable.
set -euo pipefail

export DISPLAY=:99
CONFIG="$HOME/.config/opencode/opencode.json"
mkdir -p "$HOME/work" "$HOME/.config/opencode"

if [ ! -f "$HOME/.worker-password" ]; then
  (umask 077 && head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40 > "$HOME/.worker-password")
fi

# A config that is already there is the owner's: it is left alone. Chromium has no sandbox of its own in a container.
if [ ! -f "$CONFIG" ]; then
  cat > "$CONFIG" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["playwright-mcp", "--browser", "chromium", "--executable-path", "/usr/bin/chromium", "--no-sandbox", "--user-data-dir", "$HOME/.cache/oc-browser", "--viewport-size", "1280x800"],
      "environment": { "DISPLAY": ":99" },
      "enabled": true
    }
  }
}
JSON
fi

rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1440x900x24 -nolisten tcp &
sleep 1
openbox &
x11vnc -display :99 -localhost -forever -shared -nopw -quiet &
websockify --web /usr/share/novnc 0.0.0.0:6080 localhost:5900 >/dev/null 2>&1 &

opencode service set hostname 0.0.0.0 >/dev/null
opencode service set port "${WORKER_PORT:-4096}" >/dev/null
opencode service set password "$(cat "$HOME/.worker-password")" >/dev/null

# The link is printed once the server answers; `docker logs` shows it.
(
  for _ in $(seq 1 30); do
    (exec 3<>"/dev/tcp/127.0.0.1/${WORKER_PORT:-4096}") 2>/dev/null && break
    sleep 1
  done
  echo "Worker is running: $(opencode --version). Connect the app with a pairing link:"
  opencode pair --url "${WORKER_URL:-http://localhost:${WORKER_PORT:-4096}}" || true
) &

cd "$HOME/work"
exec opencode serve --service
