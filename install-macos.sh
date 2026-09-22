#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
VM_APP_ROOT="${HOME}/Library/Application Support/vm-yt-dlp"
VM_CONFIG_FILE="${VM_APP_ROOT}/config.json"
VM_VENV_DIR="${VM_APP_ROOT}/venv"
VM_BRIDGE_FILE="${VM_APP_ROOT}/vm_ytdlp_bridge.py"
VM_PLIST_FILE="${HOME}/Library/LaunchAgents/local.vm-yt-dlp.bridge.plist"
VM_USER_SCRIPT_OUTPUT="${SCRIPT_DIR}/yt-dlp-for-violentmonkey.paired.user.js"
VM_PYTHON_BIN="${VM_YTDLP_PYTHON:-python3}"

[[ "$(uname -s)" == "Darwin" ]] || { echo "This installer is for macOS." >&2; exit 1; }
command -v "${VM_PYTHON_BIN}" >/dev/null 2>&1 || { echo "Python 3.10+ is required." >&2; exit 1; }
"${VM_PYTHON_BIN}" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' \
  || { echo "Python 3.10+ is required." >&2; exit 1; }

mkdir -p "${VM_APP_ROOT}" "${HOME}/Library/LaunchAgents"
if [[ ! -x "${VM_VENV_DIR}/bin/python" ]]; then
  "${VM_PYTHON_BIN}" -m venv "${VM_VENV_DIR}"
fi
"${VM_VENV_DIR}/bin/python" -m pip install --disable-pip-version-check --upgrade pip 'yt-dlp[default]'
install -m 0755 "${SCRIPT_DIR}/companion/vm_ytdlp_bridge.py" "${VM_BRIDGE_FILE}"
"${VM_VENV_DIR}/bin/python" "${VM_BRIDGE_FILE}" --config "${VM_CONFIG_FILE}" init \
  --download-dir "${HOME}/Downloads/YouTube" \
  --userscript-template "${SCRIPT_DIR}/userscript/yt-dlp-for-violentmonkey.user.js" \
  --userscript-output "${VM_USER_SCRIPT_OUTPUT}"
chmod 0600 "${VM_CONFIG_FILE}" "${VM_USER_SCRIPT_OUTPUT}" 2>/dev/null || true

"${VM_PYTHON_BIN}" - "${VM_PLIST_FILE}" "${VM_VENV_DIR}/bin/python" "${VM_BRIDGE_FILE}" "${VM_CONFIG_FILE}" <<'PY'
import os, pathlib, plistlib, sys
target, python, bridge, config = sys.argv[1:]
payload = {
    "Label": "local.vm-yt-dlp.bridge",
    "ProgramArguments": [python, bridge, "--config", config, "serve"],
    "RunAtLoad": True,
    "KeepAlive": {"SuccessfulExit": False},
    "ProcessType": "Background",
    "EnvironmentVariables": {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin")},
    "StandardOutPath": str(pathlib.Path(config).with_name("bridge.log")),
    "StandardErrorPath": str(pathlib.Path(config).with_name("bridge-error.log")),
}
with open(target, "wb") as stream:
    plistlib.dump(payload, stream)
PY

# The bridge logs one stderr line per HTTP request and the panel polls about
# every second while downloading, so these files grow without bound unless
# newsyslog is told to rotate them.
VM_LOG_DIR="$(dirname -- "${VM_CONFIG_FILE}")"
VM_NEWSYSLOG_CONF="${VM_APP_ROOT}/newsyslog.conf"
{
  printf '# logfilename                                  [owner:group]  mode count size time  flags\n'
  printf '%s 644 5 2048 * NJ\n' "${VM_LOG_DIR}/bridge.log"
  printf '%s 644 5 2048 * NJ\n' "${VM_LOG_DIR}/bridge-error.log"
} > "${VM_NEWSYSLOG_CONF}"
if [[ -d /etc/newsyslog.d ]] && [[ -w /etc/newsyslog.d ]]; then
  cp "${VM_NEWSYSLOG_CONF}" /etc/newsyslog.d/vm-yt-dlp.conf 2>/dev/null \
    && echo "Log rotation registered with newsyslog." \
    || echo "Note: copy ${VM_NEWSYSLOG_CONF} into /etc/newsyslog.d/ to enable log rotation."
else
  echo "Note: to cap the bridge logs, run:"
  echo "  sudo cp '${VM_NEWSYSLOG_CONF}' /etc/newsyslog.d/vm-yt-dlp.conf"
fi

launchctl bootout "gui/$(id -u)" "${VM_PLIST_FILE}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${VM_PLIST_FILE}"
echo "Installed. Import this private file into Violentmonkey:"
echo "  ${VM_USER_SCRIPT_OUTPUT}"
echo "Install ffmpeg and Deno or Node.js if they are not already available."
