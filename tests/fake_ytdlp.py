#!/usr/bin/env python3
"""Small yt-dlp stand-in used only by the bridge test suite."""

from __future__ import annotations

import json
import pathlib
import sys
import time


args = sys.argv[1:]
if "--version" in args:
    print("2026.fake")
    raise SystemExit(0)

if "--dump-single-json" in args:
    print(
        json.dumps(
            {
                "id": "dQw4w9WgXcQ",
                "title": "Fake video <title>",
                "channel": "Test channel",
                "duration": 213,
                "duration_string": "3:33",
                "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
                "webpage_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "formats": [
                    {
                        "format_id": "137",
                        "ext": "mp4",
                        "height": 1080,
                        "width": 1920,
                        "fps": 30,
                        "vcodec": "avc1.640028",
                        "acodec": "none",
                        "filesize_approx": 150_000_000,
                        "protocol": "https",
                        "url": "https://secret.googlevideo.example/video",
                    },
                    {
                        "format_id": "140",
                        "ext": "m4a",
                        "vcodec": "none",
                        "acodec": "mp4a.40.2",
                        "abr": 129,
                        "language": "en",
                        "language_preference": 10,
                        "audio_channels": 2,
                        "format_note": "English (original)",
                        "filesize": 3_000_000,
                        "protocol": "https",
                        "url": "https://secret.googlevideo.example/audio",
                    },
                    {
                        "format_id": "251-hi",
                        "ext": "webm",
                        "vcodec": "none",
                        "acodec": "opus",
                        "abr": 160,
                        "language": "hi",
                        "language_preference": -1,
                        "audio_channels": 2,
                        "format_note": "Hindi dubbed",
                        "filesize": 3_500_000,
                        "protocol": "https",
                        "url": "https://secret.googlevideo.example/audio-hi",
                    },
                    {
                        "format_id": "251-es",
                        "ext": "webm",
                        "vcodec": "none",
                        "acodec": "opus",
                        "abr": 128,
                        "language": "es",
                        "language_preference": -1,
                        "audio_channels": 2,
                        "format_note": "Spanish dubbed",
                        "filesize": 3_100_000,
                        "protocol": "https",
                        "url": "https://secret.googlevideo.example/audio-es",
                    },
                    {
                        "format_id": "22",
                        "ext": "mp4",
                        "height": 720,
                        "vcodec": "avc1",
                        "acodec": "mp4a",
                        "protocol": "https",
                        "url": "https://secret.googlevideo.example/muxed",
                    },
                ],
                "subtitles": {"en": [{"ext": "vtt", "url": "https://secret.example/sub"}]},
                "automatic_captions": {"en-orig": [{"ext": "json3", "url": "https://secret.example/auto"}]},
            }
        )
    )
    raise SystemExit(0)

if "--simulate-failure" in args:
    print("ERROR: simulated failure")
    raise SystemExit(1)

format_value = args[args.index("--format") + 1] if "--format" in args else ""
if "alwaysfail" in format_value:
    print("ERROR: simulated permanent download failure", flush=True)
    raise SystemExit(1)

if "flaky" in format_value:
    home_path = None
    for index, value in enumerate(args[:-1]):
        if value == "--paths" and args[index + 1].startswith("home:"):
            home_path = pathlib.Path(args[index + 1][len("home:") :])
            break
    if home_path is None:
        print("ERROR: fake downloader could not find its home path", flush=True)
        raise SystemExit(1)
    marker = home_path / ".fake-ytdlp-flaky-attempt"
    if not marker.exists():
        marker.write_text("failed once\n", encoding="utf-8")
        print("ERROR: simulated transient download failure", flush=True)
        raise SystemExit(1)

if "slow" in format_value:
    for index in range(1, 101):
        print(f"__VMYTDLP_PROGRESS__{index}|100|NA|10|{100 - index}|{index}|100", flush=True)
        time.sleep(0.08)
    raise SystemExit(0)

print("[youtube] Extracting URL: test")
for line in (
    "__VMYTDLP_PROGRESS__250|1000|NA|100|8|1|4",
    "__VMYTDLP_PROGRESS__750|1000|NA|200|2|3|4",
):
    print(line, flush=True)
    time.sleep(0.03)
print("[Merger] Merging formats into test.mp4", flush=True)
print("__VMYTDLP_OUTPUT__/tmp/Fake video [dQw4w9WgXcQ].mp4", flush=True)
raise SystemExit(0)
