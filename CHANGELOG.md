# Changelog

All notable changes to yt-dlp for Violentmonkey are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.3] — 2026-09-22

Clears the entire "Known issues" list carried into 1.7.2. These were design
weaknesses rather than defects, so each is a behaviour change; none alters the
API surface except for one optional, backward-compatible payload field.

**Upgrading:** run `./update-linux.sh` and re-import the regenerated paired
userscript. The panel now sends stream sizes, and an older paired script simply
omits them — the bridge falls back to equal weighting, so a stale pairing keeps
working.

### Changed

- **A Merge job's progress bar now runs once from 0 to 100%.** yt-dlp restarts
  `downloaded_bytes` for each media file, so the bar previously filled for the
  video and then again for the audio. The bridge now tracks which stream is in
  flight and spreads the bar across all of them. The panel sends the selected
  streams' sizes in a new optional `expected_bytes` field so the split reflects
  reality: a 150 MB video followed by a 3 MB audio track puts the handover at
  98%, not 50%. When a size is unknown — a Smart-quality preset, or `+bestaudio`
  chosen by yt-dlp — the panel omits the field rather than guessing and the
  bridge weights the streams equally. Single-stream jobs are unchanged.

- **HTTP keep-alive is enabled.** Responses no longer send `Connection: close`
  unconditionally, so the panel reuses one socket instead of opening a new TCP
  connection roughly every 900 ms while downloading. This required fixing the
  reason `close` was there in the first place: a request rejected before its body
  was read (bad token, bad `Host`, wrong `Content-Type`) left that body in the
  socket. Unread bodies are now drained before the error response, bodies past
  `MAX_BODY_BYTES` close the connection instead of being read, a short body is
  rejected rather than waited on, and idle connections are closed after 30
  seconds so a thread is not pinned per abandoned socket. A client asking for
  `Connection: close` is still honoured.

- **A download folder may only be used by one bridge at a time.** Two bridges on
  different ports sharing one `download_dir` each rediscovered the other's
  in-flight job as an interrupted record and offered to resume it, which would
  run a second yt-dlp against the same output file. The folder now carries an
  advisory lock (`.vm-yt-dlp.lock`, `flock` on POSIX and `LK_NBLCK` on Windows);
  a second instance exits with `instance_locked` naming the folder. Platforms
  with no locking primitive log a notice and continue rather than refuse to start.

- **Metadata responses are capped while they transfer.** `extract_info` used
  `subprocess.run`, which buffers everything before any size check, so
  `MAX_INFO_BYTES` reported an oversized response without ever bounding memory.
  Output is now read incrementally and abandoned the moment the cap is passed:
  rejecting a 200 MB response costs about 25 MB of peak RSS instead of 520 MB.
  The timeout moved to a watchdog, because a yt-dlp that produces no output at
  all leaves the read blocked and a deadline checked between reads never fires.

### Added

- `tests/userscript_behavior.mjs` — 31 checks that execute the real `fetchInfo`,
  `pollJobs`, `enqueueCurrent` and `sortedFormats` bodies against stubs, covering
  the SPA-navigation race, notification de-duplication, and the enqueue payload
  for every download mode. `userscript_contract.mjs` only matches source text,
  which cannot catch a logic error and is why the navigation defect shipped in
  1.7.1. Point the suite at another build with `VM_YTDLP_USERSCRIPT=...` — against
  1.7.1 it fails 8 of 19 checks.

- 18 further cases in `tests/test_regressions.py` covering progress weighting,
  keep-alive and desync resistance, the instance lock, and the metadata cap,
  bringing that file to 37. The memory-bound test runs in a child process and
  asserts peak RSS, since `ru_maxrss` is a high-water mark that would otherwise
  depend on test order. The full Python suite is 68 tests.

- README coverage for behaviour this release changed: the recovery-record
  retention policy, single-instance locking in the security model, merge-progress
  weighting in the queue section, `socks5h://` in the proxy examples, and how the
  two userscript suites differ.

## [1.7.2] — 2026-09-22

A maintenance release with no new features. It fixes fourteen defects found while
auditing 1.7.1, two of which could make the downloader unusable or silently
download the wrong video.

**Upgrading:** run `./update-linux.sh` (your token, settings and download folder are
kept), then re-import the regenerated `yt-dlp-for-violentmonkey.paired.user.js` in
Violentmonkey. The userscript changed, so an old paired script will not have the
navigation fix.

**One-time cleanup on first start:** the bridge now deletes recovery records older
than 30 days and trims the folder to the 50 newest. If you have a backlog of stale
paused jobs, expect a few `[bridge] Removed expired recovery record …` lines in the
journal. Partial `.part` files are never touched — only the resume records.

### Security

- **Proxy credentials no longer leak into job logs.** `redact_proxy_reference()`
  matched only the proxy URL spelled exactly as configured, so yt-dlp's other
  spellings passed through into the job log — which `/api/v1/jobs` returns and the
  panel displays. `using proxy user:pass@host:1080`, an uppercased URL, and a bare
  `password <secret> rejected` all survived redaction. Redaction is now
  case-insensitive and additionally covers the bare netloc, the `user:pass` pair,
  and the password on its own.

- **`Origin: null` is rejected instead of accepted and echoed.** `origin_allowed()`
  returned `True` for the literal string `null`, and the response then echoed
  `Access-Control-Allow-Origin: null`. That is exactly the origin a sandboxed
  iframe or a `data:`/`file:` document presents. The bearer token still gated every
  route, so this was defence-in-depth rather than an exploitable hole, but it
  contradicted the documented security model. An absent `Origin` remains allowed,
  because `GM_xmlhttpRequest` does not always send one.

- **Windows: a second process can no longer hijack the bridge port.**
  `allow_reuse_address` was unconditionally `True`. On POSIX `SO_REUSEADDR` only
  skips the `TIME_WAIT` delay, but on Windows it lets a second process bind a port
  that is already in use and take part of the traffic — splitting the
  token-protected API between two bridges, or an impostor. It is now enabled only
  on POSIX.

- **The pairing token is owner-only from the moment it is written.**
  `emit_userscript()` wrote the paired userscript and then called `chmod(0o600)`,
  leaving the token at umask permissions (typically `0644`) in between. The file is
  now created through `os.open(..., O_EXCL, 0o600)` and atomically renamed into
  place.

### Fixed

- **Stale recovery records no longer make the queue permanently refuse downloads.**
  Every failed, paused or interrupted job left a record in
  `<download_dir>/.vm-yt-dlp-resume/` that nothing ever removed, and each start
  re-imported them as `interrupted` jobs. Both eviction paths — `_prune_if_needed()`
  and `clear_finished()` — accepted only `completed` jobs, so once 100 records
  accumulated, every new download failed with `409 queue_full` forever. The error
  message advised clearing completed jobs, which had no effect. Above 100 records
  the surplus was also invisible in the panel while still occupying disk, and
  resurfaced as visible ones were forgotten. Records now expire after
  `RECOVERY_MAX_AGE_DAYS` (30) and are capped at `RECOVERY_SOFT_LIMIT` (50);
  `_prune_if_needed()` evicts in cost order (completed → interrupted →
  cancelled/failed) and removes the matching record.

- **Navigating during a slow metadata read no longer shows and downloads the
  previous video.** `fetchInfo()` guarded re-entry with a bare
  `if (state.infoLoading) return`. Reading formats routinely takes 10–30 seconds,
  so moving to another video inside that window meant no request was ever issued
  for the new one, and the earlier response then overwrote `state.info` and
  `state.infoUrl` unconditionally. The panel displayed the old video's formats on
  the new video's page, `enqueueCurrent()` queued the old video, and the state never
  self-repaired. The in-flight request URL is now tracked; a navigation supersedes
  it, superseded responses are discarded, and the result is re-checked against the
  current page before it is applied.

- **"Embed thumbnail" no longer leaves a stray image file.** `--write-thumbnail` was
  added whenever *either* thumbnail option was on, but `--embed-thumbnail` already
  fetches and cleans up the image by itself — passing both makes yt-dlp keep the
  sidecar. Enabling only "Embed thumbnail" left a converted `.jpg` beside every
  download. `--write-thumbnail` is now sent only when the file is actually wanted;
  format conversion still applies to the embedded image.

- **Chunked request bodies are refused rather than silently discarded.**
  `_read_json_body()` read `int(Content-Length or "0")`, so a request sent with
  `Transfer-Encoding: chunked` had its body read as zero bytes and validated as
  `{}` — accepted, ignored, then rejected for the wrong reason. Chunked bodies and a
  missing `Content-Length` now return `411 Length Required`.

- **A port conflict produces a readable error instead of a crash loop.** Binding
  happened outside any handler in `serve()`, and `main()` catches only
  `BridgeError`, so a taken port raised an unhandled `OSError`. Under systemd's
  `Restart=on-failure` that became a silent restart loop. It now raises
  `BridgeError("port_unavailable")` naming the port and the likely cause.

- **`clean_text()` strips embedded newlines.** Despite its name it handled only
  `\r`, letting `\n` through into job titles and error fields. All C0/C1 control
  characters now fold to spaces, so words either side of a removed break do not run
  together. A companion `clean_block()` sanitizes line by line and preserves
  deliberate breaks; it is used for the multi-line yt-dlp error text so it still
  renders as separate lines.

- **`socks5h://` proxies are accepted.** The scheme was missing from
  `PROXY_SCHEMES` even though yt-dlp supports it. Since `socks5h` is what resolves
  DNS at the proxy — the form SSH tunnels and Tor need — working configurations were
  rejected with "Proxy URL must use HTTP, HTTPS, SOCKS4, SOCKS4A, or SOCKS5."

- **The notification bookkeeping set no longer grows for the lifetime of the tab.**
  `state.notified` accumulated `id:status` entries and was never pruned. Entries for
  jobs the bridge no longer reports are now dropped once the set passes 200.

- **macOS: the bridge logs no longer grow without bound.** `install-macos.sh` pointed
  `StandardOutPath`/`StandardErrorPath` at `bridge.log` and `bridge-error.log` with
  no rotation, while the bridge writes one stderr line per HTTP request and the
  panel polls every 900 ms during a download — roughly 96,000 lines a day under
  load. The installer now generates a `newsyslog.conf` fragment and either installs
  it or prints the one-line `sudo cp` to enable rotation. Linux (journald) and
  Windows were unaffected.

- **macOS: re-running the installer no longer recreates the virtual environment.**
  `python3 -m venv` ran unconditionally, unlike the Linux installer, which checks
  first.

### Added

- **Forget all unfinished** button in the Queue header, shown only when resumable
  entries exist. It clears every paused, failed and recovered entry in one
  confirmed action instead of requiring a separate confirm dialog per job. Partial
  files are deliberately left on disk.

- `POST /api/v1/jobs/clear` accepts `{"include_unfinished": true}` to remove
  unfinished entries and their recovery records. Omitted or `false` keeps the
  previous behaviour of clearing only completed jobs.

- `tests/test_regressions.py` — 19 tests pinning every fix above. Copied onto an
  unpatched 1.7.1 tree, 15 of them fail.

### Changed

- Version bumped to 1.7.2 across `companion/vm_ytdlp_bridge.py`,
  `userscript/yt-dlp-for-violentmonkey.user.js`, `tests/test_bridge.py` and
  `tests/userscript_contract.mjs`.

### Known issues

Carried forward from 1.7.1 and deliberately not addressed in this release, because
each is a behaviour change rather than a defect fix. **All five were resolved in
1.7.3** — see above.

<details>
<summary>The five issues as they stood in 1.7.2</summary>


- **Merge-mode progress fills twice.** yt-dlp resets `downloaded_bytes` between the
  video and audio streams, so the single progress bar runs 0→100 % once per stream.
  A correct fix weights each stream by its size.
- **No HTTP keep-alive.** Every response sends `Connection: close` despite
  `protocol_version = "HTTP/1.1"`, so the panel opens a new TCP connection roughly
  every 900 ms while downloading.
- **No single-instance lock.** Two bridges sharing one `download_dir` each treat the
  other's in-flight job as resumable and would write to the same output file.
- **`MAX_INFO_BYTES` is checked after buffering.** `subprocess.run()` already holds
  the entire metadata response in memory, so the 24 MB limit does not bound memory
  use.
- **The userscript contract suite is largely source-text matching.** `fetchInfo()`,
  `pollJobs()` and `enqueueCurrent()` are never executed, which is why the
  navigation defect above shipped.

</details>

---

## [1.7.1] and earlier

See `RELEASE_NOTES.md` for the history of previous releases.

[1.7.3]: #173--2026-09-22
[1.7.2]: #172--2026-09-22
