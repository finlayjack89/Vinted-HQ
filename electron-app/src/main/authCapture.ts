/**
 * Auth capture flow:
 * - open temporary Vinted login window
 * - optionally autofill credentials from keychain using STEALTH typing
 * - extract required cookies and persist secure cookie header
 * - close window immediately on success
 *
 * Stealth Architecture:
 *   Vinted uses React + Datadome. Direct .value injection fails because
 *   React's internal state doesn't register it without actual input events.
 *   Datadome flags superhuman typing speeds and sterile Electron windows.
 *
 *   This module simulates human-like typing by dispatching the full
 *   browser event lifecycle (Focus → KeyDown → KeyPress → Input → KeyUp → Change)
 *   with randomized jitter (50-150ms between keystrokes, 800-1500ms before submit).
 */

import { BrowserWindow, WebContents } from 'electron';
import * as secureStorage from './secureStorage';
import * as credentialStore from './credentialStore';
import * as sessionService from './sessionService';
import * as settings from './settings';

const VINTED_LOGIN_URL = 'https://www.vinted.co.uk/member/signup/select_type?ref_url=%2F';
const COOKIE_TIMEOUT_MS = 180_000;
const AUTH_PARTITION = 'persist:vinted-auth';
const REQUIRED_COOKIES = ['_vinted_fr_session', 'access_token_web', 'refresh_token_web'];

// ─── Passive Network Interception ─────────────────────────────────────────────

/**
 * Sets up passive network interception on the given session to capture
 * authentication tokens (CSRF, anon_id, User-Agent) from valid Vinted API requests.
 */
export function setupNetworkInterception(ses: Electron.Session): void {
  // Avoid installing duplicate listeners on the same session.
  const _any = ses as unknown as { __vintedInterceptionInstalled?: boolean };
  if (_any.__vintedInterceptionInstalled) return;
  _any.__vintedInterceptionInstalled = true;

  const filter = {
    urls: [
      '*://www.vinted.co.uk/api/v2/*',
      '*://www.vinted.fr/api/v2/*',
      '*://www.vinted.com/api/v2/*',
      '*://www.vinted.de/api/v2/*',
      '*://www.vinted.it/api/v2/*',
      '*://www.vinted.pl/api/v2/*',
      '*://www.vinted.es/api/v2/*',
      '*://www.vinted.nl/api/v2/*'
    ]
  };

  ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    try {
      const headers = details.requestHeaders;
      let csrfToken: string | null = null;
      let userAgent: string | null = null;
      let anonId: string | null = null;

      // Case-insensitive header lookup
      for (const key of Object.keys(headers)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey === 'x-csrf-token') {
          csrfToken = headers[key];
        } else if (lowerKey === 'x-anon-id') {
          anonId = headers[key];
        } else if (lowerKey === 'user-agent') {
          userAgent = headers[key];
        }
      }

      if (csrfToken) {
        const storedToken = settings.getSetting('csrf_token');
        if (csrfToken !== storedToken) {
          settings.setSetting('csrf_token', csrfToken);
          console.log('[AuthCapture] Captured new CSRF token', { token_prefix: csrfToken.slice(0, 10) });
        }
      }

      if (anonId) {
        const storedAnon = settings.getSetting('anon_id');
        if (anonId !== storedAnon) {
          settings.setSetting('anon_id', anonId);
          console.log('[AuthCapture] Captured new anon_id', { anon_id: anonId });
        }
      }

      if (userAgent) {
        const storedUA = settings.getSetting('user_agent');
        if (userAgent !== storedUA) {
          settings.setSetting('user_agent', userAgent);
          console.log('[AuthCapture] Captured new User-Agent', { ua: userAgent });
        }
      }
    } catch (err) {
      console.warn('[AuthCapture] Error intercepting headers', { error: String(err) });
    }

    // Continue request unmodified
    callback({ requestHeaders: details.requestHeaders });
  });
}

export type CookieRefreshResult = {
  ok: boolean;
  reason?: string;
};

let activeWindow: BrowserWindow | null = null;
let activeRun: Promise<CookieRefreshResult> | null = null;

function isVintedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'www.vinted.co.uk' || parsed.hostname.endsWith('.vinted.co.uk');
  } catch {
    return false;
  }
}

function normalizeCookieHeader(cookies: Electron.Cookie[]): string {
  return cookies
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function hasRequiredCookies(cookieNames: Set<string>): boolean {
  return REQUIRED_COOKIES.every((name) => cookieNames.has(name));
}

// ─── Stealth Typing Simulation ──────────────────────────────────────────────
// Generates the JavaScript to be injected into the BrowserWindow to simulate
// human-like typing. This is sent as a string to webContents.executeJavaScript.

/**
 * Build the stealth autofill JavaScript snippet.
 * This code runs inside the Vinted BrowserWindow's renderer process.
 *
 * Architecture:
 *   1. MutationObserver waits for email + password inputs to appear in DOM
 *   2. Character-by-character typing with full event lifecycle per keystroke
 *   3. Randomized jitter between 50-150ms per keystroke
 *   4. Randomized delay 800-1500ms before clicking submit
 *   5. Datadome challenge detection after submit attempt
 */
function buildStealthAutofillScript(
  email: string,
  password: string,
  autoSubmit: boolean,
): string {
  return `
    (async function stealthAutofill() {
      'use strict';

      // ── Utility: random int between min and max (inclusive) ──
      function randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }

      // ── Utility: sleep for ms ──
      function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
      }

      // ── Utility: wait for element with MutationObserver ──
      function waitForElement(selector, timeoutMs = 15000) {
        return new Promise((resolve) => {
          const existing = document.querySelector(selector);
          if (existing) { resolve(existing); return; }

          const observer = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) {
              observer.disconnect();
              resolve(el);
            }
          });
          observer.observe(document.body || document.documentElement, {
            childList: true, subtree: true
          });

          setTimeout(() => {
            observer.disconnect();
            resolve(null);
          }, timeoutMs);
        });
      }

      // ── Stealth: type a single character into an input ──
      // Dispatches the full browser event lifecycle so React's internal
      // state hydrates correctly via its synthetic event system.
      async function typeChar(el, char) {
        const keyInit = {
          key: char,
          code: 'Key' + char.toUpperCase(),
          charCode: char.charCodeAt(0),
          keyCode: char.charCodeAt(0),
          which: char.charCodeAt(0),
          bubbles: true,
          cancelable: true,
          composed: true,
        };

        // 1. KeyDown
        el.dispatchEvent(new KeyboardEvent('keydown', keyInit));

        // 2. KeyPress (deprecated but React still listens)
        el.dispatchEvent(new KeyboardEvent('keypress', keyInit));

        // 3. Set value using native setter (bypasses React's override)
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, el.value + char);
        } else {
          el.value += char;
        }

        // 4. InputEvent (React listens to this for controlled components)
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: char,
        }));

        // 5. KeyUp
        el.dispatchEvent(new KeyboardEvent('keyup', keyInit));
      }

      // ── Stealth: type a full string with human-like jitter ──
      async function typeString(el, text) {
        // Focus the input first
        el.focus();
        el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

        // Clear existing value
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, '');
        } else {
          el.value = '';
        }
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));

        // Type each character with random jitter
        for (const char of text) {
          await typeChar(el, char);
          await sleep(randInt(50, 150));
        }

        // Fire change event after all characters typed
        el.dispatchEvent(new Event('change', { bubbles: true }));

        // Blur to signal completion
        el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      }

      // ── Stealth: click with full pointer event sequence ──
      function stealthClick(el) {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const commonInit = {
          view: window,
          bubbles: true,
          cancelable: true,
          buttons: 1,
          clientX: x,
          clientY: y,
        };

        el.dispatchEvent(new PointerEvent('pointerdown', { ...commonInit, pointerId: 1, pointerType: 'mouse' }));
        el.dispatchEvent(new MouseEvent('mousedown', commonInit));
        el.dispatchEvent(new PointerEvent('pointerup', { ...commonInit, pointerId: 1, pointerType: 'mouse' }));
        el.dispatchEvent(new MouseEvent('mouseup', commonInit));
        el.dispatchEvent(new MouseEvent('click', commonInit));
      }

      // ── Datadome Challenge Detection ──
      function detectDatadomeChallenge() {
        // Check for Datadome modal overlay
        if (document.querySelector('.ddg-modal')) return 'DDG_MODAL';
        // Check for Datadome captcha iframe
        if (document.querySelector('#sec-cpt-if, iframe[src*="datadome"]')) return 'CAPTCHA_IFRAME';
        // Check for datadome.co script-injected elements
        if (document.querySelector('[data-dd-action], [class*="dd-"]')) return 'DD_ELEMENT';
        // Check for Datadome interstitial page
        if (document.body?.innerHTML?.includes('datadome.co')) return 'DD_INTERSTITIAL';
        return null;
      }

      try {
        // 1. Wait for the email input to be mounted and interactive
        console.log('[Stealth] Waiting for email input...');
        const emailInput = await waitForElement(
          'input[type="email"], input[name*="email" i], input[name*="login" i], input[data-testid*="email" i]'
        );
        if (!emailInput) {
          return { ok: false, reason: 'EMAIL_INPUT_NOT_FOUND' };
        }

        // 2. Wait for password input
        console.log('[Stealth] Waiting for password input...');
        const passwordInput = await waitForElement('input[type="password"]');
        if (!passwordInput) {
          return { ok: false, reason: 'PASSWORD_INPUT_NOT_FOUND' };
        }

        // 3. Small random delay before starting (simulate human reading the page)
        await sleep(randInt(500, 1200));

        // 4. Type email with stealth simulation
        console.log('[Stealth] Typing email...');
        await typeString(emailInput, ${JSON.stringify(email)});

        // 5. Small pause between fields (human-like tab behavior)
        await sleep(randInt(300, 700));

        // 6. Type password with stealth simulation
        console.log('[Stealth] Typing password...');
        await typeString(passwordInput, ${JSON.stringify(password)});

        // 7. Auto-submit with delay
        if (${autoSubmit ? 'true' : 'false'}) {
          await sleep(randInt(800, 1500));

          const submitButton =
            document.querySelector('button[type="submit"]') ||
            document.querySelector('button[data-testid*="submit" i]') ||
            document.querySelector('button[class*="submit" i]') ||
            document.querySelector('form button:not([type="button"])');

          if (submitButton) {
            console.log('[Stealth] Clicking submit...');
            stealthClick(submitButton);

            // 8. Wait and check for Datadome challenge
            await sleep(3000);
            const challenge = detectDatadomeChallenge();
            if (challenge) {
              console.warn('[Stealth] Datadome challenge detected:', challenge);
              return { ok: false, reason: 'DATADOME_CHALLENGE', detail: challenge };
            }
          } else {
            console.warn('[Stealth] Submit button not found');
            return { ok: false, reason: 'SUBMIT_NOT_FOUND' };
          }
        }

        return { ok: true };
      } catch (err) {
        return { ok: false, reason: 'INJECTION_ERROR', detail: String(err) };
      }
    })();
  `;
}

// ─── Autofill Orchestration ─────────────────────────────────────────────────

async function runAutofill(webContents: WebContents): Promise<void> {
  const autofillEnabled = settings.getSetting('sessionAutofillEnabled');
  if (!autofillEnabled) return;

  const credentials = await credentialStore.getLoginCredentials();
  if (!credentials) return;

  const currentUrl = webContents.getURL();
  if (!isVintedUrl(currentUrl)) return;

  const autoSubmit = settings.getSetting('sessionAutoSubmitEnabled');

  try {
    const script = buildStealthAutofillScript(
      credentials.username,
      credentials.password,
      !!autoSubmit,
    );

    const result = await webContents.executeJavaScript(script, true);

    if (result && !result.ok) {
      console.warn('[AuthCapture] Stealth autofill issue', {
        reason: result.reason,
        detail: result.detail,
      });

      // Emit Datadome challenge as structured IPC error
      if (result.reason === 'DATADOME_CHALLENGE') {
        const { BrowserWindow } = require('electron');
        for (const win of BrowserWindow.getAllWindows()) {
          if (win.webContents && !win.isDestroyed()) {
            win.webContents.send('session:datadome-challenge', {
              type: result.detail,
              message: 'Datadome blocked the automated login. Please log in manually via the Chrome Extension.',
            });
          }
        }
      }
    } else {
      console.log('[AuthCapture] Stealth autofill completed successfully');
    }
  } catch (err) {
    console.warn('session:refresh-autofill-failed', { error: String(err) });
  }
}

async function collectVintedCookies(webContents: WebContents): Promise<Electron.Cookie[]> {
  const allCookies = await webContents.session.cookies.get({});
  return allCookies.filter((cookie) => cookie.domain.includes('vinted.co.uk'));
}

/**
 * Clear stale Vinted cookies from the given session so that only
 * freshly-acquired cookies from an actual login will be detected.
 */
async function clearVintedCookies(session: Electron.Session): Promise<void> {
  const existing = await session.cookies.get({});
  const vintedCookies = existing.filter((c) => c.domain.includes('vinted.co.uk'));
  for (const c of vintedCookies) {
    const url = `https://${c.domain.replace(/^\./, '')}${c.path || '/'}`;
    await session.cookies.remove(url, c.name);
  }
}

export async function startCookieRefresh(): Promise<CookieRefreshResult> {
  // Safety: if a previous run got stuck (window destroyed without cleanup), reset the guard
  if (activeRun && activeWindow && activeWindow.isDestroyed()) {
    console.warn('[AuthCapture] Stale activeRun detected (window destroyed) — resetting.');
    activeWindow = null;
    activeRun = null;
  }

  if (activeRun) {
    return { ok: false, reason: 'ALREADY_RUNNING' };
  }

  activeRun = new Promise<CookieRefreshResult>((resolve) => {
    let settled = false;
    let timeoutId: NodeJS.Timeout | null = null;
    let cookieChangeHandler: (() => void) | null = null;

    const finish = (result: CookieRefreshResult) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (cookieChangeHandler) {
        win.webContents.session.cookies.removeListener('changed', cookieChangeHandler);
      }
      if (activeWindow && !activeWindow.isDestroyed()) activeWindow.close();
      activeWindow = null;
      activeRun = null;
      resolve(result);
    };

    const win = new BrowserWindow({
      width: 1080,
      height: 860,
      autoHideMenuBar: true,
      webPreferences: {
        partition: AUTH_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    activeWindow = win;

    // Register safety handlers before any async work so window
    // closure during init is always caught.
    timeoutId = setTimeout(() => {
      console.warn('session:refresh-timeout');
      finish({ ok: false, reason: 'TIMED_OUT' });
    }, COOKIE_TIMEOUT_MS);

    win.on('closed', () => {
      if (!settled) {
        finish({ ok: false, reason: 'WINDOW_CLOSED' });
      }
    });

    const tryCapture = async () => {
      try {
        const cookies = await collectVintedCookies(win.webContents);
        const names = new Set(cookies.map((cookie) => cookie.name));
        if (!hasRequiredCookies(names)) return;

        const cookieHeader = normalizeCookieHeader(cookies);
        if (!cookieHeader) return;

        secureStorage.storeCookie(cookieHeader);
        sessionService.emitSessionReconnected();
        console.log('session:refresh-cookie-captured', { cookieCount: cookies.length });
        finish({ ok: true });
      } catch (err) {
        console.warn('session:refresh-cookie-capture-failed', { error: String(err) });
      }
    };

    // Clear stale Vinted cookies from the persistent partition, then
    // wire up capture listeners and load the login page.
    clearVintedCookies(win.webContents.session).then(() => {
      if (settled) return;

      cookieChangeHandler = () => {
        void tryCapture();
      };
      win.webContents.session.cookies.on('changed', cookieChangeHandler);

      win.webContents.on('did-finish-load', () => {
        void runAutofill(win.webContents).catch((err) => {
          console.warn('session:refresh-autofill-failed', { error: String(err) });
        });
        void tryCapture();
      });

      win.webContents.on('did-navigate', () => {
        void runAutofill(win.webContents).catch((err) => {
          console.warn('session:refresh-autofill-failed', { error: String(err) });
        });
        void tryCapture();
      });

      win.loadURL(VINTED_LOGIN_URL).catch((err) => {
        console.error('session:refresh-load-failed', { error: String(err) });
        finish({ ok: false, reason: 'LOAD_FAILED' });
      });
    }).catch((err) => {
      console.error('session:refresh-init-failed', { error: String(err) });
      finish({ ok: false, reason: 'INIT_FAILED' });
    });
  });

  return activeRun;
}
