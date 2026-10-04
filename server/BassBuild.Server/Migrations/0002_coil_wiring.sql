-- How the two coils of a dual-voice-coil driver were wired when its T/S were measured:
-- 'series' or 'parallel' (NULL for single-coil drivers, or when the datasheet does not say).
ALTER TABLE drivers ADD COLUMN coil_wiring TEXT;
