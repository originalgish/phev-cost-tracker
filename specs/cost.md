# Cost

All prices are settings in cents per kWh. None are hard-coded in logic.

### COST-1: Cost by component

Phase: 2. Verified by: test.

Each session's energy, transfer and tax cost shall be `kWh × price`. VAT at `vat_percent` shall be added only to a component whose `*_includes_vat` flag is false. The total is the sum of the three.

### COST-2: Billed energy

Phase: 2. Verified by: test.

Billed energy shall come from `cost_energy_source` (default `power`). The power estimate is usable only when the session has no gaps and its energy is above zero. If the preferred source is unusable, the tracker shall use the other. If neither is usable, billed energy is empty.

### COST-3: Incomplete prices

Phase: 2. Verified by: test.

While any price, `*_includes_vat` flag or `vat_percent` is unset, cost shall stay empty and energy shall still be recorded.

### COST-4: Recompute

Phase: 2. Verified by: test.

Recomputing shall apply the current prices, `battery_usable_kwh` and `cost_energy_source` to every closed session.
