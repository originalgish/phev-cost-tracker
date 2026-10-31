"""One-off probe: dump what the Škoda public API returns for a vehicle.

Usage: SKODA_API_KEY=... SKODA_VIN=... python3 probe.py

The output holds the VIN and GPS position, so it only goes to the git-ignored probe-output.json.
"""
import json
import os
import urllib.error
import urllib.request

BASE = "https://public.api.connect.skoda-auto.cz/api/v1/vehicles"
INCLUDES = ["info", "status", "fuelStatus", "odometer", "parkingPosition", "charging", "chargingProfiles"]

key = os.environ["SKODA_API_KEY"]
vin = os.environ["SKODA_VIN"]
out = "probe-output.json"

url = f"{BASE}/{vin}?" + "&".join(f"include={i}" for i in INCLUDES)
req = urllib.request.Request(url, headers={"X-API-Key": key, "Accept": "application/json"})

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        body, headers, status = resp.read(), resp.headers, resp.status
except urllib.error.HTTPError as e:
    body, headers, status = e.read(), e.headers, e.code

for h in ("X-API-Key-Expires-At", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After"):
    if headers.get(h):
        print(f"{h}: {headers[h]}")
print(f"HTTP {status}")

try:
    data = json.loads(body)
except ValueError:
    data = {"raw": body.decode(errors="replace")}
with open(out, "w") as f:
    json.dump(data, f, indent=2)
print(f"saved to {out}")
