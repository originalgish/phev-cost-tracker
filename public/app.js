import { $, api, cells, emptyRow, run, when } from "./common.js";

const DAY = 86400;
const HOUR = 3600;
const CHART_MONTHS = 12;

const now = () => Math.floor(Date.now() / 1000);

const euros = (c) => (c === null ? "—" : (c / 100).toFixed(2));
const kwh = (v) => (v === null ? "—" : v.toFixed(2));

function duration(sec) {
  const minutes = Math.max(0, Math.round(sec / 60));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

let health = null;
let monthRows = [];
let selectedMonth = null;
let chart = null;

function renderBanners() {
  const lines = [];
  if (!health.home_set) lines.push("Home position not set. Sessions cannot start.");
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

const CHARGE_STATES = {
  CHARGING: "Charging",
  READY_FOR_CHARGING: "Ready to charge",
  CONNECT_CABLE: "Not plugged in",
  CONSERVING: "Conserving",
  CHARGING_INTERRUPTED: "Interrupted",
  DISCHARGING: "Discharging",
};

const present = (v) => v !== null && v !== undefined;
const withUnit = (v, unit) => (present(v) ? `${v} ${unit}` : "—");
const chargeState = (key) => (present(key) ? (CHARGE_STATES[key] ?? key.charAt(0) + key.slice(1).toLowerCase().replaceAll("_", " ")) : "—");

function timeLeft(minutes) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} h left`;
}

function renderCar(car) {
  const parts = Object.values(car);
  $("no-car").hidden = parts.length > 0;
  $("car").hidden = parts.length === 0;
  const c = car.charging ?? {};
  const charging = c.state === "CHARGING";
  $("car-range").textContent = withUnit(car.fuelStatus?.total_range_km, "km");
  $("car-fuel").textContent = `Fuel ${withUnit(car.fuelStatus?.fuel_percent, "%")}`;
  $("car-battery").textContent = present(c.soc_percent) ? `${c.soc_percent} % / ${withUnit(c.range_km, "km")}` : "—";
  const detail = [`Target ${withUnit(c.target_soc_percent, "%")}`, chargeState(c.state)];
  if (charging && present(c.power_kw)) detail.push(`${c.power_kw} kW`);
  if (charging && present(c.minutes_to_full)) detail.push(timeLeft(c.minutes_to_full));
  $("car-charge").textContent = detail.join(" · ");
  $("car-odometer").textContent = withUnit(car.odometer?.km?.toLocaleString(), "km");
  const newest = Math.max(0, ...parts.map((p) => p.captured_at ?? 0));
  $("car-updated").textContent = newest > 0 ? `Updated ${when(newest)}` : "";
}

function renderOpen() {
  const o = health.open_session;
  $("charging-now").hidden = !o;
  if (o) $("charging-now").textContent = `Charging now · since ${when(o.started_at)} · ${kwh(o.kwh_by_power)} kWh by power`;
}

function closedRow(s) {
  return cells([
    when(s.started_at),
    s.ended_at === null ? "—" : duration(s.ended_at - s.started_at),
    kwh(s.kwh_by_power),
    kwh(s.kwh_by_soc),
    s.kwh_used === null ? "—" : `${kwh(s.kwh_used)} (${s.kwh_source})`,
    euros(s.cost_c),
    s.gap_count > 0 ? "gaps in power data" : "",
  ]);
}

async function loadSessions(month) {
  const { sessions } = await api(`/api/sessions?month=${month}`);
  const rows = [];
  // The open session is shown by renderOpen, so skip its row here.
  for (const s of sessions) if (s.status === "closed") rows.push(closedRow(s));
  $("sessions").replaceChildren(...(rows.length > 0 ? rows : [emptyRow("No sessions in this month.", 7)]));
}

function renderStats() {
  const m = monthRows.find((row) => row.month === selectedMonth);
  if (!m) return;
  $("stat-cost").textContent = m.cost_c === null ? "—" : `${euros(m.cost_c)} €`;
  $("stat-kwh").textContent = m.kwh === null ? "—" : `${m.kwh.toFixed(1)} kWh`;
  $("stat-avg").textContent = m.cost_c === null || !m.kwh ? "—" : `${(m.cost_c / m.kwh).toFixed(1)} c/kWh`;
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
  chart = new Chart($("chart"), {
    type: "bar",
    data: {
      labels: recent.map((m) => m.month),
      datasets: [{ label: "Cost", data: recent.map((m) => (m.cost_c ?? 0) / 100), backgroundColor: color("--cost") }],
    },
    options: {
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, title: { display: true, text: "€" } } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y.toFixed(2)} €` } },
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

async function refresh() {
  const [h, monthData, car] = await Promise.all([api("/api/health"), api("/api/months"), api("/api/vehicle")]);
  health = h;
  renderCar(car);
  renderBanners();
  renderOpen();
  await renderMonths(monthData.months);
}

$("month").addEventListener("change", (event) => {
  selectedMonth = event.target.value;
  renderStats();
  run(() => loadSessions(selectedMonth));
});

// Chart colours are read from CSS variables, so the chart is redrawn when the scheme changes.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => renderChart());

run(refresh);
