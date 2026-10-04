-- What a driver looks like, for its 3D model and the box drawings:
--   shape      measured geometry as JSON (cone, surround, dust cap, magnet, bolt circle … in mm)
--   image_url  link to an official product photo (a link only; the photo is the maker's)
ALTER TABLE drivers ADD COLUMN shape TEXT;
ALTER TABLE drivers ADD COLUMN image_url TEXT;

-- The user's own photos of a driver, one per required angle, with the alignment marks they set.
CREATE TABLE driver_media (
  id INTEGER PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  angle TEXT NOT NULL,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  marks TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(driver_id, angle)
);
