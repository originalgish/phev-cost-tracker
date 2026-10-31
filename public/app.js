const DAY = 86400;
const HOUR = 3600;
const CHART_MONTHS = 12;

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

let health = null;
let monthRows = [];
let selectedMonth = null;
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

function renderHealth(h) {
  $("h-last-poll").textContent = when(h.last_poll_at);
  $("h-last-success").textContent = when(h.last_success_at);
  $("h-last-captured").textContent = when(h.last_captured_at);
  $("h-key").textContent = when(h.key_expires_at);
  $("h-quota").textContent = h.rate_limit_remaining === null ? "—" : String(h.rate_limit_remaining);
  const rows = h.errors.map((e) => cells([when(e.at), e.kind, e.http_status === null ? "—" : String(e.http_status), e.problem_type ?? "—"]));
  $("errors").replaceChildren(...(rows.length > 0 ? rows : [emptyRow("No errors", 4)]));
}

function openRow(o) {
  return cells(["Charging now", "—", kwh(o.kwh_by_power), "—", "—", "—", `since ${when(o.started_at)}`], "open");
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
  const open = health.open_session;
  if (open) rows.push(openRow(open));
  // The open session is shown above from the health data, so skip its row here.
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
  const [h, monthData] = await Promise.all([api("/api/health"), api("/api/months")]);
  health = h;
  renderBanners();
  renderHealth(h);
  await renderMonths(monthData.months);
}

$("month").addEventListener("change", (event) => {
  selectedMonth = event.target.value;
  renderStats();
  run(() => loadSessions(selectedMonth));
});

$("recompute").addEventListener("click", () =>
  run(async () => {
    const { updated } = await api("/api/sessions/recompute-cost", { method: "POST" });
    showMessage(`Recomputed costs for ${updated} session(s).`);
    await refresh();
  }),
);

$("home").addEventListener("click", () =>
  run(async () => {
    const replace = health.home_set;
    if (replace && !confirm("A home position is already set. Replace it with the car's current parked position?")) return;
    await api(`/setup/home${replace ? "?force=1" : ""}`, { method: "POST" });
    showMessage("Home position captured.");
    await refresh();
  }),
);

// Chart colours are read from CSS variables, so the chart is redrawn when the scheme changes.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => renderChart());

run(refresh);
