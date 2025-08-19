let state = {
  data: [],
  currentDate: null,
  filters: { type: [], area: [] }
};

const tipoCores = {
  "Atração": "#2E86AB",
  "Restaurante": "#DA4167",
  "Hotel": "#00A676",
  "Transporte": "#FF914D",
  "Voo": "#BC5090",
  "Sugestão": "#888",
  "Outro": "#555"
};

function corParaTipo(tipo) {
  return tipoCores[tipo] || "#888";
}

async function carregarDados() {
  const resp = await fetch("data.json");
  const dados = await resp.json();
  dados.forEach(d => d.dateObj = new Date(d.date));
  return dados;
}

function diasUnicos(dados) {
  const set = new Set(dados.map(d => d.date));
  return Array.from(set).sort();
}

function initFilters(dados) {
  const types = [...new Set(dados.map(d => d.type).filter(Boolean))];
  const areas = [...new Set(dados.map(d => d.area).filter(Boolean))];
  const typeSel = document.getElementById("filter-type");
  const areaSel = document.getElementById("filter-area");

  types.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    typeSel.appendChild(opt);
  });

  areas.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a;
    opt.textContent = a;
    areaSel.appendChild(opt);
  });

  typeSel.onchange = () => {
    state.filters.type = Array.from(typeSel.selectedOptions).map(o => o.value);
    showDay(state.currentDate);
  };

  areaSel.onchange = () => {
    state.filters.area = Array.from(areaSel.selectedOptions).map(o => o.value);
    showDay(state.currentDate);
  };
}

function filtrar(dados) {
  return dados.filter(d => {
    const byDate = d.date === state.currentDate;
    const byType = state.filters.type.length === 0 || state.filters.type.includes(d.type);
    const byArea = state.filters.area.length === 0 || state.filters.area.includes(d.area);
    return byDate && byType && byArea;
  });
}

function criarCard(item) {
  const card = document.createElement("div");
  card.className = "tp-item";
  card.dataset.type = item.type || "Sugestao";

  card.innerHTML = `
    <h3>${item.title || "(sem título)"}</h3>

    <div class="tp-meta">
      ${item.type ? `<span class="badge" style="background:${corParaTipo(item.type)};">${item.type}</span>` : ""}
      ${item.area ? `<span class="area">${item.area}</span>` : ""}
    </div>

    ${(item.time_start || item.time_end) ? `<p class="time">🕒 ${item.time_start || ""} – ${item.time_end || ""}</p>` : ""}

    ${item.notes ? `<div class="tp-item-notes">📝 ${item.notes}</div>` : ""}

    ${item.address ? `<p class="address">📍 ${item.address}</p>` : ""}
    ${item.phone ? `<p class="phone">📞 ${item.phone}</p>` : ""}

    <div class="btn-group">
      ${item.lat && item.lon ? `<a href="https://www.google.com/maps?q=${item.lat},${item.lon}" target="_blank">🌍 Ver no Maps</a>` : ""}
      ${(item.lat_from && item.lon_from && item.lat_to && item.lon_to) ?
        `<a href="https://www.google.com/maps/dir/?api=1&origin=${item.lat_from},${item.lon_from}&destination=${item.lat_to},${item.lon_to}" target="_blank">🚣 Itinerário</a>` : ""}
      ${item.url ? `<a href="${item.url}" target="_blank">🔗 Website</a>` : ""}
      ${item.lat && item.lon ? `<a href="#" onclick="rotaAtual(${item.lat},${item.lon}); return false;">🚶 Como chegar</a>` : ""}
    </div>
  `;

  card.onclick = () => {
    if (item.lat && item.lon) {
      map.setView([item.lat, item.lon], 15);
      layerGroup.eachLayer(layer => {
        if (layer.getLatLng && layer.getLatLng().lat === item.lat && layer.getLatLng().lng === item.lon) {
          layer.openPopup();
        }
      });
    }
  };

  return card;
}

function renderAgenda(filtered) {
  const agendaDiv = document.getElementById("agenda");
  agendaDiv.innerHTML = "";

  if (filtered.length === 0) {
    agendaDiv.innerHTML = "<p>Sem eventos para este dia.</p>";
    return;
  }

  const agrupadoPorData = {};
  filtered.forEach(item => {
    if (!agrupadoPorData[item.date]) agrupadoPorData[item.date] = [];
    agrupadoPorData[item.date].push(item);
  });

  Object.entries(agrupadoPorData).forEach(([data, eventos]) => {
    const dataHeader = document.createElement("h2");
    const dataFormatada = new Date(data).toLocaleDateString("pt-PT", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric"
    });
    dataHeader.textContent = `📅 ${dataFormatada}`;
    agendaDiv.appendChild(dataHeader);

    const grupos = {
      "☀️ Manhã": [],
      "🌤️ Tarde": [],
      "🌙 Noite": [],
      "❓ Sem hora definida": []
    };

    eventos.forEach(item => {
      if (!item.time_start) {
        grupos["❓ Sem hora definida"].push(item);
        return;
      }

      const [h, m] = item.time_start.split(":" ).map(n => parseInt(n));
      const minutos = h * 60 + m;

      if (minutos < 720) grupos["☀️ Manhã"].push(item);
      else if (minutos < 1080) grupos["🌤️ Tarde"].push(item);
      else grupos["🌙 Noite"].push(item);
    });

    for (const [periodo, lista] of Object.entries(grupos)) {
      if (lista.length === 0) continue;

      const periodoHeader = document.createElement("h3");
      periodoHeader.textContent = periodo;
      agendaDiv.appendChild(periodoHeader);

      lista.sort((a, b) => {
        const ha = a.time_start || "99:99";
        const hb = b.time_start || "99:99";
        return ha.localeCompare(hb);
      });

      lista.forEach(item => agendaDiv.appendChild(criarCard(item)));
    }
  });
}

let map, layerGroup;

function initMap() {
  map = L.map("map");
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> | <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);
  layerGroup = L.layerGroup().addTo(map);
}

function renderMap(filtered) {
  layerGroup.clearLayers();
  let bounds = [];

  filtered.forEach(item => {
    if (item.lat && item.lon) {
      const popupParts = [];

      popupParts.push(`<strong style="color:${corParaTipo(item.type)};">${item.title || "(sem título)"}</strong>`);

      if (item.type) popupParts.push(`<div><span style="background:${corParaTipo(item.type)};color:white;padding:2px 6px;border-radius:4px;font-size:0.75rem;">${item.type}</span></div>`);
      if (item.area) popupParts.push(`<div style="font-size:0.8rem;color:#555;">${item.area}</div>`);
      if (item.time_start || item.time_end) popupParts.push(`<div><small>🕒 ${item.time_start || ""}–${item.time_end || ""}</small></div>`);
      if (item.notes) popupParts.push(`<div style="margin-top:4px;font-size:0.85rem;">📝 ${item.notes}</div>`);
      if (item.address) popupParts.push(`<div style="font-size:0.85rem;">📍 ${item.address}</div>`);
      if (item.lat && item.lon) popupParts.push(`<div style="margin-top:6px;"><a href="https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lon}" target="_blank" style="text-decoration:none;color:${corParaTipo(item.type)};">🚶 Como chegar</a></div>`);

      const marker = L.circleMarker([item.lat, item.lon], {
        radius: 8,
        fillColor: corParaTipo(item.type),
        color: "#222",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.9
      }).bindPopup(popupParts.join(""));

      layerGroup.addLayer(marker);
      bounds.push([item.lat, item.lon]);
    }

    if (item.lat_from && item.lon_from && item.lat_to && item.lon_to) {
      const coords = [[item.lat_from, item.lon_from], [item.lat_to, item.lon_to]];
      L.polyline(coords, {
        color: corParaTipo(item.type),
        weight: 3,
        opacity: 0.7,
        dashArray: "4,6"
      }).addTo(layerGroup);
      bounds.push(...coords);
    }
  });

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
  }

  if (!map.legendControl) {
    const legend = L.control({ position: "bottomright" });
    legend.onAdd = function () {
      const div = L.DomUtil.create("div", "info legend");
      div.innerHTML = "<strong>Legenda</strong><br>";
      for (const [tipo, cor] of Object.entries(tipoCores)) {
        div.innerHTML += `<i style="background:${cor};border-radius:50%;width:10px;height:10px;display:inline-block;margin-right:6px;"></i> ${tipo}<br>`;
      }
      return div;
    };
    legend.addTo(map);
    map.legendControl = legend;
  }

  setTimeout(() => {
    map.invalidateSize();
  }, 300);
}

function showDay(date) {
  state.currentDate = date;
  document.getElementById("current-day").textContent = date;
  const filtered = filtrar(state.data);
  renderAgenda(filtered);
  renderMap(filtered);
}

function rotaAtual(lat, lon) {
  if (!navigator.geolocation) {
    alert("Geolocalização não suportada");
    return;
  }
  navigator.geolocation.getCurrentPosition(pos => {
    const oLat = pos.coords.latitude;
    const oLon = pos.coords.longitude;
    const url = `https://www.google.com/maps/dir/?api=1&origin=${oLat},${oLon}&destination=${lat},${lon}`;
    window.open(url, "_blank");
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  state.data = await carregarDados();
  initMap();
  initFilters(state.data);

  const dias = diasUnicos(state.data);
  if (dias.length > 0) showDay(dias[0]);

  document.getElementById("prev-day").onclick = () => {
    const dias = diasUnicos(state.data);
    let idx = dias.indexOf(state.currentDate);
    if (idx > 0) showDay(dias[idx - 1]);
  };

  document.getElementById("next-day").onclick = () => {
    const dias = diasUnicos(state.data);
    let idx = dias.indexOf(state.currentDate);
    if (idx < dias.length - 1) showDay(dias[idx + 1]);
  };
});
