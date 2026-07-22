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

	onUpdateProgress: (cb) => {
		const listener = (_, data) => cb(data);
		ipcRenderer.on("update-download-progress", listener);
		return () => ipcRenderer.removeListener("update-download-progress", listener);
	},

	onUpdateDownloaded: (cb) => {
		const listener = (_, data) => cb(data);
		ipcRenderer.on("update-download-Downloaded", listener);
		ipcRenderer.on("update-downloaded", listener);
		return () => ipcRenderer.removeListener("update-downloaded", listener);
	},

	onUpdateError: (cb) => {
		const listener = (_, data) => cb(data);
		ipcRenderer.on("update-error", listener);
		return () => ipcRenderer.removeListener("update-error", listener);
	},

	restartAndInstall: () => ipcRenderer.send("restart-and-install"),
	startDownload: () => ipcRenderer.send("start-download"),

	/* ------------ bypass firebase cors issue for downloading image ------------ */
	downloadFile: (url) => ipcRenderer.send("download-file", url),

	/* -------------------- update the app when user opens it ------------------- */
	onAppFocused: (callback) => {
		const listener = () => callback();
		ipcRenderer.on("app-focused", listener);
		return () => ipcRenderer.removeListener("app-focused", listener);
	},
});
