const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
	/* ---------------------------- Screenshot & Idle --------------------------- */
	takeScreenshot: () => ipcRenderer.invoke("take-screenshot"),
	getIdleTime: () => ipcRenderer.invoke("get-idle-time"),
	sendBreakEvent: (data) => ipcRenderer.send("break-event", data),

	showNotification: (title, body) => ipcRenderer.send("show-notification", title, body),

	onIdleBreakStarted: (callback) => {
		const listener = (_, data) => callback(data);
		ipcRenderer.on("idle-break-started", listener);
		return () => ipcRenderer.removeListener("idle-break-started", listener);
	},

	onSystemActive: (callback) => {
		const listener = (_, data) => callback(data);
		ipcRenderer.on("system-active-again", listener);
		return () => ipcRenderer.removeListener("system-active-again", listener);
	},

	/* ----------------------- Permission Denied Listeners ---------------------- */
	onNotificationPermissionDenied: (callback) => {
		const listener = (_, data) => callback(data);
		ipcRenderer.on("notification-permission-denied", listener);
		return () => ipcRenderer.removeListener("notification-permission-denied", listener);
	},

	/* ------------------------------- Google Auth ------------------------------ */
	openGoogleAuthWindow: (authUrl) => ipcRenderer.invoke("open-google-auth-window", authUrl),

	/* ------------------------------- Auto update ------------------------------ */
	getAppVersion: () => ipcRenderer.invoke("get-app-version"),

	onUpdateAvailable: (cb) => {
		const listener = (_, data) => cb(data);
		ipcRenderer.on("update-available", listener);
		return () => ipcRenderer.removeListener("update-available", listener);
	},

	onUpdateAvailable: (cb) => {
		const listener = (_, data) => cb(data);
		ipcRenderer.on("update-available", listener);
		return () => ipcRenderer.removeListener("update-available", listener);
	},
	onUpdateDownloaded: (cb) => {
		const listener = () => cb();
		ipcRenderer.on("update-downloaded", listener);
		return () => ipcRenderer.removeListener("update-downloaded", listener);
	},
	restartAndInstall: () => ipcRenderer.send("restart-and-install"),
	onUpdateError: (cb) => {
		const listener = (_, data) => cb(data);
		ipcRenderer.on("update-error", listener);
		return () => ipcRenderer.removeListener("update-error", listener);
	},
	onUpdateProgress: (cb) => {
		const listener = (_, data) => cb(data);
		ipcRenderer.on("update-download-progress", listener);
		return () => ipcRenderer.removeListener("update-download-progress", listener);
	},
});
