const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
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
});
