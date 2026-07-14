const { autoUpdater } = require("electron-updater");
const { ipcMain, app, BrowserWindow } = require("electron");

let isListenerRegistered = false;

function getMainWindow() {
	const windows = BrowserWindow.getAllWindows();
	return windows.find((w) => !w.isDestroyed() && w.webContents.isActive()) || windows[0];
}

function setupUpdater() {
	// ─── Configure Updater ────────────────────────────────────────────────────
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;

	autoUpdater.logger = console;

	// ─── Error Handling ───────────────────────────────────────────────────────
	autoUpdater.on("error", (err) => {
		console.error("❌ Auto-updater error:", err?.message || err);
		const win = getMainWindow();
		if (win) {
			win.webContents.send("update-error", {
				message: err?.message || "Unknown update error",
			});
		}
	});

	// ─── Update Available ─────────────────────────────────────────────────────
	autoUpdater.on("update-available", (info) => {
		console.log("Update available:", info.version);
		const win = getMainWindow();
		if (win) {
			win.webContents.send("update-available", {
				latestVersion: info.version,
				releaseNotes: info.releaseNotes,
			});
		}
	});

	// ─── No Update ────────────────────────────────────────────────────────────
	autoUpdater.on("update-not-available", (info) => {
		console.log(`App is up to date: v${info.version}`);
	});

	// ─── Download Progress ────────────────────────────────────────────────────
	autoUpdater.on("download-progress", (progress) => {
		const win = getMainWindow();
		if (win) {
			win.webContents.send("update-download-progress", {
				percent: Math.round(progress.percent),
				bytesPerSecond: progress.bytesPerSecond,
				transferred: progress.transferred,
				total: progress.total,
			});
		}
	});

	// ─── Update Downloaded ────────────────────────────────────────────────────
	autoUpdater.on("update-downloaded", (info) => {
		console.log("Update downloaded. Ready to restart.");
		const win = getMainWindow();
		if (win) {
			win.webContents.send("update-downloaded", {
				latestVersion: info.version,
			});
		}
	});

	// ─── IPC: Restart & Install ───────────────────────────────────────────────
	if (!isListenerRegistered) {
		isListenerRegistered = true;
		ipcMain.on("restart-and-install", () => {
			app.isQuitting = true;
			autoUpdater.quitAndInstall(false, true);
		});
	}

	// ─── Initial Check + Hourly Poll ─────────────────────────────────────────
	if (app.isPackaged) {
		autoUpdater.checkForUpdates().catch((err) => {
			console.error("❌ Initial update check failed:", err?.message || err);
		});

		setInterval(
			() => {
				autoUpdater.checkForUpdates().catch((err) => {
					console.error("❌ Scheduled update check failed:", err?.message || err);
				});
			},
			60 * 60 * 1000,
		);
	}
}

module.exports = { setupUpdater };
