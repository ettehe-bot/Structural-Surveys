/* Daily export package builder.
   Produces a zip with:
     surveys.csv   - one row per survey, tblSurveys columns (no SurveyID)
     photos.csv    - one row per photo, keyed by RecordKey
     manifest.json - device, counts, app version
     SurveyFiles/<RecordKey>/<stored file>  - photos and sketches
   The layout matches the SurveyFiles convention of the Access application, so the
   VBA import routine only has to copy the folder and append the two CSV files. */
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

  async function build(surveys, filesBySurvey, deviceName) {
    const zip = new JSZip();
    const surveyRows = [];
    const photoRows = [];

    for (const s of surveys) {
      const row = {};
      for (const col of C.surveyColumns) row[col] = s[col] === undefined ? "" : s[col];
      for (const dc of ["SurveyDate", "SketchAddedAt", "LocationCapturedAt", "CreatedAt", "ModifiedAt", "CompletedAt"]) {
        row[dc] = dc === "SurveyDate" && s[dc] ? String(s[dc]).slice(0, 10) : fmt(s[dc]);
      }
      surveyRows.push(row);

      const files = filesBySurvey[s.RecordKey] || [];
      for (const f of files) {
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
        }
      }
    }

    zip.file("surveys.csv", toCsv(C.surveyColumns, surveyRows));
    zip.file("photos.csv", toCsv(C.photoColumns, photoRows));
    zip.file("manifest.json", JSON.stringify({
      app: C.appName, version: C.version, device: deviceName,
      exportedAt: new Date().toISOString(),
      surveys: surveyRows.length, photos: photoRows.length,
      format: "structural-survey-field-package/1"
    }, null, 2));

    // Photos are already JPEG - storing them uncompressed is faster on a phone
    return zip.generateAsync({ type: "blob", compression: "STORE" });
  }

  function packageName(deviceName) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    return `FieldSurveys_${deviceName}_${stamp}.zip`;
  }

  /* Hands the zip to the user: file picker on desktop, share sheet on phones
     (OneDrive / Teams / email appear there), plain download as the fallback. */
  async function save(blob, name) {
    const file = new File([blob], name, { type: "application/zip" });
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

  return { build, save, packageName, fmt };
})();
