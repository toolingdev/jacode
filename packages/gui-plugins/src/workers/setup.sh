#!/usr/bin/env bash
# Fork feature: turns a Linux machine into a worker, a server the desktop app connects to and hands work.
# The app's Workers settings page and `script/fork-worker-setup.ts` copy this file and the server binary to the
# machine and run it there; it also
# runs by hand on the machine itself. It checks the machine first and changes nothing unless every check passes.
# Running it again is safe: it replaces the binary and the units and keeps the password, the config and the work.
#
# Settings, all optional, as environment variables:
#   WORKER_MODE     check (only look) or install (default)
#   WORKER_BINARY   the server binary to install (default /tmp/opencode.new; kept as is when missing and one is installed)
#   WORKER_LISTEN   address the server listens on (default: the Tailscale address, else 127.0.0.1)
#   WORKER_PORT     port the server listens on (default 4096)
#   WORKER_BROWSER  auto (default), yes or no: a real browser on a virtual screen for web tasks
set -euo pipefail

MODE="${WORKER_MODE:-install}"
BINARY="${WORKER_BINARY:-/tmp/opencode.new}"
PORT="${WORKER_PORT:-4096}"
BROWSER="${WORKER_BROWSER:-auto}"
RUN_AS="${SUDO_USER:-$(id -un)}"
HOME_DIR="$(getent passwd "$RUN_AS" | cut -d: -f6)"
ENV_FILE=/etc/opencode-worker.env

# The least a worker runs on. The browser adds a virtual screen and Chromium, which want the second figure.
MIN_CORES=2
MIN_RAM_MB=3500
BROWSER_RAM_MB=7000
MIN_DISK_GB=10

failed=0
ok() { printf '  ok    %-18s %s\n' "$1" "$2"; }
note() { printf '  note  %-18s %s\n' "$1" "$2"; }
bad() { printf '  FAIL  %-18s %s\n' "$1" "$2"; failed=1; }

tailscale_address() { command -v tailscale >/dev/null 2>&1 && tailscale ip -4 2>/dev/null | head -1 || true; }

LISTEN="${WORKER_LISTEN:-$(tailscale_address)}"
LISTEN="${LISTEN:-127.0.0.1}"

# Addresses only this machine or a private network reaches. The screen share has no password, so it is offered on
# these and nowhere else.
private_address() {
  case "$1" in
    127.*|10.*|192.168.*|100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;;
    *) return 1 ;;
  esac
}

echo "Checking $(hostname) for a worker (as $RUN_AS, listening on $LISTEN:$PORT)"

[ "$(uname -s)" = "Linux" ] && ok "system" "Linux" || bad "system" "needs Linux, this is $(uname -s)"

case "$(uname -m)" in
  x86_64|aarch64|arm64) ok "processor" "$(uname -m)" ;;
  *) bad "processor" "needs x86_64 or arm64, this is $(uname -m)" ;;
esac

[ -d /run/systemd/system ] && ok "systemd" "running" || bad "systemd" "not running; on a machine without it, use the Docker image instead"

cores="$(nproc 2>/dev/null || echo 0)"
[ "$cores" -ge "$MIN_CORES" ] && ok "cores" "$cores" || bad "cores" "$cores, needs $MIN_CORES"

ram_mb="$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo 2>/dev/null || echo 0)"
[ "$ram_mb" -ge "$MIN_RAM_MB" ] && ok "memory" "${ram_mb} MB" || bad "memory" "${ram_mb} MB, needs 4 GB"

disk_gb="$(df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9')"
[ "${disk_gb:-0}" -ge "$MIN_DISK_GB" ] && ok "disk" "${disk_gb} GB free" || bad "disk" "${disk_gb:-0} GB free, needs $MIN_DISK_GB GB"

if [ "$(id -u)" = "0" ] || sudo -n true 2>/dev/null; then ok "sudo" "available"; else bad "sudo" "$RUN_AS needs sudo without a password prompt"; fi

if (exec 3<>/dev/tcp/1.1.1.1/443) 2>/dev/null; then ok "internet" "reachable"; else bad "internet" "no way out to the internet on port 443"; fi

if ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q .; then
  # Ours only when the installed worker is running and is the one set to this port.
  if systemctl is-active --quiet opencode-worker 2>/dev/null && [ "$(/usr/local/bin/opencode service get port 2>/dev/null)" = "$PORT" ]; then ok "port $PORT" "held by the worker already installed"; else bad "port $PORT" "taken by something else; pick another with WORKER_PORT"; fi
else
  ok "port $PORT" "free"
fi

if [ -x "$BINARY" ] || [ -f "$BINARY" ] || [ -x /opt/opencode/bin/opencode ]; then ok "server binary" "ready"; else bad "server binary" "none at $BINARY and none installed"; fi

# Whether the browser goes in: asked for, or left to the machine's size and package manager.
browser=no
if [ "$BROWSER" != "no" ]; then
  if ! command -v apt-get >/dev/null 2>&1; then
    [ "$BROWSER" = "yes" ] && bad "browser" "needs apt (Debian or Ubuntu)" || note "browser" "skipped: needs apt (Debian or Ubuntu)"
  elif [ "$ram_mb" -lt "$BROWSER_RAM_MB" ] && [ "$BROWSER" = "auto" ]; then
    note "browser" "skipped: wants 8 GB of memory; force it with WORKER_BROWSER=yes"
  else
    browser=yes
    ok "browser" "will be installed"
  fi
else
  note "browser" "skipped: turned off"
fi

if ! private_address "$LISTEN"; then
  note "address" "$LISTEN is reachable from outside: the server's password is all that guards it, and the link is not encrypted. Put it behind HTTPS or use Tailscale."
fi

if [ "$failed" = "1" ]; then
  echo "Not set up: fix the lines marked FAIL and run this again. Nothing was changed."
  exit 1
fi

if [ "$MODE" = "check" ]; then
  echo "This machine can be a worker. Nothing was changed."
  exit 0
fi

SUDO=""
[ "$(id -u)" = "0" ] || SUDO="sudo"
as_user() {
  if [ "$(id -un)" = "$RUN_AS" ]; then "$@"; elif [ "$(id -u)" = "0" ]; then runuser -u "$RUN_AS" -- "$@"; else sudo -u "$RUN_AS" -H "$@"; fi
}

echo "Installing the server"
$SUDO mkdir -p /opt/opencode/bin
if [ -f "$BINARY" ]; then
  [ -x /opt/opencode/bin/opencode ] && $SUDO cp /opt/opencode/bin/opencode /opt/opencode/opencode.prev
  $SUDO install -m 755 "$BINARY" /opt/opencode/bin/opencode
  rm -f "$BINARY" 2>/dev/null || true
fi
$SUDO ln -sf /opt/opencode/bin/opencode /usr/local/bin/opencode
as_user mkdir -p "$HOME_DIR/work" "$HOME_DIR/.config/opencode"

# The password is made here, once, and never leaves the machine; the app is connected with a pairing link instead.
if ! $SUDO test -f "$ENV_FILE"; then
  password="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)"
  printf 'OPENCODE_PASSWORD=%s\n' "$password" | $SUDO install -m 600 /dev/stdin "$ENV_FILE"
  unset password
fi

if [ "$browser" = "yes" ]; then
  echo "Installing the browser and its virtual screen"
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb openbox x11vnc novnc websockify chromium nodejs npm >/dev/null
  if [ ! -e /usr/local/lib/node_modules/@playwright/mcp/cli.js ]; then
    $SUDO npm install -g --silent --prefix /usr/local @playwright/mcp
  fi
  $SUDO ln -sf ../lib/node_modules/@playwright/mcp/cli.js /usr/local/bin/playwright-mcp
fi

# A config that is already there is the owner's: it is left alone.
CONFIG="$HOME_DIR/.config/opencode/opencode.json"
if [ ! -f "$CONFIG" ]; then
  if [ "$browser" = "yes" ]; then
    as_user tee "$CONFIG" >/dev/null <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["playwright-mcp", "--browser", "chromium", "--executable-path", "/usr/bin/chromium", "--user-data-dir", "$HOME_DIR/.cache/oc-browser", "--viewport-size", "1280x800"],
      "environment": { "DISPLAY": ":99" },
      "enabled": true
    }
  }
}
EOF
  else
    printf '{\n  "$schema": "https://opencode.ai/config.json"\n}\n' | as_user tee "$CONFIG" >/dev/null
  fi
fi

if [ "$browser" = "yes" ] && ! grep -q playwright "$CONFIG"; then
  note "config" "kept as it was; add the playwright MCP server to $CONFIG for the worker to use its browser"
fi

unit() { $SUDO tee "/etc/systemd/system/$1.service" >/dev/null; }

unit opencode-worker <<EOF
[Unit]
Description=OpenCode worker server
After=network-online.target tailscaled.service oc-display.service
Wants=network-online.target

[Service]
User=$RUN_AS
WorkingDirectory=$HOME_DIR/work
EnvironmentFile=$ENV_FILE
Environment=DISPLAY=:99
ExecStart=/usr/local/bin/opencode serve --service
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
EOF

units="opencode-worker"

if [ "$browser" = "yes" ]; then
  unit oc-display <<EOF
[Unit]
Description=OpenCode worker virtual display

[Service]
User=$RUN_AS
ExecStart=/usr/bin/Xvfb :99 -screen 0 1440x900x24 -nolisten tcp
Restart=always

[Install]
WantedBy=multi-user.target
EOF

  unit oc-wm <<EOF
[Unit]
Description=OpenCode worker window manager
After=oc-display.service
Requires=oc-display.service

[Service]
User=$RUN_AS
Environment=DISPLAY=:99
ExecStart=/usr/bin/openbox
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

  unit oc-vnc <<EOF
[Unit]
Description=OpenCode worker screen share (this machine only)
After=oc-display.service
Requires=oc-display.service

[Service]
User=$RUN_AS
ExecStart=/usr/bin/x11vnc -display :99 -localhost -forever -shared -nopw -quiet
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

  # The screen has no password of its own, so it is only ever offered on a private address.
  screen_address=127.0.0.1
  private_address "$LISTEN" && screen_address="$LISTEN"

  unit oc-novnc <<EOF
[Unit]
Description=OpenCode worker screen in a browser
After=oc-vnc.service tailscaled.service
Wants=oc-vnc.service

[Service]
User=$RUN_AS
ExecStart=/usr/bin/websockify --web /usr/share/novnc $screen_address:6080 localhost:5900
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  units="oc-display oc-wm oc-vnc oc-novnc opencode-worker"
fi

echo "Starting the worker"
# The server reads where to listen and its password from its own service settings, kept equal to the file above.
as_user /usr/local/bin/opencode service set hostname "$LISTEN" >/dev/null
as_user /usr/local/bin/opencode service set port "$PORT" >/dev/null
password="$($SUDO sed -n 's/^OPENCODE_PASSWORD=//p' "$ENV_FILE")"
as_user /usr/local/bin/opencode service set password "$password" >/dev/null
unset password

$SUDO systemctl daemon-reload
# shellcheck disable=SC2086
$SUDO systemctl enable --quiet $units
# shellcheck disable=SC2086
$SUDO systemctl restart $units

for _ in $(seq 1 20); do
  (exec 3<>"/dev/tcp/$LISTEN/$PORT") 2>/dev/null && break
  sleep 1
done

if ! (exec 3<>"/dev/tcp/$LISTEN/$PORT") 2>/dev/null; then
  echo "The worker did not come up on $LISTEN:$PORT. Its log: sudo journalctl -u opencode-worker -n 50"
  exit 1
fi

echo
echo "Worker is running: $(/usr/local/bin/opencode --version) at http://$LISTEN:$PORT"
[ "$browser" = "yes" ] && echo "Its screen: http://$screen_address:6080/vnc.html"
[ "$LISTEN" = "127.0.0.1" ] && echo "It listens on this machine only. Reach it from the app's computer with: ssh -N -L $PORT:127.0.0.1:$PORT $RUN_AS@$(hostname)"
echo
echo "Two things are left, both yours:"
echo "  1. Give it a model provider: add the provider's key to $ENV_FILE (for example OPENAI_API_KEY=...),"
echo "     list the provider in $CONFIG, then: sudo systemctl restart opencode-worker"
echo "  2. Connect the app: Settings, Servers, Add server, and paste a pairing link from below."
echo
as_user /usr/local/bin/opencode pair || echo "Get a pairing link later with: opencode pair"
