#!/usr/bin/env bash
# Fork feature: update a worker that JaCode set up (systemd unit opencode-worker, binary in /opt/opencode/bin).
#
#   UPDATE_MODE=probe     print the processor, the version that runs, and whether the worker is busy
#   UPDATE_MODE=install   put /tmp/opencode.new in place, restart, and check that the worker answers with
#                         UPDATE_VERSION; when it does not, put the previous binary back and restart that
#
# Every answer is a `key=value` line. The worker's own address and password are read on the worker, so the password
# never leaves it.
set -u

say() { printf '%s=%s\n' "$1" "$2"; }

# Where the worker answers and its password, from the service record of the user it runs as.
record() {
  [ -r "$HOME/.local/state/opencode/service.json" ] && cat "$HOME/.local/state/opencode/service.json" && return
  user="$(systemctl show opencode-worker -p User --value 2>/dev/null)"
  sudo -n cat "$(getent passwd "${user:-root}" | cut -d: -f6)/.local/state/opencode/service.json" 2>/dev/null
}
field() { record | tr ',{}' '\n\n\n' | sed -n "s/^ *\"$1\" *: *\"\\{0,1\\}\\([^\"]*\\)\"\\{0,1\\} *$/\\1/p" | head -n 1; }
api() { curl -fsS -m 10 -u "opencode:$(field password)" "$(field url)$1" 2>/dev/null; }

if ! systemctl cat opencode-worker >/dev/null 2>&1 || [ ! -x /opt/opencode/bin/opencode ]; then
  say state unmanaged
  exit 0
fi

case "${UPDATE_MODE:-probe}" in
probe)
  say arch "$(uname -m)"
  say version "$(/opt/opencode/bin/opencode --version 2>/dev/null | tail -n 1)"
  active="$(api /api/session/active)"
  jobs="$(api '/api/experimental/job?status=running')"
  if [ -z "$active" ]; then
    say busy unknown
  elif printf '%s' "$active" | grep -q '"data":{}' && { [ -z "$jobs" ] || printf '%s' "$jobs" | grep -q '"data":\[\]'; }; then
    say busy no
  else
    say busy yes
  fi
  ;;
install)
  [ -x /tmp/opencode.new ] || { say state missing; exit 0; }
  sudo -n cp /opt/opencode/bin/opencode /opt/opencode/opencode.prev &&
    sudo -n install -m 755 /tmp/opencode.new /opt/opencode/bin/opencode || { say state failed; exit 0; }
  rm -f /tmp/opencode.new
  sudo -n systemctl restart opencode-worker
  for _ in $(seq 1 30); do
    sleep 2
    if api /api/info | grep -q "\"version\":\"${UPDATE_VERSION}\""; then
      say state updated
      exit 0
    fi
  done
  sudo -n install -m 755 /opt/opencode/opencode.prev /opt/opencode/bin/opencode
  sudo -n systemctl restart opencode-worker
  say state rolled-back
  ;;
esac
