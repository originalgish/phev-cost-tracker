export const $ = (id) => document.getElementById(id);

const pad = (n) => String(n).padStart(2, "0");

// The formats of DASH-15, the same whatever the browser's language.
export const dateLabel = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;

export const when = (sec) => {
  if (sec === null) return "—";
  const d = new Date(sec * 1000);
  return `${dateLabel(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// The API sends months as YYYY-MM, and the page shows them as MM.YYYY.
export const monthLabel = (month) => month.split("-").reverse().join(".");

export async function api(path) {
  let res;
  try {
    res = await fetch(path);
  } catch {
    throw new Error("Network error. Check the connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed with HTTP ${res.status}`);
  return data;
}

function showError(text) {
  const status = $("status");
  status.textContent = text;
  status.hidden = false;
  // The message sits at the top, so bring it into view when the user is further down the page.
  status.scrollIntoView({ block: "nearest" });
}

export async function run(task) {
  try {
    await task();
  } catch (err) {
    showError(err.message);
  }
}

export function cells(values, className) {
  const tr = document.createElement("tr");
  if (className) tr.className = className;
  for (const value of values) {
    const td = document.createElement("td");
    td.textContent = value;
    tr.append(td);
  }
  return tr;
}

export function emptyRow(text, span) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = span;
  td.textContent = text;
  tr.append(td);
  return tr;
}
