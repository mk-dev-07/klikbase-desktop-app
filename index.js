const {
	app,
	BrowserWindow,
	ipcMain,
	desktopCapturer,
	powerMonitor,
	screen,
	systemPreferences,
	Notification,
} = require("electron");
const path = require("path");

let mainWindow;
let idleInterval;
let isUserCurrentlyIdle = false;

const isDev = !app.isPackaged;

// ─── Window Creation ──────────────────────────────────────────────────────────
function createWindow() {
	mainWindow = new BrowserWindow({
		width: 950,
		height: 750,
		minWidth: 400,
		minHeight: 600,
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
		},
		autoHideMenuBar: true,
	});

	// Open DevTools in development only
	if (isDev) mainWindow.webContents.openDevTools();

	// Load Vite dev server in dev, built files in production
	if (isDev) {
		mainWindow.loadURL("http://localhost:5173");
	} else {
		mainWindow.loadFile(path.join(__dirname, "dist", "index.html"));
	}

	mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
		console.error(`❌ Failed to load: ${validatedURL} | ${errorDescription}`);
	});

	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
function cleanup() {
	if (idleInterval) {
		clearInterval(idleInterval);
		idleInterval = null;
	}
}

// ─── App Ready ───────────────────────────────────────────────────────────────
app.setName("Klikbase");

app.whenReady().then(() => {
	createWindow();

	// ─── Screenshot Handler ───────────────────────────────────────────────────
	ipcMain.handle("take-screenshot", async () => {
		try {
			// ─── Linux Wayland Guard ──────────────────────────────────────────────
			if (process.platform === "linux") {
				const isWayland = process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland";
				if (isWayland) {
					throw new Error("Silent screenshots are not supported on Wayland.");
				}
			}

			// ─── macOS Permission Checks ──────────────────────────────────────────
			if (process.platform === "darwin") {
				const screenStatus = systemPreferences.getMediaAccessStatus("screen");
				if (screenStatus !== "granted") {
					throw new Error("macOS Screen Recording permission denied.");
				}
				if (!systemPreferences.isTrustedAccessibilityClient(false)) {
					console.warn("⚠️ macOS Accessibility permission missing. Active window data may fail.");
				}
			}

			const sources = await desktopCapturer.getSources({
				types: ["screen"],
				thumbnailSize: { width: 1920, height: 1080 },
			});

			const primaryDisplayId = screen.getPrimaryDisplay().id.toString();
			const primarySource = sources.find((s) => s.display_id === primaryDisplayId) || sources[0];

			if (!primarySource) throw new Error("Could not find primary screen source.");

			const base64Image = primarySource.thumbnail.toDataURL();
			const { default: activeWin } = await import("active-win");
			const activeWindowData = await activeWin();

			return {
				success: true,
				image: base64Image,
				activeWindow: activeWindowData?.title || "Unknown Window",
				windowApp: activeWindowData?.owner?.name || "Unknown App",
			};
		} catch (error) {
			console.error("❌ Screenshot capture failed:", error);
			return { success: false, error: error.message };
		}
	});

	// ─── Idle Time Handler ────────────────────────────────────────────────────
	ipcMain.handle("get-idle-time", () => {
		return powerMonitor.getSystemIdleTime();
	});

	// ─── Notification Handler ─────────────────────────────────────────────────
	ipcMain.on("show-notification", (event, { title, body }) => {
		if (!Notification.isSupported()) {
			console.warn("❌ Notifications not supported on this system.");
			return;
		}
		try {
			new Notification({ title, body }).show();
		} catch (err) {
			console.error("❌ Notification failed:", err);
		}
	});

	// ─── Break Event Handler ──────────────────────────────────────────────────
	ipcMain.on("break-event", (event, data) => {
		console.log(`🔔 Break event: ${data.action}${data.breakType ? ` (${data.breakType})` : ""}`);
	});

	// ─── System Events → Idle Break ───────────────────────────────────────────
	powerMonitor.on("suspend", () => {
		console.log("💤 System suspended.");
		if (mainWindow) mainWindow.webContents.send("idle-break-started");
	});

	powerMonitor.on("lock-screen", () => {
		console.log("🔒 Screen locked.");
		if (mainWindow) mainWindow.webContents.send("idle-break-started");
	});

	// ─── Idle Polling ─────────────────────────────────────────────────────────
	idleInterval = setInterval(() => {
		const idleTimeSeconds = powerMonitor.getSystemIdleTime();

		if (idleTimeSeconds >= 300) {
			if (!isUserCurrentlyIdle) {
				isUserCurrentlyIdle = true;
				console.log("🎯 User idle 5+ mins. Triggering break...");
				if (mainWindow) mainWindow.webContents.send("idle-break-started");
			}
		} else {
			if (isUserCurrentlyIdle) {
				isUserCurrentlyIdle = false;
				console.log("👋 User returned from idle.");
				if (mainWindow) mainWindow.webContents.send("system-active-again");
			}
		}
	}, 5000);

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

// ─── Quit ─────────────────────────────────────────────────────────────────────
app.on("window-all-closed", () => {
	cleanup();
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
	cleanup();
});
