#!/usr/bin/env python3
"""Secure localhost bridge between a Violentmonkey userscript and yt-dlp.

The HTTP API deliberately exposes a small, typed option surface. It never
accepts raw yt-dlp arguments and never sends browser cookies through HTTP;
yt-dlp reads the selected local browser profile directly.
"""

from __future__ import annotations

import argparse
import collections
import copy
import dataclasses
import datetime as dt
import hmac
import importlib.util
import json
import os
import pathlib
import queue
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Iterable, Mapping, Sequence


APP_NAME = "yt-dlp for Violentmonkey Bridge"
APP_VERSION = "1.5.0"
API_VERSION = 1
DEFAULT_PORT = 17442
MAX_BODY_BYTES = 64 * 1024
MAX_JOBS = 100
MAX_LOG_LINES = 80
MAX_INFO_BYTES = 24 * 1024 * 1024
MAX_RECOVERY_BYTES = 128 * 1024
INFO_TIMEOUT_SECONDS = 150
MAX_JOB_RETRIES = 5
JOB_RETRY_BASE_SECONDS = 3.0
JOB_RETRY_MAX_SECONDS = 30.0

PROGRESS_PREFIX = "__VMYTDLP_PROGRESS__"
OUTPUT_PREFIX = "__VMYTDLP_OUTPUT__"

TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})
RESUMABLE_STATUSES = frozenset({"interrupted", "failed", "cancelled"})
RECOVERY_SCHEMA_VERSION = 1
RECOVERY_DIRNAME = ".vm-yt-dlp-resume"
VIDEO_HOSTS = frozenset(
    {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
        "www.youtu.be",
    }
)
COOKIE_BROWSERS = frozenset(
    {"brave", "chrome", "chromium", "edge", "firefox", "opera", "safari", "vivaldi", "whale"}
)
COOKIE_KEYRINGS = frozenset({"basictext", "gnomekeyring", "kwallet", "kwallet5", "kwallet6"})
PROXY_SCHEMES = frozenset({"http", "https", "socks4", "socks4a", "socks5"})
CONTAINERS = frozenset({"auto", "mp4", "mkv", "webm"})
AUDIO_CODECS = frozenset({"mp3", "m4a", "opus", "flac", "wav"})
AUDIO_QUALITIES = frozenset({"0", "320K", "256K", "192K", "160K", "128K", "96K"})
SUBTITLE_MODES = frozenset({"none", "manual", "automatic", "both"})
SUBTITLE_FORMATS = frozenset({"best", "srt", "vtt"})
THUMBNAIL_FORMATS = frozenset({"original", "jpg", "png", "webp"})
PRESET_HEIGHTS = frozenset({144, 240, 360, 480, 720, 1080, 1440, 2160, 4320})
DOWNLOAD_MODES = frozenset({"video", "audio", "merge"})

FORMAT_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,32}$")
SUBTITLE_LANGS_RE = re.compile(r"^[A-Za-z0-9_.*?,+-]{1,240}$")
ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def default_config_path() -> pathlib.Path:
    override = os.environ.get("VM_YTDLP_CONFIG")
    if override:
        return pathlib.Path(override).expanduser()
    if os.name == "nt":
        base = pathlib.Path(os.environ.get("APPDATA", pathlib.Path.home() / "AppData" / "Roaming"))
        return base / "vm-yt-dlp" / "config.json"
    base = pathlib.Path(os.environ.get("XDG_CONFIG_HOME", pathlib.Path.home() / ".config"))
    return base / "vm-yt-dlp" / "config.json"


def default_download_dir() -> pathlib.Path:
    return pathlib.Path.home() / "Downloads" / "YouTube"


def clean_text(value: Any, limit: int = 500) -> str:
    text = ANSI_RE.sub("", str(value or "")).replace("\x00", "")
    text = text.replace("\r", " ").strip()
    return text[:limit]


def optional_number(value: Any) -> int | float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return value
    try:
        number = float(str(value))
    except (TypeError, ValueError):
        return None
    return int(number) if number.is_integer() else number


class BridgeError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str = "bad_request",
        status: int = HTTPStatus.BAD_REQUEST,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = int(status)
        self.details = dict(details or {})


@dataclasses.dataclass(slots=True)
class BridgeConfig:
    token: str
    port: int
    download_dir: pathlib.Path
    ytdlp_command: tuple[str, ...]
    concurrent_fragments: int = 4

    @classmethod
    def load(cls, path: pathlib.Path, *, create: bool = False) -> "BridgeConfig":
        if not path.exists():
            if not create:
                raise BridgeError(
                    f"Configuration not found: {path}. Run the installer or the 'init' command first.",
                    code="config_missing",
                    status=HTTPStatus.INTERNAL_SERVER_ERROR,
                )
            cls.create(path)

        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise BridgeError(
                f"Could not read configuration: {exc}",
                code="config_invalid",
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            ) from exc

        token = str(raw.get("token", ""))
        if len(token) < 32:
            raise BridgeError(
                "The configured API token is missing or too short.",
                code="config_invalid",
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )

        port = raw.get("port", DEFAULT_PORT)
        if not isinstance(port, int) or isinstance(port, bool) or not (1024 <= port <= 65535):
            raise BridgeError(
                "The configured port must be an integer between 1024 and 65535.",
                code="config_invalid",
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )

        download_dir = pathlib.Path(str(raw.get("download_dir", default_download_dir()))).expanduser()
        command_raw = raw.get("ytdlp_command")
        if command_raw is None:
            ytdlp_command = discover_ytdlp_command()
        elif isinstance(command_raw, str):
            ytdlp_command = (command_raw,)
        elif isinstance(command_raw, list) and command_raw and all(isinstance(item, str) and item for item in command_raw):
            ytdlp_command = tuple(command_raw)
        else:
            raise BridgeError(
                "ytdlp_command must be a non-empty string or string array.",
                code="config_invalid",
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )

        fragments = raw.get("concurrent_fragments", 4)
        if not isinstance(fragments, int) or isinstance(fragments, bool) or not (1 <= fragments <= 16):
            fragments = 4

        return cls(
            token=token,
            port=port,
            download_dir=download_dir,
            ytdlp_command=ytdlp_command,
            concurrent_fragments=fragments,
        )

    @classmethod
    def create(
        cls,
        path: pathlib.Path,
        *,
        port: int = DEFAULT_PORT,
        download_dir: pathlib.Path | None = None,
        force: bool = False,
    ) -> pathlib.Path:
        if path.exists() and not force:
            return path
        if not (1024 <= port <= 65535):
            raise BridgeError("Port must be between 1024 and 65535.")

        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        payload = {
            "token": secrets.token_urlsafe(40),
            "port": port,
            "download_dir": str((download_dir or default_download_dir()).expanduser()),
            "concurrent_fragments": 4,
        }
        temporary = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
        temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        try:
            os.chmod(temporary, 0o600)
        except OSError:
            pass
        os.replace(temporary, path)
        return path


def discover_ytdlp_command() -> tuple[str, ...]:
    if importlib.util.find_spec("yt_dlp") is not None:
        return (sys.executable, "-m", "yt_dlp")
    executable = shutil.which("yt-dlp")
    if executable:
        return (executable,)
    return (sys.executable, "-m", "yt_dlp")


def normalize_youtube_url(url: Any) -> str:
    if not isinstance(url, str) or len(url) > 2048:
        raise BridgeError("A valid YouTube video URL is required.", code="invalid_url")
    try:
        parsed = urllib.parse.urlsplit(url.strip())
    except ValueError as exc:
        raise BridgeError("The YouTube URL could not be parsed.", code="invalid_url") from exc

    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme != "https" or host not in VIDEO_HOSTS:
        raise BridgeError("Only HTTPS YouTube video URLs are accepted.", code="unsupported_url")

    video_id = ""
    path_parts = [urllib.parse.unquote(part) for part in parsed.path.split("/") if part]
    if host in {"youtu.be", "www.youtu.be"}:
        if path_parts:
            video_id = path_parts[0]
    elif parsed.path.rstrip("/") == "/watch":
        video_id = urllib.parse.parse_qs(parsed.query).get("v", [""])[0]
    elif path_parts and path_parts[0] in {"shorts", "live", "embed"} and len(path_parts) >= 2:
        video_id = path_parts[1]

    if not VIDEO_ID_RE.fullmatch(video_id):
        raise BridgeError("This page does not contain a supported YouTube video ID.", code="unsupported_url")
    return f"https://www.youtube.com/watch?v={video_id}"


def validate_proxy_url(raw: Any) -> str | None:
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str) or len(raw) > 2048:
        raise BridgeError("Proxy URL must be a string no longer than 2048 characters.", code="invalid_proxy")
    if any(ord(char) < 33 or ord(char) == 127 for char in raw):
        raise BridgeError("Proxy URL must not contain spaces or control characters.", code="invalid_proxy")
    try:
        parsed = urllib.parse.urlsplit(raw)
        port = parsed.port
        hostname = parsed.hostname
    except ValueError as exc:
        raise BridgeError("Proxy URL could not be parsed.", code="invalid_proxy") from exc
    if parsed.scheme.lower() not in PROXY_SCHEMES:
        raise BridgeError("Proxy URL must use HTTP, HTTPS, SOCKS4, SOCKS4A, or SOCKS5.", code="invalid_proxy")
    if not hostname:
        raise BridgeError("Proxy URL must contain a host.", code="invalid_proxy")
    if port is not None and not (1 <= port <= 65535):
        raise BridgeError("Proxy port must be between 1 and 65535.", code="invalid_proxy")
    if parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise BridgeError("Proxy URL must not contain a path, query, or fragment.", code="invalid_proxy")
    return raw


def redact_proxy_reference(value: Any, proxy_url: str | None) -> str:
    text = str(value or "")
    return text.replace(proxy_url, "[configured proxy]") if proxy_url else text


def validate_local_text(value: Any, *, field: str, limit: int = 512) -> str:
    if value is None:
        return ""
    if not isinstance(value, str) or len(value) > limit or any(char in value for char in ("\x00", "\n", "\r")):
        raise BridgeError(f"Invalid {field} value.", code="invalid_cookie_options")
    return value.strip()


def validate_cookie_options(raw: Any) -> dict[str, Any]:
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise BridgeError("Cookie settings must be an object.", code="invalid_cookie_options")
    enabled = raw.get("enabled", False)
    if not isinstance(enabled, bool):
        raise BridgeError("Cookie enabled must be true or false.", code="invalid_cookie_options")
    browser = str(raw.get("browser", "firefox")).lower()
    if browser not in COOKIE_BROWSERS:
        raise BridgeError("Unsupported cookie browser.", code="invalid_cookie_options")
    profile = validate_local_text(raw.get("profile", ""), field="browser profile")
    keyring = validate_local_text(raw.get("keyring", ""), field="browser keyring", limit=32).lower()
    if keyring and keyring not in COOKIE_KEYRINGS:
        raise BridgeError("Unsupported browser keyring.", code="invalid_cookie_options")
    container = validate_local_text(raw.get("container", ""), field="Firefox container", limit=128)
    if container and browser != "firefox":
        raise BridgeError("Firefox containers can only be used with Firefox cookies.", code="invalid_cookie_options")
    return {
        "enabled": enabled,
        "browser": browser,
        "profile": profile,
        "keyring": keyring,
        "container": container,
    }


def cookie_spec(options: Mapping[str, Any]) -> str | None:
    if not options.get("enabled"):
        return None
    spec = str(options["browser"])
    if options.get("keyring"):
        spec += "+" + str(options["keyring"])
    if options.get("profile"):
        spec += ":" + str(options["profile"])
    if options.get("container"):
        spec += "::" + str(options["container"])
    return spec


def validate_bool(raw: Mapping[str, Any], key: str, default: bool = False) -> bool:
    value = raw.get(key, default)
    if not isinstance(value, bool):
        raise BridgeError(f"{key} must be true or false.", code="invalid_options")
    return value


def validate_job_payload(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise BridgeError("The job request must be a JSON object.", code="invalid_job")

    url = normalize_youtube_url(raw.get("url"))
    download_mode_raw = raw.get("download_mode")
    if download_mode_raw is None:
        requested_media_type = str(raw.get("media_type", "video"))
        if requested_media_type not in {"video", "audio"}:
            raise BridgeError("media_type must be video or audio.", code="invalid_options")
        download_mode = "audio" if requested_media_type == "audio" else "merge"
    else:
        download_mode = str(download_mode_raw)
        if download_mode not in DOWNLOAD_MODES:
            raise BridgeError("download_mode must be video, audio, or merge.", code="invalid_options")
        expected_media_type = "audio" if download_mode == "audio" else "video"
        requested_media_type = str(raw.get("media_type", expected_media_type))
        if requested_media_type not in {"video", "audio"}:
            raise BridgeError("media_type must be video or audio.", code="invalid_options")
        if requested_media_type != expected_media_type:
            raise BridgeError("media_type does not match download_mode.", code="invalid_options")
    media_type = "audio" if download_mode == "audio" else "video"

    selection_raw = raw.get("selection", {})
    if not isinstance(selection_raw, dict):
        raise BridgeError("selection must be an object.", code="invalid_options")
    selection_type = str(selection_raw.get("type", "preset"))
    if selection_type not in {"preset", "exact", "streams"}:
        raise BridgeError("Unsupported format selection type.", code="invalid_options")

    selection: dict[str, Any] = {"type": selection_type}
    if selection_type == "streams":
        if download_mode != "merge":
            raise BridgeError("Separate stream selection is available only in Merge mode.", code="invalid_options")
        video_format_id = str(selection_raw.get("video_format_id", ""))
        audio_format_id = str(selection_raw.get("audio_format_id", ""))
        if not FORMAT_ID_RE.fullmatch(video_format_id) or not FORMAT_ID_RE.fullmatch(audio_format_id):
            raise BridgeError("Invalid video or audio yt-dlp format ID.", code="invalid_options")
        if video_format_id == audio_format_id:
            raise BridgeError("Merge mode requires different video and audio streams.", code="invalid_options")
        selection.update({"video_format_id": video_format_id, "audio_format_id": audio_format_id})
    elif selection_type == "preset":
        preset = selection_raw.get("preset", "best")
        if preset != "best":
            try:
                preset = int(preset)
            except (TypeError, ValueError) as exc:
                raise BridgeError("Invalid quality preset.", code="invalid_options") from exc
            if preset not in PRESET_HEIGHTS:
                raise BridgeError("Unsupported quality preset.", code="invalid_options")
        selection["preset"] = preset
    else:
        format_id = str(selection_raw.get("format_id", ""))
        if not FORMAT_ID_RE.fullmatch(format_id):
            raise BridgeError("Invalid yt-dlp format ID.", code="invalid_options")
        has_video = selection_raw.get("has_video") is True
        has_audio = selection_raw.get("has_audio") is True
        if download_mode in {"video", "merge"} and not has_video:
            raise BridgeError("The selected exact format does not contain video.", code="invalid_options")
        if download_mode == "audio" and not has_audio:
            raise BridgeError("The selected exact format does not contain audio.", code="invalid_options")
        if download_mode == "video" and has_audio:
            raise BridgeError(
                "Video-only mode requires an exact format without an audio track.",
                code="invalid_options",
            )
        selection.update({"format_id": format_id, "has_video": has_video, "has_audio": has_audio})

    container = str(raw.get("container", "auto")).lower()
    if container not in CONTAINERS:
        raise BridgeError("Unsupported output container.", code="invalid_options")

    audio_codec = str(raw.get("audio_codec", "mp3")).lower()
    audio_quality = str(raw.get("audio_quality", "0"))
    if audio_codec not in AUDIO_CODECS or audio_quality not in AUDIO_QUALITIES:
        raise BridgeError("Unsupported audio conversion setting.", code="invalid_options")

    if validate_bool(raw, "keep_separate_streams"):
        raise BridgeError(
            "Keeping merge inputs is no longer supported. Choose Video only, Audio only, or Merge mode.",
            code="invalid_options",
        )

    retry_count = raw.get("retry_count", 2)
    if isinstance(retry_count, bool) or not isinstance(retry_count, int) or not (0 <= retry_count <= MAX_JOB_RETRIES):
        raise BridgeError(
            f"retry_count must be an integer between 0 and {MAX_JOB_RETRIES}.",
            code="invalid_options",
        )

    extras_raw = raw.get("extras", {})
    if not isinstance(extras_raw, dict):
        raise BridgeError("extras must be an object.", code="invalid_options")
    subtitle_mode = str(extras_raw.get("subtitle_mode", "none"))
    subtitle_format = str(extras_raw.get("subtitle_format", "best"))
    subtitle_languages = str(extras_raw.get("subtitle_languages", "en.*,en"))
    if subtitle_mode not in SUBTITLE_MODES or subtitle_format not in SUBTITLE_FORMATS:
        raise BridgeError("Unsupported subtitle setting.", code="invalid_options")
    if subtitle_mode != "none" and not SUBTITLE_LANGS_RE.fullmatch(subtitle_languages):
        raise BridgeError(
            "Subtitle languages may contain language codes, commas, wildcards, plus, and minus only.",
            code="invalid_options",
        )

    thumbnail_format = str(extras_raw.get("thumbnail_format", "original"))
    if thumbnail_format not in THUMBNAIL_FORMATS:
        raise BridgeError("Unsupported thumbnail format.", code="invalid_options")

    title_hint = clean_text(raw.get("title_hint", "YouTube video"), 240) or "YouTube video"
    thumbnail_hint = str(raw.get("thumbnail_hint", ""))[:2048]
    if thumbnail_hint and not thumbnail_hint.startswith(("https://i.ytimg.com/", "https://img.youtube.com/")):
        thumbnail_hint = ""

    return {
        "url": url,
        "media_type": media_type,
        "download_mode": download_mode,
        "selection": selection,
        "container": container,
        "audio_codec": audio_codec,
        "audio_quality": audio_quality,
        "retry_count": retry_count,
        "cookies": validate_cookie_options(raw.get("cookies")),
        "proxy_url": validate_proxy_url(raw.get("proxy_url")),
        "allow_invalid_certificates": validate_bool(raw, "allow_invalid_certificates"),
        "extras": {
            "subtitle_mode": subtitle_mode,
            "subtitle_languages": subtitle_languages,
            "subtitle_format": subtitle_format,
            "embed_subtitles": validate_bool(extras_raw, "embed_subtitles"),
            "write_thumbnail": validate_bool(extras_raw, "write_thumbnail"),
            "embed_thumbnail": validate_bool(extras_raw, "embed_thumbnail"),
            "thumbnail_format": thumbnail_format,
            "write_info_json": validate_bool(extras_raw, "write_info_json"),
            "write_description": validate_bool(extras_raw, "write_description"),
            "embed_metadata": validate_bool(extras_raw, "embed_metadata", True),
        },
        "title_hint": title_hint,
        "thumbnail_hint": thumbnail_hint,
    }


def validate_resume_payload(raw: Any) -> dict[str, Any]:
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise BridgeError("The resume request must be a JSON object.", code="invalid_options")
    return {
        "cookies": validate_cookie_options(raw.get("cookies")),
        "proxy_url": validate_proxy_url(raw.get("proxy_url")),
        "allow_invalid_certificates": validate_bool(raw, "allow_invalid_certificates"),
    }


def bool_codec(value: Any) -> str:
    text = str(value or "none").strip().lower()
    return "none" if text in {"", "none", "null"} else text


def sanitize_info(raw: Mapping[str, Any]) -> dict[str, Any]:
    formats: list[dict[str, Any]] = []
    for item in raw.get("formats") or []:
        if not isinstance(item, dict):
            continue
        format_id = str(item.get("format_id", ""))
        if not FORMAT_ID_RE.fullmatch(format_id):
            continue
        vcodec = bool_codec(item.get("vcodec"))
        acodec = bool_codec(item.get("acodec"))
        if vcodec == "none" and acodec == "none":
            continue
        protocol = clean_text(item.get("protocol"), 40)
        if protocol in {"mhtml", "images"}:
            continue
        formats.append(
            {
                "format_id": format_id,
                "format_note": clean_text(item.get("format_note"), 80),
                "ext": clean_text(item.get("ext"), 12),
                "resolution": clean_text(item.get("resolution"), 40),
                "width": optional_number(item.get("width")),
                "height": optional_number(item.get("height")),
                "fps": optional_number(item.get("fps")),
                "vcodec": vcodec,
                "acodec": acodec,
                "dynamic_range": clean_text(item.get("dynamic_range"), 20),
                "language": clean_text(item.get("language"), 40),
                "filesize": optional_number(item.get("filesize")),
                "filesize_approx": optional_number(item.get("filesize_approx")),
                "tbr": optional_number(item.get("tbr")),
                "abr": optional_number(item.get("abr")),
                "protocol": protocol,
                "has_video": vcodec != "none",
                "has_audio": acodec != "none",
            }
        )

    def subtitle_map(value: Any) -> dict[str, list[str]]:
        result: dict[str, list[str]] = {}
        if not isinstance(value, dict):
            return result
        for language, entries in value.items():
            if not isinstance(language, str) or len(language) > 80 or not isinstance(entries, list):
                continue
            extensions = sorted(
                {
                    clean_text(entry.get("ext"), 16)
                    for entry in entries
                    if isinstance(entry, dict) and entry.get("ext")
                }
            )
            result[language] = extensions
        return result

    thumbnail = str(raw.get("thumbnail") or "")
    try:
        thumbnail_parts = urllib.parse.urlsplit(thumbnail)
        thumbnail_host = (thumbnail_parts.hostname or "").lower()
    except ValueError:
        thumbnail_parts = urllib.parse.SplitResult("", "", "", "", "")
        thumbnail_host = ""
    if thumbnail_parts.scheme != "https" or not (
        thumbnail_host == "ytimg.com"
        or thumbnail_host.endswith(".ytimg.com")
        or thumbnail_host == "ggpht.com"
        or thumbnail_host.endswith(".ggpht.com")
    ):
        thumbnail = ""
    return {
        "id": clean_text(raw.get("id"), 40),
        "title": clean_text(raw.get("title"), 500),
        "channel": clean_text(raw.get("channel") or raw.get("uploader"), 240),
        "channel_id": clean_text(raw.get("channel_id"), 80),
        "duration": optional_number(raw.get("duration")),
        "duration_string": clean_text(raw.get("duration_string"), 40),
        "upload_date": clean_text(raw.get("upload_date"), 16),
        "live_status": clean_text(raw.get("live_status"), 40),
        "thumbnail": thumbnail,
        "formats": formats,
        "subtitles": subtitle_map(raw.get("subtitles")),
        "automatic_captions": subtitle_map(raw.get("automatic_captions")),
    }


def cookie_args(options: Mapping[str, Any]) -> list[str]:
    spec = cookie_spec(options)
    return ["--cookies-from-browser", spec] if spec else []


def proxy_args(proxy_url: str | None) -> list[str]:
    return ["--proxy", proxy_url] if proxy_url else []


def certificate_args(allow_invalid_certificates: Any) -> list[str]:
    if not isinstance(allow_invalid_certificates, bool):
        raise BridgeError("allow_invalid_certificates must be true or false.", code="invalid_options")
    return ["--no-check-certificates"] if allow_invalid_certificates else []


class YtDlpRunner:
    def __init__(self, config: BridgeConfig) -> None:
        self.config = config
        self._info_slots = threading.BoundedSemaphore(2)
        self._version_lock = threading.Lock()
        self._cached_version: str | None = None

    @property
    def command(self) -> list[str]:
        return list(self.config.ytdlp_command)

    def javascript_runtime(self) -> str | None:
        for runtime, executable_names in (
            ("deno", ("deno",)),
            ("node", ("node",)),
            ("quickjs", ("qjs", "quickjs")),
            ("bun", ("bun",)),
        ):
            if any(shutil.which(name) for name in executable_names):
                return runtime
        return None

    def javascript_runtime_args(self) -> list[str]:
        runtime = self.javascript_runtime()
        return ["--js-runtimes", runtime] if runtime else []

    def version(self) -> str:
        with self._version_lock:
            if self._cached_version is not None:
                return self._cached_version
            try:
                result = subprocess.run(
                    [*self.command, "--version"],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=15,
                    check=False,
                )
                self._cached_version = clean_text(result.stdout or result.stderr, 120) if result.returncode == 0 else "unavailable"
            except (OSError, subprocess.SubprocessError):
                self._cached_version = "unavailable"
            return self._cached_version

    def extract_info(
        self,
        url: Any,
        cookies: Any,
        proxy_url: Any = None,
        allow_invalid_certificates: Any = False,
    ) -> dict[str, Any]:
        canonical_url = normalize_youtube_url(url)
        cookie_options = validate_cookie_options(cookies)
        validated_proxy = validate_proxy_url(proxy_url)
        if not self._info_slots.acquire(timeout=2):
            raise BridgeError("Too many metadata requests are already running. Try again shortly.", code="busy", status=429)
        try:
            command = [
                *self.command,
                "--ignore-config",
                "--no-playlist",
                "--skip-download",
                "--dump-single-json",
                "--no-warnings",
                "--socket-timeout",
                "20",
                "--extractor-retries",
                "3",
                *self.javascript_runtime_args(),
                *cookie_args(cookie_options),
                *proxy_args(validated_proxy),
                *certificate_args(allow_invalid_certificates),
                "--",
                canonical_url,
            ]
            try:
                result = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=INFO_TIMEOUT_SECONDS,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                raise BridgeError(
                    "yt-dlp took too long to read this video's formats.",
                    code="metadata_timeout",
                    status=HTTPStatus.GATEWAY_TIMEOUT,
                ) from exc
            except OSError as exc:
                raise BridgeError(
                    "yt-dlp could not be started. Run the bridge doctor command.",
                    code="ytdlp_unavailable",
                    status=HTTPStatus.SERVICE_UNAVAILABLE,
                    details={"reason": clean_text(exc, 300)},
                ) from exc

            if len(result.stdout.encode("utf-8", errors="replace")) > MAX_INFO_BYTES:
                raise BridgeError("yt-dlp returned an unexpectedly large metadata response.", code="metadata_too_large", status=502)
            if result.returncode != 0:
                reason = clean_text(
                    redact_proxy_reference("\n".join((result.stderr or result.stdout).splitlines()[-12:]), validated_proxy),
                    1800,
                )
                raise BridgeError(
                    "yt-dlp could not read this video's formats.",
                    code="metadata_failed",
                    status=HTTPStatus.BAD_GATEWAY,
                    details={"reason": reason or "Unknown yt-dlp error"},
                )
            try:
                raw = json.loads(result.stdout)
            except json.JSONDecodeError as exc:
                raise BridgeError(
                    "yt-dlp returned invalid metadata.",
                    code="metadata_invalid",
                    status=HTTPStatus.BAD_GATEWAY,
                ) from exc
            if not isinstance(raw, dict):
                raise BridgeError("yt-dlp returned unexpected metadata.", code="metadata_invalid", status=502)
            return sanitize_info(raw)
        finally:
            self._info_slots.release()

    def build_download_command(self, options: Mapping[str, Any]) -> list[str]:
        download_dir = self.config.download_dir.expanduser().resolve()
        temporary_dir = download_dir / ".vm-yt-dlp-parts"
        download_dir.mkdir(parents=True, exist_ok=True)
        temporary_dir.mkdir(parents=True, exist_ok=True)

        selector = self._format_selector(options)
        validated_proxy = validate_proxy_url(options.get("proxy_url"))
        path_args = [
            "--paths",
            f"home:{download_dir}",
            "--paths",
            f"temp:{temporary_dir}",
        ]
        command = [
            *self.command,
            "--ignore-config",
            "--no-playlist",
            "--newline",
            "--progress",
            "--color",
            "never",
            "--continue",
            "--part",
            "--no-overwrites",
            "--no-keep-video",
            "--retries",
            "20",
            "--fragment-retries",
            "20",
            "--file-access-retries",
            "5",
            "--extractor-retries",
            "5",
            "--retry-sleep",
            "http:exp=1:30",
            "--retry-sleep",
            "fragment:exp=1:20",
            "--retry-sleep",
            "file_access:exp=1:10",
            "--retry-sleep",
            "extractor:exp=1:10",
            "--socket-timeout",
            "20",
            "--concurrent-fragments",
            str(self.config.concurrent_fragments),
            "--trim-filenames",
            "180",
            *path_args,
            "--output",
            "%(title).180B [%(id)s].%(ext)s",
            "--format",
            selector,
            "--progress-delta",
            "0.5",
            "--progress-template",
            (
                "download:"
                + PROGRESS_PREFIX
                + "%(progress.downloaded_bytes)s|%(progress.total_bytes)s|"
                + "%(progress.total_bytes_estimate)s|%(progress.speed)s|"
                + "%(progress.eta)s|%(progress.fragment_index)s|%(progress.fragment_count)s"
            ),
            "--print",
            f"after_move:{OUTPUT_PREFIX}%(filepath)s",
            *self.javascript_runtime_args(),
            *cookie_args(options["cookies"]),
            *proxy_args(validated_proxy),
            *certificate_args(options.get("allow_invalid_certificates", False)),
        ]

        container = str(options["container"])
        download_mode = str(options["download_mode"])
        if download_mode == "audio":
            command.extend(["--extract-audio", "--audio-format", str(options["audio_codec"])])
            if options["audio_codec"] in {"mp3", "m4a", "opus"}:
                command.extend(["--audio-quality", str(options["audio_quality"])])
        elif container != "auto":
            if download_mode == "merge":
                command.extend(["--merge-output-format", container, "--remux-video", container])
            else:
                command.extend(["--remux-video", container])

        extras = options["extras"]
        subtitle_mode = extras["subtitle_mode"]
        if subtitle_mode in {"manual", "both"}:
            command.append("--write-subs")
        if subtitle_mode in {"automatic", "both"}:
            command.append("--write-auto-subs")
        if subtitle_mode != "none":
            command.extend(["--sub-langs", extras["subtitle_languages"]])
            if extras["subtitle_format"] == "srt":
                command.extend(["--sub-format", "srt/best", "--convert-subs", "srt"])
            elif extras["subtitle_format"] == "vtt":
                command.extend(["--sub-format", "vtt/best"])
            if extras["embed_subtitles"] and download_mode != "audio":
                command.append("--embed-subs")

        if extras["write_thumbnail"] or extras["embed_thumbnail"]:
            command.append("--write-thumbnail")
            if extras["thumbnail_format"] != "original":
                command.extend(["--convert-thumbnails", extras["thumbnail_format"]])
        if extras["embed_thumbnail"]:
            command.append("--embed-thumbnail")
        if extras["write_info_json"]:
            command.append("--write-info-json")
        if extras["write_description"]:
            command.append("--write-description")
        if extras["embed_metadata"]:
            command.extend(["--embed-metadata", "--embed-chapters"])

        command.extend(["--", str(options["url"])])
        return command

    @staticmethod
    def _format_selector(options: Mapping[str, Any]) -> str:
        selection = options["selection"]
        download_mode = options["download_mode"]
        container = options["container"]
        if selection["type"] == "streams":
            return f"{selection['video_format_id']}+{selection['audio_format_id']}"
        if selection["type"] == "exact":
            format_id = selection["format_id"]
            if download_mode == "audio":
                return f"{format_id}/bestaudio/best"
            if download_mode == "video" or selection["has_audio"]:
                return format_id
            return f"{format_id}+bestaudio"

        preset = selection["preset"]
        height_filter = "" if preset == "best" else f"[height<={int(preset)}]"
        if download_mode == "audio":
            return "bestaudio/best"
        if download_mode == "video":
            if container == "mp4":
                return f"bv[ext=mp4]{height_filter}/bv{height_filter}"
            if container == "webm":
                return f"bv[ext=webm]{height_filter}/bv{height_filter}"
            return f"bv{height_filter}"
        if container == "mp4":
            return (
                f"bv[ext=mp4]{height_filter}+ba[ext=m4a]/"
                f"b[ext=mp4]{height_filter}/bv{height_filter}+ba/b{height_filter}"
            )
        if container == "webm":
            return (
                f"bv[ext=webm]{height_filter}+ba[ext=webm]/"
                f"b[ext=webm]{height_filter}/bv{height_filter}+ba/b{height_filter}"
            )
        return f"bv{height_filter}+ba/b{height_filter}"


class JobManager:
    def __init__(self, runner: YtDlpRunner) -> None:
        self.runner = runner
        self._jobs: "collections.OrderedDict[str, dict[str, Any]]" = collections.OrderedDict()
        self._queue: queue.Queue[str | None] = queue.Queue()
        self._lock = threading.RLock()
        self._revision = 0
        self._active_job_id: str | None = None
        self._active_process: subprocess.Popen[str] | None = None
        self._stopping = False
        self._recovery_dir = self.runner.config.download_dir.expanduser().resolve() / RECOVERY_DIRNAME
        self._prepare_recovery_dir()
        self._load_recovery_manifests()
        self._worker = threading.Thread(target=self._worker_loop, name="vm-ytdlp-worker", daemon=True)
        self._worker.start()

    def enqueue(self, raw: Any) -> dict[str, Any]:
        options = validate_job_payload(raw)
        with self._lock:
            self._prune_if_needed()
            job_id = uuid.uuid4().hex
            job = self._new_job(job_id, options)
            try:
                self._save_recovery_manifest(job)
            except OSError as exc:
                raise BridgeError(
                    "Could not create the download recovery record.",
                    code="recovery_write_failed",
                    status=HTTPStatus.INTERNAL_SERVER_ERROR,
                    details={"reason": clean_text(exc, 400)},
                ) from exc
            self._jobs[job_id] = job
            self._touch(job)
            snapshot = self._public_job(job)
        self._queue.put(job_id)
        return snapshot

    def list_jobs(self) -> dict[str, Any]:
        with self._lock:
            jobs = [self._public_job(job) for job in reversed(self._jobs.values())]
            return {"revision": self._revision, "jobs": jobs, "active_job_id": self._active_job_id}

    def get_job(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise BridgeError("Job not found.", code="job_not_found", status=HTTPStatus.NOT_FOUND)
            return self._public_job(job)

    def cancel(self, job_id: str) -> dict[str, Any]:
        process: subprocess.Popen[str] | None = None
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise BridgeError("Job not found.", code="job_not_found", status=HTTPStatus.NOT_FOUND)
            if job["status"] in TERMINAL_STATUSES:
                return self._public_job(job)
            if job["status"] == "interrupted":
                return self._public_job(job)
            job["cancel_requested"] = True
            if job["status"] == "queued":
                self._set_terminal(job, "cancelled", "Cancelled")
            elif self._active_job_id == job_id:
                job["phase"] = "Cancelling…"
                self._touch(job)
                process = self._active_process
            snapshot = self._public_job(job)
        if process is not None:
            self._terminate_process(process)
        return snapshot

    def resume(self, job_id: str, raw: Any) -> dict[str, Any]:
        network_options = validate_resume_payload(raw)
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise BridgeError("Job not found.", code="job_not_found", status=HTTPStatus.NOT_FOUND)
            if job["status"] not in RESUMABLE_STATUSES:
                raise BridgeError(
                    "Only interrupted, failed, or cancelled downloads can be resumed.",
                    code="job_not_resumable",
                    status=HTTPStatus.CONFLICT,
                )
            options = dict(job["options"])
            options.update(network_options)
            job["options"] = options
            job["status"] = "queued"
            job["phase"] = "Waiting to resume"
            job["started_at"] = None
            job["finished_at"] = None
            job["attempt"] = 0
            job["error"] = None
            job["cancel_requested"] = False
            job["progress"]["speed"] = None
            job["progress"]["eta"] = None
            job["logs"].append("[bridge] Resume requested; yt-dlp will continue compatible partial files.")
            try:
                self._save_recovery_manifest(job)
            except OSError as exc:
                job["status"] = "interrupted"
                job["phase"] = "Recovery record could not be updated"
                raise BridgeError(
                    "Could not update the download recovery record.",
                    code="recovery_write_failed",
                    status=HTTPStatus.INTERNAL_SERVER_ERROR,
                    details={"reason": clean_text(exc, 400)},
                ) from exc
            self._touch(job)
            snapshot = self._public_job(job)
        self._queue.put(job_id)
        return snapshot

    def forget(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise BridgeError("Job not found.", code="job_not_found", status=HTTPStatus.NOT_FOUND)
            if job["status"] not in {*TERMINAL_STATUSES, "interrupted"}:
                raise BridgeError("Active downloads cannot be forgotten.", code="job_busy", status=HTTPStatus.CONFLICT)
            self._jobs.pop(job_id, None)
            self._delete_recovery_manifest(job_id)
            self._revision += 1
            return True

    def clear_finished(self) -> int:
        with self._lock:
            removable = [job_id for job_id, job in self._jobs.items() if job["status"] == "completed"]
            for job_id in removable:
                self._jobs.pop(job_id, None)
            if removable:
                self._revision += 1
            return len(removable)

    def _new_job(
        self,
        job_id: str,
        options: Mapping[str, Any],
        *,
        status: str = "queued",
        created_at: str | None = None,
        recovered: bool = False,
    ) -> dict[str, Any]:
        now = utc_now()
        return {
            "id": job_id,
            "status": status,
            "phase": "Unfinished download found · ready to resume" if status == "interrupted" else "Waiting in queue",
            "created_at": created_at or now,
            "updated_at": now,
            "started_at": None,
            "finished_at": None,
            "title": options["title_hint"],
            "thumbnail": options["thumbnail_hint"],
            "url": options["url"],
            "media_type": options["media_type"],
            "download_mode": options["download_mode"],
            "output_mode": {
                "video": "video_only",
                "audio": "audio_only",
                "merge": "merged",
            }[options["download_mode"]],
            "attempt": 0,
            "max_attempts": options["retry_count"] + 1,
            "progress": {
                "percent": 0.0,
                "downloaded_bytes": None,
                "total_bytes": None,
                "speed": None,
                "eta": None,
                "fragment_index": None,
                "fragment_count": None,
            },
            "output_path": None,
            "error": None,
            "logs": ["[bridge] Recovered after the companion restarted."] if recovered else [],
            "cancel_requested": False,
            "recovered": recovered,
            "options": dict(options),
        }

    def _prepare_recovery_dir(self) -> None:
        self._recovery_dir.mkdir(parents=True, exist_ok=True)
        try:
            self._recovery_dir.chmod(0o700)
        except OSError:
            pass

    def _manifest_path(self, job_id: str) -> pathlib.Path:
        if not re.fullmatch(r"[a-f0-9]{32}", job_id):
            raise BridgeError("Invalid job ID.", code="invalid_job")
        return self._recovery_dir / f"{job_id}.json"

    @staticmethod
    def _persistable_options(options: Mapping[str, Any]) -> dict[str, Any]:
        persisted = copy.deepcopy(dict(options))
        persisted["cookies"] = validate_cookie_options(None)
        persisted["proxy_url"] = None
        persisted["allow_invalid_certificates"] = False
        return persisted

    def _save_recovery_manifest(self, job: Mapping[str, Any]) -> None:
        path = self._manifest_path(str(job["id"]))
        temporary_path = self._recovery_dir / f".{job['id']}.{uuid.uuid4().hex}.tmp"
        payload = {
            "schema_version": RECOVERY_SCHEMA_VERSION,
            "job_id": job["id"],
            "created_at": job["created_at"],
            "saved_at": utc_now(),
            "options": self._persistable_options(job["options"]),
        }
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > MAX_RECOVERY_BYTES:
            raise OSError("Recovery record is unexpectedly large.")
        descriptor = os.open(temporary_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, path)
            try:
                path.chmod(0o600)
            except OSError:
                pass
        finally:
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass

    def _delete_recovery_manifest(self, job_id: str) -> None:
        try:
            self._manifest_path(job_id).unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            sys.stderr.write(f"[bridge] Could not remove recovery record {job_id}: {clean_text(exc, 240)}\n")

    def _load_recovery_manifests(self) -> None:
        try:
            candidates = sorted(
                self._recovery_dir.glob("*.json"),
                key=lambda path: path.stat().st_mtime,
            )[-MAX_JOBS:]
        except OSError as exc:
            sys.stderr.write(f"[bridge] Could not scan recovery records: {clean_text(exc, 240)}\n")
            return
        for path in candidates:
            try:
                if not re.fullmatch(r"[a-f0-9]{32}\.json", path.name) or path.stat().st_size > MAX_RECOVERY_BYTES:
                    continue
                payload = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(payload, dict) or payload.get("schema_version") != RECOVERY_SCHEMA_VERSION:
                    continue
                job_id = str(payload.get("job_id", ""))
                if job_id != path.stem:
                    continue
                options = validate_job_payload(payload.get("options"))
                created_at = clean_text(payload.get("created_at"), 80) or utc_now()
                self._jobs[job_id] = self._new_job(
                    job_id,
                    options,
                    status="interrupted",
                    created_at=created_at,
                    recovered=True,
                )
                self._revision += 1
            except (BridgeError, OSError, UnicodeError, ValueError, TypeError, json.JSONDecodeError) as exc:
                sys.stderr.write(f"[bridge] Ignored invalid recovery record {path.name}: {clean_text(exc, 240)}\n")

    def stop(self) -> None:
        self._stopping = True
        with self._lock:
            process = self._active_process
        if process is not None:
            self._terminate_process(process)
        self._queue.put(None)
        self._worker.join(timeout=5)

    def _worker_loop(self) -> None:
        while not self._stopping:
            job_id = self._queue.get()
            if job_id is None:
                return
            try:
                self._run_job(job_id)
            except Exception as exc:  # Keep the queue alive after unexpected failures.
                with self._lock:
                    job = self._jobs.get(job_id)
                    if job and job["status"] not in TERMINAL_STATUSES:
                        self._append_log(job, traceback.format_exc(limit=4))
                        job["error"] = clean_text(exc, 800)
                        self._set_terminal(job, "failed", "Bridge error")

    def _run_job(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job["status"] in TERMINAL_STATUSES or job["cancel_requested"]:
                return
            job["started_at"] = utc_now()
            self._active_job_id = job_id
            self._touch(job)
            options = dict(job["options"])
            max_attempts = int(job["max_attempts"])

        try:
            command = self.runner.build_download_command(options)
            for attempt in range(1, max_attempts + 1):
                with self._lock:
                    job = self._jobs.get(job_id)
                    if job is None:
                        return
                    if job["cancel_requested"] or self._stopping:
                        self._set_terminal(job, "cancelled", "Cancelled")
                        return
                    job["attempt"] = attempt
                    job["status"] = "starting"
                    job["phase"] = "Starting yt-dlp"
                    job["error"] = None
                    self._touch(job)

                return_code, start_error = self._run_process_attempt(job_id, options, command)

                with self._lock:
                    job = self._jobs.get(job_id)
                    if job is None:
                        return
                    if job["cancel_requested"] or self._stopping:
                        self._set_terminal(job, "cancelled", "Cancelled")
                        return
                    if return_code == 0:
                        job["progress"]["percent"] = 100.0
                        self._set_terminal(job, "completed", "Complete")
                        return

                    if start_error:
                        job["error"] = start_error
                        self._append_log(job, f"[bridge] {start_error}")
                    elif not job["error"]:
                        meaningful = [line for line in job["logs"] if line and not line.startswith("[download]")]
                        job["error"] = (
                            clean_text("\n".join(meaningful[-8:]), 1800)
                            or f"yt-dlp exited with code {return_code}."
                        )

                    if attempt >= max_attempts:
                        self._set_terminal(job, "failed", "Download failed")
                        return

                    retry_delay = min(JOB_RETRY_MAX_SECONDS, JOB_RETRY_BASE_SECONDS * (2 ** (attempt - 1)))
                    next_attempt = attempt + 1
                    self._append_log(
                        job,
                        f"[bridge] Attempt {attempt}/{max_attempts} failed; retrying in {retry_delay:g} seconds.",
                    )
                    job["status"] = "starting"
                    job["phase"] = f"Retrying in {retry_delay:g}s · next attempt {next_attempt}/{max_attempts}"
                    self._touch(job)

                if not self._wait_for_retry(job_id, retry_delay):
                    with self._lock:
                        job = self._jobs.get(job_id)
                        if job and job["status"] not in TERMINAL_STATUSES:
                            self._set_terminal(job, "cancelled", "Cancelled")
                    return
        finally:
            with self._lock:
                self._active_process = None
                if self._active_job_id == job_id:
                    self._active_job_id = None

    def _run_process_attempt(
        self,
        job_id: str,
        options: Mapping[str, Any],
        command: Sequence[str],
    ) -> tuple[int | None, str | None]:
        popen_kwargs: dict[str, Any] = {
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "text": True,
            "encoding": "utf-8",
            "errors": "replace",
            "bufsize": 1,
        }
        if os.name == "nt":
            popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            popen_kwargs["start_new_session"] = True
        try:
            process = subprocess.Popen(command, **popen_kwargs)
        except OSError as exc:
            return None, f"Could not start yt-dlp: {clean_text(exc, 500)}"

        with self._lock:
            self._active_process = process
            job = self._jobs.get(job_id)
            if job:
                job["status"] = "downloading"
                job["phase"] = "Downloading"
                self._touch(job)
                should_cancel = bool(job["cancel_requested"])
            else:
                should_cancel = True

        if should_cancel:
            self._terminate_process(process)

        try:
            assert process.stdout is not None
            for raw_line in process.stdout:
                line = clean_text(redact_proxy_reference(raw_line, options.get("proxy_url")), 4000)
                if not line:
                    continue
                with self._lock:
                    job = self._jobs.get(job_id)
                    if job is None:
                        continue
                    if line.startswith(PROGRESS_PREFIX):
                        self._consume_progress(job, line[len(PROGRESS_PREFIX) :])
                    elif line.startswith(OUTPUT_PREFIX):
                        job["output_path"] = clean_text(line[len(OUTPUT_PREFIX) :], 1800)
                        self._touch(job)
                    else:
                        self._append_log(job, line)
                        lower = line.lower()
                        if any(marker in lower for marker in ("[merger]", "[extractaudio]", "[ffmpeg]", "[metadata]", "[embeds")):
                            job["status"] = "postprocessing"
                            job["phase"] = "Post-processing"
                            self._touch(job)
                        elif "extracting url" in lower or "downloading webpage" in lower:
                            job["phase"] = "Reading video data"
                            self._touch(job)
                        if line.startswith("ERROR:"):
                            job["error"] = line
                    should_cancel = bool(job["cancel_requested"])
                if should_cancel and process.poll() is None:
                    self._terminate_process(process)

            process.stdout.close()
            return process.wait(), None
        finally:
            if process.stdout is not None and not process.stdout.closed:
                process.stdout.close()
            if process.poll() is None:
                self._terminate_process(process)
            with self._lock:
                if self._active_process is process:
                    self._active_process = None

    def _wait_for_retry(self, job_id: str, delay: float) -> bool:
        deadline = time.monotonic() + max(0.0, delay)
        while True:
            with self._lock:
                job = self._jobs.get(job_id)
                if self._stopping or job is None or job["cancel_requested"]:
                    return False
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return True
            time.sleep(min(0.2, remaining))

    def _consume_progress(self, job: dict[str, Any], payload: str) -> None:
        values = payload.split("|")
        values.extend(["NA"] * (7 - len(values)))

        def number(index: int) -> int | float | None:
            return optional_number(values[index])

        downloaded = number(0)
        total = number(1) or number(2)
        speed = number(3)
        eta = number(4)
        fragment_index = number(5)
        fragment_count = number(6)
        percent = 0.0
        if downloaded is not None and total:
            percent = min(100.0, max(0.0, float(downloaded) / float(total) * 100))
        elif fragment_index is not None and fragment_count:
            percent = min(100.0, max(0.0, float(fragment_index) / float(fragment_count) * 100))
        progress = job["progress"]
        progress.update(
            {
                "percent": round(percent, 2),
                "downloaded_bytes": downloaded,
                "total_bytes": total,
                "speed": speed,
                "eta": eta,
                "fragment_index": fragment_index,
                "fragment_count": fragment_count,
            }
        )
        job["status"] = "downloading"
        job["phase"] = "Downloading"
        self._touch(job)

    def _append_log(self, job: dict[str, Any], line: str) -> None:
        for part in clean_text(line, 4000).splitlines():
            if part:
                job["logs"].append(part)
        if len(job["logs"]) > MAX_LOG_LINES:
            del job["logs"][:-MAX_LOG_LINES]
        self._touch(job)

    def _set_terminal(self, job: dict[str, Any], status: str, phase: str) -> None:
        job["status"] = status
        job["phase"] = phase
        job["finished_at"] = utc_now()
        self._touch(job)
        if status == "completed":
            self._delete_recovery_manifest(str(job["id"]))

    def _touch(self, job: dict[str, Any]) -> None:
        job["updated_at"] = utc_now()
        self._revision += 1

    def _public_job(self, job: Mapping[str, Any]) -> dict[str, Any]:
        public = copy.deepcopy({key: value for key, value in job.items() if key not in {"options", "cancel_requested"}})
        public["resumable"] = job["status"] in RESUMABLE_STATUSES
        return public

    def _prune_if_needed(self) -> None:
        if len(self._jobs) < MAX_JOBS:
            return
        for job_id, job in list(self._jobs.items()):
            if job["status"] == "completed":
                self._jobs.pop(job_id, None)
                if len(self._jobs) < MAX_JOBS:
                    return
        raise BridgeError(
            "The queue is full. Clear completed jobs or forget an unfinished download before adding another.",
            code="queue_full",
            status=409,
        )

    @staticmethod
    def _terminate_process(process: subprocess.Popen[str]) -> None:
        if process.poll() is not None:
            return
        try:
            if os.name == "nt":
                process.terminate()
            else:
                os.killpg(process.pid, signal.SIGTERM)
        except (OSError, ProcessLookupError):
            return

        def force_kill() -> None:
            time.sleep(3)
            if process.poll() is None:
                try:
                    if os.name == "nt":
                        process.kill()
                    else:
                        os.killpg(process.pid, signal.SIGKILL)
                except (OSError, ProcessLookupError):
                    pass

        threading.Thread(target=force_kill, name="vm-ytdlp-killer", daemon=True).start()


def origin_allowed(origin: str | None) -> bool:
    if not origin or origin == "null":
        return True
    try:
        parsed = urllib.parse.urlsplit(origin)
    except ValueError:
        return False
    return parsed.scheme == "https" and (parsed.hostname or "").lower() in VIDEO_HOSTS


class BridgeHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], config: BridgeConfig, runner: YtDlpRunner, jobs: JobManager) -> None:
        self.config = config
        self.runner = runner
        self.jobs = jobs
        super().__init__(address, BridgeRequestHandler)


class BridgeRequestHandler(BaseHTTPRequestHandler):
    server: BridgeHTTPServer
    protocol_version = "HTTP/1.1"
    server_version = "VMYtDlpBridge"
    sys_version = ""

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write(f"[{self.log_date_time_string()}] {self.client_address[0]} {fmt % args}\n")

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not self._request_envelope_valid(require_origin=True):
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_common_headers(content_length=0)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        try:
            if not self._request_envelope_valid():
                return
            path = urllib.parse.urlsplit(self.path).path
            if path == "/":
                self._json_response(
                    HTTPStatus.OK,
                    {"service": APP_NAME, "version": APP_VERSION, "status": "running", "api": API_VERSION},
                    authenticated=False,
                )
                return
            self._require_auth()
            if path == "/api/v1/health":
                self._json_response(
                    HTTPStatus.OK,
                    {
                        "service": APP_NAME,
                        "version": APP_VERSION,
                        "api_version": API_VERSION,
                        "status": "ready",
                        "capabilities": [
                            "proxy",
                            "invalid_certificates",
                            "job_retries",
                            "download_modes_v2",
                            "persistent_resume",
                        ],
                        "yt_dlp_version": self.server.runner.version(),
                        "ffmpeg_available": shutil.which("ffmpeg") is not None,
                        "javascript_runtime_available": self.server.runner.javascript_runtime() is not None,
                        "javascript_runtime": self.server.runner.javascript_runtime(),
                        "download_dir": str(self.server.config.download_dir.expanduser()),
                    },
                )
                return
            if path == "/api/v1/jobs":
                self._json_response(HTTPStatus.OK, self.server.jobs.list_jobs())
                return
            match = re.fullmatch(r"/api/v1/jobs/([a-f0-9]{32})", path)
            if match:
                self._json_response(HTTPStatus.OK, {"job": self.server.jobs.get_job(match.group(1))})
                return
            raise BridgeError("Endpoint not found.", code="not_found", status=HTTPStatus.NOT_FOUND)
        except BridgeError as exc:
            self._error_response(exc)
        except Exception:
            self._error_response(BridgeError("Internal bridge error.", code="internal_error", status=500))

    def do_POST(self) -> None:  # noqa: N802
        try:
            if not self._request_envelope_valid():
                return
            self._require_auth()
            path = urllib.parse.urlsplit(self.path).path
            body = self._read_json_body()
            if path == "/api/v1/info":
                if not isinstance(body, dict):
                    raise BridgeError("Request body must be an object.")
                info = self.server.runner.extract_info(
                    body.get("url"),
                    body.get("cookies"),
                    body.get("proxy_url"),
                    body.get("allow_invalid_certificates", False),
                )
                self._json_response(HTTPStatus.OK, {"info": info})
                return
            if path == "/api/v1/jobs":
                self._json_response(HTTPStatus.CREATED, {"job": self.server.jobs.enqueue(body)})
                return
            if path == "/api/v1/jobs/clear":
                self._json_response(HTTPStatus.OK, {"cleared": self.server.jobs.clear_finished()})
                return
            match = re.fullmatch(r"/api/v1/jobs/([a-f0-9]{32})/cancel", path)
            if match:
                self._json_response(HTTPStatus.OK, {"job": self.server.jobs.cancel(match.group(1))})
                return
            match = re.fullmatch(r"/api/v1/jobs/([a-f0-9]{32})/resume", path)
            if match:
                self._json_response(HTTPStatus.OK, {"job": self.server.jobs.resume(match.group(1), body)})
                return
            match = re.fullmatch(r"/api/v1/jobs/([a-f0-9]{32})/forget", path)
            if match:
                self.server.jobs.forget(match.group(1))
                self._json_response(HTTPStatus.OK, {"forgotten": match.group(1)})
                return
            raise BridgeError("Endpoint not found.", code="not_found", status=HTTPStatus.NOT_FOUND)
        except BridgeError as exc:
            self._error_response(exc)
        except Exception:
            traceback.print_exc()
            self._error_response(BridgeError("Internal bridge error.", code="internal_error", status=500))

    def _request_envelope_valid(self, *, require_origin: bool = False) -> bool:
        expected_hosts = {
            f"127.0.0.1:{self.server.server_port}",
            f"localhost:{self.server.server_port}",
        }
        if self.headers.get("Host", "").lower() not in expected_hosts:
            self._error_response(BridgeError("Invalid Host header.", code="invalid_host", status=HTTPStatus.FORBIDDEN))
            return False
        origin = self.headers.get("Origin")
        if (require_origin or origin) and not origin_allowed(origin):
            self._error_response(BridgeError("Origin is not allowed.", code="origin_denied", status=HTTPStatus.FORBIDDEN))
            return False
        return True

    def _require_auth(self) -> None:
        expected = f"Bearer {self.server.config.token}"
        supplied = self.headers.get("Authorization", "")
        if not hmac.compare_digest(supplied, expected):
            raise BridgeError("Invalid or missing bridge token.", code="unauthorized", status=HTTPStatus.UNAUTHORIZED)

    def _read_json_body(self) -> Any:
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            raise BridgeError("Content-Type must be application/json.", code="invalid_content_type", status=415)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise BridgeError("Invalid Content-Length.", code="invalid_body") from exc
        if length < 0 or length > MAX_BODY_BYTES:
            raise BridgeError("Request body is too large.", code="body_too_large", status=413)
        payload = self.rfile.read(length)
        try:
            return json.loads(payload.decode("utf-8")) if payload else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BridgeError("Request body is not valid JSON.", code="invalid_json") from exc

    def _json_response(self, status: int, payload: Mapping[str, Any], *, authenticated: bool = True) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(int(status))
        self._send_common_headers(content_length=len(body), authenticated=authenticated)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def _error_response(self, exc: BridgeError) -> None:
        payload: dict[str, Any] = {"error": {"code": exc.code, "message": exc.message}}
        if exc.details:
            payload["error"]["details"] = exc.details
        try:
            self._json_response(exc.status, payload)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_common_headers(self, *, content_length: int, authenticated: bool = True) -> None:
        origin = self.headers.get("Origin")
        if origin and origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Pragma", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Length", str(content_length))
        self.send_header("Connection", "close")


def emit_userscript(template: pathlib.Path, output: pathlib.Path, config: BridgeConfig) -> pathlib.Path:
    try:
        source = template.read_text(encoding="utf-8")
    except OSError as exc:
        raise BridgeError(f"Could not read userscript template: {exc}") from exc
    if "__VM_YTDLP_TOKEN__" not in source or "__VM_YTDLP_API_BASE__" not in source:
        raise BridgeError("The userscript template is missing its configuration placeholders.")
    configured = source.replace("__VM_YTDLP_TOKEN__", config.token).replace(
        "__VM_YTDLP_API_BASE__", f"http://127.0.0.1:{config.port}"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(configured, encoding="utf-8")
    try:
        os.chmod(output, 0o600)
    except OSError:
        pass
    return output


def run_doctor(config: BridgeConfig) -> int:
    runner = YtDlpRunner(config)
    checks = [
        ("Configuration", "OK"),
        ("yt-dlp", runner.version()),
        ("ffmpeg", shutil.which("ffmpeg") or "NOT FOUND"),
        ("JavaScript runtime", runner.javascript_runtime() or "NOT FOUND"),
        ("Download directory", str(config.download_dir.expanduser())),
        ("Bridge address", f"http://127.0.0.1:{config.port}"),
    ]
    width = max(len(name) for name, _ in checks)
    for name, result in checks:
        print(f"{name:<{width}}  {result}")
    healthy = runner.version() != "unavailable" and shutil.which("ffmpeg") is not None
    return 0 if healthy else 1


def serve(config: BridgeConfig) -> int:
    config.download_dir.expanduser().mkdir(parents=True, exist_ok=True)
    runner = YtDlpRunner(config)
    jobs = JobManager(runner)
    server = BridgeHTTPServer(("127.0.0.1", config.port), config, runner, jobs)
    stop_event = threading.Event()

    def request_stop(_signum: int, _frame: Any) -> None:
        if stop_event.is_set():
            return
        stop_event.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGINT, request_stop)
        signal.signal(signal.SIGTERM, request_stop)

    print(f"{APP_NAME} {APP_VERSION}")
    print(f"Listening on http://127.0.0.1:{config.port}")
    print(f"Downloads: {config.download_dir.expanduser()}")
    try:
        server.serve_forever(poll_interval=0.3)
    finally:
        server.server_close()
        jobs.stop()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument("--config", type=pathlib.Path, default=default_config_path(), help="Path to config.json")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("serve", help="Run the localhost bridge")

    init_parser = subparsers.add_parser("init", help="Create the config and optionally generate a paired userscript")
    init_parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    init_parser.add_argument("--download-dir", type=pathlib.Path, default=default_download_dir())
    init_parser.add_argument("--force", action="store_true", help="Replace an existing config with a new token")
    init_parser.add_argument("--userscript-template", type=pathlib.Path)
    init_parser.add_argument("--userscript-output", type=pathlib.Path)

    subparsers.add_parser("doctor", help="Check dependencies and configuration")
    subparsers.add_parser("print-token", help="Print the pairing token for an existing config")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    config_path = args.config.expanduser()
    try:
        if args.command == "init":
            BridgeConfig.create(
                config_path,
                port=args.port,
                download_dir=args.download_dir,
                force=args.force,
            )
            config = BridgeConfig.load(config_path)
            print(f"Configuration: {config_path}")
            print(f"Downloads: {config.download_dir.expanduser()}")
            if bool(args.userscript_template) != bool(args.userscript_output):
                raise BridgeError("Both --userscript-template and --userscript-output are required together.")
            if args.userscript_template and args.userscript_output:
                output = emit_userscript(args.userscript_template, args.userscript_output, config)
                print(f"Paired userscript: {output}")
            return 0
        config = BridgeConfig.load(config_path)
        if args.command == "serve":
            return serve(config)
        if args.command == "doctor":
            return run_doctor(config)
        if args.command == "print-token":
            print(config.token)
            return 0
    except BridgeError as exc:
        print(f"Error: {exc.message}", file=sys.stderr)
        if exc.details:
            print(json.dumps(exc.details, ensure_ascii=False), file=sys.stderr)
        return 2
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
