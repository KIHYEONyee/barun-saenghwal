// 화면(렌더러)과 본체 사이 통로. 화면은 window.barun 으로만 본체와 통신한다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('barun', {
  invoke: (ch, ...args) => ipcRenderer.invoke(ch, ...args),
  send: (ch, ...args) => ipcRenderer.send(ch, ...args),
  on: (ch, fn) => { const h = (e, ...args) => fn(...args); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); },
});
