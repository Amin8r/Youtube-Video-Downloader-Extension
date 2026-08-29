#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
VM_DATA_ROOT="${XDG_DATA_HOME:-${HOME}/.local/share}/vm-yt-dlp"
VM_CONFIG_ROOT="${XDG_CONFIG_HOME:-${HOME}/.config}/vm-yt-dlp"
VM_CACHE_ROOT="${XDG_CACHE_HOME:-${HOME}/.cache}/yt-dlp"
VM_DENO_CACHE_ROOT="${DENO_DIR:-${XDG_CACHE_HOME:-${HOME}/.cache}/deno}"
VM_CONFIG_FILE="${VM_CONFIG_ROOT}/config.json"
VM_VENV_DIR="${VM_DATA_ROOT}/venv"
VM_BRIDGE_FILE="${VM_DATA_ROOT}/vm_ytdlp_bridge.py"
VM_SERVICE_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
VM_SERVICE_FILE="${VM_SERVICE_DIR}/vm-yt-dlp.service"
VM_USER_SCRIPT_TEMPLATE="${SCRIPT_DIR}/userscript/yt-dlp-for-violentmonkey.user.js"
VM_USER_SCRIPT_OUTPUT="${SCRIPT_DIR}/yt-dlp-for-violentmonkey.paired.user.js"
VM_PYTHON_BIN="${VM_YTDLP_PYTHON:-python3}"

red='\033[38;5;203m'
green='\033[38;5;84m'
amber='\033[38;5;214m'
muted='\033[38;5;245m'
bold='\033[1m'
reset='\033[0m'

info() { printf '%b●%b %s\n' "${red}" "${reset}" "$*"; }
good() { printf '%b✓%b %s\n' "${green}" "${reset}" "$*"; }
warn() { printf '%b!%b %s\n' "${amber}" "${reset}" "$*"; }
die() { printf '%bError:%b %s\n' "${red}${bold}" "${reset}" "$*" >&2; exit 1; }

printf '\n%b  yt-dlp for Violentmonkey%b\n' "${bold}" "${reset}"
printf '%b  Secure local bridge installer · Linux%b\n\n' "${muted}" "${reset}"

command -v "${VM_PYTHON_BIN}" >/dev/null 2>&1 || die "Python 3 was not found. Install Python 3.10 or newer first."
"${VM_PYTHON_BIN}" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' \
  || die "Python 3.10 or newer is required."
[[ -f "${VM_BRIDGE_FILE}" || -f "${SCRIPT_DIR}/companion/vm_ytdlp_bridge.py" ]] \
  || die "The companion source is missing from this release."
[[ -f "${VM_USER_SCRIPT_TEMPLATE}" ]] || die "The userscript template is missing from this release."

info "Creating an isolated Python environment"
mkdir -p "${VM_DATA_ROOT}" "${VM_CONFIG_ROOT}" "${VM_CACHE_ROOT}" "${VM_DENO_CACHE_ROOT}" "${HOME}/Downloads/YouTube"
if [[ ! -x "${VM_VENV_DIR}/bin/python" ]]; then
  "${VM_PYTHON_BIN}" -m venv "${VM_VENV_DIR}" \
    || die "Could not create a virtual environment. On Debian/Ubuntu, install python3-venv."
fi
"${VM_VENV_DIR}/bin/python" -m pip install --disable-pip-version-check --upgrade pip >/dev/null

info "Installing the current yt-dlp release"
if [[ "${VM_YTDLP_CHANNEL:-stable}" == "nightly" ]]; then
  "${VM_VENV_DIR}/bin/python" -m pip install --disable-pip-version-check --upgrade --pre 'yt-dlp[default]'
else
  "${VM_VENV_DIR}/bin/python" -m pip install --disable-pip-version-check --upgrade 'yt-dlp[default]'
fi

install -m 0755 "${SCRIPT_DIR}/companion/vm_ytdlp_bridge.py" "${VM_BRIDGE_FILE}"

info "Generating a private pairing token and userscript"
"${VM_VENV_DIR}/bin/python" "${VM_BRIDGE_FILE}" --config "${VM_CONFIG_FILE}" init \
  --download-dir "${HOME}/Downloads/YouTube" \
  --userscript-template "${VM_USER_SCRIPT_TEMPLATE}" \
  --userscript-output "${VM_USER_SCRIPT_OUTPUT}" >/dev/null
chmod 0600 "${VM_CONFIG_FILE}" "${VM_USER_SCRIPT_OUTPUT}" 2>/dev/null || true

info "Registering the per-user background service"
mkdir -p "${VM_SERVICE_DIR}"
{
  printf '[Unit]\n'
  printf 'Description=yt-dlp for Violentmonkey localhost bridge\n'
  printf 'After=network-online.target\n\n'
  printf '[Service]\n'
  printf 'Type=simple\n'
  printf 'ExecStart="%s" "%s" --config "%s" serve\n' "${VM_VENV_DIR}/bin/python" "${VM_BRIDGE_FILE}" "${VM_CONFIG_FILE}"
  printf 'Restart=on-failure\n'
  printf 'RestartSec=3\n'
  printf 'NoNewPrivileges=true\n'
  printf 'PrivateTmp=true\n'
  printf 'UMask=0077\n'
  printf 'Environment=PYTHONUNBUFFERED=1\n\n'
  printf 'Environment="PATH=%s"\n\n' "${VM_VENV_DIR}/bin:${PATH}"
  printf 'Environment="DENO_DIR=%s"\n\n' "${VM_DENO_CACHE_ROOT}"
  printf '[Install]\n'
  printf 'WantedBy=default.target\n'
} > "${VM_SERVICE_FILE}"

if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  systemctl --user daemon-reload
  systemctl --user enable --now vm-yt-dlp.service
  good "Local bridge is running"
else
  warn "No systemd user session was detected. Start the bridge manually with:"
  printf '  %q %q --config %q serve\n' "${VM_VENV_DIR}/bin/python" "${VM_BRIDGE_FILE}" "${VM_CONFIG_FILE}"
fi

if command -v ffmpeg >/dev/null 2>&1; then
  good "ffmpeg detected"
else
  warn "ffmpeg is missing. Install it before downloading merged video or converted audio."
fi

if command -v deno >/dev/null 2>&1 || command -v node >/dev/null 2>&1 || command -v bun >/dev/null 2>&1; then
  good "JavaScript runtime detected for full YouTube support"
else
  warn "Install Deno or Node.js for yt-dlp's full YouTube signature support."
fi

printf '\n%bInstallation complete.%b\n' "${green}${bold}" "${reset}"
printf 'Open Violentmonkey → New script → Install from file, then select:\n%b  %s%b\n' "${bold}" "${VM_USER_SCRIPT_OUTPUT}" "${reset}"
printf '%bKeep that paired file private; it contains your local bridge token.%b\n\n' "${muted}" "${reset}"
