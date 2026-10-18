from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest import mock


PROJECT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "companion"))

import vm_ytdlp_bridge as bridge  # noqa: E402


FAKE_YTDLP = pathlib.Path(__file__).with_name("fake_ytdlp.py")
VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


class ValidationTests(unittest.TestCase):
    def test_normalizes_supported_youtube_routes(self) -> None:
        expected = VIDEO_URL
        self.assertEqual(bridge.normalize_youtube_url(VIDEO_URL + "&list=ignored"), expected)
        self.assertEqual(bridge.normalize_youtube_url("https://youtu.be/dQw4w9WgXcQ?t=5"), expected)
        self.assertEqual(bridge.normalize_youtube_url("https://www.youtube.com/shorts/dQw4w9WgXcQ"), expected)
        self.assertEqual(bridge.normalize_youtube_url("https://music.youtube.com/watch?v=dQw4w9WgXcQ"), expected)

    def test_rejects_non_video_and_non_youtube_urls(self) -> None:
        for value in (
            "https://example.com/watch?v=dQw4w9WgXcQ",
            "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/playlist?list=PL123",
            "file:///etc/passwd",
        ):
            with self.subTest(value=value), self.assertRaises(bridge.BridgeError):
                bridge.normalize_youtube_url(value)

    def test_cookie_spec_stays_structured(self) -> None:
        options = bridge.validate_cookie_options(
            {"enabled": True, "browser": "firefox", "profile": "default-release", "container": "Work"}
        )
        self.assertEqual(bridge.cookie_spec(options), "firefox:default-release::Work")
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_cookie_options({"enabled": True, "browser": "firefox\n--exec"})
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_cookie_options({"enabled": "false", "browser": "firefox"})

    def test_cookie_source_selects_browser_or_configured_file(self) -> None:
        self.assertEqual(bridge.validate_cookie_options({"enabled": True})["source"], "browser")
        options = bridge.validate_cookie_options({"enabled": True, "source": "file", "browser": "chrome"})
        self.assertIsNone(bridge.cookie_spec(options))
        self.assertEqual(bridge.cookie_args(options, pathlib.Path("/tmp/run/cookies.txt")), ["--cookies", "/tmp/run/cookies.txt"])
        with self.assertRaises(bridge.BridgeError):
            bridge.cookie_args(options)
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_cookie_options({"enabled": True, "source": "/etc/passwd"})

    def test_cookies_file_comes_only_from_config(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "config.json"
            path.write_text(json.dumps({"token": "t" * 48, "cookies_file": "~/yt-cookies.txt"}), encoding="utf-8")
            config = bridge.BridgeConfig.load(path)
            self.assertEqual(config.cookies_file, pathlib.Path.home() / "yt-cookies.txt")
            path.write_text(json.dumps({"token": "t" * 48}), encoding="utf-8")
            self.assertIsNone(bridge.BridgeConfig.load(path).cookies_file)
            path.write_text(json.dumps({"token": "t" * 48, "cookies_file": ["x"]}), encoding="utf-8")
            with self.assertRaises(bridge.BridgeError):
                bridge.BridgeConfig.load(path)

    def test_proxy_url_validation_accepts_supported_schemes_and_auth(self) -> None:
        values = (
            "http://127.0.0.1:8080",
            "https://proxy.example:8443/",
            "socks4://127.0.0.1:9050",
            "socks4a://proxy.example:9050",
            "socks5://user:p%40ss@127.0.0.1:1080",
        )
        for value in values:
            with self.subTest(value=value):
                self.assertEqual(bridge.validate_proxy_url(value), value)
        self.assertIsNone(bridge.validate_proxy_url(""))

    def test_proxy_url_validation_rejects_unsafe_or_malformed_values(self) -> None:
        values = (
            "file:///etc/passwd",
            "ftp://proxy.example:21",
            "socks5://",
            "http://proxy.example:99999",
            "http://proxy.example/path",
            "http://proxy.example?mode=unsafe",
            "http://proxy.example#fragment",
            "http://proxy.example\n--exec",
            "http://proxy example:8080",
        )
        for value in values:
            with self.subTest(value=value), self.assertRaises(bridge.BridgeError):
                bridge.validate_proxy_url(value)

    def test_job_schema_rejects_raw_or_malformed_format_values(self) -> None:
        valid = base_job()
        parsed = bridge.validate_job_payload(valid)
        self.assertEqual(parsed["selection"]["video_format_id"], "137")
        self.assertEqual(parsed["selection"]["audio_format_id"], "140")
        invalid = base_job()
        invalid["selection"]["video_format_id"] = "137 --exec shell"
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_job_payload(invalid)
        invalid_flag = base_job()
        invalid_flag["allow_invalid_certificates"] = "true"
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_job_payload(invalid_flag)

    def test_retry_count_is_a_bounded_integer(self) -> None:
        for value in (-1, 6, True, "2", 2.5):
            request = base_job()
            request["retry_count"] = value
            with self.subTest(value=value), self.assertRaises(bridge.BridgeError):
                bridge.validate_job_payload(request)

    def test_download_modes_validate_media_and_stream_shapes(self) -> None:
        request = base_job()
        request["download_mode"] = "unsupported"
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_job_payload(request)

        request = base_job()
        request["media_type"] = "audio"
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_job_payload(request)

        request = base_job()
        request["download_mode"] = "video"
        request["selection"] = {"type": "streams", "video_format_id": "137", "audio_format_id": "140"}
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_job_payload(request)

        request = base_job()
        request["selection"]["audio_format_id"] = "137"
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_job_payload(request)

        request = base_job()
        request["keep_separate_streams"] = True
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_job_payload(request)

    def test_exact_formats_match_video_only_and_audio_only_modes(self) -> None:
        request = base_job()
        request.update({"download_mode": "video", "media_type": "video"})
        request["selection"] = {"type": "exact", "format_id": "137", "has_video": True, "has_audio": False}
        parsed = bridge.validate_job_payload(request)
        self.assertEqual(parsed["download_mode"], "video")

        request["selection"] = {"type": "exact", "format_id": "22", "has_video": True, "has_audio": True}
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_job_payload(request)

        request = base_job()
        request.update({"download_mode": "audio", "media_type": "audio"})
        request["selection"] = {"type": "exact", "format_id": "140", "has_video": False, "has_audio": True}
        parsed = bridge.validate_job_payload(request)
        self.assertEqual(parsed["download_mode"], "audio")

    def test_download_mode_supplies_compatible_media_default(self) -> None:
        request = base_job()
        request.pop("media_type")
        parsed = bridge.validate_job_payload(request)
        self.assertEqual(parsed["media_type"], "video")


def base_job() -> dict:
    return {
        "url": VIDEO_URL,
        "media_type": "video",
        "download_mode": "merge",
        "selection": {"type": "streams", "video_format_id": "137", "audio_format_id": "140"},
        "container": "mp4",
        "audio_codec": "mp3",
        "audio_quality": "0",
        "retry_count": 2,
        "cookies": {"enabled": False, "browser": "firefox"},
        "allow_invalid_certificates": False,
        "extras": {
            "subtitle_mode": "both",
            "subtitle_languages": "en.*,en",
            "subtitle_format": "srt",
            "embed_subtitles": True,
            "write_thumbnail": True,
            "embed_thumbnail": False,
            "thumbnail_format": "jpg",
            "write_info_json": True,
            "write_description": True,
            "embed_metadata": True,
        },
        "title_hint": "Fake video",
        "thumbnail_hint": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    }


class RunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = bridge.BridgeConfig(
            token="t" * 48,
            port=17442,
            download_dir=pathlib.Path(self.temp.name) / "downloads",
            ytdlp_command=(sys.executable, str(FAKE_YTDLP)),
        )
        self.runner = bridge.YtDlpRunner(self.config)

    def test_metadata_is_sanitized(self) -> None:
        captured_commands = []
        # extract_info reads yt-dlp's output incrementally via Popen so the
        # response size can be capped during transfer rather than after it.
        real_popen = subprocess.Popen

        def capture_popen(command, **kwargs):
            captured_commands.append(list(command))
            return real_popen(command, **kwargs)

        with mock.patch.object(bridge.subprocess, "Popen", side_effect=capture_popen):
            info = self.runner.extract_info(
                VIDEO_URL,
                {"enabled": False, "browser": "firefox"},
                "socks5://user:password@127.0.0.1:1080",
                True,
            )
        serialized = json.dumps(info)
        self.assertEqual(info["title"], "Fake video <title>")
        self.assertEqual(len(info["formats"]), 5)
        formats = {item["format_id"]: item for item in info["formats"]}
        self.assertEqual(formats["140"]["language"], "en")
        self.assertEqual(formats["140"]["language_preference"], 10)
        self.assertEqual(formats["140"]["audio_channels"], 2)
        self.assertEqual(formats["251-hi"]["language"], "hi")
        self.assertEqual(formats["251-hi"]["language_preference"], -1)
        self.assertNotIn("googlevideo", serialized)
        self.assertNotIn('"url"', serialized)
        self.assertEqual(info["subtitles"], {"en": ["vtt"]})
        self.assertIn("--no-check-certificates", captured_commands[0])

    def test_command_is_argument_array_with_expected_features(self) -> None:
        request = base_job()
        request["proxy_url"] = "socks5://user:password@127.0.0.1:1080"
        request["allow_invalid_certificates"] = True
        options = bridge.validate_job_payload(request)
        command = self.runner.build_download_command(options)
        self.assertIn("137+140", command)
        self.assertIn("--write-subs", command)
        self.assertIn("--write-auto-subs", command)
        self.assertIn("--write-thumbnail", command)
        self.assertIn("--write-info-json", command)
        self.assertIn("--progress", command)
        self.assertIn("--merge-output-format", command)
        self.assertIn("--remux-video", command)
        self.assertIn("--no-keep-video", command)
        self.assertNotIn("--keep-video", command)
        self.assertIn("--file-access-retries", command)
        self.assertIn("--extractor-retries", command)
        retry_sleeps = [command[index + 1] for index, value in enumerate(command[:-1]) if value == "--retry-sleep"]
        self.assertEqual(
            retry_sleeps,
            ["http:exp=1:30", "fragment:exp=1:20", "file_access:exp=1:10", "extractor:exp=1:10"],
        )
        if self.runner.javascript_runtime():
            self.assertIn("--js-runtimes", command)
        proxy_index = command.index("--proxy")
        self.assertEqual(command[proxy_index + 1], request["proxy_url"])
        self.assertEqual(command.count("--no-check-certificates"), 1)
        self.assertEqual(command[-1], VIDEO_URL)
        self.assertEqual(command[-2], "--")

    def test_merge_mode_uses_chosen_streams_and_discards_inputs(self) -> None:
        request = base_job()
        options = bridge.validate_job_payload(request)
        command = self.runner.build_download_command(options)
        selector = command[command.index("--format") + 1]
        self.assertEqual(selector, "137+140")
        self.assertIn("--no-keep-video", command)
        self.assertNotIn("--keep-video", command)
        self.assertIn("--merge-output-format", command)
        configured_paths = [command[index + 1] for index, value in enumerate(command[:-1]) if value == "--paths"]
        self.assertTrue(any(value.startswith("home:") for value in configured_paths))
        self.assertTrue(any(value.startswith("temp:") for value in configured_paths))

    def test_video_only_mode_selects_no_audio_stream(self) -> None:
        request = base_job()
        request.update({"download_mode": "video", "media_type": "video"})
        request["selection"] = {"type": "preset", "preset": 1080}
        options = bridge.validate_job_payload(request)
        command = self.runner.build_download_command(options)
        selector = command[command.index("--format") + 1]
        self.assertEqual(selector, "bv[ext=mp4][height<=1080]/bv[height<=1080]")
        self.assertNotIn("+ba", selector)
        self.assertNotIn("--merge-output-format", command)
        self.assertIn("--remux-video", command)

    def test_audio_only_mode_extracts_the_selected_audio(self) -> None:
        request = base_job()
        request.update({"download_mode": "audio", "media_type": "audio"})
        request["selection"] = {"type": "exact", "format_id": "140", "has_video": False, "has_audio": True}
        options = bridge.validate_job_payload(request)
        command = self.runner.build_download_command(options)
        self.assertEqual(command[command.index("--format") + 1], "140")
        self.assertIn("--extract-audio", command)
        self.assertNotIn("--merge-output-format", command)
        self.assertNotIn("--embed-subs", command)

    def test_proxy_credentials_are_not_exposed_by_public_jobs_or_logs(self) -> None:
        request = base_job()
        request["proxy_url"] = "socks5://alice:correct-horse@127.0.0.1:1080"
        request["selection"]["video_format_id"] = "slow"
        jobs = bridge.JobManager(self.runner)
        self.addCleanup(jobs.stop)
        created = jobs.enqueue(request)
        self.assertNotIn("correct-horse", json.dumps(created))
        manifest = self.config.download_dir / bridge.RECOVERY_DIRNAME / f"{created['id']}.json"
        persisted = json.loads(manifest.read_text(encoding="utf-8"))
        self.assertNotIn("correct-horse", json.dumps(persisted))
        self.assertIsNone(persisted["options"]["proxy_url"])
        self.assertFalse(persisted["options"]["cookies"]["enabled"])
        if os.name != "nt":
            self.assertEqual(manifest.stat().st_mode & 0o777, 0o600)
        redacted = bridge.redact_proxy_reference(f"ERROR via {request['proxy_url']}", request["proxy_url"])
        self.assertEqual(redacted, "ERROR via [configured proxy]")

    def test_failed_job_is_discovered_after_restart_and_can_resume(self) -> None:
        request = base_job()
        request["selection"]["video_format_id"] = "flaky"
        request["retry_count"] = 0
        first_manager = bridge.JobManager(self.runner)
        self.addCleanup(first_manager.stop)
        created = first_manager.enqueue(request)
        deadline = time.monotonic() + 4
        current = created
        while time.monotonic() < deadline:
            current = first_manager.get_job(created["id"])
            if current["status"] in bridge.TERMINAL_STATUSES:
                break
            time.sleep(0.02)
        self.assertEqual(current["status"], "failed", current)
        manifest = self.config.download_dir / bridge.RECOVERY_DIRNAME / f"{created['id']}.json"
        self.assertTrue(manifest.is_file())
        first_manager.stop()

        recovered_manager = bridge.JobManager(self.runner)
        self.addCleanup(recovered_manager.stop)
        recovered = recovered_manager.get_job(created["id"])
        self.assertEqual(recovered["status"], "interrupted")
        self.assertTrue(recovered["resumable"])
        self.assertTrue(recovered["recovered"])

        resumed = recovered_manager.resume(created["id"], {})
        self.assertEqual(resumed["status"], "queued")
        self.assertFalse(resumed["resumable"])
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            current = recovered_manager.get_job(created["id"])
            if current["status"] in bridge.TERMINAL_STATUSES:
                break
            time.sleep(0.02)
        self.assertEqual(current["status"], "completed", current)
        self.assertFalse(manifest.exists())

    def test_forget_removes_recovery_record_but_not_partial_files(self) -> None:
        request = base_job()
        request["selection"]["video_format_id"] = "alwaysfail"
        request["retry_count"] = 0
        jobs = bridge.JobManager(self.runner)
        self.addCleanup(jobs.stop)
        created = jobs.enqueue(request)
        deadline = time.monotonic() + 4
        current = created
        while time.monotonic() < deadline:
            current = jobs.get_job(created["id"])
            if current["status"] in bridge.TERMINAL_STATUSES:
                break
            time.sleep(0.02)
        self.assertEqual(current["status"], "failed", current)
        manifest = self.config.download_dir / bridge.RECOVERY_DIRNAME / f"{created['id']}.json"
        partial = self.config.download_dir / ".vm-yt-dlp-parts" / "keep-me.part"
        partial.parent.mkdir(parents=True, exist_ok=True)
        partial.write_text("partial", encoding="utf-8")
        self.assertTrue(jobs.forget(created["id"]))
        self.assertFalse(manifest.exists())
        self.assertTrue(partial.exists())
        with self.assertRaises(bridge.BridgeError):
            jobs.get_job(created["id"])

    def test_tampered_recovery_manifest_is_ignored(self) -> None:
        recovery_dir = self.config.download_dir / bridge.RECOVERY_DIRNAME
        recovery_dir.mkdir(parents=True)
        job_id = "a" * 32
        tampered = base_job()
        tampered["selection"]["video_format_id"] = "137 --exec"
        (recovery_dir / f"{job_id}.json").write_text(
            json.dumps(
                {
                    "schema_version": bridge.RECOVERY_SCHEMA_VERSION,
                    "job_id": job_id,
                    "created_at": "2026-08-26T00:00:00Z",
                    "options": tampered,
                }
            ),
            encoding="utf-8",
        )
        jobs = bridge.JobManager(self.runner)
        self.addCleanup(jobs.stop)
        self.assertEqual(jobs.list_jobs()["jobs"], [])

    def test_certificate_validation_bypass_is_opt_in(self) -> None:
        options = bridge.validate_job_payload(base_job())
        self.assertNotIn("--no-check-certificates", self.runner.build_download_command(options))
        self.assertEqual(bridge.certificate_args(True), ["--no-check-certificates"])
        self.assertEqual(bridge.certificate_args(False), [])

    def test_queue_reaches_completed_with_progress_and_output(self) -> None:
        jobs = bridge.JobManager(self.runner)
        self.addCleanup(jobs.stop)
        created = jobs.enqueue(base_job())
        self.assertEqual(created["download_mode"], "merge")
        self.assertEqual(created["output_mode"], "merged")
        deadline = time.monotonic() + 4
        current = created
        while time.monotonic() < deadline:
            current = jobs.get_job(created["id"])
            if current["status"] in bridge.TERMINAL_STATUSES:
                break
            time.sleep(0.03)
        self.assertEqual(current["status"], "completed", current)
        self.assertEqual(current["progress"]["percent"], 100.0)
        self.assertTrue(current["output_path"].endswith(".mp4"))

    def test_progress_speed_is_observed_bytes_over_elapsed_time(self) -> None:
        jobs = bridge.JobManager(self.runner)
        self.addCleanup(jobs.stop)
        options = bridge.validate_job_payload(base_job())
        job = jobs._new_job("a" * 32, options)
        with mock.patch.object(bridge.time, "monotonic", side_effect=[10.0, 12.0, 14.0]):
            jobs._consume_progress(job, "250|1000|NA|999999|8|1|4")
            self.assertIsNone(job["progress"]["speed"])
            jobs._consume_progress(job, "750|1000|NA|999999|2|3|4")
            self.assertEqual(job["progress"]["speed"], 250.0)
            jobs._consume_progress(job, "100|1000|NA|999999|7|1|4")
        self.assertEqual(job["progress"]["speed"], 150.0)
        self.assertEqual(job["progress"]["elapsed_seconds"], 4.0)
        public = jobs._public_job(job)
        self.assertFalse(any(key.startswith("_") for key in public))

    def test_active_job_can_be_cancelled(self) -> None:
        jobs = bridge.JobManager(self.runner)
        self.addCleanup(jobs.stop)
        request = base_job()
        request["selection"]["video_format_id"] = "slow"
        created = jobs.enqueue(request)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            current = jobs.get_job(created["id"])
            if current["status"] == "downloading":
                break
            time.sleep(0.02)
        jobs.cancel(created["id"])
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            current = jobs.get_job(created["id"])
            if current["status"] in bridge.TERMINAL_STATUSES:
                break
            time.sleep(0.03)
        self.assertEqual(current["status"], "cancelled", current)
        self.assertEqual(current["phase"], "Paused")
        self.assertTrue(current["resumable"])

    def test_transient_failure_retries_and_then_completes(self) -> None:
        request = base_job()
        request["selection"]["video_format_id"] = "flaky"
        request["retry_count"] = 2
        with (
            mock.patch.object(bridge, "JOB_RETRY_BASE_SECONDS", 0.02),
            mock.patch.object(bridge, "JOB_RETRY_MAX_SECONDS", 0.05),
        ):
            jobs = bridge.JobManager(self.runner)
            self.addCleanup(jobs.stop)
            created = jobs.enqueue(request)
            deadline = time.monotonic() + 4
            current = created
            while time.monotonic() < deadline:
                current = jobs.get_job(created["id"])
                if current["status"] in bridge.TERMINAL_STATUSES:
                    break
                time.sleep(0.02)
        self.assertEqual(current["status"], "completed", current)
        self.assertEqual(current["attempt"], 2)
        self.assertEqual(current["max_attempts"], 3)
        self.assertTrue(any("Attempt 1/3 failed" in line for line in current["logs"]))

    def test_permanent_failure_stops_at_retry_limit(self) -> None:
        request = base_job()
        request["selection"]["video_format_id"] = "alwaysfail"
        request["retry_count"] = 1
        with (
            mock.patch.object(bridge, "JOB_RETRY_BASE_SECONDS", 0.02),
            mock.patch.object(bridge, "JOB_RETRY_MAX_SECONDS", 0.05),
        ):
            jobs = bridge.JobManager(self.runner)
            self.addCleanup(jobs.stop)
            created = jobs.enqueue(request)
            deadline = time.monotonic() + 4
            current = created
            while time.monotonic() < deadline:
                current = jobs.get_job(created["id"])
                if current["status"] in bridge.TERMINAL_STATUSES:
                    break
                time.sleep(0.02)
        self.assertEqual(current["status"], "failed", current)
        self.assertEqual(current["attempt"], 2)
        self.assertEqual(current["max_attempts"], 2)
        self.assertIn("simulated permanent download failure", current["error"])

    def run_job_to_end(self, request: dict) -> dict:
        jobs = bridge.JobManager(self.runner)
        self.addCleanup(jobs.stop)
        created = jobs.enqueue(request)
        deadline = time.monotonic() + 4
        current = created
        while time.monotonic() < deadline:
            current = jobs.get_job(created["id"])
            if current["status"] in bridge.TERMINAL_STATUSES:
                break
            time.sleep(0.02)
        return current

    def test_rejected_cookies_warning_is_logged_once_with_an_explanation(self) -> None:
        request = base_job()
        request["cookies"] = {"enabled": True, "browser": "firefox"}
        request["selection"]["video_format_id"] = "cookiesrotated"
        current = self.run_job_to_end(request)
        self.assertEqual(current["status"], "completed", current)
        warnings = [line for line in current["logs"] if "cookies are no longer valid" in line]
        self.assertEqual(len(warnings), 1, current["logs"])
        self.assertEqual(current["logs"].count(f"[bridge] {bridge.COOKIES_REJECTED_HINTS['browser']}"), 1)
        self.assertIsNone(current["error"])

    def test_sign_in_error_after_rejected_cookies_carries_the_explanation(self) -> None:
        request = base_job()
        request["cookies"] = {"enabled": True, "browser": "firefox"}
        request["selection"]["video_format_id"] = "cookiesrotated-signin"
        request["retry_count"] = 0
        current = self.run_job_to_end(request)
        self.assertEqual(current["status"], "failed", current)
        self.assertTrue(current["error"].startswith("ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm your age."))
        self.assertIn(bridge.COOKIES_REJECTED_HINTS["browser"], current["error"])

    def test_bot_check_explains_a_flagged_connection(self) -> None:
        request = base_job()
        request["selection"]["video_format_id"] = "botcheck"
        request["retry_count"] = 0
        current = self.run_job_to_end(request)
        self.assertEqual(current["status"], "failed", current)
        self.assertIn("not a bot", current["error"])
        self.assertIn(bridge.BOT_CHECK_HINT, current["error"])

    def test_metadata_bot_check_reason_names_the_fix_for_the_cookie_setting(self) -> None:
        url = "https://www.youtube.com/watch?v=botcheck00"
        for cookies, hint in (
            ({"enabled": False}, bridge.BOT_CHECK_HINT),
            ({"enabled": True, "browser": "firefox"}, bridge.COOKIES_REJECTED_HINTS["browser"]),
        ):
            with self.subTest(cookies=cookies), self.assertRaises(bridge.BridgeError) as caught:
                self.runner.extract_info(url, cookies)
            self.assertEqual(caught.exception.code, "metadata_failed")
            self.assertIn("not a bot", caught.exception.details["reason"])
            self.assertTrue(caught.exception.details["reason"].endswith(hint))

    def test_job_can_be_cancelled_during_retry_backoff(self) -> None:
        request = base_job()
        request["selection"]["video_format_id"] = "alwaysfail"
        request["retry_count"] = 5
        with (
            mock.patch.object(bridge, "JOB_RETRY_BASE_SECONDS", 1.0),
            mock.patch.object(bridge, "JOB_RETRY_MAX_SECONDS", 1.0),
        ):
            jobs = bridge.JobManager(self.runner)
            self.addCleanup(jobs.stop)
            created = jobs.enqueue(request)
            deadline = time.monotonic() + 3
            current = created
            while time.monotonic() < deadline:
                current = jobs.get_job(created["id"])
                if str(current["phase"]).startswith("Retrying in"):
                    break
                time.sleep(0.02)
            self.assertTrue(str(current["phase"]).startswith("Retrying in"), current)
            jobs.cancel(created["id"])
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                current = jobs.get_job(created["id"])
                if current["status"] in bridge.TERMINAL_STATUSES:
                    break
                time.sleep(0.02)
        self.assertEqual(current["status"], "cancelled", current)
        self.assertEqual(current["attempt"], 1)


COOKIE_EXPORT = (
    "# Netscape HTTP Cookie File\n"
    "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1900000000\tLOGIN_INFO\tlogin-value\n"
    ".youtube.com\tTRUE\t/\tTRUE\t1900000000\t__Secure-1PSIDTS\tsidts-1\n"
    ".youtube.com\tTRUE\t/\tTRUE\t1900000000\tSIDCC\tsidcc-1\n"
    ".youtube.com\tTRUE\t/\tTRUE\t1900000000\tSAPISID\tsapisid\n"
)
FILE_COOKIES = {"enabled": True, "source": "file", "browser": "firefox"}


def set_cookie(path: pathlib.Path, name: str, value: str | None, expires: int = 1900000000) -> None:
    """Rewrite one cookie in a run's private file the way yt-dlp saves it."""
    lines = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.removeprefix("#HttpOnly_")
        if not line.strip() or line.startswith("#"):
            continue
        fields = line.split("\t")
        if fields[5] == name:
            if value is None:
                continue
            fields[4], fields[6] = str(expires), value
        lines.append("\t".join(fields))
    path.write_text("# Netscape HTTP Cookie File\n\n" + "".join(f"{line}\n" for line in lines), encoding="utf-8")


class CookieFileTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.master = pathlib.Path(self.temp.name) / "cookies.txt"
        self.master.write_text(COOKIE_EXPORT, encoding="utf-8")
        self.store = bridge.CookieFileStore(self.master)

    def values(self) -> dict[str, str]:
        entries = bridge.parse_cookie_file(self.master.read_text(encoding="utf-8"))
        return {name: entry.value for (_domain, _path, name), entry in entries.items()}

    def test_run_gets_a_private_copy_and_its_rotation_is_kept(self) -> None:
        with self.store.checkout(FILE_COOKIES) as private:
            self.assertNotEqual(private, self.master)
            self.assertEqual(private.read_text(encoding="utf-8"), COOKIE_EXPORT)
            set_cookie(private, "__Secure-1PSIDTS", "sidts-2", 1900000001)
        self.assertFalse(private.exists())
        self.assertEqual(self.values()["__Secure-1PSIDTS"], "sidts-2")
        # Untouched cookies keep their original lines, HttpOnly marker included.
        self.assertIn("#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1900000000\tLOGIN_INFO\tlogin-value\n", self.master.read_text())
        if os.name != "nt":
            self.assertEqual(self.master.stat().st_mode & 0o777, 0o600)

    def test_older_run_finishing_last_does_not_undo_a_newer_rotation(self) -> None:
        with self.store.checkout(FILE_COOKIES) as download:
            with self.store.checkout(FILE_COOKIES) as metadata:
                set_cookie(metadata, "__Secure-1PSIDTS", "sidts-3", 1900000002)
            set_cookie(download, "__Secure-1PSIDTS", "sidts-2", 1900000001)
            set_cookie(download, "SIDCC", "sidcc-2", 1900000001)
        values = self.values()
        self.assertEqual(values["__Secure-1PSIDTS"], "sidts-3")
        self.assertEqual(values["SIDCC"], "sidcc-2")

    def test_a_fresh_export_replacing_the_file_mid_run_is_kept(self) -> None:
        fresh = COOKIE_EXPORT.replace("sidts-1", "fresh-session-1").replace("login-value", "fresh-login")
        with self.store.checkout(FILE_COOKIES) as private:
            self.master.write_text(fresh, encoding="utf-8")
            set_cookie(private, "__Secure-1PSIDTS", "sidts-2", 1900000001)
        self.assertEqual(self.master.read_text(encoding="utf-8"), fresh)

    def test_deletions_and_cut_off_saves_are_not_merged(self) -> None:
        with self.store.checkout(FILE_COOKIES) as private:
            set_cookie(private, "LOGIN_INFO", None)
        self.assertEqual(self.values()["LOGIN_INFO"], "login-value")
        with self.store.checkout(FILE_COOKIES) as private:
            set_cookie(private, "__Secure-1PSIDTS", "sidts-2", 1900000001)
            private.write_text(private.read_text(encoding="utf-8").rstrip("\n")[:-3], encoding="utf-8")
        self.assertEqual(self.master.read_text(encoding="utf-8"), COOKIE_EXPORT)

    def test_browser_cookies_and_missing_files_are_handled_before_running(self) -> None:
        with self.store.checkout({"enabled": True, "source": "browser", "browser": "firefox"}) as private:
            self.assertIsNone(private)
        with self.assertRaises(bridge.BridgeError) as caught:
            bridge.CookieFileStore(None).require()
        self.assertEqual(caught.exception.code, "cookies_file_not_configured")
        with self.assertRaises(bridge.BridgeError) as caught:
            bridge.CookieFileStore(self.master.with_name("missing.txt")).require()
        self.assertEqual(caught.exception.code, "cookies_file_missing")

    def test_metadata_and_download_runs_write_rotations_back(self) -> None:
        config = bridge.BridgeConfig(
            token="t" * 48,
            port=17442,
            download_dir=pathlib.Path(self.temp.name) / "downloads",
            ytdlp_command=(sys.executable, str(FAKE_YTDLP)),
            cookies_file=self.master,
        )
        runner = bridge.YtDlpRunner(config)
        captured_commands = []
        real_popen = subprocess.Popen

        def capture_popen(command, **kwargs):
            captured_commands.append(list(command))
            return real_popen(command, **kwargs)

        with mock.patch.object(bridge.subprocess, "Popen", side_effect=capture_popen):
            runner.extract_info(VIDEO_URL, FILE_COOKIES)
        cookie_path = captured_commands[0][captured_commands[0].index("--cookies") + 1]
        self.assertNotEqual(pathlib.Path(cookie_path), self.master)
        self.assertNotIn("--cookies-from-browser", captured_commands[0])
        self.assertEqual(self.values()["__Secure-1PSIDTS"], "sidts-2")

        jobs = bridge.JobManager(runner)
        self.addCleanup(jobs.stop)
        request = base_job()
        request["cookies"] = FILE_COOKIES
        created = jobs.enqueue(request)
        deadline = time.monotonic() + 4
        current = created
        while time.monotonic() < deadline:
            current = jobs.get_job(created["id"])
            if current["status"] in bridge.TERMINAL_STATUSES:
                break
            time.sleep(0.02)
        self.assertEqual(current["status"], "completed", current)
        self.assertEqual(self.values()["__Secure-1PSIDTS"], "sidts-3")

    def test_jobs_asking_for_an_unconfigured_file_are_refused_up_front(self) -> None:
        config = bridge.BridgeConfig(
            token="t" * 48,
            port=17442,
            download_dir=pathlib.Path(self.temp.name) / "downloads",
            ytdlp_command=(sys.executable, str(FAKE_YTDLP)),
        )
        jobs = bridge.JobManager(bridge.YtDlpRunner(config))
        self.addCleanup(jobs.stop)
        request = base_job()
        request["cookies"] = FILE_COOKIES
        with self.assertRaises(bridge.BridgeError) as caught:
            jobs.enqueue(request)
        self.assertEqual(caught.exception.code, "cookies_file_not_configured")
        self.assertEqual(jobs.list_jobs()["jobs"], [])


class PairingTests(unittest.TestCase):
    def test_emit_userscript_embeds_token_and_loopback_address(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = pathlib.Path(temporary) / "paired.user.js"
            config = bridge.BridgeConfig(
                token="pairing-token-" + "x" * 40,
                port=18443,
                download_dir=pathlib.Path(temporary) / "downloads",
                ytdlp_command=(sys.executable, str(FAKE_YTDLP)),
            )
            bridge.emit_userscript(PROJECT / "userscript" / "yt-dlp-for-violentmonkey.user.js", output, config)
            source = output.read_text(encoding="utf-8")
            self.assertNotIn("__VM_YTDLP_TOKEN__", source)
            self.assertNotIn("__VM_YTDLP_API_BASE__", source)
            self.assertIn(config.token, source)
            self.assertIn("http://127.0.0.1:18443", source)
            self.assertIn("// @version      1.7.3", source)
            self.assertIn("BOOTSTRAP_TOKEN.length >= 32", source)


class HttpApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        config = bridge.BridgeConfig(
            token="s" * 48,
            port=17442,
            download_dir=pathlib.Path(self.temp.name) / "downloads",
            ytdlp_command=(sys.executable, str(FAKE_YTDLP)),
        )
        self.runner = bridge.YtDlpRunner(config)
        self.jobs = bridge.JobManager(self.runner)
        self.server = bridge.BridgeHTTPServer(("127.0.0.1", 0), config, self.runner, self.jobs)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def stop_server(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.jobs.stop()
        self.thread.join(timeout=2)

    def request(self, method: str, path: str, payload=None, token: str | None = "s" * 48):
        data = json.dumps(payload).encode() if payload is not None else None
        headers = {"Origin": "https://www.youtube.com"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read())

    def test_health_requires_token(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request("GET", "/api/v1/health", token=None)
        self.assertEqual(context.exception.code, 401)
        status, payload = self.request("GET", "/api/v1/health")
        self.assertEqual(status, 200)
        self.assertEqual(payload["version"], "1.7.3")
        self.assertEqual(payload["yt_dlp_version"], "2026.fake")
        self.assertIn("proxy", payload["capabilities"])
        self.assertIn("invalid_certificates", payload["capabilities"])
        self.assertIn("job_retries", payload["capabilities"])
        self.assertIn("download_modes_v2", payload["capabilities"])
        self.assertIn("persistent_resume", payload["capabilities"])
        self.assertIn("cookies_file", payload["capabilities"])
        self.assertFalse(payload["cookies_file_configured"])
        self.assertFalse(payload["cookies_file_found"])

    def test_origin_and_host_protection(self) -> None:
        request = urllib.request.Request(
            self.base + "/api/v1/health",
            headers={"Origin": "https://evil.example", "Authorization": f"Bearer {'s' * 48}"},
        )
        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(request, timeout=5)
        self.assertEqual(context.exception.code, 403)

    def test_info_and_queue_endpoints(self) -> None:
        status, payload = self.request(
            "POST",
            "/api/v1/info",
            {
                "url": VIDEO_URL,
                "cookies": {"enabled": False, "browser": "firefox"},
                "proxy_url": "http://user:password@127.0.0.1:8080",
                "allow_invalid_certificates": True,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["info"]["id"], "dQw4w9WgXcQ")
        status, payload = self.request("POST", "/api/v1/jobs", base_job())
        self.assertEqual(status, 201)
        self.assertEqual(payload["job"]["status"], "queued")
        self.assertEqual(payload["job"]["download_mode"], "merge")

    def test_resume_and_forget_endpoints(self) -> None:
        request = base_job()
        request["selection"]["video_format_id"] = "alwaysfail"
        request["retry_count"] = 0
        status, payload = self.request("POST", "/api/v1/jobs", request)
        self.assertEqual(status, 201)
        job_id = payload["job"]["id"]
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            status, payload = self.request("GET", f"/api/v1/jobs/{job_id}")
            if payload["job"]["status"] == "failed":
                break
            time.sleep(0.02)
        self.assertEqual(payload["job"]["status"], "failed")
        self.assertTrue(payload["job"]["resumable"])

        status, payload = self.request("POST", f"/api/v1/jobs/{job_id}/resume", {})
        self.assertEqual(status, 200)
        self.assertEqual(payload["job"]["status"], "queued")
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            status, payload = self.request("GET", f"/api/v1/jobs/{job_id}")
            if payload["job"]["status"] == "failed":
                break
            time.sleep(0.02)
        status, payload = self.request("POST", f"/api/v1/jobs/{job_id}/forget", {})
        self.assertEqual(status, 200)
        self.assertEqual(payload["forgotten"], job_id)


if __name__ == "__main__":
    unittest.main(verbosity=2)
