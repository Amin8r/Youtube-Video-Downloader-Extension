#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
VM_DATA_ROOT="${XDG_DATA_HOME:-${HOME}/.local/share}/vm-yt-dlp"
VM_CONFIG_ROOT="${XDG_CONFIG_HOME:-${HOME}/.config}/vm-yt-dlp"
VM_DENO_CACHE_ROOT="${DENO_DIR:-${XDG_CACHE_HOME:-${HOME}/.cache}/deno}"
VM_CONFIG_FILE="${VM_CONFIG_ROOT}/config.json"
VM_VENV_DIR="${VM_DATA_ROOT}/venv"
VM_BRIDGE_FILE="${VM_DATA_ROOT}/vm_ytdlp_bridge.py"
VM_SERVICE_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
VM_SERVICE_FILE="${VM_SERVICE_DIR}/vm-yt-dlp.service"
VM_USER_SCRIPT_TEMPLATE="${SCRIPT_DIR}/userscript/yt-dlp-for-violentmonkey.user.js"
VM_USER_SCRIPT_OUTPUT="${SCRIPT_DIR}/yt-dlp-for-violentmonkey.paired.user.js"

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

systemd_escape() {
  local value="$1"
  [[ "${value}" != *$'\n'* && "${value}" != *$'\r'* ]] \
    || die "A path or environment variable contains a newline and cannot be written to systemd."
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//%/%%}"
  printf '%s' "${value}"
}

[[ -x "${VM_VENV_DIR}/bin/python" ]] && "${VM_VENV_DIR}/bin/python" -m pip --version >/dev/null 2>&1 \
  || die "Run install-linux.sh first."
[[ -f "${SCRIPT_DIR}/companion/vm_ytdlp_bridge.py" ]] \
  || die "Companion source is missing from ${SCRIPT_DIR}/companion/vm_ytdlp_bridge.py."
[[ -f "${VM_USER_SCRIPT_TEMPLATE}" ]] \
  || die "Userscript template is missing from ${VM_USER_SCRIPT_TEMPLATE}."
[[ -f "${VM_CONFIG_FILE}" ]] \
  || die "Configuration not found at ${VM_CONFIG_FILE}. Run install-linux.sh first."

if [[ "${VM_YTDLP_CHANNEL:-stable}" == "nightly" ]]; then
  "${VM_VENV_DIR}/bin/python" -m pip install --disable-pip-version-check --upgrade --pre 'yt-dlp[default]'
else
  "${VM_VENV_DIR}/bin/python" -m pip install --disable-pip-version-check --upgrade 'yt-dlp[default]'
fi

install -m 0755 "${SCRIPT_DIR}/companion/vm_ytdlp_bridge.py" "${VM_BRIDGE_FILE}"
"${VM_VENV_DIR}/bin/python" "${VM_BRIDGE_FILE}" --config "${VM_CONFIG_FILE}" init \
  --userscript-template "${VM_USER_SCRIPT_TEMPLATE}" \
  --userscript-output "${VM_USER_SCRIPT_OUTPUT}" >/dev/null
chmod 0600 "${VM_USER_SCRIPT_OUTPUT}" 2>/dev/null || true

if [[ -f "${VM_SERVICE_FILE}" ]] || (command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1); then
  mkdir -p "${VM_SERVICE_DIR}" "${VM_DENO_CACHE_ROOT}"
  ESC_VENV_PYTHON="$(systemd_escape "${VM_VENV_DIR}/bin/python")"
  ESC_BRIDGE_FILE="$(systemd_escape "${VM_BRIDGE_FILE}")"
  ESC_CONFIG_FILE="$(systemd_escape "${VM_CONFIG_FILE}")"
  ESC_PATH="$(systemd_escape "${VM_VENV_DIR}/bin:${PATH}")"
  ESC_DENO_DIR="$(systemd_escape "${VM_DENO_CACHE_ROOT}")"
  {
    printf '[Unit]\n'
    printf 'Description=yt-dlp for Violentmonkey localhost bridge\n'
    printf 'After=network-online.target\n\n'
    printf '[Service]\n'
    printf 'Type=simple\n'
    printf 'ExecStart="%s" "%s" --config "%s" serve\n' "${ESC_VENV_PYTHON}" "${ESC_BRIDGE_FILE}" "${ESC_CONFIG_FILE}"
    printf 'Restart=on-failure\n'
    printf 'RestartSec=3\n'
    printf 'NoNewPrivileges=true\n'
    printf 'PrivateTmp=true\n'
    printf 'UMask=0077\n'
    printf 'Environment=PYTHONUNBUFFERED=1\n'
    printf 'Environment="PATH=%s"\n' "${ESC_PATH}"
    printf 'Environment="DENO_DIR=%s"\n\n' "${ESC_DENO_DIR}"
    printf '[Install]\n'
    printf 'WantedBy=default.target\n'
  } > "${VM_SERVICE_FILE}"
fi

if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  systemctl --user daemon-reload
  systemctl --user restart vm-yt-dlp.service
  echo "Updated yt-dlp, the bridge, the systemd service, and the paired userscript. Reinstall the paired userscript in Violentmonkey."
else
  echo "Updated yt-dlp, the bridge, and the paired userscript. Reinstall the paired userscript in Violentmonkey."
  echo "Warning: No systemd user session was detected; restart your manually running bridge process to apply the update." >&2
fi