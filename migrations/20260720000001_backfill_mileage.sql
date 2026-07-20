-- Backfill mileage snapshot for all existing fuel entries.
-- effectiveKM = (endKM - startKM) + remainingKM - incomingKM
UPDATE fuel_entries
SET mileage = ROUND(
  ((endKM - startKM) + COALESCE(remainingKM, 0) - COALESCE(incomingKM, 0)) / fuelQty, 2
)
WHERE fuelQty IS NOT NULL AND fuelQty > 0
  AND endKM IS NOT NULL AND startKM IS NOT NULL
  AND mileage IS NULL;

-- Backfill Mileage snapshot for all existing trips from their linked fuel entry.
UPDATE trips
SET Mileage = (
  SELECT ROUND(
    ((fe.endKM - fe.startKM) + COALESCE(fe.remainingKM, 0) - COALESCE(fe.incomingKM, 0)) / fe.fuelQty, 2
  )
  FROM fuel_entries fe
  WHERE fe.id = trips.Fuel_Id
    AND fe.fuelQty IS NOT NULL AND fe.fuelQty > 0
    AND fe.endKM IS NOT NULL AND fe.startKM IS NOT NULL
)
WHERE trips.Fuel_Id IS NOT NULL AND trips.Mileage IS NULL;
