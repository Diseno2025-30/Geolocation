// ===== AUTENTICACIÓN =====
const PASSWORD = 'PuertoBQ2026';
const basePath = window.BASE_PATH || '';

document.getElementById('btn-login').addEventListener('click', checkPassword);
document.getElementById('input-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') checkPassword();
});

function checkPassword() {
  const val = document.getElementById('input-password').value;
  if (val === PASSWORD) {
    document.getElementById('password-screen').style.display = 'none';
    const app = document.getElementById('app');
    app.style.display = 'flex';
    initApp();
  } else {
    document.getElementById('password-error').textContent = 'Contraseña incorrecta.';
  }
}

// ===== INICIALIZACIÓN =====
function initApp() {
  initMap();
  loadRegisteredBuildings();
}

// ===== MAPA =====
let map;
let selectedOsmId = null;

function initMap() {
  map = L.map('map').setView([10.9639, -74.7964], 15);

  const vectorGrid = L.vectorGrid.protobuf('/tiles/{z}/{x}/{y}.mvt', {
    vectorTileLayerStyles: {
      road: { weight: 1.5, color: '#aaa', opacity: 0.9, fill: false },
      roads: { weight: 1.5, color: '#aaa', opacity: 0.9, fill: false },
      building: {
        weight: 1.5,
        color: '#f59e0b',
        opacity: 1,
        fill: true,
        fillColor: '#fde68a',
        fillOpacity: 0.4,
      },
      landuse: { weight: 1, color: '#a5d6a7', opacity: 0.4, fill: true, fillColor: '#e8f5e9', fillOpacity: 0.3 },
      water:   { weight: 1, color: '#4fc3f7', opacity: 0.8, fill: true, fillColor: '#81d4fa', fillOpacity: 0.5 },
      place:   { radius: 3, weight: 1, color: '#fff', fill: true, fillColor: '#3388ff', fillOpacity: 0.8 },
    },
    interactive: true,
    maxZoom: 19,
    getFeatureId: (f) => f.properties.osm_id,
  });

  vectorGrid.on('click', (e) => {
    const props = e.layer.properties;
    if (!props || !props.osm_id) return;

    selectedOsmId = props.osm_id;

    // Mostrar panel osm_id
    const display = document.getElementById('osm-id-display');
    document.getElementById('osm-id-value').textContent = props.osm_id;
    display.style.display = 'block';

    // Pre-rellenar formulario
    document.getElementById('input-osm-id').value = props.osm_id;
    if (props.name) {
      document.getElementById('input-name').value = props.name;
    }
    document.getElementById('input-name').focus();
  });

  vectorGrid.addTo(map);
}

// Copiar osm_id al portapapeles
document.getElementById('btn-copy-osm').addEventListener('click', () => {
  const val = document.getElementById('osm-id-value').textContent;
  navigator.clipboard.writeText(val).then(() => {
    document.getElementById('btn-copy-osm').textContent = '✓ Copiado';
    setTimeout(() => {
      document.getElementById('btn-copy-osm').textContent = 'Copiar ID';
    }, 1500);
  });
});

// ===== FORMULARIO =====
document.getElementById('btn-save').addEventListener('click', saveBuilding);

async function saveBuilding() {
  const osmId = document.getElementById('input-osm-id').value.trim();
  const name  = document.getElementById('input-name').value.trim();
  const msg   = document.getElementById('form-message');

  if (!osmId || !name) {
    msg.textContent = 'Completa ambos campos.';
    msg.className = 'error';
    return;
  }

  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  msg.textContent = '';

  try {
    const res = await fetch(`${basePath}/api/buildings/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ osm_id: parseInt(osmId), name }),
    });
    const data = await res.json();

    if (data.success) {
      msg.textContent = `✓ Guardado: ${name}`;
      msg.className = 'success';
      document.getElementById('input-osm-id').value = '';
      document.getElementById('input-name').value = '';
      loadRegisteredBuildings();
    } else {
      msg.textContent = `Error: ${data.error}`;
      msg.className = 'error';
    }
  } catch (err) {
    msg.textContent = 'Error de red.';
    msg.className = 'error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar Edificio';
  }
}

// ===== TABLA DE REGISTROS =====
async function loadRegisteredBuildings() {
  const tbody = document.getElementById('buildings-tbody');
  const empty = document.getElementById('table-empty');

  try {
    const res  = await fetch(`${basePath}/api/buildings/registered`);
    const data = await res.json();

    if (!data.success || data.buildings.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    tbody.innerHTML = data.buildings.map((b) => `
      <tr>
        <td class="osm-id-cell">${b.osm_id}</td>
        <td>${b.name}</td>
        <td>${b.created_at}</td>
        <td>
          <button class="use-btn" onclick="prefillForm(${b.osm_id}, '${b.name.replace(/'/g, "\\'")}')">
            Modificar
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = 'Error cargando registros.';
  }
}

function prefillForm(osmId, name) {
  document.getElementById('input-osm-id').value = osmId;
  document.getElementById('input-name').value = name;
  document.getElementById('input-name').focus();
}
