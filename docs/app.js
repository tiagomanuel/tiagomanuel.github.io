// app.js — Travel Planner (JSON local) com zoom por dia, fuzzy finder, relógios e conversor THB↔EUR
let DATA = [];
let map, allMarkersLayer, flightLinesLayer;

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// Polyfill simples para CSS.escape (para ids de data-attr)
if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
  window.CSS = window.CSS || {};
  CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_\-]/g, ch => '\\' + ch);
}

// Paleta por tipo (mapa + legenda)
const TYPE_COLORS = {
  Hotel:'#8b5cf6', Atração:'#22c55e', Aeroporto:'#ef4444',
  Voo:'#f59e0b', Restaurante:'#06b6d4', Transporte:'#475569', Sugestão:'#9ca3af'
};

/* ------------------ Carregamento ------------------ */
async function loadDataFromJSON(){
  const res = await fetch("data.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Não foi possível ler data.json");
  const raw = await res.json();
  DATA = raw.map(normalizeRow).filter(d => d.title);
}
function normalizeRow(r){
  const S = (v) => (v == null ? "" : String(v).trim());
  const N = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };
  const genId = () => { const base = (S(r.type) || "it").slice(0,2).toLowerCase(); return (crypto.randomUUID ? `${base}-${crypto.randomUUID()}` : `${base}-${Math.random().toString(36).slice(2,10)}`); };
  return {
    id: S(r.id) || genId(),
    date: S(r.date).slice(0,10),
    time_start: S(r.time_start), time_end: S(r.time_end),
    title: S(r.title), type: S(r.type), area: S(r.area),
    lat: N(r.lat), lon: N(r.lon),
    lat_from: N(r.lat_from), lon_from: N(r.lon_from),
    lat_to: N(r.lat_to), lon_to: N(r.lon_to),
    notes: S(r.notes),
    flight: { code:S(r.flight_code), from:S(r.flight_from), to:S(r.flight_to), terminal:S(r.terminal) },
    address: S(r.address), url: S(r.url), phone: S(r.phone)
  };
}

/* ------------------ Datas/Intervalo ------------------ */
function listDays(){ return [...new Set(DATA.map(d => d.date))].filter(Boolean).sort(); }
function setTripBounds(){
  const days = listDays();
  if (!days.length) return;
  const min = days[0], max = days[days.length-1];
  const dayInput = $('#flt-day');
  dayInput.min = min; dayInput.max = max;
  if (!dayInput.value) dayInput.value = min;
  $('#current-day').textContent = dayInput.value;
  $('#trip-range').textContent = `${min} → ${max}`;
}

/* ------------------ Mapa ------------------ */
function initMap(){
  // Camada Carto Light (alfabeto latino)
  const cartoLight = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    {
      maxZoom: 20,
      subdomains: 'abcd',
      attribution: '&copy; OSM &copy; CARTO'
    }
  );

  // Criar mapa já com Carto Light
  map = L.map('map', {
    layers: [cartoLight]
  });
  
  L.control.scale().addTo(map);

  // Overlays
  allMarkersLayer  = L.layerGroup().addTo(map);
  flightLinesLayer = L.layerGroup().addTo(map);

  // Legenda (se já tiveres essa função definida)
  buildLegend();
}

function buildLegend(){
  $('#legend').innerHTML = Object.entries(TYPE_COLORS).map(([k,v]) =>
    `<span class="chip"><span class="dot" style="background:${v}"></span>${k}</span>`
  ).join('');
}
function popupHtml(r){
  const time = [r.time_start, r.time_end].filter(Boolean).join(" – ");
  const line1 = `<b>${esc(r.title)}</b>`;
  const line2 = `${esc(r.date || "")} ${esc(time)}`;
  const line3 = esc(r.area || "");
  const flight = r.type==='Voo' ? `<br>${esc(r.flight?.code||"")} · ${esc(r.flight?.from||"")}→${esc(r.flight?.to||"")}${r.flight?.terminal ? " · T:"+esc(r.flight.terminal) : ""}` : "";
  return `${line1}<br>${line2}<br>${line3}${flight}`;
}

/* ------------------ Filtros e dados ------------------ */
function uniqueAreas(){ return [...new Set(DATA.map(d => d.area).filter(Boolean))].sort(); }
function hydrateFilters(){
  // Áreas
  const s = $('#flt-area'); uniqueAreas().forEach(a=>{ const o=document.createElement('option'); o.value=a; o.textContent=a; s.appendChild(o); });
  // Tipos (todos por defeito)
  Array.from($('#flt-type').options).forEach(o => o.selected = true);
}
function activeFilters(){
  const day = $('#flt-day').value || '';
  const showAllDays = $('#sw-all-days').checked;
  const types = Array.from($('#flt-type').selectedOptions).map(o=>o.value);
  const area = $('#flt-area').value || '';
  const q = ($('#flt-q').value || '').toLowerCase();
  const mapFilter = $('#sw-map-filter').checked;
  return { day, showAllDays, types, area, q, mapFilter };
}
function fuzzyMatch(text, query){
  const t = text.toLowerCase(); const q = query.toLowerCase().trim();
  const toks = q.split(/\s+/).filter(Boolean);
  let idx = 0;
  for (const tok of toks){
    const found = t.indexOf(tok, idx);
    if (found === -1) return false;
    idx = found + tok.length;
  }
  return true;
}
function matchesFilters(d, f){
  const okDay  = f.showAllDays || !f.day ? true : d.date === f.day;
  const okType = !f.types.length || f.types.includes(d.type);
  const okArea = !f.area || d.area === f.area;
  const blob   = [d.title, d.notes, d.address, d.flight?.code].filter(Boolean).join(" ").toLowerCase();
  const okQ    = !f.q || fuzzyMatch(blob, f.q);
  return okDay && okType && okArea && okQ;
}
function filteredData(){
  const f = activeFilters();
  return DATA.filter(d => matchesFilters(d, f))
             .sort((a,b)=> (a.date + (a.time_start||"")).localeCompare(b.date + (b.time_start||"")));
}

/* ------------------ Zoom/Enquadramento ------------------ */
function fitToRows(rows){
  const coords = [];
  rows.forEach(r=>{
    if (r.lat != null && r.lon != null) coords.push([r.lat, r.lon]);
    if (r.lat_from!=null && r.lon_from!=null) coords.push([r.lat_from, r.lon_from]);
    if (r.lat_to!=null && r.lon_to!=null) coords.push([r.lat_to, r.lon_to]);
  });
  const b = L.latLngBounds(coords);
  if (b.isValid()) map.fitBounds(b, { padding:[20,20] });
}

/* ------------------ Renderização ------------------ */
function renderMap(){
  const f = activeFilters();
  const rowsFiltered = filteredData();
  allMarkersLayer.clearLayers(); flightLinesLayer.clearLayers();
  const isSel = new Set(rowsFiltered.map(r => r.id));

  // Pontos simples
  DATA.filter(r => r.lat != null && r.lon != null).forEach(r=>{
    const color = TYPE_COLORS[r.type] || '#0d6efd';
    const highlighted = isSel.has(r.id);
    const hide = f.mapFilter && !highlighted;
    if (hide) return;
    const m = L.circleMarker([r.lat, r.lon], {
      radius:7, weight:2, color, fillColor:color,
      fillOpacity: highlighted?0.9:0.25, opacity: highlighted?1:0.4
    }).bindPopup(popupHtml(r));
    m.featureId = r.id;
    m.on('click', ()=> highlightCard(r.id));
    m.addTo(allMarkersLayer);
  });

  // Voos (origem + destino + polyline)
  DATA.filter(r => r.lat_from!=null && r.lon_from!=null && r.lat_to!=null && r.lon_to!=null).forEach(r=>{
    const color = TYPE_COLORS['Voo'] || '#f59e0b';
    const highlighted = isSel.has(r.id);
    const hide = f.mapFilter && !highlighted; if (hide) return;
    const fromM = L.circleMarker([r.lat_from, r.lon_from], {
      radius:6, weight:2, color, fillColor:color,
      fillOpacity: highlighted?0.9:0.25, opacity: highlighted?1:0.4
    }).bindPopup(`<b>${esc(r.title)}</b><br>Partida: ${esc(r.flight?.from || "")}`);
    const toM   = L.circleMarker([r.lat_to, r.lon_to], {
      radius:6, weight:2, color, fillColor:color,
      fillOpacity: highlighted?0.9:0.25, opacity: highlighted?1:0.4
    }).bindPopup(`<b>${esc(r.title)}</b><br>Chegada: ${esc(r.flight?.to || "")}`);
    fromM.featureId = r.id + "-from"; toM.featureId = r.id + "-to";
    fromM.on('click', ()=> highlightCard(r.id));
    toM.on('click',   ()=> highlightCard(r.id));
    L.featureGroup([fromM,toM]).addTo(allMarkersLayer);

    const line = L.polyline([[r.lat_from, r.lon_from],[r.lat_to, r.lon_to]], { weight: highlighted?3:2, opacity: highlighted?0.8:0.25, color });
    line.addTo(flightLinesLayer);
  });

  // Fit: se “aplicar filtros ao mapa” está ativo → focar filtrados; senão → todos
  fitToRows(f.mapFilter ? rowsFiltered : DATA);
}

function renderHighlights(){
  const f = activeFilters();
  const rows = filteredData();
  const hotels  = rows.filter(r => r.type === 'Hotel');
  const flights = rows.filter(r => r.type === 'Voo');
  const nextHotel  = hotels[0];
  const nextFlight = flights[0];
  const countDay = f.showAllDays ? rows.length : DATA.filter(d => d.date === f.day).length;
  $('#current-day').textContent = f.showAllDays ? 'Todos' : (f.day || '—');
  $('#highlights').innerHTML = `
    <div class="tp-card">
      <div><strong>Itens ${f.showAllDays ? '(todos os dias)' : 'no dia'}</strong></div>
      <div style="font-size:1.6rem;">${countDay}</div>
    </div>
    <div class="tp-card">
      <div><strong>Próximo hotel</strong></div>
      <div>${nextHotel ? esc(nextHotel.title) + (nextHotel.time_start ? " — " + esc(nextHotel.time_start) : "") : "—"}</div>
    </div>
    <div class="tp-card">
      <div><strong>Próximo voo</strong></div>
      <div>${nextFlight ? esc(nextFlight.flight?.code || nextFlight.title) : "—"}</div>
    </div>
    <div class="tp-card">
      <div><strong>Área</strong></div>
      <div>${esc($('#flt-area').value || "Todas")}</div>
    </div>
  `;
}

function renderAgenda(){
  const rows = filteredData();
  if (!rows.length){
    $('#agenda').innerHTML = `<div class="tp-empty">Sem itens para os filtros selecionados.</div>`;
    return;
  }
  $('#agenda').innerHTML = rows.map(r=>{
    const time   = [r.time_start, r.time_end].filter(Boolean).join(" – ");
    const flight = r.type === 'Voo' && r.flight
      ? `<div class="tp-meta">${esc(r.flight.code || "")} · ${esc(r.flight.from || "")}→${esc(r.flight.to || "")}${r.flight.terminal ? " · T:" + esc(r.flight.terminal) : ""}</div>`
      : "";
    const url   = r.url   ? `<a href="${escAttr(r.url)}" target="_blank" rel="noopener">Link</a>` : "";
    const phone = r.phone ? `<a href="tel:${escAttr(r.phone)}">${esc(r.phone)}</a>` : "";
    return `
      <div class="tp-item" data-id="${escAttr(r.id)}" data-type="${escAttr(r.type)}">
        <div class="tp-meta">
          <span>${esc(r.date || "")}</span>
          <span>${esc(time)}</span>
          <span class="badge" style="background:${TYPE_COLORS[r.type] || '#eee'}">${esc(r.type)}</span>
          ${r.area ? `<span class="badge">${esc(r.area)}</span>` : ""}
        </div>
        <div class="tp-title">${esc(r.title)}</div>
        ${r.address ? `<div class="tp-meta">${esc(r.address)}</div>` : ""}
        ${flight}
        ${r.notes ? `<div class="mt-1">${esc(r.notes)}</div>` : ""}
        <div class="tp-actions mt-2">
          ${url}
          ${phone}
          <a href="#" data-jump="${escAttr(r.id)}">Ver no mapa</a>
        </div>
      </div>
    `;
  }).join("");

  // Link "Ver no mapa"
  $$('#agenda [data-jump]').forEach(a=>{
    a.addEventListener('click', ev=>{
      ev.preventDefault();
      const id = ev.currentTarget.getAttribute('data-jump');
      jumpTo(id);
    });
  });

  // Clicar no cartão inteiro → centra no mapa (exceto cliques em <a>)
  document.querySelectorAll('.tp-item').forEach(el=>{
    el.addEventListener('click', (ev)=>{
      const tag = ev.target.tagName.toLowerCase();
      if (tag === 'a' || ev.target.closest('a')) return;
      const id = el.getAttribute('data-id');
      jumpTo(id);
    });
  });
}

/* ------------------ Destaque / Pulso / Navegação ------------------ */
function highlightCard(id){
  document.querySelectorAll('.tp-item.active').forEach(x=>x.classList.remove('active'));
  const el = document.querySelector(`.tp-item[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.classList.add('active');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function pulseAt(latlng){
  const pulse = L.circle(latlng, { radius: 120, color: '#2563eb', weight: 2, fillColor:'#2563eb', fillOpacity:0.25 });
  pulse.addTo(map);
  let steps = 10;
  const iv = setInterval(()=>{
    steps--;
    pulse.setRadius(pulse.getRadius() * 1.2);
    pulse.setStyle({ fillOpacity: Math.max(0, pulse.options.fillOpacity - 0.02) });
    if (steps <= 0){ clearInterval(iv); map.removeLayer(pulse); }
  }, 70);
}
function jumpTo(id){
  let centered = false;
  let targetLatLng = null;
  allMarkersLayer.eachLayer(layer=>{
    if (layer.featureId === id || layer.featureId === id + "-from" || layer.featureId === id + "-to"){
      targetLatLng = layer.getLatLng();
      map.setView(targetLatLng, 14);
      layer.openPopup?.();
      centered = true;
    }
  });
  if (!centered){
    const r = DATA.find(d => d.id === id);
    if (r){
      targetLatLng = r.lat != null ? L.latLng(r.lat, r.lon)
                  : r.lat_from != null ? L.latLng(r.lat_from, r.lon_from)
                  : r.lat_to != null ? L.latLng(r.lat_to, r.lon_to)
                  : null;
      if (targetLatLng) map.setView(targetLatLng, 14);
    }
  }
  if (targetLatLng) pulseAt(targetLatLng);
  highlightCard(id);
}
function prevNextDay(dir){
  const days = listDays(); if (!days.length) return;
  const cur = $('#flt-day').value || days[0];
  const idx = Math.max(0, days.indexOf(cur));
  const next = dir < 0 ? Math.max(0, idx-1) : Math.min(days.length-1, idx+1);
  $('#flt-day').value = days[next]; $('#sw-all-days').checked = false;
  refresh(); fitToRows(filteredData());
}

/* ------------------ Fuzzy Finder (dropdown) ------------------ */
function buildSearchIndex(){
  return DATA.map(d => ({
    id: d.id,
    key: [d.title, d.notes, d.address, d.flight?.code, d.area, d.type].filter(Boolean).join(" ").toLowerCase(),
    label: d.title,
    sub: `${d.date || ''} • ${d.area || ''} • ${d.type || ''}`
  }));
}
function setupSearch(){
  const index = buildSearchIndex();
  const box = $('#flt-q'); const panel = $('#search-results');
  function update(){
    const q = box.value.trim();
    if (!q){ panel.hidden = true; panel.innerHTML = ""; refresh(); return; }
    const results = index.filter(it => fuzzyMatch(it.key, q)).slice(0, 10);
    if (!results.length){ panel.hidden = true; panel.innerHTML = ""; return; }
    panel.innerHTML = results.map(r => `
      <div class="tp-search-item" data-id="${escAttr(r.id)}">
        <div>${esc(r.label)}</div>
        <div class="small">${esc(r.sub)}</div>
      </div>
    `).join("");
    panel.hidden = false;
    $$('#search-results .tp-search-item').forEach(el=>{
      el.addEventListener('click', ()=>{
        const id = el.getAttribute('data-id');
        const row = DATA.find(d => d.id === id);
        if (row && row.date){ $('#flt-day').value = row.date; $('#sw-all-days').checked = false; }
        $('#flt-q').value = ""; panel.hidden = true;
        refresh(); fitToRows(filteredData()); jumpTo(id);
      });
    });
  }
  box.addEventListener('input', update);
  box.addEventListener('keydown', (e)=>{ if (e.key === 'Escape'){ panel.hidden = true; } });
  document.addEventListener('click', (e)=>{ if (!panel.contains(e.target) && e.target !== box){ panel.hidden = true; } });
}

/* ------------------ Relógios (TZ) ------------------ */
function tickClocks(){
  const now = new Date();
  $('#clock-lx').textContent  = `Lisboa: ${now.toLocaleString('pt-PT', { timeZone:'Europe/Lisbon', hour:'2-digit', minute:'2-digit', weekday:'short' })}`;
  $('#clock-bkk').textContent = `Bangkok: ${now.toLocaleString('pt-PT', { timeZone:'Asia/Bangkok', hour:'2-digit', minute:'2-digit', weekday:'short' })}`;
}

/* ------------------ Conversor THB↔EUR ------------------ */
async function getRateTHB_EUR(){
  const k = 'rate_thb_eur';
  try{
    const cache = JSON.parse(localStorage.getItem(k) || 'null');
    if (cache && (Date.now() - cache.ts) < 6*60*60*1000) return cache.rate; // 6h
    const r = await fetch('https://api.exchangerate.host/convert?from=THB&to=EUR');
    const j = await r.json();
    const rate = Number(j.result);
    if (Number.isFinite(rate)){
      localStorage.setItem(k, JSON.stringify({ rate, ts: Date.now() }));
      return rate;
    }
  } catch(e){}
  return 0.025; // fallback aproximado
}
function setupConverter(){
  const thb = $('#cc-thb'), eur = $('#cc-eur'), info = $('#cc-rate');
  async function thbToEur(){
    const rate = await getRateTHB_EUR(); info.textContent = `taxa: 1 THB ≈ ${rate.toFixed(5)} EUR`;
    eur.value = (Number(thb.value || 0) * rate).toFixed(2);
  }
  async function eurToThb(){
    const rate = await getRateTHB_EUR(); info.textContent = `taxa: 1 THB ≈ ${rate.toFixed(5)} EUR`;
    thb.value = (Number(eur.value || 0) / rate).toFixed(0);
  }
  $('#cc-thb-eur').addEventListener('click', thbToEur);
  $('#cc-eur-thb').addEventListener('click', eurToThb);
}

/* ------------------ Util ------------------ */
function esc(s){ return String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[m])); }
function escAttr(s){ return esc(s).replace(/"/g, '&quot;'); }
function refresh(){ renderHighlights(); renderAgenda(); renderMap(); }

/* ------------------ Main ------------------ */
async function main(){
  await loadDataFromJSON();
  initMap();
  setTripBounds();
  hydrateFilters();
  setupSearch();
  setupConverter();
  refresh();

  // listeners principais
  ['change','keyup'].forEach(evt=>{
    $('#flt-type').addEventListener(evt, refresh);
    $('#flt-area').addEventListener(evt, refresh);
    $('#flt-q').addEventListener(evt, refresh);
    $('#sw-all-days').addEventListener(evt, ()=>{ refresh(); fitToRows(filteredData()); });
    $('#sw-map-filter').addEventListener(evt, ()=>{ refresh(); fitToRows(filteredData()); });
  });
  // Dia: ao mudar força enquadramento desse dia
  $('#flt-day').addEventListener('change', ()=>{
    $('#sw-all-days').checked = false;
    $('#current-day').textContent = $('#flt-day').value;
    refresh(); fitToRows(filteredData());
  });

  // Botões de dia
  $('#btn-prev').addEventListener('click', ()=> prevNextDay(-1));
  $('#btn-next').addEventListener('click', ()=> prevNextDay(1));

  // “Selecionar todos / nenhum” nos tipos
  $('#btn-types-all').addEventListener('click', ()=>{
    Array.from($('#flt-type').options).forEach(o => o.selected = true);
    refresh(); fitToRows(filteredData());
  });
  $('#btn-types-none').addEventListener('click', ()=>{
    Array.from($('#flt-type').options).forEach(o => o.selected = false);
    refresh(); fitToRows(filteredData());
  });

  // relógios
  tickClocks(); setInterval(tickClocks, 60*1000);
}
document.addEventListener('DOMContentLoaded', main);
