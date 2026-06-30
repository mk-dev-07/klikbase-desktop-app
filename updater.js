const { autoUpdater } = require("electron-updater");
const { ipcMain } = require("electron");

let isListenerRegistered = false;

function setupUpdater(mainWindow) {
	// ─── Configure Updater ────────────────────────────────────────────────────
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;

	// ─── Error Handling ───────────────────────────────────────────────────────
	autoUpdater.on("error", (err) => {
		console.error("❌ Auto-updater error:", err?.message || err);
		mainWindow?.webContents.send("update-error", {
			message: err?.message || "Unknown update error",
		});
	});

	// ─── Update Available ─────────────────────────────────────────────────────
	autoUpdater.on("update-available", (info) => {
		mainWindow?.webContents.send("update-available", {
			latestVersion: info.version,
			releaseNotes: info.releaseNotes,
		});
	});

	// ─── No Update ────────────────────────────────────────────────────────────
	autoUpdater.on("update-not-available", (info) => {
		console.log(`App is up to date: v${info.version}`);
	});

	// ─── Download Progress ────────────────────────────────────────────────────
	autoUpdater.on("download-progress", (progress) => {
		mainWindow?.webContents.send("update-download-progress", {
			percent: Math.round(progress.percent),
			bytesPerSecond: progress.bytesPerSecond,
			transferred: progress.transferred,
			total: progress.total,
		});
	});

	// ─── Update Downloaded ────────────────────────────────────────────────────
	autoUpdater.on("update-downloaded", (info) => {
		mainWindow?.webContents.send("update-downloaded", {
			latestVersion: info.version,
		});
	});

	// ─── IPC: Restart & Install ───────────────────────────────────────────────
	if (!isListenerRegistered) {
		isListenerRegistered = true;
		ipcMain.on("restart-and-install", () => {
			autoUpdater.quitAndInstall();
		});
	}

	// ─── Initial Check + Hourly Poll ─────────────────────────────────────────
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

module.exports = { setupUpdater };
