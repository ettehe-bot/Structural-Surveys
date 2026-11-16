/* Google Drive: sign-in (Google Identity Services), folder picker (Google Picker) and resumable upload.
   Direct upload works only when SURVEY_CONFIG.googleDrive holds a client ID, API key and project number
   (README: "Set up direct upload to Google Drive"). These three values are public by design: Google
   limits them to the app's own web address, so they can sit in the public code.
   The app asks only for the drive.file permission: it can see the folder the surveyor picks and the
   files it uploads itself, nothing else in their Drive. */
window.SurveyDrive = (function () {
  "use strict";
  const G = (window.SURVEY_CONFIG && window.SURVEY_CONFIG.googleDrive) || {};
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const GIS = "https://accounts.google.com/gsi/client";
  const GAPI = "https://apis.google.com/js/api.js";
  const FOLDER_MIME = "application/vnd.google-apps.folder";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name";
  const scripts = {};
  let tokenClient = null, token = null, tokenExp = 0, pending = null;

  const configured = () => !!(G.clientId && G.apiKey && G.appId);

  function loadScript(src) {
    if (!scripts[src]) scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.async = true; s.onload = resolve;
      s.onerror = () => { delete scripts[src]; s.remove(); reject(new Error("Google sign-in could not be loaded - check the connection")); };
      document.head.appendChild(s);
    });
    return scripts[src];
  }
  // Load the sign-in library early, so the sign-in window can open straight from the Export tap
  function preload() { if (configured() && navigator.onLine) loadScript(GIS).catch(() => {}); }

  function initClient() {
    if (tokenClient) return;
    const settle = (fn) => { const p = pending; pending = null; if (p) fn(p); };
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: G.clientId, scope: SCOPE,
      callback: (r) => settle((p) => {
        if (r.error) { p.reject(new Error(r.error_description || r.error)); return; }
        token = r.access_token; tokenExp = Date.now() + (Number(r.expires_in) || 3600) * 1000; p.resolve(token);
      }),
      error_callback: (e) => settle((p) => p.reject(new Error(
        e && e.type === "popup_closed" ? "Google sign-in was closed before it finished"
          : e && e.type === "popup_failed_to_open" ? "The Google sign-in window was blocked"
            : "Google sign-in failed")))
    });
  }

  // Call this straight from a tap: browsers only allow the sign-in window to open then.
  // After the first consent the window closes by itself; the token lasts about an hour.
  async function getToken() {
    if (token && Date.now() < tokenExp - 60000) return token;
    if (!configured()) throw new Error("Direct upload to Google Drive is not set up in this version of the app");
    if (!navigator.onLine) throw new Error("No connection");
    if (!(window.google && google.accounts && google.accounts.oauth2)) await loadScript(GIS);
    initClient();
    return new Promise((resolve, reject) => {
      if (pending) pending.reject(new Error("Sign-in started again"));
      pending = { resolve, reject };
      tokenClient.requestAccessToken({ prompt: "" });
    });
  }

  // Opens Google's folder picker. Picking a folder is what gives the app permission to upload into it.
  // preferFolder: {id, name} offered as the first tab, so the usual folder is one tap away
  async function pickFolder(preferFolder) {
    const t = await getToken();
    await loadScript(GAPI);
    await new Promise((resolve, reject) => window.gapi.load("picker", { callback: resolve, onerror: () => reject(new Error("The folder picker could not be loaded")) }));
    const P = google.picker;
    const view = (fn) => fn(new P.DocsView(P.ViewId.FOLDERS)).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME);
    const builder = new P.PickerBuilder();
    if (preferFolder && preferFolder.id && typeof P.DocsView.prototype.setFileIds === "function") {
      builder.addView(view((v) => v.setFileIds(preferFolder.id)).setLabel(preferFolder.name || "Export folder"));
    }
    return new Promise((resolve) => {
      builder
        .setTitle("Choose the folder for the daily exports")
        .addView(view((v) => v.setOwnedByMe(true)).setLabel("My Drive"))
        .addView(view((v) => v.setOwnedByMe(false)).setLabel("Shared with me"))
        .addView(view((v) => v.setEnableDrives(true)).setLabel("Shared drives"))
        .enableFeature(P.Feature.SUPPORT_DRIVES)
        .setOAuthToken(t).setDeveloperKey(G.apiKey).setAppId(G.appId)
        .setCallback((d) => {
          if (d.action === P.Action.PICKED && d.docs && d.docs[0]) resolve({ id: d.docs[0].id, name: d.docs[0].name || "" });
          else if (d.action === P.Action.CANCEL) resolve(null);
        })
        .build().setVisible(true);
    });
  }

  async function driveError(resp) {
    let msg = "";
    try { const j = await resp.json(); msg = (j.error && j.error.message) || ""; } catch (e) { /* not JSON */ }
    if (resp.status === 401) { token = null; return new Error("Google sign-in expired - try again"); }
    if (resp.status === 404) return new Error("Google hasn't let the app into the folder yet. In Settings, tap Connect to Google Drive and choose the folder.");
    if (resp.status === 403) return new Error("Google Drive refused the upload" + (msg ? `: ${msg}` : " - check you can add files to the folder"));
    return new Error(`Google Drive error ${resp.status}${msg ? `: ${msg}` : ""}`);
  }

  // Resumable upload, so large packages with many photos go through; onProgress gets 0..1
  async function upload(blob, name, folderId, onProgress) {
    const t = await getToken();
    const start = await fetch(UPLOAD, {
      method: "POST",
      headers: { Authorization: "Bearer " + t, "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "application/zip", "X-Upload-Content-Length": String(blob.size) },
      body: JSON.stringify({ name, mimeType: "application/zip", parents: [folderId] })
    });
    if (!start.ok) throw await driveError(start);
    const session = start.headers.get("Location");
    if (!session) throw new Error("Google Drive did not start the upload");
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("PUT", session);
      x.setRequestHeader("Content-Type", "application/zip");
      x.upload.onprogress = (e) => { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onload = async () => {
        if (x.status >= 200 && x.status < 300) { try { resolve(JSON.parse(x.responseText || "{}")); } catch (e) { resolve({}); } }
        else reject(await driveError(new Response(x.responseText, { status: x.status })));
      };
      x.onerror = () => reject(new Error("The upload was interrupted - check the connection"));
      x.send(blob);
    });
  }

  // Folder ID from a Google Drive folder link, or "" if it isn't one
  function folderIdFromLink(v) {
    try {
      const u = new URL(String(v || "").trim());
      if (u.protocol !== "https:" || u.hostname !== "drive.google.com") return "";
      const m = u.pathname.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
      if (m) return m[1];
      const id = u.searchParams.get("id") || "";
      return /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : "";
    } catch (e) { return ""; }
  }
  const folderUrl = (id) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
  // The export folder set in config.js, or null
  const defaultFolder = () => (G.defaultFolder && G.defaultFolder.id ? { id: String(G.defaultFolder.id), name: String(G.defaultFolder.name || "") } : null);

  return { configured, preload, getToken, pickFolder, upload, folderIdFromLink, folderUrl, defaultFolder };
})();
