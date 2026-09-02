# Version 1.5.1

Language-aware audio selection for multilingual YouTube videos.

- Added human-readable language names and language codes to every audio-stream option
- Marked yt-dlp's original/default audio track directly in the selector and metadata chips
- Sorted original/default audio ahead of dubbed tracks, using bitrate only as a secondary preference
- Changed Audio-only mode to always expose its real source-track picker
- Reset format choices when navigating to a different video so a previous track ID cannot carry over accidentally
- Removed the silent best-audio fallback from exact audio downloads so the selected language cannot be replaced unexpectedly
- Added multilingual English-original, Hindi-dubbed, and Spanish-dubbed fixtures and regression checks

Run the updater or installer and reinstall the newly generated paired userscript. Existing settings, pairing tokens, and recovery records remain compatible.

# Version 1.5.0

Persistent unfinished-download discovery and YouTube shortcut isolation.

- Added secure recovery manifests for every queued job and automatic discovery after bridge or computer restarts
- Added **Resume** controls for interrupted, failed, and cancelled jobs while retaining yt-dlp's compatible `.part` data
- Added **Forget recovery record** without deleting partial media files
- Applied the userscript's current proxy, browser-cookie, and TLS settings when a recovered job resumes; sensitive network settings are not persisted in manifests
- Removed recovery records automatically after successful completion
- Fixed typing `T` in the proxy field or other panel controls activating YouTube Theater mode
- Kept the fullscreen launcher-hiding behavior from v1.4.1
- Expanded the offline suite with persistence, restart, resume, credential-omission, permission, and API tests

Run the updater or installer and reinstall the newly generated paired userscript. Existing settings and pairing tokens remain compatible. Only jobs first queued by v1.5.0 or newer can be rediscovered automatically.

## Version 1.4.1

Fullscreen visibility hotfix.

- Hidden the floating launcher and panel whenever YouTube enters native player fullscreen
- Closed an open panel on fullscreen entry so it does not unexpectedly reappear when fullscreen ends
- Restored the launcher automatically after fullscreen exit
- Added Firefox and Chromium fullscreen-event regression contracts

Reinstall the newly generated paired userscript after running the updater or installer.

## Version 1.4.0

Clear three-mode downloads, independent Merge source selection, and final-only merged output.

- Redesigned the download panel around **Video only**, **Audio only**, and **Merge** mode cards
- Added independent video-only and audio-only stream selectors in Merge mode
- Changed Merge mode to create one final video-plus-audio media file and explicitly delete successful intermediate streams
- Made optional thumbnail and other sidecar files opt-in so a default Merge job leaves only its final media file
- Made Video-only selection strict so an audio track is never silently included
- Made the saved proxy URL visible by default and added an eye button to hide or reveal it without losing unsaved edits
- Kept layered yt-dlp retries, resumable `.part` files, browser-cookie authentication, proxy support, and invalid-certificate support
- Added strict mode/source validation, v1.4 capability negotiation, and regression coverage for all three commands

Run the updater or installer and reinstall the newly generated paired userscript. Existing pairing tokens and saved settings remain compatible.

## Version 1.3.0

Resumable job recovery and optional separate stream outputs.

- Added selectable automatic whole-job retries with exponential backoff and live attempt counters
- Increased yt-dlp request and fragment retries and added file-access, extractor, and per-retry sleep policies
- Preserved compatible `.part` files so restarted attempts can continue interrupted downloads
- Added **Video + audio + merged** mode, keeping the video-only and audio-only inputs beside the final ffmpeg-merged file
- Added strict retry-count and output-mode validation plus companion capability negotiation
- Added transient/permanent failure integration tests and separate-stream command regression coverage

Run the updater or installer and reinstall the newly generated paired userscript. Existing pairing tokens and saved settings remain compatible.

## Version 1.2.0

Optional self-signed and invalid TLS certificate support.

- Added a default-off **Allow invalid TLS certificates** switch under **Network & proxy**
- Applied yt-dlp's `--no-check-certificates` option to both format discovery and downloads when enabled
- Added a prominent warning that the bypass affects every yt-dlp HTTPS request, including authenticated traffic
- Added strict boolean validation and companion capability negotiation
- Expanded command-generation, HTTP API, metadata-extraction, and userscript contract tests

Run the updater or installer and reinstall the newly generated paired userscript.

## Version 1.1.1

Settings switch hotfix.

- Fixed the proxy, browser-cookie, and desktop-notification switches not responding to pointer clicks
- Expanded each invisible checkbox to the full visual switch area
- Added keyboard focus styling and regression checks for clickable Settings labels

Reinstall the newly generated paired userscript after running the updater or installer.

## Version 1.1.0

YouTube launcher reliability and proxy support.

- Fixed the invisible launcher on YouTube pages by forcing Violentmonkey's isolated content context
- Replaced live-document HTML assignment with inert-document parsing and imported DOM nodes for CSP and Trusted Types compatibility
- Added a visible startup-error button and Violentmonkey diagnostics menu command
- Added optional HTTP, HTTPS, SOCKS4, SOCKS4A, and SOCKS5 proxy settings
- Applied the selected proxy to format discovery and queued downloads
- Added strict proxy URL validation, authenticated proxy support, and credential redaction from public job data/logs
- Expanded the offline Python, HTTP API, and userscript contract tests

To update, install the new companion and reinstall the newly generated paired userscript. Existing tokens and settings remain compatible.

## Version 1.0.0

Initial YouTube-focused release.

- Local authenticated bridge with bearer-token pairing
- Video/audio format and quality controls
- Browser-cookie support without cookie transfer to the page
- Sequential live queue with cancellation and notifications
- Subtitle, thumbnail, description, JSON, chapter, and embedded metadata options
- Linux systemd, macOS LaunchAgent, and Windows Startup installers
- Offline unit and HTTP integration tests

Known first-release boundaries:

- Single videos only; playlists and channel pages are not queued
- Queue history is in memory
- The launcher is fixed at the lower-right rather than inserted into YouTube's frequently changing action-row DOM
