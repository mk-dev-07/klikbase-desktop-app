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
// const { setupUpdater } = require("./updater");

let mainWindow;
let idleInterval;
let isUserCurrentlyIdle = false;

const isDev = !app.isPackaged;

// ─── Window Creation ──────────────────────────────────────────────────────────
function createWindow() {
	const primaryDisplay = screen.getPrimaryDisplay();
	const { x, y } = primaryDisplay.workArea;

	mainWindow = new BrowserWindow({
		x: x,
		y: y,
		width: 1920,
		height: 1012,
		minWidth: 690,
		minHeight: 600,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
		},
		autoHideMenuBar: true,
		icon: path.join(__dirname, "build", "icon.png"),
	});

	mainWindow.once("ready-to-show", () => {
		mainWindow.show();
		mainWindow.maximize();
	});

	if (isDev) mainWindow.webContents.openDevTools();

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

const hasLock = isDev ? true : app.requestSingleInstanceLock();

if (!hasLock) {
	app.exit(0);
} else {
	app.on("second-instance", (event, commandLine, workingDirectory) => {
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.focus();
		}
	});

	app.setName("Klikbase");

	app.whenReady().then(() => {
		createWindow();

		// ─── Update Handler ───────────────────────────────────────────────────────
		// mainWindow.webContents.on("did-finish-load", () => {
		// 	setupUpdater(mainWindow);
		// });

		// ─── Screenshot Handler ───────────────────────────────────────────────────
		ipcMain.handle("take-screenshot", async () => {
			try {
				// ─── Linux Wayland Guard ──────────────────────────────────────────────
				if (process.platform === "linux") {
					const isWayland =
						process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland";
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
						console.warn(
							"⚠️ macOS Accessibility permission missing. Active window data may fail.",
						);
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
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.send("idle-break-started");
			}
		});

		powerMonitor.on("lock-screen", () => {
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.send("idle-break-started");
			}
		});

		// ─── Idle Polling ─────────────────────────────────────────────────────────
		idleInterval = setInterval(() => {
			const idleTimeSeconds = powerMonitor.getSystemIdleTime();

			if (idleTimeSeconds >= 300) {
				if (!isUserCurrentlyIdle) {
					isUserCurrentlyIdle = true;
					if (mainWindow && !mainWindow.isDestroyed()) {
						mainWindow.webContents.send("idle-break-started");
					}
				}
			} else {
				if (isUserCurrentlyIdle) {
					isUserCurrentlyIdle = false;
					if (mainWindow && !mainWindow.isDestroyed()) {
						mainWindow.webContents.send("system-active-again");
					}
				}
			}
		}, 5000);

		ipcMain.handle("open-google-auth-window", async (event, authUrl) => {
			return new Promise((resolve) => {
				let isResolved = false;

				const authWindow = new BrowserWindow({
					width: 500,
					height: 650,
					show: true,
					alwaysOnTop: true,
					webPreferences: {
						nodeIntegration: false,
						contextIsolation: true,
					},
				});

				authWindow.loadURL(authUrl);

				const handleNavigation = (url) => {
					try {
						const parsedUrl = new URL(url);

						if (parsedUrl.searchParams.has("token")) {
							if (!isResolved) {
								isResolved = true;
								resolve({ token: parsedUrl.searchParams.get("token") });
								authWindow.close();
							}
						} else if (parsedUrl.searchParams.has("error")) {
							if (!isResolved) {
								isResolved = true;
								const errorMsg =
									parsedUrl.searchParams.get("message") || "Authentication failed";
								resolve({ error: errorMsg });
								authWindow.close();
							}
						}
					} catch (err) {}
				};

				authWindow.webContents.on("will-redirect", (event, url) => {
					handleNavigation(url);
				});

				authWindow.webContents.on("did-navigate", (event, url) => {
					handleNavigation(url);
				});

				authWindow.on("closed", () => {
					if (!isResolved) {
						isResolved = true;
						resolve({ error: "Login window was closed by the user." });
					}
				});
			});
		});

		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	});
}

// ─── Quit ─────────────────────────────────────────────────────────────────────
app.on("window-all-closed", () => {
	cleanup();
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
	cleanup();
});
