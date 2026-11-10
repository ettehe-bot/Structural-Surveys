/* Structural Survey Field App - main application logic */
(function () {
  "use strict";
  const C = window.SURVEY_CONFIG;
  const DB = window.SurveyDB;
  const EX = window.SurveyExport;
  const SP = window.SurveyorPackage;
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
  let settings = { surveyorName: "", deviceName: "FIELD", spLink: "", spAfterExport: true };
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
      // site plan first, so the utility networks are drawn on top of it
      loadDrawingBase().catch((e) => console.warn("Basemap drawing not loaded", e))
        .then(loadNetworkIndex);
    });
    map.on("error", (e) => { if (e && e.error && !/glyph|font|pbf/i.test(String(e.error.message))) console.warn("map", e.error); });
  }

  // Only the pins that pass the Surveyed Manholes filter and whose utility network is switched on
  function surveysGeoJson() {
    return { type: "FeatureCollection", features: surveys.filter((s) => hasLocation(s) && surveyShown(s)).map((s) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [Number(s.Longitude), Number(s.Latitude)] },
      properties: { key: s.RecordKey, id: s.ManholePitID || "(no ID)", status: s.SurveyStatus, urgent: s.UrgentRectificationRequired || "" }
    })) };
  }
  const isNum = (v) => v !== null && v !== undefined && v !== "" && !isNaN(Number(v));
  const hasLocation = (s) => isNum(s.Latitude) && isNum(s.Longitude);
  function updateMapData() {
    if (!mapReady) return;
    map.getSource("surveys").setData(surveysGeoJson());
    applyAssetFilters();
  }

  // ------------------------------------------------------------ surveyed manholes filter
  // Not surveyed = drawing assets with no survey of the same ID; Draft, Completed and Urgent = survey pins.
  // Urgent pins (red) belong to the Urgent switch whatever their status, matching the pin colours.
  let manholeFilter = { notSurveyed: true, draft: true, complete: true, urgent: true };
  const MANHOLE_KEYS = ["notSurveyed", "draft", "complete", "urgent"];
  const MANHOLE_NAMES = { draft: "Draft", complete: "Completed", urgent: "Urgent" };
  const statusKey = (s) => (s.UrgentRectificationRequired === "Yes" ? "urgent" : s.SurveyStatus === "Complete" ? "complete" : "draft");
  const idKey = (v) => String(v || "").trim().toLowerCase();

  // The utility networks a survey belongs to. Several drawings can share one utility (HV has three);
  // "Other" matches on its description (Irrigation), and the retired "Potable / Firewater" matches both.
  function networksForSurvey(s) {
    const u = s.UtilitySurveyed || "";
    if (!u) return [];
    if (u === "Potable / Firewater") return networks.filter((n) => n.utility === "Potable Water" || n.utility === "Fire Water");
    if (u === "Other") {
      const o = idKey(s.UtilityOther);
      return o ? networks.filter((n) => n.utility === "Other" && (idKey(n.utilityOther) === o || idKey(n.name) === o)) : [];
    }
    return networks.filter((n) => n.utility === u);
  }
  // A survey with no matching network (no utility chosen yet, 400Hz, an unlisted "Other") has no switch to follow, so it stays visible
  function surveyShown(s) {
    if (!manholeFilter[statusKey(s)]) return false;
    const linked = networksForSurvey(s);
    return !linked.length || linked.some((n) => networkOn.has(n.id));
  }
  function hiddenReason(s) {
    if (!hasLocation(s)) return "";
    if (!manholeFilter[statusKey(s)]) return `${MANHOLE_NAMES[statusKey(s)]} manholes are filtered out of the map`;
    const linked = networksForSurvey(s);
    if (linked.length && !linked.some((n) => networkOn.has(n.id))) return `switch on ${linked.map((n) => n.name).join(" or ")} in Networks to see it on the map`;
    return "";
  }

  // Hide drawing assets that already have a survey (the pin stands for them), and all assets when Not surveyed is off
  function applyAssetFilters() {
    if (!mapReady) return;
    const surveyed = surveys.filter((s) => hasLocation(s) && idKey(s.ManholePitID));
    const label = ["downcase", ["to-string", ["coalesce", ["get", "label"], ""]]];
    const notIn = (ids) => (manholeFilter.notSurveyed ? ["!", ["in", label, ["literal", ids]]] : ["boolean", false]);
    const isPoint = ["==", ["get", "kind"], "point"];
    const set = (id, f) => { if (map.getLayer(id)) map.setFilter(id, f); };
    for (const n of networks) {
      if (!networkLoaded.has(n.id)) continue;
      const ids = [...new Set(surveyed.filter((s) => { const l = networksForSurvey(s); return !l.length || l.includes(n); }).map((s) => idKey(s.ManholePitID)))];
      set(`net-${n.id}-assets`, ["all", isPoint, notIn(ids)]);
      set(`net-${n.id}-labels`, ["all", isPoint, ["has", "label"], notIn(ids)]);
    }
    updateAssetLegend();
  }

  function updateAssetLegend() {
    $("#legendAsset").classList.toggle("hidden", !(networkOn.size > 0 && manholeFilter.notSurveyed));
    $("#legendDraft").classList.toggle("hidden", !manholeFilter.draft);
    $("#legendComplete").classList.toggle("hidden", !manholeFilter.complete);
    $("#legendUrgent").classList.toggle("hidden", !manholeFilter.urgent);
  }

  function renderManholeFilter() {
    for (const k of MANHOLE_KEYS) $(`#chkMh-${k}`).checked = !!manholeFilter[k];
    const on = MANHOLE_KEYS.filter((k) => manholeFilter[k]).length, b = $("#btnManholes");
    b.textContent = on === MANHOLE_KEYS.length ? "Surveyed Manholes: all" : `Surveyed Manholes: ${on} of ${MANHOLE_KEYS.length}`;
  }

  async function setManholeFilter(key, on) {
    manholeFilter[key] = on;
    renderManholeFilter();
    updateMapData();
    if (!on && key === "notSurveyed" && overlayPopup) { overlayPopup.remove(); overlayPopup = null; }
    await DB.setSetting("manholeFilter", manholeFilter);
  }

  function toggleManholePanel(show) {
    const p = $("#manholePanel"), open = show === undefined ? p.classList.contains("hidden") : show;
    if (open) toggleLayersPanel(false);
    p.classList.toggle("hidden", !open);
    $("#btnManholes").setAttribute("aria-expanded", open ? "true" : "false");
    $(".map-toggles").classList.toggle("hidden", open);
  }

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

    $("#btnLayers").classList.remove("hidden");
    setBaseVisible(await DB.getSetting("baseVisible", true));
  }

  function setBaseVisible(on) {
    for (const id of BASE_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
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
    updateMapData();                 // pins of networks that stay off are hidden now the networks are known
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
    // networks sit above the site plan and below the survey pins
    const before = "survey-points";
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
    updateMapData();                 // survey pins follow their utility network
    if (save) await DB.setSetting("networksOn", [...networkOn]);
    updateLayersButton();
  }

  function updateLayersButton() {
    const k = networkOn.size, b = $("#btnLayers");
    b.textContent = k ? `Networks: ${k} on` : "Networks: off";
    b.setAttribute("aria-pressed", k ? "true" : "false");
  }

  function toggleLayersPanel(show) {
    const p = $("#layersPanel"), open = show === undefined ? p.classList.contains("hidden") : show;
    if (open) toggleManholePanel(false);
    p.classList.toggle("hidden", !open);
    $("#btnLayers").setAttribute("aria-expanded", open ? "true" : "false");
    $(".map-toggles").classList.toggle("hidden", open);
    $("#rowBase").classList.toggle("hidden", !map.getSource("drawingbase"));
  }

  // ------------------------------------------------------------ tapping drawing assets
  let overlayPopup = null;           // the popup of the tapped network asset

  // One tap handler: survey pins win over drawing assets; a finger-sized box makes small symbols easy to hit
  function onMapClick(ev) {
    const p = ev.point, box = [[p.x - 12, p.y - 12], [p.x + 12, p.y + 12]];
    const assetLayers = networks.filter((n) => networkOn.has(n.id)).map((n) => `net-${n.id}-assets`).filter(isVisible);
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
    fillSelect($("#fltUtility"), C.lists.utilityFilter, "All utilities");
    for (const sel of $$("#surveyForm select[name]")) sel.addEventListener("change", () => toggleOther(sel.name));
    const furn = $("#furnitureFields");
    for (const [name, label] of C.furniture) {
      const row = document.createElement("label"); row.className = "field";
      const cap = document.createElement("span"); cap.textContent = label;
      const inp = document.createElement("input"); inp.name = name; inp.type = "number"; inp.min = "0"; inp.step = "1"; inp.inputMode = "numeric";
      inp.addEventListener("focus", () => inp.select());   // typing replaces the default 0
      row.append(cap, inp); furn.appendChild(row);
    }
    buildWallRows();
    $("#surveyForm").elements.ManholeShape.addEventListener("change", shapeChanged);
  }
  function toggleOther(name) {
    const sel = $(`#surveyForm [name="${name}"]`);
    const box = $(`#surveyForm .other[data-for="${name}"]`);
    if (sel && box) box.classList.toggle("show", sel.value === "Other");
  }

  // 5a. Only the measurements that apply to the chosen shape are shown
  function updateDimFields() {
    const f = $("#surveyForm"), shape = f.elements.ManholeShape.value, shown = C.dimsByShape[shape] || [];
    $("#dimFields").classList.toggle("hidden", !shape);
    $("#dimHint").classList.toggle("hidden", !!shape);
    for (const name of Object.keys(C.dimLabels)) f.elements[name].closest(".field").classList.toggle("hidden", !shown.includes(name));
  }
  function shapeChanged() {
    const f = $("#surveyForm"), shown = C.dimsByShape[f.elements.ManholeShape.value] || [];
    for (const name of Object.keys(C.dimLabels)) if (!shown.includes(name)) f.elements[name].value = "";
    updateDimFields();
  }

  // A record may hold a value no longer offered (the old "Potable / Firewater"). Keep it visible so it is
  // not lost on save; the inspector has to pick a current value before marking the survey complete.
  function syncRetiredUtility() {
    const sel = $("#surveyForm").elements.UtilitySurveyed, v = current.UtilitySurveyed;
    for (const o of Array.from(sel.options)) if (o.dataset.retired) o.remove();
    if (v && !C.lists.utility.includes(v)) {
      const o = document.createElement("option"); o.value = v; o.textContent = `${v} (old value - choose a new one)`; o.dataset.retired = "1";
      sel.appendChild(o);
    }
  }

  async function newSurvey(loc) {
    current = {
      RecordKey: newRecordKey(), SurveyorName: settings.surveyorName || "", SurveyDate: todayIso(),
      UtilitySurveyed: "", UtilityOther: "", ManholePitID: "", ManholeShape: "", CoverType: "", CoverTypeOther: "",
      CoverCondition: "", InternalCondition: "", InternalConditionOther: "", GroundCondition: "", GroundConditionOther: "",
      Observations: "", SketchFileName: "", SketchRelativePath: "", SketchFileType: "", SketchFileSizeBytes: "", SketchAddedAt: "",
      UrgentRectificationRequired: "", Latitude: "", Longitude: "", LocationAccuracyMeters: "", LocationCapturedAt: "", LocationSource: "",
      LocationConfirmed: "", SurveyStatus: "Draft", CreatedAt: nowIso(), ModifiedAt: nowIso(), CompletedAt: "", DeviceName: safeDevice(),
      InternalDimLength: "", InternalDimWidth: "", InternalDimDiameter: "", InternalDimDepth: "", InternalDimUnit: "m", FurnitureOtherDetails: ""
    };
    for (const [name] of C.furniture) current[name] = 0;
    for (let w = 1; w <= C.wallCount; w++) current[`DuctWall${w}`] = false;
    current.DuctSections = {};
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
    syncRetiredUtility();
    for (const el of f.elements) {
      if (!el.name) continue;
      if (el.type === "checkbox") { el.checked = current[el.name] === true; continue; }
      el.value = current[el.name] === undefined || current[el.name] === null ? "" : current[el.name];
    }
    if (current.LocationCapturedAt) f.elements.LocationCapturedAt.value = EX.fmt(current.LocationCapturedAt);
    for (const name of ["UtilitySurveyed", "CoverType", "InternalCondition", "GroundCondition"]) toggleOther(name);
    updateDimFields();
    $$("#surveyForm .invalid").forEach((x) => x.classList.remove("invalid"));
    $("#formTitle").textContent = current.ManholePitID ? current.ManholePitID : (currentIsNew ? "New survey" : "Survey");
    setStatusPill();
    $("#btnDelete").classList.toggle("hidden", currentIsNew);
    $("#formMeta").textContent = `Record key ${current.RecordKey}` + (current._exportedAt ? ` · exported ${EX.fmt(current._exportedAt)}` : "");
    renderPhotos(); renderSketch(); renderWalls();
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
      if (el.type === "checkbox") { current[el.name] = el.checked; continue; }
      let v = el.value;
      if (typeof v === "string") v = v.trim();
      current[el.name] = v;
    }
    for (const k of ["Latitude", "Longitude", "LocationAccuracyMeters", ...Object.keys(C.dimLabels), ...C.furniture.map(([name]) => name)]) current[k] = isNum(current[k]) ? Number(current[k]) : "";
    if (isNum(current.Latitude) && isNum(current.Longitude) && !current.LocationSource) current.LocationSource = "Manual entry (field app)";
    if (!isNum(current.Latitude) || !isNum(current.Longitude)) { current.Latitude = ""; current.Longitude = ""; }
  }

  async function closeForm() {
    if (currentIsNew && currentFiles.length) {
      if (!confirm("Discard this new survey, its photos and sketches?")) return;
      await DB.deleteFilesFor(current.RecordKey);
    }
    $("#formPanel").classList.add("hidden");
    releaseUrls();
    current = null; currentFiles = [];
  }

  function validateComplete() {
    const problems = [];
    $$("#surveyForm .invalid").forEach((x) => x.classList.remove("invalid"));
    const flag = (name) => { const el = $(`#surveyForm [name="${name}"]`); if (el) el.closest(".field, .wall-row").classList.add("invalid"); };
    for (const [key, label] of C.requiredForComplete) if (!current[key]) { problems.push(label); flag(key); }
    if (current.UtilitySurveyed && !C.lists.utility.includes(current.UtilitySurveyed)) { problems.push("Utility surveyed (choose Potable Water or Fire Water)"); flag("UtilitySurveyed"); }
    for (const name of C.dimsByShape[current.ManholeShape] || []) if (!(Number(current[name]) > 0)) { problems.push(`${C.dimLabels[name]} above zero`); flag(name); }
    if (!C.lists.dimUnit.includes(current.InternalDimUnit)) { problems.push("Dimension unit"); flag("InternalDimUnit"); }
    for (const [name, label] of C.furniture) if (current[name] !== "" && (!Number.isInteger(current[name]) || current[name] < 0)) { problems.push(`${label} as a whole number`); flag(name); }
    if (current.FurnitureOther > 0 && !current.FurnitureOtherDetails) { problems.push("Description of other pit furniture"); flag("FurnitureOtherDetails"); }
    for (let w = 1; w <= C.wallCount; w++) {
      const ticked = current[`DuctWall${w}`], has = !!wallSketch(w);
      if (!ticked && has) { problems.push(`Wall ${w} has an attached sketch but is not ticked (tick it or remove the sketch)`); flag(`DuctWall${w}`); }
      if (!ticked) continue;
      const on = C.ductPositions.filter((pos) => ductSection(w, pos).on);
      if (!on.length && !has) { problems.push(`Wall ${w}: tick the top, middle or bottom ducts`); flag(`DuctWall${w}`); }
      for (const pos of on) {
        const sec = ductSection(w, pos), box = $(`#wallList .wall-row[data-wall="${w}"] .duct-section[data-pos="${pos}"]`);
        if (!(sec.size && sec.rows && sec.perRow)) { problems.push(`Wall ${w} ${pos.toLowerCase()}: duct size and arrangement`); box.classList.add("invalid"); continue; }
        if (sec.cableDia !== undefined && sec.cableDia !== "" && !(sec.cableDia > 0)) { problems.push(`Wall ${w} ${pos.toLowerCase()}: cable diameter above zero`); box.classList.add("invalid"); }
        const bad = EX.ductCells(sec).some(({ key }) => { const n = sec.cables[key]; return n !== undefined && n !== "" && (!Number.isInteger(n) || n < 0); });
        if (bad) { problems.push(`Wall ${w} ${pos.toLowerCase()}: cables as whole numbers`); box.classList.add("invalid"); }
      }
    }
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
    const hidden = hiddenReason(current), note = hidden ? ` - ${hidden}` : "";
    if (markComplete) { toast("Survey marked complete" + note); $("#formPanel").classList.add("hidden"); releaseUrls(); current = null; }
    else toast("Draft saved" + note);
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

  // Images are resized like photos; other drawing files are kept as they are. Returns null if the file is refused.
  async function prepareSketchFile(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const isRaster = ext !== "svg" && (/^(jpg|jpeg|png|webp|bmp|gif|heic|heif)$/.test(ext) || (file.type || "").startsWith("image/"));
    const out = isRaster ? await processImage(file) : { blob: file, ext };
    if (!C.sketchTypes.includes(out.ext)) { toast("Choose an image, PDF, SVG, DWG or DXF file", true); return null; }
    if (out.blob.size > C.maxFileBytes) { toast("Sketch is larger than 10 MB", true); return null; }
    return { blob: out.blob, ext: out.ext, name: out.ext === ext ? file.name : file.name.replace(/\.[^.]+$/, "") + "." + out.ext };
  }

  // ------------------------------------------------------------ 6b. duct arrangement
  // Attached sketches only remain on surveys made before the structured inputs; they can be opened or removed
  const wallSketch = (w) => currentFiles.find((f) => f.category === "DuctWall" && f.number === w);

  // One group of ducts on a wall: current.DuctSections[wall][Top|Middle|Bottom]
  function ductSection(w, pos) {
    const walls = current.DuctSections = current.DuctSections || {};
    const wall = walls[w] = walls[w] || {};
    return wall[pos] = wall[pos] || { on: false, size: "", rows: "", perRow: "", cableDia: "", level: "", cables: {} };
  }

  function buildWallRows() {
    const box = $("#wallList");
    const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
    const options = (items, text) => `<option value="">Select…</option>` + items.map((v) => `<option value="${v}">${text(v)}</option>`).join("");
    const sizeOptions = options(C.ductSizes, (v) => `ø${v} mm`), rowOptions = options(range(C.maxDuctRows), String), perRowOptions = options(range(C.maxDuctsPerRow), String);
    for (let w = 1; w <= C.wallCount; w++) {
      const row = document.createElement("div"); row.className = "wall-row"; row.dataset.wall = w;
      row.innerHTML = `<label class="wall-check"><input type="checkbox" name="DuctWall${w}"><span>Wall ${w}</span></label>
        <div class="duct-sections">
          ${C.ductPositions.map((pos) => `<div class="duct-section" data-pos="${pos}">
            <label class="section-check"><input type="checkbox" data-role="on"><span>${pos}</span></label>
            <div class="section-body">
              <div class="grid-qty">
                <label class="field"><span>Duct size</span><select data-role="size">${sizeOptions}</select></label>
                <label class="field"><span>Rows</span><select data-role="rows">${rowOptions}</select></label>
                <label class="field"><span>Ducts per row</span><select data-role="perRow">${perRowOptions}</select></label>
                <label class="field"><span>Cable diameter (mm)</span><input data-role="cableDia" type="number" min="0" step="any" inputmode="decimal"></label>
                <label class="field"><span>Section depth / invert level (m)</span><input data-role="level" type="number" step="any"></label>
              </div>
              <p class="section-summary"></p>
              <p class="hint duct-hint">Type the number of cables in each duct:</p>
              <div class="duct-grid"></div>
            </div>
          </div>`).join("")}
          <div class="btn-row"><button class="btn" type="button" data-act="sketch">View sketch</button></div>
        </div>
        <div class="attached-sketch">
          <div class="sketch-box"></div>
          <div class="btn-row">
            <button class="btn" type="button" data-act="open">Open</button>
            <button class="btn btn-danger" type="button" data-act="remove">Remove</button>
          </div>
        </div>`;
      row.querySelector(`[name="DuctWall${w}"]`).addEventListener("change", (e) => {
        if (!e.target.checked && wallSketch(w)) toast(`A sketch is still attached to Wall ${w}. Use Remove if this wall no longer applies.`);
        renderWalls();
      });
      for (const el of $$(".duct-section", row)) {
        const pos = el.dataset.pos;
        el.querySelector('[data-role="on"]').addEventListener("change", (e) => { ductSection(w, pos).on = e.target.checked; renderDuctSection(w, pos); updateSketchButton(w); });
        for (const role of ["size", "rows", "perRow"]) {
          el.querySelector(`[data-role="${role}"]`).addEventListener("change", (e) => { ductSection(w, pos)[role] = e.target.value === "" ? "" : Number(e.target.value); renderDuctSection(w, pos); updateSketchButton(w); });
        }
        // Typed values only update the summary, so the grid of ducts is not redrawn while typing
        for (const role of ["cableDia", "level"]) {
          el.querySelector(`[data-role="${role}"]`).addEventListener("input", (e) => {
            const sec = ductSection(w, pos);
            sec[role] = e.target.value === "" ? "" : Number(e.target.value);
            el.querySelector(".section-summary").textContent = sec.rows && sec.perRow ? EX.ductLabel(sec) : "";
          });
        }
      }
      row.querySelector('[data-act="sketch"]').addEventListener("click", () => {
        readForm();
        const url = objUrl(new Blob([EX.wallSketchSvg(current, w)], { type: "image/svg+xml" }));
        $("#photoViewerImg").src = url; $("#photoViewerTitle").textContent = `Wall ${w} sketch`; $("#photoViewer").classList.remove("hidden");
      });
      row.querySelector('[data-act="open"]').addEventListener("click", () => openWallSketch(w));
      row.querySelector('[data-act="remove"]').addEventListener("click", async () => { if (confirm(`Remove the Wall ${w} sketch?`)) await removeWallSketch(w); });
      box.appendChild(row);
    }
  }

  // 6b legend: hovering shows it (CSS); a click or tap keeps it open until the next click, tap or Esc
  function bindWallLegend() {
    const btn = $("#btnWallLegend"), pop = $("#wallLegend");
    const setOpen = (open) => { pop.classList.toggle("show", open); btn.setAttribute("aria-expanded", open ? "true" : "false"); };
    btn.addEventListener("click", (e) => { e.stopPropagation(); setOpen(!pop.classList.contains("show")); });
    document.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
  }

  function renderWalls() {
    const f = $("#surveyForm");
    for (const row of $$("#wallList .wall-row")) {
      const w = Number(row.dataset.wall), ticked = f.elements[`DuctWall${w}`].checked, sk = wallSketch(w);
      row.classList.toggle("ticked", ticked);
      row.querySelector(".duct-sections").classList.toggle("hidden", !ticked);
      for (const pos of C.ductPositions) renderDuctSection(w, pos);
      updateSketchButton(w);
      row.querySelector(".attached-sketch").classList.toggle("hidden", !sk);
      if (!sk) continue;
      const box = row.querySelector(".sketch-box"); box.innerHTML = "";
      if (/^(png|jpg|jpeg|gif|webp|svg|bmp)$/.test(sk.FileType)) { const img = document.createElement("img"); img.src = objUrl(sk.blob); box.appendChild(img); }
      const t = document.createElement("span"); t.textContent = `Attached sketch: ${sk.FileName} · ${Math.round(sk.blob.size / 1024)} KB`; box.appendChild(t);
    }
  }

  function updateSketchButton(w) {
    const ready = C.ductPositions.some((pos) => { const sec = ductSection(w, pos); return sec.on && sec.rows && sec.perRow; });
    $(`#wallList .wall-row[data-wall="${w}"] [data-act="sketch"]`).closest(".btn-row").classList.toggle("hidden", !ready);
  }

  // Draws the group as round boxes, laid out and sized like the ducts; each one takes that duct's number of cables
  function renderDuctSection(w, pos) {
    const sec = ductSection(w, pos), el = $(`#wallList .wall-row[data-wall="${w}"] .duct-section[data-pos="${pos}"]`);
    el.querySelector('[data-role="on"]').checked = !!sec.on;
    el.querySelector(".section-body").classList.toggle("hidden", !sec.on);
    for (const role of ["size", "rows", "perRow"]) el.querySelector(`[data-role="${role}"]`).value = sec[role];
    for (const role of ["cableDia", "level"]) el.querySelector(`[data-role="${role}"]`).value = sec[role] === undefined ? "" : sec[role];
    el.querySelector(".section-summary").textContent = sec.rows && sec.perRow ? EX.ductLabel(sec) : "";
    const grid = el.querySelector(".duct-grid"); grid.innerHTML = "";
    const drawn = !!(sec.on && sec.rows && sec.perRow);
    el.querySelector(".duct-hint").classList.toggle("hidden", !drawn);
    if (!drawn) return;
    const px = Math.round(40 + (Number(sec.size || 25) - 25) / 275 * 24);
    grid.style.gridTemplateColumns = `repeat(${sec.perRow}, ${px}px)`;
    for (const { key, row, duct } of EX.ductCells(sec)) {
      const inp = document.createElement("input"); inp.className = "duct-cell"; inp.type = "number"; inp.min = "0"; inp.step = "1"; inp.inputMode = "numeric";
      inp.style.width = inp.style.height = px + "px";
      inp.setAttribute("aria-label", `Wall ${w} ${pos.toLowerCase()}, row ${row}, duct ${duct}: number of cables`);
      inp.value = sec.cables[key] === undefined ? "" : sec.cables[key];
      inp.addEventListener("input", () => { sec.cables[key] = inp.value === "" ? "" : Number(inp.value); });
      grid.appendChild(inp);
    }
  }

  async function removeWallSketch(w) {
    const old = wallSketch(w);
    if (old) { await DB.deleteFile(old.fileId); currentFiles = currentFiles.filter((f) => f !== old); }
    await wallSketchChanged();
  }
  // Same rule as Access: a changed wall sketch is saved at once and reopens a completed survey as a draft.
  async function wallSketchChanged() {
    renderWalls();
    if (currentIsNew) return;
    readForm();
    if (current.SurveyStatus === "Complete") { current.SurveyStatus = "Draft"; current.CompletedAt = ""; setStatusPill(); toast("Survey returned to draft: mark it complete again when finished"); }
    current.ModifiedAt = nowIso();
    if (current._exportedAt) current._exportedAt = "";     // changed after export: needs exporting again
    await DB.putSurvey(current);
    await refreshSurveys();
  }
  function openWallSketch(w) {
    const sk = wallSketch(w);
    if (!sk) return;
    if (/^(png|jpg|jpeg|gif|webp|svg|bmp)$/.test(sk.FileType)) {
      $("#photoViewerImg").src = objUrl(sk.blob); $("#photoViewerTitle").textContent = `Wall ${w} sketch`; $("#photoViewer").classList.remove("hidden");
      return;
    }
    const a = document.createElement("a"); a.href = objUrl(sk.blob); a.download = sk.FileName;   // PDF and CAD files open in the device's own apps
    document.body.appendChild(a); a.click(); a.remove();
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
    renderSurveyorEstimate();
  }
  // ------------------------------------------------------------ SharePoint folder (link kept on the device, never in the code)
  let lastExport = null;            // { blob, name } of the latest daily export, for "Share to OneDrive / SharePoint"
  function spLinkValid(v) {
    try {
      const u = new URL(String(v || "").trim());
      return u.protocol === "https:" && /(^|\.)sharepoint\.com$/i.test(u.hostname) ? u.href : "";
    } catch (e) { return ""; }
  }
  function renderSpOptions() {
    const link = spLinkValid(settings.spLink), cb = $("#spAfterExport");
    cb.disabled = !link; cb.checked = !!link && settings.spAfterExport;
    $("#spHint").classList.toggle("hidden", !!link);
    $("#btnSpTest").classList.toggle("hidden", !link);
    for (const a of [$("#btnSpTest"), $("#btnSpOpen")]) { if (link) a.href = link; else a.removeAttribute("href"); }
  }
  function showSpNext(blob, name, how) {
    lastExport = { blob, name };
    const shareable = EX.canShareFile(blob, name);
    $("#spNextText").textContent = how === "shared"
      ? `${name} was shared. If you sent it to OneDrive or SharePoint, use Open SharePoint folder to check it arrived.`
      : how === "saved"
        ? `${name} is saved. If you saved it into the synced SharePoint folder it uploads by itself. Otherwise open the folder, choose Upload and pick the file.`
        : `${name} is in Downloads. Open the SharePoint folder, choose Upload (or + then Upload) and pick the file.`;
    $("#btnSpShare").textContent = how === "shared" ? "Share again" : "Share to OneDrive / SharePoint";
    $("#btnSpShare").classList.toggle("hidden", !shareable);
    $("#spNext").classList.remove("hidden");
  }

  async function doExport() {
    const scope = $('input[name="scope"]:checked').value;
    const sel = scopeSurveys(scope);
    if (!sel.length) return;
    const btn = $("#btnExport"), out = $("#exportResult");
    const toSp = $("#spAfterExport").checked && !!spLinkValid(settings.spLink);
    btn.disabled = true; btn.textContent = "Building package…"; out.textContent = ""; out.classList.remove("err");
    $("#spNext").classList.add("hidden"); lastExport = null;
    try {
      const all = await DB.allFiles();
      const byKey = {};
      for (const f of all) (byKey[f.RecordKey] = byKey[f.RecordKey] || []).push(f);
      const blob = await EX.build(sel, byKey, safeDevice());
      const name = EX.packageName(safeDevice());
      const how = await EX.save(blob, name, { preferShare: toSp });
      if (how === "cancelled") { out.textContent = "Export cancelled."; }
      else {
        const t = nowIso();
        for (const s of sel) { s._exportedAt = t; await DB.putSurvey(s); }
        out.textContent = `${name} (${(blob.size / 1048576).toFixed(1)} MB) ${how}. ${sel.length} survey${sel.length === 1 ? "" : "s"} marked as exported.`;
        if (toSp) showSpNext(blob, name, how);
        await refreshSurveys();
      }
    } catch (e) {
      console.error(e); out.textContent = "Export failed: " + e.message; out.classList.add("err");
    }
    btn.textContent = "Create export package"; renderExportStats();
  }

  // ------------------------------------------------------------ surveyors package
  function surveyorSelection() {
    const today = $('input[name="pkgScope"]:checked').value === "today", doneOnly = $("#pkgCompleteOnly").checked;
    return surveys.filter((s) => (!today || s.SurveyDate === todayIso()) && (!doneOnly || s.SurveyStatus === "Complete"));
  }
  function renderSurveyorEstimate() {
    const sel = surveyorSelection(), located = sel.filter(SP.hasLocation), left = sel.length - located.length;
    const layers = new Set(located.map((s) => s.UtilitySurveyed || "Unspecified")).size;
    $("#pkgEstimate").textContent = located.length
      ? `${located.length} manhole${located.length === 1 ? "" : "s"} on ${layers} utility layer${layers === 1 ? "" : "s"}.${left ? ` ${left} left out because ${left === 1 ? "it has" : "they have"} no location.` : ""}`
      : (left ? `Nothing to export: ${left} survey${left === 1 ? " has" : "s have"} no location.` : "Nothing to export for this selection.");
    $("#btnSurveyorPackage").disabled = !located.length;
  }
  // This package is for checking only: surveys stay "not yet exported" until they go into an Access package
  async function doSurveyorPackage() {
    const sel = surveyorSelection(), located = sel.filter(SP.hasLocation);
    if (!located.length) return;
    const btn = $("#btnSurveyorPackage"), out = $("#pkgResult");
    btn.disabled = true; btn.textContent = "Building package…"; out.textContent = ""; out.classList.remove("err");
    try {
      const blob = await SP.build(sel, safeDevice());
      const name = EX.packageName(safeDevice(), "SurveyorsPackage");
      const how = await EX.save(blob, name);
      out.textContent = how === "cancelled" ? "Export cancelled." : `${name} ${how}. ${located.length} manhole${located.length === 1 ? "" : "s"} included.`;
    } catch (e) {
      console.error(e); out.textContent = "Export failed: " + e.message; out.classList.add("err");
    }
    btn.textContent = "Create surveyors package"; renderSurveyorEstimate();
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
    $("#btnManholes").addEventListener("click", () => toggleManholePanel());
    $("#btnManholesClose").addEventListener("click", () => toggleManholePanel(false));
    for (const k of MANHOLE_KEYS) $(`#chkMh-${k}`).addEventListener("change", (e) => setManholeFilter(k, e.target.checked));
    $("#chkBase").addEventListener("change", async (e) => { setBaseVisible(e.target.checked); await DB.setSetting("baseVisible", e.target.checked); });    $("#btnNetAll").addEventListener("click", async () => { for (const n of networks) await setNetworkVisible(n.id, true, false); await DB.setSetting("networksOn", [...networkOn]); });
    $("#btnNetNone").addEventListener("click", async () => { for (const n of networks) await setNetworkVisible(n.id, false, false); await DB.setSetting("networksOn", [...networkOn]); });
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
      const out = await prepareSketchFile(file);
      if (!out) return;
      await setSketch(out.blob, out.name, out.ext);
      toast("Sketch attached");
    });
    bindWallLegend();
    $("#btnDrawSketch").addEventListener("click", openSketchPad);
    $("#btnRemoveSketch").addEventListener("click", async () => { if (currentFiles.some((f) => f.category === "Sketch") && confirm("Remove the sketch?")) { await removeSketch(); } });
    bindSketchPad();
    $("#btnPhotoViewerClose").addEventListener("click", () => $("#photoViewer").classList.add("hidden"));

    $$('input[name="scope"]').forEach((r) => r.addEventListener("change", renderExportStats));
    $("#btnExport").addEventListener("click", doExport);
    $("#spAfterExport").addEventListener("change", async (e) => { settings.spAfterExport = e.target.checked; await DB.setSetting("spAfterExport", settings.spAfterExport); });
    $("#btnSpShare").addEventListener("click", async () => {
      if (!lastExport) return;
      const how = await EX.share(lastExport.blob, lastExport.name);
      if (how === "failed") toast("This device could not share the file - use Open SharePoint folder instead", true);
    });
    $("#setSpLink").addEventListener("change", async (e) => {
      const raw = e.target.value.trim(), link = spLinkValid(raw);
      if (raw && !link) { toast("That is not a SharePoint link (it should start with https:// and contain sharepoint.com)", true); e.target.value = settings.spLink; return; }
      settings.spLink = link; e.target.value = link;
      if (link) settings.spAfterExport = true;          // a newly added link switches the option on
      await DB.setSetting("spLink", link); await DB.setSetting("spAfterExport", settings.spAfterExport);
      renderSpOptions(); toast(link ? "SharePoint folder saved" : "SharePoint folder removed");
    });
    for (const el of [...$$('input[name="pkgScope"]'), $("#pkgCompleteOnly")]) el.addEventListener("change", renderSurveyorEstimate);
    $("#btnSurveyorPackage").addEventListener("click", doSurveyorPackage);

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
    settings.spLink = spLinkValid(await DB.getSetting("spLink", ""));
    settings.spAfterExport = (await DB.getSetting("spAfterExport", true)) !== false;
    $("#setSpLink").value = settings.spLink;
    const mf = await DB.getSetting("manholeFilter", null);
    if (mf && typeof mf === "object") for (const k of MANHOLE_KEYS) if (typeof mf[k] === "boolean") manholeFilter[k] = mf[k];
    $("#appVersion").textContent = C.version;
    populateForm();
    bind();
    renderManholeFilter(); updateAssetLegend(); renderSpOptions();
    await refreshSurveys();
    registerSw();
    initMap();
  }
  init().catch((e) => { console.error(e); toast("Start-up failed: " + e.message, true); });
})();
