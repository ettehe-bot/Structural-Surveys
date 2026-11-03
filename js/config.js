/* Structural Survey Field App - configuration
   Field names and option lists mirror tblSurveys / frmSurvey in the Access database
   so that exported rows can be appended without any mapping. */
window.SURVEY_CONFIG = {
  appName: "Structural Survey",
  version: "1.2.0",

  // Offline basemap coverage: Abu Dhabi International (Zayed International) Airport
  bbox: [54.56, 24.37, 54.76, 24.51],          // [minLon, minLat, maxLon, maxLat]
  center: [54.651, 24.433],
  zoom: 13.2,
  minZoom: 10,
  maxZoom: 19,
  basemapFile: "data/auh.pmtiles",
  // Optional CAD overlay produced by tools\Convert-Drawing.ps1 (the app works without it)
  overlayFile: "data/overlay.geojson",

  // Value lists (identical to the Access combo boxes)
  lists: {
    utility: ["AGL", "Potable / Firewater", "ICT / comms", "Storm Water", "LV", "HV", "Sewage", "Other"],
    shape: ["Square", "Circle", "Rectangle"],
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

  // Column order of surveys.csv - every tblSurveys column except the AutoNumber SurveyID
  surveyColumns: [
    "RecordKey", "SurveyorName", "SurveyDate", "UtilitySurveyed", "UtilityOther",
    "ManholePitID", "ManholeShape", "CoverType", "CoverTypeOther", "CoverCondition",
    "InternalCondition", "InternalConditionOther", "GroundCondition", "GroundConditionOther",
    "Observations", "SketchFileName", "SketchRelativePath", "SketchFileType",
    "SketchFileSizeBytes", "SketchAddedAt", "UrgentRectificationRequired", "Latitude",
    "Longitude", "LocationAccuracyMeters", "LocationCapturedAt", "LocationSource",
    "LocationConfirmed", "SurveyStatus", "CreatedAt", "ModifiedAt", "CompletedAt", "DeviceName"
  ],

  // Column order of photos.csv - tblSurveyPhotos columns keyed by RecordKey instead of SurveyID
  photoColumns: [
    "RecordKey", "PhotoNumber", "FileName", "RelativePath", "FileType",
    "FileSizeBytes", "CapturedAt", "FileCaption"
  ],

  // Fields that must be filled before a survey can be marked Complete
  requiredForComplete: [
    ["SurveyorName", "Surveyor name"],
    ["SurveyDate", "Survey date"],
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
