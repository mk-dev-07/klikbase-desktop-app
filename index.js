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
const { setupUpdater } = require("./updater");

let mainWindow;
let idleInterval;
let isUserCurrentlyIdle = false;
const isDev = !app.isPackaged;

function sendToMainWindow(channel, data) {
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.webContents.send(channel, data);
	}
}

function createWindow() {
	const primaryDisplay = screen.getPrimaryDisplay();
	const { x, y } = primaryDisplay.workArea;
	mainWindow = new BrowserWindow({
		x,
		y,
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

		mainWindow.webContents.on("did-finish-load", () => {
			try {
				setupUpdater();
			} catch (updaterError) {
				console.error("⚠️ Non-fatal auto-updater initialization check failed:", updaterError);
			}
		});

		// ─── App Version Handler ─────────────────────────────────────────────────
		ipcMain.handle("get-app-version", () => {
			return app.getVersion();
		});

		// ─── Download File Handler ───────────────────────────────────────────────
		ipcMain.on("download-file", (event, url) => {
			const win = BrowserWindow.fromWebContents(event.sender);
			if (win) win.webContents.downloadURL(url);
		});

		// ─── Screenshot Handler with Permission Detection ─────────────────────────
		ipcMain.handle("take-screenshot", async () => {
			try {
				if (process.platform === "linux") {
					const isWayland =
						process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland";
					if (isWayland) {
						return {
							success: false,
							errorType: "system_limit",
							message: "Screenshots are not supported on Wayland.",
						};
					}
				}

				if (process.platform === "darwin") {
					const screenStatus = systemPreferences.getMediaAccessStatus("screen");
					if (screenStatus !== "granted") {
						return {
							success: false,
							errorType: "permission_denied",
							message: "Screen recording permission denied.",
						};
					}
					if (!systemPreferences.isTrustedAccessibilityClient(false)) {
						console.warn("⚠️ macOS Accessibility permission missing.");
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

		// ─── Notification Handler (Fixed Mismatched Arguments & Callbacks) ──────────
		ipcMain.on("show-notification", (event, title, body) => {
			// Check if OS environment supports core notifications
			if (!Notification.isSupported()) {
				sendToMainWindow("notification-permission-denied", {
					message: "System native alerts are unsupported on this platform environment.",
				});
				return;
			}

			try {
				const notification = new Notification({ title, body });

				// Optional: Handle system block scenarios if platform exposes them on creation failure
				notification.show();
			} catch (err) {
				console.error("❌ Notification failed:", err);
				sendToMainWindow("notification-permission-denied", {
					message: "System notification failed to display. Check app permissions.",
				});
			}
		});

		// ─── Idle Time Handler ───────────────────────────────────────────────────────
		ipcMain.handle("get-idle-time", () => {
			return powerMonitor.getSystemIdleTime();
		});

		// ─── Break Event Handler ─────────────────────────────────────────────────────
		ipcMain.on("break-event", (event, data) => {
			console.log(`🔔 Break event: ${data.action}`);
		});

		// ─── System Events → Idle Break ─────────────────────────────────────────────
		powerMonitor.on("suspend", () => {
			sendToMainWindow("idle-break-started");
		});
		powerMonitor.on("lock-screen", () => {
			sendToMainWindow("idle-break-started");
		});

		// ─── Idle Polling ───────────────────────────────────────────────────────────
		idleInterval = setInterval(() => {
			const idleTimeSeconds = powerMonitor.getSystemIdleTime();
			if (idleTimeSeconds >= 300) {
				if (!isUserCurrentlyIdle) {
					isUserCurrentlyIdle = true;
					sendToMainWindow("idle-break-started");
				}
			} else {
				if (isUserCurrentlyIdle) {
					isUserCurrentlyIdle = false;
					sendToMainWindow("system-active-again");
				}
			}
		}, 5000);

		// ─── Google OAuth Window Handler (Fixed parsedUrl Reference Typo) ───────────
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
								resolve({ token: parsedUrl.searchParams.get("token") }); // FIXED TYPO HERE
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

// Cleanup
app.on("window-all-closed", () => {
	cleanup();
	if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
	cleanup();
});
