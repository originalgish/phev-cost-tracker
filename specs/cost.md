# Cost

The only price is the fixed-term electricity contract's energy price: 7.87 c/kWh, VAT 25.5 % included, fixed until 2028-02-02. It is a constant in `src/config.ts`, not a setting. The contract has no per-kWh transfer or tax line, and its monthly fee does not depend on charging, so neither is part of session cost.

### COST-1: Cost

Phase: 2. Verified by: test.

Each session's cost shall be billed kWh × 7.87 c.

### COST-2: Billed energy

Phase: 2. Verified by: test.

Billed energy shall be the power estimate when it is usable, which means the session has no gaps and its energy is above zero. Otherwise it shall be the SoC estimate. If neither is usable, billed energy and cost are empty.

### COST-3: Incomplete prices

Phase: 2. Verified by: manual.

Removed: the price is a constant, so it cannot be incomplete.

### COST-4: Recompute

Phase: 2. Verified by: test.

Recomputing shall apply the current price and battery size to every closed session.
