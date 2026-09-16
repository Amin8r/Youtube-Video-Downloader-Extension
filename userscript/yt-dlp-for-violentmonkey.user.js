// ==UserScript==
// @name         yt-dlp for Violentmonkey
// @namespace    local.vm-yt-dlp
// @version      1.7.1
// @description  A secure, native-feeling YouTube download panel powered by your local yt-dlp.
// @license      MIT
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://music.youtube.com/*
// @match        https://youtu.be/*
// @match        https://www.youtu.be/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_addElement
// @inject-into  content
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.7.1';
  const BOOTSTRAP_TOKEN = '__VM_YTDLP_TOKEN__';
  const BOOTSTRAP_API_BASE = '__VM_YTDLP_API_BASE__';
  const STORAGE_KEY = 'vmYtDlp.settings.v1';
  const ACTIVE_STATUSES = new Set(['queued', 'starting', 'downloading', 'postprocessing']);
  const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
  const RESUMABLE_STATUSES = new Set(['interrupted', 'failed', 'cancelled']);
  const VIDEO_PATH_RE = /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,32})/;

  const ICONS = {
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>',
    playerDownload: '<svg class="vm-ytdlp-player-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11 3h2v10.17l3.59-3.58L18 11l-6 6-6-6 1.41-1.41L11 13.17V3ZM5 19h14v2H5v-2Z"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5M4 18v-5h5M18.7 9A7 7 0 0 0 6.1 6.1L4 8m16 8-2.1 1.9A7 7 0 0 1 5.3 15"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>',
    queue: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 8 5-8 5V7Z"/></svg>',
    audio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13M9 9l11-2M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm11-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/></svg>',
    merge: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h3c4 0 4 6 8 6h5M4 18h3c4 0 4-6 8-6M17 9l3 3-3 3"/></svg>',
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 6.1A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.1 2.8M6.2 6.2C3.8 7.8 2.5 12 2.5 12s3.5 6 9.5 6c1.4 0 2.7-.3 3.8-.8M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
    alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H5a2 2 0 0 1-2-2V6Z"/></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  };

  const DEFAULTS = {
    token: '',
    apiBase: 'http://127.0.0.1:17442',
    cookieEnabled: false,
    cookieBrowser: /firefox/i.test(navigator.userAgent) ? 'firefox' : 'chrome',
    cookieProfile: '',
    cookieKeyring: '',
    cookieContainer: '',
    proxyEnabled: false,
    proxyUrl: 'socks5://127.0.0.1:1080',
    allowInvalidCertificates: false,
    notifications: true,
  };

  class ApiError extends Error {
    constructor(message, code = 'request_failed', status = 0, details = {}) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.status = status;
      this.details = details || {};
    }
  }

  function loadSettings() {
    let stored = {};
    try {
      stored = GM_getValue(STORAGE_KEY, {}) || {};
    } catch (_) {
      stored = {};
    }
    const settings = { ...DEFAULTS, ...stored };
    if (!settings.token && BOOTSTRAP_TOKEN.length >= 32) {
      settings.token = BOOTSTRAP_TOKEN;
    }
    if ((!stored.apiBase || stored.apiBase === DEFAULTS.apiBase) && validApiBase(BOOTSTRAP_API_BASE)) {
      settings.apiBase = BOOTSTRAP_API_BASE;
    }
    return settings;
  }

  const state = {
    open: false,
    tab: 'download',
    settings: loadSettings(),
    connection: 'checking',
    health: null,
    info: null,
    infoUrl: '',
    infoLoading: false,
    infoError: null,
    jobs: [],
    revision: -1,
    expandedJobDetails: new Set(),
    proxyHidden: false,
    form: {
      downloadMode: 'merge',
      selectionType: 'preset',
      preset: '1080',
      exactFormatId: '',
      mergeVideoFormatId: '',
      mergeAudioFormatId: '',
      container: 'mp4',
      audioCodec: 'mp3',
      audioQuality: '0',
      retryCount: '2',
      subtitleMode: 'none',
      subtitleLanguages: 'en.*,en',
      subtitleFormat: 'srt',
      embedSubtitles: false,
      writeThumbnail: false,
      embedThumbnail: false,
      thumbnailFormat: 'jpg',
      writeInfoJson: false,
      writeDescription: false,
      embedMetadata: true,
    },
    notified: new Set(),
    lastUrl: location.href,
    polling: false,
    destroyed: false,
    startupError: null,
  };

  let shadow;
  let shell;
  let playerButton;
  let playerButtonBadge;
  let homeLauncher;
  let homeLauncherBadge;
  let panel;
  let content;
  let connectionBadge;
  let queueBadge;
  let toastRack;
  let languageDisplayNames = null;
  let viewAnimationTimer = 0;

  function h(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function replaceMarkup(target, markup) {
    if (!target) return;
    const inertDocument = document.implementation.createHTMLDocument('yt-dlp UI');
    inertDocument.body.innerHTML = String(markup);
    const fragment = document.createDocumentFragment();
    for (const node of Array.from(inertDocument.body.childNodes)) {
      fragment.appendChild(document.importNode(node, true));
    }
    target.replaceChildren(fragment);
  }

  function elementFromMarkup(markup) {
    const container = document.createElement('div');
    replaceMarkup(container, markup);
    return container.firstElementChild;
  }

  function validApiBase(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && Boolean(url.port);
    } catch (_) {
      return false;
    }
  }

  function validProxyUrl(value) {
    if (typeof value !== 'string' || !value || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return false;
    try {
      const url = new URL(value);
      return ['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:'].includes(url.protocol)
        && Boolean(url.hostname)
        && !url.search
        && !url.hash
        && (url.pathname === '' || url.pathname === '/');
    } catch (_) {
      return false;
    }
  }

  function saveSettings() {
    GM_setValue(STORAGE_KEY, state.settings);
  }

  function cookiePayload() {
    return {
      enabled: state.settings.cookieEnabled,
      browser: state.settings.cookieBrowser,
      profile: state.settings.cookieProfile,
      keyring: state.settings.cookieKeyring,
      container: state.settings.cookieContainer,
    };
  }

  function proxyPayload() {
    return state.settings.proxyEnabled ? state.settings.proxyUrl.trim() : '';
  }

  async function requireNetworkCapabilities() {
    const needsProxy = Boolean(proxyPayload());
    const needsInvalidCertificates = state.settings.allowInvalidCertificates === true;
    if (!needsProxy && !needsInvalidCertificates) return;
    if (!state.health) await testConnection(false);
    const capabilities = Array.isArray(state.health?.capabilities) ? state.health.capabilities : [];
    if (needsProxy && !capabilities.includes('proxy')) {
      throw new ApiError('Proxy support requires the version 1.1.0 or newer local companion. Update the bridge, then try again.', 'proxy_not_supported');
    }
    if (needsInvalidCertificates && !capabilities.includes('invalid_certificates')) {
      throw new ApiError('Invalid-certificate support requires the version 1.2.0 or newer local companion. Update the bridge, then try again.', 'invalid_certificates_not_supported');
    }
  }

  async function requireDownloadCapabilities() {
    await requireNetworkCapabilities();
    if (!state.health) {
      const connected = await testConnection(false);
      if (!connected) {
        throw new ApiError('Could not connect to the local yt-dlp companion.', 'connection_failed');
      }
    }
    const capabilities = Array.isArray(state.health?.capabilities) ? state.health.capabilities : [];
    if (Number(state.form.retryCount) > 0 && !capabilities.includes('job_retries')) {
      throw new ApiError('Automatic job retries require the version 1.3.0 or newer local companion. Update the bridge, then try again.', 'job_retries_not_supported');
    }
    if (!capabilities.includes('download_modes_v2')) {
      throw new ApiError('The three download modes require the version 1.4.0 or newer local companion. Update the bridge, then try again.', 'download_modes_not_supported');
    }
    if (!capabilities.includes('persistent_resume')) {
      throw new ApiError('Persistent download recovery requires the version 1.5.0 or newer local companion. Update the bridge, then try again.', 'persistent_resume_not_supported');
    }
  }

  function apiRequest(method, path, body = undefined, timeout = 180000) {
    return new Promise((resolve, reject) => {
      if (!state.settings.token) {
        reject(new ApiError('Pairing token is missing. Open Settings and paste the token printed by the installer.', 'token_missing', 401));
        return;
      }
      if (!validApiBase(state.settings.apiBase)) {
        reject(new ApiError('The service address must use http://127.0.0.1:PORT or http://localhost:PORT.', 'invalid_api_base'));
        return;
      }
      const request = {
        method,
        url: `${state.settings.apiBase.replace(/\/$/, '')}${path}`,
        headers: {
          Authorization: `Bearer ${state.settings.token}`,
          Accept: 'application/json',
        },
        timeout,
        onload(response) {
          let parsed = {};
          try {
            parsed = response.responseText ? JSON.parse(response.responseText) : {};
          } catch (_) {
            reject(new ApiError('The local bridge returned an unreadable response.', 'invalid_response', response.status));
            return;
          }
          if (response.status >= 200 && response.status < 300) {
            resolve(parsed);
            return;
          }
          const error = parsed.error || {};
          reject(new ApiError(error.message || `Bridge request failed (${response.status}).`, error.code, response.status, error.details));
        },
        ontimeout() {
          reject(new ApiError('The local bridge timed out.', 'timeout'));
        },
        onerror() {
          reject(new ApiError('Could not reach the local bridge. Check that its service is running.', 'connection_failed'));
        },
        onabort() {
          reject(new ApiError('Bridge request was aborted.', 'aborted'));
        },
      };
      if (body !== undefined) {
        request.headers['Content-Type'] = 'application/json';
        request.data = JSON.stringify(body);
      }
      GM_xmlhttpRequest(request);
    });
  }

  function currentVideoUrl() {
    try {
      const url = new URL(location.href);
      const host = url.hostname.toLowerCase();
      let id = '';
      if (host === 'youtu.be' || host === 'www.youtu.be') {
        id = url.pathname.split('/').filter(Boolean)[0] || '';
      } else if (url.pathname.replace(/\/$/, '') === '/watch') {
        id = url.searchParams.get('v') || '';
      } else {
        id = url.pathname.match(VIDEO_PATH_RE)?.[1] || '';
      }
      return /^[A-Za-z0-9_-]{6,32}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : '';
    } catch (_) {
      return '';
    }
  }

  function isYouTubeHomepage() {
    try {
      const url = new URL(location.href);
      const host = url.hostname.toLowerCase();
      return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)
        && (url.pathname === '' || url.pathname === '/');
    } catch (_) {
      return false;
    }
  }

  function formatBytes(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(number) / Math.log(1024)), units.length - 1);
    const scaled = number / 1024 ** index;
    return `${scaled >= 100 || index === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[index]}`;
  }

  function formatDuration(seconds) {
    const number = Math.max(0, Math.round(Number(seconds)));
    if (!Number.isFinite(number)) return '—';
    const hours = Math.floor(number / 3600);
    const minutes = Math.floor((number % 3600) / 60);
    const secs = number % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  function phaseIcon(status) {
    if (status === 'completed') return ICONS.check;
    if (status === 'failed') return ICONS.alert;
    if (status === 'cancelled') return ICONS.pause;
    if (status === 'interrupted') return ICONS.refresh;
    return ICONS.download;
  }

  function ensurePlayerButtonStyle() {
    const styleId = 'vm-ytdlp-player-button-style';
    if (document.getElementById(styleId)) return;
    const cssText = `
      #vm-ytdlp-player-button {
        position: relative !important;
        width: 48px !important;
        min-width: 48px !important;
        height: 100% !important;
        padding: 0 !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        overflow: visible !important;
        color: #fff !important;
        background: transparent !important;
        border: 0 !important;
        cursor: pointer !important;
        vertical-align: top !important;
        box-sizing: border-box !important;
        opacity: .9;
        transition: opacity .15s ease !important;
      }
      #vm-ytdlp-player-button[hidden] { display: none !important; }
      #vm-ytdlp-player-button:hover,
      #vm-ytdlp-player-button:focus-visible,
      #vm-ytdlp-player-button[aria-expanded='true'] {
        color: #fff !important;
        opacity: 1;
      }
      #vm-ytdlp-player-button:focus-visible { outline: 2px solid rgba(255, 255, 255, .9) !important; outline-offset: -5px; }
      #vm-ytdlp-player-button .vm-ytdlp-player-icon {
        position: relative;
        z-index: 1;
        width: 24px !important;
        height: 24px !important;
        display: block !important;
        fill: currentColor !important;
        stroke: none !important;
        filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .55));
        transition: filter .16s ease, transform .1s ease;
        pointer-events: none;
      }
      #vm-ytdlp-player-button .vm-ytdlp-player-icon path { fill: currentColor !important; }
      #vm-ytdlp-player-button:hover .vm-ytdlp-player-icon,
      #vm-ytdlp-player-button:focus-visible .vm-ytdlp-player-icon,
      #vm-ytdlp-player-button[aria-expanded='true'] .vm-ytdlp-player-icon {
        filter:
          drop-shadow(0 0 2px rgba(255, 0, 51, 1))
          drop-shadow(0 0 6px rgba(255, 0, 51, .95))
          drop-shadow(0 0 12px rgba(255, 0, 51, .55));
      }
      #vm-ytdlp-player-button:active .vm-ytdlp-player-icon { transform: scale(.9); }
      #vm-ytdlp-player-button .vm-ytdlp-player-badge {
        position: absolute;
        z-index: 2;
        top: 5px;
        right: 2px;
        min-width: 15px;
        height: 15px;
        padding: 0 4px;
        display: none;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(0, 0, 0, .72);
        border-radius: 8px;
        color: #fff;
        background: #ff0033;
        box-shadow: 0 1px 4px rgba(0, 0, 0, .48);
        font: 800 9px/1 Roboto, Arial, sans-serif;
        pointer-events: none;
      }
      #vm-ytdlp-player-button .vm-ytdlp-player-badge.visible { display: inline-flex; }
      #vm-ytdlp-player-button .vm-ytdlp-player-badge.resume { color: #18130a; background: #ffbd4a; }
      @media (prefers-reduced-motion: reduce) {
        #vm-ytdlp-player-button,
        #vm-ytdlp-player-button .vm-ytdlp-player-icon { transition-duration: .01ms !important; }
      }
    `;
    const parent = document.head || document.documentElement;
    try {
      GM_addElement(parent, 'style', { id: styleId, textContent: cssText });
    } catch (_) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = cssText;
      parent.appendChild(style);
    }
  }

  function buildPlayerButton() {
    ensurePlayerButtonStyle();
    const button = document.createElement('button');
    button.id = 'vm-ytdlp-player-button';
    button.className = 'ytp-button vm-ytdlp-player-button';
    button.type = 'button';
    button.title = 'Download with yt-dlp';
    button.setAttribute('data-title-no-tooltip', 'Download with yt-dlp');
    button.setAttribute('data-priority', '7');
    button.setAttribute('aria-label', 'Open yt-dlp download panel');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    replaceMarkup(button, `${ICONS.playerDownload}<span class="vm-ytdlp-player-badge" aria-hidden="true"></span>`);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openPanel('download');
    });
    for (const eventName of ['pointerdown', 'mousedown', 'mouseup', 'dblclick', 'keydown', 'keyup']) {
      button.addEventListener(eventName, (event) => event.stopPropagation());
    }
    playerButtonBadge = button.querySelector('.vm-ytdlp-player-badge');
    return button;
  }

  function findPlayerRightControls() {
    const primary = document.querySelector('#movie_player .ytp-right-controls');
    if (primary) return primary;
    return Array.from(document.querySelectorAll('.html5-video-player .ytp-right-controls'))
      .find((controls) => !controls.closest('ytd-miniplayer')) || null;
  }

  function findDirectPlayerControlAnchor(controls) {
    const children = Array.from(controls?.children || []);
    const rightGroup = children.find((child) => child.classList?.contains('ytp-right-controls-right'));
    if (rightGroup) return rightGroup;
    const anchorClasses = ['ytp-subtitles-button', 'ytp-settings-button', 'ytp-miniplayer-button', 'ytp-size-button', 'ytp-fullscreen-button'];
    return children.find((child) => anchorClasses.some((className) => child.classList?.contains(className))) || null;
  }

  function syncPlayerButtonVisibility(fullscreen = isFullscreenActive()) {
    if (!playerButton) return;
    const hidden = fullscreen || !currentVideoUrl() || !playerButton.isConnected;
    playerButton.hidden = hidden;
    playerButton.tabIndex = hidden ? -1 : 0;
    playerButton.setAttribute('aria-hidden', String(hidden));
  }

  function ensurePlayerButton() {
    if (!playerButton) playerButton = buildPlayerButton();
    const controls = currentVideoUrl() ? findPlayerRightControls() : null;
    if (!controls) {
      if (playerButton.isConnected) playerButton.remove();
      syncPlayerButtonVisibility();
      return false;
    }
    const anchor = findDirectPlayerControlAnchor(controls);
    if (playerButton.parentElement !== controls || (anchor && playerButton.nextElementSibling !== anchor)) {
      controls.insertBefore(playerButton, anchor || null);
    }
    syncPlayerButtonVisibility();
    return true;
  }

  function createUi() {
    if (document.getElementById('vm-ytdlp-bridge-host')) return;
    const host = document.createElement('div');
    host.id = 'vm-ytdlp-bridge-host';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'closed' });
    replaceMarkup(shadow, `
      <style>
        :host { all: initial; color-scheme: dark; }
        *, *::before, *::after { box-sizing: border-box; }
        button, input, select { font: inherit; }
        button { border: 0; }
        svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        .vm-shell {
          --red: #ff3155;
          --red-strong: #ff1744;
          --red-soft: rgba(255,49,85,.14);
          --panel: #111216;
          --panel-2: #17181e;
          --panel-3: #202127;
          --line: rgba(255,255,255,.095);
          --muted: #9b9ca6;
          --text: #f7f7f9;
          --green: #35d07f;
          --amber: #ffbd4a;
          --blue: #65a9ff;
          position: fixed;
          inset: 0;
          z-index: 2147483646;
          pointer-events: none;
          direction: ltr;
          font: 500 14px/1.45 Inter, Roboto, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: var(--text);
        }
        .vm-shell.fullscreen-hidden { display: none !important; }
        .vm-home-launcher {
          pointer-events: none;
          position: absolute;
          right: 22px;
          bottom: 22px;
          width: 56px;
          height: 56px;
          display: grid;
          place-items: center;
          border-radius: 18px;
          color: #fff;
          background: linear-gradient(145deg, #ff4765, #e50032);
          box-shadow: 0 14px 38px rgba(229,0,50,.35), inset 0 1px 0 rgba(255,255,255,.24);
          cursor: pointer;
          opacity: 0;
          visibility: hidden;
          transform: translateY(8px) scale(.9);
          transition: opacity .2s ease, visibility .2s ease, transform .2s cubic-bezier(.2,.8,.2,1), box-shadow .2s ease;
        }
        .vm-home-launcher.visible { pointer-events: auto; opacity: 1; visibility: visible; transform: translateY(0) scale(1); }
        .vm-home-launcher::after {
          content: '';
          position: absolute;
          inset: -5px;
          border: 1px solid rgba(255,49,85,.32);
          border-radius: 22px;
          opacity: 0;
          transform: scale(.9);
          transition: opacity .2s ease, transform .2s ease;
        }
        .vm-home-launcher:hover { transform: translateY(-2px) scale(1.025); box-shadow: 0 18px 44px rgba(229,0,50,.46); }
        .vm-home-launcher:hover::after { opacity: 1; transform: scale(1); }
        .vm-home-launcher:active { transform: scale(.96); }
        .vm-home-launcher:focus-visible { outline: 3px solid rgba(255,255,255,.92); outline-offset: 4px; }
        .vm-home-launcher svg { width: 25px; height: 25px; stroke-width: 2.1; }
        .vm-home-launcher-badge {
          position: absolute;
          top: -5px;
          right: -5px;
          min-width: 21px;
          height: 21px;
          padding: 0 5px;
          display: none;
          place-items: center;
          border: 2px solid #0f1013;
          border-radius: 11px;
          color: #fff;
          background: #292b32;
          font-size: 10px;
          font-weight: 800;
        }
        .vm-home-launcher-badge.visible { display: grid; }
        .vm-home-launcher-badge.resume { color: #18130a; background: var(--amber); }
        .vm-shell.open .vm-home-launcher { pointer-events: none; opacity: 0; visibility: hidden; transform: scale(.8); }
        .vm-backdrop {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: rgba(0,0,0,.28);
          backdrop-filter: blur(1px);
          opacity: 0;
          transition: opacity .24s ease;
        }
        .vm-panel {
          pointer-events: auto;
          position: absolute;
          top: 12px;
          right: 12px;
          bottom: 12px;
          width: min(440px, calc(100vw - 24px));
          overflow: hidden;
          display: flex;
          flex-direction: column;
          border: 1px solid rgba(255,255,255,.11);
          border-radius: 24px;
          background:
            radial-gradient(circle at 90% -10%, rgba(255,49,85,.11), transparent 34%),
            linear-gradient(160deg, rgba(24,25,31,.98), rgba(13,14,18,.985));
          box-shadow: 0 26px 90px rgba(0,0,0,.52), inset 0 1px 0 rgba(255,255,255,.045);
          transform: translateX(calc(100% + 34px)) scale(.98);
          opacity: 0;
          transition: transform .28s cubic-bezier(.2,.8,.2,1), opacity .22s ease;
        }
        .vm-shell.open .vm-panel { transform: translateX(0) scale(1); opacity: 1; }
        .vm-shell.open .vm-backdrop { opacity: 1; pointer-events: auto; }
        .vm-header { padding: 18px 18px 13px; border-bottom: 1px solid var(--line); background: rgba(10,11,14,.48); }
        .vm-title-row { display: flex; align-items: center; gap: 12px; }
        .vm-logo {
          width: 39px;
          height: 39px;
          flex: 0 0 39px;
          border-radius: 13px;
          display: grid;
          place-items: center;
          background: linear-gradient(145deg, #ff4765, #d90030);
          box-shadow: 0 9px 22px rgba(235,0,52,.25);
        }
        .vm-logo svg { width: 21px; height: 21px; }
        .vm-title { min-width: 0; flex: 1; }
        .vm-title h2 { margin: 0; font-size: 15.5px; font-weight: 760; letter-spacing: -.015em; }
        .vm-title p { margin: 2px 0 0; color: var(--muted); font-size: 11.5px; }
        .vm-status { display: inline-flex; align-items: center; gap: 6px; }
        .vm-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--amber); box-shadow: 0 0 0 3px rgba(255,189,74,.11); }
        .vm-status.ready .vm-status-dot { background: var(--green); box-shadow: 0 0 0 3px rgba(53,208,127,.11); }
        .vm-status.offline .vm-status-dot { background: var(--red); box-shadow: 0 0 0 3px rgba(255,49,85,.11); }
        .vm-icon-btn {
          width: 36px;
          height: 36px;
          flex: 0 0 36px;
          display: grid;
          place-items: center;
          border-radius: 11px;
          color: #b8bac3;
          background: transparent;
          cursor: pointer;
          transition: .16s ease;
        }
        .vm-icon-btn:hover { color: #fff; background: rgba(255,255,255,.075); }
        .vm-nav { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 15px; padding: 4px; border-radius: 14px; background: rgba(255,255,255,.045); }
        .vm-tab {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          height: 36px;
          border-radius: 10px;
          color: #94959e;
          background: transparent;
          cursor: pointer;
          font-size: 12px;
          font-weight: 700;
          transition: .17s ease;
        }
        .vm-tab svg { width: 16px; height: 16px; transition: transform .18s ease, color .18s ease; }
        .vm-tab:hover { color: #dddde2; }
        .vm-tab.active { color: #fff; background: #292a31; box-shadow: 0 4px 14px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.07); }
        .vm-tab.active svg { color: #ff607b; transform: translateY(-1px) scale(1.06); }
        .vm-tab:focus-visible, .vm-mode-card:focus-visible, .vm-icon-btn:focus-visible, .vm-secondary:focus-visible, .vm-job-action:focus-visible { outline: 2px solid rgba(255,49,85,.72); outline-offset: 2px; }
        .vm-tab-count { min-width: 17px; height: 17px; padding: 0 4px; display: inline-grid; place-items: center; border-radius: 9px; color: #fff; background: var(--red); font-size: 9px; }
        .vm-content { flex: 1; min-height: 0; overflow: auto; padding: 16px 18px 22px; overscroll-behavior: contain; scrollbar-color: #34353d transparent; scrollbar-width: thin; }
        .vm-content.vm-view-enter > * { animation: vm-view-enter .22s cubic-bezier(.2,.8,.2,1) both; }
        .vm-content.vm-view-enter > *:nth-child(2) { animation-delay: 25ms; }
        .vm-content.vm-view-enter > *:nth-child(3) { animation-delay: 50ms; }
        .vm-content.vm-view-refresh > * { animation: vm-view-refresh .18s ease both; }
        @keyframes vm-view-enter { from { opacity: 0; transform: translateY(6px); } }
        @keyframes vm-view-refresh { from { opacity: .72; transform: translateY(3px); } }
        .vm-content::-webkit-scrollbar { width: 8px; }
        .vm-content::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 8px; background: #363740; background-clip: padding-box; }
        .vm-card { border: 1px solid var(--line); border-radius: 17px; background: rgba(255,255,255,.035); box-shadow: inset 0 1px 0 rgba(255,255,255,.025); }
        .vm-video { overflow: hidden; margin-bottom: 14px; }
        .vm-video-visual { position: relative; aspect-ratio: 16/8.4; overflow: hidden; background: #090a0d; }
        .vm-video-visual img { width: 100%; height: 100%; display: block; object-fit: cover; }
        .vm-video-visual::after { content: ''; position: absolute; inset: 0; background: linear-gradient(transparent 45%, rgba(0,0,0,.74)); }
        .vm-duration { position: absolute; right: 10px; bottom: 9px; z-index: 1; padding: 3px 7px; border-radius: 7px; background: rgba(0,0,0,.78); font-size: 10.5px; font-weight: 750; }
        .vm-video-copy { padding: 12px 13px 13px; }
        .vm-video-copy h3 { margin: 0; overflow: hidden; color: #f4f4f6; font-size: 13.5px; font-weight: 720; text-overflow: ellipsis; white-space: nowrap; }
        .vm-video-copy p { margin: 3px 0 0; overflow: hidden; color: var(--muted); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
        .vm-section { margin-top: 16px; }
        .vm-section-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 1px 8px; }
        .vm-section-title { color: #d8d8dc; font-size: 11px; font-weight: 780; letter-spacing: .075em; text-transform: uppercase; }
        .vm-section-note { color: #747680; font-size: 10px; }
        .vm-mode-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
        .vm-mode-card { min-width: 0; min-height: 82px; padding: 10px; display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; gap: 8px; border: 1px solid var(--line); border-radius: 13px; color: #8f9099; background: #111217; cursor: pointer; text-align: left; transition: .16s ease; }
        .vm-mode-card:hover { color: #d9d9de; border-color: rgba(255,255,255,.14); background: #17181e; }
        .vm-mode-card.active { color: #fff; border-color: rgba(255,49,85,.42); background: linear-gradient(145deg, rgba(255,49,85,.15), #1a1b21 68%); box-shadow: 0 7px 18px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.06); }
        .vm-mode-card svg { width: 18px; height: 18px; color: #858791; }
        .vm-mode-card.active svg { color: #ff607b; }
        .vm-mode-card strong { display: block; overflow: hidden; font-size: 10.8px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
        .vm-mode-card small { display: block; margin-top: 2px; color: #676a74; font-size: 8.6px; font-weight: 560; line-height: 1.25; }
        .vm-mode-card.active small { color: #a4a5ad; }
        .vm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .vm-field { display: block; min-width: 0; }
        .vm-field.full { grid-column: 1 / -1; }
        .vm-label { display: flex; align-items: center; justify-content: space-between; min-height: 18px; margin: 0 2px 6px; color: #a9aab2; font-size: 10.5px; font-weight: 680; }
        .vm-input, .vm-select {
          width: 100%;
          height: 41px;
          border: 1px solid var(--line);
          border-radius: 11px;
          outline: none;
          color: #eeeeF2;
          background: #111217;
          padding: 0 11px;
          font-size: 12px;
          transition: color .16s ease, background-color .16s ease, border-color .16s ease, box-shadow .16s ease, opacity .16s ease;
        }
        .vm-input::placeholder { color: #5f616b; }
        .vm-input:focus, .vm-select:focus { border-color: rgba(255,49,85,.65); box-shadow: 0 0 0 3px rgba(255,49,85,.095); }
        .vm-input:disabled, .vm-select:disabled {
          color: #696b74;
          border-color: rgba(255,255,255,.055);
          background-color: #0d0e12;
          opacity: .68;
          cursor: not-allowed;
          box-shadow: none;
        }
        .vm-input:disabled::placeholder { color: #454750; }
        .vm-select:disabled { background-image: linear-gradient(45deg, transparent 50%, #4c4e56 50%), linear-gradient(135deg, #4c4e56 50%, transparent 50%); }
        .vm-field:has(.vm-input:disabled, .vm-select:disabled) .vm-label { color: #62646d; }
        .vm-input-shell { position: relative; }
        .vm-input-shell .vm-input { padding-right: 43px; }
        .vm-input-action { position: absolute; top: 4px; right: 4px; width: 33px; height: 33px; display: grid; place-items: center; border-radius: 8px; color: #7d7f89; background: #1b1c22; cursor: pointer; transition: .16s ease; }
        .vm-input-action:hover { color: #fff; background: #282930; }
        .vm-input-action:focus-visible { outline: 2px solid rgba(255,49,85,.65); outline-offset: 1px; }
        .vm-input-action svg { width: 16px; height: 16px; }
        .vm-select { appearance: none; padding-right: 31px; background-image: linear-gradient(45deg, transparent 50%, #777983 50%), linear-gradient(135deg, #777983 50%, transparent 50%); background-position: calc(100% - 16px) 17px, calc(100% - 11px) 17px; background-size: 5px 5px; background-repeat: no-repeat; }
        .vm-format-meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
        .vm-chip { padding: 3px 7px; border: 1px solid rgba(255,255,255,.075); border-radius: 7px; color: #8e9099; background: rgba(255,255,255,.025); font-size: 9.5px; }
        .vm-toggle-list { overflow: hidden; border: 1px solid var(--line); border-radius: 14px; background: #111217; }
        .vm-toggle-row { min-height: 47px; padding: 9px 11px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid rgba(255,255,255,.06); cursor: pointer; transition: color .16s ease, background-color .16s ease, opacity .16s ease; }
        .vm-toggle-row:last-child { border-bottom: 0; }
        .vm-toggle-row.disabled { background: rgba(0,0,0,.08); opacity: .55; cursor: not-allowed; }
        .vm-toggle-row.disabled .vm-toggle-copy strong { color: #777982; }
        .vm-toggle-row.disabled .vm-toggle-copy small { color: #555760; }
        .vm-toggle-copy { min-width: 0; flex: 1; }
        .vm-toggle-copy strong { display: block; color: #d9d9de; font-size: 11.5px; font-weight: 670; }
        .vm-toggle-copy small { display: block; margin-top: 1px; color: #6e707a; font-size: 9.5px; }
        .vm-switch { position: relative; width: 35px; height: 21px; flex: 0 0 35px; }
        .vm-switch input { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
        .vm-switch input:disabled { cursor: not-allowed; }
        .vm-switch span { position: absolute; inset: 0; border-radius: 11px; background: #303139; pointer-events: none; transition: .18s ease; }
        .vm-switch span::after { content: ''; position: absolute; top: 3px; left: 3px; width: 15px; height: 15px; border-radius: 50%; background: #8c8e97; transition: .18s ease; }
        .vm-switch input:checked + span { background: var(--red); }
        .vm-switch input:checked + span::after { left: 17px; background: #fff; }
        .vm-switch input:focus-visible + span { box-shadow: 0 0 0 3px rgba(255,49,85,.24); }
        .vm-primary {
          width: 100%;
          height: 48px;
          margin-top: 17px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          border-radius: 14px;
          color: #fff;
          background: linear-gradient(135deg, #ff3f60, #df0030);
          box-shadow: 0 11px 28px rgba(224,0,48,.25), inset 0 1px 0 rgba(255,255,255,.2);
          cursor: pointer;
          font-size: 12.5px;
          font-weight: 780;
          transition: transform .16s ease, filter .16s ease, opacity .16s ease;
        }
        .vm-primary:hover { filter: brightness(1.08); transform: translateY(-1px); }
        .vm-primary:active { transform: scale(.985); }
        .vm-primary:disabled { opacity: .45; cursor: wait; transform: none; }
        .vm-primary svg { width: 19px; height: 19px; }
        .vm-secondary { height: 38px; padding: 0 13px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--line); border-radius: 11px; color: #c3c4ca; background: rgba(255,255,255,.04); cursor: pointer; font-size: 11px; font-weight: 680; transition: .16s ease; }
        .vm-secondary:hover { color: #fff; background: rgba(255,255,255,.075); }
        .vm-secondary.danger:hover { color: #ff8297; border-color: rgba(255,49,85,.25); background: rgba(255,49,85,.08); }
        .vm-secondary svg { width: 15px; height: 15px; }
        .vm-helper { display: flex; align-items: flex-start; gap: 8px; margin-top: 11px; padding: 10px 11px; border: 1px solid rgba(101,169,255,.12); border-radius: 12px; color: #878b96; background: rgba(101,169,255,.045); font-size: 9.8px; }
        .vm-helper svg { width: 15px; height: 15px; flex: 0 0 15px; color: var(--blue); }
        .vm-helper.warning { border-color: rgba(255,189,74,.2); color: #aaa18f; background: rgba(255,189,74,.06); }
        .vm-helper.warning svg { color: var(--amber); }
        .vm-empty { min-height: 330px; padding: 32px 18px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
        .vm-empty-icon { width: 56px; height: 56px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 18px; color: #737680; background: rgba(255,255,255,.035); }
        .vm-empty-icon svg { width: 25px; height: 25px; }
        .vm-empty h3 { margin: 14px 0 5px; color: #e3e3e7; font-size: 14px; }
        .vm-empty p { max-width: 290px; margin: 0; color: #777983; font-size: 11px; }
        .vm-empty .vm-secondary { margin-top: 15px; }
        .vm-skeleton { overflow: hidden; position: relative; background: #22232a; }
        .vm-skeleton::after { content: ''; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgba(255,255,255,.06), transparent); animation: vm-shimmer 1.25s infinite; }
        @keyframes vm-shimmer { to { transform: translateX(100%); } }
        .vm-skeleton.hero { height: 188px; border-radius: 17px; }
        .vm-skeleton.line { height: 12px; margin-top: 11px; border-radius: 6px; }
        .vm-skeleton.line.short { width: 62%; }
        .vm-queue-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .vm-queue-summary strong { display: block; color: #e6e6e9; font-size: 13px; }
        .vm-queue-summary span { color: var(--muted); font-size: 10px; }
        .vm-job { overflow: hidden; margin-bottom: 10px; padding: 12px; }
        .vm-job:last-child { margin-bottom: 0; }
        .vm-job-top { display: flex; gap: 10px; }
        .vm-job-thumb { width: 77px; height: 45px; flex: 0 0 77px; overflow: hidden; border-radius: 9px; background: #0a0b0e; }
        .vm-job-thumb img { width: 100%; height: 100%; display: block; object-fit: cover; }
        .vm-job-main { min-width: 0; flex: 1; }
        .vm-job-title { overflow: hidden; margin: 1px 0 3px; color: #e7e7ea; font-size: 11.5px; font-weight: 690; text-overflow: ellipsis; white-space: nowrap; }
        .vm-job-phase { display: flex; align-items: center; gap: 5px; color: #81838d; font-size: 9.8px; }
        .vm-job-phase-icon { width: 12px; height: 12px; flex: 0 0 12px; display: grid; place-items: center; }
        .vm-job-phase svg { width: 12px; height: 12px; }
        .vm-job.completed .vm-job-phase { color: var(--green); }
        .vm-job.failed .vm-job-phase { color: #ff7089; }
        .vm-job.cancelled .vm-job-phase { color: #8e9098; }
        .vm-job.interrupted .vm-job-phase { color: var(--amber); }
        .vm-progress-track { height: 5px; margin-top: 11px; overflow: hidden; border-radius: 4px; background: #292a30; }
        .vm-progress-bar { height: 100%; width: 0; border-radius: inherit; background: linear-gradient(90deg, #ff3155, #ff6b7f); box-shadow: 0 0 12px rgba(255,49,85,.33); transition: width .45s ease; }
        .vm-job.completed .vm-progress-bar { background: var(--green); box-shadow: none; }
        .vm-job.failed .vm-progress-bar, .vm-job.cancelled .vm-progress-bar { background: #555761; box-shadow: none; }
        .vm-job-stats { min-height: 24px; padding-top: 7px; display: flex; align-items: center; gap: 9px; color: #71737d; font-size: 9.5px; }
        .vm-job-stats .spacer { flex: 1; }
        .vm-job-actions { display: flex; align-items: center; gap: 5px; }
        .vm-job-action { min-width: 26px; height: 26px; padding: 0 7px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; border-radius: 8px; color: #81838c; background: rgba(255,255,255,.04); cursor: pointer; font-size: 9px; font-weight: 720; transition: color .16s ease, background-color .16s ease, transform .16s ease; }
        .vm-job-action:hover { color: #fff; background: rgba(255,255,255,.08); }
        .vm-job-action:active { transform: scale(.94); }
        .vm-job-action svg { width: 13px; height: 13px; }
        .vm-job-action.resume { color: #ffd177; background: rgba(255,189,74,.1); }
        .vm-job-action.resume:hover { color: #ffe3aa; background: rgba(255,189,74,.18); }
        .vm-job-action.pause:hover { color: #ff8da0; background: rgba(255,49,85,.12); }
        .vm-details { margin-top: 7px; }
        .vm-details summary { width: max-content; color: #777a84; cursor: pointer; font-size: 9.5px; transition: color .16s ease; }
        .vm-details summary:hover { color: #b2b4bc; }
        .vm-details[open] summary { color: #a6a8b0; }
        .vm-details pre { max-height: 130px; overflow: auto; margin: 7px 0 0; padding: 9px; border-radius: 9px; color: #a6a8b0; background: #0b0c0f; white-space: pre-wrap; word-break: break-word; font: 9px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; transform-origin: top; }
        .vm-details.just-opened pre { animation: vm-log-reveal .18s ease both; }
        @keyframes vm-log-reveal { from { opacity: 0; transform: translateY(-3px); } }
        .vm-settings-group { overflow: hidden; margin-bottom: 13px; padding: 14px; }
        .vm-settings-title { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; color: #e1e1e5; font-size: 12px; font-weight: 730; }
        .vm-settings-title svg { width: 16px; height: 16px; color: #9c9ea7; }
        .vm-settings-copy { margin: -5px 0 12px; color: #747680; font-size: 9.8px; }
        .vm-setting-row { margin-top: 10px; }
        .vm-setting-row:first-of-type { margin-top: 0; }
        .vm-inline-toggle { display: flex; align-items: center; gap: 10px; cursor: pointer; }
        .vm-inline-toggle .vm-toggle-copy { flex: 1; }
        .vm-setting-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
        .vm-setting-actions .vm-primary { height: 42px; margin: 0; border-radius: 12px; }
        .vm-setting-actions .vm-secondary { height: 42px; }
        .vm-path { margin-top: 9px; padding: 9px 10px; border-radius: 9px; color: #8d8f98; background: #0c0d10; font: 9.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; word-break: break-all; }
        .vm-toast-rack { position: absolute; right: 18px; bottom: 18px; width: min(340px, calc(100vw - 36px)); display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
        .vm-toast { display: flex; align-items: flex-start; gap: 9px; padding: 11px 12px; border: 1px solid rgba(255,255,255,.12); border-radius: 13px; color: #e8e8eb; background: rgba(30,31,37,.97); box-shadow: 0 14px 35px rgba(0,0,0,.38); animation: vm-toast-in .22s ease both; font-size: 10.5px; }
        .vm-toast svg { width: 16px; height: 16px; flex: 0 0 16px; color: var(--green); }
        .vm-toast.error svg { color: #ff647e; }
        @keyframes vm-toast-in { from { opacity: 0; transform: translateY(8px) scale(.98); } }
        .vm-footer { margin-top: 13px; color: #50525b; text-align: center; font-size: 9px; }
        @media (max-width: 600px) {
          .vm-panel { inset: 0; width: 100%; border: 0; border-radius: 0; }
          .vm-content { padding-left: 14px; padding-right: 14px; }
          .vm-home-launcher { right: 15px; bottom: 15px; }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
        }
      </style>
      <div class="vm-shell">
        <button class="vm-home-launcher" type="button" data-action="open-home-panel" aria-label="Open yt-dlp download panel" aria-haspopup="dialog" aria-expanded="false" aria-hidden="true" tabindex="-1">
          ${ICONS.download}<span class="vm-home-launcher-badge" aria-hidden="true"></span>
        </button>
        <div class="vm-backdrop" data-action="close"></div>
        <aside class="vm-panel" role="dialog" aria-modal="true" aria-label="yt-dlp download panel">
          <header class="vm-header">
            <div class="vm-title-row">
              <div class="vm-logo">${ICONS.download}</div>
              <div class="vm-title">
                <h2>yt-dlp</h2>
                <p class="vm-status"><span class="vm-status-dot"></span><span class="vm-status-label">Checking local service…</span></p>
              </div>
              <button class="vm-icon-btn" type="button" data-action="refresh" aria-label="Refresh video data">${ICONS.refresh}</button>
              <button class="vm-icon-btn" type="button" data-action="close" aria-label="Close panel">${ICONS.close}</button>
            </div>
            <nav class="vm-nav" role="tablist" aria-label="yt-dlp sections">
              <button class="vm-tab active" id="vm-tab-download" type="button" role="tab" data-tab="download" aria-controls="vm-panel-content">${ICONS.download}<span>Download</span></button>
              <button class="vm-tab" id="vm-tab-queue" type="button" role="tab" data-tab="queue" aria-controls="vm-panel-content">${ICONS.queue}<span>Queue</span><span class="vm-tab-count" hidden>0</span></button>
              <button class="vm-tab" id="vm-tab-settings" type="button" role="tab" data-tab="settings" aria-controls="vm-panel-content">${ICONS.settings}<span>Settings</span></button>
            </nav>
          </header>
          <main class="vm-content" id="vm-panel-content" role="tabpanel" tabindex="0"></main>
        </aside>
        <div class="vm-toast-rack" aria-live="polite"></div>
      </div>`);

    const inlineStyle = shadow.querySelector('style');
    if (inlineStyle) {
      const cssText = inlineStyle.textContent;
      inlineStyle.remove();
      try {
        GM_addElement(shadow, 'style', { textContent: cssText });
      } catch (_) {
        const fallbackStyle = document.createElement('style');
        fallbackStyle.textContent = cssText;
        shadow.appendChild(fallbackStyle);
      }
    }

    shell = shadow.querySelector('.vm-shell');
    homeLauncher = shadow.querySelector('.vm-home-launcher');
    homeLauncherBadge = shadow.querySelector('.vm-home-launcher-badge');
    panel = shadow.querySelector('.vm-panel');
    content = shadow.querySelector('.vm-content');
    connectionBadge = shadow.querySelector('.vm-status');
    queueBadge = shadow.querySelector('.vm-tab-count');
    toastRack = shadow.querySelector('.vm-toast-rack');

    ensurePlayerButton();
    content.addEventListener('click', handleQueueActionClick);
    shadow.addEventListener('click', handleShellClick);
    shadow.addEventListener('keydown', handleTabKeyboard);
    shadow.addEventListener('keydown', stopYouTubeShortcuts);
    shadow.addEventListener('keyup', stopYouTubeShortcuts);
    shadow.addEventListener('keypress', stopYouTubeShortcuts);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.open) closePanel();
    });
    document.addEventListener('fullscreenchange', syncFullscreenVisibility, true);
    document.addEventListener('webkitfullscreenchange', syncFullscreenVisibility, true);
    syncFullscreenVisibility();
    updateChrome();
    renderCurrentTab();
  }

  function stopYouTubeShortcuts(event) {
    if (state.open && event.key !== 'Escape') event.stopPropagation();
  }

  function isFullscreenActive() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function syncFullscreenVisibility() {
    if (!shell) return;
    const fullscreen = isFullscreenActive();
    if (!fullscreen) ensurePlayerButton();
    shell.classList.toggle('fullscreen-hidden', fullscreen);
    shell.setAttribute('aria-hidden', String(fullscreen));
    syncPlayerButtonVisibility(fullscreen);
    if (fullscreen && state.open) {
      state.open = false;
      shell.classList.remove('open');
      playerButton?.setAttribute('aria-expanded', 'false');
    }
    syncHomepageLauncherVisibility(fullscreen);
  }

  function syncHomepageLauncherVisibility(fullscreen = isFullscreenActive()) {
    if (!homeLauncher) return;
    const visible = isYouTubeHomepage() && !fullscreen && !state.open;
    homeLauncher.classList.toggle('visible', visible);
    homeLauncher.tabIndex = visible ? 0 : -1;
    homeLauncher.setAttribute('aria-hidden', String(!visible));
    homeLauncher.setAttribute('aria-expanded', String(state.open));
  }

  function handleShellClick(event) {
    const target = event.target.closest('button,[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const tab = target.dataset.tab;
    if (tab) {
      const changed = state.tab !== tab;
      state.tab = tab;
      updateChrome();
      renderCurrentTab(changed);
      if (tab === 'download') fetchInfo(false);
      if (tab === 'queue') pollJobs(true);
      return;
    }
    if (action === 'open-home-panel') {
      openPanel('download');
      return;
    }
    if (action === 'close') closePanel();
    if (action === 'refresh') {
      if (state.tab === 'download') fetchInfo(true);
      else if (state.tab === 'queue') pollJobs(true);
      else testConnection(true);
    }
  }

  function handleTabKeyboard(event) {
    const currentTab = event.target.closest?.('[data-tab]');
    if (!currentTab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(shadow.querySelectorAll('[data-tab]'));
    const currentIndex = tabs.indexOf(currentTab);
    if (currentIndex < 0) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex].click();
    tabs[nextIndex].focus({ preventScroll: true });
  }

  function openPanel(tab = null) {
    if (isFullscreenActive()) return;
    if (tab) state.tab = tab;
    state.open = true;
    shell.classList.add('open');
    updateChrome();
    renderCurrentTab(true);
    if (state.tab === 'download') fetchInfo(false);
    if (state.tab === 'queue') pollJobs(true);
    panel.querySelector('button')?.focus({ preventScroll: true });
  }

  function closePanel() {
    state.open = false;
    shell.classList.remove('open');
    playerButton?.setAttribute('aria-expanded', 'false');
    syncHomepageLauncherVisibility();
    if (homeLauncher?.classList.contains('visible')) homeLauncher.focus({ preventScroll: true });
    else if (playerButton?.isConnected && !playerButton.hidden) playerButton.focus({ preventScroll: true });
  }

  function updateChrome() {
    if (!shadow) return;
    shadow.querySelectorAll('.vm-tab').forEach((button) => {
      const active = button.dataset.tab === state.tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (active) content?.setAttribute('aria-labelledby', button.id);
    });
    connectionBadge.className = `vm-status ${state.connection === 'ready' ? 'ready' : state.connection === 'offline' ? 'offline' : ''}`;
    const label = connectionBadge.querySelector('.vm-status-label');
    label.textContent = state.connection === 'ready'
      ? `Local service ready${state.health?.yt_dlp_version ? ` · yt-dlp ${state.health.yt_dlp_version}` : ''}`
      : state.connection === 'offline'
        ? 'Local service unavailable'
        : 'Checking local service…';
    const activeCount = state.jobs.filter((job) => ACTIVE_STATUSES.has(job.status)).length;
    const resumableCount = state.jobs.filter((job) => job.resumable === true || RESUMABLE_STATUSES.has(job.status)).length;
    const attentionCount = activeCount + resumableCount;
    queueBadge.hidden = attentionCount === 0;
    queueBadge.textContent = String(attentionCount);
    playerButton?.setAttribute('aria-expanded', String(state.open));
    if (playerButtonBadge) {
      playerButtonBadge.classList.toggle('visible', attentionCount > 0);
      playerButtonBadge.classList.toggle('resume', activeCount === 0 && resumableCount > 0);
      playerButtonBadge.textContent = String(attentionCount);
    }
    if (homeLauncherBadge) {
      homeLauncherBadge.classList.toggle('visible', attentionCount > 0);
      homeLauncherBadge.classList.toggle('resume', activeCount === 0 && resumableCount > 0);
      homeLauncherBadge.textContent = String(attentionCount);
    }
    syncHomepageLauncherVisibility();
  }

  function animateContentChange(className = 'vm-view-enter') {
    if (!content) return;
    clearTimeout(viewAnimationTimer);
    content.classList.remove('vm-view-enter', 'vm-view-refresh');
    void content.offsetWidth;
    content.classList.add(className);
    viewAnimationTimer = setTimeout(() => content?.classList.remove(className), 360);
  }

  function renderCurrentTab(animate = false) {
    if (!content) return;
    if (state.tab === 'download') renderDownload();
    else if (state.tab === 'queue') renderQueue();
    else renderSettings();
    if (animate) animateContentChange();
  }

  async function testConnection(showResult = false) {
    if (!state.settings.token) {
      state.connection = 'offline';
      state.health = null;
      updateChrome();
      if (showResult) toast('Pairing token is missing.', true);
      return false;
    }
    state.connection = 'checking';
    updateChrome();
    try {
      const health = await apiRequest('GET', '/api/v1/health', undefined, 10000);
      state.health = health;
      state.connection = health.status === 'ready' ? 'ready' : 'offline';
      if (showResult) toast(`Connected to yt-dlp ${health.yt_dlp_version}.`);
      updateChrome();
      return state.connection === 'ready';
    } catch (error) {
      state.connection = 'offline';
      state.health = null;
      updateChrome();
      if (showResult) toast(error.message, true);
      return false;
    }
  }

  async function fetchInfo(force = false) {
    const url = currentVideoUrl();
    if (!url) {
      state.info = null;
      state.infoUrl = '';
      state.infoError = null;
      if (state.tab === 'download') renderDownload();
      return;
    }
    if (!force && state.info && state.infoUrl === url) return;
    if (state.infoLoading) return;
    const previousInfoUrl = state.infoUrl;
    state.infoLoading = true;
    state.infoError = null;
    if (state.tab === 'download') renderDownload();
    try {
      await requireNetworkCapabilities();
      const response = await apiRequest('POST', '/api/v1/info', {
        url,
        cookies: cookiePayload(),
        proxy_url: proxyPayload(),
        allow_invalid_certificates: state.settings.allowInvalidCertificates === true,
      });
      if (previousInfoUrl !== url) {
        state.form.exactFormatId = '';
        state.form.mergeVideoFormatId = '';
        state.form.mergeAudioFormatId = '';
      }
      state.info = response.info;
      state.infoUrl = url;
      state.connection = 'ready';
      ensureExactFormat();
    } catch (error) {
      state.info = null;
      state.infoUrl = '';
      state.infoError = error;
      if (error.code === 'connection_failed' || error.status === 401) state.connection = 'offline';
    } finally {
      state.infoLoading = false;
      updateChrome();
      if (state.tab === 'download') renderDownload();
    }
  }

  function activeMediaType() {
    return state.form.downloadMode === 'audio' ? 'audio' : 'video';
  }

  function audioLanguageLabel(format) {
    const code = String(format?.language || '').trim();
    if (!code) return 'Language unknown';
    let display = '';
    try {
      if (!languageDisplayNames && typeof Intl.DisplayNames === 'function') {
        const locales = Array.isArray(navigator.languages) && navigator.languages.length ? navigator.languages : ['en'];
        languageDisplayNames = new Intl.DisplayNames(locales, { type: 'language' });
      }
      display = languageDisplayNames?.of(code) || '';
    } catch (_) {
      try {
        const baseCode = code.split(/[-_]/)[0];
        display = baseCode && languageDisplayNames ? languageDisplayNames.of(baseCode) || '' : '';
      } catch (_) {
        display = '';
      }
    }
    if (!display || display.toLowerCase() === code.toLowerCase()) return code;
    return `${display} (${code})`;
  }

  function audioPreferenceLabel(format) {
    const preference = Number(format?.language_preference);
    const note = String(format?.format_note || '');
    if (/\boriginal\b/i.test(note)) return 'Original';
    if (/\bdefault\b/i.test(note) || (Number.isFinite(preference) && preference > 0)) return 'Default';
    return '';
  }

  function audioPreferenceScore(format) {
    const rawPreference = Number(format?.language_preference);
    let score = Number.isFinite(rawPreference) ? rawPreference : 0;
    const note = String(format?.format_note || '').toLowerCase();
    if (/\boriginal\b/.test(note)) score += 200;
    else if (/\bdefault\b/.test(note)) score += 100;
    if (/\bdub(?:bed)?\b/.test(note)) score -= 100;
    return score;
  }

  function sortedFormats(mediaType = activeMediaType()) {
    const candidates = [...(state.info?.formats || [])].filter((format) => {
      if (mediaType === 'audio') {
        return state.form.downloadMode === 'merge'
          ? format.has_audio && !format.has_video
          : format.has_audio;
      }
      if (state.form.downloadMode === 'video' || state.form.downloadMode === 'merge') {
        return format.has_video && !format.has_audio;
      }
      return format.has_video;
    });
    let formats = candidates;
    if (mediaType === 'audio' && state.form.downloadMode === 'audio') {
      const audioOnlyFormats = candidates.filter((format) => !format.has_video);
      if (audioOnlyFormats.length) formats = audioOnlyFormats;
    }
    formats.sort((a, b) => {
      if (mediaType === 'video') {
        return (Number(b.height) - Number(a.height)) || (Number(b.fps) - Number(a.fps)) || (Number(b.tbr) - Number(a.tbr));
      }
      return (audioPreferenceScore(b) - audioPreferenceScore(a))
        || (Number(b.abr) - Number(a.abr))
        || (Number(b.tbr) - Number(a.tbr));
    });
    return formats;
  }

  function ensureExactFormat() {
    if (state.form.downloadMode === 'merge') {
      const videoFormats = sortedFormats('video');
      const audioFormats = sortedFormats('audio');
      if (!videoFormats.some((format) => format.format_id === state.form.mergeVideoFormatId)) {
        state.form.mergeVideoFormatId = videoFormats[0]?.format_id || '';
      }
      if (!audioFormats.some((format) => format.format_id === state.form.mergeAudioFormatId)) {
        state.form.mergeAudioFormatId = audioFormats[0]?.format_id || '';
      }
      return;
    }
    const formats = sortedFormats();
    if (!formats.some((format) => format.format_id === state.form.exactFormatId)) {
      state.form.exactFormatId = formats[0]?.format_id || '';
    }
  }

  function formatLabel(format) {
    const size = format.filesize || format.filesize_approx;
    const sizeText = size ? ` · ${formatBytes(size)}` : '';
    if (format.has_video) {
      const resolution = format.height ? `${format.height}p` : format.resolution || 'video';
      const fps = format.fps ? ` ${format.fps}fps` : '';
      const audio = format.has_audio ? ' · video+audio' : ' · video only';
      return `${format.format_id} · ${resolution}${fps} · ${format.ext}${audio}${sizeText}`;
    }
    const bitrate = format.abr || format.tbr;
    const language = audioLanguageLabel(format);
    const preference = audioPreferenceLabel(format);
    const preferred = preference ? ` · ${preference}` : '';
    const channels = format.audio_channels ? ` · ${format.audio_channels}ch` : '';
    const note = String(format.format_note || '').trim();
    const noteText = note && !/\b(?:original|default)\b/i.test(note) ? ` · ${note}` : '';
    return `${format.format_id} · ${language}${preferred} · ${bitrate ? `${Math.round(bitrate)}k · ` : ''}${format.ext} · ${format.acodec}${channels}${noteText}${sizeText}`;
  }

  function formatMeta(format) {
    if (!format) return '';
    const size = format.filesize || format.filesize_approx;
    const language = format.has_audio ? `<span class="vm-chip">${h(audioLanguageLabel(format))}</span>` : '';
    const preference = format.has_audio ? audioPreferenceLabel(format) : '';
    const preferred = preference ? `<span class="vm-chip">${h(preference)}</span>` : '';
    const channels = format.audio_channels ? `<span class="vm-chip">${h(format.audio_channels)} channels</span>` : '';
    return `<div class="vm-format-meta"><span class="vm-chip">${h(format.vcodec)}</span><span class="vm-chip">${h(format.acodec)}</span>${language}${preferred}${channels}<span class="vm-chip">${h(format.protocol)}</span>${size ? `<span class="vm-chip">${formatBytes(size)}</span>` : ''}</div>`;
  }

  function renderDownload() {
    if (!state.settings.token) {
      replaceMarkup(content, emptyState(ICONS.shield, 'Pair the userscript', 'Run the local installer, then install its generated paired userscript—or paste the printed token in Settings.', 'Open Settings', 'open-settings'));
      bindEmptyActions();
      return;
    }
    const url = currentVideoUrl();
    if (!url) {
      replaceMarkup(content, emptyState(ICONS.play, 'Open a YouTube video', 'The download controls appear for watch pages, Shorts, and live-video pages. Playlists are intentionally excluded.'));
      return;
    }
    if (state.infoLoading) {
      replaceMarkup(content, `
        <div class="vm-skeleton hero"></div>
        <div class="vm-skeleton line"></div>
        <div class="vm-skeleton line short"></div>
        <div class="vm-footer">Reading available formats with your local yt-dlp…</div>`);
      return;
    }
    if (state.infoError) {
      const reason = state.infoError.details?.reason || state.infoError.message;
      replaceMarkup(content, emptyState(ICONS.alert, 'Could not read this video', reason, 'Try again', 'retry-info', true));
      bindEmptyActions();
      return;
    }
    if (!state.info) {
      replaceMarkup(content, emptyState(ICONS.download, 'Video data is ready to load', 'Use the local bridge to inspect formats without exposing cookies to the page.', 'Load formats', 'retry-info'));
      bindEmptyActions();
      return;
    }

    ensureExactFormat();
    const info = state.info;
    const isAudioMode = state.form.downloadMode === 'audio';
    const isVideoOnlyMode = state.form.downloadMode === 'video';
    const isMergeMode = state.form.downloadMode === 'merge';
    const formats = isMergeMode ? sortedFormats('video') : sortedFormats();
    const selectedFormat = formats.find((format) => format.format_id === state.form.exactFormatId);
    const mergeVideoFormats = isMergeMode ? sortedFormats('video') : [];
    const mergeAudioFormats = isMergeMode ? sortedFormats('audio') : [];
    const selectedMergeVideo = mergeVideoFormats.find((format) => format.format_id === state.form.mergeVideoFormatId);
    const selectedMergeAudio = mergeAudioFormats.find((format) => format.format_id === state.form.mergeAudioFormatId);
    const queueLabel = {
      video: 'Queue video-only download',
      audio: 'Queue audio-only download',
      merge: 'Queue merged download',
    }[state.form.downloadMode];
    const subtitleCount = Object.keys(info.subtitles || {}).length;
    const autoSubtitleCount = Object.keys(info.automatic_captions || {}).length;
    const exactOptions = formats.map((format) => `<option value="${h(format.format_id)}" ${format.format_id === state.form.exactFormatId ? 'selected' : ''}>${h(formatLabel(format))}</option>`).join('');
    const mergeVideoOptions = mergeVideoFormats.map((format) => `<option value="${h(format.format_id)}" ${format.format_id === state.form.mergeVideoFormatId ? 'selected' : ''}>${h(formatLabel(format))}</option>`).join('');
    const mergeAudioOptions = mergeAudioFormats.map((format) => `<option value="${h(format.format_id)}" ${format.format_id === state.form.mergeAudioFormatId ? 'selected' : ''}>${h(formatLabel(format))}</option>`).join('');
    replaceMarkup(content, `
      <article class="vm-video vm-card">
        <div class="vm-video-visual">
          ${info.thumbnail ? `<img src="${h(info.thumbnail)}" alt="" referrerpolicy="no-referrer">` : ''}
          <span class="vm-duration">${h(info.duration_string || formatDuration(info.duration))}</span>
        </div>
        <div class="vm-video-copy">
          <h3 title="${h(info.title)}">${h(info.title || 'YouTube video')}</h3>
          <p>${h(info.channel || 'YouTube')} · ${(info.formats || []).length} downloadable formats</p>
        </div>
      </article>

      <section class="vm-section">
        <div class="vm-section-head"><span class="vm-section-title">Download mode</span><span class="vm-section-note">one media output</span></div>
        <div class="vm-mode-grid">
          <button type="button" data-download-mode="video" class="vm-mode-card ${isVideoOnlyMode ? 'active' : ''}">${ICONS.play}<span><strong>Video only</strong><small>No audio track</small></span></button>
          <button type="button" data-download-mode="audio" class="vm-mode-card ${isAudioMode ? 'active' : ''}">${ICONS.audio}<span><strong>Audio only</strong><small>Extract or convert</small></span></button>
          <button type="button" data-download-mode="merge" class="vm-mode-card ${state.form.downloadMode === 'merge' ? 'active' : ''}">${ICONS.merge}<span><strong>Merge</strong><small>Final video + audio</small></span></button>
        </div>
      </section>

      <section class="vm-section">
        <div class="vm-section-head"><span class="vm-section-title">${isMergeMode ? 'Merge sources' : 'Format & quality'}</span><span class="vm-section-note">${isMergeMode ? `${mergeVideoFormats.length} video · ${mergeAudioFormats.length} audio` : `${formats.length} choices`}</span></div>
        <div class="vm-grid">
          ${isMergeMode ? `
            <label class="vm-field full">
              <span class="vm-label">Video stream <span>video only</span></span>
              <select class="vm-select" data-field="mergeVideoFormatId" ${mergeVideoFormats.length ? '' : 'disabled'}>${mergeVideoOptions || '<option value="">No video-only stream available</option>'}</select>
              ${formatMeta(selectedMergeVideo)}
            </label>
            <label class="vm-field full">
              <span class="vm-label">Audio stream <span>audio only · language shown</span></span>
              <select class="vm-select" data-field="mergeAudioFormatId" ${mergeAudioFormats.length ? '' : 'disabled'}>${mergeAudioOptions || '<option value="">No audio-only stream available</option>'}</select>
              ${formatMeta(selectedMergeAudio)}
            </label>` : `
            ${isAudioMode ? `
              <label class="vm-field full">
                <span class="vm-label">Audio stream <span>${formats.length} tracks · language shown</span></span>
                <select class="vm-select" data-field="exactFormatId" ${formats.length ? '' : 'disabled'}>${exactOptions || '<option value="">No audio stream available</option>'}</select>
                ${formatMeta(selectedFormat)}
              </label>` : `
              <label class="vm-field">
                <span class="vm-label">Selection</span>
                <select class="vm-select" data-field="selectionType">
                  <option value="preset" ${state.form.selectionType === 'preset' ? 'selected' : ''}>Smart quality</option>
                  <option value="exact" ${state.form.selectionType === 'exact' ? 'selected' : ''}>Exact yt-dlp format</option>
                </select>
              </label>
              ${state.form.selectionType === 'preset' ? `
              <label class="vm-field">
                <span class="vm-label">Maximum resolution</span>
                <select class="vm-select" data-field="preset">
                  ${[['best','Best available'],['4320','Up to 8K'],['2160','Up to 4K'],['1440','Up to 1440p'],['1080','Up to 1080p'],['720','Up to 720p'],['480','Up to 480p'],['360','Up to 360p'],['240','Up to 240p'],['144','Up to 144p']].map(([value,label]) => `<option value="${value}" ${String(state.form.preset) === value ? 'selected' : ''}>${label}</option>`).join('')}
                </select>
              </label>` : `
              <label class="vm-field full">
                <span class="vm-label">Exact stream <span>${formats.length} available</span></span>
                <select class="vm-select" data-field="exactFormatId">${exactOptions}</select>
                ${formatMeta(selectedFormat)}
              </label>`}`}`}

          ${!isAudioMode ? `
            <label class="vm-field full">
              <span class="vm-label">Output container <span>${isVideoOnlyMode ? 'video stream only; no audio added' : 'merge inputs removed after success'}</span></span>
              <select class="vm-select" data-field="container">
                <option value="mp4" ${state.form.container === 'mp4' ? 'selected' : ''}>MP4 — broad compatibility</option>
                <option value="mkv" ${state.form.container === 'mkv' ? 'selected' : ''}>MKV — accepts almost any codec</option>
                <option value="webm" ${state.form.container === 'webm' ? 'selected' : ''}>WebM</option>
                <option value="auto" ${state.form.container === 'auto' ? 'selected' : ''}>Automatic</option>
              </select>
            </label>` : `
            <label class="vm-field">
              <span class="vm-label">Output codec</span>
              <select class="vm-select" data-field="audioCodec">
                ${['mp3','m4a','opus','flac','wav'].map((value) => `<option value="${value}" ${state.form.audioCodec === value ? 'selected' : ''}>${value.toUpperCase()}</option>`).join('')}
              </select>
            </label>
            <label class="vm-field">
              <span class="vm-label">Audio quality</span>
              <select class="vm-select" data-field="audioQuality" ${['flac','wav'].includes(state.form.audioCodec) ? 'disabled' : ''}>
                ${[['0','Best / V0'],['320K','320 kbps'],['256K','256 kbps'],['192K','192 kbps'],['160K','160 kbps'],['128K','128 kbps'],['96K','96 kbps']].map(([value,label]) => `<option value="${value}" ${state.form.audioQuality === value ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </label>`}
        </div>
      </section>

      <section class="vm-section">
        <div class="vm-section-head"><span class="vm-section-title">Reliability</span><span class="vm-section-note">partial files resume</span></div>
        <label class="vm-field">
          <span class="vm-label">Automatic job retries <span>after yt-dlp exits</span></span>
          <select class="vm-select" data-field="retryCount">
            ${[['0','No whole-job retry'],['1','1 retry'],['2','2 retries — recommended'],['3','3 retries'],['5','5 retries']].map(([value,label]) => `<option value="${value}" ${state.form.retryCount === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
      </section>

      <section class="vm-section">
        <div class="vm-section-head"><span class="vm-section-title">Subtitles</span><span class="vm-section-note">${subtitleCount} manual · ${autoSubtitleCount} automatic</span></div>
        <div class="vm-grid">
          <label class="vm-field">
            <span class="vm-label">Captions</span>
            <select class="vm-select" data-field="subtitleMode">
              <option value="none" ${state.form.subtitleMode === 'none' ? 'selected' : ''}>None</option>
              <option value="manual" ${state.form.subtitleMode === 'manual' ? 'selected' : ''}>Manual only</option>
              <option value="automatic" ${state.form.subtitleMode === 'automatic' ? 'selected' : ''}>Automatic only</option>
              <option value="both" ${state.form.subtitleMode === 'both' ? 'selected' : ''}>Manual + automatic</option>
            </select>
          </label>
          <label class="vm-field">
            <span class="vm-label">Subtitle format</span>
            <select class="vm-select" data-field="subtitleFormat" ${state.form.subtitleMode === 'none' ? 'disabled' : ''}>
              <option value="srt" ${state.form.subtitleFormat === 'srt' ? 'selected' : ''}>SRT</option>
              <option value="vtt" ${state.form.subtitleFormat === 'vtt' ? 'selected' : ''}>WebVTT</option>
              <option value="best" ${state.form.subtitleFormat === 'best' ? 'selected' : ''}>Best available</option>
            </select>
          </label>
          <label class="vm-field full">
            <span class="vm-label">Language pattern <span>yt-dlp syntax</span></span>
            <input class="vm-input" data-field="subtitleLanguages" value="${h(state.form.subtitleLanguages)}" ${state.form.subtitleMode === 'none' ? 'disabled' : ''} placeholder="en.*,en">
          </label>
        </div>
      </section>

      <section class="vm-section">
        <div class="vm-section-head"><span class="vm-section-title">Files & metadata</span></div>
        <div class="vm-toggle-list">
          ${toggleRow('embedSubtitles', 'Embed subtitles', 'Keep captions inside the video when supported', state.form.embedSubtitles, isAudioMode || state.form.subtitleMode === 'none')}
          ${toggleRow('writeThumbnail', 'Save thumbnail', 'Download the highest-quality thumbnail', state.form.writeThumbnail)}
          ${toggleRow('embedThumbnail', 'Embed thumbnail', 'Use the thumbnail as cover art', state.form.embedThumbnail)}
          ${toggleRow('writeInfoJson', 'Metadata JSON', 'Save yt-dlp .info.json beside the media', state.form.writeInfoJson)}
          ${toggleRow('writeDescription', 'Description file', 'Save the video description as text', state.form.writeDescription)}
          ${toggleRow('embedMetadata', 'Embed media metadata', 'Title, channel, chapters, and other tags', state.form.embedMetadata)}
        </div>
        ${state.form.writeThumbnail || state.form.embedThumbnail ? `
          <label class="vm-field" style="margin-top:10px">
            <span class="vm-label">Thumbnail format</span>
            <select class="vm-select" data-field="thumbnailFormat">
              <option value="jpg" ${state.form.thumbnailFormat === 'jpg' ? 'selected' : ''}>JPEG</option>
              <option value="png" ${state.form.thumbnailFormat === 'png' ? 'selected' : ''}>PNG</option>
              <option value="webp" ${state.form.thumbnailFormat === 'webp' ? 'selected' : ''}>WebP</option>
              <option value="original" ${state.form.thumbnailFormat === 'original' ? 'selected' : ''}>Original format</option>
            </select>
          </label>` : ''}
      </section>

      <button class="vm-primary" type="button" data-action="enqueue">${ICONS.download}<span>${h(queueLabel)}</span></button>
      <div class="vm-helper">${ICONS.folder}<span>Files are written by the local bridge to <strong>${h(state.health?.download_dir || 'your configured download folder')}</strong>. Existing media is not overwritten.</span></div>
      <div class="vm-footer">yt-dlp for Violentmonkey · v${VERSION}</div>`);
    bindDownloadHandlers();
  }

  function toggleRow(field, title, detail, checked, disabled = false) {
    return `<label class="vm-toggle-row ${disabled ? 'disabled' : ''}">
      <span class="vm-toggle-copy"><strong>${h(title)}</strong><small>${h(detail)}</small></span>
      <span class="vm-switch"><input type="checkbox" data-field="${field}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span></span></span>
    </label>`;
  }

  function bindDownloadHandlers() {
    content.querySelectorAll('[data-download-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        state.form.downloadMode = button.dataset.downloadMode;
        ensureExactFormat();
        renderDownload();
        animateContentChange('vm-view-refresh');
      });
    });
    content.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('change', () => {
        const field = input.dataset.field;
        state.form[field] = input.type === 'checkbox' ? input.checked : input.value;
        if (field === 'selectionType' || field === 'exactFormatId' || field === 'audioCodec' || field === 'subtitleMode' || field === 'writeThumbnail' || field === 'embedThumbnail' || field === 'mergeVideoFormatId' || field === 'mergeAudioFormatId') {
          ensureExactFormat();
          renderDownload();
          animateContentChange('vm-view-refresh');
        }
      });
    });
    content.querySelector('[data-action="enqueue"]')?.addEventListener('click', enqueueCurrent);
  }

  async function enqueueCurrent() {
    const button = content.querySelector('[data-action="enqueue"]');
    const isMergeMode = state.form.downloadMode === 'merge';
    const format = isMergeMode ? null : sortedFormats().find((item) => item.format_id === state.form.exactFormatId);
    const mergeVideoFormat = isMergeMode
      ? sortedFormats('video').find((item) => item.format_id === state.form.mergeVideoFormatId)
      : null;
    const mergeAudioFormat = isMergeMode
      ? sortedFormats('audio').find((item) => item.format_id === state.form.mergeAudioFormatId)
      : null;
    if (isMergeMode && (!mergeVideoFormat || !mergeAudioFormat)) {
      toast('Choose both a video-only stream and an audio-only stream.', true);
      return;
    }
    if (!isMergeMode && (state.form.downloadMode === 'audio' || state.form.selectionType === 'exact') && !format) {
      toast(state.form.downloadMode === 'audio' ? 'Select a valid audio stream.' : 'Select a valid exact format.', true);
      return;
    }
    if (state.form.downloadMode === 'video' && state.form.selectionType === 'exact' && format?.has_audio) {
      toast('Video-only mode requires a stream without an audio track.', true);
      return;
    }
    const retryCount = Number(state.form.retryCount);
    if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount > 5) {
      toast('Choose between 0 and 5 automatic job retries.', true);
      return;
    }
    if (button) {
      button.disabled = true;
      button.querySelector('span').textContent = 'Adding to queue…';
    }
    const payload = {
      url: state.infoUrl || currentVideoUrl(),
      title_hint: state.info?.title || 'YouTube video',
      thumbnail_hint: state.info?.thumbnail || '',
      media_type: activeMediaType(),
      download_mode: state.form.downloadMode,
      selection: isMergeMode
        ? { type: 'streams', video_format_id: mergeVideoFormat.format_id, audio_format_id: mergeAudioFormat.format_id }
        : state.form.downloadMode === 'audio'
          ? { type: 'exact', format_id: format.format_id, has_video: format.has_video, has_audio: format.has_audio }
          : state.form.selectionType === 'preset'
            ? { type: 'preset', preset: state.form.preset }
            : { type: 'exact', format_id: format.format_id, has_video: format.has_video, has_audio: format.has_audio },
      container: state.form.container,
      audio_codec: state.form.audioCodec,
      audio_quality: state.form.audioQuality,
      retry_count: retryCount,
      cookies: cookiePayload(),
      proxy_url: proxyPayload(),
      allow_invalid_certificates: state.settings.allowInvalidCertificates === true,
      extras: {
        subtitle_mode: state.form.subtitleMode,
        subtitle_languages: state.form.subtitleLanguages,
        subtitle_format: state.form.subtitleFormat,
        embed_subtitles: state.form.embedSubtitles,
        write_thumbnail: state.form.writeThumbnail,
        embed_thumbnail: state.form.embedThumbnail,
        thumbnail_format: state.form.thumbnailFormat,
        write_info_json: state.form.writeInfoJson,
        write_description: state.form.writeDescription,
        embed_metadata: state.form.embedMetadata,
      },
    };
    try {
      await requireDownloadCapabilities();
      const response = await apiRequest('POST', '/api/v1/jobs', payload);
      state.jobs.unshift(response.job);
      state.connection = 'ready';
      updateChrome();
      toast(`Queued “${response.job.title}”.`);
      state.tab = 'queue';
      updateChrome();
      renderQueue();
      pollJobs(false);
    } catch (error) {
      toast(error.details?.reason || error.message, true);
      if (button) {
        button.disabled = false;
        button.querySelector('span').textContent = {
          video: 'Queue video-only download',
          audio: 'Queue audio-only download',
          merge: 'Queue merged download',
        }[state.form.downloadMode];
      }
    }
  }

  function jobViewModel(job) {
    const progress = job.progress || {};
    const percent = job.status === 'completed' ? 100 : Math.max(0, Math.min(100, Number(progress.percent) || 0));
    const logs = (job.logs || []).slice(-20).join('\n');
    const attempt = Number(job.attempt) || 0;
    const maxAttempts = Number(job.max_attempts) || 1;
    return {
      percent,
      percentText: percent ? `${percent.toFixed(percent >= 10 ? 0 : 1)}%` : '0%',
      size: progress.downloaded_bytes ? `${formatBytes(progress.downloaded_bytes)}${progress.total_bytes ? ` / ${formatBytes(progress.total_bytes)}` : ''}` : '',
      speed: progress.speed ? `Avg ${formatBytes(progress.speed)}/s` : '',
      eta: progress.eta != null ? `ETA ${formatDuration(progress.eta)}` : '',
      detailText: job.error || logs,
      detailLabel: job.error ? 'Error details' : 'yt-dlp log',
      canPause: ACTIVE_STATUSES.has(job.status),
      canResume: job.resumable === true || RESUMABLE_STATUSES.has(job.status),
      attemptText: maxAttempts > 1 && attempt > 0 ? `Attempt ${attempt}/${maxAttempts}` : '',
      modeText: {
        video: 'Video only',
        audio: 'Audio only',
        merge: 'Merged A/V',
      }[job.download_mode] || (job.media_type === 'audio' ? 'Audio only' : 'Merged A/V'),
    };
  }

  function jobStructureKey(job, view = jobViewModel(job)) {
    return [
      Boolean(job.thumbnail),
      Boolean(job.output_path),
      Boolean(view.detailText),
      Boolean(job.error),
      view.canPause,
      view.canResume,
    ].map(Number).join(':');
  }

  function queueViewModel() {
    const active = state.jobs.filter((job) => ACTIVE_STATUSES.has(job.status)).length;
    const completed = state.jobs.filter((job) => job.status === 'completed').length;
    const resumable = state.jobs.filter((job) => job.resumable === true || RESUMABLE_STATUSES.has(job.status)).length;
    return {
      title: active ? `${active} active download${active === 1 ? '' : 's'}` : resumable ? `${resumable} ready to resume` : 'Queue is idle',
      meta: `${completed} completed · ${resumable} resumable · ${state.jobs.length} total`,
    };
  }

  function captureLogPosition(details) {
    const pre = details?.querySelector('pre');
    if (!pre) return null;
    return {
      top: pre.scrollTop,
      stickToBottom: pre.scrollHeight - pre.clientHeight - pre.scrollTop < 10,
    };
  }

  function captureQueueViewState() {
    if (!content?.querySelector('.vm-queue-view')) return null;
    const logPositions = new Map();
    content.querySelectorAll('[data-job-details]').forEach((details) => {
      const position = captureLogPosition(details);
      if (position) logPositions.set(details.dataset.jobDetails, position);
    });
    return { contentScrollTop: content.scrollTop, logPositions };
  }

  function bindJobDetails(details, savedPosition = null) {
    if (!details || details.dataset.bound === 'true') return;
    details.dataset.bound = 'true';
    const jobId = details.dataset.jobDetails;
    const pre = details.querySelector('pre');
    details.querySelector('summary')?.addEventListener('click', () => {
      if (details.open) return;
      details.classList.remove('just-opened');
      void details.offsetWidth;
      details.classList.add('just-opened');
      setTimeout(() => details.classList.remove('just-opened'), 220);
    });
    details.addEventListener('toggle', () => {
      if (details.open) {
        state.expandedJobDetails.add(jobId);
        if (pre && !savedPosition) requestAnimationFrame(() => { pre.scrollTop = pre.scrollHeight; });
      } else {
        state.expandedJobDetails.delete(jobId);
      }
    });
    if (pre && details.open) {
      requestAnimationFrame(() => {
        pre.scrollTop = savedPosition?.stickToBottom ? pre.scrollHeight : savedPosition?.top ?? pre.scrollHeight;
      });
    }
  }

  function bindQueueHandlers(previousView) {
    content.querySelectorAll('[data-job-details]').forEach((details) => {
      bindJobDetails(details, previousView?.logPositions.get(details.dataset.jobDetails));
    });
    if (previousView) {
      content.scrollTop = previousView.contentScrollTop;
      requestAnimationFrame(() => { content.scrollTop = previousView.contentScrollTop; });
    }
  }

  function handleQueueActionClick(event) {
    const button = event.target.closest?.('button');
    if (!button) return;
    if (button.dataset.cancelJob) void cancelJob(button.dataset.cancelJob);
    else if (button.dataset.resumeJob) void resumeJob(button.dataset.resumeJob);
    else if (button.dataset.forgetJob) void forgetJob(button.dataset.forgetJob);
    else if (button.dataset.action === 'clear-jobs') void clearJobs();
  }

  function renderJobStats(view) {
    return `<span data-job-stat="percent">${h(view.percentText)}</span>
      <span data-job-stat="mode">${h(view.modeText)}</span>
      <span data-job-stat="attempt" ${view.attemptText ? '' : 'hidden'}>${h(view.attemptText)}</span>
      <span data-job-stat="size" ${view.size ? '' : 'hidden'}>${h(view.size)}</span>
      <span data-job-stat="speed" ${view.speed ? '' : 'hidden'}>${h(view.speed)}</span>
      <span class="spacer"></span>
      <span data-job-stat="eta" ${view.eta ? '' : 'hidden'}>${h(view.eta)}</span>`;
  }

  function setJobStat(card, name, value) {
    const element = card.querySelector(`[data-job-stat="${name}"]`);
    if (!element) return;
    element.hidden = !value;
    if (value && element.textContent !== value) element.textContent = value;
  }

  function updateLogText(pre, nextText) {
    const textNode = pre.firstChild;
    if (textNode?.nodeType === 3 && pre.childNodes.length === 1) textNode.data = nextText;
    else pre.textContent = nextText;
  }

  function updateJobCard(card, job) {
    const view = jobViewModel(job);
    card.className = `vm-job vm-card ${job.status}`;
    card.dataset.jobStructure = jobStructureKey(job, view);
    const title = card.querySelector('.vm-job-title');
    if (title && title.textContent !== job.title) {
      title.textContent = job.title;
      title.title = job.title;
    }
    const thumbnail = card.querySelector('.vm-job-thumb img');
    if (thumbnail && thumbnail.getAttribute('src') !== job.thumbnail) thumbnail.setAttribute('src', job.thumbnail);
    const phaseIconElement = card.querySelector('.vm-job-phase-icon');
    if (phaseIconElement && phaseIconElement.dataset.status !== job.status) {
      replaceMarkup(phaseIconElement, phaseIcon(job.status));
      phaseIconElement.dataset.status = job.status;
    }
    const phaseText = card.querySelector('.vm-job-phase-text');
    const nextPhase = job.phase || job.status;
    if (phaseText && phaseText.textContent !== nextPhase) phaseText.textContent = nextPhase;
    const progressBar = card.querySelector('.vm-progress-bar');
    if (progressBar) progressBar.style.width = `${view.percent.toFixed(2)}%`;
    setJobStat(card, 'percent', view.percentText);
    setJobStat(card, 'mode', view.modeText);
    setJobStat(card, 'attempt', view.attemptText);
    setJobStat(card, 'size', view.size);
    setJobStat(card, 'speed', view.speed);
    setJobStat(card, 'eta', view.eta);
    const outputPath = card.querySelector('.vm-path');
    if (outputPath && outputPath.textContent !== job.output_path) outputPath.textContent = job.output_path;
    const details = card.querySelector('[data-job-details]');
    const pre = details?.querySelector('pre');
    if (details && pre && pre.textContent !== view.detailText) {
      const position = captureLogPosition(details);
      updateLogText(pre, view.detailText);
      if (position?.stickToBottom) requestAnimationFrame(() => { pre.scrollTop = pre.scrollHeight; });
      else if (position) pre.scrollTop = position.top;
    }
  }

  function updateQueueView() {
    const queueView = content?.querySelector('.vm-queue-view');
    if (!queueView || !state.jobs.length) return false;
    const cards = Array.from(queueView.querySelectorAll('[data-job-id]'));
    if (cards.length !== state.jobs.length) return false;
    if (cards.some((card, index) => card.dataset.jobId !== state.jobs[index].id)) return false;
    const plans = cards.map((card, index) => {
      const job = state.jobs[index];
      const view = jobViewModel(job);
      if (card.dataset.jobStructure === jobStructureKey(job, view)) return { card, job, replace: false, replacement: null, savedPosition: null };
      const details = card.querySelector('[data-job-details]');
      if (details?.open) state.expandedJobDetails.add(job.id);
      return {
        card,
        job,
        replace: true,
        replacement: elementFromMarkup(renderJob(job)),
        savedPosition: captureLogPosition(details),
      };
    });
    if (plans.some((plan) => plan.replace && !plan.replacement)) return false;
    const contentScrollTop = content.scrollTop;
    for (const plan of plans) {
      if (plan.replace) {
        plan.card.replaceWith(plan.replacement);
        bindJobDetails(plan.replacement.querySelector('[data-job-details]'), plan.savedPosition);
      } else {
        updateJobCard(plan.card, plan.job);
      }
    }
    const queue = queueViewModel();
    const title = queueView.querySelector('[data-queue-title]');
    const meta = queueView.querySelector('[data-queue-meta]');
    if (title && title.textContent !== queue.title) title.textContent = queue.title;
    if (meta && meta.textContent !== queue.meta) meta.textContent = queue.meta;
    content.scrollTop = contentScrollTop;
    return true;
  }

  function renderQueue() {
    const previousView = captureQueueViewState();
    const currentJobIds = new Set(state.jobs.map((job) => job.id));
    for (const jobId of state.expandedJobDetails) {
      if (!currentJobIds.has(jobId)) state.expandedJobDetails.delete(jobId);
    }
    if (!state.jobs.length) {
      replaceMarkup(content, emptyState(ICONS.queue, 'Your queue is empty', 'Add a download here. If the companion restarts mid-download, its recovery record will appear here with a Resume button.', 'Choose a download', 'open-download'));
      bindEmptyActions();
      return;
    }
    const queue = queueViewModel();
    replaceMarkup(content, `
      <div class="vm-queue-view">
        <div class="vm-queue-head">
          <div class="vm-queue-summary"><strong data-queue-title>${h(queue.title)}</strong><span data-queue-meta>${h(queue.meta)}</span></div>
          <button class="vm-secondary danger" type="button" data-action="clear-jobs">${ICONS.trash} Clear completed</button>
        </div>
        <div>${state.jobs.map(renderJob).join('')}</div>
        <div class="vm-footer">Paused and recovered downloads stay resumable until you choose Resume. The queue runs sequentially to reduce YouTube rate-limit pressure.</div>
      </div>`);
    bindQueueHandlers(previousView);
  }

  function renderJob(job) {
    const view = jobViewModel(job);
    return `<article class="vm-job vm-card ${h(job.status)}" data-job-id="${h(job.id)}" data-job-structure="${jobStructureKey(job, view)}">
      <div class="vm-job-top">
        <div class="vm-job-thumb">${job.thumbnail ? `<img src="${h(job.thumbnail)}" alt="" referrerpolicy="no-referrer">` : ''}</div>
        <div class="vm-job-main">
          <div class="vm-job-title" title="${h(job.title)}">${h(job.title)}</div>
          <div class="vm-job-phase"><span class="vm-job-phase-icon" data-status="${h(job.status)}">${phaseIcon(job.status)}</span><span class="vm-job-phase-text">${h(job.phase || job.status)}</span></div>
        </div>
        <div class="vm-job-actions">
          ${view.canResume ? `<button class="vm-job-action resume" type="button" data-resume-job="${h(job.id)}" aria-label="Resume download">${ICONS.refresh}<span>Resume</span></button>` : ''}
          ${view.canResume ? `<button class="vm-job-action" type="button" data-forget-job="${h(job.id)}" aria-label="Forget recovery record" title="Forget recovery record; partial files stay on disk">${ICONS.trash}</button>` : ''}
          ${view.canPause ? `<button class="vm-job-action pause" type="button" data-cancel-job="${h(job.id)}" aria-label="Pause download" title="Pause download">${ICONS.pause}</button>` : ''}
        </div>
      </div>
      <div class="vm-progress-track"><div class="vm-progress-bar" style="width:${view.percent.toFixed(2)}%"></div></div>
      <div class="vm-job-stats">${renderJobStats(view)}</div>
      ${job.output_path ? `<div class="vm-path">${h(job.output_path)}</div>` : ''}
      ${view.detailText ? `<details class="vm-details" data-job-details="${h(job.id)}" ${state.expandedJobDetails.has(job.id) ? 'open' : ''}><summary>${h(view.detailLabel)}</summary><pre>${h(view.detailText)}</pre></details>` : ''}
    </article>`;
  }

  async function pollJobs(forceRender = false) {
    if (state.polling || !state.settings.token) return;
    state.polling = true;
    try {
      const previous = new Map(state.jobs.map((job) => [job.id, job.status]));
      const response = await apiRequest('GET', '/api/v1/jobs', undefined, 12000);
      state.jobs = response.jobs || [];
      state.revision = response.revision ?? state.revision;
      state.connection = 'ready';
      for (const job of state.jobs) {
        const oldStatus = previous.get(job.id);
        if (oldStatus && !TERMINAL_STATUSES.has(oldStatus) && TERMINAL_STATUSES.has(job.status) && !state.notified.has(`${job.id}:${job.status}`)) {
          state.notified.add(`${job.id}:${job.status}`);
          const failed = job.status === 'failed';
          toast(failed ? `Download failed: ${job.title}` : job.status === 'completed' ? `Download complete: ${job.title}` : `Download paused: ${job.title}`, failed);
          if (state.settings.notifications && job.status !== 'cancelled') notifyJob(job);
        }
      }
      updateChrome();
      if ((forceRender || state.tab === 'queue') && state.open && !updateQueueView()) renderQueue();
    } catch (error) {
      if (error.code === 'connection_failed' || error.status === 401) {
        state.connection = 'offline';
        updateChrome();
      }
      if (forceRender) toast(error.message, true);
    } finally {
      state.polling = false;
    }
  }

  function notifyJob(job) {
    try {
      GM_notification({
        title: job.status === 'completed' ? 'yt-dlp download complete' : 'yt-dlp download failed',
        text: job.title,
        image: job.thumbnail || undefined,
        silent: false,
      });
    } catch (_) {
      // Desktop notifications are optional.
    }
  }

  async function cancelJob(jobId) {
    try {
      await apiRequest('POST', `/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {});
      toast('Pausing download…');
      await pollJobs(true);
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function resumeJob(jobId) {
    try {
      await requireDownloadCapabilities();
      const response = await apiRequest('POST', `/api/v1/jobs/${encodeURIComponent(jobId)}/resume`, {
        cookies: cookiePayload(),
        proxy_url: proxyPayload(),
        allow_invalid_certificates: state.settings.allowInvalidCertificates === true,
      });
      toast(`Resuming “${response.job.title}”.`);
      await pollJobs(true);
    } catch (error) {
      toast(error.details?.reason || error.message, true);
    }
  }

  async function forgetJob(jobId) {
    if (!window.confirm('Forget this recovery record? Partial files will stay on disk, but the extension will no longer be able to resume them automatically.')) return;
    try {
      await apiRequest('POST', `/api/v1/jobs/${encodeURIComponent(jobId)}/forget`, {});
      toast('Recovery record removed. Partial files were left on disk.');
      await pollJobs(true);
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function clearJobs() {
    try {
      const response = await apiRequest('POST', '/api/v1/jobs/clear', {});
      toast(`Cleared ${response.cleared} completed job${response.cleared === 1 ? '' : 's'}.`);
      await pollJobs(true);
    } catch (error) {
      toast(error.message, true);
    }
  }

  function renderSettings() {
    const s = state.settings;
    replaceMarkup(content, `
      <section class="vm-settings-group vm-card">
        <h3 class="vm-settings-title">${ICONS.shield} Local pairing</h3>
        <p class="vm-settings-copy">The bearer token prevents arbitrary pages from controlling the downloader. Leave the token field blank to keep the current one.</p>
        <label class="vm-field vm-setting-row">
          <span class="vm-label">Service address</span>
          <input class="vm-input" data-setting="apiBase" value="${h(s.apiBase)}" spellcheck="false">
        </label>
        <label class="vm-field vm-setting-row">
          <span class="vm-label">Replace pairing token <span>${s.token ? 'paired' : 'not paired'}</span></span>
          <input class="vm-input" data-setting="token" value="" type="password" autocomplete="new-password" placeholder="Paste a new token only when needed">
        </label>
        ${state.health?.download_dir ? `<div class="vm-path">Downloads: ${h(state.health.download_dir)}</div>` : ''}
      </section>

      <section class="vm-settings-group vm-card">
        <h3 class="vm-settings-title">${ICONS.refresh} Network & proxy</h3>
        <p class="vm-settings-copy">Apply one HTTP, HTTPS, or SOCKS proxy to both format discovery and downloads. The URL is visible by default; use the eye button whenever you want to hide it.</p>
        <label class="vm-inline-toggle vm-setting-row">
          <span class="vm-toggle-copy"><strong>Use proxy</strong><small>Passed directly to yt-dlp as its validated --proxy option</small></span>
          <span class="vm-switch"><input type="checkbox" data-setting="proxyEnabled" ${s.proxyEnabled ? 'checked' : ''}><span></span></span>
        </label>
        <div class="vm-field vm-setting-row">
          <span class="vm-label">Proxy URL <span data-proxy-state>${s.proxyEnabled ? 'enabled' : 'disabled'}</span></span>
          <div class="vm-input-shell">
            <input class="vm-input" data-setting="proxyUrl" value="${h(s.proxyUrl)}" type="${state.proxyHidden ? 'password' : 'text'}" autocomplete="off" spellcheck="false" placeholder="socks5://127.0.0.1:1080">
            <button class="vm-input-action" type="button" data-action="toggle-proxy-visibility" aria-label="${state.proxyHidden ? 'Show proxy URL' : 'Hide proxy URL'}" title="${state.proxyHidden ? 'Show proxy URL' : 'Hide proxy URL'}">${state.proxyHidden ? ICONS.eye : ICONS.eyeOff}</button>
          </div>
        </div>
        <label class="vm-inline-toggle vm-setting-row">
          <span class="vm-toggle-copy"><strong>Allow invalid TLS certificates</strong><small>Accept self-signed, expired, or hostname-mismatched certificates</small></span>
          <span class="vm-switch"><input type="checkbox" data-setting="allowInvalidCertificates" ${s.allowInvalidCertificates ? 'checked' : ''}><span></span></span>
        </label>
        <div class="vm-helper warning">${ICONS.alert}<span>This disables certificate validation for every HTTPS request made by yt-dlp, not only the proxy. Use it only with a network or proxy you trust.</span></div>
      </section>

      <section class="vm-settings-group vm-card">
        <h3 class="vm-settings-title">${ICONS.folder} Browser authentication</h3>
        <p class="vm-settings-copy">When enabled, yt-dlp reads cookies directly from the selected local profile. Cookies never pass through YouTube or this userscript.</p>
        <label class="vm-inline-toggle vm-setting-row">
          <span class="vm-toggle-copy"><strong>Use browser cookies</strong><small>Useful for age-restricted, private, and members-only videos you can access</small></span>
          <span class="vm-switch"><input type="checkbox" data-setting="cookieEnabled" ${s.cookieEnabled ? 'checked' : ''}><span></span></span>
        </label>
        <div class="vm-grid" style="margin-top:12px">
          <label class="vm-field">
            <span class="vm-label">Browser</span>
            <select class="vm-select" data-setting="cookieBrowser">
              ${['firefox','chrome','chromium','brave','edge','vivaldi','opera','safari'].map((browser) => `<option value="${browser}" ${s.cookieBrowser === browser ? 'selected' : ''}>${browser[0].toUpperCase() + browser.slice(1)}</option>`).join('')}
            </select>
          </label>
          <label class="vm-field">
            <span class="vm-label">Linux keyring</span>
            <select class="vm-select" data-setting="cookieKeyring">
              <option value="" ${!s.cookieKeyring ? 'selected' : ''}>Automatic</option>
              ${['gnomekeyring','kwallet6','kwallet5','kwallet','basictext'].map((keyring) => `<option value="${keyring}" ${s.cookieKeyring === keyring ? 'selected' : ''}>${keyring}</option>`).join('')}
            </select>
          </label>
          <label class="vm-field full">
            <span class="vm-label">Profile name or path <span>optional</span></span>
            <input class="vm-input" data-setting="cookieProfile" value="${h(s.cookieProfile)}" placeholder="Most recently used profile">
          </label>
          ${s.cookieBrowser === 'firefox' ? `<label class="vm-field full"><span class="vm-label">Firefox container <span>optional</span></span><input class="vm-input" data-setting="cookieContainer" value="${h(s.cookieContainer)}" placeholder="All containers"></label>` : ''}
        </div>
      </section>

      <section class="vm-settings-group vm-card">
        <h3 class="vm-settings-title">${ICONS.settings} Experience</h3>
        <label class="vm-inline-toggle">
          <span class="vm-toggle-copy"><strong>Desktop notifications</strong><small>Notify when a queued job completes or fails</small></span>
          <span class="vm-switch"><input type="checkbox" data-setting="notifications" ${s.notifications ? 'checked' : ''}><span></span></span>
        </label>
      </section>

      <div class="vm-setting-actions">
        <button class="vm-secondary" type="button" data-action="test-settings">${ICONS.refresh} Test connection</button>
        <button class="vm-primary" type="button" data-action="save-settings">${ICONS.check} Save settings</button>
      </div>
      <div class="vm-helper">${ICONS.shield}<span>The companion listens on loopback only, validates YouTube URLs, and accepts no raw command-line arguments. Keep the generated userscript private because it contains your pairing token.</span></div>
      <div class="vm-footer">yt-dlp for Violentmonkey · v${VERSION}</div>`);
    bindSettingsHandlers();
  }

  function collectSettings() {
    const next = { ...state.settings };
    content.querySelectorAll('[data-setting]').forEach((input) => {
      const key = input.dataset.setting;
      if (key === 'token' && !input.value.trim()) return;
      next[key] = input.type === 'checkbox' ? input.checked : input.value.trim();
    });
    if (!validApiBase(next.apiBase)) {
      throw new ApiError('Service address must use loopback HTTP and include a port.', 'invalid_api_base');
    }
    if (next.token && next.token.length < 32) {
      throw new ApiError('The pairing token is too short.', 'invalid_token');
    }
    if (next.proxyEnabled && !validProxyUrl(next.proxyUrl)) {
      throw new ApiError('Proxy URL must use HTTP, HTTPS, SOCKS4, SOCKS4A, or SOCKS5 and contain a host.', 'invalid_proxy');
    }
    return next;
  }

  function bindSettingsHandlers() {
    content.querySelector('[data-action="toggle-proxy-visibility"]')?.addEventListener('click', (event) => {
      const input = content.querySelector('[data-setting="proxyUrl"]');
      if (!input) return;
      state.proxyHidden = !state.proxyHidden;
      input.type = state.proxyHidden ? 'password' : 'text';
      const button = event.currentTarget;
      const label = state.proxyHidden ? 'Show proxy URL' : 'Hide proxy URL';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      replaceMarkup(button, state.proxyHidden ? ICONS.eye : ICONS.eyeOff);
    });
    content.querySelector('[data-setting="proxyEnabled"]')?.addEventListener('change', (event) => {
      const status = content.querySelector('[data-proxy-state]');
      if (status) status.textContent = event.target.checked ? 'enabled' : 'disabled';
    });
    content.querySelector('[data-setting="cookieBrowser"]')?.addEventListener('change', (event) => {
      try {
        state.settings = collectSettings();
        state.settings.cookieBrowser = event.target.value;
        renderSettings();
      } catch (error) {
        toast(error.message, true);
      }
    });
    content.querySelector('[data-action="save-settings"]')?.addEventListener('click', async () => {
      try {
        state.settings = collectSettings();
        saveSettings();
        state.info = null;
        state.infoUrl = '';
        toast('Settings saved.');
        await testConnection(false);
        renderSettings();
      } catch (error) {
        toast(error.message, true);
      }
    });
    content.querySelector('[data-action="test-settings"]')?.addEventListener('click', async () => {
      try {
        const previous = state.settings;
        state.settings = collectSettings();
        const okay = await testConnection(true);
        if (!okay) state.settings = previous;
        renderSettings();
      } catch (error) {
        toast(error.message, true);
      }
    });
  }

  function emptyState(icon, title, message, buttonLabel = '', action = '', isError = false) {
    return `<div class="vm-empty">
      <div class="vm-empty-icon" ${isError ? 'style="color:#ff647e;border-color:rgba(255,49,85,.18);background:rgba(255,49,85,.05)"' : ''}>${icon}</div>
      <h3>${h(title)}</h3>
      <p>${h(message)}</p>
      ${buttonLabel ? `<button class="vm-secondary" type="button" data-empty-action="${h(action)}">${action === 'retry-info' ? ICONS.refresh : ICONS.chevron}${h(buttonLabel)}</button>` : ''}
    </div>`;
  }

  function bindEmptyActions() {
    content.querySelector('[data-empty-action]')?.addEventListener('click', (event) => {
      const action = event.currentTarget.dataset.emptyAction;
      if (action === 'open-settings') {
        state.tab = 'settings';
        updateChrome();
        renderCurrentTab(true);
      } else if (action === 'open-download') {
        state.tab = 'download';
        updateChrome();
        renderCurrentTab(true);
      } else if (action === 'retry-info') {
        fetchInfo(true);
      }
    });
  }

  function toast(message, isError = false) {
    if (!toastRack) return;
    const item = document.createElement('div');
    item.className = `vm-toast${isError ? ' error' : ''}`;
    replaceMarkup(item, `${isError ? ICONS.alert : ICONS.check}<span></span>`);
    item.querySelector('span').textContent = String(message || (isError ? 'Something went wrong.' : 'Done.'));
    toastRack.appendChild(item);
    setTimeout(() => item.remove(), isError ? 6500 : 3800);
  }

  function watchNavigation() {
    const handle = () => {
      ensurePlayerButton();
      syncHomepageLauncherVisibility();
      if (location.href === state.lastUrl) return;
      state.lastUrl = location.href;
      const nextUrl = currentVideoUrl();
      if (nextUrl !== state.infoUrl) {
        state.info = null;
        state.infoUrl = '';
        state.infoError = null;
        if (state.open && state.tab === 'download') {
          renderDownload();
          fetchInfo(false);
        }
      }
    };
    window.addEventListener('yt-navigate-finish', handle, true);
    window.addEventListener('popstate', handle, true);
    setInterval(handle, 1200);
  }

  function startPollingLoop() {
    const tick = async () => {
      if (state.destroyed) return;
      await pollJobs(false);
      const active = state.jobs.some((job) => ACTIVE_STATUSES.has(job.status));
      const delay = active ? 900 : state.open ? 3000 : 9000;
      setTimeout(tick, delay);
    };
    setTimeout(tick, 700);
  }

  function diagnosticsText() {
    const reason = state.startupError || 'The UI has not finished initializing.';
    return [
      `yt-dlp for Violentmonkey v${VERSION}`,
      '',
      `Page: ${location.href}`,
      `Problem: ${reason}`,
      '',
      'Reinstall the newest paired userscript, reload this tab, and check the Violentmonkey console if the problem continues.',
    ].join('\n');
  }

  function showStartupDiagnostics() {
    window.alert(diagnosticsText());
  }

  function showDiagnosticFallback(error) {
    state.startupError = String(error?.message || error || 'Unknown startup error').slice(0, 600);
    if (document.getElementById('vm-ytdlp-diagnostic-host')) return;
    const host = document.createElement('div');
    host.id = 'vm-ytdlp-diagnostic-host';
    const root = host.attachShadow({ mode: 'closed' });
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'yt-dlp UI error';
    button.title = 'Click for startup diagnostics';
    Object.assign(button.style, {
      position: 'fixed',
      right: '18px',
      bottom: '18px',
      zIndex: '2147483647',
      padding: '12px 16px',
      border: '1px solid rgba(255,255,255,.25)',
      borderRadius: '12px',
      color: '#fff',
      background: '#d90030',
      boxShadow: '0 12px 34px rgba(0,0,0,.42)',
      cursor: 'pointer',
      font: '700 13px/1.2 system-ui, sans-serif',
    });
    button.addEventListener('click', showStartupDiagnostics);
    root.appendChild(button);
    document.documentElement.appendChild(host);
  }

  function registerMenuCommands() {
    try {
      GM_registerMenuCommand('Open yt-dlp panel', () => shell ? openPanel('download') : showStartupDiagnostics());
      GM_registerMenuCommand('Open yt-dlp queue', () => shell ? openPanel('queue') : showStartupDiagnostics());
      GM_registerMenuCommand('yt-dlp settings', () => shell ? openPanel('settings') : showStartupDiagnostics());
      GM_registerMenuCommand('Show yt-dlp diagnostics', showStartupDiagnostics);
    } catch (error) {
      console.warn('[yt-dlp for Violentmonkey] Could not register menu commands.', error);
    }
  }

  registerMenuCommands();
  try {
    createUi();
    watchNavigation();
    testConnection(false).then(() => {
      pollJobs(false);
      if (state.open && state.tab === 'download') fetchInfo(false);
    });
    startPollingLoop();
  } catch (error) {
    console.error('[yt-dlp for Violentmonkey]', error);
    showDiagnosticFallback(error);
  }
})();
