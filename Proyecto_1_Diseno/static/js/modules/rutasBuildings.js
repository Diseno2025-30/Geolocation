let selectedBuildings = [];

export function setupBuildingSelector() {
  const searchInput = document.getElementById('buildingSearch');
  const resultsContainer = document.getElementById('searchResults');
  const selectedContainer = document.getElementById('selectedBuildingsList');
  const countSpan = document.getElementById('buildingCount');
  const clearBtn = document.getElementById('btnClearBuildings');

  // Escuchar cambios en el input
  searchInput.addEventListener('input', async (e) => {
    const query = e.target.value.trim();
    if (query.length < 2) {
      resultsContainer.innerHTML = '';
      return;
    }

    try {
      const results = await searchBuildings(query); // función que llama a tu API
      resultsContainer.innerHTML = results.map(building => `
        <div class="search-result-item" data-id="${building.id}" data-name="${building.name}">
          ${building.name} (${building.address || ''})
          <button class="btn-add">➕</button>
        </div>
      `).join('');

      // Agregar listener para añadir
      resultsContainer.querySelectorAll('.btn-add').forEach(btn => {
        btn.onclick = () => {
          const item = btn.parentElement;
          addBuilding({
            id: item.dataset.id,
            name: item.dataset.name
          });
        };
      });
    } catch (err) {
      console.error("Error buscando edificios:", err);
    }
  });

  function addBuilding(building) {
    // Evitar duplicados
    if (selectedBuildings.some(b => b.id === building.id)) return;

    selectedBuildings.push(building);
    updateSelectedList();
  }

  function removeBuilding(index) {
    selectedBuildings.splice(index, 1);
    updateSelectedList();
  }

  function updateSelectedList() {
    if (selectedBuildings.length === 0) {
      selectedContainer.style.display = 'none';
      clearBtn.style.display = 'none';
    } else {
      selectedContainer.style.display = 'block';
      clearBtn.style.display = 'inline-block';
    }

    selectedContainer.innerHTML = selectedBuildings.map((b, idx) => `
      <div class="selected-building-item">
        <strong>Parada ${idx + 1}:</strong> ${b.name}
        <button class="btn-remove" data-idx="${idx}">🗑️</button>
      </div>
    `).join('');

    selectedContainer.querySelectorAll('.btn-remove').forEach(btn => {
      btn.onclick = () => removeBuilding(parseInt(btn.dataset.idx));
    });

    countSpan.textContent = selectedBuildings.length;
  }

  clearBtn.onclick = () => {
    selectedBuildings = [];
    updateSelectedList();
  }
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
