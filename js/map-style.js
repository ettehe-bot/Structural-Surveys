/* MapLibre style for the Protomaps v4 vector schema (OpenStreetMap data).
   Kept deliberately small: airport apron, runways, taxiways, roads, buildings,
   water and labels. Everything is served from the app's own folder, so it works offline. */
window.buildMapStyle = function (sourceUrl, glyphsUrl) {
  const c = {
    land: "#f2efe9",
    aerodrome: "#e7e5e0",
    industrial: "#ebe7df",
    green: "#d9e6c7",
    sand: "#efe9d8",
    water: "#a6c6e4",
    building: "#d9d3c9",
    buildingLine: "#c5bfb3",
    runway: "#8e8e8e",
    taxiway: "#aaaaaa",
    apron: "#dcdad5",
    highway: "#f5c26b",
    major: "#f9dd9c",
    medium: "#ffffff",
    minor: "#ffffff",
    minorCase: "#d8d4cc",
    path: "#c9c2b3",
    rail: "#b0aaa0",
    text: "#3a3a3a",
    halo: "#ffffff"
  };
  const name = ["coalesce", ["get", "name:en"], ["get", "name"]];

  return {
    version: 8,
    glyphs: glyphsUrl,
    sources: {
      basemap: { type: "vector", url: sourceUrl, attribution: "&copy; OpenStreetMap contributors, Protomaps" }
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": c.land } },
      { id: "earth", type: "fill", source: "basemap", "source-layer": "earth", paint: { "fill-color": c.land } },

      { id: "landcover", type: "fill", source: "basemap", "source-layer": "landcover",
        paint: { "fill-color": ["match", ["get", "kind"],
          ["grassland", "farmland", "forest", "scrub", "wetland"], c.green,
          ["barren", "sand", "glacier"], c.sand, c.land], "fill-opacity": 0.6 } },

      { id: "landuse", type: "fill", source: "basemap", "source-layer": "landuse",
        paint: { "fill-color": ["match", ["get", "kind"],
          ["aerodrome", "airport"], c.aerodrome,
          ["industrial", "commercial", "retail"], c.industrial,
          ["park", "grass", "garden", "golf_course", "cemetery", "recreation_ground", "pitch", "farmland", "forest", "wood", "nature_reserve"], c.green,
          ["sand", "beach", "desert", "quarry"], c.sand,
          ["apron"], c.apron,
          c.land] } },

      { id: "water", type: "fill", source: "basemap", "source-layer": "water",
        filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": c.water } },
      { id: "water_line", type: "line", source: "basemap", "source-layer": "water",
        filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": c.water, "line-width": 1.2 } },

      { id: "buildings", type: "fill", source: "basemap", "source-layer": "buildings", minzoom: 13,
        paint: { "fill-color": c.building, "fill-outline-color": c.buildingLine, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.5, 16, 1] } },

      /* Aeroways: runways and taxiways live in the roads layer in Protomaps v4 */
      { id: "taxiway", type: "line", source: "basemap", "source-layer": "roads",
        filter: ["any", ["==", ["get", "kind"], "taxiway"], ["==", ["get", "kind_detail"], "taxiway"]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.taxiway, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 11, 1, 14, 4, 17, 16] } },
      { id: "runway", type: "line", source: "basemap", "source-layer": "roads",
        filter: ["any", ["==", ["get", "kind"], "runway"], ["==", ["get", "kind_detail"], "runway"]],
        paint: { "line-color": c.runway, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 10, 1.5, 13, 6, 16, 40] } },
      { id: "runway_centreline", type: "line", source: "basemap", "source-layer": "roads", minzoom: 14,
        filter: ["any", ["==", ["get", "kind"], "runway"], ["==", ["get", "kind_detail"], "runway"]],
        paint: { "line-color": "#ffffff", "line-width": 1, "line-dasharray": [6, 6] } },

      /* Roads: casing then fill */
      { id: "minor_case", type: "line", source: "basemap", "source-layer": "roads", minzoom: 13,
        filter: ["in", ["get", "kind"], ["literal", ["minor_road", "medium_road"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.minorCase, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 13, 1.5, 16, 6, 19, 22] } },
      { id: "minor", type: "line", source: "basemap", "source-layer": "roads", minzoom: 12,
        filter: ["==", ["get", "kind"], "minor_road"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.minor, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 12, 0.5, 16, 4, 19, 18] } },
      { id: "medium", type: "line", source: "basemap", "source-layer": "roads", minzoom: 11,
        filter: ["==", ["get", "kind"], "medium_road"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.medium, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 11, 0.8, 16, 5, 19, 20] } },
      { id: "major_case", type: "line", source: "basemap", "source-layer": "roads",
        filter: ["in", ["get", "kind"], ["literal", ["major_road", "highway"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#d9b45f", "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 10, 1.5, 16, 9, 19, 30] } },
      { id: "major", type: "line", source: "basemap", "source-layer": "roads",
        filter: ["==", ["get", "kind"], "major_road"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.major, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 10, 0.8, 16, 7, 19, 26] } },
      { id: "highway", type: "line", source: "basemap", "source-layer": "roads",
        filter: ["==", ["get", "kind"], "highway"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.highway, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 10, 1.2, 16, 7, 19, 26] } },
      { id: "path", type: "line", source: "basemap", "source-layer": "roads", minzoom: 14,
        filter: ["==", ["get", "kind"], "path"],
        paint: { "line-color": c.path, "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.6, 19, 3], "line-dasharray": [3, 2] } },
      { id: "rail", type: "line", source: "basemap", "source-layer": "roads", minzoom: 11,
        filter: ["==", ["get", "kind"], "rail"],
        paint: { "line-color": c.rail, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.8, 19, 4], "line-dasharray": [4, 3] } },

      { id: "boundaries", type: "line", source: "basemap", "source-layer": "boundaries",
        paint: { "line-color": "#b7a9c9", "line-width": 1, "line-dasharray": [4, 2] } },

      /* Labels */
      { id: "road_labels", type: "symbol", source: "basemap", "source-layer": "roads", minzoom: 14,
        filter: ["in", ["get", "kind"], ["literal", ["highway", "major_road", "medium_road", "minor_road", "taxiway", "runway"]]],
        layout: { "symbol-placement": "line", "text-field": ["coalesce", ["get", "name:en"], ["get", "name"], ["get", "ref"]],
          "text-font": ["Noto Sans Regular"], "text-size": 11, "symbol-spacing": 300 },
        paint: { "text-color": c.text, "text-halo-color": c.halo, "text-halo-width": 1.5 } },
      { id: "poi_labels", type: "symbol", source: "basemap", "source-layer": "pois", minzoom: 14,
        filter: ["has", "name"],
        layout: { "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 0.6], "text-anchor": "top", "text-max-width": 8 },
        paint: { "text-color": "#555", "text-halo-color": c.halo, "text-halo-width": 1.5 } },
      { id: "place_labels", type: "symbol", source: "basemap", "source-layer": "places",
        layout: { "text-field": name, "text-font": ["Noto Sans Medium"],
          "text-size": ["match", ["get", "kind"], "locality", 15, "neighbourhood", 12, 13] },
        paint: { "text-color": c.text, "text-halo-color": c.halo, "text-halo-width": 2 } }
    ]
  };
};
