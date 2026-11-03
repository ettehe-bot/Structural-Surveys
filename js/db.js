/* Minimal promise wrapper around IndexedDB.
   Stores:
     surveys  - keyPath RecordKey, one object per survey (Access column names as keys)
     files    - keyPath fileId (auto), index by RecordKey; photos and sketches as Blobs
     settings - keyPath key */
window.SurveyDB = (function () {
  const DB_NAME = "structural-survey";
  const DB_VERSION = 1;
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains("surveys")) {
          const s = d.createObjectStore("surveys", { keyPath: "RecordKey" });
          s.createIndex("SurveyDate", "SurveyDate");
          s.createIndex("SurveyStatus", "SurveyStatus");
        }
        if (!d.objectStoreNames.contains("files")) {
          const f = d.createObjectStore("files", { keyPath: "fileId", autoIncrement: true });
          f.createIndex("RecordKey", "RecordKey");
        }
        if (!d.objectStoreNames.contains("settings")) {
          d.createObjectStore("settings", { keyPath: "key" });
        }
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      try { result = fn(s); } catch (err) { reject(err); return; }
      t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  function reqToPromise(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  return {
    open,
    // surveys
    putSurvey: (s) => tx("surveys", "readwrite", (st) => st.put(s)),
    getSurvey: (key) => reqToPromise("surveys", "readonly", (st) => st.get(key)),
    allSurveys: () => reqToPromise("surveys", "readonly", (st) => st.getAll()),
    deleteSurvey: (key) => tx("surveys", "readwrite", (st) => st.delete(key)),
    // files
    putFile: (f) => reqToPromise("files", "readwrite", (st) => st.put(f)),
    getFile: (id) => reqToPromise("files", "readonly", (st) => st.get(id)),
    filesFor: (key) => reqToPromise("files", "readonly", (st) => st.index("RecordKey").getAll(key)),
    allFiles: () => reqToPromise("files", "readonly", (st) => st.getAll()),
    deleteFile: (id) => tx("files", "readwrite", (st) => st.delete(id)),
    deleteFilesFor: async function (key) {
      const list = await this.filesFor(key);
      for (const f of list) await this.deleteFile(f.fileId);
    },
    // settings
    getSetting: async (key, fallback) => {
      const r = await reqToPromise("settings", "readonly", (st) => st.get(key));
      return r ? r.value : fallback;
    },
    setSetting: (key, value) => tx("settings", "readwrite", (st) => st.put({ key, value }))
  };
})();
