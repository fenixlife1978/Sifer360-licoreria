const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('posDesktop', {
  loadState: () => ipcRenderer.invoke('posdb:load-state'),
  saveState: state => ipcRenderer.invoke('posdb:save-state', state),
  listDocuments: filter => ipcRenderer.invoke('posdb:list-documents', filter),
  saveDocument: doc => ipcRenderer.invoke('posdb:save-document', doc),
  getDocument: id => ipcRenderer.invoke('posdb:get-document', id),
  deleteDocument: id => ipcRenderer.invoke('posdb:delete-document', id),
  networkStatus: () => ipcRenderer.invoke('network:status'),
  networkDiscover: () => ipcRenderer.invoke('network:discover'),
  networkCreateOperation: operation => ipcRenderer.invoke('network:operation-create', operation),
  networkPendingOperations: () => ipcRenderer.invoke('network:operation-pending'),
  networkOperationStatus: () => ipcRenderer.invoke('network:operation-status'),
  networkStartServer: options => ipcRenderer.invoke('network:configure-server', options),
  networkStopServer: () => ipcRenderer.invoke('network:stop-server'),
  networkConfigureClient: options => ipcRenderer.invoke('network:configure-client', options),
  networkSyncNow: state => ipcRenderer.invoke('network:sync-now', state)
});
