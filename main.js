const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function dataDir() { return app.getPath('userData'); }
function dataFile() { return path.join(dataDir(), 'data.enc'); }
function keyFile() { return path.join(dataDir(), 'data.key'); }
function backupsDir() { return path.join(dataDir(), 'backups'); }

function getEncryptionKey() {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(keyFile())) {
    const stored = fs.readFileSync(keyFile());
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is unavailable');
    return safeStorage.decryptString(stored);
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is unavailable');
  const key = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(keyFile(), safeStorage.encryptString(key), { mode: 0o600 });
  return key;
}

function encryptData(data) {
  const key = Buffer.from(getEncryptionKey(), 'base64');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('AHALI1'), iv, tag, encrypted]);
}

function decryptData(buffer) {
  const key = Buffer.from(getEncryptionKey(), 'base64');
  if (buffer.subarray(0, 6).toString() !== 'AHALI1') {
    return JSON.parse(buffer.toString('utf8'));
  }
  const iv = buffer.subarray(6, 18);
  const tag = buffer.subarray(18, 34);
  const encrypted = buffer.subarray(34);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
}

function readData() {
  try {
    const file = dataFile();
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file);
    const data = decryptData(raw);
    // Migrate any old plaintext data.json automatically.
    if (raw.subarray(0, 6).toString() !== 'AHALI1') writeData(data);
    return data;
  } catch (err) {
    console.error('Failed to read local data:', err);
    return null;
  }
}

function writeData(data) {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = dataFile();
  const temp = file + '.tmp';
  fs.writeFileSync(temp, encryptData(data));
  fs.renameSync(temp, file);
  return true;
}

function makeAutoBackup(data) {
  try {
    fs.mkdirSync(backupsDir(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(backupsDir(), `auto-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    const files = fs.readdirSync(backupsDir()).filter(x => x.endsWith('.json')).sort();
    while (files.length > 10) fs.rmSync(path.join(backupsDir(), files.shift()));
  } catch (e) { console.error('Auto backup failed:', e); }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1000, minHeight: 650,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.on('data-load', (event) => { event.returnValue = readData(); });
  ipcMain.on('data-save', (event, data) => {
    try { writeData(data); makeAutoBackup(data); event.returnValue = true; }
    catch (err) { console.error('Failed to save local data:', err); event.returnValue = false; }
  });
  ipcMain.handle('app-data-path', () => dataDir());
  ipcMain.handle('backup-save', async (_event, json, suggestedName) => {
    const result = await dialog.showSaveDialog({
      title: 'حفظ النسخة الاحتياطية',
      defaultPath: path.join(app.getPath('documents'), suggestedName || 'alhaj-ali-backup.json'),
      filters: [{ name: 'نسخة احتياطية JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, json, 'utf8');
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain.handle('backup-open', async () => {
    const result = await dialog.showOpenDialog({
      title: 'استرجاع نسخة احتياطية', properties: ['openFile'],
      filters: [{ name: 'نسخة احتياطية JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, json: fs.readFileSync(result.filePaths[0], 'utf8'), filePath: result.filePaths[0] };
  });
  ipcMain.handle('open-data-folder', async () => {
    const { shell } = require('electron');
    return shell.openPath(dataDir());
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
