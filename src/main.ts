import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, ChildProcess } from 'node:child_process';
import started from 'electron-squirrel-startup';
import { initDb, closeDb } from './main/db';
import { registerIpcHandlers } from './main/ipc';
import * as feedService from './main/feedService';
import * as searchUrls from './main/searchUrls';
import * as settings from './main/settings';
import * as ontologyService from './main/ontologyService';
import * as inventoryService from './main/inventoryService';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const PYTHON_BRIDGE_PORT = 37421;
let pythonBridgeProcess: ChildProcess | null = null;

/**
 * Kill any existing process listening on the bridge port.
 * Prevents stale bridge processes from a previous app launch
 * from occupying the port and serving outdated routes.
 */
function killStaleBridge(): void {
  try {
    const { execSync } = require('node:child_process');
    if (process.platform === 'win32') {
      // Windows: find PID on port and kill it
      const result = execSync(`netstat -ano | findstr :${PYTHON_BRIDGE_PORT}`, { encoding: 'utf8', timeout: 5000 });
      const lines = result.split('\n').filter((l: string) => l.includes('LISTENING'));
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid)) {
          execSync(`taskkill /F /PID ${pid}`, { timeout: 5000 });
          console.log(`[Python Bridge] Killed stale process PID ${pid} on port ${PYTHON_BRIDGE_PORT}`);
        }
      }
    } else {
      // macOS/Linux: use lsof to find and kill
      const result = execSync(`lsof -ti :${PYTHON_BRIDGE_PORT}`, { encoding: 'utf8', timeout: 5000 });
      const pids = result.trim().split('\n').filter((p: string) => p.length > 0);
      for (const pid of pids) {
        execSync(`kill -9 ${pid}`, { timeout: 5000 });
        console.log(`[Python Bridge] Killed stale process PID ${pid} on port ${PYTHON_BRIDGE_PORT}`);
      }
    }
  } catch {
    // No process on port — expected on clean start
  }
}

function startPythonBridge(): void {
  // Kill any stale bridge process from a previous app session
  killStaleBridge();

  const bridgeDir = path.join(app.getAppPath(), 'python-bridge');
  const serverPath = path.join(bridgeDir, 'server.py');

  if (!fs.existsSync(serverPath)) {
    console.warn('[Python Bridge] server.py not found at', serverPath);
    return;
  }

  // Prefer venv Python if it exists
  const venvPython =
    process.platform === 'win32'
      ? path.join(bridgeDir, 'venv', 'Scripts', 'python.exe')
      : path.join(bridgeDir, 'venv', 'bin', 'python');
  const pythonExec = fs.existsSync(venvPython) ? venvPython : 'python3';

  try {
    pythonBridgeProcess = spawn(pythonExec, [serverPath], {
      cwd: bridgeDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    pythonBridgeProcess.stdout?.on('data', (data) => console.log('[Python Bridge]', data.toString().trim()));
    pythonBridgeProcess.stderr?.on('data', (data) => console.error('[Python Bridge]', data.toString().trim()));
    pythonBridgeProcess.on('close', (code) => {
      if (code !== 0 && code !== null) {
        console.warn('[Python Bridge] Exited with code', code, '- Install deps: cd python-bridge && pip install -r requirements.txt');
      }
    });
  } catch (err) {
    console.warn('[Python Bridge] Failed to start:', err);
  }
}

function stopPythonBridge(): void {
  if (pythonBridgeProcess) {
    pythonBridgeProcess.kill();
    pythonBridgeProcess = null;
  }
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open DevTools in development only (comment out for production)
  // mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  initDb();
  registerIpcHandlers();
  settings.migrateProxySettings();
  startPythonBridge();

  // Ensure image cache directory exists for Inventory Vault
  const imageCacheDir = path.join(app.getPath('userData'), 'image_cache');
  if (!fs.existsSync(imageCacheDir)) {
    fs.mkdirSync(imageCacheDir, { recursive: true });
    console.log('[Inventory] Created image cache directory:', imageCacheDir);
  }

  createWindow();

  // #region agent log
  const _appReadyTs = Date.now();
  fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.ts:ready',message:'App ready, about to start polling and schedule ontology',data:{enabledUrls:searchUrls.getEnabledSearchUrls().length,bridgePid:pythonBridgeProcess?.pid},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  // #endregion

  if (searchUrls.getEnabledSearchUrls().length > 0) {
    feedService.startPolling();
  }

  // Run ontology diff in background after bridge has had time to start
  setTimeout(async () => {
    // #region agent log
    try {
      const healthRes = await fetch('http://127.0.0.1:37421/health');
      const healthJson = await healthRes.json();
      fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.ts:ontologyTimeout',message:'Bridge health before ontology',data:{healthy:healthJson?.ok,elapsedMs:Date.now()-_appReadyTs},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    } catch (healthErr) {
      fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.ts:ontologyTimeout',message:'Bridge NOT reachable before ontology',data:{error:String(healthErr),elapsedMs:Date.now()-_appReadyTs},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    }
    // #endregion
    ontologyService.refreshAll().catch((err) =>
      console.warn('[Ontology] Startup refresh failed:', err)
    );
  }, 5000);
});

app.on('before-quit', () => {
  inventoryService.abortQueue();
  feedService.stopPolling();
  stopPythonBridge();
  closeDb();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
