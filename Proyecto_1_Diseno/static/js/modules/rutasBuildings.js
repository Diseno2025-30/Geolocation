let selectedBuildings = [];
let isInitialized = false;

export function setupBuildingSelector() {
  // Evitar múltiples inicializaciones
  if (isInitialized) return;

  const searchInput = document.getElementById('buildingSearch');
  const resultsContainer = document.getElementById('searchResults');
  const selectedContainer = document.getElementById('selectedBuildingsList');
  const countSpan = document.getElementById('buildingCount');
  const clearBtn = document.getElementById('btnClearBuildings');

  if (!searchInput || !resultsContainer) {
    console.error("❌ Elementos de búsqueda de edificios no encontrados");
    return;
  }

  // Mostrar todos los edificios al hacer focus
  searchInput.addEventListener('focus', async () => {
    if (searchInput.value.trim() === '') {
      await showAllBuildings();
    }
  });

  // Escuchar cambios en el input
  searchInput.addEventListener('input', async (e) => {
    const query = e.target.value.trim();

    // Si está vacío, mostrar todos
    if (query === '') {
      await showAllBuildings();
      return;
    }

    // Si tiene menos de 2 caracteres, no buscar
    if (query.length < 2) {
      resultsContainer.innerHTML = '<div class="search-hint">Escribe al menos 2 caracteres...</div>';
      return;
    }

    try {
      const results = await searchBuildings(query);
      displayResults(results);
    } catch (err) {
      console.error("Error buscando edificios:", err);
      resultsContainer.innerHTML = '<div class="search-error">Error al buscar edificios</div>';
    }
  });

  async function showAllBuildings() {
    try {
      const results = await getAllBuildings();
      displayResults(results);
    } catch (err) {
      console.error("Error cargando edificios:", err);
    }
  }

  function displayResults(results) {
    if (results.length === 0) {
      resultsContainer.innerHTML = '<div class="search-empty">No se encontraron edificios</div>';
      return;
    }

    resultsContainer.innerHTML = results.map(building => `
      <div class="search-result-item" data-id="${building.id}" data-name="${building.name}" data-osm-id="${building.osm_id || ''}">
        <span class="building-name">${building.name}</span>
        <button class="btn-add" title="Agregar parada">➕</button>
      </div>
    `).join('');

    // Agregar listener para añadir
    resultsContainer.querySelectorAll('.btn-add').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const item = btn.parentElement;
        addBuilding({
          id: item.dataset.id,
          name: item.dataset.name,
          osm_id: item.dataset.osmId
        });
      };
    });
  }

  function addBuilding(building) {
    // Evitar duplicados
    if (selectedBuildings.some(b => b.id === building.id)) {
      console.log(`⚠️ Edificio ${building.name} ya está seleccionado`);
      return;
    }

    selectedBuildings.push(building);
    updateSelectedList();
    console.log(`✅ Edificio agregado: ${building.name}`);
  }

  function removeBuilding(index) {
    const removed = selectedBuildings.splice(index, 1);
    updateSelectedList();
    console.log(`🗑️ Edificio eliminado: ${removed[0]?.name}`);
  }

  function updateSelectedList() {
    if (selectedBuildings.length === 0) {
      selectedContainer.style.display = 'none';
      if (clearBtn) clearBtn.style.display = 'none';
    } else {
      selectedContainer.style.display = 'block';
      if (clearBtn) clearBtn.style.display = 'inline-block';
    }

    selectedContainer.innerHTML = selectedBuildings.map((b, idx) => `
      <div class="selected-building-item">
        <span class="building-index">${idx + 1}</span>
        <span class="building-name">${b.name}</span>
        <button class="btn-remove" data-idx="${idx}" title="Eliminar">×</button>
      </div>
    `).join('');

    selectedContainer.querySelectorAll('.btn-remove').forEach(btn => {
      btn.onclick = () => removeBuilding(parseInt(btn.dataset.idx));
    });

    countSpan.textContent = selectedBuildings.length;
  }

  if (clearBtn) {
    clearBtn.onclick = () => {
      selectedBuildings = [];
      updateSelectedList();
      console.log("🧹 Paradas limpiadas");
    };
  }

  isInitialized = true;
  console.log("✅ Selector de edificios inicializado");
}

// Función para obtener todos los edificios
async function getAllBuildings() {
  const basePath = window.getBasePath ? window.getBasePath() : '';
  const res = await fetch(`${basePath}/api/buildings`);
  const data = await res.json();
  return data.success ? data.buildings : [];
}

// Función de búsqueda: llama a tu API de edificios
async function searchBuildings(query) {
  const basePath = window.getBasePath ? window.getBasePath() : '';
  const res = await fetch(`${basePath}/api/buildings/search?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  return data.success ? data.buildings : [];
}

export function getSelectedBuildings() {
  return [...selectedBuildings];
}

export function clearSelectedBuildings() {
  selectedBuildings = [];
}
