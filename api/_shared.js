// Shared helpers for the link-preview functions (Vercel Edge runtime).
const INAT = "https://api.inaturalist.org/v1";
export const FORMATS = { race: "Season race", bigday: "Big Day", rarity: "Rarity points", unique: "Only-you finds" };
export const UNITS = { race: "species", bigday: "species", rarity: "points", unique: "only-you" };

// Read the Supabase URL + publishable key from the site's own public config.js.
export async function siteConfig(origin) {
  const js = await (await fetch(origin + "/config.js")).text();
  const url = (js.match(/supabaseUrl:\s*"([^"]+)"/) || [])[1];
  const key = (js.match(/supabaseKey:\s*"([^"]+)"/) || [])[1];
  return { url, key };
}

export async function leaguePreview(origin, code) {
  if (!/^[a-z0-9]{4,32}$/i.test(code || "")) return null;
  const { url, key } = await siteConfig(origin);
  if (!url || !key) return null;
  const r = await fetch(url + "/rest/v1/rpc/league_preview", {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ p_code: code.toLowerCase() })
  });
  if (!r.ok) return null;
  return await r.json();
}

export const whatCounts = L => ((L.taxa || []).map(t => t.name).join(" + ") || "All life")
  + ((L.exclude_taxa || []).length ? " (minus " + L.exclude_taxa.map(t => t.name).join(", ") + ")" : "");

export function dateText(L) {
  const f = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return L.format === "bigday" ? f(L.d1) : `${f(L.d1)} – ${f(L.d2)}`;
}

const rarityPoints = c => c == null ? 1 : c < 1000 ? 5 : c < 10000 ? 3 : c < 100000 ? 2 : 1;

async function speciesFor(L, login) {
  const q = new URLSearchParams({ user_login: login, d1: L.d1, d2: L.d2, per_page: "500" });
  if (L.taxa?.length) q.set("taxon_id", L.taxa.map(t => t.id).join(","));
  if (L.exclude_taxa?.length) q.set("without_taxon_id", L.exclude_taxa.map(t => t.id).join(","));
  if (L.place?.id) q.set("place_id", L.place.id);
  if (L.patch?.lat != null) { q.set("lat", L.patch.lat); q.set("lng", L.patch.lng); q.set("radius", L.patch.radius_km); }
  if (L.research_grade) q.set("quality_grade", "research"); else q.set("verifiable", "true");
  const r = await fetch(`${INAT}/observations/species_counts?${q}`, { headers: { Accept: "application/json" } });
  if (!r.ok) return null;
  const d = await r.json();
  return (d.results || []).map(x => ({ id: x.taxon?.id, obs: x.taxon?.observations_count }));
}

// Compute standings (first page of each player's species list is plenty for a preview).
export async function standings(L, limit = 12) {
  const members = (L.members || []).filter(m => m.inat_login).slice(0, limit);
  const lists = await Promise.all(members.map(m => speciesFor(L, m.inat_login).catch(() => null)));
  const players = members.map((m, i) => ({ name: m.name || m.inat_login, species: lists[i] || [] }));
  const owners = new Map();
  players.forEach(p => p.species.forEach(s => owners.set(s.id, (owners.get(s.id) || 0) + 1)));
  players.forEach(p => {
    const only = p.species.filter(s => players.length > 1 && owners.get(s.id) === 1).length;
    const pts = p.species.reduce((a, s) => a + rarityPoints(s.obs), 0);
    p.score = L.format === "rarity" ? pts : L.format === "unique" ? only : p.species.length;
  });
  return players.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
