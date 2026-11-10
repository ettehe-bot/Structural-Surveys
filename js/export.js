/* Daily export package builder.
   Produces a zip with:
     surveys.csv   - one row per survey, tblSurveys columns (no SurveyID)
     photos.csv    - one row per photo, keyed by RecordKey
     ductwalls.csv - one row per duct wall sketch, keyed by RecordKey
     ductsections.csv  - one row per group of ducts (wall + top/middle/bottom), keyed by RecordKey
     ductconduits.csv  - one row per duct with its number of cables, keyed by RecordKey
     manifest.json - device, counts, app version
     SurveyFiles/<RecordKey>/<stored file>  - photos and sketches
   The layout matches the SurveyFiles convention of the Access application, so the
   VBA import routine only has to copy the folder and append the CSV files. */
window.SurveyExport = (function () {
  const C = window.SURVEY_CONFIG;

  function csvCell(v) {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(columns, rows) {
    const lines = [columns.join(",")];
    for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(","));
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  // Access-friendly date text: yyyy-mm-dd hh:nn:ss (local time)
  function fmt(d) {
    if (!d) return "";
    // Already in the target form (e.g. typed into a form field): keep it. Safari cannot parse it with new Date().
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(d)) return d;
    const x = d instanceof Date ? d : new Date(d);
    if (isNaN(x)) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`;
  }

  function zipPath(relativePath) { return relativePath.replace(/\\/g, "/"); }

  // ------------------------------------------------------------ 6b duct groups
  const ductCount = (sec) => Number(sec.rows || 0) * Number(sec.perRow || 0);

  // Each number is one row of ducts: 2 rows of 3 is "3x3"
  const ductNotation = (sec) => Array(Number(sec.rows)).fill(sec.perRow).join("x");

  function ductLabel(sec) {
    const n = ductCount(sec), rows = Number(sec.rows);
    const cable = sec.cableDia > 0 ? `, cable ø${sec.cableDia} mm` : "";
    const level = sec.level !== undefined && sec.level !== "" ? `, depth/invert level ${sec.level} m` : "";
    return `${sec.size ? `ø${sec.size} mm` : "Size not chosen"}, ${ductNotation(sec)} (${rows} row${rows === 1 ? "" : "s"} of ${sec.perRow}, ${n} duct${n === 1 ? "" : "s"})${cable}${level}`;
  }

  // Every duct in a group, row by row from the top and left to right
  function ductCells(sec) {
    const cells = [];
    for (let row = 1; row <= Number(sec.rows || 0); row++) {
      for (let duct = 1; duct <= Number(sec.perRow || 0); duct++) cells.push({ key: `${row}-${duct}`, row, duct });
    }
    return cells;
  }

  // Groups that count for a wall: ticked, and only if the wall itself is ticked
  function activeSections(s, wall) {
    if (s[`DuctWall${wall}`] !== true) return [];
    const byPos = (s.DuctSections || {})[wall] || {};
    return C.ductPositions.filter((pos) => byPos[pos] && byPos[pos].on).map((pos) => ({ pos, sec: byPos[pos] }));
  }

  const xmlText = (t) => String(t === undefined || t === null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // The automatic sketch of one wall: a tick box per group, then its ducts drawn to scale with their cable counts
  function wallSketchSvg(s, wall) {
    const byPos = (s.DuctSections || {})[wall] || {}, radius = (size) => 14 + (Number(size || 25) - 25) / 275 * 22, gap = 8, left = 64;
    // Wide enough for the ducts and for each group's label (about 10 px per character at 17 px bold)
    const width = Math.max(760, ...C.ductPositions.map((pos) => {
      const sec = byPos[pos];
      if (!(sec && sec.on)) return 0;
      const label = ductCount(sec) > 0 ? `${pos}: ${ductLabel(sec)}` : pos;
      return Math.max(left + Number(sec.perRow || 0) * (2 * radius(sec.size) + gap), left + label.length * 10) + 24;
    }));
    const out = [];
    let y = 92;
    for (const pos of C.ductPositions) {
      const sec = byPos[pos], on = !!(sec && sec.on), complete = on && ductCount(sec) > 0;
      out.push(`<rect x="24" y="${y - 16}" width="20" height="20" fill="#fff" stroke="#000" stroke-width="1.5"/>`);
      if (on) out.push(`<path d="M28 ${y - 6}l4 5 8-11" fill="none" stroke="#000" stroke-width="2.5"/>`);
      out.push(`<text x="${left}" y="${y}" font-size="17" font-weight="700">${pos}${complete ? `: ${xmlText(ductLabel(sec))}` : ""}</text>`);
      y += 16;
      if (complete) {
        const r = radius(sec.size);
        for (const { key, row, duct } of ductCells(sec)) {
          const cx = left + r + (duct - 1) * (2 * r + gap), cy = y + r + (row - 1) * (2 * r + gap), n = sec.cables ? sec.cables[key] : "";
          out.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="#fff" stroke="#000" stroke-width="1.5"/>`);
          if (n !== undefined && n !== "") out.push(`<text x="${cx.toFixed(1)}" y="${(cy + 5).toFixed(1)}" font-size="14" text-anchor="middle">${xmlText(n)}</text>`);
        }
        y += Number(sec.rows) * (2 * r + gap);
      }
      y += 30;
    }
    const height = y + 14;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}" font-family="Arial, Helvetica, sans-serif">`
      + `<rect width="100%" height="100%" fill="#fff"/>`
      + `<rect x="24" y="16" width="${Math.round(width) - 48}" height="36" fill="#fff" stroke="#000" stroke-width="2"/>`
      + `<text x="${Math.round(width) / 2}" y="41" font-size="20" font-weight="700" text-anchor="middle">Wall ${wall}${s.ManholePitID ? ` - ${xmlText(s.ManholePitID)}` : ""}</text>`
      + out.join("")
      + `<text x="24" y="${y}" font-size="13">Numbers in the ducts are the number of cables. Ducts are drawn to relative size.</text></svg>`;
  }

  async function build(surveys, filesBySurvey, deviceName) {
    const zip = new JSZip();
    const surveyRows = [];
    const photoRows = [];
    const wallRows = [];
    const sectionRows = [];
    const conduitRows = [];

    for (const s of surveys) {
      const row = {};
      for (const col of C.surveyColumns) row[col] = s[col] === undefined ? "" : s[col];
      for (const dc of ["SurveyDate", "SketchAddedAt", "LocationCapturedAt", "CreatedAt", "ModifiedAt", "CompletedAt"]) {
        row[dc] = dc === "SurveyDate" && s[dc] ? String(s[dc]).slice(0, 10) : fmt(s[dc]);
      }
      for (let w = 1; w <= C.wallCount; w++) row[`DuctWall${w}`] = s[`DuctWall${w}`] === true ? "Yes" : "No";
      surveyRows.push(row);

      // A wall with duct groups gets its automatic sketch, which takes the place of any older attached one
      const autoWalls = new Set();
      for (let w = 1; w <= C.wallCount; w++) {
        const active = activeSections(s, w);
        for (const { pos, sec } of active) {
          sectionRows.push({ RecordKey: s.RecordKey, WallNo: w, SectionName: pos, DuctSizeMm: sec.size, DuctRows: sec.rows, DuctsPerRow: sec.perRow, CableDiameterMm: sec.cableDia, DepthInvertLevelM: sec.level });
          for (const { key, row: rowNo, duct } of ductCells(sec)) {
            conduitRows.push({ RecordKey: s.RecordKey, WallNo: w, SectionName: pos, RowNo: rowNo, DuctNo: duct, CableCount: sec.cables ? sec.cables[key] : "" });
          }
        }
        if (active.some(({ sec }) => ductCount(sec) > 0)) {
          autoWalls.add(w);
          const svg = wallSketchSvg(s, w), FileName = `DuctWall${w}_auto.svg`;
          const RelativePath = `SurveyFiles\\${String(s.RecordKey).replace(/[\\/:*?"<>|]/g, "_")}\\${FileName}`;
          zip.file(zipPath(RelativePath), svg);
          wallRows.push({ RecordKey: s.RecordKey, WallNo: w, FileName, RelativePath, FileType: "svg", FileSizeBytes: new Blob([svg]).size, AddedAt: fmt(s.ModifiedAt) });
        }
      }

      const files = filesBySurvey[s.RecordKey] || [];
      for (const f of files) {
        if (f.category === "DuctWall" && autoWalls.has(f.number)) continue;
        zip.file(zipPath(f.RelativePath), f.blob, { binary: true });
        if (f.category === "Photo") {
          photoRows.push({
            RecordKey: s.RecordKey,
            PhotoNumber: f.number,
            FileName: f.FileName,
            RelativePath: f.RelativePath,
            FileType: f.FileType,
            FileSizeBytes: f.blob.size,
            CapturedAt: fmt(f.capturedAt),
            FileCaption: f.caption || ""
          });
        } else if (f.category === "DuctWall") {
          wallRows.push({
            RecordKey: s.RecordKey,
            WallNo: f.number,
            FileName: f.FileName,
            RelativePath: f.RelativePath,
            FileType: f.FileType,
            FileSizeBytes: f.blob.size,
            AddedAt: fmt(f.capturedAt)
          });
        }
      }
    }

    zip.file("surveys.csv", toCsv(C.surveyColumns, surveyRows));
    zip.file("photos.csv", toCsv(C.photoColumns, photoRows));
    zip.file("ductwalls.csv", toCsv(C.ductWallColumns, wallRows));
    zip.file("ductsections.csv", toCsv(C.ductSectionColumns, sectionRows));
    zip.file("ductconduits.csv", toCsv(C.ductConduitColumns, conduitRows));
    zip.file("manifest.json", JSON.stringify({
      app: C.appName, version: C.version, device: deviceName,
      exportedAt: new Date().toISOString(),
      surveys: surveyRows.length, photos: photoRows.length, ductWallSketches: wallRows.length,
      ductSections: sectionRows.length, ducts: conduitRows.length,
      format: "structural-survey-field-package/5"
    }, null, 2));

    // Photos are already JPEG - storing them uncompressed is faster on a phone
    return zip.generateAsync({ type: "blob", compression: "STORE" });
  }

  function packageName(deviceName, prefix = "FieldSurveys") {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    return `${prefix}_${deviceName}_${stamp}.zip`;
  }

  /* Hands the zip to the user: file picker on desktop, share sheet on phones
     (OneDrive / Teams / email appear there), plain download as the fallback.
     preferShare: try the share sheet before the file picker (used when sending to SharePoint).
     Chrome on Android and Windows does not share .zip files, so those devices fall through to the picker or a download. */
  function canShareFile(blob, name) {
    try { return !!(navigator.canShare && navigator.canShare({ files: [new File([blob], name, { type: "application/zip" })] })); }
    catch (e) { return false; }
  }
  async function share(blob, name) {
    try { await navigator.share({ files: [new File([blob], name, { type: "application/zip" })], title: name }); return "shared"; }
    catch (e) { return e.name === "AbortError" ? "cancelled" : "failed"; }
  }
  async function save(blob, name, opts) {
    const file = new File([blob], name, { type: "application/zip" });
    if (opts && opts.preferShare && canShareFile(blob, name)) {
      const how = await share(blob, name);
      if (how !== "failed") return how;
    }
    if (window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: "Zip package", accept: { "application/zip": [".zip"] } }] });
        const w = await h.createWritable(); await w.write(blob); await w.close();
        return "saved";
      } catch (e) { if (e.name === "AbortError") return "cancelled"; }
    }
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return "shared"; }
      catch (e) { if (e.name === "AbortError") return "cancelled"; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return "downloaded";
  }

  return { build, save, share, canShareFile, packageName, fmt, toCsv, ductLabel, ductCells, wallSketchSvg };
})();
