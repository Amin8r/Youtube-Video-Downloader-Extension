#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const filename = path.resolve(here, '../userscript/yt-dlp-for-violentmonkey.user.js');
const splitControlsFixtureFilename = path.resolve(here, 'fixtures/youtube-right-controls-split.html');
const source = fs.readFileSync(filename, 'utf8');
const splitControlsFixture = fs.readFileSync(splitControlsFixtureFilename, 'utf8');

const requiredFragments = [
  '// @match        https://www.youtube.com/*',
  '// @match        https://music.youtube.com/*',
  '// @connect      127.0.0.1',
  '// @grant        GM_xmlhttpRequest',
  '// @grant        GM_getValue',
  '// @grant        GM_setValue',
  '// @grant        GM_addElement',
  '// @inject-into  content',
  '// @version      1.6.2',
  "attachShadow({ mode: 'closed' })",
  "document.implementation.createHTMLDocument('yt-dlp UI')",
  'replaceMarkup(shadow, `',
  'showDiagnosticFallback(error)',
  "const BOOTSTRAP_TOKEN = '__VM_YTDLP_TOKEN__'",
  "const BOOTSTRAP_API_BASE = '__VM_YTDLP_API_BASE__'",
  'BOOTSTRAP_TOKEN.length >= 32',
  'validApiBase(BOOTSTRAP_API_BASE)',
  "'/api/v1/health'",
  "'/api/v1/info'",
  "'/api/v1/jobs'",
  'proxy_url: proxyPayload()',
  'allow_invalid_certificates: state.settings.allowInvalidCertificates === true',
  'download_mode: state.form.downloadMode',
  "type: 'streams', video_format_id: mergeVideoFormat.format_id, audio_format_id: mergeAudioFormat.format_id",
  'retry_count: retryCount',
  "capabilities.includes('proxy')",
  "capabilities.includes('invalid_certificates')",
  "capabilities.includes('job_retries')",
  "capabilities.includes('download_modes_v2')",
  "capabilities.includes('persistent_resume')",
  "const RESUMABLE_STATUSES = new Set(['interrupted', 'failed', 'cancelled'])",
  "downloadMode: 'merge'",
  "mergeVideoFormatId: ''",
  "mergeAudioFormatId: ''",
  "retryCount: '2'",
  'writeThumbnail: false',
  'data-download-mode="video"',
  'data-download-mode="audio"',
  'data-download-mode="merge"',
  'Merge sources',
  'Video stream',
  'Audio stream',
  'function audioLanguageLabel(format)',
  'new Intl.DisplayNames(locales, { type: \'language\' })',
  'function audioPreferenceLabel(format)',
  'function audioPreferenceScore(format)',
  'format?.language_preference',
  "return 'Original'",
  "return 'Default'",
  'Language unknown',
  'tracks · language shown',
  "state.form.downloadMode === 'audio'\n          ? { type: 'exact'",
  'Automatic job retries',
  'Attempt ${attempt}/${maxAttempts}',
  "proxyUrl: 'socks5://127.0.0.1:1080'",
  'proxyHidden: false',
  'data-action="toggle-proxy-visibility"',
  "state.proxyHidden ? 'password' : 'text'",
  'The URL is visible by default',
  'allowInvalidCertificates: false',
  'This disables certificate validation for every HTTPS request made by yt-dlp',
  '.vm-switch input { position: absolute; inset: 0; z-index: 1;',
  'Authorization: `Bearer ${state.settings.token}`',
  "['127.0.0.1', 'localhost'].includes(url.hostname)",
  '#vm-ytdlp-player-button {',
  'position: relative !important;',
  'color: #fff !important;',
  'viewBox="0 0 24 24"',
  'width: 24px !important;',
  'height: 24px !important;',
  'fill: currentColor !important;',
  '#vm-ytdlp-player-button:hover .vm-ytdlp-player-icon,',
  'drop-shadow(0 0 6px rgba(255, 0, 51, .95))',
  "button.className = 'ytp-button vm-ytdlp-player-button'",
  "button.title = 'Download with yt-dlp'",
  "button.setAttribute('data-priority', '7')",
  "document.querySelector('#movie_player .ytp-right-controls')",
  'function findDirectPlayerControlAnchor(controls)',
  "child.classList?.contains('ytp-right-controls-right')",
  'playerButton.parentElement !== controls || (anchor && playerButton.nextElementSibling !== anchor)',
  'controls.insertBefore(playerButton, anchor || null)',
  "openPanel('download')",
  'const hidden = fullscreen || !currentVideoUrl() || !playerButton.isConnected',
  'if (!fullscreen) ensurePlayerButton()',
  '.vm-shell.fullscreen-hidden { display: none !important; }',
  "document.addEventListener('fullscreenchange', syncFullscreenVisibility, true)",
  "document.addEventListener('webkitfullscreenchange', syncFullscreenVisibility, true)",
  'document.fullscreenElement || document.webkitFullscreenElement',
  "shell.classList.toggle('fullscreen-hidden', fullscreen)",
  'data-resume-job="${h(job.id)}"',
  'data-forget-job="${h(job.id)}"',
  '/resume`, {',
  '/forget`, {})',
  "window.confirm('Forget this recovery record?",
  'Recovered downloads stay paused until you choose Resume',
  "shadow.addEventListener('keydown', stopYouTubeShortcuts)",
  "shadow.addEventListener('keyup', stopYouTubeShortcuts)",
  "shadow.addEventListener('keypress', stopYouTubeShortcuts)",
  "if (state.open && event.key !== 'Escape') event.stopPropagation()",
];

const missing = requiredFragments.filter((fragment) => !source.includes(fragment));
if (missing.length) {
  console.error(`Userscript contract failed; missing:\n${missing.join('\n')}`);
  process.exit(1);
}
for (const forbidden of [
  'keep_separate_streams:',
  "capabilities.includes('separate_streams')",
  'Video + audio + merged',
  '.vm-launcher',
  "controls.querySelector('.ytp-subtitles-button",
  '#vm-ytdlp-player-button::before',
  'color: #ff0033 !important;',
  'background: rgba(255, 0, 51, .16);',
]) {
  if (source.includes(forbidden)) {
    console.error(`Userscript contract failed: obsolete fragment remains: ${forbidden}`);
    process.exit(1);
  }
}
if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) {
  console.error('Userscript contract failed: dynamic code execution was found.');
  process.exit(1);
}
const htmlSinks = [...source.matchAll(/([A-Za-z0-9_$.]+)\.innerHTML\s*=/g)].map((match) => match[1]);
if (htmlSinks.length !== 1 || htmlSinks[0] !== 'inertDocument.body') {
  console.error(`Userscript contract failed: unexpected live-document HTML sink(s): ${htmlSinks.join(', ')}`);
  process.exit(1);
}
if ((source.match(/__VM_YTDLP_TOKEN__/g) || []).length !== 1) {
  console.error('Userscript contract failed: token placeholder count changed unexpectedly.');
  process.exit(1);
}
if ((source.match(/let languageDisplayNames = null;/g) || []).length !== 1
    || source.indexOf('let languageDisplayNames = null;') > source.indexOf('function apiRequest(')) {
  console.error('Userscript contract failed: the audio language-name cache is not in module scope.');
  process.exit(1);
}

for (const setting of ['proxyEnabled', 'allowInvalidCertificates', 'cookieEnabled', 'notifications']) {
  const inputIndex = source.indexOf(`data-setting="${setting}"`);
  const containingLabel = source.lastIndexOf('<label', inputIndex);
  const previousLabelEnd = source.lastIndexOf('</label>', inputIndex);
  const openingMarkup = source.slice(containingLabel, inputIndex);
  if (inputIndex < 0 || containingLabel <= previousLabelEnd || !openingMarkup.includes('class="vm-inline-toggle')) {
    console.error(`Userscript contract failed: ${setting} is not inside a clickable Settings label.`);
    process.exit(1);
  }
}

const helperStart = source.indexOf('function audioLanguageLabel(format)');
const helperEnd = source.indexOf('function sortedFormats(', helperStart);
if (helperStart < 0 || helperEnd <= helperStart) {
  console.error('Userscript contract failed: audio-language helpers could not be isolated.');
  process.exit(1);
}
const helperSource = source.slice(helperStart, helperEnd);
const helpers = new Function(
  'navigator',
  `let languageDisplayNames = null; ${helperSource}; return { audioLanguageLabel, audioPreferenceLabel, audioPreferenceScore };`,
)({ languages: ['en'] });
const originalAudio = { language: 'en', language_preference: 10, format_note: 'English (original)', abr: 128 };
const hindiDub = { language: 'hi', language_preference: -1, format_note: 'Hindi dubbed', abr: 192 };
if (helpers.audioLanguageLabel(originalAudio) !== 'English (en)') {
  console.error('Userscript contract failed: English audio was not rendered with its language code.');
  process.exit(1);
}
if (helpers.audioLanguageLabel(hindiDub) !== 'Hindi (hi)') {
  console.error('Userscript contract failed: Hindi audio was not rendered with its language code.');
  process.exit(1);
}
if (helpers.audioPreferenceLabel(originalAudio) !== 'Original' || helpers.audioPreferenceLabel(hindiDub) !== '') {
  console.error('Userscript contract failed: original/dubbed audio markers are incorrect.');
  process.exit(1);
}
if (helpers.audioPreferenceScore(originalAudio) <= helpers.audioPreferenceScore(hindiDub)) {
  console.error('Userscript contract failed: a higher-bitrate dubbed track outranks the original audio.');
  process.exit(1);
}
if (helpers.audioLanguageLabel({}) !== 'Language unknown') {
  console.error('Userscript contract failed: missing language metadata has no safe fallback.');
  process.exit(1);
}

const playerHelperStart = source.indexOf('function findPlayerRightControls()');
const playerHelperEnd = source.indexOf('function createUi()', playerHelperStart);
if (playerHelperStart < 0 || playerHelperEnd <= playerHelperStart) {
  console.error('Userscript contract failed: player-button helpers could not be isolated.');
  process.exit(1);
}
for (const fragment of [
  '<div class="ytp-right-controls">',
  '<div class="ytp-right-controls-left">',
  '<div class="ytp-right-controls-right">',
  '<button class="ytp-pip-button ytp-button"',
]) {
  if (!splitControlsFixture.includes(fragment)) {
    console.error(`Userscript contract failed: current YouTube controls fixture is missing ${fragment}`);
    process.exit(1);
  }
}

function fakeControl(...classes) {
  return {
    parentElement: null,
    isConnected: true,
    classList: { contains: (className) => classes.includes(className) },
  };
}
const leftGroup = fakeControl('ytp-right-controls-left');
const rightGroup = fakeControl('ytp-right-controls-right');
const pipButton = fakeControl('ytp-pip-button', 'ytp-button');
const nestedSubtitlesButton = fakeControl('ytp-subtitles-button', 'ytp-button');
nestedSubtitlesButton.parentElement = leftGroup;
const controls = {
  children: [leftGroup, rightGroup, pipButton],
  inserted: null,
  querySelector() {
    return nestedSubtitlesButton;
  },
  insertBefore(button, before) {
    if (before !== null && !this.children.includes(before)) throw new Error('NotFoundError');
    this.inserted = { button, before };
    button.parentElement = this;
    button.isConnected = true;
    button.nextElementSibling = before;
  },
};
for (const child of controls.children) child.parentElement = controls;
const fakeDocument = {
  activeControls: controls,
  querySelector(selector) {
    return selector === '#movie_player .ytp-right-controls' ? this.activeControls : null;
  },
  querySelectorAll() {
    return [];
  },
};
const playerHelpers = new Function(
  'document',
  `let playerButton = null;
   let mockVideoUrl = 'https://www.youtube.com/watch?v=abcdefghijk';
   function currentVideoUrl() { return mockVideoUrl; }
   function isFullscreenActive() { return false; }
   function buildPlayerButton() {
     return {
       parentElement: null,
       nextElementSibling: null,
       isConnected: false,
       hidden: true,
       tabIndex: -1,
       attributes: new Map(),
       setAttribute(name, value) { this.attributes.set(name, value); },
       remove() { this.parentElement = null; this.isConnected = false; },
     };
   }
   ${source.slice(playerHelperStart, playerHelperEnd)}
   return {
     ensurePlayerButton,
     syncPlayerButtonVisibility,
     getButton: () => playerButton,
     setVideoUrl: (value) => { mockVideoUrl = value; },
   };`,
)(fakeDocument);
if (!playerHelpers.ensurePlayerButton()) {
  console.error('Userscript contract failed: player button was not inserted into available controls.');
  process.exit(1);
}
const insertedButton = playerHelpers.getButton();
if (controls.inserted?.button !== insertedButton || controls.inserted?.before !== rightGroup
    || insertedButton.parentElement !== controls) {
  console.error('Userscript contract failed: player button was not mounted directly between YouTube control groups.');
  process.exit(1);
}
if (insertedButton.hidden || insertedButton.tabIndex !== 0 || insertedButton.attributes.get('aria-hidden') !== 'false') {
  console.error('Userscript contract failed: in-player button is not visible and keyboard-accessible on a watch page.');
  process.exit(1);
}
playerHelpers.syncPlayerButtonVisibility(true);
if (!insertedButton.hidden || insertedButton.tabIndex !== -1 || insertedButton.attributes.get('aria-hidden') !== 'true') {
  console.error('Userscript contract failed: in-player button remains accessible in fullscreen.');
  process.exit(1);
}
playerHelpers.setVideoUrl('');
if (playerHelpers.ensurePlayerButton() || insertedButton.isConnected || !insertedButton.hidden) {
  console.error('Userscript contract failed: in-player button remains attached away from a video page.');
  process.exit(1);
}

console.log('Userscript metadata, pairing, native white/red-glow player styling, in-player control placement, multilingual audio selection, retry, persistent resume, shortcut isolation, fullscreen visibility, three-mode, proxy, TLS bypass, safe-rendering, and diagnostic contracts are present.');
