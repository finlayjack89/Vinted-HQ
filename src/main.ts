import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, ChildProcess } from 'node:child_process';
import started from 'electron-squirrel-startup';
import { initDb, closeDb } from './main/db';
import { registerIpcHandlers } from './main/ipc';
import * as feedService from './main/feedService';
import * as searchUrls from './main/searchUrls';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const PYTHON_BRIDGE_PORT = 37421;
let pythonBridgeProcess: ChildProcess | null = null;

function startPythonBridge(): void {
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
  startPythonBridge();
  createWindow();
  if (searchUrls.getEnabledSearchUrls().length > 0) {
    feedService.startPolling();
  }
});

app.on('before-quit', () => {
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
