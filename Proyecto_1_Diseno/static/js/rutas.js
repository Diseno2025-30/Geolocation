// static/js/rutas.js

import { 
  initializeMap, 
  clearMap, 
  enableSegmentSelection, 
  disableSegmentSelection,
  addSegmentMarker,
  clearSegmentMarkers,
  getSelectedSegmentsArray,
  getSegmentMarkers,
  removeSegmentByIndex
} from './modules/rutasMap.js';

let empresasData = [];
let rutasData = [];
let selectedRuta = null;
let currentEmpresaFilter = '';
let isSelectingSegments = false;

// --- Inicialización ---
document.addEventListener('DOMContentLoaded', async () => {
  // Configurar navegación
  if (window.setupViewNavigation) {
    window.setupViewNavigation();
  }

  // Inicializar mapa
  initializeMap();

  // Cargar datos iniciales
  await loadEmpresas();
  await loadRutas();

  // Event listeners
  setupEventListeners();
});

// --- Carga de Datos ---
async function loadEmpresas() {
  const basePath = window.getBasePath ? window.getBasePath() : '';
  
  try {
    const response = await fetch(`${basePath}/api/empresas`);
    const data = await response.json();
    
    if (data.success) {
      empresasData = data.empresas;
      populateEmpresaSelectors();
    }
  } catch (error) {
    console.error('Error cargando empresas:', error);
  }
}

async function loadRutas(empresa = '') {
  const basePath = window.getBasePath ? window.getBasePath() : '';
  const url = empresa 
    ? `${basePath}/api/rutas?empresa=${encodeURIComponent(empresa)}`
    : `${basePath}/api/rutas`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.success) {
      rutasData = data.rutas;
      displayRutasList();
    }
  } catch (error) {
    console.error('Error cargando rutas:', error);
    const rutasList = document.getElementById('rutasList');
    rutasList.innerHTML = '<p class="loading-text" style="color: #dc2626;">Error cargando rutas</p>';
  }
}

// --- UI Rendering ---
function populateEmpresaSelectors() {
  const empresaSelector = document.getElementById('empresaSelector');
  const rutaEmpresa = document.getElementById('rutaEmpresa');
  
  // Selector principal (filtro)
  empresaSelector.innerHTML = '<option value="">Todas las empresas</option>';
  empresasData.forEach(empresa => {
    const option = document.createElement('option');
    option.value = empresa;
    option.textContent = empresa;
    empresaSelector.appendChild(option);
  });
  
  // Selector en modal
  rutaEmpresa.innerHTML = '<option value="">Seleccione una empresa</option>';
  empresasData.forEach(empresa => {
    const option = document.createElement('option');
    option.value = empresa;
    option.textContent = empresa;
    rutaEmpresa.appendChild(option);
  });
}

function displayRutasList() {
  const rutasList = document.getElementById('rutasList');
  
  if (rutasData.length === 0) {
    rutasList.innerHTML = '<p class="loading-text">No hay rutas disponibles</p>';
    return;
  }
  
  rutasList.innerHTML = '';
  
  rutasData.forEach(ruta => {
    const segmentCount = ruta.segment_ids.split(',').filter(s => s.trim()).length;
    
    const rutaItem = document.createElement('div');
    rutaItem.className = 'ruta-item';
    rutaItem.dataset.rutaId = ruta.id;
    
    rutaItem.innerHTML = `
      <div class="ruta-item-header">
        <div class="ruta-item-title">${ruta.nombre_ruta}</div>
        <div class="ruta-item-empresa">${ruta.empresa}</div>
      </div>
      <div class="ruta-item-info">
        <span>${segmentCount} segmentos</span>
        <span>${ruta.created_at}</span>
      </div>
      ${ruta.descripcion ? `<div style="font-size: 0.85rem; color: #64748b; margin-top: 4px;">${ruta.descripcion}</div>` : ''}
      <div class="ruta-item-actions">
        <button class="ruta-action-btn view-btn" data-ruta-id="${ruta.id}">Ver</button>
        <button class="ruta-action-btn edit-btn" data-ruta-id="${ruta.id}">Editar</button>
        <button class="ruta-action-btn delete" data-ruta-id="${ruta.id}">Eliminar</button>
      </div>
    `;
    
    rutasList.appendChild(rutaItem);
  });
  
  // Event listeners para cada ruta
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rutaId = parseInt(btn.dataset.rutaId);
      viewRuta(rutaId);
    });
  });
  
  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rutaId = parseInt(btn.dataset.rutaId);
      editRuta(rutaId);
    });
  });
  
  document.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rutaId = parseInt(btn.dataset.rutaId);
      deleteRuta(rutaId);
    });
  });
}

// --- Acciones de Rutas ---
function viewRuta(rutaId) {
  const ruta = rutasData.find(r => r.id === rutaId);
  if (!ruta) return;
  
  selectedRuta = ruta;
  
  // Actualizar UI
  document.querySelectorAll('.ruta-item').forEach(item => {
    item.classList.remove('active');
  });
  document.querySelector(`[data-ruta-id="${rutaId}"]`)?.classList.add('active');
  
  document.getElementById('selectedRutaName').textContent = ruta.nombre_ruta;
  document.getElementById('selectedRutaEmpresa').textContent = ruta.empresa;
  const segmentCount = ruta.segment_ids.split(',').filter(s => s.trim()).length;
  document.getElementById('selectedRutaSegments').textContent = segmentCount;
  
  // Mostrar en mapa
  clearMap();
  // TODO: Cargar y mostrar segmentos reales en el mapa
  console.log('Mostrando ruta:', ruta);
}

function editRuta(rutaId) {
  const ruta = rutasData.find(r => r.id === rutaId);
  if (!ruta) return;
  
  // Poblar formulario con datos existentes
  document.getElementById('modalTitle').textContent = 'Editar Ruta';
  document.getElementById('rutaNombre').value = ruta.nombre_ruta;
  document.getElementById('rutaEmpresa').value = ruta.empresa;
  document.getElementById('rutaDescripcion').value = ruta.descripcion || '';
  
  // Limpiar selección previa
  clearSelectedSegmentsList();
  clearSegmentMarkers();
  
  // Cargar segmentos existentes
  const segmentIds = ruta.segment_ids.split(',').map(s => s.trim()).filter(s => s);
  // TODO: Cargar información completa de los segmentos desde la base de datos
  
  // Mostrar modal
  document.getElementById('rutaModal').style.display = 'flex';
  selectedRuta = ruta;
  
  // Activar modo selección de segmentos
  startSegmentSelection();
}

async function deleteRuta(rutaId) {
  const ruta = rutasData.find(r => r.id === rutaId);
  if (!ruta) return;
  
  if (!confirm(`¿Está seguro de eliminar la ruta "${ruta.nombre_ruta}"?`)) {
    return;
  }
  
  const basePath = window.getBasePath ? window.getBasePath() : '';
  
  try {
    const response = await fetch(`${basePath}/api/rutas/${rutaId}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    
    if (data.success) {
      alert('Ruta eliminada exitosamente');
      await loadRutas(currentEmpresaFilter);
      if (selectedRuta?.id === rutaId) {
        selectedRuta = null;
        clearMap();
        document.getElementById('selectedRutaName').textContent = 'Ninguna';
        document.getElementById('selectedRutaEmpresa').textContent = '---';
        document.getElementById('selectedRutaSegments').textContent = '0';
      }
    } else {
      alert('Error al eliminar ruta: ' + data.error);
    }
  } catch (error) {
    console.error('Error eliminando ruta:', error);
    alert('Error al eliminar ruta');
  }
}

// --- Event Listeners ---
function setupEventListeners() {
  // Filtro de empresa
  document.getElementById('empresaSelector').addEventListener('change', async (e) => {
    currentEmpresaFilter = e.target.value;
    await loadRutas(currentEmpresaFilter);
    selectedRuta = null;
    clearMap();
    document.getElementById('selectedRutaName').textContent = 'Ninguna';
    document.getElementById('selectedRutaEmpresa').textContent = '---';
    document.getElementById('selectedRutaSegments').textContent = '0';
  });
  
  // Botón crear ruta
  document.getElementById('btnCrearRuta').addEventListener('click', () => {
    document.getElementById('modalTitle').textContent = 'Crear Nueva Ruta';
    document.getElementById('rutaForm').reset();
    selectedRuta = null;
    
    // Limpiar selección previa
    clearSelectedSegmentsList();
    clearSegmentMarkers();
    
    document.getElementById('rutaModal').style.display = 'flex';
    
    // Activar modo selección de segmentos
    startSegmentSelection();
  });
  
  // Cerrar modal
  document.getElementById('closeRutaModal').addEventListener('click', () => {
    document.getElementById('rutaModal').style.display = 'none';
    stopSegmentSelection();
  });
  
  document.getElementById('cancelRutaBtn').addEventListener('click', () => {
    document.getElementById('rutaModal').style.display = 'none';
    stopSegmentSelection();
  });
  
  // Submit formulario
  document.getElementById('rutaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveRuta();
  });
  
  // Botón limpiar segmentos
  document.getElementById('btnLimpiarSegmentos').addEventListener('click', () => {
    clearSelectedSegmentsList();
    clearSegmentMarkers();
  });
}

// --- Manejo de Segmentos ---
function startSegmentSelection() {
  isSelectingSegments = true;
  
  enableSegmentSelection((segment) => {
    // Agregar segmento a la lista y al mapa
    addSegmentToList(segment);
  });
  
  // Actualizar UI
  document.getElementById('segmentSelectionInfo').style.display = 'block';
  console.log('✓ Modo selección de segmentos activado');
}

function stopSegmentSelection() {
  isSelectingSegments = false;
  disableSegmentSelection();
  
  // Actualizar UI
  document.getElementById('segmentSelectionInfo').style.display = 'none';
  console.log('✓ Modo selección de segmentos desactivado');
}

function addSegmentToList(segment) {
  const segmentsList = document.getElementById('selectedSegmentsList');
  const placeholder = document.getElementById('segmentsPlaceholder');
  
  // Ocultar placeholder y mostrar lista
  if (placeholder) placeholder.style.display = 'none';
  segmentsList.style.display = 'block';
  
  // Obtener el índice actual (número de segmentos ya existentes)
  const currentSegments = getSelectedSegmentsArray();
  const index = currentSegments.length;
  
  // Crear marcador en el mapa
  addSegmentMarker(segment, index);
  
  // Crear elemento de lista
  const segmentItem = document.createElement('div');
  segmentItem.className = 'segment-list-item';
  segmentItem.innerHTML = `
    <div class="segment-index">${index + 1}</div>
    <div class="segment-details">
      <div class="segment-street">${segment.street_name}</div>
      <div class="segment-id">ID: ${segment.segment_id}</div>
    </div>
    <button class="segment-remove-btn" data-index="${index}">×</button>
  `;
  
  segmentsList.appendChild(segmentItem);
  
  // Actualizar contador
  document.getElementById('segmentCount').textContent = index + 1;
  
  // Event listener para eliminar segmento
  segmentItem.querySelector('.segment-remove-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const removeIndex = parseInt(e.target.dataset.index);
    removeSegment(removeIndex);
  });
}

function removeSegment(index) {
  // Usar la función del módulo de mapa
  if (removeSegmentByIndex(index)) {
    // Actualizar UI de lista de segmentos
    clearSelectedSegmentsList();
    redrawSegmentList();
  }
}

function clearSelectedSegmentsList() {
  const segmentsList = document.getElementById('selectedSegmentsList');
  const placeholder = document.getElementById('segmentsPlaceholder');
  
  segmentsList.innerHTML = '';
  segmentsList.style.display = 'none';
  
  if (placeholder) placeholder.style.display = 'block';
}

function redrawSegmentList() {
  const segmentsList = document.getElementById('selectedSegmentsList');
  const placeholder = document.getElementById('segmentsPlaceholder');
  const segments = getSelectedSegmentsArray();
  
  // Limpiar lista actual
  segmentsList.innerHTML = '';
  
  if (segments.length === 0) {
    // Mostrar placeholder si no hay segmentos
    segmentsList.style.display = 'none';
    if (placeholder) placeholder.style.display = 'block';
    document.getElementById('segmentCount').textContent = '0';
    return;
  }
  
  // Ocultar placeholder y mostrar lista
  if (placeholder) placeholder.style.display = 'none';
  segmentsList.style.display = 'block';
  
  // Redibujar todos los segmentos con índices actualizados
  segments.forEach((segment, index) => {
    const segmentItem = document.createElement('div');
    segmentItem.className = 'segment-list-item';
    segmentItem.innerHTML = `
      <div class="segment-index">${index + 1}</div>
      <div class="segment-details">
        <div class="segment-street">${segment.street_name}</div>
        <div class="segment-id">ID: ${segment.segment_id}</div>
      </div>
      <button class="segment-remove-btn" data-index="${index}">×</button>
    `;
    
    segmentsList.appendChild(segmentItem);
    
    // Event listener para eliminar segmento
    segmentItem.querySelector('.segment-remove-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const removeIndex = parseInt(e.target.dataset.index);
      removeSegment(removeIndex);
    });
  });
  
  // Actualizar contador
  document.getElementById('segmentCount').textContent = segments.length;
}

async function saveRuta() {
  const nombre_ruta = document.getElementById('rutaNombre').value.trim();
  const empresa = document.getElementById('rutaEmpresa').value;
  const descripcion = document.getElementById('rutaDescripcion').value.trim();
  
  // Obtener segment_ids
  const segments = getSelectedSegmentsArray();
  const segment_ids = segments.map(s => s.segment_id).join(',');
  
  if (!nombre_ruta || !empresa) {
    alert('Por favor complete todos los campos requeridos');
    return;
  }
  
  if (segments.length === 0) {
    alert('Debe seleccionar al menos un segmento en el mapa');
    return;
  }
  
  const basePath = window.getBasePath ? window.getBasePath() : '';
  const isEdit = selectedRuta !== null;
  
  const requestData = {
    nombre_ruta,
    empresa,
    segment_ids,
    descripcion: descripcion || null
  };
  
  try {
    const url = isEdit 
      ? `${basePath}/api/rutas/${selectedRuta.id}`
      : `${basePath}/api/rutas`;
    
    const response = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });
    
    const data = await response.json();
    
    if (data.success) {
      alert(isEdit ? 'Ruta actualizada exitosamente' : 'Ruta creada exitosamente');
      document.getElementById('rutaModal').style.display = 'none';
      stopSegmentSelection();
      await loadRutas(currentEmpresaFilter);
    } else {
      alert('Error: ' + data.error);
    }
  } catch (error) {
    console.error('Error guardando ruta:', error);
    alert('Error al guardar ruta');
  }
}

// Exportar funciones necesarias
window.clearSelectedSegmentsList = clearSelectedSegmentsList;
window.startSegmentSelection = startSegmentSelection;
window.stopSegmentSelection = stopSegmentSelection;
window.addSegmentToList = addSegmentToList;
window.removeSegment = removeSegment;