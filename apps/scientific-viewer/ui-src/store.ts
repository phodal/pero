import type { Asset } from './files';
const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('pero-scientific-files', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
export async function files(): Promise<Asset[]> {
  const db = await open();
  try { return await new Promise((resolve, reject) => { const request = db.transaction('files').objectStore('files').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  finally { db.close(); }
}
export async function saveFile(asset: Asset) {
  const db = await open();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite'), store = tx.objectStore('files');
    const request = store.getAll();
    request.onsuccess = () => { if (request.result.reduce((sum, item) => sum + item.size, 0) + asset.size > 50 * 1024 * 1024) tx.abort(); else store.put(asset); };
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error('Could not save file; local library limit is 50 MiB'));
  }); } finally { db.close(); }
}
export async function removeFile(id: string) {
  const db = await open();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); } finally { db.close(); }
}
