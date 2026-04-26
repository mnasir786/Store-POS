const { app } = require('electron');
const path = require('path');
const os = require('os');

// Platform-independent path detection
let appDataPath;

try {
    // Try official Electron method first
    appDataPath = app.getPath('appData');
} catch (e) {
    // Fallback if Electron app object is not yet ready
    if (process.platform === 'win32') {
        appDataPath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    } else if (process.platform === 'darwin') {
        appDataPath = path.join(os.homedir(), 'Library', 'Application Support');
    } else {
        // Linux and others
        appDataPath = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    }
}

const baseDir = path.join(appDataPath, 'POS');

module.exports = {
    baseDir: baseDir,
    dbPath: (name) => path.join(baseDir, 'server', 'databases', `${name}.db`),
    uploadDir: path.join(baseDir, 'uploads')
};
