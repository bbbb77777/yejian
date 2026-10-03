// IndexedDB is persisted in Electron's application profile, including PDF blobs.
const ready = new Promise((resolve, reject) => {
 const request = indexedDB.open('yejian-library', 1);
 request.onupgradeneeded = () => request.result.createObjectStore('books', {keyPath:'id'});
 request.onsuccess = () => resolve(request.result);
 request.onerror = () => reject(request.error);
});
async function transaction(mode, action) {
 const db = await ready;
 return new Promise((resolve,reject) => {
  const tx=db.transaction('books',mode);const request=action(tx.objectStore('books'));
  tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });
}
export const listBooks = () => transaction('readonly',s=>s.getAll());
export const getBook = id => transaction('readonly',s=>s.get(id));
export const putBook = book => transaction('readwrite',s=>s.put(book));
export async function patchBook(id, fields) {
 const db=await ready;
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('books','readwrite');const store=tx.objectStore('books');const read=store.get(id);
  read.onsuccess=()=>{if(read.result)store.put({...read.result,...fields});};
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });
}
