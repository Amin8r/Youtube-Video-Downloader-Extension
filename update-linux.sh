#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
VM_DATA_ROOT="${XDG_DATA_HOME:-${HOME}/.local/share}/vm-yt-dlp"
VM_CONFIG_ROOT="${XDG_CONFIG_HOME:-${HOME}/.config}/vm-yt-dlp"
VM_CONFIG_FILE="${VM_CONFIG_ROOT}/config.json"
VM_VENV_DIR="${VM_DATA_ROOT}/venv"
VM_BRIDGE_FILE="${VM_DATA_ROOT}/vm_ytdlp_bridge.py"
VM_USER_SCRIPT_OUTPUT="${SCRIPT_DIR}/yt-dlp-for-violentmonkey.paired.user.js"

[[ -x "${VM_VENV_DIR}/bin/python" ]] || { echo "Run install-linux.sh first." >&2; exit 1; }

if [[ "${VM_YTDLP_CHANNEL:-stable}" == "nightly" ]]; then
  "${VM_VENV_DIR}/bin/python" -m pip install --disable-pip-version-check --upgrade --pre 'yt-dlp[default]'
else
  "${VM_VENV_DIR}/bin/python" -m pip install --disable-pip-version-check --upgrade 'yt-dlp[default]'
fi

install -m 0755 "${SCRIPT_DIR}/companion/vm_ytdlp_bridge.py" "${VM_BRIDGE_FILE}"
"${VM_VENV_DIR}/bin/python" "${VM_BRIDGE_FILE}" --config "${VM_CONFIG_FILE}" init \
  --userscript-template "${SCRIPT_DIR}/userscript/yt-dlp-for-violentmonkey.user.js" \
  --userscript-output "${VM_USER_SCRIPT_OUTPUT}" >/dev/null
chmod 0600 "${VM_USER_SCRIPT_OUTPUT}" 2>/dev/null || true

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user restart vm-yt-dlp.service 2>/dev/null || true
fi
echo "Updated yt-dlp, the bridge, and the paired userscript. Reinstall the paired userscript in Violentmonkey."
