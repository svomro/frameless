const { app, BrowserWindow, ipcMain, Menu, screen } = require("electron");
const path = require("path");

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  // eslint-disable-line global-require
  app.quit();
}

let alwaysOnTop = true;
let grabOffset;
let mainWindow = null;

// Finder delivers a double-clicked or "Open With" file through open-file, and
// on a cold start that fires before the window (or even app.ready) exists, so
// hold the path until a renderer is actually there to receive it.
let pendingOpenPath = null;

const openImageInWindow = (filePath) => {
  if (typeof filePath !== "string" || !filePath) return;

  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingOpenPath = filePath;
    return;
  }

  if (mainWindow.webContents.isLoading()) {
    pendingOpenPath = filePath;
    return;
  }

  mainWindow.webContents.send("open-image", filePath);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
};

// open-file must be subscribed before the app finishes launching, otherwise the
// very first file (the one that launched the app) is dropped on the floor.
app.on("will-finish-launching", () => {
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    openImageInWindow(filePath);
  });
});

// Math.round returns -0 for anything in [-0.5, 0), and Electron's native
// argument conversion rejects -0 outright: dragging the window across y = 0
// (the edge of a display placed above this one) crashed the main process.
const toInt = (value) => Math.round(value) || 0;

// The window follows the pointer by absolute position rather than by summed
// deltas. macOS refuses to move a window's title bar above the menu bar of the
// screen it currently sits on, so every small upward step of a delta drag was
// swallowed and the window could never climb onto a display placed above this
// one. Asking for "wherever the cursor is now, minus where it grabbed the
// window" is immune to that: nothing accumulates while a move is refused, and
// the moment the cursor crosses onto the other display the requested position
// lands there too and macOS accepts it.
ipcMain.on("start-window-drag", (event, offsetX, offsetY) => {
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return;

  grabOffset = { x: offsetX, y: offsetY };
});

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

ipcMain.on("drag-window-to-cursor", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || !grabOffset) return;

  const cursor = screen.getCursorScreenPoint();
  const frame = window.getBounds();
  const content = window.getContentBounds();
  const x = toInt(cursor.x - grabOffset.x - (content.x - frame.x));
  let y = toInt(cursor.y - grabOffset.y - (content.y - frame.y));

  // macOS rejects a position while most of the window still belongs to the old
  // display but the requested top edge has already crossed that display's menu
  // bar. Forcing the window into the cursor's display every frame causes a much
  // worse failure mode: it alternates between the forced position and the true
  // cursor-anchored position, which looks like flashing.
  //
  // During that short hand-off zone, keep the last accepted vertical position
  // and only follow the cursor horizontally. As soon as the *requested window*
  // itself belongs mostly to the cursor's display, the original anchored
  // position is safe again and we move there in one shot. The grabbed point is
  // never rebased, so after crossing screens the drag continues exactly where
  // the user picked the image up.
  const cursorDisplay = screen.getDisplayNearestPoint(cursor);
  const currentDisplay = screen.getDisplayMatching(frame);
  const requestedDisplay = screen.getDisplayMatching({
    x,
    y,
    width: frame.width,
    height: frame.height,
  });

  if (
    cursorDisplay.id !== currentDisplay.id &&
    requestedDisplay.id !== cursorDisplay.id
  ) {
    window.setPosition(x, frame.y);
    return;
  }

  window.setPosition(x, y);
});

// The largest content size that still fits on the screen the window is on. A
// frameless always-on-top window that spills off the display swallows the
// desktop and leaves no edge to grab, so it can no longer be resized or moved.
const contentSizeLimits = (window) => {
  const { workArea } = screen.getDisplayMatching(window.getBounds());
  const [contentWidth, contentHeight] = window.getContentSize();
  const frame = window.getBounds();

  return {
    workArea,
    maxWidth: Math.max(1, workArea.width - (frame.width - contentWidth)),
    maxHeight: Math.max(1, workArea.height - (frame.height - contentHeight)),
  };
};

const setContentSizeWithinScreen = (window, width, height) => {
  const { workArea, maxWidth, maxHeight } = contentSizeLimits(window);

  window.setContentSize(
    Math.max(1, Math.min(Math.round(width), maxWidth)),
    Math.max(1, Math.min(Math.round(height), maxHeight))
  );

  // Growing the window can push it off the edge it was already close to.
  const bounds = window.getBounds();
  const x = clamp(bounds.x, workArea.x, workArea.x + workArea.width - bounds.width);
  const y = clamp(bounds.y, workArea.y, workArea.y + workArea.height - bounds.height);
  if (x !== bounds.x || y !== bounds.y) {
    window.setPosition(toInt(x), toInt(y));
  }
};

ipcMain.on("set-content-size", (event, width, height) => {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;

  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  setContentSizeWithinScreen(window, width, height);
});

// Shrink-to-fit the image's own shape and pin that shape, so the window and the
// image stay the exact same rectangle however the user resizes afterwards.
ipcMain.on("lock-to-image-size", (event, width, height) => {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  if (width <= 0 || height <= 0) return;

  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  const { maxWidth, maxHeight } = contentSizeLimits(window);
  const scale = Math.min(1, maxWidth / width, maxHeight / height);

  setContentSizeWithinScreen(window, width * scale, height * scale);
  window.setAspectRatio(width / height);
});

ipcMain.on("unlock-aspect-ratio", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  window.setAspectRatio(0);
});

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 160,
    minHeight: 120,
    frame: false,
    transparent: true,
    titleBarStyle: "customButtonsOnHover",
    title: "Frameless",
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.setAlwaysOnTop(true, "pop-up-menu");

  const toggleAlwaysOnTop = () => {
    alwaysOnTop = !alwaysOnTop;
    mainWindow.setAlwaysOnTop(
      alwaysOnTop,
      alwaysOnTop ? "pop-up-menu" : "normal"
    );
    Menu.getApplicationMenu().getMenuItemById("always-on-top").checked =
      alwaysOnTop;
  };

  // mainWindow.webContents.openDevTools();

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, "index.html"));

  // Flush a file that arrived while the renderer was still loading.
  mainWindow.webContents.on("did-finish-load", () => {
    if (!pendingOpenPath) return;

    mainWindow.webContents.send("open-image", pendingOpenPath);
    pendingOpenPath = null;
  });

  const showContextMenu = ({ hasImage = false, viewMode } = {}) => {
    Menu.buildFromTemplate([
      // Exact Fit and Original Size are two mutually exclusive layouts, not
      // switches: there is no third mode to fall back to, so neither can be
      // turned "off". Checkboxes implied otherwise and made Exact Fit look
      // stuck on, because clicking an already-checked one is a no-op.
      {
        type: "radio",
        label: "Exact Fit (Image = Window)",
        accelerator: "CmdOrCtrl+0",
        checked: viewMode === "lock",
        enabled: hasImage,
        click: () => mainWindow.webContents.executeJavaScript("exactFit()"),
      },
      {
        type: "radio",
        label: "Original Size",
        checked: viewMode === "original",
        enabled: hasImage,
        click: () => mainWindow.webContents.executeJavaScript("originalSize()"),
      },
      {
        label: "Opacity…",
        click: () =>
          mainWindow.webContents.executeJavaScript("showOpacityControl()"),
      },
      { type: "separator" },
      {
        type: "checkbox",
        label: "Always on Top",
        checked: alwaysOnTop,
        click: toggleAlwaysOnTop,
      },
      { type: "separator" },
      { label: "Quit", role: "quit" },
    ]).popup({ window: mainWindow });
  };

  mainWindow.webContents.on("context-menu", () => {
    mainWindow.webContents
      .executeJavaScript("getViewState()")
      .then(showContextMenu)
      .catch(() => showContextMenu());
  });

  const menuTemplate = [
    {
      label: "Options",
      submenu: [
        {
          label: "Exact Fit (Image = Window)",
          accelerator: "CmdOrCtrl+0",
          click: () => mainWindow.webContents.executeJavaScript("exactFit()"),
        },
        {
          label: "Opacity…",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () =>
            mainWindow.webContents.executeJavaScript("showOpacityControl()"),
        },
        { type: "separator" },
        {
          id: "always-on-top",
          label: "Always on Top",
          type: "checkbox",
          checked: alwaysOnTop,
          click: toggleAlwaysOnTop,
        },
        { label: "Quit", role: "quit" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  app.quit();
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
