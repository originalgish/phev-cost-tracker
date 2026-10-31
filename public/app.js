const DAY = 86400;
const HOUR = 3600;
const CHART_MONTHS = 12;

// Same keys and ranges as EDITABLE in src/routes.ts.
const SETTINGS = [
  { key: "energy_price_c_per_kwh", label: "Energy price (c/kWh)", type: "number", min: 0, max: 200 },
  { key: "energy_price_includes_vat", label: "Energy price includes VAT", type: "flag" },
  { key: "transfer_price_c_per_kwh", label: "Transfer price (c/kWh)", type: "number", min: 0, max: 200 },
  { key: "transfer_price_includes_vat", label: "Transfer price includes VAT", type: "flag" },
  { key: "electricity_tax_c_per_kwh", label: "Electricity tax (c/kWh)", type: "number", min: 0, max: 200 },
  { key: "electricity_tax_includes_vat", label: "Electricity tax includes VAT", type: "flag" },
  { key: "vat_percent", label: "VAT (%)", type: "number", min: 0, max: 100 },
  { key: "battery_usable_kwh", label: "Usable battery (kWh)", type: "number", min: 1, max: 100 },
  { key: "home_radius_m", label: "Home radius (m)", type: "number", min: 10, max: 1000 },
  { key: "poll_interval_plugged_min", label: "Poll interval when plugged in (min)", type: "number", min: 5, max: 60 },
  { key: "poll_interval_idle_min", label: "Poll interval when idle (min)", type: "number", min: 5, max: 120 },
  { key: "max_gap_min", label: "Longest gap in power data (min)", type: "number", min: 5, max: 240 },
  { key: "session_stale_min", label: "Silent session closes after (min)", type: "number", min: 30, max: 1440 },
  { key: "cost_energy_source", label: "Billed energy source", type: "source" },
];

const $ = (id) => document.getElementById(id);
const now = () => Math.floor(Date.now() / 1000);

const euros = (c) => (c === null ? "—" : (c / 100).toFixed(2));
const kwh = (v) => (v === null ? "—" : v.toFixed(2));
const when = (sec) => (sec === null ? "—" : new Date(sec * 1000).toLocaleString());

function duration(sec) {
  const minutes = Math.max(0, Math.round(sec / 60));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

let state = { settings: null, health: null };
let monthRows = [];
let selectedMonth = null;
let original = {};
let chart = null;

async function api(path, { method = "GET", body } = {}) {
  const init = { method, headers: {} };
  if (method !== "GET") init.headers["Content-Type"] = "application/json";
  if (body !== undefined) init.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error("Network error. Check the connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed with HTTP ${res.status}`);
  return data;
}

function showMessage(text, isError = false) {
  const status = $("status");
  status.textContent = text;
  status.className = isError ? "error" : "";
  status.hidden = false;
  // The message sits at the top, so bring it into view when the user is further down the page.
  status.scrollIntoView({ block: "nearest" });
}

async function run(task) {
  try {
    await task();
  } catch (err) {
    showMessage(err.message, true);
  }
}

function cells(values, className) {
  const tr = document.createElement("tr");
  if (className) tr.className = className;
  for (const value of values) {
    const td = document.createElement("td");
    td.textContent = value;
    tr.append(td);
  }
  return tr;
}

function emptyRow(text, span) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = span;
  td.textContent = text;
  tr.append(td);
  return tr;
}

function renderBanners() {
  const { settings, health } = state;
  const lines = [];
  if (!settings.prices_complete) lines.push("Costs are pending. Fill in all price settings below.");
  if (!settings.home_set) lines.push("Home position not set. Sessions cannot start.");
  if (health.key_expires_at !== null && health.key_expires_at - now() < 14 * DAY) {
    lines.push(`API key expires on ${new Date(health.key_expires_at * 1000).toLocaleDateString()}.`);
  }
  if (health.last_success_at !== null && now() - health.last_success_at > HOUR) {
    lines.push(`No successful poll since ${when(health.last_success_at)}.`);
  }
  $("banners").replaceChildren(
    ...lines.map((text) => {
      const p = document.createElement("p");
      p.className = "banner";
      p.textContent = text;
      return p;
    }),
  );
}

function renderHealth(h) {
  $("h-last-poll").textContent = when(h.last_poll_at);
  $("h-last-success").textContent = when(h.last_success_at);
  $("h-last-captured").textContent = when(h.last_captured_at);
  $("h-key").textContent = when(h.key_expires_at);
  $("h-quota").textContent = h.rate_limit_remaining === null ? "—" : String(h.rate_limit_remaining);
  const rows = h.errors.map((e) => cells([when(e.at), e.kind, e.http_status === null ? "—" : String(e.http_status), e.problem_type ?? "—"]));
  $("errors").replaceChildren(...(rows.length > 0 ? rows : [emptyRow("No errors", 4)]));
}

function select(name, options, current) {
  const node = document.createElement("select");
  node.name = name;
  for (const [value, text] of options) node.append(new Option(text, value));
  node.value = current ?? options[0][0];
  return node;
}

function buildInput(field, current) {
  if (field.type === "flag") {
    return select(field.key, [["", "Not set"], ["true", "Yes"], ["false", "No"]], current ?? "");
  }
  if (field.type === "source") {
    return select(field.key, [["power", "power"], ["soc", "soc"]], current ?? "power");
  }
  const input = document.createElement("input");
  input.name = field.key;
  input.type = "number";
  input.step = "any";
  input.min = String(field.min);
  input.max = String(field.max);
  input.value = current ?? "";
  return input;
}

function renderSettings(values) {
  original = {};
  const labels = [];
  for (const field of SETTINGS) {
    if (!(field.key in values)) continue;
    const current = values[field.key];
    original[field.key] = current ?? "";
    const label = document.createElement("label");
    label.className = "field";
    const name = document.createElement("span");
    name.textContent = field.label;
    label.append(name, buildInput(field, current));
    labels.push(label);
  }
  $("fields").replaceChildren(...labels);
}

function parseField(field, value) {
  if (field.type === "number") {
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) throw new Error(`${field.label}: enter a number.`);
    return n;
  }
  if (field.type === "flag") {
    if (value === "") throw new Error(`${field.label}: choose Yes or No.`);
    return value === "true";
  }
  return value;
}

async function saveSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const changes = {};
  for (const field of SETTINGS) {
    if (!(field.key in original)) continue;
    const value = form.elements[field.key].value;
    if (value === original[field.key]) continue;
    changes[field.key] = parseField(field, value);
  }
  if (Object.keys(changes).length === 0) {
    showMessage("Nothing to save.");
    return;
  }
  const { updated } = await api("/api/settings", { method: "PUT", body: changes });
  showMessage(`Saved ${updated} setting(s). Use Recompute all costs to apply price changes to past sessions.`);
  await refresh(true);
}

function openRow(o) {
  return cells(["Charging now", "—", kwh(o.kwh_by_power), "—", "—", "—", "—", "—", "—", `since ${when(o.started_at)}`], "open");
}

function closedRow(s) {
  return cells([
    when(s.started_at),
    s.ended_at === null ? "—" : duration(s.ended_at - s.started_at),
    kwh(s.kwh_by_power),
    kwh(s.kwh_by_soc),
    s.kwh_used === null ? "—" : `${kwh(s.kwh_used)} (${s.kwh_source})`,
    euros(s.cost_energy_c),
    euros(s.cost_transfer_c),
    euros(s.cost_tax_c),
    euros(s.cost_total_c),
    s.gap_count > 0 ? "gaps in power data" : "",
  ]);
}

async function loadSessions(month) {
  const { sessions } = await api(`/api/sessions?month=${month}`);
  const rows = [];
  const open = state.health.open_session;
  if (open) rows.push(openRow(open));
  // The open session is shown above from the health data, so skip its row here.
  for (const s of sessions) if (s.status === "closed") rows.push(closedRow(s));
  $("sessions").replaceChildren(...(rows.length > 0 ? rows : [emptyRow("No sessions in this month.", 10)]));
}

function renderStats() {
  const m = monthRows.find((row) => row.month === selectedMonth);
  if (!m) return;
  $("stat-cost").textContent = m.total_c === null ? "—" : `${euros(m.total_c)} €`;
  $("stat-kwh").textContent = m.kwh === null ? "—" : `${m.kwh.toFixed(1)} kWh`;
  $("stat-avg").textContent = m.total_c === null || !m.kwh ? "—" : `${(m.total_c / m.kwh).toFixed(1)} c/kWh`;
  $("stat-count").textContent = String(m.sessions);
}

function renderChart() {
  chart?.destroy();
  chart = null;
  if (monthRows.length === 0) return;
  const style = getComputedStyle(document.documentElement);
  const color = (name) => style.getPropertyValue(name).trim();
  const recent = monthRows.slice(0, CHART_MONTHS).reverse();
  Chart.defaults.color = color("--muted");
  Chart.defaults.borderColor = color("--border");
  const series = [
    ["Energy", "energy_c", "--energy"],
    ["Transfer", "transfer_c", "--transfer"],
    ["Tax", "tax_c", "--tax"],
  ];
  chart = new Chart($("chart"), {
    type: "bar",
    data: {
      labels: recent.map((m) => m.month),
      datasets: series.map(([label, field, variable]) => ({
        label,
        data: recent.map((m) => (m[field] ?? 0) / 100),
        backgroundColor: color(variable),
      })),
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, title: { display: true, text: "€" } },
      },
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)} €` } },
      },
    },
  });
}

async function renderMonths(months) {
  monthRows = months;
  const hasMonths = months.length > 0;
  const picker = $("month");
  picker.disabled = !hasMonths;
  picker.replaceChildren(...months.map((m) => new Option(m.month, m.month)));
  $("no-sessions").hidden = hasMonths;
  $("month-details").hidden = !hasMonths;
  if (!hasMonths) {
    selectedMonth = null;
    renderChart();
    return;
  }
  selectedMonth = months.some((m) => m.month === selectedMonth) ? selectedMonth : months[0].month;
  picker.value = selectedMonth;
  renderChart();
  renderStats();
  await loadSessions(selectedMonth);
}

// Settings are rebuilt only when `resetForm` is set, so unsaved edits survive other actions.
async function refresh(resetForm = false) {
  const [settings, health, monthData] = await Promise.all([api("/api/settings"), api("/api/health"), api("/api/months")]);
  state = { settings, health };
  renderBanners();
  renderHealth(health);
  if (resetForm) renderSettings(settings.values);
  await renderMonths(monthData.months);
}

$("month").addEventListener("change", (event) => {
  selectedMonth = event.target.value;
  renderStats();
  run(() => loadSessions(selectedMonth));
});

$("settings").addEventListener("submit", (event) => run(() => saveSettings(event)));

$("recompute").addEventListener("click", () =>
  run(async () => {
    const { updated } = await api("/api/sessions/recompute-cost", { method: "POST" });
    showMessage(`Recomputed costs for ${updated} session(s).`);
    await refresh();
  }),
);

$("home").addEventListener("click", () =>
  run(async () => {
    const replace = state.settings.home_set;
    if (replace && !confirm("A home position is already set. Replace it with the car's current parked position?")) return;
    await api(`/setup/home${replace ? "?force=1" : ""}`, { method: "POST" });
    showMessage("Home position captured.");
    await refresh();
  }),
);

// Chart colours are read from CSS variables, so the chart is redrawn when the scheme changes.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => renderChart());

run(() => refresh(true));
