#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const filename = path.resolve(here, '../userscript/yt-dlp-for-violentmonkey.user.js');
const source = fs.readFileSync(filename, 'utf8');

const requiredFragments = [
  '// @match        https://www.youtube.com/*',
  '// @match        https://music.youtube.com/*',
  '// @connect      127.0.0.1',
  '// @grant        GM_xmlhttpRequest',
  '// @grant        GM_getValue',
  '// @grant        GM_setValue',
  '// @grant        GM_addElement',
  '// @inject-into  content',
  '// @version      1.5.0',
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
for (const forbidden of ['keep_separate_streams:', "capabilities.includes('separate_streams')", 'Video + audio + merged']) {
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

console.log('Userscript metadata, pairing, retry, persistent resume, shortcut isolation, fullscreen visibility, three-mode, proxy, TLS bypass, safe-rendering, and diagnostic contracts are present.');
