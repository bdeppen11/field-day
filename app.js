(() => {
"use strict";
const INAT = "https://api.inaturalist.org/v1";
const CFG = window.FIELD_DAY_CONFIG || {};
const configured = CFG.supabaseUrl && !CFG.supabaseUrl.startsWith("PASTE");
const sb = configured ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey) : null;

const FORMATS = {
  race:   {label:"Season race",    unit:"species",  blurb:"Most species in the date range."},
  bigday: {label:"Big Day",        unit:"species",  blurb:"Most species on a single date."},
  rarity: {label:"Rarity points",  unit:"points",   blurb:"Rarer species are worth more points."},
  unique: {label:"Only-you finds", unit:"only-you", blurb:"Species nobody else in the league found."}
};
const PRESETS = [
  {id:3,name:"Birds"},{id:47126,name:"Plants"},{id:47170,name:"Fungi"},{id:47158,name:"Insects"},
  {id:40151,name:"Mammals"},{id:47178,name:"Ray-finned fishes"},{id:26036,name:"Reptiles"},{id:20978,name:"Amphibians"},
  {id:47224,name:"Butterflies & moths"},{id:1,name:"All animals"}
];

const $ = (s, el=document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const today = () => new Date().toISOString().slice(0,10);
const fmtDate = d => new Date(d+"T12:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});
const view = $("#view");
let session = null, profile = null;

function toast(msg){ const t=$("#toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast.h); toast.h=setTimeout(()=>t.hidden=true,2400); }
function errMsg(e){ return (e && (e.message || e.error_description)) || String(e); }
async function copy(text, label){
  if (navigator.share && /Mobi|iPhone|Android/i.test(navigator.userAgent)) { try { await navigator.share({title:"Field Day", text:"Join my Field Day league", url:text}); return; } catch(e){ if (e.name==="AbortError") return; } }
  try { await navigator.clipboard.writeText(text); toast(label || "Copied"); } catch(e){ window.prompt("Copy this link:", text); }
}

// ---------- Auth & profile ----------
async function loadProfile(){
  profile = null;
  if (!session) return;
  const { data } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  profile = data;
}
function renderNav(){
  const r = location.hash || "#/";
  const link = (h, t) => `<a href="${h}" class="${r.startsWith(h) && h!=="#/" || r===h ? "on":""}">${t}</a>`;
  $("#nav").innerHTML = link("#/explore","Explore") + (session
    ? link("#/me","My leagues") + `<a class="btn primary small" href="#/new">New league</a>`
    : link("#/login","Sign in") + `<a class="btn primary small" href="#/login?next=new">Start a league</a>`);
}
function requireAuth(next){
  if (session) return true;
  location.hash = "#/login?next=" + encodeURIComponent(next || "me");
  return false;
}

// ---------- iNaturalist ----------
const cache = new Map();
async function inat(path, params){
  const url = `${INAT}${path}?${new URLSearchParams(params)}`;
  const hit = cache.get(url);
  if (hit && Date.now()-hit.t < 600000) return hit.v;
  const r = await fetch(url, {headers:{Accept:"application/json"}});
  if (!r.ok) throw new Error("iNaturalist returned " + r.status);
  const v = await r.json();
  cache.set(url, {t:Date.now(), v});
  return v;
}
async function findInatUser(login){
  const u = await inat("/users/autocomplete", {q:login, per_page:10});
  return (u.results||[]).find(x => (x.login||"").toLowerCase() === login.toLowerCase()) || null;
}
function obsParams(L){
  const q = {d1:L.d1, d2:L.d2};
  if (L.taxa?.length) q.taxon_id = L.taxa.map(t=>t.id).join(",");
  if (L.exclude_taxa?.length) q.without_taxon_id = L.exclude_taxa.map(t=>t.id).join(",");
  if (L.place?.id) q.place_id = L.place.id;
  if (L.patch?.lat != null) { q.lat = L.patch.lat; q.lng = L.patch.lng; q.radius = L.patch.radius_km; }
  if (L.research_grade) q.quality_grade = "research"; else q.verifiable = "true";
  return q;
}
async function loadPlayer(L, member){
  const pl = {key:member.user_id, login:member.inat_login, name:member.display_name || member.inat_login || "Player", icon:null, species:[], error:null};
  if (!pl.login) { pl.error = "Hasn't linked iNaturalist yet"; return pl; }
  try {
    const u = await findInatUser(pl.login);
    if (!u) { pl.error = "iNaturalist user @" + pl.login + " not found"; return pl; }
    pl.icon = u.icon_url || null;
    let page = 1, total = Infinity;
    while ((page-1)*500 < total && page <= 10) {
      const d = await inat("/observations/species_counts", {...obsParams(L), user_id:u.id, per_page:500, page});
      total = d.total_results || 0;
      (d.results||[]).forEach(r => { const t = r.taxon || {};
        pl.species.push({id:t.id, sci:t.name, common:t.preferred_common_name || t.name, obs:t.observations_count,
          photo:t.default_photo && t.default_photo.square_url, n:r.count}); });
      page++;
    }
  } catch(e){ pl.error = "Couldn't reach iNaturalist (" + errMsg(e) + ")"; }
  return pl;
}
const rarityPoints = c => c == null ? 1 : c < 1000 ? 5 : c < 10000 ? 3 : c < 100000 ? 2 : 1;
function score(fmt, players){
  const owners = new Map();
  players.forEach(p => p.species.forEach(s => owners.set(s.id, (owners.get(s.id)||0)+1)));
  players.forEach(p => {
    p.species.forEach(s => { s.only = players.length > 1 && owners.get(s.id) === 1; s.pts = rarityPoints(s.obs); });
    p.onlyCount = p.species.filter(s=>s.only).length;
    p.points = p.species.reduce((a,s)=>a+s.pts,0);
    p.score = fmt==="rarity" ? p.points : fmt==="unique" ? p.onlyCount : p.species.length;
  });
  return players.slice().sort((a,b)=>(!!a.error-!!b.error)||(b.score-a.score)||(b.species.length-a.species.length)||a.name.localeCompare(b.name));
}

// ---------- Views ----------
function viewSetup(){
  view.innerHTML = `<div class="card"><h2>Almost there</h2><p>Field Day isn't connected to its database yet. Add the Supabase project URL and publishable key to <code>config.js</code>.</p></div>`;
}

function viewHome(){
  view.innerHTML = `
  <section class="hero">
    <div class="eyebrow">Friendly competition, outdoors</div>
    <h1>Make nature a game with your friends.</h1>
    <p>Field Day turns your iNaturalist sightings into leagues. Pick what counts (all birds, just warblers, fish, mushrooms, anything) and a date range, invite your group chat, and watch the leaderboard update as everyone gets outside.</p>
    <div class="row-wrap"><a class="btn primary" href="${session ? "#/new" : "#/login?next=new"}">Start a league</a><a class="btn" href="#/explore">Browse public leagues</a></div>
  </section>
  <section class="card">
    <h2>How it works</h2>
    <ol class="steps">
      <li><b>Log sightings in iNaturalist</b> like you normally would: snap a photo, upload it.</li>
      <li><b>Link your iNaturalist username</b> to your Field Day account. No extra logging.</li>
      <li><b>Create or join a league.</b> Public leagues are open to anyone; private ones join by invite link, with an optional password.</li>
      <li><b>Compete.</b> Standings come straight from iNaturalist, so new finds show up within minutes.</li>
    </ol>
  </section>
  <section class="grid">
    ${Object.values(FORMATS).map(f=>`<div class="feature"><h3>${f.label}</h3><p>${f.blurb}</p></div>`).join("")}
  </section>
  <section class="card">
    <h2>What can count</h2>
    <p class="muted" style="margin:0">Anything in iNaturalist's tree of life. Mix and match groups, leave some out, and limit to a place.</p>
    <div class="row-wrap">${["All birds","Warblers","Owls + hawks","Fish","Oaks","Mushrooms","Butterflies","Birds, minus gulls","Anything in Massachusetts"].map(x=>`<span class="chip">${x}</span>`).join("")}</div>
  </section>`;
}

function viewLogin(params){
  const next = params.get("next") || "me";
  if (session) { location.hash = "#/" + next; return; }
  let mode = "signin";
  const draw = () => {
    view.innerHTML = `<div class="card" style="max-width:440px;width:100%;margin:24px auto 0">
      <h2>${mode==="signin" ? "Sign in" : "Create your account"}</h2>
      <form id="authForm">
        <label for="a-email">Email<input id="a-email" type="email" autocomplete="email" required></label>
        <label for="a-pass">Password<input id="a-pass" type="password" minlength="6" autocomplete="${mode==="signin"?"current-password":"new-password"}" required></label>
        <div class="err" id="a-err" hidden></div>
        <button class="btn primary" type="submit">${mode==="signin" ? "Sign in" : "Create account"}</button>
      </form>
      <p class="muted" style="margin:0">${mode==="signin" ? "New here?" : "Already have an account?"} <a href="#" id="a-switch">${mode==="signin" ? "Create an account" : "Sign in"}</a></p>
    </div>`;
    $("#a-switch").onclick = e => { e.preventDefault(); mode = mode==="signin" ? "signup" : "signin"; draw(); };
    $("#authForm").onsubmit = async e => {
      e.preventDefault();
      const email = $("#a-email").value.trim(), password = $("#a-pass").value, err = $("#a-err");
      err.hidden = true;
      const fn = mode==="signin" ? sb.auth.signInWithPassword({email,password}) : sb.auth.signUp({email,password,options:{emailRedirectTo: location.origin + location.pathname + "#/me"}});
      const { data, error } = await fn;
      if (error) { err.textContent = error.message; err.hidden = false; return; }
      if (mode==="signup" && !data.session) { err.textContent = "Check your email to confirm your account, then sign in."; err.hidden = false; return; }
      session = data.session; await loadProfile();
      location.hash = (profile && profile.inat_login) ? "#/" + next : "#/me?next=" + encodeURIComponent(next);
    };
  };
  draw();
}

async function viewMe(params){
  if (!requireAuth("me")) return;
  const next = params.get("next");
  view.innerHTML = `<div class="card">
      <div class="row-wrap" style="justify-content:space-between"><h2>Your profile</h2><button class="btn small" id="signout" type="button">Sign out</button></div>
      <form id="pForm">
        <div class="two">
          <label for="p-name">Display name<input id="p-name" maxlength="40" required value="${esc(profile?.display_name)}"></label>
          <label for="p-inat">iNaturalist username <span class="hint">From your iNaturalist profile link</span><input id="p-inat" autocomplete="off" value="${esc(profile?.inat_login || "")}" placeholder="e.g. birdnerd22"></label>
        </div>
        <div class="err" id="p-err" hidden></div>
        <div class="row-wrap"><button class="btn primary" type="submit">Save profile</button><span class="muted" id="p-status"></span></div>
      </form>
    </div>
    <section class="list" id="mine"><h2>Your leagues</h2><div class="empty">Loading…</div></section>`;
  if (!profile?.inat_login) $("#p-status").textContent = "Link your iNaturalist username so your sightings count.";
  $("#signout").onclick = async () => { await sb.auth.signOut(); session = null; profile = null; location.hash = "#/"; };
  $("#pForm").onsubmit = async e => {
    e.preventDefault();
    const err = $("#p-err"); err.hidden = true;
    const name = $("#p-name").value.trim(), login = $("#p-inat").value.trim().replace(/^@/,"");
    let canonical = null;
    if (login) {
      $("#p-status").textContent = "Checking iNaturalist…";
      try { const u = await findInatUser(login); if (!u) { err.textContent = `No iNaturalist user named "${login}".`; err.hidden = false; $("#p-status").textContent=""; return; } canonical = u.login; }
      catch(x){ err.textContent = "Couldn't reach iNaturalist. Try again in a moment."; err.hidden = false; return; }
    }
    const { error } = await sb.from("profiles").update({display_name:name, inat_login:canonical}).eq("id", session.user.id);
    if (error) { err.textContent = error.message; err.hidden = false; return; }
    await loadProfile(); $("#p-status").textContent = "Saved.";
    if (next) location.hash = "#/" + next;
  };
  const { data: rows, error } = await sb.from("league_members").select("league:leagues(*)").eq("user_id", session.user.id);
  const box = $("#mine");
  if (error) { box.innerHTML = `<h2>Your leagues</h2><div class="err">${esc(error.message)}</div>`; return; }
  const leagues = (rows||[]).map(r=>r.league).filter(Boolean).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  box.innerHTML = `<h2>Your leagues</h2>` + (leagues.length ? leagues.map(leagueItem).join("")
    : `<div class="empty">You're not in any leagues yet. <a href="#/new">Start one</a> or <a href="#/explore">find a public league</a>.</div>`);
}

function whatCounts(L){
  const inc = (L.taxa||[]).map(t=>t.name).join(" + ") || "All life";
  const ex = (L.exclude_taxa||[]).length ? " (minus " + L.exclude_taxa.map(t=>t.name).join(", ") + ")" : "";
  return inc + ex;
}
function dateText(L){ return L.format==="bigday" ? fmtDate(L.d1) : `${fmtDate(L.d1)} – ${fmtDate(L.d2)}`; }
function leagueItem(L){
  return `<a class="item" href="#/l/${esc(L.code)}"><div><h3>${esc(L.name)}</h3>
    <div class="meta">${esc(FORMATS[L.format]?.label)} · ${esc(whatCounts(L))} · ${esc(dateText(L))}</div></div>
    <span class="chip${L.visibility==="public"?"":" gold"}">${L.visibility==="public"?"Public":"Private"}</span></a>`;
}

async function viewExplore(){
  view.innerHTML = `<section class="list"><div class="eyebrow">Explore</div><h1 style="font-size:32px">Public leagues</h1><div class="empty">Loading…</div></section>`;
  const { data, error } = await sb.from("leagues").select("*").eq("visibility","public").gte("d2", today()).order("created_at",{ascending:false}).limit(50);
  const box = $(".list", view);
  box.lastElementChild.remove();
  if (error) { box.insertAdjacentHTML("beforeend", `<div class="err">${esc(error.message)}</div>`); return; }
  box.insertAdjacentHTML("beforeend", data.length ? data.map(leagueItem).join("") : `<div class="empty">No public leagues running right now. <a href="${session?"#/new":"#/login?next=new"}">Start the first one.</a></div>`);
}

// Generic iNaturalist search box (taxa or places)
function searchBox(input, results, kind, onPick){
  let t, seq = 0;
  input.addEventListener("input", () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (q.length < 2) { results.hidden = true; return; }
    t = setTimeout(async () => {
      const my = ++seq;
      try {
        const d = await inat(kind==="taxa" ? "/taxa/autocomplete" : "/places/autocomplete", {q, per_page:8});
        if (my !== seq) return;
        const rs = d.results || [];
        results.innerHTML = rs.length ? rs.map((r,i) => kind==="taxa"
          ? `<button type="button" class="result" data-i="${i}">${r.default_photo?`<img src="${esc(r.default_photo.square_url)}" alt="">`:`<span class="ph"></span>`}<span><b>${esc(r.preferred_common_name || r.name)}</b><small>${esc(r.rank)} · <i>${esc(r.name)}</i></small></span></button>`
          : `<button type="button" class="result" data-i="${i}"><span><b>${esc(r.display_name || r.name)}</b></span></button>`).join("")
          : `<div class="result muted">No matches</div>`;
        results.hidden = false;
        results.querySelectorAll("[data-i]").forEach(b => b.onclick = () => {
          const r = rs[+b.dataset.i];
          onPick(kind==="taxa" ? {id:r.id, name: r.preferred_common_name ? `${cap(r.preferred_common_name)}` : r.name} : {id:r.id, name:r.display_name || r.name});
          input.value = ""; results.hidden = true;
        });
      } catch(e){ results.innerHTML = `<div class="result err">Couldn't reach iNaturalist</div>`; results.hidden = false; }
    }, 250);
  });
  document.addEventListener("click", e => { if (!results.contains(e.target) && e.target !== input) results.hidden = true; });
}
const cap = s => s.replace(/(^|\s)\S/g, m => m.toUpperCase());
// Leaflet is loaded as window.L; leagues are also called L inside views, so keep our own handle.
const LF = window.L;
function patchMap(el, patch, onPick){
  if (!LF) { el.hidden = true; return null; }
  el.hidden = false;
  const map = LF.map(el, {scrollWheelZoom:false});
  LF.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom:18, attribution:"&copy; OpenStreetMap contributors"}).addTo(map);
  const style = {color:"#1f5b3a", weight:2, fillColor:"#2f8a57", fillOpacity:.15};
  let circle = null, dot = null;
  const set = p => {
    if (circle) { circle.remove(); dot.remove(); }
    if (!p) { map.setView([42.3, -71.8], 8); return; }
    map.setView([p.lat, p.lng], 12);
    circle = LF.circle([p.lat, p.lng], {...style, radius:p.radius_km*1000}).addTo(map);
    dot = LF.circleMarker([p.lat, p.lng], {radius:5, color:"#1f5b3a", fillColor:"#1f5b3a", fillOpacity:1}).addTo(map);
    map.fitBounds(circle.getBounds(), {padding:[12,12]});
  };
  set(patch);
  if (onPick) map.on("click", e => onPick(+e.latlng.lat.toFixed(4), +e.latlng.lng.toFixed(4)));
  setTimeout(() => map.invalidateSize(), 50);
  return {set};
}

function viewNew(){
  if (!requireAuth("new")) return;
  const st = {taxa:[{id:3,name:"Birds"}], exclude:[], place:null, patch:null};
  const yr = today().slice(0,4);
  view.innerHTML = `<div class="card">
    <div class="eyebrow">New league</div><h1 style="font-size:30px">Set up your league</h1>
    <form id="nForm">
      <label for="n-name">League name<input id="n-name" maxlength="60" required placeholder="Weekend Warblers"></label>
      <label for="n-desc">Description <span class="hint">Optional</span><textarea id="n-desc" maxlength="280" placeholder="House rules, trash talk, prizes…"></textarea></label>
      <div><div class="hint" style="font-weight:600;font-size:13px;margin-bottom:6px">Format</div>
        <div class="opts">${Object.entries(FORMATS).map(([k,f],i)=>`<label class="opt"><input type="radio" name="fmt" value="${k}" ${i===0?"checked":""}><span>${f.label}<small>${f.blurb}</small></span></label>`).join("")}</div></div>
      <div class="card" style="padding:14px;gap:10px">
        <b>What counts</b>
        <div class="row-wrap" id="n-chips"></div>
        <div class="search"><input id="n-taxon" placeholder="Search any group or species: warblers, trout, oaks…" autocomplete="off"><div class="results" id="n-taxon-r" hidden></div></div>
        <div class="row-wrap"><span class="hint">Quick add:</span>${PRESETS.map(p=>`<button type="button" class="btn small" data-preset="${p.id}">${p.name}</button>`).join("")}</div>
        <label class="check" for="n-exmode"><input type="checkbox" id="n-exmode"> Next pick <b>excludes</b> a group instead (e.g. birds, minus gulls)</label>
        <p class="hint" style="margin:0">Leave empty to count all life.</p>
      </div>
      <div class="card" style="padding:14px;gap:10px">
        <b>Where <span class="hint">(optional)</span></b>
        <div class="row-wrap" id="n-where"></div>
        <div class="search"><input id="n-place" placeholder="Limit to a place: Massachusetts, Middlesex County, Acadia…" autocomplete="off"><div class="results" id="n-place-r" hidden></div></div>
        <div class="row-wrap"><button type="button" class="btn small" id="n-patch">Center on my location</button><button type="button" class="btn small" id="n-pick">Pick a spot on a map</button>
          <label style="flex-direction:row;align-items:center;gap:6px" for="n-radius">Radius<input id="n-radius" type="number" min="0.5" max="50" step="0.5" value="5" style="width:80px"> km</label></div>
        <p class="hint" style="margin:0">A patch is one fixed circle that applies to everyone in the league.</p>
        <div id="n-map" class="map" hidden></div><p class="hint" id="n-maphint" style="margin:0" hidden>Tap the map to move the center.</p>
      </div>
      <div class="two">
        <label for="n-d1"><span id="n-d1l">Start date</span><input id="n-d1" type="date" required value="${today()}"></label>
        <label for="n-d2" id="n-d2w">End date<input id="n-d2" type="date" value="${yr}-12-31"></label>
      </div>
      <label class="check" for="n-rg"><input id="n-rg" type="checkbox"> Research-grade only <span class="hint">(community-confirmed IDs; stricter)</span></label>
      <div><div class="hint" style="font-weight:600;font-size:13px;margin-bottom:6px">Who can join</div>
        <div class="opts">
          <label class="opt"><input type="radio" name="vis" value="private" checked><span>Private<small>Join by invite link</small></span></label>
          <label class="opt"><input type="radio" name="vis" value="public"><span>Public<small>Listed on Explore; anyone can join</small></span></label>
        </div></div>
      <label for="n-pass" id="n-passw">Password <span class="hint">Optional extra lock for private leagues</span><input id="n-pass" type="text" autocomplete="off" maxlength="40"></label>
      <div class="err" id="n-err" hidden></div>
      <button class="btn primary" type="submit">Create league</button>
    </form></div>`;
  const drawChips = () => {
    $("#n-chips").innerHTML = st.taxa.map((t,i)=>`<span class="chip">${esc(t.name)}<button type="button" aria-label="Remove" data-rm="t${i}">×</button></span>`).join("")
      + st.exclude.map((t,i)=>`<span class="chip ex">minus ${esc(t.name)}<button type="button" aria-label="Remove" data-rm="x${i}">×</button></span>`).join("")
      || `<span class="muted">All life</span>`;
    $("#n-where").innerHTML = (st.place ? `<span class="chip">${esc(st.place.name)}<button type="button" data-rm="place">×</button></span>` : "")
      + (st.patch ? `<span class="chip">Within ${st.patch.radius_km} km of the pin<button type="button" data-rm="patch">×</button></span>` : "")
      || `<span class="muted">Anywhere</span>`;
    view.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => {
      const k = b.dataset.rm;
      if (k==="place") st.place = null; else if (k==="patch") { st.patch = null; $("#n-map").hidden = true; $("#n-maphint").hidden = true; }
      else if (k[0]==="t") st.taxa.splice(+k.slice(1),1); else st.exclude.splice(+k.slice(1),1);
      drawChips();
    });
  };
  const addTaxon = t => {
    const ex = $("#n-exmode").checked, list = ex ? st.exclude : st.taxa;
    if (!list.some(x=>x.id===t.id)) list.push(t);
    $("#n-exmode").checked = false; drawChips();
  };
  searchBox($("#n-taxon"), $("#n-taxon-r"), "taxa", addTaxon);
  searchBox($("#n-place"), $("#n-place-r"), "places", p => { st.place = p; drawChips(); });
  view.querySelectorAll("[data-preset]").forEach(b => b.onclick = () => addTaxon(PRESETS.find(p=>p.id===+b.dataset.preset)));
  let pm = null;
  const radius = () => Math.min(50, Math.max(0.5, +$("#n-radius").value || 5));
  const setPatch = (lat, lng) => { st.patch = {lat, lng, radius_km:radius(), label:"pin"}; showMap(); drawChips(); };
  const showMap = () => {
    $("#n-map").hidden = false; $("#n-maphint").hidden = false;
    if (!pm) pm = patchMap($("#n-map"), st.patch, setPatch); else pm.set(st.patch);
  };
  $("#n-patch").onclick = () => {
    if (!navigator.geolocation) return toast("Location isn't available in this browser");
    navigator.geolocation.getCurrentPosition(pos => setPatch(+pos.coords.latitude.toFixed(4), +pos.coords.longitude.toFixed(4)),
      () => toast("Couldn't get your location. Pick a spot on the map instead."));
  };
  $("#n-pick").onclick = () => { showMap(); toast("Tap the map to drop the center"); };
  $("#n-radius").onchange = () => { if (st.patch) { st.patch.radius_km = radius(); pm && pm.set(st.patch); drawChips(); } };
  const sync = () => {
    const big = $("input[name=fmt]:checked").value === "bigday";
    $("#n-d2w").hidden = big; $("#n-d1l").textContent = big ? "Big Day date" : "Start date";
    $("#n-passw").hidden = $("input[name=vis]:checked").value !== "private";
  };
  $("#nForm").addEventListener("change", sync); sync(); drawChips();
  $("#nForm").onsubmit = async e => {
    e.preventDefault();
    const err = $("#n-err"); err.hidden = true;
    const fmt = $("input[name=fmt]:checked").value, vis = $("input[name=vis]:checked").value;
    let d1 = $("#n-d1").value, d2 = fmt==="bigday" ? d1 : ($("#n-d2").value || d1);
    if (d2 < d1) [d1, d2] = [d2, d1];
    const { data, error } = await sb.rpc("create_league", {
      p_name:$("#n-name").value.trim(), p_description:$("#n-desc").value.trim(), p_visibility:vis,
      p_password: vis==="private" ? $("#n-pass").value : "", p_format:fmt, p_taxa:st.taxa, p_exclude_taxa:st.exclude,
      p_place:st.place, p_patch:st.patch, p_d1:d1, p_d2:d2, p_research_grade:$("#n-rg").checked });
    if (error) { err.textContent = error.message; err.hidden = false; return; }
    toast("League created"); location.hash = "#/l/" + data.code;
  };
}

async function viewLeague(code){
  view.innerHTML = `<div class="empty">Loading league…</div>`;
  const { data: L } = await sb.from("leagues").select("*").eq("code", code).maybeSingle();
  if (!L) return viewJoin(code);
  const { data: mem } = await sb.from("league_members").select("user_id, profile:profiles(display_name, inat_login)").eq("league_id", L.id);
  const members = (mem||[]).map(m => ({user_id:m.user_id, display_name:m.profile?.display_name, inat_login:m.profile?.inat_login}));
  const isMember = session && members.some(m=>m.user_id===session.user.id);
  const isOwner = session && L.owner_id === session.user.id;
  const invite = location.origin + location.pathname + "#/l/" + L.code;
  view.innerHTML = `
    <section class="lhead">
      <div class="eyebrow">${esc(FORMATS[L.format].label)}</div>
      <h1>${esc(L.name)}</h1>
      ${L.description ? `<p class="muted" style="margin:0;max-width:60ch">${esc(L.description)}</p>` : ""}
      <div class="row-wrap">
        <span class="chip">${esc(whatCounts(L))}</span><span class="chip">${esc(dateText(L))}</span>
        ${L.place ? `<span class="chip">${esc(L.place.name)}</span>` : ""}${L.patch ? `<span class="chip">Within ${L.patch.radius_km} km patch</span>` : ""}
        ${L.research_grade ? `<span class="chip gold">Research grade</span>` : ""}
        <span class="chip${L.visibility==="public"?"":" gold"}">${L.visibility==="public"?"Public":"Private"}${L.has_password?" · password":""}</span>
      </div>
      <div class="row-wrap">
        ${isMember ? `<button class="btn primary" id="l-invite" type="button">Copy invite link</button>` : session
          ? `<button class="btn primary" id="l-join" type="button">Join league</button>` : `<a class="btn primary" href="#/login?next=${encodeURIComponent("l/"+L.code)}">Sign in to join</a>`}
        <button class="btn" id="l-refresh" type="button">Refresh</button>
        ${isMember && !isOwner ? `<button class="btn danger" id="l-leave" type="button">Leave</button>` : ""}
        ${isOwner ? `<a class="btn" href="#/l/${esc(L.code)}/edit">Edit league</a><button class="btn danger" id="l-delete" type="button">Delete league</button>` : ""}
      </div>
      ${L.patch ? `<div id="l-map" class="map" aria-label="Map of the league patch"></div><p class="hint" style="margin:0">Only sightings inside the circle (${L.patch.radius_km} km) count.</p>` : ""}
      <div id="l-confirm"></div>
    </section>
    <section class="board" id="board"></section>
    <section class="card" id="ledger" hidden>
      <div class="row-wrap" style="justify-content:space-between"><h2 id="ledgerTitle" style="font-size:20px"></h2>
        <div class="tabs" id="ledgerTabs"><button class="tab" type="button" data-f="all" aria-pressed="true">All</button><button class="tab" type="button" data-f="only" aria-pressed="false">Only them</button></div></div>
      <div class="species" id="species"></div>
    </section>
    <p class="muted" style="font-size:12px;text-align:center">Data from <a href="https://www.inaturalist.org" target="_blank" rel="noopener">iNaturalist</a>. New sightings can take a few minutes to appear.</p>`;
  if (L.patch) patchMap($("#l-map"), L.patch);
  if ($("#l-invite")) $("#l-invite").onclick = () => copy(invite, "Invite link copied" + (L.has_password ? " (share the password separately)" : ""));
  if ($("#l-join")) $("#l-join").onclick = async () => {
    const { error } = await sb.rpc("join_league", {p_code:L.code});
    if (error) return toast(error.message);
    if (!profile?.inat_login) { toast("Joined! Now link your iNaturalist username."); location.hash = "#/me?next=" + encodeURIComponent("l/"+L.code); return; }
    toast("Joined"); viewLeague(code);
  };
  const confirmBox = (msg, label, fn) => {
    $("#l-confirm").innerHTML = `<div class="card" style="padding:12px;flex-direction:row;align-items:center;flex-wrap:wrap;gap:10px"><span>${msg}</span><button class="btn danger small" id="c-yes" type="button">${label}</button><button class="btn small" id="c-no" type="button">Cancel</button></div>`;
    $("#c-no").onclick = () => $("#l-confirm").innerHTML = ""; $("#c-yes").onclick = fn;
  };
  if ($("#l-leave")) $("#l-leave").onclick = () => confirmBox("Leave this league?", "Leave", async () => {
    await sb.from("league_members").delete().eq("league_id", L.id).eq("user_id", session.user.id); location.hash = "#/me"; });
  if ($("#l-delete")) $("#l-delete").onclick = () => confirmBox("Delete this league for everyone? This can't be undone.", "Delete", async () => {
    const { error } = await sb.from("leagues").delete().eq("id", L.id); if (error) return toast(error.message); toast("League deleted"); location.hash = "#/me"; });
  let ranked = [], selected = null, filter = "all";
  const unit = FORMATS[L.format].unit;
  const drawBoard = () => {
    const max = Math.max(1, ...ranked.map(p=>p.score)); let prev = null, rank = 0;
    $("#board").innerHTML = ranked.length ? ranked.map((p,i) => {
      if (!p.error && p.score !== prev) { rank = i+1; prev = p.score; }
      const av = p.icon ? `<img class="avatar" src="${esc(p.icon)}" alt="">` : `<div class="avatar">${esc((p.name||"?")[0].toUpperCase())}</div>`;
      const sub = p.error ? `<div class="err" style="font-size:13px">${esc(p.error)}</div>` :
        `<div class="sub">@${esc(p.login)} · ${p.species.length} species${p.onlyCount?` · ${p.onlyCount} only-you`:""}</div><div class="bar"><i style="width:${(p.score/max*100).toFixed(1)}%"></i></div>`;
      return `<button type="button" class="prow${!p.error&&rank===1&&p.score>0?" first":""}${selected===p.key?" sel":""}" data-k="${esc(p.key)}">
        <div class="rank">${p.error?"–":rank}</div>${av}<div class="who"><div class="name">${esc(p.name)}</div>${sub}</div>
        <div class="score"><b>${p.error?"–":p.score}</b><span>${unit}</span></div></button>`;
    }).join("") : `<div class="empty">No members yet.</div>`;
    $("#board").querySelectorAll(".prow").forEach(b => b.onclick = () => { selected = b.dataset.k; drawBoard(); drawLedger(); });
  };
  const drawLedger = () => {
    const p = ranked.find(x=>x.key===selected) || ranked.find(x=>!x.error);
    if (!p) { $("#ledger").hidden = true; return; }
    selected = p.key; $("#ledger").hidden = false; $("#ledgerTitle").textContent = `${p.name}'s species`;
    const list = p.species.filter(s => filter==="all" || s.only).sort((a,b)=>(b.only-a.only)||(b.pts-a.pts)||a.common.localeCompare(b.common));
    $("#species").innerHTML = list.length ? list.map(s => `<a class="sp" href="https://www.inaturalist.org/taxa/${s.id}" target="_blank" rel="noopener">
      ${s.photo?`<img src="${esc(s.photo)}" alt="" loading="lazy">`:`<div class="ph"></div>`}
      <div class="t"><b>${esc(cap(s.common||""))}</b><i>${esc(s.sci)}</i><span class="pts">${L.format==="rarity"?`+${s.pts} pt${s.pts>1?"s":""}`:`${s.n} obs`}</span>${s.only?`<span class="only">Only them</span>`:""}</div></a>`).join("")
      : `<div class="empty">${filter==="only" ? "Nothing only this player has yet." : "No species yet. Time to get outside."}</div>`;
  };
  $("#ledgerTabs").onclick = e => { const b = e.target.closest(".tab"); if (!b) return; filter = b.dataset.f;
    $("#ledgerTabs").querySelectorAll(".tab").forEach(t=>t.setAttribute("aria-pressed", t===b)); drawLedger(); };
  const load = async (force) => {
    if (force) cache.clear();
    $("#board").innerHTML = members.map(m=>`<div class="prow"><div class="rank">·</div><div class="avatar"></div><div class="who"><div class="name">${esc(m.display_name||"Player")}</div><div class="sub">Loading sightings…</div></div><div></div></div>`).join("");
    const players = [];
    for (const m of members) players.push(await loadPlayer(L, m));
    ranked = score(L.format, players); drawBoard(); drawLedger();
  };
  $("#l-refresh").onclick = () => load(true);
  load(false);
}

async function viewEdit(code){
  if (!requireAuth("l/" + code + "/edit")) return;
  view.innerHTML = `<div class="empty">Loading…</div>`;
  const { data: L } = await sb.from("leagues").select("*").eq("code", code).maybeSingle();
  if (!L || L.owner_id !== session.user.id) {
    view.innerHTML = `<div class="card"><h2>Only the league owner can edit this league</h2><p><a href="#/l/${esc(code)}">Back to the league</a></p></div>`; return;
  }
  const { data: mem } = await sb.from("league_members").select("user_id, profile:profiles(display_name, inat_login)").eq("league_id", L.id);
  const others = (mem||[]).filter(m => m.user_id !== L.owner_id);
  view.innerHTML = `<div class="card">
    <div class="eyebrow">Edit league</div><h1 style="font-size:30px">${esc(L.name)}</h1>
    <form id="eForm">
      <label for="e-name">League name<input id="e-name" maxlength="60" required value="${esc(L.name)}"></label>
      <label for="e-desc">Description<textarea id="e-desc" maxlength="280">${esc(L.description)}</textarea></label>
      <div><div class="hint" style="font-weight:600;font-size:13px;margin-bottom:6px">Who can join</div>
        <div class="opts">
          <label class="opt"><input type="radio" name="evis" value="private" ${L.visibility==="private"?"checked":""}><span>Private<small>Join by invite link</small></span></label>
          <label class="opt"><input type="radio" name="evis" value="public" ${L.visibility==="public"?"checked":""}><span>Public<small>Listed on Explore; anyone can join</small></span></label>
        </div></div>
      <div class="card" style="padding:14px;gap:10px">
        <b>Password</b>
        <p class="hint" style="margin:0">${L.has_password ? "This league has a password. Members who already joined aren't affected by changes." : "No password. Anyone with the invite link can join."}</p>
        <label for="e-pass">${L.has_password ? "New password" : "Add a password"} <span class="hint">Leave blank to keep as is</span><input id="e-pass" type="text" autocomplete="off" maxlength="40"></label>
        ${L.has_password ? `<label class="check" for="e-nopass"><input type="checkbox" id="e-nopass"> Remove the password</label>` : ""}
      </div>
      <div class="err" id="e-err" hidden></div>
      <div class="row-wrap"><button class="btn primary" type="submit">Save changes</button><a class="btn" href="#/l/${esc(code)}">Cancel</a></div>
    </form>
    <p class="hint" style="margin:0">Format, dates, what counts and location are locked once a league starts, so the rules stay fair for everyone.</p>
  </div>
  <section class="card"><h2 style="font-size:20px">Members</h2><div class="list" id="e-members">
    ${others.length ? others.map(m => `<div class="item" style="padding:10px 14px"><div><b>${esc(m.profile?.display_name || "Player")}</b><div class="meta">${m.profile?.inat_login ? "@" + esc(m.profile.inat_login) : "No iNaturalist username yet"}</div></div>
      <span class="row-wrap" data-u="${esc(m.user_id)}"><button class="btn small danger" type="button" data-rm>Remove</button></span></div>`).join("")
      : `<div class="empty">No other members yet.</div>`}
  </div></section>`;
  $("#e-members").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => {
    const box = b.parentElement;
    box.innerHTML = `<span class="muted" style="font-size:13px">Remove?</span><button class="btn small danger" type="button" data-yes>Remove</button><button class="btn small" type="button" data-no>Cancel</button>`;
    box.querySelector("[data-no]").onclick = () => viewEdit(code);
    box.querySelector("[data-yes]").onclick = async () => {
      const { error } = await sb.rpc("remove_member", {p_league:L.id, p_user:box.dataset.u});
      if (error) return toast(error.message);
      toast("Member removed"); viewEdit(code);
    };
  });
  $("#eForm").onsubmit = async e => {
    e.preventDefault();
    const err = $("#e-err"); err.hidden = true;
    const { error } = await sb.rpc("update_league_info", {p_id:L.id, p_name:$("#e-name").value.trim(), p_description:$("#e-desc").value.trim(), p_visibility:$("input[name=evis]:checked").value});
    if (error) { err.textContent = error.message; err.hidden = false; return; }
    const remove = $("#e-nopass") && $("#e-nopass").checked, pw = $("#e-pass").value;
    if (remove || pw) {
      const { error: pe } = await sb.rpc("set_league_password", {p_id:L.id, p_password: remove ? "" : pw});
      if (pe) { err.textContent = pe.message; err.hidden = false; return; }
    }
    toast("League updated"); location.hash = "#/l/" + code;
  };
}

async function viewJoin(code){
  const { data } = await sb.rpc("league_by_code", {p_code:code});
  const L = data && data[0];
  if (!L) { view.innerHTML = `<div class="card"><h2>League not found</h2><p class="muted">Check the invite link, or ask the league creator for a new one.</p></div>`; return; }
  view.innerHTML = `<div class="card" style="max-width:520px;width:100%;margin:24px auto 0">
    <div class="eyebrow">You're invited</div><h1 style="font-size:30px">${esc(L.name)}</h1>
    ${L.description?`<p class="muted" style="margin:0">${esc(L.description)}</p>`:""}
    <div class="row-wrap"><span class="chip">${esc(FORMATS[L.format]?.label)}</span><span class="chip">${esc(whatCounts(L))}</span><span class="chip">${esc(dateText(L))}</span><span class="chip">${L.member_count} member${L.member_count==1?"":"s"}</span></div>
    ${session ? `<form id="jForm">${L.has_password?`<label for="j-pass">League password<input id="j-pass" required autocomplete="off"></label>`:""}
      <div class="err" id="j-err" hidden></div><button class="btn primary" type="submit">Join league</button></form>`
      : `<a class="btn primary" href="#/login?next=${encodeURIComponent("l/"+code)}">Sign in to join</a>`}
  </div>`;
  if ($("#jForm")) $("#jForm").onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.rpc("join_league", {p_code:code, p_password: $("#j-pass") ? $("#j-pass").value : null});
    if (error) { $("#j-err").textContent = error.message; $("#j-err").hidden = false; return; }
    if (!profile?.inat_login) { location.hash = "#/me?next=" + encodeURIComponent("l/"+code); return; }
    viewLeague(code);
  };
}

// ---------- Router ----------
async function route(){
  renderNav();
  if (!configured) return viewSetup();
  const [path, qs] = (location.hash.slice(1) || "/").split("?");
  const params = new URLSearchParams(qs || "");
  const parts = path.split("/").filter(Boolean);
  window.scrollTo(0,0);
  try {
    if (!parts.length) viewHome();
    else if (parts[0]==="login") viewLogin(params);
    else if (parts[0]==="me") await viewMe(params);
    else if (parts[0]==="explore") await viewExplore();
    else if (parts[0]==="new") viewNew();
    else if (parts[0]==="l" && parts[1] && parts[2]==="edit") await viewEdit(parts[1].toLowerCase());
    else if (parts[0]==="l" && parts[1]) await viewLeague(parts[1].toLowerCase());
    else viewHome();
  } catch(e){ view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="err">${esc(errMsg(e))}</p></div>`; }
}
window.addEventListener("hashchange", route);
(async () => {
  if (sb) {
    const { data } = await sb.auth.getSession();
    session = data.session; await loadProfile();
    sb.auth.onAuthStateChange((_e, s) => { const had = !!session; session = s; if (had !== !!s) loadProfile().then(renderNav); });
  }
  route();
})();
window.__fieldDay = { score, rarityPoints, obsParams };
})();
