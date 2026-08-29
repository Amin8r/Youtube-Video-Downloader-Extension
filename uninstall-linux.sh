#!/usr/bin/env bash
set -Eeuo pipefail

VM_DATA_ROOT="${XDG_DATA_HOME:-${HOME}/.local/share}/vm-yt-dlp"
VM_CONFIG_ROOT="${XDG_CONFIG_HOME:-${HOME}/.config}/vm-yt-dlp"
VM_SERVICE_FILE="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user/vm-yt-dlp.service"

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now vm-yt-dlp.service 2>/dev/null || true
fi
if [[ -f "${VM_SERVICE_FILE}" ]]; then
  unlink "${VM_SERVICE_FILE}"
fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload 2>/dev/null || true
fi
if [[ -d "${VM_DATA_ROOT}" ]]; then
  find "${VM_DATA_ROOT}" -depth -delete
fi

echo "Removed the bridge application and background service."
echo "Preserved settings/token at: ${VM_CONFIG_ROOT}"
echo "Preserved all downloaded files. Remove the userscript from Violentmonkey manually."
