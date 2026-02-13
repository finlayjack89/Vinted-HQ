/**
 * Auth capture flow:
 * - open temporary Vinted login window
 * - optionally autofill credentials from keychain
 * - extract required cookies and persist secure cookie header
 * - close window immediately on success
 */

import { BrowserWindow, WebContents } from 'electron';
import * as secureStorage from './secureStorage';
import * as credentialStore from './credentialStore';
import * as sessionService from './sessionService';
import * as settings from './settings';
import { logger } from './logger';

const VINTED_LOGIN_URL = 'https://www.vinted.co.uk/member/signup/select_type';
const COOKIE_TIMEOUT_MS = 180_000;
const AUTH_PARTITION = 'persist:vinted-auth';
const REQUIRED_COOKIES = ['_vinted_fr_session', 'access_token_web', 'refresh_token_web'];

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

async function runAutofill(webContents: WebContents): Promise<void> {
  const autofillEnabled = settings.getSetting('sessionAutofillEnabled');
  if (!autofillEnabled) return;

  const credentials = await credentialStore.getLoginCredentials();
  if (!credentials) return;

  const currentUrl = webContents.getURL();
  if (!isVintedUrl(currentUrl)) return;

  const autoSubmit = settings.getSetting('sessionAutoSubmitEnabled');
  await webContents.executeJavaScript(
    `
      (() => {
        const email = ${JSON.stringify(credentials.username)};
        const password = ${JSON.stringify(credentials.password)};

        const emailInput = document.querySelector('input[type="email"], input[name*="email" i], input[name*="login" i]');
        const passwordInput = document.querySelector('input[type="password"]');

        if (emailInput) {
          emailInput.focus();
          emailInput.value = email;
          emailInput.dispatchEvent(new Event('input', { bubbles: true }));
          emailInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        if (passwordInput) {
          passwordInput.focus();
          passwordInput.value = password;
          passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
          passwordInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        if (${autoSubmit ? 'true' : 'false'} && emailInput && passwordInput) {
          const submitButton =
            document.querySelector('button[type="submit"]') ||
            document.querySelector('button[data-testid*="submit" i]') ||
            document.querySelector('button[class*="submit" i]');
          if (submitButton) {
            submitButton.click();
          }
        }
      })();
    `,
    true
  );
}

async function collectVintedCookies(webContents: WebContents): Promise<Electron.Cookie[]> {
  const allCookies = await webContents.session.cookies.get({});
  return allCookies.filter((cookie) => cookie.domain.includes('vinted.co.uk'));
}

export async function startCookieRefresh(): Promise<CookieRefreshResult> {
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

    const tryCapture = async () => {
      try {
        const cookies = await collectVintedCookies(win.webContents);
        const names = new Set(cookies.map((cookie) => cookie.name));
        if (!hasRequiredCookies(names)) return;

        const cookieHeader = normalizeCookieHeader(cookies);
        if (!cookieHeader) return;

        secureStorage.storeCookie(cookieHeader);
        sessionService.emitSessionReconnected();
        logger.info('session:refresh-cookie-captured', { cookieCount: cookies.length });
        finish({ ok: true });
      } catch (err) {
        logger.warn('session:refresh-cookie-capture-failed', { error: String(err) });
      }
    };

    timeoutId = setTimeout(() => {
      logger.warn('session:refresh-timeout');
      finish({ ok: false, reason: 'TIMED_OUT' });
    }, COOKIE_TIMEOUT_MS);

    win.on('closed', () => {
      if (!settled) {
        finish({ ok: false, reason: 'WINDOW_CLOSED' });
      }
    });

    cookieChangeHandler = () => {
      void tryCapture();
    };
    win.webContents.session.cookies.on('changed', cookieChangeHandler);

    win.webContents.on('did-finish-load', () => {
      void runAutofill(win.webContents).catch((err) => {
        logger.warn('session:refresh-autofill-failed', { error: String(err) });
      });
      void tryCapture();
    });

    win.webContents.on('did-navigate', () => {
      void runAutofill(win.webContents).catch((err) => {
        logger.warn('session:refresh-autofill-failed', { error: String(err) });
      });
      void tryCapture();
    });

    win.loadURL(VINTED_LOGIN_URL).catch((err) => {
      logger.error('session:refresh-load-failed', { error: String(err) });
      finish({ ok: false, reason: 'LOAD_FAILED' });
    });
  });

  return activeRun;
}
