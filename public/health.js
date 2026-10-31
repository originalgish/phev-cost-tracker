import { $, api, cells, emptyRow, run, when } from "./common.js";

function renderHealth(h) {
  $("h-last-poll").textContent = when(h.last_poll_at);
  $("h-last-success").textContent = when(h.last_success_at);
  $("h-last-captured").textContent = when(h.last_captured_at);
  $("h-key").textContent = when(h.key_expires_at);
  $("h-quota").textContent = h.rate_limit_remaining === null ? "—" : String(h.rate_limit_remaining);
  const rows = h.errors.map((e) => cells([when(e.at), e.kind, e.http_status === null ? "—" : String(e.http_status), e.problem_type ?? "—"]));
  $("errors").replaceChildren(...(rows.length > 0 ? rows : [emptyRow("No errors", 4)]));
}

run(async () => renderHealth(await api("/api/health")));
