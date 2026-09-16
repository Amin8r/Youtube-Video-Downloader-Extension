# Version 1.7.1

Live-log rendering hotfix.

- Stopped rebuilding the complete Queue DOM on every active-download poll
- Updated progress, status, speed, ETA, and log text directly inside existing job cards
- Preserved the same open `<details>` and `<pre>` elements so log position, selection, focus, and scroll do not flicker
- Limited full card reconstruction to actual structural changes such as Pause becoming Resume or an output path appearing
- Restricted the log reveal animation to deliberate user opening instead of background refreshes
- Added no-flicker userscript regression contracts while retaining all v1.7.0 behavior

Run the updater or installer and reinstall the newly generated paired userscript. Existing settings, pairing tokens, queued jobs, and recovery records remain compatible.

# Version 1.7.0

Queue-state, progress, navigation, and visual-polish update.

- Kept opened yt-dlp logs open during live Queue polling, including their panel and log scroll positions
- Restored the red floating launcher on the YouTube homepage while retaining the white/red-glow player control on video pages
- Replaced the active-job stop glyph and user-facing cancellation wording with a clear pause (`||`) action; paused jobs remain resumable
- Changed displayed speed to an observed average based on bytes transferred over elapsed time instead of yt-dlp's instantaneous estimate
- Added clear muted styling and unavailable cursors to disabled selects, inputs, and switches
- Added restrained tab/content/log transitions with automatic `prefers-reduced-motion` support
- Improved tab semantics, keyboard arrow navigation, focus indicators, and launcher accessibility state
- Added regression coverage for the new UI contracts and average-speed calculation

Run the updater or installer and reinstall the newly generated paired userscript. Existing settings, pairing tokens, queued jobs, and recovery records remain compatible.

# Version 1.6.2

Native player-icon visual refinement.

- Changed the player download icon from red to white so it matches YouTube's captions, settings, theater, and fullscreen controls
- Changed the glyph and rendered size to YouTube's native-looking 24-by-24-pixel filled icon treatment
- Removed the red circular hover background
- Added a layered red outer glow on pointer hover and keyboard focus while keeping the glyph itself white
- Preserved the direct `.ytp-right-controls` placement, responsive priority, queue badge, SPA reinsertion, and fullscreen hiding
- Added visual-style regression contracts for the white default state and red hover glow

Run the updater or installer and reinstall the newly generated paired userscript. Existing settings, pairing tokens, queued jobs, and recovery records remain compatible.

# Version 1.6.1

Current YouTube split-control layout hotfix.

- Fixed the missing player button caused by using a nested captions/settings button as the reference node for the outer `.ytp-right-controls` container
- Mounted the download button as a direct child of `.ytp-right-controls`, immediately before `.ytp-right-controls-right`
- Added priority metadata so the custom control participates more naturally in YouTube's responsive player toolbar
- Retained a fallback for older flat player-control layouts
- Added a regression fixture matching YouTube's current left-group/right-group control structure and a strict direct-child insertion check

Run the updater or installer and reinstall the newly generated paired userscript. Existing settings, pairing tokens, queued jobs, and recovery records remain compatible.

# Version 1.6.0

Native YouTube player-control integration.

- Replaced the floating lower-right launcher with a compact button inside YouTube's right-side player controls
- Added a filled YouTube-style download glyph with a red finish and a subtle matching hover treatment
- Positioned the control immediately before captions/settings when those controls are present
- Preserved the active-download and resumable-job count badge on the new player button
- Reinserted the button automatically after YouTube SPA navigation or player-control reconstruction
- Kept the button and panel hidden in fullscreen mode
- Added regression contracts for player placement, fullscreen visibility, and removal of the old floating launcher

Run the updater or installer and reinstall the newly generated paired userscript. Existing settings, pairing tokens, queued jobs, and recovery records remain compatible.

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
