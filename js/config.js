/* Structural Survey Field App - configuration
   Field names and option lists mirror tblSurveys / frmSurvey in the Access database
   so that exported rows can be appended without any mapping. */
window.SURVEY_CONFIG = {
  appName: "Structural Survey",
  version: "1.15.0",

  // Direct upload of the daily export to Google Drive (README: "Set up direct upload to Google Drive").
  // Leave blank to only offer Share to Google Drive / Open Google Drive folder. These values are public by
  // design: Google only accepts them from https://ettehe-bot.github.io and http://localhost:8080.
  googleDrive: {
    clientId: "537640692291-jrjvai84e1em1s9fcg2hp7shkvo0vdc5.apps.googleusercontent.com",   // OAuth client ID
    apiKey: "AIzaSyDwsvefz_ZHSW8KMD_SXhewkNzLA3hthbU",   // API key restricted to the Google Picker API and the app's web address
    appId: "537640692291",                                // Google Cloud project number
    // Export folder every device starts with (Settings can change it). Only people the folder is shared
    // with can open it, so keep its sharing on "Restricted" in Google Drive.
    defaultFolder: { id: "144RH0qzulusuUMF8JYdLYSB8UqthbrWo", name: "EXPORTS" }
  },

  // Offline basemap coverage: Abu Dhabi International (Zayed International) Airport
  bbox: [54.56, 24.37, 54.76, 24.51],          // [minLon, minLat, maxLon, maxLat]
  center: [54.651, 24.433],
  zoom: 13.2,
  minZoom: 10,
  maxZoom: 19,
  basemapFile: "data/auh.pmtiles",
  // Optional CAD layers produced by tools\Build-AUH-Overlay.ps1 (the app works without them)
  drawingBaseFile: "data/basemap.geojson",   // site plan basemap from Xref_C-SPBASE.dwg (display only)
  networksIndex: "data/utilities/index.json", // one layer per utility drawing (Utilites folder), each with its own switch

  // Value lists (identical to the Access combo boxes)
  lists: {
    utility: ["AGL", "Potable Water", "Fire Water", "ICT / comms", "Storm Water", "LV", "HV", "Sewage", "Fuel Hydrant", "Chilled Water", "400Hz", "Other"],
    // Survey list filter only: the old combined value stays searchable but is not offered for new surveys
    utilityFilter: ["AGL", "Potable Water", "Fire Water", "ICT / comms", "Storm Water", "LV", "HV", "Sewage", "Fuel Hydrant", "Chilled Water", "400Hz", "Other", "Potable / Firewater"],
    shape: ["Square", "Circle", "Rectangle"],
    dimUnit: ["m", "mm"],
    coverType: ["F900", "D400", "Other"],
    coverCondition: ["Good", "Fair", "Poor", "Not serviceable"],
    internalCondition: ["Good", "Fair", "Poor", "Not serviceable", "Other"],
    groundCondition: ["No visible issue", "Settlement", "Water Ponding", "Other"],
    yesNo: ["Yes", "No"],
    status: ["Draft", "Complete"]
  },

  // Photo handling
  maxPhotos: 10,
  maxFileBytes: 10485760,       // 10 MB, same as the Access app
  photoMaxEdge: 2048,           // downscale camera images to keep the daily export small
  photoQuality: 0.85,

  // 5a. Internal dimensions required for each manhole shape
  dimsByShape: {
    Square: ["InternalDimLength", "InternalDimDepth"],
    Circle: ["InternalDimDiameter", "InternalDimDepth"],
    Rectangle: ["InternalDimLength", "InternalDimWidth", "InternalDimDepth"]
  },
  dimLabels: { InternalDimLength: "Length", InternalDimWidth: "Width", InternalDimDiameter: "Diameter", InternalDimDepth: "Depth" },

  // 6a. Pit furniture quantities
  furniture: [
    ["FurnitureTransformers", "Transformers"], ["FurnitureAGLRemotes", "AGL Remotes"], ["FurnitureGroundingBar", "Grounding Bar"],
    ["FurnitureCounterpoise", "Counterpoise"], ["FurnitureGroundingRod", "Grounding Rod"], ["FurnitureCableTrays", "Cable Trays"],
    ["FurnitureDrainageSump", "Drainage Sump"], ["FurnitureLadder", "Ladder"], ["FurnitureOther", "Other"]
  ],

  // 6b. Duct arrangement: groups of ducts on each wall
  wallCount: 4,
  ductPositions: ["Top", "Middle", "Bottom"],
  ductSizes: [25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300],   // mm
  maxDuctRows: 8,
  maxDuctsPerRow: 12,

  // File types accepted for the optional asset sketch (same as the Access form)
  sketchTypes: ["jpg", "jpeg", "png", "bmp", "gif", "tif", "tiff", "heic", "heif", "webp", "avif", "pdf", "svg", "dwg", "dxf"],

  // Surveyors package: CAD symbol sizes in metres, and AutoCAD colour numbers for each utility layer
  surveyorPackage: {
    utmZone: 40,
    textHeight: 1.0,
    symbolRadius: 0.5,
    layerColors: {
      "AGL": 30, "Potable Water": 5, "Fire Water": 1, "ICT / comms": 6, "Storm Water": 3, "LV": 2, "HV": 210, "Sewage": 32,
      "Fuel Hydrant": 40, "Chilled Water": 4, "400Hz": 150, "Other": 8, "Potable / Firewater": 140, "Unspecified": 9
    }
  },

  // Column order of surveys.csv - every tblSurveys column except the AutoNumber SurveyID
  surveyColumns: [
    "RecordKey", "SurveyorName", "SurveyDate", "UtilitySurveyed", "UtilityOther",
    "ManholePitID", "ManholeShape", "CoverType", "CoverTypeOther", "CoverCondition",
    "InternalCondition", "InternalConditionOther", "GroundCondition", "GroundConditionOther",
    "Observations", "SketchFileName", "SketchRelativePath", "SketchFileType",
    "SketchFileSizeBytes", "SketchAddedAt", "UrgentRectificationRequired", "Latitude",
    "Longitude", "LocationAccuracyMeters", "LocationCapturedAt", "LocationSource",
    "LocationConfirmed", "SurveyStatus", "CreatedAt", "ModifiedAt", "CompletedAt", "DeviceName",
    "InternalDimLength", "InternalDimWidth", "InternalDimDiameter", "InternalDimDepth", "InternalDimUnit",
    "FurnitureTransformers", "FurnitureAGLRemotes", "FurnitureGroundingBar", "FurnitureCounterpoise", "FurnitureGroundingRod",
    "FurnitureCableTrays", "FurnitureDrainageSump", "FurnitureLadder", "FurnitureOther", "FurnitureOtherDetails",
    "DuctWall1", "DuctWall2", "DuctWall3", "DuctWall4"
  ],

  // Column order of photos.csv - tblSurveyPhotos columns keyed by RecordKey instead of SurveyID
  photoColumns: [
    "RecordKey", "PhotoNumber", "FileName", "RelativePath", "FileType",
    "FileSizeBytes", "CapturedAt", "FileCaption"
  ],

  // Column order of ductwalls.csv - tblDuctWallSketches columns keyed by RecordKey instead of SurveyID
  ductWallColumns: ["RecordKey", "WallNo", "FileName", "RelativePath", "FileType", "FileSizeBytes", "AddedAt"],

  // Column order of ductsections.csv and ductconduits.csv - tblDuctSections and tblDuctConduits, keyed by RecordKey
  ductSectionColumns: ["RecordKey", "WallNo", "SectionName", "DuctSizeMm", "DuctRows", "DuctsPerRow", "CableDiameterMm", "DepthInvertLevelM"],
  ductConduitColumns: ["RecordKey", "WallNo", "SectionName", "RowNo", "DuctNo", "CableCount"],

  // Fields that must be filled before a survey can be marked Complete
  requiredForComplete: [
    ["SurveyorName", "Surveyor name"],
    ["SurveyDate", "Survey date"],
    ["UtilitySurveyed", "Utility surveyed"],
    ["ManholePitID", "Manhole / Pit ID"],
    ["LocationConfirmed", "Location confirmation"],
    ["ManholeShape", "Manhole shape"],
    ["CoverType", "Cover type"],
    ["CoverCondition", "Cover condition"],
    ["InternalCondition", "Internal condition"],
    ["Observations", "Observations"],
    ["UrgentRectificationRequired", "Urgent rectification"]
  ]
};
