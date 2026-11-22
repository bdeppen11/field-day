// /l/:code → the normal app page, with link-preview tags for iMessage, WhatsApp, Slack, etc.
import { leaguePreview, FORMATS, whatCounts, dateText } from "./_shared.js";

export const config = { runtime: "edge" };

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export default async function handler(req) {
  const { searchParams, origin } = new URL(req.url);
  const code = (searchParams.get("code") || "").toLowerCase();
  const [html, L] = await Promise.all([
    fetch(origin + "/index.html").then(r => r.text()),
    leaguePreview(origin, code).catch(() => null)
  ]);
  let tags = "";
  if (L) {
    const n = (L.members || []).length;
    const title = `${L.name} · Field Day`;
    const desc = `${FORMATS[L.format] || ""} · ${whatCounts(L)} · ${dateText(L)} · ${n} player${n === 1 ? "" : "s"}. Tap to see the standings and join.`;
    const bucket = Math.floor(Date.now() / 900000); // new image URL every 15 min
    const img = `${origin}/api/og?code=${encodeURIComponent(code)}&t=${bucket}`;
    tags = `<meta property="og:type" content="website">
<meta property="og:url" content="${origin}/l/${esc(code)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:image" content="${img}">`;
  }
  // Drop the generic og tags and insert the league-specific ones.
  const out = html
    .replace(/<meta property="og:(title|description)"[^>]*>\n?/g, "")
    .replace("</head>", tags + "\n</head>")
    .replace(/<title>[^<]*<\/title>/, L ? `<title>${esc(L.name)} · Field Day</title>` : "$&");
  return new Response(out, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=300" }
  });
}
