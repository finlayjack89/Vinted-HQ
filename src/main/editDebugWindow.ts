import { BrowserWindow, session } from 'electron';
import { setupNetworkInterception } from './authCapture';
import { logger } from './logger';

const VINTED_BASE = 'https://www.vinted.co.uk';
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

let win: BrowserWindow | null = null;
let lastUrl: string | null = null;

/**
 * Visible always-on debug window for capturing full Network logs from the very
 * start of navigation to the edit page.
 */
export async function openEditDebugWindow(itemId: number): Promise<void> {
  const editUrl = `${VINTED_BASE}/items/${itemId}/edit`;

  if (win && !win.isDestroyed()) {
    // Avoid reloading if we're already on the same URL.
    if (lastUrl === editUrl) {
      win.focus();
      return;
    }
  } else {
    win = null;
  }

  const ses = session.fromPartition('persist:vinted-scraper');
  setupNetworkInterception(ses);
  ses.setUserAgent(CHROME_UA);

  // Create a fresh window if needed.
  if (!win) {
    win = new BrowserWindow({
      show: true,
      width: 1200,
      height: 900,
      autoHideMenuBar: false,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    win.on('closed', () => {
      win = null;
      lastUrl = null;
    });
  }

  // Open DevTools BEFORE navigation so the Network panel captures from the start.
  try {
    if (!win.webContents.isDevToolsOpened()) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  } catch (err) {
    logger.warn('edit-debug-devtools-open-failed', { error: String(err) });
  }

  lastUrl = editUrl;
  win.show();
  win.focus();

  // Navigate directly to the edit URL.
  logger.info('edit-debug-navigate', { url: editUrl });

  let didReload = false;
  const onceFinish = () => {
    if (didReload) return;
    didReload = true;
    // Reload once after DevTools is open to guarantee the API calls appear in the log
    // even if DevTools attached a fraction too late.
    setTimeout(() => {
      try {
        win?.webContents.reloadIgnoringCache();
      } catch {
        /* ignore */
      }
    }, 250);
  };

  win.webContents.once('did-finish-load', onceFinish);
  try {
    await win.loadURL(editUrl);
  } catch (err) {
    logger.warn('edit-debug-loadURL-failed', { error: String(err) });
  }
}

