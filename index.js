const {
	app,
	BrowserWindow,
	ipcMain,
	desktopCapturer,
	powerMonitor,
	screen,
	systemPreferences,
	Notification,
	Tray,
	nativeImage,
	Menu,
} = require("electron");
const path = require("path");
const { setupUpdater } = require("./updater");

let mainWindow;
let idleInterval;
let tray = null;
let isUserCurrentlyIdle = false;
let isQuitting = false;
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
			backgroundThrottling: false,
		},
		autoHideMenuBar: true,
		icon: path.join(__dirname, "build", "icon.png"),
	});

	mainWindow.once("ready-to-show", () => {
		mainWindow.maximize();
		mainWindow.show();
	});

	mainWindow.on("focus", () => sendToMainWindow("app-focused"));
	mainWindow.on("restore", () => sendToMainWindow("app-focused"));

	// ─── 2. Intercept Close Event (The Linux "Kill Switch" Logic) ─────────────
	mainWindow.on("close", (event) => {
		if (isQuitting) return;

		if (process.platform !== "linux") {
			event.preventDefault();
			mainWindow.hide();
		}
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

function startIdlePolling() {
	if (idleInterval) return;

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
}

function cleanup() {
	if (idleInterval) {
		clearInterval(idleInterval);
		idleInterval = null;
	}
}

// ─── Linux Render Settings (X11 vs Wayland) ──────────────────────────────────
if (process.platform === "linux") {
	const isWayland = process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland";
	if (isWayland) {
		app.disableHardwareAcceleration();
		app.commandLine.appendSwitch("enable-features", "UseOzonePlatform");
		app.commandLine.appendSwitch("ozone-platform", "wayland");
	}
}

const hasLock = isDev ? true : app.requestSingleInstanceLock();

if (!hasLock) {
	app.exit(0);
} else {
	app.on("second-instance", (event, commandLine, workingDirectory) => {
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.show();
			mainWindow.focus();
		} else {
			createWindow();
		}
	});

	app.setName("Klikbase");

	app.whenReady().then(() => {
		try {
			setupUpdater();
		} catch (updaterError) {
			console.error("⚠️ Non-fatal auto-updater initialization check failed:", updaterError);
		}

		app.setAppUserModelId("com.factiiv.klikbase");
		if (process.platform === "linux") {
			app.setDesktopName("klikbase-tracker.desktop");
		}

		createWindow();
		startIdlePolling();

		// ─── System Tray Setup ───────────────────────────────────────────────────
		const iconPath = path.join(__dirname, "build", "icon.png");
		const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

		if (process.platform === "darwin") {
			icon.setTemplateImage(true);
		}

		tray = new Tray(icon);
		tray.setToolTip("Klikbase Time Tracker");

		const contextMenu = Menu.buildFromTemplate([
			{
				label: "Open Klikbase",
				click: () => {
					if (mainWindow) {
						if (mainWindow.isMinimized()) mainWindow.restore();
						mainWindow.show();
						mainWindow.focus();
					} else {
						createWindow();
					}
				},
			},
			{ type: "separator" },
			{
				label: "Quit",
				click: () => {
					isQuitting = true;
					app.quit();
				},
			},
		]);
		tray.setContextMenu(contextMenu);

		tray.on("click", () => {
			if (mainWindow) {
				if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
					mainWindow.focus();
				} else {
					if (mainWindow.isMinimized()) mainWindow.restore();
					mainWindow.show();
					mainWindow.focus();
				}
			} else {
				createWindow();
			}
		});

		// ─── Tray Timer & Taskbar IPC Listener ────────────────────────────────────
		ipcMain.on("update-tray-timer", (event, { timeString, isBreak, isRunning }) => {
			// console.log(`⏱️ Tick: ${timeString} | Running: ${isRunning} | Break: ${isBreak}`);

			const iconPrefix = isBreak ? "☕ " : "⏱️ ";
			const label = isBreak ? "Break" : "Work";

			if (tray && !tray.isDestroyed()) {
				if (!isRunning) {
					if (process.platform === "darwin") tray.setTitle("");
					tray.setToolTip("Klikbase - Stopped");
				} else {
					if (process.platform === "darwin") {
						tray.setTitle(`${iconPrefix}${timeString}`);
					} else {
						tray.setToolTip(`Klikbase (${label}): ${timeString}`);
					}
				}
			}

			if (mainWindow && !mainWindow.isDestroyed()) {
				if (!isRunning) {
					mainWindow.setTitle("Klikbase");

					mainWindow.setProgressBar(-1);
				} else {
					mainWindow.setTitle(`${timeString} - ${label} | Klikbase`);

					mainWindow.setProgressBar(2, { mode: isBreak ? "paused" : "normal" });
				}
			}
		});

		// ─── Other IPC Handlers ──────────────────────────────────────────────────
		ipcMain.handle("get-app-version", () => app.getVersion());

		ipcMain.on("download-file", (event, url) => {
			const win = BrowserWindow.fromWebContents(event.sender);
			if (win) win.webContents.downloadURL(url);
		});

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

		ipcMain.on("show-notification", (event, title, body) => {
			if (!Notification.isSupported()) {
				sendToMainWindow("notification-permission-denied", {
					message: "System native alerts are unsupported on this platform environment.",
				});
				return;
			}
			try {
				const notification = new Notification({ title, body });
				notification.show();
			} catch (err) {
				console.error("❌ Notification failed:", err);
			}
		});

		ipcMain.handle("get-idle-time", () => powerMonitor.getSystemIdleTime());

		ipcMain.on("break-event", (event, data) => {
			console.log(`🔔 Break event: ${data.action}`);
		});

		powerMonitor.on("suspend", () => sendToMainWindow("idle-break-started"));
		powerMonitor.on("lock-screen", () => sendToMainWindow("idle-break-started"));

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

				authWindow.webContents.on("will-redirect", (event, url) => handleNavigation(url));
				authWindow.webContents.on("did-navigate", (event, url) => handleNavigation(url));
				authWindow.on("closed", () => {
					if (!isResolved) {
						isResolved = true;
						resolve({ error: "Login window was closed by the user." });
					}
				});
			});
		});

		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) {
				createWindow();
				startIdlePolling();
			}
		});
	});
}

// ─── Cleanup & App Quit Handlers ─────────────────────────────────────────────
app.on("window-all-closed", () => {
	cleanup();

	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
	isQuitting = true;
	cleanup();
});
