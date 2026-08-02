# Domain Model: Car Mileage Tracker

## Core Entities

### Fuel Entry
A refueling event capturing fuel purchased, cost, and vehicle odometer state.

**Attributes:**
- `id` — unique identifier
- `bunk` — fuel station name
- `date` — refueling date (YYYY-MM-DD)
- `startKM`, `endKM` — odometer readings between previous and this fill
- `incomingKM` — range remaining before this fill (pre-fill range)
- `remainingKM` — range remaining after this fill (post-fill range)
- `fuelAmount` — cost paid (₹)
- `fuelRate` — price per liter
- `fuelQty` — liters purchased (calculated: fuelAmount / fuelRate)
- `projected` — estimated range car can drive on this fuel
- `mileage` — fuel efficiency (km/liter) calculated as effectiveKM / fuelQty
- `user_id` — owner (scoped to authenticated user)

**Calculated Field:**
```
effectiveKM = (endKM - startKM) + remainingKM - incomingKM
mileage = effectiveKM / fuelQty (where fuelQty > 0)
```

### Vehicle
A car or vehicle that the user tracks fuel and trips for.

**Attributes:**
- `id` — unique identifier (UUID)
- `user_id` — owner (foreign key to users.id, scoped to authenticated user)
- `name` — display name (e.g., "Honda Civic", "Work Car")
- `model` — vehicle model (optional, e.g., "2020 Honda Civic")
- `plate` — license plate (optional, for identification)
- `isArchived` — soft-delete flag (default: false); archived vehicles don't appear in UI but data is preserved
- `created_at` — timestamp when vehicle was added
- `updated_at` — timestamp when vehicle was last modified

**Constraints:**
- A vehicle belongs to exactly one user
- Fuel entries and trips are scoped to a vehicle (not just user)

### Trip
A journey between two odometer readings, scoped to a fuel entry (part of a fuel batch).

**Attributes:**
- `id` — unique identifier
- `Fuel_Id` — link to parent fuel entry (foreign key)
- `Date` — trip date (YYYY-MM-DD)
- `StartKM`, `EndKM` — odometer readings for this trip
- `Distance` — distance traveled (calculated: EndKM - StartKM)
- `ToGoKM` — range remaining after this trip (from linked fuel entry)
- `Diff` — delta from previous trip (context/metadata)
- `Notes` — trip notes/purpose
- `Category` — trip purpose tag (e.g., "work", "personal", "leisure")
- `FuelConsumed` — proportional share of fuel entry's total (calculated, see below)
- `Mileage` — trip efficiency (calculated: Distance / FuelConsumed, or NULL if FuelConsumed = 0)
- `user_id` — owner (scoped to authenticated user)
- `vehicle_id` — link to vehicle (foreign key)

## Fuel Batch

A fuel batch = one fuel entry + all trips linked to it. Cardinality: **1 fuel entry → 0..∞ trips**.

### Proportional Fuel Allocation

Each trip's fuel consumption is calculated proportionally by distance:

```
trip.FuelConsumed = fuel.fuelQty × (trip.Distance / fuel.totalDistance)
```

where:
- `fuel.fuelQty` — liters purchased in this fuel entry
- `trip.Distance` — distance traveled in this trip (EndKM - StartKM)
- `fuel.totalDistance` — sum of all trip distances in the batch where Distance > 0

### Zero-Distance Trips

Trips with `Distance = 0` or `Distance IS NULL`:
- Are **excluded from the allocation denominator** (they don't consume fuel)
- Receive `FuelConsumed = 0` or `NULL` (depending on implementation)
- Do not participate in the batch's fuel accounting

### Trip Mileage

Once `FuelConsumed` is known:
```
trip.Mileage = trip.Distance / trip.FuelConsumed  (if FuelConsumed > 0)
trip.Mileage = NULL  (if FuelConsumed = 0)
```

## Vehicle Management

### Current Vehicle Session State

Each user session has a **current vehicle** — the vehicle whose fuel entries and trips are displayed and edited.

**Storage:** `users.lastVehicleId` (persists across devices/browsers for the user)

**Selection Rules:**
1. User logs in → app loads `users.lastVehicleId`
2. If `lastVehicleId` is archived or deleted, fallback to first active (non-archived) vehicle
3. User switches vehicles via dropdown selector → app updates `users.lastVehicleId` and reloads data
4. All fuel entries and trips displayed are filtered to current vehicle + current user

**Mobile UI (iPhone 12 optimized):**
- Vehicle selector in top nav (responsive: below header on mobile, right side on desktop)
- Action buttons (Add Entry, Analytics, etc.) in hamburger menu on mobile; top nav on desktop
- All data scoped to current vehicle

### Vehicle Archive (Soft Delete)

Vehicles can be archived instead of permanently deleted:
- Archived vehicles don't appear in the vehicle selector dropdown
- Historical data (fuel entries, trips) for archived vehicles is preserved
- Users can unarchive a vehicle to bring it back to active status
- Useful for tracking vehicles no longer in use (sold, traded in, etc.)

## Load-Bearing Constraints

### Constraint 1: Atomic Reallocation on Mutation
Any mutation (add/update/delete) to trips or fuel entries in a batch triggers recalculation of `FuelConsumed` for **all** trips in that batch, applied atomically.

**Triggers:**
- User adds a trip to a fuel entry → recalculate all trips in batch
- User updates a trip's distance → recalculate all trips in batch
- User deletes a trip → recalculate remaining trips in batch
- User updates fuel entry's fuelQty or distance totals → recalculate all its trips

### Constraint 2: Backend Ownership
Reallocation logic lives in the Worker (`/api/data` POST handlers for add/update/delete), not the frontend. The frontend is a view; the backend is the source of truth.

### Constraint 3: Single Source of Truth
Fuel entries are the master data. Trips are derived from and scoped to fuel entries. A trip cannot exist without a fuel entry.

## Glossary

- **Vehicle**: A car or vehicle owned by a user, whose fuel and trips are tracked separately.
- **Current Vehicle**: The vehicle whose data (fuel entries, trips) is currently being viewed/edited in the app session.
- **Fuel Batch**: All trips linked to a single fuel entry; the unit of fuel allocation.
- **Effective KM** (fuel entry): Distance accounting for range variance: `(endKM - startKM) + remainingKM - incomingKM`.
- **Proportional Allocation**: Dividing a fuel entry's total fuel among its trips by their distance ratios.
- **FuelConsumed** (trip): The trip's calculated share of the fuel entry's total fuel, based on distance.
- **Zero-Distance Trip**: A trip with Distance = 0 or NULL; excluded from fuel allocation calculations.
- **Archived Vehicle**: A vehicle marked as inactive but whose data is preserved; does not appear in vehicle selector.
