const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("windowControls", {
  startDrag: (offsetX, offsetY) =>
    ipcRenderer.send("start-window-drag", offsetX, offsetY),
  dragToCursor: () => ipcRenderer.send("drag-window-to-cursor"),
  setContentSize: (width, height) =>
    ipcRenderer.send("set-content-size", width, height),
  lockToImageSize: (width, height) =>
    ipcRenderer.send("lock-to-image-size", width, height),
  unlockAspectRatio: () => ipcRenderer.send("unlock-aspect-ratio"),
});
