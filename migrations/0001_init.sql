-- Fuel log entries (mirrors the "Sheet1" Google Sheet)
CREATE TABLE IF NOT EXISTS fuel_entries (
  id            TEXT PRIMARY KEY,
  bunk          TEXT,
  date          TEXT,
  startKM       REAL,
  endKM         REAL,
  incomingKM    REAL,
  remainingKM   REAL,
  fuelAmount    REAL,
  fuelRate      REAL,
  fuelQty       REAL,
  projected     REAL
);

-- Fuel trips (mirrors the "Trips" Google Sheet)
CREATE TABLE IF NOT EXISTS trips (
  id       TEXT PRIMARY KEY,
  Fuel_Id  TEXT,
  Date     TEXT,
  StartKM  REAL,
  EndKM    REAL,
  Distance REAL,
  ToGoKM   REAL,
  Diff     REAL,
  Notes    TEXT
);
