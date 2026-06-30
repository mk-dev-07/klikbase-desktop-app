const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
	/* ---------------------------- Screenshot & Idle --------------------------- */
	takeScreenshot: () => ipcRenderer.invoke("take-screenshot"),
	getIdleTime: () => ipcRenderer.invoke("get-idle-time"),
	sendBreakEvent: (data) => ipcRenderer.send("break-event", data),

	showNotification: (title, body) => ipcRenderer.send("show-notification", { title, body }),

	onIdleBreakStarted: (callback) => {
		const listener = () => callback();
		ipcRenderer.on("idle-break-started", listener);
		return () => ipcRenderer.removeListener("idle-break-started", listener);
	},

	onSystemActive: (callback) => {
		const listener = () => callback();
		ipcRenderer.on("system-active-again", listener);
		return () => ipcRenderer.removeListener("system-active-again", listener);
	},

	/* ------------------------------- Google Auth ------------------------------ */
	openGoogleAuthWindow: (authUrl) => ipcRenderer.invoke("open-google-auth-window", authUrl),

	/* ------------------------------- Auto update ------------------------------ */
	// onUpdateAvailable: (cb) => ipcRenderer.on("update-available", (_, data) => cb(data)),
	// onUpdateDownloaded: (cb) => ipcRenderer.on("update-downloaded", () => cb()),
	// restartAndInstall: () => ipcRenderer.send("restart-and-install"),
	// onUpdateError: (cb) => ipcRenderer.on("update-error", (_, data) => cb(data)),
	// onUpdateProgress: (cb) => ipcRenderer.on("update-download-progress", (_, data) => cb(data)),
});
