let map, pepiteIcon, currentBar;
let geoMarker = null;
let bars = [];
let markers = [];
let filterState = {
  types: [],
priceMin: null,
priceMax: null,
  fermeApres2h: false,
  notes: ['Pépite', 'A', 'B', 'C', 'D']
};
let priceRange = { min: 0, max: 20 };
let recentSearches = [];
let fuse = null;

const BAR_TYPES = ['Tous', 'Bar à fléchette', 'Bar dansant', 'Bar à cocktail', 'Guinguette', 'Pub', 'Bar à jeux', 'Terrasse au soleil'];
const TYPE_MAP = {
  'Bar à fléchette': 'flechettes', 'Bar dansant': 'bar-dansant',
  'Bar à cocktail': 'cocktail', 'Guinguette': 'guinguette',
  'Pub': 'pub', 'Bar à jeux': 'jeux', 'Terrasse au soleil': 'terrasse-au-soleil', 'PMU': 'pmu'
};
const NOTE_COLORS = {
  'A': { bg: '#306629', text: '#fef8f5' }, 'B': { bg: '#b5dabe', text: '#fef8f5' },
  'C': { bg: '#f4c280', text: '#fef8f5' }, 'D': { bg: '#d66643', text: '#fef8f5' },
};

// ==================== INIT APP ====================
function setAppStatus(html) {
  const el = document.getElementById('app-status');
  if (!el) return;
  if (html) { el.innerHTML = html; el.style.display = 'flex'; }
  else el.style.display = 'none';
}

async function initApp() {
  try {
    const res = await fetch('data/bars.json');
    const data = await res.json();
    bars = data.bars || [];
    fuse = new Fuse(bars, {
  keys: ['name'],
  threshold: 0.4, // 0 = exact, 1 = tout accepter — 0.4 est un bon équilibre
  minMatchCharLength: 2
});
    console.log(`✅ ${bars.length} bars chargés`);

    // Calculate price range from actual data
    const prices = bars.map(b => parsePrice(b.pdlmc_price)).filter(p => p > 0);
    if (prices.length) {
      priceRange.min = Math.floor(Math.min(...prices) * 2) / 2;
      priceRange.max = Math.ceil(Math.max(...prices) * 2) / 2;
filterState.priceMin = filterState.priceMin ?? priceRange.min;
filterState.priceMax = filterState.priceMax ?? priceRange.max;
    }

    // Initialize in correct order
    initMap();
    initFilters();
    initFilterUI();
    geolocate();
    filterMarkers(); // initialise le compteur "X bars" du panneau filtres
    setAppStatus(null);
    console.log('✅ App initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing app:', error);
    setAppStatus(`
      <div class="bg-white rounded-2xl shadow-lg px-6 py-5 text-center pointer-events-auto">
        <p class="text-zinc-700 mb-3">Impossible de charger les bars.<br>Vérifiez votre connexion.</p>
        <button onclick="location.reload()" class="bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2 rounded-3xl font-semibold text-sm">Réessayer</button>
      </div>`);
  }
}

// Price sliders initialization
function initFilters() {
  const minSlider = document.getElementById('price-min');
  const maxSlider = document.getElementById('price-max');
  const priceDisplay = document.getElementById('price-display');

  if (!minSlider || !maxSlider) {
    console.error('Price sliders not found in DOM');
    return;
  }

  // Set initial values
  minSlider.min = maxSlider.min = priceRange.min;
  minSlider.max = maxSlider.max = priceRange.max;
  minSlider.value = filterState.priceMin;
  maxSlider.value = filterState.priceMax;
  updatePriceDisplay();

  // Min slider event
  minSlider.addEventListener('input', () => {
    if (parseFloat(minSlider.value) > parseFloat(maxSlider.value)) {
      minSlider.value = maxSlider.value;
    }
    filterState.priceMin = parseFloat(minSlider.value);
    updatePriceDisplay();
    filterMarkers();
  });

  // Max slider event
  maxSlider.addEventListener('input', () => {
    if (parseFloat(maxSlider.value) < parseFloat(minSlider.value)) {
      maxSlider.value = minSlider.value;
    }
    filterState.priceMax = parseFloat(maxSlider.value);
    updatePriceDisplay();
    filterMarkers();
  });
}

function updatePriceDisplay() {
  const display = document.getElementById('price-display');
  if (display) display.textContent = `${filterState.priceMin.toFixed(1)}€ — ${filterState.priceMax.toFixed(1)}€`;
  const range = priceRange.max - priceRange.min;
  if (!range) return;
  const fill = document.getElementById('range-fill');
  if (fill) {
    const minPct = ((filterState.priceMin - priceRange.min) / range) * 100;
    const maxPct = ((filterState.priceMax - priceRange.min) / range) * 100;
    fill.style.left = minPct + '%';
    fill.style.width = (maxPct - minPct) + '%';
  }
}

// Initialize map with Leaflet
function initMap() {

map = L.map('map', {
  zoomControl: true,
  fadeAnimation: false,
  zoomAnimation: false,
  markerZoomAnimation: false,
  minZoom: 5,  // ← ajoute cette ligne
  maxZoom: 19
}).setView([47.2184, -1.5536], 13);
map.on('click', () => {
  document.getElementById('search-suggestions').classList.add('hidden');
  document.getElementById('search-bar').blur();
});
  L.tileLayer('https://{s}.tile.thunderforest.com/pioneer/{z}/{x}/{y}.png?apikey=8b46d9f2ad30440aac72699d4746657c', {
    attribution: '&copy; Thunderforest & OpenStreetMap',
    maxZoom: 19
  }).addTo(map);

  pepiteIcon = L.icon({
    iconUrl: './assets/Pepite.png',
    iconSize: [42, 42],
    iconAnchor: [21, 21]
  });

  // Add all bar markers
const PRIORITY = { 'A': 4, 'B': 3, 'C': 2, 'D': 1 };
const sortedBars = [...bars].sort((a, b) => {
  const pa = a.isPépite ? 5 : (PRIORITY[a.rating] ?? 0);
  const pb = b.isPépite ? 5 : (PRIORITY[b.rating] ?? 0);
  return pa - pb; // D en premier (en dessous), Pépite en dernier (au dessus)
});

sortedBars.forEach(bar => {
let marker;
if (bar.isPépite) {
  marker = L.marker([bar.lat, bar.lng], { icon: pepiteIcon });
} else if (bar.types && bar.types.includes('pmu')) {
  const pmuIcon = L.icon({
    iconUrl: './assets/PMU.png',
    iconSize: [42, 42],
    iconAnchor: [21, 21]
  });
  marker = L.marker([bar.lat, bar.lng], { icon: pmuIcon });
} else {
  const html = `<svg width="36" height="36" viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="17" fill="${bar.color}" stroke="white" stroke-width="2"/>
    <text x="18" y="18" text-anchor="middle" dominant-baseline="central" fill="white" font-size="20" font-weight="900" font-family="sans-serif">${bar.rating}</text>
  </svg>`;
  const icon = L.divIcon({
    className: 'custom-marker',
    html: html,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
  marker = L.marker([bar.lat, bar.lng], { icon });
}
const zIdx = bar.isPépite ? 1000 : ({ 'A': 400, 'B': 300, 'C': 200, 'D': 100 }[bar.rating] ?? 50);
marker.setZIndexOffset(zIdx);
marker.on('click', () => showBarModal(bar));
marker.addTo(map);
  markers.push({ marker, bar }); // ← le markers.push est bien là
});

  // Add filter button control
  const FilterControl = L.Control.extend({
    onAdd: function() {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const btn = L.DomUtil.create('button', 'leaflet-filter-btn', container);
      btn.title = 'Filtres';
      btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <circle cx="9" cy="6" r="3" fill="currentColor"/>
        <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <circle cx="15" cy="12" r="3" fill="currentColor"/>
        <line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <circle cx="9" cy="18" r="3" fill="currentColor"/>
      </svg>`;
      L.DomEvent.on(btn, 'click', e => { L.DomEvent.stopPropagation(e); toggleFilterPanel(); });
      L.DomEvent.disableClickPropagation(container);
      return container;
    }
  });
new FilterControl({ position: 'topleft' }).addTo(map);

const GeoControl = L.Control.extend({
  onAdd: function() {
    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
    const btn = L.DomUtil.create('button', 'leaflet-filter-btn', container);
    btn.title = 'Ma position';
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <circle cx="12" cy="12" r="3" fill="currentColor"/>
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
      <circle cx="12" cy="12" r="8" stroke-opacity="0.4"/>
    </svg>`;
    L.DomEvent.on(btn, 'click', e => { L.DomEvent.stopPropagation(e); geolocate(true); });
    L.DomEvent.disableClickPropagation(container);
    return container;
  }
});
new GeoControl({ position: 'topleft' }).addTo(map);

console.log('✅ Map ready with clickable markers');
}

// Show bar details modal
function showBarModal(bar) {
  currentBar = bar;
  document.getElementById('modal-name').textContent = bar.name;
const ratingEl = document.getElementById('modal-rating');
const isPMU = bar.types && bar.types.includes('pmu');
if (bar.isPépite) {
ratingEl.innerHTML = `<img src="./assets/Pepite.png" style="width:48px;height:48px;object-fit:contain" alt="Pépite">`;
} else if (isPMU) {
ratingEl.innerHTML = `<img src="./assets/PMU.png" style="width:48px;height:48px;object-fit:contain" alt="PMU">`;
} else {
  ratingEl.textContent = bar.rating;
  ratingEl.style.color = bar.color || '#000';
}
  document.getElementById('modal-price').textContent = bar.pdlmc_price;
  document.getElementById('modal-desc').innerHTML = (bar.description || '') + ' <i>... lire la suite sur Instagram</i>';
  document.getElementById('modal-ig').href = bar.ig_link;
const photoEl = document.getElementById('modal-photo');
photoEl.loading = 'lazy';
photoEl.src = bar.photos && bar.photos[0]
  ? bar.photos[0]
  : 'https://placehold.co/800x600/cccccc/333333?text=Photo+non+disponible';
  photoEl.onerror = () => { photoEl.src = 'https://placehold.co/800x600/e5e7eb/9ca3af?text=Photo+non+disponible'; };
  renderModalInfo(bar);
  const modal = document.getElementById('bar-modal');
  if (modal.classList.contains('hidden')) {
    modal.classList.remove('hidden');
    pushUIState();
  }
}

function renderModalInfo(bar) {
  const typesContainer = document.getElementById('modal-types');
  typesContainer.innerHTML = '';
const blockTypes = document.getElementById('block-types');
if (bar.types && bar.types.length > 0) {
  blockTypes.classList.remove('hidden');
} else {
  blockTypes.classList.add('hidden');
}
  if (bar.types && bar.types.length > 0) {
    bar.types.forEach(type => {
      if (type === 'pmu') return; // bar PMU → icône ticketagratter.png ajoutée ci-dessous
      if (type === 'guinguette') return;
      typesContainer.appendChild(createTypeIcon(`./assets/${type}.png`, type.replace(/-/g, ' ')));
    });
    if (bar.types.includes('pmu')) {
      typesContainer.appendChild(createTypeIcon('./assets/ticketagratter.png', 'Tickets à gratter'));
    }
  }

  const infoContainer = document.getElementById('modal-extra-info');
  let html = '';
  if (bar.hasHappyHour === true) html += `
    <div class="flex items-baseline gap-2">
      <span class="text-xs tracking-widest text-zinc-500">HAPPY HOURS</span>
      <span class="text-zinc-800">${bar.happyHourTimes || ''}</span>
    </div>`;
  infoContainer.innerHTML = html;

  // Fermeture : texte libre "fermeture", sinon l'heure "closesAt" en secours
  const fermetureEl = document.getElementById('modal-fermeture');
  if (fermetureEl) {
    const fermetureText = bar.fermeture || bar.closesAt || '';
    document.getElementById('modal-fermeture-text').textContent = fermetureText;
    fermetureEl.style.display = fermetureText ? '-webkit-box' : 'none';
  }
}

// Icône de type avec tooltip pour le bloc "LES +"
function createTypeIcon(src, label) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;display:inline-block';

  const img = document.createElement('img');
  img.src = src;
  img.alt = label;
  img.className = 'w-10 h-10 transition-transform';
  img.onerror = () => { wrapper.style.display = 'none'; };

  const tooltip = document.createElement('div');
  tooltip.textContent = label;
  tooltip.style.cssText = `
    position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);
    background:#1f2937;color:white;font-size:11px;padding:3px 8px;border-radius:8px;
    white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0.15s;z-index:100;
  `;

  img.addEventListener('mouseenter', () => tooltip.style.opacity = '1');
  img.addEventListener('mouseleave', () => tooltip.style.opacity = '0');
  img.addEventListener('touchstart', (e) => {
    e.preventDefault();
    tooltip.style.opacity = '1';
    setTimeout(() => tooltip.style.opacity = '0', 1500);
  }, { passive: false });

  wrapper.appendChild(tooltip);
  wrapper.appendChild(img);
  return wrapper;
}
// ==================== FILTER UI INITIALIZATION ====================
function initFilterUI() {
  // Type filters
  const typeList = document.getElementById('filter-type-list');
  if (typeList) {
    BAR_TYPES.forEach(type => {
      const item = document.createElement('div');
      item.className = 'filter-type-item' + (type === 'Tous' ? ' active' : '');
      item.textContent = type;
      item.onclick = () => {
        if (type === 'Tous') {
          filterState.types = [];
          document.querySelectorAll('.filter-type-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
        } else {
          document.querySelector('.filter-type-item').classList.remove('active');
          item.classList.toggle('active');
          const mapped = TYPE_MAP[type];
          const idx = filterState.types.indexOf(mapped);
          if (idx > -1) filterState.types.splice(idx, 1);
          else filterState.types.push(mapped);
          if (filterState.types.length === 0) {
            document.querySelector('.filter-type-item').classList.add('active');
          }
        }
        filterMarkers();
      };
      typeList.appendChild(item);
    });
  }

  // Note/Rating filters
  const notesList = document.getElementById('filter-notes-list');
  if (notesList) {
    const noteList = ['Pépite', 'A', 'B', 'C', 'D'];

    noteList.forEach(note => {
      const btn = document.createElement('button');
      btn.className = 'note-btn';
      btn.textContent = note;

if (note === 'Pépite') {
  btn.textContent = '';
  btn.style.background = 'transparent';
  btn.style.border = 'none';
  btn.style.boxShadow = 'none';
  const img = document.createElement('img');
  img.src = './assets/Pepite.png';
  img.style.width = '52px';
  img.style.height = '52px';
  img.style.margin = '-5px';
  img.style.objectFit = 'contain';
  btn.appendChild(img);
} else {
  btn.textContent = note;
  btn.style.background = NOTE_COLORS[note].bg;
  btn.style.color = NOTE_COLORS[note].text;
}

      btn.dataset.note = note;
// ✅ APRÈS
btn.onclick = () => {
  const allNotes = ['Pépite', 'A', 'B', 'C', 'D'];
  const allSelected = filterState.notes.length === allNotes.length;

  if (allSelected) {
    // Toutes sélectionnées → isoler uniquement celle-ci
    filterState.notes = [note];
    document.querySelectorAll('.note-btn').forEach(b => b.classList.add('inactive'));
    btn.classList.remove('inactive');
  } else {
    const idx = filterState.notes.indexOf(note);
    if (idx > -1) {
      if (filterState.notes.length > 1) {
        filterState.notes.splice(idx, 1);
        btn.classList.add('inactive');
      }
    } else {
      filterState.notes.push(note);
      btn.classList.remove('inactive');
      // Si toutes redeviennent sélectionnées, retirer les inactive
      if (filterState.notes.length === allNotes.length) {
        document.querySelectorAll('.note-btn').forEach(b => b.classList.remove('inactive'));
      }
    }
  }
  filterMarkers();
};
      notesList.appendChild(btn);
    });
  }
  // (swipe gauche retiré — conflit avec le slider prix)
}

// ==================== MODAL FUNCTIONS ====================
// Gestion du bouton retour mobile : chaque ouverture (modale, panneau) pousse
// une entrée d'historique ; "retour" referme l'élément au lieu de quitter le site.
let uiStateDepth = 0;

function pushUIState() {
  uiStateDepth++;
  history.pushState({ ui: uiStateDepth }, '');
}

// Ferme l'élément ouvert le plus "haut" (modales avant panneau). Retourne true si fermeture.
function closeTopUI() {
  const barModal = document.getElementById('bar-modal');
  const donModal = document.getElementById('donation-modal');
  const panel = document.getElementById('filter-panel');
  if (!barModal.classList.contains('hidden')) {
    barModal.classList.add('hidden');
    return true;
  }
  if (!donModal.classList.contains('hidden')) {
    donModal.classList.add('hidden');
    return true;
  }
  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    document.getElementById('filter-overlay').classList.remove('open');
    return true;
  }
  return false;
}

// Fermeture manuelle (croix, clic dehors, Échap) : repasse par l'historique
// pour ne pas laisser d'entrée orpheline.
function closeUI() {
  if (uiStateDepth > 0) history.back();
  else closeTopUI();
}

window.addEventListener('popstate', () => {
  if (uiStateDepth > 0) {
    uiStateDepth--;
    closeTopUI();
  }
});

function closeModal() {
  closeUI();
}

function openDonationModal() {
  document.getElementById('donation-modal').classList.remove('hidden');
  pushUIState();
}

function closeDonationModal() {
  closeUI();
}
const DONATION_URL = 'https://buymeacoffee.com/nantesen180bars';
function donate(amount) {
  closeDonationModal();
  window.open(DONATION_URL, '_blank');
}
function donateCustom() {
  closeDonationModal();
  window.open(DONATION_URL, '_blank');
}

// ==================== SEARCH FUNCTION ====================
function showSuggestions(input) {
  const suggestionsDiv = document.getElementById('search-suggestions');
  suggestionsDiv.innerHTML = '';
  suggestionsDiv.classList.add('hidden');

  let results = [];

  if (input.length === 0) {
    // Affiche les recherches récentes
    if (recentSearches.length === 0) return;
    results = recentSearches.slice().reverse();
  } else if (input.length >= 2) {
results = fuse ? fuse.search(input).map(r => r.item) : bars.filter(b => b.name.toLowerCase().includes(input.toLowerCase()));
    if (results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'px-4 py-2 text-zinc-400 text-sm italic';
      empty.textContent = 'Aucun bar trouvé';
      suggestionsDiv.appendChild(empty);
      suggestionsDiv.classList.remove('hidden');
      return;
    }
  } else {
    return;
  }

  results.forEach(bar => {
    const item = document.createElement('div');
    item.className = 'px-4 py-2 hover:bg-emerald-100 cursor-pointer text-zinc-900 flex items-center gap-2';
    if (input.length === 0) {
      item.innerHTML = `<span class="text-zinc-400 text-xs">↩</span> ${bar.name}`;
    } else {
      item.textContent = bar.name;
    }
    item.onclick = () => {
      // Ajoute aux recherches récentes (sans doublon, max 5)
      recentSearches = recentSearches.filter(b => b.name !== bar.name);
      recentSearches.push(bar);
      if (recentSearches.length > 5) recentSearches.shift();

      map.flyTo([bar.lat, bar.lng], 19, { animate: true, duration: 1 });
      setTimeout(() => showBarModal(bar), 1100);
      document.getElementById('search-bar').value = '';
      suggestionsDiv.classList.add('hidden');
    };
    suggestionsDiv.appendChild(item);
  });

  if (results.length > 0) suggestionsDiv.classList.remove('hidden');
}
// ==================== HELPER FUNCTIONS ====================
function parsePrice(str) {
  if (!str) return 0;
  return parseFloat(str.replace(',', '.').replace(/[€\s]/g, '')) || 0;
}

function parseHour(closesAt) {
  if (!closesAt) return -1;
  return parseInt(closesAt.split(':')[0]);
}

// Filter markers based on current filter state
let _filterTimeout;
function filterMarkers() {
  clearTimeout(_filterTimeout);
  _filterTimeout = setTimeout(() => {
    markers.forEach(({ marker, bar }) => {
      const price = parsePrice(bar.pdlmc_price);
      const typeOk = filterState.types.length === 0 || (bar.types && filterState.types.some(t => bar.types.includes(t)));
      const priceOk = !price || (price >= filterState.priceMin && price <= filterState.priceMax);
      const h = parseHour(bar.closesAt);
      const fermeOk = !filterState.fermeApres2h || (h >= 2 && h <= 8);
const allNotes = ['Pépite', 'A', 'B', 'C', 'D'];
const isPMU = bar.types && bar.types.includes('pmu');
const allSelected = filterState.notes.length === allNotes.length;
const noteOk = isPMU ? allSelected : filterState.notes.includes(bar.isPépite ? 'Pépite' : bar.rating);
      const visible = typeOk && priceOk && fermeOk && noteOk;
      if (visible) { if (!map.hasLayer(marker)) marker.addTo(map); }
      else { if (map.hasLayer(marker)) map.removeLayer(marker); }
    });
    // Indicateur visuel si des filtres sont actifs
const isActive = filterState.types.length > 0 ||
  filterState.fermeApres2h || filterState.priceMin > priceRange.min ||
  filterState.priceMax < priceRange.max || filterState.notes.length < 5;
const filterBtns = document.querySelectorAll('.leaflet-filter-btn');
if (filterBtns[0]) filterBtns[0].style.color = isActive ? '#059669' : '#374151';
    // Compteur de résultats
const count = markers.filter(({ marker }) => map.hasLayer(marker)).length;
const countEl = document.getElementById('filter-count');
if (countEl) countEl.textContent = `${count} bar${count > 1 ? 's' : ''}`;
  }, 80);
  
}

function onFilterChange() {
  filterState.fermeApres2h = document.getElementById('filter-ferme').checked;
  filterMarkers();
}

function toggleFilterPanel() {
  const panel = document.getElementById('filter-panel');
  if (panel.classList.contains('open')) {
    closeUI();
  } else {
    panel.classList.add('open');
    document.getElementById('filter-overlay').classList.add('open');
    pushUIState();
  }
}

// ✅ APRÈS
function resetFilters() {
  filterState = {
    types: [],
    priceMin: priceRange.min,
    priceMax: priceRange.max,
    fermeApres2h: false,
    notes: ['Pépite', 'A', 'B', 'C', 'D']
  };

  // Reset type de bar
  document.querySelectorAll('.filter-type-item').forEach((el, i) => el.classList.toggle('active', i === 0));

  // Reset prix — dans cet ordre précis
  const minSlider = document.getElementById('price-min');
  const maxSlider = document.getElementById('price-max');
  if (minSlider) {
    minSlider.min = priceRange.min;
    minSlider.max = priceRange.max;
    minSlider.value = priceRange.min;
  }
  if (maxSlider) {
    maxSlider.min = priceRange.min;
    maxSlider.max = priceRange.max;
    maxSlider.value = priceRange.max;
  }
  updatePriceDisplay();

  // Reset notes — retire inactive ET remet l'opacité
  document.querySelectorAll('.note-btn').forEach(btn => {
    btn.classList.remove('inactive');
    btn.style.opacity = '';
  });

  filterMarkers();
}
// flyToUser=false : pose juste le point bleu (init silencieuse).
// flyToUser=true : centre la carte sur la position et alerte en cas d'échec (bouton).
function geolocate(flyToUser = false) {
  if (!navigator.geolocation) {
    if (flyToUser) alert("Géolocalisation non supportée.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      if (geoMarker) map.removeLayer(geoMarker);
      const blueIcon = L.divIcon({
        className: '',
        html: `<div style="width:16px;height:16px;background:#2563eb;border:3px solid white;border-radius:50%;box-shadow:0 0 0 4px rgba(37,99,235,0.25)"></div>`,
        iconSize: [16, 16], iconAnchor: [8, 8]
      });
      geoMarker = L.marker([latitude, longitude], { icon: blueIcon, zIndexOffset: 2000 });
      geoMarker.addTo(map);
      if (flyToUser) map.flyTo([latitude, longitude], 16, { animate: true, duration: 1 });
    },
    () => { if (flyToUser) alert("Impossible d'obtenir votre position."); },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}
// ==================== EVENT LISTENERS ====================
// Script chargé en defer : le DOM est prêt, inutile d'attendre l'événement load
// (qui n'arrive qu'après le téléchargement de toutes les images)
initApp();

const searchInput = document.getElementById('search-bar');
if (searchInput) searchInput.addEventListener('input', (e) => showSuggestions(e.target.value));

document.addEventListener('keydown', e => {
  if (e.key === "Escape") closeUI();
});
