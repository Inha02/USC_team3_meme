const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("memeCam", {
  createMeme: (payload) => ipcRenderer.invoke("meme:create", payload),
  regenerateMeme: () => ipcRenderer.invoke("meme:regenerate"),
  downloadMeme: () => ipcRenderer.invoke("meme:download"),
  closeResult: () => ipcRenderer.send("result:close"),
  moveFloatingWindow: (delta) => ipcRenderer.send("floating:move", delta),
  logExpression: (payload) => ipcRenderer.send("expression:log", payload),
  getLatestMeme: () => ipcRenderer.invoke("meme:get-latest"),
  onMemeUpdated: (callback) => {
    const listener = (_event, meme) => callback(meme);
    ipcRenderer.on("meme:updated", listener);
    return () => ipcRenderer.removeListener("meme:updated", listener);
  }
});
