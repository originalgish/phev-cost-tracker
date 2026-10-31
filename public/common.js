export const $ = (id) => document.getElementById(id);

export const when = (sec) => (sec === null ? "—" : new Date(sec * 1000).toLocaleString());

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
