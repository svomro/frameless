const {app, BrowserWindow, nativeImage} = require('electron');
const {pathToFileURL} = require('url');
const {spawnSync} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 图标源换成 Glass Pocket 版；旧的 pin-note-preview.html 还留在 tasks/ 里没删。
// 这个页面在无 localStorage 的干净窗口里会落回 defaults，所以 defaults 就是图标的准绳。
const PREVIEW = path.join(ROOT, 'tasks', 'glass-pocket-rings-preview.html');
const ASSETS = path.join(ROOT, 'assets');
const TASKS = path.join(ROOT, 'tasks');
const MASTER_PNG = path.join(TASKS, 'icon-1024.png');
const ICNS = path.join(ASSETS, 'icon.icns');

const ICONSET_FILES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

function run(command, args) {
  const result = spawnSync(command, args, {encoding: 'utf8'});
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
}

async function renderMasterPng() {
  fs.mkdirSync(ASSETS, {recursive: true});
  fs.mkdirSync(TASKS, {recursive: true});

  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    webPreferences: {
      webSecurity: false,
      backgroundThrottling: false,
    },
  });

  await window.loadURL(pathToFileURL(PREVIEW).href);

  // Glass Pocket 页没有外部图片要等，画布是同步画完的；
  // 与其等一个 ready 标志，不如直接确认画布上真的有像素。
  const painted = await window.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('canvas');
    if (!c || c.width !== 1024 || c.height !== 1024) return false;
    const {data} = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
    return false;
  })()`);
  if (!painted) {
    throw new Error('icon renderer produced a blank 1024x1024 canvas');
  }

  const dataUrl = await window.webContents.executeJavaScript(
    `document.getElementById('canvas').toDataURL('image/png')`
  );
  const buffer = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
  const image = nativeImage.createFromBuffer(buffer);
  const size = image.getSize();
  if (size.width !== 1024 || size.height !== 1024) {
    throw new Error(`expected 1024x1024 master PNG, got ${size.width}x${size.height}`);
  }

  fs.writeFileSync(MASTER_PNG, buffer);
  window.destroy();
}

function buildIcns() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frameless-icon-'));
  const iconset = path.join(tempRoot, 'AppIcon.iconset');
  fs.mkdirSync(iconset);

  try {
    for (const [filename, size] of ICONSET_FILES) {
      run('/usr/bin/sips', ['-z', String(size), String(size), MASTER_PNG, '--out', path.join(iconset, filename)]);
    }
    run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', ICNS]);
  } finally {
    fs.rmSync(tempRoot, {recursive: true, force: true});
  }
}

app.whenReady().then(async () => {
  try {
    await renderMasterPng();
    buildIcns();
    console.log(`Created ${path.relative(ROOT, MASTER_PNG)}`);
    console.log(`Created ${path.relative(ROOT, ICNS)}`);
  } catch (error) {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
