# yt-dlp for Violentmonkey

An unofficial YouTube-only Violentmonkey userscript backed by the real `yt-dlp` running on your own computer. A download control inside YouTube's player—or the red launcher on the YouTube homepage—opens the polished download panel, while extraction, browser-cookie access, merging, post-processing, and file writing remain in a loopback-only companion process.

## What is included

- Three explicit modes: video-only, audio-only, and merged video plus audio
- Smart or exact quality controls for Video-only mode, an explicit source-track picker for Audio-only mode, and independent video/audio pickers for Merge mode
- Human-readable language labels on audio tracks, with yt-dlp's original/default track preferred automatically
- MP4, MKV, WebM, MP3, M4A, Opus, FLAC, and WAV output choices
- Manual and automatic subtitles, language patterns, SRT/WebVTT conversion, and optional embedding
- Thumbnail download/embedding, metadata JSON, description files, chapters, and embedded tags
- Sequential queue with live percentage, transferred size, average speed, ETA, flicker-free persistent logs, resumable pausing, and desktop notifications
- Layered retry handling for requests, fragments, file access, extraction, and complete failed jobs, with resumable partial files
- Persistent recovery records that rediscover interrupted jobs after the companion or computer restarts
- Final-only merging: successful video/audio inputs are removed after ffmpeg creates the combined media file
- Optional authenticated extraction through yt-dlp's local `--cookies-from-browser` support
- Per-userscript HTTP, HTTPS, SOCKS4, SOCKS4A, or SOCKS5 proxy support for metadata and downloads
- Optional self-signed/invalid TLS certificate support, disabled by default with an in-panel security warning
- YouTube SPA, Shorts, live-video, mobile YouTube, and YouTube Music watch-page support
- Compact white YouTube-style download button with a red hover glow, mounted directly in the player's right-side controls between its settings and theater/fullscreen groups
- Red floating homepage launcher for opening the panel when no video player is present
- Automatic download-button and panel hiding while the YouTube player is in fullscreen mode
- Muted unavailable controls, keyboard-friendly tabs, restrained transitions, and reduced-motion support
- Keyboard isolation so typing proxy addresses or other settings cannot trigger YouTube shortcuts such as Theater mode
- Firefox and Chromium support through Violentmonkey

Playlists and channel downloads are intentionally excluded from this first release.

## Why there is a companion

A userscript cannot execute Python programs, launch `ffmpeg`, read a browser cookie database, or write arbitrary files to your download directory. The included companion exposes a deliberately small HTTP API on `127.0.0.1:17442` and translates validated requests into yt-dlp argument arrays.

The userscript never receives browser cookies or Google video stream URLs.

## Requirements

- Violentmonkey in Firefox or a Chromium browser
- Python 3.10 or newer
- `ffmpeg` and `ffprobe` for merging, conversion, embedding, and post-processing
- Deno, Node.js, Bun, or QuickJS for yt-dlp's current full YouTube JavaScript support
- Internet access during installation so the installer can fetch the current `yt-dlp[default]` package

## Linux installation

This is the recommended path for Ubuntu, Debian, Fedora, Arch, and other systemd-based desktop distributions.

1. Extract this release.
2. Make the installers executable and run the Linux installer:

   ```bash
   chmod +x install-linux.sh update-linux.sh uninstall-linux.sh
   ./install-linux.sh
   ```

3. The installer creates `yt-dlp-for-violentmonkey.paired.user.js` beside itself. Open the Violentmonkey dashboard and install that file.
4. Open a YouTube video and click the white download button inside the right-side player controls, between settings and theater/fullscreen. It glows red when hovered. On the YouTube homepage, use the red floating launcher instead.

The bridge starts automatically in your user session. Downloads go to `~/Downloads/YouTube` by default.

To use yt-dlp's nightly channel instead of stable:

```bash
VM_YTDLP_CHANNEL=nightly ./install-linux.sh
```

## Windows installation

1. Install Python 3.10+, `ffmpeg`, and Deno or Node.js.
2. Extract the release.
3. In PowerShell, run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
   ```

4. Install the generated `yt-dlp-for-violentmonkey.paired.user.js` file through Violentmonkey.

The installer adds a per-user Startup entry and does not require administrator access.

## macOS installation

1. Install Python 3.10+, `ffmpeg`, and Deno or Node.js (Homebrew is fine).
2. Extract the release and run:

   ```bash
   chmod +x install-macos.sh
   ./install-macos.sh
   ```

3. Install the generated paired userscript through Violentmonkey.

The installer creates a per-user LaunchAgent.

## Authenticated downloads

Open the panel's **Settings** tab and enable **Use browser cookies**. Pick the browser whose active profile can view the video.

- Leave **Profile name or path** empty to use the most recently accessed profile.
- Firefox containers are supported through the optional container field.
- Linux Chromium browsers may require the correct keyring selection.
- On some platforms, Chromium locks its cookie database while the browser is running. If extraction fails, close that browser briefly and retry, or use a separate profile.

Cookie files and cookie values are never sent to the userscript. The companion only asks yt-dlp to read them locally for the requested download.

## Proxy setup

Open the panel's **Settings** tab, enable **Use proxy**, and enter the complete proxy URL. The same proxy is used while reading formats and while downloading queued media.

The proxy URL is visible by default so it can be checked and edited normally. Use the eye button at the right of the field to hide or reveal it. Anyone who can view your screen can read visible proxy credentials, so hide the value when screen sharing.

Supported examples:

- `http://127.0.0.1:8080`
- `https://proxy.example:8443`
- `socks5://127.0.0.1:1080`
- `socks5://user:password@127.0.0.1:1080`

The bridge validates the URL and passes it to yt-dlp's `--proxy` option as one argument. Proxy credentials are kept in Violentmonkey's private script storage, omitted from public queue objects, and redacted if yt-dlp repeats the configured URL in a log. Treat an exported or backed-up userscript data file as sensitive when it contains proxy credentials.

## Self-signed or invalid TLS certificates

Open **Settings → Network & proxy** and enable **Allow invalid TLS certificates** when a trusted local proxy or interception appliance uses a self-signed, expired, or hostname-mismatched certificate. The companion applies yt-dlp's [`--no-check-certificates`](https://github.com/yt-dlp/yt-dlp#workarounds) option during both format discovery and queued downloads.

This setting disables certificate validation for every HTTPS request in that yt-dlp operation—not only the connection to the proxy. A network attacker could impersonate YouTube or capture authenticated traffic, especially when browser cookies are enabled. Prefer installing the correct certificate authority when possible, and turn this option back off when it is no longer required.

## Reliable downloads and retries

The **Reliability → Automatic job retries** control chooses how many times the companion restarts a job after yt-dlp exits unsuccessfully. The default is two retries, for three total attempts; you can choose zero through five retries. The queue shows the current attempt and uses an increasing delay between attempts.

Each attempt also enables yt-dlp's own HTTP, fragment, file-access, and extractor retries with exponential delays. Compatible partial downloads remain as `.part` files and the next attempt uses the same output name, allowing yt-dlp to continue instead of discarding already downloaded data. Pause stops the active process immediately—even during retry backoff—while retaining its recovery record for Resume.

The companion writes a small recovery record for each queued job under the download folder's hidden `.vm-yt-dlp-resume` directory. If the browser, bridge, or computer stops before completion, the next bridge launch discovers that record and shows the job in the Queue as **Ready to resume**. Resume is always manual: choose **Resume** and yt-dlp runs with `--continue` against the existing `.part` files. A successful job removes its recovery record automatically.

Proxy credentials, browser-cookie choices, and the invalid-certificate setting are deliberately excluded from recovery records. The Resume button applies the settings currently selected in the userscript. Recovery records are created with owner-only permissions where the operating system supports them.

Only downloads queued by version 1.5.0 or newer have enough saved context for automatic discovery. Older orphaned `.part` files do not reliably identify their original URL, mode, selected streams, or post-processing choices and therefore cannot be resumed safely through the panel.

## Video-only, audio-only, and Merge modes

- **Video only** downloads a video-only stream. It does not select or add an audio track.
- **Audio only** downloads the explicitly selected source track and extracts or converts it to the chosen codec.
- **Merge** presents two independent selectors: one for the video-only stream and one for the audio-only stream. ffmpeg combines those exact choices into one final media file.

Audio-only and Merge mode display each track's language name and code when yt-dlp provides them. Tracks marked as original/default are sorted first, even when a dubbed track has a higher bitrate. Exact audio choices are strict: if the chosen format becomes unavailable, the job fails and can be retried instead of silently substituting another language.

Each job produces one media output. Merge mode explicitly uses yt-dlp's default intermediate cleanup behavior, so successfully merged video and audio inputs are deleted instead of being left beside the final file. Optional subtitles, thumbnails, descriptions, or metadata JSON can still create the sidecar files you selected.

Interrupted `.part` files can remain in the hidden `.vm-yt-dlp-parts` working subfolder so a retry can resume them. They are not completed source outputs and can be removed manually when no job is active if you no longer want to resume an interrupted download.

## Updating

On Linux, extract a newer bridge release over a new folder and run:

```bash
./update-linux.sh
```

Reinstall the regenerated paired userscript so its UI code is current. Your token and settings are retained.

Because YouTube changes frequently, first update yt-dlp if extraction suddenly stops working. To switch the Linux installation to nightly while updating:

```bash
VM_YTDLP_CHANNEL=nightly ./update-linux.sh
```

## Diagnostics

Linux:

```bash
systemctl --user status vm-yt-dlp.service
journalctl --user -u vm-yt-dlp.service -n 100 --no-pager
~/.local/share/vm-yt-dlp/venv/bin/python \
  ~/.local/share/vm-yt-dlp/vm_ytdlp_bridge.py doctor
```

If you installed with a non-default config path, add `--config /path/to/config.json` before `doctor`.

Common causes:

- **No player download button appears:** install the newest paired userscript and reload the YouTube tab. The button is inserted after YouTube creates its player controls and is intentionally hidden in fullscreen. Violentmonkey's menu includes **Show yt-dlp diagnostics**, and a startup failure displays a small **yt-dlp UI error** button instead of failing silently.
- **Panel says service unavailable:** start or restart the background service, then use **Test connection** in Settings.
- **Unauthorized:** reinstall the paired userscript or print the current token with the companion's `print-token` command and paste it in Settings.
- **A merged video has no audio:** confirm that both a video stream and an audio stream are selected, and install the actual `ffmpeg` executable rather than a Python package named ffmpeg.
- **Old video/audio source files remain after merging:** update the companion and reinstall the v1.5.0 paired userscript. New successful Merge jobs delete their inputs; failed or interrupted `.part` files can remain for retry.
- **An unfinished job does not appear:** automatic discovery applies to jobs originally queued by v1.5.0 or newer because earlier releases did not create recovery records.
- **YouTube extraction/signature errors:** update yt-dlp and make sure a supported JavaScript runtime is on the service's `PATH`.
- **Authenticated extraction fails:** verify the selected browser/profile/keyring and try while that browser is closed.
- **Self-signed certificate error:** enable **Allow invalid TLS certificates** only if you trust the proxy or network device presenting that certificate.
- **Metadata JSON privacy:** `.info.json` can contain account- or request-related metadata. Only enable it when you want that sidecar file.

## Security model

- The server binds only to IPv4 loopback (`127.0.0.1`).
- Every API route except the static service banner requires a cryptographically random bearer token.
- `Host` and browser `Origin` headers are checked to resist DNS rebinding and cross-site requests.
- The userscript's UI uses a closed Shadow DOM and keeps the token out of ordinary page DOM.
- The userscript runs in Violentmonkey's isolated content context and parses UI markup in an inert document before importing it into YouTube's DOM.
- Panel keyboard events are stopped inside the Shadow DOM so text entry cannot activate YouTube's global shortcuts.
- Request bodies are size-limited.
- Only HTTPS YouTube video URLs are accepted and normalized; playlist parameters are discarded.
- Format IDs, cookie selectors, proxy URLs, subtitle languages, containers, codecs, and every other option are validated against narrow schemas.
- Certificate validation bypass is a typed, default-off setting; arbitrary yt-dlp arguments are still rejected.
- Raw yt-dlp arguments are never accepted.
- yt-dlp is launched with `shell=False` semantics and an argument array.
- Pausing terminates the complete yt-dlp/ffmpeg process group while retaining compatible partial data for Resume.
- Recovery manifests are schema-validated before use, use owner-only permissions where supported, and never retain proxy credentials or browser-cookie settings.
- The paired userscript contains the local token. Treat that file as private and do not publish it.

Any local process running as your operating-system user can generally access your files and browser profile already; the bridge token primarily protects the service from arbitrary web pages.

## Queue behavior

Jobs run one at a time. This makes progress easier to understand and reduces concurrent pressure on YouTube. The displayed speed is the average observed transfer rate (bytes transferred divided by elapsed transfer time). Completed history remains in memory, while unfinished jobs have persistent recovery records and return as paused Queue entries after a restart. Failed and paused jobs can also be resumed manually. **Forget recovery record** removes the saved context but deliberately leaves partial files on disk.

## Configuration

Linux config: `~/.config/vm-yt-dlp/config.json`

Important fields:

- `port`: local API port, default `17442`
- `download_dir`: destination folder
- `concurrent_fragments`: 1–16, default `4`
- `token`: generated pairing secret
- `ytdlp_command`: optional string or argument array for an advanced custom yt-dlp installation

The companion manages `.vm-yt-dlp-parts` and `.vm-yt-dlp-resume` inside `download_dir`. Do not edit recovery JSON manually; invalid or tampered records are ignored.

If you change the port or token, regenerate/reinstall the paired userscript or update both values through its Settings tab.

## Testing

The release includes an offline fake-yt-dlp integration suite:

```bash
python3 -m unittest discover -s tests -v
node --check userscript/yt-dlp-for-violentmonkey.user.js
node tests/userscript_contract.mjs
```

The tests cover URL boundaries, cookie and proxy validation, opt-in certificate bypass, in-player button placement, homepage launcher behavior, multilingual audio labels and original-track preference, command whitelisting, retry limits and backoff, recovery-record permissions and credential omission, restart discovery, resume completion, recovery removal, persistent Queue-log state, shortcut isolation, fullscreen handling, disabled UI states, reduced-motion-aware transitions, all three download modes, final-only merging, average-speed calculation, queue completion/failure/pausing, token enforcement, allowed origins, and HTTP endpoints. They do not download copyrighted media or depend on YouTube being reachable.

## Responsible use

Download only material you are authorized to save. Respect creators' rights, YouTube's terms, applicable law, and any access restrictions. Cookie support does not grant access—it only lets yt-dlp use an account session that already has permission.

## Third-party software

This package does not bundle yt-dlp, ffmpeg, a JavaScript runtime, or Violentmonkey. The installer obtains yt-dlp separately. Those projects retain their own licenses. The bridge and userscript in this package are licensed under MIT; see `LICENSE`.
