const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// ── Single Instance Lock (prevent opening multiple instances on the same port) ──
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[Electron] Another instance is already running. Focusing existing window and exiting.');
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let tray = null;
let isQuitting = false;
let serverInstance = null;

const PORT = process.env.PORT || 3050;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

// Function to check if the local server is alive
function checkServerReady(url, maxAttempts = 30, intervalMs = 600) {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const req = http.get(url, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolve(true);
        } else if (attempts < maxAttempts) {
          setTimeout(check, intervalMs);
        } else {
          resolve(false);
        }
      });

      req.on('error', () => {
        if (attempts < maxAttempts) {
          setTimeout(check, intervalMs);
        } else {
          resolve(false);
        }
      });

      req.setTimeout(1500, () => {
        req.destroy();
        if (attempts < maxAttempts) {
          setTimeout(check, intervalMs);
        } else {
          resolve(false);
        }
      });
    };
    check();
  });
}

// Start backend Express server if not already running
async function ensureServerRunning() {
  const alreadyRunning = await checkServerReady(SERVER_URL, 3, 300);
  if (alreadyRunning) {
    console.log(`[Electron] Detected existing backend server running at ${SERVER_URL}`);
    return;
  }

  console.log('[Electron] Starting internal backend Express server...');
  try {
    const backend = require('./server.js');
    serverInstance = backend.server || backend;
    console.log('[Electron] Server module loaded successfully.');
  } catch (err) {
    console.error('[Electron] Error starting internal server:', err);
  }

  // Wait for server to become responsive
  const ready = await checkServerReady(SERVER_URL, 40, 500);
  if (!ready) {
    console.warn('[Electron] Server took longer than expected to respond, loading anyway...');
  }
}

function getAppIconPath() {
  const icoPath = path.join(__dirname, 'assets', 'app-icon.ico');
  const pngPath = path.join(__dirname, 'assets', 'app-icon.png');
  if (process.platform === 'win32' && fs.existsSync(icoPath)) {
    return icoPath;
  }
  return pngPath;
}

function createMainWindow() {
  const iconPath = getAppIconPath();
  const appIcon = nativeImage.createFromPath(iconPath);

  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1050,
    minHeight: 700,
    title: 'وكيل مبيعات واتساب الذكي - حكيم جروب | AI Outreach Agent',
    icon: appIcon,
    backgroundColor: '#020617',
    show: false, // Show once ready-to-show to prevent white flash
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false
    }
  });

  // Load backend web dashboard
  mainWindow.loadURL(SERVER_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    console.log('[Electron] Main window displayed successfully.');
  });

  // Open external links (e.g. WhatsApp web, catalog, maps) in default system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Minimize to tray on close if user wants background auto-reply running
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      if (tray && process.platform === 'win32') {
        tray.displayBalloon({
          icon: appIcon,
          title: 'وكيل مبيعات واتساب الذكي',
          content: 'التطبيق يعمل في الخلفية لمواصلة الرد التلقائي وإدارة الحملات.'
        });
      }
    }
    return false;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createSystemTray() {
  const iconPath = getAppIconPath();
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  tray = new Tray(trayIcon);
  tray.setToolTip('وكيل مبيعات واتساب الذكي - حكيم جروب');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'فتح لوحة التحكم (Open Dashboard)',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'إعادة تحميل اللوحة (Reload)',
      click: () => {
        if (mainWindow) {
          mainWindow.reload();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'موقع كتالوج حكيم جروب',
      click: () => {
        shell.openExternal('https://hakim-chi.vercel.app/products');
      }
    },
    { type: 'separator' },
    {
      label: 'خروج نهائي (Quit)',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });
}

// Focus existing window when user tries to launch a second instance
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

// App initialization
app.whenReady().then(async () => {
  console.log('[Electron] App ready. Initializing desktop environment...');
  
  // Set App User Model ID for Windows toast notifications & taskbar grouping
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.hakimgroup.whatsappai');
  }

  createSystemTray();
  await ensureServerRunning();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  console.log('[Electron] Shutting down application...');
  if (serverInstance && typeof serverInstance.close === 'function') {
    try {
      serverInstance.close();
      console.log('[Electron] Server closed.');
    } catch (e) {
      // ignore
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});
