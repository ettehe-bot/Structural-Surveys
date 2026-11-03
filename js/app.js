/* Structural Survey Field App - main application logic */
(function () {
  "use strict";
  const C = window.SURVEY_CONFIG;
  const DB = window.SurveyDB;
  const EX = window.SurveyExport;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // ------------------------------------------------------------ state
  let map = null;
  let mapReady = false;
  let surveys = [];                 // all surveys on the device
  let current = null;               // survey being edited
  let currentFiles = [];            // files (photos + sketch) of the current survey
  let currentIsNew = false;
  let placing = false;
  let settings = { surveyorName: "", deviceName: "FIELD" };
  let installPrompt = null;
  const objectUrls = new Set();

  // ------------------------------------------------------------ helpers
  const pad2 = (n) => String(n).padStart(2, "0");
  const nowIso = () => new Date().toISOString();
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const stamp = (d) => { d = d || new Date(); return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`; };
  const cleanFileName = (s) => String(s || "").replace(/[\\/:*?"<>|]/g, "_");
  const safeDevice = () => (cleanFileName(settings.deviceName || "FIELD").replace(/\s+/g, "_").toUpperCase() || "FIELD");
  // Short, file-system-safe asset name for photo and sketch files (keeps Windows paths under 260 characters)
  const assetBase = () => (cleanFileName(($("#surveyForm").elements.ManholePitID.value || "").trim()).replace(/\s+/g, "_").slice(0, 30) || "asset");

  function newRecordKey() {
    const d = new Date();
    const s = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
    const ms = String(d.getTime() % 100000000).padStart(8, "0");
    const rnd = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
    return `${s}-${ms}-${safeDevice()}-${rnd}`;
  }

  let toastTimer = null;
  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg; t.classList.toggle("err", !!isError); t.classList.remove("hidden");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), isError ? 5000 : 2500);
  }

  function objUrl(blob) { const u = URL.createObjectURL(blob); objectUrls.add(u); return u; }
  function releaseUrls() { for (const u of objectUrls) URL.revokeObjectURL(u); objectUrls.clear(); }

  function fillSelect(sel, items, placeholder) {
    sel.innerHTML = "";
    const o = document.createElement("option"); o.value = ""; o.textContent = placeholder || "Select…"; sel.appendChild(o);
    for (const it of items) { const op = document.createElement("option"); op.value = it; op.textContent = it; sel.appendChild(op); }
  }

  // ------------------------------------------------------------ views
  function showView(name) {
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
    $$(".bottom-nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    if (name === "map" && map) setTimeout(() => map.resize(), 50);
    if (name === "list") renderList();
    if (name === "export") renderExportStats();
    if (name === "settings") renderStorage();
  }

  // ------------------------------------------------------------ map
  async function initMap() {
    const base = location.href.replace(/[^/]*$/, "");
    const glyphs = base + "fonts/{fontstack}/{range}.pbf";
    let sourceUrl = null;
    try {
      const resp = await fetch(C.basemapFile);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const buf = await resp.arrayBuffer();
      const file = new File([buf], "auh.pmtiles");
      const archive = new pmtiles.PMTiles(new pmtiles.FileSource(file));
      const protocol = new pmtiles.Protocol();
      maplibregl.addProtocol("pmtiles", protocol.tile);
      protocol.add(archive);
      sourceUrl = "pmtiles://auh.pmtiles";
    } catch (e) {
      console.error("Basemap unavailable", e);
      toast("Basemap could not be loaded - surveys still work", true);
    }

    const style = sourceUrl ? window.buildMapStyle(sourceUrl, glyphs) : { version: 8, glyphs, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#e9e9e9" } }] };
    const [w, s, e, n] = C.bbox;
    const pad = 0.08;
    map = new maplibregl.Map({
      container: "map", style, center: C.center, zoom: C.zoom,
      minZoom: C.minZoom, maxZoom: C.maxZoom,
      maxBounds: [[w - pad, s - pad], [e + pad, n + pad]],
      attributionControl: { compact: true }
    });
    window.SurveyApp = { map };   // handle for troubleshooting from the browser console
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

    map.on("load", () => {
      map.addSource("surveys", { type: "geojson", data: surveysGeoJson() });
      map.addLayer({ id: "survey-points", type: "circle", source: "surveys",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 5, 16, 9, 19, 12],
          "circle-color": ["case", ["==", ["get", "urgent"], "Yes"], "#c00000", ["==", ["get", "status"], "Complete"], "#00b050", "#349bd5"],
          "circle-stroke-color": "#ffffff", "circle-stroke-width": 2
        } });
      map.addLayer({ id: "survey-labels", type: "symbol", source: "surveys", minzoom: 15,
        layout: { "text-field": ["get", "id"], "text-font": ["Noto Sans Medium"], "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top", "text-allow-overlap": false },
        paint: { "text-color": "#1f2a52", "text-halo-color": "#fff", "text-halo-width": 1.5 } });
      map.on("mouseenter", "survey-points", () => map.getCanvas().style.cursor = "pointer");
      map.on("mouseleave", "survey-points", () => map.getCanvas().style.cursor = "");
      map.on("click", onMapClick);
      mapReady = true;
      // site plan first, so the utilities are drawn on top of it
      loadDrawingBase().catch((e) => console.warn("Basemap drawing not loaded", e))
        .then(loadOverlay).catch((e) => console.warn("Utilities not loaded", e))
        .then(loadNetworkIndex);
    });
    map.on("error", (e) => { if (e && e.error && !/glyph|font|pbf/i.test(String(e.error.message))) console.warn("map", e.error); });
  }

  function surveysGeoJson() {
    return { type: "FeatureCollection", features: surveys.filter((s) => isNum(s.Latitude) && isNum(s.Longitude)).map((s) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [Number(s.Longitude), Number(s.Latitude)] },
      properties: { key: s.RecordKey, id: s.ManholePitID || "(no ID)", status: s.SurveyStatus, urgent: s.UrgentRectificationRequired || "" }
    })) };
  }
  const isNum = (v) => v !== null && v !== undefined && v !== "" && !isNaN(Number(v));
  function updateMapData() { if (mapReady) map.getSource("surveys").setData(surveysGeoJson()); }

  // ------------------------------------------------------------ CAD site plan basemap (display only)
  const BASE_LAYERS = ["base-lines", "base-points", "base-texts"];

  async function loadDrawingBase() {
    if (!C.drawingBaseFile) return;
    let data;
    try {
      const resp = await fetch(C.drawingBaseFile);
      if (!resp.ok) return;                       // no site plan published
      data = await resp.json();
    } catch (e) { console.warn("Basemap drawing not loaded", e); return; }
    if (!data || !Array.isArray(data.features) || !data.features.length) return;

    map.addSource("drawingbase", { type: "geojson", data, maxzoom: 20, tolerance: 0.3 });
    const before = "survey-points";
    map.addLayer({ id: "base-lines", type: "line", source: "drawingbase", filter: ["==", ["get", "kind"], "line"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-opacity": 0.8, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.3, 16, 0.8, 19, 1.6] } }, before);
    map.addLayer({ id: "base-points", type: "circle", source: "drawingbase", minzoom: 16, filter: ["==", ["get", "kind"], "point"],
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 16, 0.8, 19, 2.5], "circle-color": ["get", "color"], "circle-opacity": 0.8 } }, before);
    map.addLayer({ id: "base-texts", type: "symbol", source: "drawingbase", minzoom: 15, filter: ["==", ["get", "kind"], "text"],
      layout: { "text-field": ["get", "text"], "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 15, 9, 19, 13], "text-max-width": 14 },
      paint: { "text-color": ["get", "color"], "text-halo-color": "#ffffff", "text-halo-width": 1.5 } }, before);

    $("#btnBase").classList.remove("hidden");
    setBaseVisible(await DB.getSetting("baseVisible", true));
  }

  function setBaseVisible(on) {
    for (const id of BASE_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    const b = $("#btnBase"); b.setAttribute("aria-pressed", on ? "true" : "false"); b.textContent = on ? "Basemap: on" : "Basemap: off";
    $("#chkBase").checked = on;
  }

  // ------------------------------------------------------------ utility networks (one CAD drawing each)
  let networks = [];                 // entries from data/utilities/index.json
  const networkOn = new Set();       // ids switched on
  const networkLoaded = new Set();   // ids whose data is on the map (loaded on first use)
  const netLayerIds = (n) => [`net-${n.id}-lines`, `net-${n.id}-texts`, `net-${n.id}-assets`, `net-${n.id}-labels`];
  const isVisible = (id) => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none";

  async function loadNetworkIndex() {
    if (!C.networksIndex) return;
    try {
      const resp = await fetch(C.networksIndex);
      if (!resp.ok) return;
      const j = await resp.json();
      networks = Array.isArray(j.layers) ? j.layers.filter((n) => n && n.id && n.file) : [];
    } catch (e) { console.warn("Utility networks not loaded", e); return; }
    if (!networks.length) return;
    renderNetworkList();
    $("#btnLayers").classList.remove("hidden");
    const saved = await DB.getSetting("networksOn", []);
    for (const id of saved || []) if (networks.some((n) => n.id === id)) await setNetworkVisible(id, true, false);
    updateLayersButton();
  }

  function renderNetworkList() {
    const box = $("#networkList"); box.innerHTML = "";
    for (const n of networks) {
      const row = document.createElement("label"); row.className = "layer-row";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.dataset.net = n.id;
      cb.addEventListener("change", () => setNetworkVisible(n.id, cb.checked));
      const sw = document.createElement("i"); sw.className = "swatch"; sw.style.setProperty("--c", n.color);
      const name = document.createElement("span"); name.textContent = n.name;
      if (n.assets) { const sm = document.createElement("small"); sm.textContent = `${n.assets} assets`; name.appendChild(sm); }
      row.append(cb, sw, name); box.appendChild(row);
    }
  }

  async function addNetworkLayers(n) {
    const resp = await fetch(n.file);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    const src = `net-${n.id}`, c = n.color;
    map.addSource(src, { type: "geojson", data, maxzoom: 20, tolerance: 0.25 });
    // networks sit above the site plan and below the master-plan utilities and the survey pins
    const before = map.getLayer("overlay-lines") ? "overlay-lines" : "survey-points";
    map.addLayer({ id: `net-${n.id}-lines`, type: "line", source: src, filter: ["==", ["get", "kind"], "line"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": c, "line-opacity": 0.9, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.8, 16, 2, 19, 3.5] } }, before);
    map.addLayer({ id: `net-${n.id}-texts`, type: "symbol", source: src, minzoom: 17, filter: ["==", ["get", "kind"], "text"],
      layout: { "text-field": ["get", "text"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-max-width": 12 },
      paint: { "text-color": c, "text-halo-color": "#ffffff", "text-halo-width": 1.5 } }, before);
    map.addLayer({ id: `net-${n.id}-assets`, type: "circle", source: src, minzoom: 14, filter: ["==", ["get", "kind"], "point"],
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2.5, 16, 5, 19, 8], "circle-color": "#ffffff",
        "circle-stroke-color": c, "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 14, 1.2, 17, 2.5] } }, before);
    map.addLayer({ id: `net-${n.id}-labels`, type: "symbol", source: src, minzoom: 16, filter: ["all", ["==", ["get", "kind"], "point"], ["has", "label"]],
      layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Medium"], "text-size": 11, "text-offset": [0, 1.0], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": "#1f2a52", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } }, before);
    map.on("mouseenter", `net-${n.id}-assets`, () => map.getCanvas().style.cursor = "pointer");
    map.on("mouseleave", `net-${n.id}-assets`, () => map.getCanvas().style.cursor = "");
    networkLoaded.add(n.id);
  }

  async function setNetworkVisible(id, on, save = true) {
    const n = networks.find((x) => x.id === id);
    if (!n) return;
    const cb = document.querySelector(`#networkList input[data-net="${id}"]`);
    if (on && !networkLoaded.has(id)) {
      try { await addNetworkLayers(n); }
      catch (e) { console.warn(e); toast(`${n.name} could not be loaded`, true); if (cb) cb.checked = false; return; }
    }
    for (const lid of netLayerIds(n)) if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", on ? "visible" : "none");
    if (on) networkOn.add(id); else networkOn.delete(id);
    if (cb) cb.checked = on;
    if (!on && overlayPopup && overlayPopup._netId === id) { overlayPopup.remove(); overlayPopup = null; }
    if (save) await DB.setSetting("networksOn", [...networkOn]);
    $("#legendAsset").classList.toggle("hidden", !(isVisible("overlay-assets") || networkOn.size));
    updateLayersButton();
  }

  function updateLayersButton() {
    const k = networkOn.size, b = $("#btnLayers");
    b.textContent = k ? `Networks: ${k} on` : "Networks: off";
    b.setAttribute("aria-pressed", k ? "true" : "false");
  }

  function toggleLayersPanel(show) {
    const p = $("#layersPanel"), open = show === undefined ? p.classList.contains("hidden") : show;
    p.classList.toggle("hidden", !open);
    $("#btnLayers").setAttribute("aria-expanded", open ? "true" : "false");
    $(".map-toggles").classList.toggle("hidden", open);
    $("#rowBase").classList.toggle("hidden", !map.getSource("drawingbase"));
    $("#rowOverlay").classList.toggle("hidden", !map.getSource("overlay"));
  }

  // ------------------------------------------------------------ CAD utilities overlay
  const OVERLAY_LAYERS = ["overlay-lines", "overlay-texts", "overlay-assets", "overlay-asset-labels"];
  let overlayPopup = null;

  async function loadOverlay() {
    if (!C.overlayFile) return;
    let data;
    try {
      const resp = await fetch(C.overlayFile);
      if (!resp.ok) return;                       // no overlay published - nothing to show
      data = await resp.json();
    } catch (e) { console.warn("Overlay not loaded", e); return; }
    if (!data || !Array.isArray(data.features) || !data.features.length) return;

    map.addSource("overlay", { type: "geojson", data, maxzoom: 20, tolerance: 0.2 });
    const before = "survey-points";              // survey pins stay on top of the drawing
    map.addLayer({ id: "overlay-lines", type: "line", source: "overlay", filter: ["==", ["get", "kind"], "line"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-opacity": 0.9, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 16, 1.4, 19, 2.5] } }, before);
    map.addLayer({ id: "overlay-texts", type: "symbol", source: "overlay", minzoom: 17, filter: ["==", ["get", "kind"], "text"],
      layout: { "text-field": ["get", "text"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-max-width": 12 },
      paint: { "text-color": ["get", "color"], "text-halo-color": "#ffffff", "text-halo-width": 1.5 } }, before);
    map.addLayer({ id: "overlay-assets", type: "circle", source: "overlay", minzoom: 13, filter: ["==", ["get", "kind"], "point"],
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2, 16, 5, 19, 8], "circle-color": "#ffffff",
        "circle-stroke-color": ["get", "color"], "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 13, 1, 17, 2.5] } }, before);
    map.addLayer({ id: "overlay-asset-labels", type: "symbol", source: "overlay", minzoom: 16, filter: ["all", ["==", ["get", "kind"], "point"], ["has", "label"]],
      layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Medium"], "text-size": 11, "text-offset": [0, 1.0], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": "#1f2a52", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } }, before);
    map.on("mouseenter", "overlay-assets", () => map.getCanvas().style.cursor = "pointer");
    map.on("mouseleave", "overlay-assets", () => map.getCanvas().style.cursor = "");

    $("#btnOverlay").classList.remove("hidden");
    $("#legendAsset").classList.remove("hidden");
    setOverlayVisible(await DB.getSetting("overlayVisible", true));
  }

  function setOverlayVisible(on) {
    for (const id of OVERLAY_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    const b = $("#btnOverlay"); b.setAttribute("aria-pressed", on ? "true" : "false"); b.textContent = on ? "Utilities: on" : "Utilities: off";
    $("#chkOverlay").checked = on;
    $("#legendAsset").classList.toggle("hidden", !on && !networkOn.size);
    if (!on && overlayPopup) { overlayPopup.remove(); overlayPopup = null; }
  }

  // One tap handler: survey pins win over drawing assets; a finger-sized box makes small symbols easy to hit
  function onMapClick(ev) {
    const p = ev.point, box = [[p.x - 12, p.y - 12], [p.x + 12, p.y + 12]];
    const assetLayers = ["overlay-assets"].concat(networks.filter((n) => networkOn.has(n.id)).map((n) => `net-${n.id}-assets`)).filter(isVisible);
    const asset = assetLayers.length ? nearest(map.queryRenderedFeatures(box, { layers: assetLayers }), ev.lngLat) : null;
    if (placing) {
      if (asset) { map.jumpTo({ center: asset.geometry.coordinates }); toast("Snapped to " + (asset.properties.label || "drawing asset")); }
      return;
    }
    const pin = nearest(map.queryRenderedFeatures(box, { layers: ["survey-points"] }), ev.lngLat);
    if (pin) { openSurvey(pin.properties.key); return; }
    if (asset) showAssetPopup(asset);
  }

  function nearest(features, lngLat) {
    let best = null, bestD = Infinity;
    for (const f of features || []) {
      const c = f.geometry.coordinates, d = (c[0] - lngLat.lng) ** 2 + (c[1] - lngLat.lat) ** 2;
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  function showAssetPopup(f) {
    const pr = f.properties, [lon, lat] = f.geometry.coordinates;
    const label = (pr.label || "").trim();
    // which utility network the tapped asset belongs to (layer ids are net-<id>-assets)
    const layerId = (f.layer && f.layer.id) || "";
    const net = networks.find((n) => layerId === `net-${n.id}-assets`) || null;
    const existing = label ? surveys.filter((s) => (s.ManholePitID || "").trim().toLowerCase() === label.toLowerCase()) : [];
    const div = document.createElement("div"); div.className = "asset-popup";
    const h = document.createElement("h4"); h.textContent = label || "Unlabelled asset"; div.appendChild(h);
    const meta = document.createElement("div"); meta.className = "meta";
    meta.textContent = [net ? net.name : "", pr.layer, pr.block, pr.attrs].filter(Boolean).join(" · "); div.appendChild(meta);
    const btnNew = document.createElement("button"); btnNew.type = "button"; btnNew.className = "btn btn-primary";
    btnNew.textContent = existing.length ? "Start another survey here" : "Start survey for this asset";
    btnNew.addEventListener("click", () => {
      overlayPopup.remove(); overlayPopup = null;
      const loc = { ManholePitID: label, Latitude: Number(lat.toFixed(7)), Longitude: Number(lon.toFixed(7)),
        LocationAccuracyMeters: "", LocationCapturedAt: nowIso(), LocationSource: "Drawing overlay (field app)" };
      if (net && net.utility) { loc.UtilitySurveyed = net.utility; loc.UtilityOther = net.utility === "Other" ? (net.utilityOther || net.name) : ""; }
      newSurvey(loc);
      toast("Position and ID taken from the drawing - confirm on site");
    });
    div.appendChild(btnNew);
    for (const s of existing.slice(0, 3)) {
      const b = document.createElement("button"); b.type = "button"; b.className = "btn";
      b.textContent = `Open ${s.SurveyStatus || "Draft"} survey (${s.SurveyDate || ""})`;
      b.addEventListener("click", () => { overlayPopup.remove(); overlayPopup = null; openSurvey(s.RecordKey); });
      div.appendChild(b);
    }
    if (overlayPopup) overlayPopup.remove();
    overlayPopup = new maplibregl.Popup({ closeButton: true, maxWidth: "280px", offset: 10 }).setLngLat([lon, lat]).setDOMContent(div).addTo(map);
    overlayPopup._netId = net ? net.id : null;
  }

  // ------------------------------------------------------------ data
  async function refreshSurveys() {
    surveys = await DB.allSurveys();
    surveys.sort((a, b) => (b.SurveyDate || "").localeCompare(a.SurveyDate || "") || (b.ModifiedAt || "").localeCompare(a.ModifiedAt || ""));
    updateMapData();
    renderList();
    renderExportStats();
  }

  // ------------------------------------------------------------ list
  function renderList() {
    const q = ($("#fltSearch").value || "").trim().toLowerCase();
    const st = $("#fltStatus").value, ut = $("#fltUtility").value, ur = $("#fltUrgent").value;
    const box = $("#surveyList");
    box.innerHTML = "";
    const rows = surveys.filter((s) => (!st || s.SurveyStatus === st) && (!ut || s.UtilitySurveyed === ut) && (!ur || s.UrgentRectificationRequired === ur)
      && (!q || [s.ManholePitID, s.SurveyorName, s.Observations, s.UtilitySurveyed].join(" ").toLowerCase().includes(q)));
    if (!rows.length) { box.innerHTML = '<div class="empty">No surveys match. Use <b>+ New survey</b> on the map to start one.</div>'; return; }
    for (const s of rows) {
      const r = document.createElement("div"); r.className = "row";
      const tags = [`<span class="pill pill-${(s.SurveyStatus || "Draft").toLowerCase()}">${s.SurveyStatus || "Draft"}</span>`];
      if (s.UrgentRectificationRequired === "Yes") tags.push('<span class="pill pill-urgent">Urgent</span>');
      if (s._exportedAt) tags.push('<span class="pill pill-exported">Exported</span>');
      r.innerHTML = `<div class="id">${esc(s.ManholePitID || "(no ID)")}</div><div class="tags">${tags.join("")}</div>
        <div class="sub">${esc(s.SurveyDate || "")} · ${esc(s.UtilitySurveyed || "No utility")} · ${esc(s.SurveyorName || "")} · ${s._photoCount || 0} photo${s._photoCount === 1 ? "" : "s"}${isNum(s.Latitude) ? "" : " · no location"}</div>`;
      r.addEventListener("click", () => openSurvey(s.RecordKey));
      box.appendChild(r);
    }
  }
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ------------------------------------------------------------ form
  function populateForm() {
    for (const sel of $$("#surveyForm select[data-list]")) fillSelect(sel, C.lists[sel.dataset.list]);
    fillSelect($("#fltUtility"), C.lists.utility, "All utilities");
    for (const sel of $$("#surveyForm select[name]")) sel.addEventListener("change", () => toggleOther(sel.name));
  }
  function toggleOther(name) {
    const sel = $(`#surveyForm [name="${name}"]`);
    const box = $(`#surveyForm .other[data-for="${name}"]`);
    if (sel && box) box.classList.toggle("show", sel.value === "Other");
  }

  async function newSurvey(loc) {
    current = {
      RecordKey: newRecordKey(), SurveyorName: settings.surveyorName || "", SurveyDate: todayIso(),
      UtilitySurveyed: "", UtilityOther: "", ManholePitID: "", ManholeShape: "", CoverType: "", CoverTypeOther: "",
      CoverCondition: "", InternalCondition: "", InternalConditionOther: "", GroundCondition: "", GroundConditionOther: "",
      Observations: "", SketchFileName: "", SketchRelativePath: "", SketchFileType: "", SketchFileSizeBytes: "", SketchAddedAt: "",
      UrgentRectificationRequired: "", Latitude: "", Longitude: "", LocationAccuracyMeters: "", LocationCapturedAt: "", LocationSource: "",
      LocationConfirmed: "", SurveyStatus: "Draft", CreatedAt: nowIso(), ModifiedAt: nowIso(), CompletedAt: "", DeviceName: safeDevice()
    };
    if (loc) Object.assign(current, loc);
    currentFiles = []; currentIsNew = true;
    openForm();
  }

  async function openSurvey(key) {
    const s = await DB.getSurvey(key);
    if (!s) { toast("Survey not found", true); return; }
    current = s; currentIsNew = false;
    currentFiles = await DB.filesFor(key);
    openForm();
  }

  function openForm() {
    const f = $("#surveyForm");
    for (const el of f.elements) {
      if (!el.name) continue;
      el.value = current[el.name] === undefined || current[el.name] === null ? "" : current[el.name];
    }
    if (current.LocationCapturedAt) f.elements.LocationCapturedAt.value = EX.fmt(current.LocationCapturedAt);
    for (const name of ["UtilitySurveyed", "CoverType", "InternalCondition", "GroundCondition"]) toggleOther(name);
    $$("#surveyForm .field.invalid").forEach((x) => x.classList.remove("invalid"));
    $("#formTitle").textContent = current.ManholePitID ? current.ManholePitID : (currentIsNew ? "New survey" : "Survey");
    setStatusPill();
    $("#btnDelete").classList.toggle("hidden", currentIsNew);
    $("#formMeta").textContent = `Record key ${current.RecordKey}` + (current._exportedAt ? ` · exported ${EX.fmt(current._exportedAt)}` : "");
    renderPhotos(); renderSketch();
    $("#formPanel").classList.remove("hidden");
    $(".panel-body").scrollTop = 0;
  }
  function setStatusPill() {
    const p = $("#formStatus"); p.textContent = current.SurveyStatus || "Draft";
    p.className = "pill pill-" + (current.SurveyStatus || "Draft").toLowerCase();
  }

  function readForm() {
    const f = $("#surveyForm");
    for (const el of f.elements) {
      if (!el.name) continue;
      let v = el.value;
      if (typeof v === "string") v = v.trim();
      current[el.name] = v;
    }
    for (const k of ["Latitude", "Longitude", "LocationAccuracyMeters"]) current[k] = isNum(current[k]) ? Number(current[k]) : "";
    if (isNum(current.Latitude) && isNum(current.Longitude) && !current.LocationSource) current.LocationSource = "Manual entry (field app)";
    if (!isNum(current.Latitude) || !isNum(current.Longitude)) { current.Latitude = ""; current.Longitude = ""; }
  }

  async function closeForm() {
    if (currentIsNew && currentFiles.length) {
      if (!confirm("Discard this new survey and its photos?")) return;
      await DB.deleteFilesFor(current.RecordKey);
    }
    $("#formPanel").classList.add("hidden");
    releaseUrls();
    current = null; currentFiles = [];
  }

  function validateComplete() {
    const problems = [];
    $$("#surveyForm .field.invalid").forEach((x) => x.classList.remove("invalid"));
    const flag = (name) => { const el = $(`#surveyForm [name="${name}"]`); if (el) el.closest(".field").classList.add("invalid"); };
    for (const [key, label] of C.requiredForComplete) if (!current[key]) { problems.push(label); flag(key); }
    for (const [sel, other, label] of [["UtilitySurveyed", "UtilityOther", "Utility (other)"], ["CoverType", "CoverTypeOther", "Cover type (other)"], ["InternalCondition", "InternalConditionOther", "Internal condition (other)"], ["GroundCondition", "GroundConditionOther", "Ground condition (other)"]]) {
      if (current[sel] === "Other" && !current[other]) { problems.push(label); flag(other); }
    }
    if (!isNum(current.Latitude) || !isNum(current.Longitude)) { problems.push("Asset location"); flag("Latitude"); }
    if (!currentFiles.some((f) => f.category === "Photo")) problems.push("At least one photograph");
    return problems;
  }

  async function saveSurvey(markComplete) {
    readForm();
    if (markComplete) {
      const problems = validateComplete();
      if (problems.length) { toast("Still required: " + problems.join(", "), true); return; }
      current.SurveyStatus = "Complete"; current.CompletedAt = nowIso();
    } else if (!current.SurveyStatus) current.SurveyStatus = "Draft";
    current.ModifiedAt = nowIso();
    current._photoCount = currentFiles.filter((f) => f.category === "Photo").length;
    if (current._exportedAt) current._exportedAt = "";     // edited after export: needs exporting again
    await DB.putSurvey(current);
    currentIsNew = false;
    if (current.SurveyorName && current.SurveyorName !== settings.surveyorName) { settings.surveyorName = current.SurveyorName; await DB.setSetting("surveyorName", settings.surveyorName); $("#setSurveyor").value = settings.surveyorName; }
    await refreshSurveys();
    setStatusPill(); $("#btnDelete").classList.remove("hidden");
    $("#formTitle").textContent = current.ManholePitID || "Survey";
    if (markComplete) { toast("Survey marked complete"); $("#formPanel").classList.add("hidden"); releaseUrls(); current = null; }
    else toast("Draft saved");
  }

  async function deleteSurvey() {
    if (!confirm(`Delete survey ${current.ManholePitID || current.RecordKey} and its photos from this device?`)) return;
    await DB.deleteFilesFor(current.RecordKey);
    await DB.deleteSurvey(current.RecordKey);
    $("#formPanel").classList.add("hidden"); releaseUrls(); current = null; currentFiles = [];
    await refreshSurveys();
    toast("Survey deleted");
  }

  // ------------------------------------------------------------ location
  function setLocation(lat, lon, acc, source) {
    const f = $("#surveyForm");
    f.elements.Latitude.value = Number(lat).toFixed(6);
    f.elements.Longitude.value = Number(lon).toFixed(6);
    f.elements.LocationAccuracyMeters.value = isNum(acc) ? Number(acc).toFixed(1) : "";
    f.elements.LocationCapturedAt.value = EX.fmt(new Date());
    f.elements.LocationSource.value = source;
  }
  function captureGps() {
    if (!navigator.geolocation) { toast("Geolocation not available on this device", true); return; }
    const btn = $("#btnGps"); btn.disabled = true; btn.textContent = "Locating…";
    navigator.geolocation.getCurrentPosition((pos) => {
      btn.disabled = false; btn.textContent = "Capture GPS";
      setLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, "Device GPS (field app)");
      toast(`Location captured (±${Math.round(pos.coords.accuracy)} m)`);
    }, (err) => {
      btn.disabled = false; btn.textContent = "Capture GPS";
      toast("Location failed: " + (err.message || "unknown error"), true);
    }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 });
  }
  function startPlacing() {
    readForm();
    placing = true;
    $("#formPanel").classList.add("hidden");
    showView("map");
    $("#crosshair").classList.remove("hidden"); $("#placeBar").classList.remove("hidden"); $("#btnNewSurvey").classList.add("hidden");
    if (isNum(current.Latitude) && isNum(current.Longitude)) map.jumpTo({ center: [Number(current.Longitude), Number(current.Latitude)], zoom: Math.max(map.getZoom(), 17) });
  }
  function endPlacing(apply) {
    placing = false;
    $("#crosshair").classList.add("hidden"); $("#placeBar").classList.add("hidden"); $("#btnNewSurvey").classList.remove("hidden");
    if (apply) { const c = map.getCenter(); current.Latitude = c.lat; current.Longitude = c.lng; current.LocationAccuracyMeters = ""; current.LocationCapturedAt = nowIso(); current.LocationSource = "Map placement (field app)"; }
    openForm();
    if (apply) { const f = $("#surveyForm"); setLocation(current.Latitude, current.Longitude, "", current.LocationSource); f.elements.Latitude.scrollIntoView({ block: "center" }); toast("Location placed from map"); }
  }

  // ------------------------------------------------------------ photos
  async function addPhotos(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let count = currentFiles.filter((f) => f.category === "Photo").length;
    for (const file of files) {
      if (count >= C.maxPhotos) { toast(`Maximum ${C.maxPhotos} photos per survey`, true); break; }
      try {
        const out = await processImage(file);
        if (out.blob.size > C.maxFileBytes) { toast(`${file.name} is larger than 10 MB`, true); continue; }
        const n = nextPhotoNumber();
        const FileName = `${assetBase()}_${stamp()}.${out.ext}`;
        const rec = { RecordKey: current.RecordKey, category: "Photo", number: n, FileName,
          RelativePath: `SurveyFiles\\${cleanFileName(current.RecordKey)}\\${pad2(n)}_${FileName}`,
          FileType: out.ext, blob: out.blob, capturedAt: nowIso(), caption: "" };
        rec.fileId = await DB.putFile(rec);
        currentFiles.push(rec); count++;
      } catch (e) { console.error(e); toast(`Could not add ${file.name}`, true); }
    }
    renderPhotos();
  }
  function nextPhotoNumber() { return currentFiles.filter((f) => f.category === "Photo").reduce((m, f) => Math.max(m, f.number), 0) + 1; }

  // Downscale to C.photoMaxEdge and re-encode as JPEG; keeps the original when decoding fails (e.g. HEIC)
  async function processImage(file) {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const scale = Math.min(1, C.photoMaxEdge / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
      bmp.close && bmp.close();
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", C.photoQuality));
      if (!blob) throw new Error("encode failed");
      return { blob, ext: "jpg" };
    } catch (e) {
      return { blob: file, ext };
    }
  }

  function renderPhotos() {
    const grid = $("#photoGrid"); grid.innerHTML = "";
    const photos = currentFiles.filter((f) => f.category === "Photo").sort((a, b) => a.number - b.number);
    $("#photoCount").textContent = `${photos.length} / ${C.maxPhotos}`;
    for (const p of photos) {
      const d = document.createElement("div"); d.className = "photo";
      const img = document.createElement("img");
      if (/^(jpg|jpeg|png|gif|webp|bmp)$/.test(p.FileType)) img.src = objUrl(p.blob); else img.alt = p.FileType.toUpperCase();
      img.addEventListener("click", () => { $("#photoViewerImg").src = img.src; $("#photoViewerTitle").textContent = `Photo ${p.number}`; $("#photoViewer").classList.remove("hidden"); });
      const cap = document.createElement("input"); cap.className = "cap"; cap.placeholder = "Caption (optional)"; cap.value = p.caption || "";
      cap.addEventListener("change", async () => { p.caption = cap.value.trim(); await DB.putFile(p); });
      const bar = document.createElement("div"); bar.className = "bar";
      bar.innerHTML = `<span>#${p.number} · ${Math.round(p.blob.size / 1024)} KB</span>`;
      const rm = document.createElement("button"); rm.type = "button"; rm.textContent = "Remove";
      rm.addEventListener("click", async () => { if (!confirm(`Remove photo ${p.number}?`)) return; await DB.deleteFile(p.fileId); currentFiles = currentFiles.filter((x) => x !== p); renderPhotos(); });
      bar.appendChild(rm);
      d.append(img, cap, bar); grid.appendChild(d);
    }
  }

  // ------------------------------------------------------------ sketch
  async function setSketch(blob, originalName, ext) {
    const old = currentFiles.find((f) => f.category === "Sketch");
    if (old) { await DB.deleteFile(old.fileId); currentFiles = currentFiles.filter((f) => f !== old); }
    const FileName = cleanFileName(originalName);
    const rec = { RecordKey: current.RecordKey, category: "Sketch", number: 0, FileName,
      RelativePath: `SurveyFiles\\${cleanFileName(current.RecordKey)}\\Sketch_${stamp()}_${FileName}`,
      FileType: ext, blob, capturedAt: nowIso(), caption: "" };
    rec.fileId = await DB.putFile(rec);
    currentFiles.push(rec);
    current.SketchFileName = FileName; current.SketchRelativePath = rec.RelativePath; current.SketchFileType = ext;
    current.SketchFileSizeBytes = blob.size; current.SketchAddedAt = rec.capturedAt;
    renderSketch();
  }
  async function removeSketch() {
    const old = currentFiles.find((f) => f.category === "Sketch");
    if (old) { await DB.deleteFile(old.fileId); currentFiles = currentFiles.filter((f) => f !== old); }
    current.SketchFileName = ""; current.SketchRelativePath = ""; current.SketchFileType = ""; current.SketchFileSizeBytes = ""; current.SketchAddedAt = "";
    renderSketch();
  }
  function renderSketch() {
    const box = $("#sketchBox"); box.innerHTML = "";
    const sk = currentFiles.find((f) => f.category === "Sketch");
    if (!sk) { box.textContent = "No sketch attached. Draw one on screen or attach an image, PDF, SVG, DWG or DXF file (max 10 MB)."; return; }
    if (/^(png|jpg|jpeg|gif|webp|svg)$/.test(sk.FileType)) { const img = document.createElement("img"); img.src = objUrl(sk.blob); box.appendChild(img); }
    const t = document.createElement("span"); t.textContent = `${sk.FileName} · ${Math.round(sk.blob.size / 1024)} KB`; box.appendChild(t);
  }

  // simple drawing pad
  const pad = { strokes: [], cur: null, ctx: null };
  function openSketchPad() {
    const ov = $("#sketchPad"); ov.classList.remove("hidden");
    const cv = $("#sketchCanvas");
    const dpr = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    cv.width = Math.round(rect.width * dpr); cv.height = Math.round(rect.height * dpr);
    pad.ctx = cv.getContext("2d"); pad.ctx.scale(dpr, dpr); pad.strokes = []; pad.cur = null;
    redrawPad();
  }
  function redrawPad() {
    const cv = $("#sketchCanvas"), ctx = pad.ctx, dpr = window.devicePixelRatio || 1;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); ctx.restore();
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1f2a52"; ctx.lineWidth = 3;
    for (const s of pad.strokes.concat(pad.cur ? [pad.cur] : [])) {
      if (s.length < 2) { ctx.beginPath(); ctx.arc(s[0][0], s[0][1], 1.5, 0, Math.PI * 2); ctx.fillStyle = "#1f2a52"; ctx.fill(); continue; }
      ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]); for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]); ctx.stroke();
    }
  }
  function bindSketchPad() {
    const cv = $("#sketchCanvas");
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); pad.cur = [pt(e)]; redrawPad(); });
    cv.addEventListener("pointermove", (e) => { if (!pad.cur) return; pad.cur.push(pt(e)); redrawPad(); });
    const up = () => { if (pad.cur) { pad.strokes.push(pad.cur); pad.cur = null; redrawPad(); } };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    $("#btnSketchUndo").addEventListener("click", () => { pad.strokes.pop(); redrawPad(); });
    $("#btnSketchClear").addEventListener("click", () => { pad.strokes = []; redrawPad(); });
    $("#btnSketchCancel").addEventListener("click", () => $("#sketchPad").classList.add("hidden"));
    $("#btnSketchSave").addEventListener("click", async () => {
      if (!pad.strokes.length) { toast("Nothing drawn yet", true); return; }
      const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
      await setSketch(blob, `${assetBase()}_drawing.png`, "png");
      $("#sketchPad").classList.add("hidden"); toast("Sketch attached");
    });
    window.addEventListener("resize", () => { if (!$("#sketchPad").classList.contains("hidden")) { const strokes = pad.strokes; openSketchPad(); pad.strokes = strokes; redrawPad(); } });
  }

  // ------------------------------------------------------------ export
  function scopeSurveys(scope) {
    if (scope === "all") return surveys.slice();
    if (scope === "today") { const t = todayIso(); return surveys.filter((s) => s.SurveyDate === t); }
    return surveys.filter((s) => !s._exportedAt);
  }
  async function renderExportStats() {
    $("#stTotal").textContent = surveys.length;
    $("#stPending").textContent = surveys.filter((s) => !s._exportedAt).length;
    $("#stToday").textContent = surveys.filter((s) => s.SurveyDate === todayIso()).length;
    const scope = ($('input[name="scope"]:checked') || {}).value || "pending";
    const sel = scopeSurveys(scope);
    let bytes = 0, n = 0;
    const all = await DB.allFiles();
    const keys = new Set(sel.map((s) => s.RecordKey));
    for (const f of all) if (keys.has(f.RecordKey)) { bytes += f.blob.size; n++; }
    $("#exportEstimate").textContent = sel.length ? `${sel.length} survey${sel.length === 1 ? "" : "s"}, ${n} file${n === 1 ? "" : "s"}, about ${(bytes / 1048576).toFixed(1)} MB.` : "Nothing to export for this selection.";
    $("#btnExport").disabled = !sel.length;
  }
  async function doExport() {
    const scope = $('input[name="scope"]:checked').value;
    const sel = scopeSurveys(scope);
    if (!sel.length) return;
    const btn = $("#btnExport"), out = $("#exportResult");
    btn.disabled = true; btn.textContent = "Building package…"; out.textContent = ""; out.classList.remove("err");
    try {
      const all = await DB.allFiles();
      const byKey = {};
      for (const f of all) (byKey[f.RecordKey] = byKey[f.RecordKey] || []).push(f);
      const blob = await EX.build(sel, byKey, safeDevice());
      const name = EX.packageName(safeDevice());
      const how = await EX.save(blob, name);
      if (how === "cancelled") { out.textContent = "Export cancelled."; }
      else {
        const t = nowIso();
        for (const s of sel) { s._exportedAt = t; await DB.putSurvey(s); }
        out.textContent = `${name} (${(blob.size / 1048576).toFixed(1)} MB) ${how}. ${sel.length} survey${sel.length === 1 ? "" : "s"} marked as exported.`;
        await refreshSurveys();
      }
    } catch (e) {
      console.error(e); out.textContent = "Export failed: " + e.message; out.classList.add("err");
    }
    btn.textContent = "Create export package"; renderExportStats();
  }

  // ------------------------------------------------------------ settings
  async function renderStorage() {
    const info = $("#storageInfo");
    try {
      const est = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      info.textContent = `${surveys.length} surveys stored. Using ${(est.usage / 1048576).toFixed(1)} MB of about ${(est.quota / 1048576 / 1024).toFixed(1)} GB available. ${persisted ? "Storage is marked persistent." : "Storage is not yet marked persistent."}`;
      $("#btnPersist").classList.toggle("hidden", persisted);
    } catch (e) { info.textContent = "Storage information not available."; }
  }
  async function purgeOld() {
    const cutoff = Date.now() - 14 * 86400000;
    const victims = surveys.filter((s) => s._exportedAt && new Date(s._exportedAt).getTime() < cutoff);
    if (!victims.length) { toast("No exported surveys older than 14 days"); return; }
    if (!confirm(`Remove ${victims.length} exported survey(s) and their photos from this device? They remain in the exported packages.`)) return;
    for (const s of victims) { await DB.deleteFilesFor(s.RecordKey); await DB.deleteSurvey(s.RecordKey); }
    await refreshSurveys(); renderStorage(); toast(`${victims.length} survey(s) removed`);
  }

  // ------------------------------------------------------------ service worker / network
  function setNet() {
    const p = $("#netStatus");
    const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    p.textContent = navigator.onLine ? (sw ? "Online · offline ready" : "Online") : (sw ? "Offline · ready" : "Offline");
  }
  async function registerSw() {
    if (!("serviceWorker" in navigator)) { setNet(); return; }
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      reg.addEventListener("updatefound", () => { const nw = reg.installing; nw && nw.addEventListener("statechange", () => { if (nw.state === "installed" && navigator.serviceWorker.controller) toast("App updated - reopen to use the new version"); }); });
      navigator.serviceWorker.addEventListener("controllerchange", setNet);
    } catch (e) { console.warn("Service worker failed", e); }
    setNet();
  }

  // ------------------------------------------------------------ wiring
  function bind() {
    $$(".bottom-nav button").forEach((b) => b.addEventListener("click", () => { if (!placing) showView(b.dataset.view); }));
    $("#btnNewSurvey").addEventListener("click", () => newSurvey());
    $("#btnLayers").addEventListener("click", () => toggleLayersPanel());
    $("#btnLayersClose").addEventListener("click", () => toggleLayersPanel(false));
    $("#chkBase").addEventListener("change", async (e) => { setBaseVisible(e.target.checked); await DB.setSetting("baseVisible", e.target.checked); });
    $("#chkOverlay").addEventListener("change", async (e) => { setOverlayVisible(e.target.checked); await DB.setSetting("overlayVisible", e.target.checked); });
    $("#btnNetAll").addEventListener("click", async () => { for (const n of networks) await setNetworkVisible(n.id, true, false); await DB.setSetting("networksOn", [...networkOn]); });
    $("#btnNetNone").addEventListener("click", async () => { for (const n of networks) await setNetworkVisible(n.id, false, false); await DB.setSetting("networksOn", [...networkOn]); });
    $("#btnBase").addEventListener("click", async () => {
      const on = $("#btnBase").getAttribute("aria-pressed") !== "true";
      setBaseVisible(on); await DB.setSetting("baseVisible", on);
    });
    $("#btnOverlay").addEventListener("click", async () => {
      const on = $("#btnOverlay").getAttribute("aria-pressed") !== "true";
      setOverlayVisible(on); await DB.setSetting("overlayVisible", on);
    });
    $("#btnPlaceHere").addEventListener("click", () => endPlacing(true));
    $("#btnPlaceCancel").addEventListener("click", () => endPlacing(false));
    ["#fltSearch", "#fltStatus", "#fltUtility", "#fltUrgent"].forEach((s) => $(s).addEventListener("input", renderList));

    $("#btnFormClose").addEventListener("click", closeForm);
    $("#btnSaveDraft").addEventListener("click", () => saveSurvey(false));
    $("#btnComplete").addEventListener("click", () => saveSurvey(true));
    $("#btnDelete").addEventListener("click", deleteSurvey);
    $("#btnGps").addEventListener("click", captureGps);
    $("#btnPlaceOnMap").addEventListener("click", startPlacing);
    $("#btnClearLocation").addEventListener("click", () => { const f = $("#surveyForm"); for (const k of ["Latitude", "Longitude", "LocationAccuracyMeters", "LocationCapturedAt", "LocationSource"]) f.elements[k].value = ""; });
    $("#surveyForm").elements.Latitude.addEventListener("input", () => $("#surveyForm").elements.LocationSource.value = "Manual entry (field app)");
    $("#surveyForm").elements.Longitude.addEventListener("input", () => $("#surveyForm").elements.LocationSource.value = "Manual entry (field app)");
    $("#surveyForm").elements.ManholePitID.addEventListener("input", (e) => $("#formTitle").textContent = e.target.value || "Survey");

    $("#inpCamera").addEventListener("change", (e) => { addPhotos(e.target.files); e.target.value = ""; });
    $("#inpGallery").addEventListener("change", (e) => { addPhotos(e.target.files); e.target.value = ""; });
    $("#inpSketch").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0]; e.target.value = "";
      if (!file) return;
      if (file.size > C.maxFileBytes) { toast("Sketch is larger than 10 MB", true); return; }
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      let blob = file, outExt = ext;
      if (/^(jpg|jpeg|png|webp|bmp|gif|heic|heif)$/.test(ext)) { const o = await processImage(file); blob = o.blob; outExt = o.ext; }
      await setSketch(blob, outExt === ext ? file.name : file.name.replace(/\.[^.]+$/, "") + "." + outExt, outExt);
      toast("Sketch attached");
    });
    $("#btnDrawSketch").addEventListener("click", openSketchPad);
    $("#btnRemoveSketch").addEventListener("click", async () => { if (currentFiles.some((f) => f.category === "Sketch") && confirm("Remove the sketch?")) { await removeSketch(); } });
    bindSketchPad();
    $("#btnPhotoViewerClose").addEventListener("click", () => $("#photoViewer").classList.add("hidden"));

    $$('input[name="scope"]').forEach((r) => r.addEventListener("change", renderExportStats));
    $("#btnExport").addEventListener("click", doExport);

    $("#setSurveyor").addEventListener("change", async (e) => { settings.surveyorName = e.target.value.trim(); await DB.setSetting("surveyorName", settings.surveyorName); });
    $("#setDevice").addEventListener("change", async (e) => { settings.deviceName = e.target.value.trim() || "FIELD"; e.target.value = settings.deviceName; await DB.setSetting("deviceName", settings.deviceName); });
    $("#btnPersist").addEventListener("click", async () => { const ok = navigator.storage.persist ? await navigator.storage.persist() : false; toast(ok ? "Storage is now persistent" : "Browser declined persistent storage", !ok); renderStorage(); });
    $("#btnPurge").addEventListener("click", purgeOld);
    $("#btnReload").addEventListener("click", async () => { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); location.reload(); });
    $("#btnInstall").addEventListener("click", async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $("#btnInstall").classList.add("hidden"); });
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; $("#btnInstall").classList.remove("hidden"); });
    window.addEventListener("online", setNet); window.addEventListener("offline", setNet);
  }

  // ------------------------------------------------------------ start
  async function init() {
    await DB.open();
    settings.surveyorName = await DB.getSetting("surveyorName", "");
    settings.deviceName = await DB.getSetting("deviceName", "FIELD");
    $("#setSurveyor").value = settings.surveyorName; $("#setDevice").value = settings.deviceName;
    $("#appVersion").textContent = C.version;
    populateForm();
    bind();
    await refreshSurveys();
    registerSw();
    initMap();
  }
  init().catch((e) => { console.error(e); toast("Start-up failed: " + e.message, true); });
})();
