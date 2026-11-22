// Standings image for link previews: /api/og?code=XXXX  (1200x630 PNG)
import { ImageResponse } from "@vercel/og";
import { leaguePreview, standings, FORMATS, UNITS, whatCounts, dateText } from "./_shared.js";

export const config = { runtime: "edge" };

const C = { bg: "#0f1712", card: "#17221b", ink: "#e4ede6", muted: "#9aab9f", line: "#2b3a30", forest: "#6fc293", gold: "#f2c94c" };
const h = (type, style, children) => ({ type, props: { style: { display: "flex", ...style }, children } });

export default async function handler(req) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code") || "";
  let L = null, rows = [];
  try { L = await leaguePreview(origin, code); if (L) rows = await standings(L); } catch (e) { L = null; }

  const title = L ? L.name : "Field Day";
  const sub = L ? `${FORMATS[L.format] || ""} · ${whatCounts(L)} · ${dateText(L)}` : "Friendly species-spotting leagues with your friends";
  const max = Math.max(1, ...rows.map(r => r.score));
  const top = rows.slice(0, 3);
  const unit = L ? UNITS[L.format] || "species" : "";

  const board = top.length
    ? top.map((r, i) => h("div", { alignItems: "center", gap: 24, padding: "10px 24px", flexShrink: 0, background: C.card, borderRadius: 18, border: `2px solid ${i === 0 ? C.gold : C.line}` }, [
        h("div", { width: 44, flexShrink: 0, fontSize: 34, fontWeight: 700, color: i === 0 ? C.gold : C.muted }, String(i + 1)),
        h("div", { flexDirection: "column", flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, gap: 8 }, [
          h("div", { fontSize: 28, color: C.ink, fontWeight: 600 }, r.name.slice(0, 28)),
          h("div", { height: 10, width: "100%", background: C.line, borderRadius: 5 }, [
            h("div", { height: 10, width: `${Math.max(2, (r.score / max) * 100)}%`, background: i === 0 ? C.gold : C.forest, borderRadius: 5 }, [])
          ])
        ]),
        h("div", { flexDirection: "column", alignItems: "flex-end", width: 150, flexShrink: 0 }, [
          h("div", { fontSize: 38, fontWeight: 700, color: C.ink, lineHeight: 1 }, String(r.score)),
          h("div", { fontSize: 20, color: C.muted }, unit)
        ])
      ]))
    : [h("div", { fontSize: 32, color: C.muted, padding: "20px 0" }, L ? "No sightings yet. Time to get outside." : "Make nature a game with your friends.")];

  const el = h("div", { width: "100%", height: "100%", background: C.bg, padding: "44px 60px", flexDirection: "column", gap: 16, fontFamily: "sans-serif" }, [
    h("div", { fontSize: 24, color: C.forest, fontWeight: 700, letterSpacing: 3, flexShrink: 0 }, "FIELD DAY"),
    h("div", { fontSize: 56, color: C.ink, fontWeight: 700, lineHeight: 1.2, flexShrink: 0 }, title.slice(0, 40)),
    h("div", { fontSize: 26, color: C.muted, flexShrink: 0 }, sub.slice(0, 90)),
    h("div", { flexDirection: "column", gap: 10, marginTop: 6, flexShrink: 0 }, board),
    rows.length > 3 ? h("div", { fontSize: 22, color: C.muted, flexShrink: 0 }, `+${rows.length - 3} more player${rows.length - 3 === 1 ? "" : "s"}`) : h("div", {}, [])
  ]);

  return new ImageResponse(el, {
    width: 1200, height: 630,
    headers: { "Cache-Control": "public, max-age=0, s-maxage=900, stale-while-revalidate=3600" }
  });
}
