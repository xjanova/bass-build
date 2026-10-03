-- Timestamps are ISO-8601 UTC strings (yyyy-MM-ddTHH:mm:ss.fffZ).

CREATE TABLE drivers (
  id INTEGER PRIMARY KEY,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  category TEXT NOT NULL,
  kind_th TEXT,
  size_in REAL,
  fs REAL NOT NULL,
  qts REAL,
  qes REAL,
  qms REAL,
  vas_l REAL,
  re REAL,
  le_mh REAL,
  bl REAL,
  mms_g REAL,
  cms_mm_per_n REAL,
  rms REAL,
  sd_cm2 REAL,
  xmax_mm REAL,
  xmech_mm REAL,
  pe_w REAL,
  spl_db REAL,
  z_nom REAL,
  coil TEXT,
  cutout_mm REAL,
  outer_mm REAL,
  depth_mm REAL,
  displacement_l REAL,
  rth_vc REAL,
  tau_vc REAL,
  rth_mag REAL,
  tau_mag REAL,
  source_kind TEXT NOT NULL,
  source_url TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(brand, model)
);
CREATE INDEX ix_drivers_size_model ON drivers(size_in, model);

CREATE TABLE panel_materials (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  name_th TEXT,
  category TEXT,
  density_kg_m3 REAL,
  e_gpa REAL,
  e_cross_gpa REAL,
  poisson REAL,
  loss_factor REAL,
  thicknesses_mm TEXT /* JSON array */,
  sheet_w_mm REAL,
  sheet_h_mm REAL,
  price_per_sheet_thb REAL,
  notes TEXT
);

CREATE TABLE damping_materials (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  name_th TEXT,
  kind TEXT,
  density_kg_m3 REAL,
  flow_resistivity_min REAL,
  flow_resistivity_max REAL,
  fill_g_per_l_min REAL,
  fill_g_per_l_max REAL,
  porosity REAL,
  notes TEXT
);

CREATE TABLE hardware (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  od_mm REAL,
  id_mm REAL,
  verified INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  model_code TEXT,
  revision TEXT NOT NULL DEFAULT 'A',
  data TEXT NOT NULL /* JSON */,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_revisions (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_project_revisions_project ON project_revisions(project_id);

CREATE TABLE measurements (
  id INTEGER PRIMARY KEY,
  driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_measurements_driver ON measurements(driver_id);
CREATE INDEX ix_measurements_project ON measurements(project_id);

CREATE TABLE assets (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  prompt TEXT,
  source TEXT,
  tags TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
