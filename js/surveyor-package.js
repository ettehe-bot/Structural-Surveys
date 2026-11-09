/* Surveyors package: a zip for checking the surveyed manholes against the drawings.
     Surveyed_Manholes.dxf - one point per manhole in UTM metres, one CAD layer per utility,
                             labelled with the manhole ID, with the details as block attributes
     Surveyed_Manholes.csv - the same points and details as a table
     README.txt            - coordinate system, counts and any surveys left out
   The DXF is written in R12 format, the form that CAD and GIS software reads most reliably. */
window.SurveyorPackage = (function () {
  const C = window.SURVEY_CONFIG, P = C.surveyorPackage;
  const BLOCK = "SURVEY_MH";

  // WGS84 to UTM (Krueger series), the same maths as tools\Convert-Drawing.ps1 so points match the converted drawings
  function toUtm(lon, lat, zone) {
    const A = 6378137.0, F = 1 / 298.257223563, K0 = 0.9996, n = F / (2 - F), n2 = n * n, n3 = n2 * n;
    const aa = A / (1 + n) * (1 + n2 / 4 + n2 * n2 / 64);
    const alpha = [n / 2 - 2 * n2 / 3 + 5 * n3 / 16, 13 * n2 / 48 - 3 * n3 / 5, 61 * n3 / 240];
    const phi = lat * Math.PI / 180, dl = (lon - (zone * 6 - 183)) * Math.PI / 180;
    const c = 2 * Math.sqrt(n) / (1 + n);
    const t = Math.sinh(Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)));
    const xip = Math.atan2(t, Math.cos(dl)), etap = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
    let ee = etap, xx = xip;
    for (let j = 1; j <= 3; j++) {
      ee += alpha[j - 1] * Math.cos(2 * j * xip) * Math.sinh(2 * j * etap);
      xx += alpha[j - 1] * Math.sin(2 * j * xip) * Math.cosh(2 * j * etap);
    }
    return { e: 500000 + K0 * aa * ee, n: K0 * aa * xx };
  }

  const hasLocation = (s) => s.Latitude !== "" && s.Longitude !== "" && Number.isFinite(Number(s.Latitude)) && Number.isFinite(Number(s.Longitude));
  const layerName = (utility) => "MH-" + (String(utility || "Unspecified").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "UNSPECIFIED");
  const val = (v) => (v === undefined || v === null ? "" : v);

  // One row per manhole; column names double as the DXF attribute tags
  function toRows(surveys) {
    return surveys.map((s) => {
      const u = toUtm(Number(s.Longitude), Number(s.Latitude), P.utmZone);
      return {
        MH_ID: s.ManholePitID || "NO-ID", UTILITY: s.UtilitySurveyed || "Unspecified", UTILITY_OTHER: val(s.UtilityOther),
        EASTING: u.e.toFixed(3), NORTHING: u.n.toFixed(3), LATITUDE: Number(s.Latitude).toFixed(7), LONGITUDE: Number(s.Longitude).toFixed(7),
        SHAPE: val(s.ManholeShape), LENGTH: val(s.InternalDimLength), WIDTH: val(s.InternalDimWidth), DIAMETER: val(s.InternalDimDiameter), DEPTH: val(s.InternalDimDepth),
        DIM_UNIT: val(s.InternalDimUnit), ACCURACY_M: val(s.LocationAccuracyMeters), LOC_SOURCE: val(s.LocationSource), LOC_CONFIRMED: val(s.LocationConfirmed),
        STATUS: val(s.SurveyStatus), SURVEY_DATE: String(val(s.SurveyDate)).slice(0, 10), SURVEYOR: val(s.SurveyorName), RECORD_KEY: s.RecordKey,
        CAD_LAYER: layerName(s.UtilitySurveyed), _e: u.e, _n: u.n
      };
    }).sort((a, b) => a.CAD_LAYER.localeCompare(b.CAD_LAYER) || a.MH_ID.localeCompare(b.MH_ID));
  }
  const ATTRIBUTE_TAGS = ["MH_ID", "UTILITY", "UTILITY_OTHER", "SHAPE", "LENGTH", "WIDTH", "DIAMETER", "DEPTH", "DIM_UNIT", "EASTING", "NORTHING", "LATITUDE", "LONGITUDE", "ACCURACY_M", "LOC_SOURCE", "LOC_CONFIRMED", "STATUS", "SURVEY_DATE", "SURVEYOR", "RECORD_KEY"];
  const CSV_COLUMNS = ["MH_ID", "UTILITY", "UTILITY_OTHER", "CAD_LAYER", "EASTING", "NORTHING", "LATITUDE", "LONGITUDE", "SHAPE", "LENGTH", "WIDTH", "DIAMETER", "DEPTH", "DIM_UNIT", "ACCURACY_M", "LOC_SOURCE", "LOC_CONFIRMED", "STATUS", "SURVEY_DATE", "SURVEYOR", "RECORD_KEY"];

  // R12 text: one line, ASCII only ("\U+xxxx" for anything else), "%%" is a CAD control code
  function dxfText(v) {
    return Array.from(String(val(v)).replace(/[\x00-\x1f\x7f]+/g, " ").replace(/%%/g, "%%%")).map((ch) => {
      const code = ch.codePointAt(0);
      if (code < 128) return ch;
      return code <= 0xffff ? "\\U+" + code.toString(16).toUpperCase().padStart(4, "0") : "?";
    }).join("").slice(0, 250);
  }

  function toDxf(rows) {
    const lines = [];
    const put = (...pairs) => { for (let i = 0; i < pairs.length; i += 2) lines.push(String(pairs[i]), String(pairs[i + 1])); };
    const xyz = (x, y, code) => put(code, x.toFixed(3), code + 10, y.toFixed(3), code + 20, "0.000");
    const h = P.textHeight, pad = 50;
    const es = rows.map((r) => r._e), ns = rows.map((r) => r._n);

    put(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1009", 9, "$INSBASE"); xyz(0, 0, 10);
    put(9, "$EXTMIN"); xyz(Math.min(...es) - pad, Math.min(...ns) - pad, 10);
    put(9, "$EXTMAX"); xyz(Math.max(...es) + pad, Math.max(...ns) + pad, 10);
    put(9, "$CLAYER", 8, "0", 9, "$TEXTSTYLE", 7, "STANDARD", 9, "$PDMODE", 70, 3, 9, "$PDSIZE", 40, (P.symbolRadius * 2).toFixed(3), 0, "ENDSEC");

    const layers = [...new Set(rows.map((r) => r.CAD_LAYER))];
    const colorOf = (layer) => { const r = rows.find((x) => x.CAD_LAYER === layer); return P.layerColors[r.UTILITY] || 7; };
    put(0, "SECTION", 2, "TABLES");
    put(0, "TABLE", 2, "LTYPE", 70, 1, 0, "LTYPE", 2, "CONTINUOUS", 70, 0, 3, "Solid line", 72, 65, 73, 0, 40, "0.0", 0, "ENDTAB");
    put(0, "TABLE", 2, "LAYER", 70, layers.length + 1, 0, "LAYER", 2, "0", 70, 0, 62, 7, 6, "CONTINUOUS");
    for (const l of layers) put(0, "LAYER", 2, l, 70, 0, 62, colorOf(l), 6, "CONTINUOUS");
    put(0, "ENDTAB");
    put(0, "TABLE", 2, "STYLE", 70, 1, 0, "STYLE", 2, "STANDARD", 70, 0, 40, "0.0", 41, "1.0", 50, "0.0", 71, 0, 42, "0.2", 3, "txt", 4, "", 0, "ENDTAB");
    put(0, "ENDSEC");

    // The block sits on layer 0 so each inserted manhole takes the layer and colour of its utility
    put(0, "SECTION", 2, "BLOCKS", 0, "BLOCK", 8, "0", 2, BLOCK, 70, 2); xyz(0, 0, 10); put(3, BLOCK);
    put(0, "POINT", 8, "0"); xyz(0, 0, 10);
    put(0, "CIRCLE", 8, "0"); xyz(0, 0, 10); put(40, P.symbolRadius.toFixed(3));
    for (const tag of ATTRIBUTE_TAGS) {
      put(0, "ATTDEF", 8, "0"); xyz(P.symbolRadius + 0.3, 0.3, 10);
      put(40, h.toFixed(3), 1, "", 3, tag, 2, tag, 70, tag === "MH_ID" ? 0 : 1);   // only the ID is shown on the drawing
    }
    put(0, "ENDBLK", 8, "0", 0, "ENDSEC");

    put(0, "SECTION", 2, "ENTITIES");
    for (const r of rows) {
      put(0, "INSERT", 8, r.CAD_LAYER, 66, 1, 2, BLOCK); xyz(r._e, r._n, 10);
      for (const tag of ATTRIBUTE_TAGS) {
        put(0, "ATTRIB", 8, r.CAD_LAYER); xyz(r._e + P.symbolRadius + 0.3, r._n + 0.3, 10);
        put(40, h.toFixed(3), 1, dxfText(r[tag]), 2, tag, 70, tag === "MH_ID" ? 0 : 1);
      }
      put(0, "SEQEND", 8, r.CAD_LAYER);
    }
    put(0, "ENDSEC", 0, "EOF");
    return lines.join("\r\n") + "\r\n";
  }

  function readme(rows, left, deviceName) {
    const counts = {};
    for (const r of rows) counts[r.CAD_LAYER] = (counts[r.CAD_LAYER] || 0) + 1;
    return [
      "Structural Survey - Surveyors package",
      `Device ${deviceName}, app version ${C.version}, exported ${window.SurveyExport.fmt(new Date())}`,
      "",
      "Surveyed_Manholes.dxf  CAD drawing (R12 DXF) with one point per manhole, labelled with its ID.",
      "                       In CAD, select a point and open Properties to see its attributes.",
      "Surveyed_Manholes.csv  The same points and details as a table.",
      "",
      `Coordinates: WGS 84 / UTM zone ${P.utmZone}N (EPSG:${32600 + P.utmZone}), metres. This matches AUH-X-MP Base_2025_UTM.dwg.`,
      "Drawings in the local site grid, such as Xref_C-SPBASE.dwg and AGL.dwg, need transforming before they line up.",
      "Heights: not surveyed, so every point has Z = 0.",
      "Positions come from the field device: check ACCURACY_M, LOC_SOURCE and LOC_CONFIRMED before relying on one.",
      "Dimensions are as entered by the surveyor, in the unit given in DIM_UNIT.",
      "",
      `Manholes included: ${rows.length}`,
      ...Object.keys(counts).map((l) => `  ${l}: ${counts[l]}`),
      "",
      `Left out because they have no location: ${left.length}`,
      ...left.map((s) => `  ${s.ManholePitID || "(no ID)"}  ${s.RecordKey}`),
      ""
    ].join("\r\n");
  }

  async function build(surveys, deviceName) {
    const located = surveys.filter(hasLocation), left = surveys.filter((s) => !hasLocation(s));
    const rows = toRows(located);
    const zip = new JSZip();
    zip.file("Surveyed_Manholes.dxf", toDxf(rows));
    zip.file("Surveyed_Manholes.csv", window.SurveyExport.toCsv(CSV_COLUMNS, rows));
    zip.file("README.txt", readme(rows, left, deviceName));
    return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  }

  return { build, hasLocation, toUtm };
})();
