// static/js/rutas.js

import {
    initializeMainMap,
    enableSegmentSelection,
    disableSegmentSelection,
    addSegmentMarker,
    clearSegmentMarkers,
    getSelectedSegmentsArray,
    removeSegmentByIndex,
    clearMap,
    drawCompleteRoute,
    clearRouteLayer
} from './modules/rutasMap.js';

import {
    setupBuildingSelector,
    getSelectedBuildings,
    clearSelectedBuildings
} from './modules/rutasBuildings.js';

let empresasData = [];
let rutasData = [];
let selectedRuta = null;
let currentEmpresaFilter = '';
let isEditMode = false;

// --- Inicialización ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("🟢 DOMContentLoaded disparado");
    
    // Configurar navegación
    if (window.setupViewNavigation) {
        window.setupViewNavigation();
    }

    // Inicializar mapa principal
    initializeMainMap();

    // Cargar datos iniciales
    await loadEmpresas();
    await loadRutas();

    // Event listeners
    setupEventListeners();
    
    console.log("✅ Aplicación inicializada");
});

// --- Carga de Datos ---
async function loadEmpresas() {
    console.log("📊 Cargando empresas...");
    const basePath = window.getBasePath ? window.getBasePath() : '';
    
    try {
        const response = await fetch(`${basePath}/api/empresas`);
        const data = await response.json();
        
        if (data.success) {
            empresasData = data.empresas;
            console.log(`✅ ${empresasData.length} empresas cargadas`);
            populateEmpresaSelectors();
        } else {
            console.error("❌ Error cargando empresas:", data.error);
        }
    } catch (error) {
        console.error('❌ Error cargando empresas:', error);
    }
}

async function loadRutas(empresa = '') {
    console.log("📊 Cargando rutas...", empresa ? `(Filtro: ${empresa})` : '');
    const basePath = window.getBasePath ? window.getBasePath() : '';
    const url = empresa 
        ? `${basePath}/api/rutas?empresa=${encodeURIComponent(empresa)}`
        : `${basePath}/api/rutas`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            rutasData = data.rutas;
            console.log(`✅ ${rutasData.length} rutas cargadas`);
            displayRutasList();
        } else {
            console.error("❌ Error cargando rutas:", data.error);
            const rutasList = document.getElementById('rutasList');
            rutasList.innerHTML = '<p style="color: #dc2626;">Error cargando rutas</p>';
        }
    } catch (error) {
        console.error('❌ Error cargando rutas:', error);
        const rutasList = document.getElementById('rutasList');
        rutasList.innerHTML = '<p style="color: #dc2626;">Error cargando rutas</p>';
    }
}

// --- UI Rendering ---
function populateEmpresaSelectors() {
    console.log("🔧 Poblando selectores de empresa...");
    const empresaSelector = document.getElementById('empresaSelector');
    const rutaEmpresa = document.getElementById('rutaEmpresa');
    
    // Selector principal (filtro)
    if (empresaSelector) {
        empresaSelector.innerHTML = '<option value="">Todas las empresas</option>';
        empresasData.forEach(empresa => {
            const option = document.createElement('option');
            option.value = empresa;
            option.textContent = empresa;
            empresaSelector.appendChild(option);
        });
        console.log("✅ Selector de filtro poblado");
    }
    
    // Selector en editor
    if (rutaEmpresa) {
        rutaEmpresa.innerHTML = '<option value="">Seleccione una empresa</option>';
        empresasData.forEach(empresa => {
            const option = document.createElement('option');
            option.value = empresa;
            option.textContent = empresa;
            rutaEmpresa.appendChild(option);
        });
        console.log("✅ Selector del editor poblado");
    }
}

function displayRutasList() {
    const rutasList = document.getElementById('rutasList');
    
    if (rutasData.length === 0) {
        rutasList.innerHTML = '<p style="color: #888;">No hay rutas disponibles</p>';
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
            viewRuta(parseInt(btn.dataset.rutaId));
        });
    });
    
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            editRuta(parseInt(btn.dataset.rutaId));
        });
    });
    
    document.querySelectorAll('.delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteRuta(parseInt(btn.dataset.rutaId));
        });
    });
    
    console.log(`✅ ${rutasData.length} rutas mostradas`);
}

// --- Acciones de Rutas ---
async function viewRuta(rutaId) {
    console.log(`👁️ Viendo ruta ${rutaId}`);
    const ruta = rutasData.find(r => r.id === rutaId);
    if (!ruta) return;
    
    selectedRuta = ruta;
    
    // Cerrar editor si está abierto
    hideEditor();
    
    // Actualizar UI
    document.querySelectorAll('.ruta-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-ruta-id="${rutaId}"]`)?.classList.add('active');
    
    // Parsear segment_ids
    const segmentIds = ruta.segment_ids
        .split(',')
        .map(id => id.trim())
        .filter(id => id);
    
    console.log(`📌 Mostrando ruta con ${segmentIds.length} segmentos:`, segmentIds);
    
    // Actualizar info del mapa
    updateMapInfo(ruta.nombre_ruta, ruta.empresa, segmentIds.length);
    
    // Dibujar ruta en el mapa
    await drawCompleteRoute(segmentIds);
}

function editRuta(rutaId) {
    console.log(`✏️ Editando ruta ${rutaId}`);
    const ruta = rutasData.find(r => r.id === rutaId);
    if (!ruta) return;
    
    selectedRuta = ruta;
    isEditMode = true;
    
    // Poblar formulario
    document.getElementById('editorTitle').textContent = 'Editar Ruta';
    document.getElementById('rutaNombre').value = ruta.nombre_ruta;
    document.getElementById('rutaEmpresa').value = ruta.empresa;
    document.getElementById('rutaDescripcion').value = ruta.descripcion || '';
    
    // Limpiar y mostrar editor
    clearSelectedSegmentsList();
    clearSegmentMarkers();
    showEditor();
    
    // Activar selección de segmentos
    startSegmentSelection();
    
    // TODO: Cargar segmentos existentes
    console.log(`📌 Segmentos existentes: ${ruta.segment_ids}`);
}

async function deleteRuta(rutaId) {
    const ruta = rutasData.find(r => r.id === rutaId);
    if (!ruta) return;
    
    if (!confirm(`¿Está seguro de eliminar la ruta "${ruta.nombre_ruta}"?`)) return;
    
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
                updateMapInfo('Ninguna', '---', 0);
            }
        } else {
            alert('Error al eliminar ruta: ' + data.error);
        }
    } catch (error) {
        console.error('Error eliminando ruta:', error);
        alert('Error al eliminar ruta');
    }
}

// --- Manejo del Editor ---
function showEditor() {
    console.log("🪟 Mostrando editor...");
    const editor = document.getElementById('rutaEditorPanel');

    if (editor) {
        editor.style.display = 'flex';

        // Inicializar selector de edificios con callback para segmentos
        setupBuildingSelector(handleSegmentsFromBuildings);

        console.log("✅ Editor mostrado");
    }
}

// Callback cuando se calculan segmentos desde edificios
function handleSegmentsFromBuildings(segments) {
    console.log(`📍 Recibidos ${segments.length} segmentos desde edificios`);

    // Limpiar segmentos anteriores
    clearSelectedSegmentsList();
    clearSegmentMarkers();

    // Agregar cada segmento a la lista
    segments.forEach(segment => {
        addSegmentToList({
            segment_id: segment.segment_id,
            street_name: `${segment.street_name} (${segment.building_name})`,
            lat: segment.snapped_lat,
            lon: segment.snapped_lon
        });
    });

    console.log(`✅ ${segments.length} segmentos agregados a la ruta`);
}

function hideEditor() {
    console.log("🪟 Ocultando editor...");
    const editor = document.getElementById('rutaEditorPanel');

    if (editor) {
        editor.style.display = 'none';
        console.log("✅ Editor ocultado");
    }

    stopSegmentSelection();
    clearSegmentMarkers();
    clearSelectedBuildings();
    selectedRuta = null;
    isEditMode = false;
}

// --- Event Listeners ---
function setupEventListeners() {
    console.log("🔧 Configurando event listeners...");
    
    // Filtro de empresa
    document.getElementById('empresaSelector')?.addEventListener('change', async (e) => {
        currentEmpresaFilter = e.target.value;
        console.log(`🔍 Filtrando por empresa: ${currentEmpresaFilter || 'Todas'}`);
        await loadRutas(currentEmpresaFilter);
        selectedRuta = null;
        clearMap(); // Esto ahora limpia tanto marcadores como la ruta
        updateMapInfo('Ninguna', '---', 0);
    });
    
    // Botón crear ruta
    document.getElementById('btnCrearRuta')?.addEventListener('click', () => {
        console.log("🎯 Creando nueva ruta...");
        isEditMode = false;
        selectedRuta = null;
        document.getElementById('editorTitle').textContent = 'Crear Nueva Ruta';
        document.getElementById('rutaForm').reset();
        clearMap(); // Limpiar todo antes de crear nueva ruta
        showEditor();
        startSegmentSelection();
    });
    
    // Botones del editor
    document.getElementById('btnCerrarEditor')?.addEventListener('click', hideEditor);
    document.getElementById('btnCancelar')?.addEventListener('click', hideEditor);
    
    document.getElementById('btnGuardar')?.addEventListener('click', async () => {
        await saveRuta();
    });
    
    // Botón limpiar segmentos
    document.getElementById('btnLimpiarSegmentos')?.addEventListener('click', () => {
        console.log("🧹 Limpiando segmentos...");
        clearSelectedSegmentsList();
        clearSegmentMarkers();
    });
    
    console.log("✅ Event listeners configurados");
}

// --- Manejo de Segmentos ---
function startSegmentSelection() {
    console.log("🎯 Iniciando selección de segmentos...");
    
    enableSegmentSelection((segment) => {
        console.log("🎯 Segmento seleccionado:", segment.street_name);
        addSegmentToList(segment);
    });
    
    console.log('✅ Modo selección activado');
}

function stopSegmentSelection() {
    console.log("🎯 Deteniendo selección de segmentos...");
    disableSegmentSelection();
    console.log('✅ Modo selección desactivado');
}

function addSegmentToList(segment) {
    console.log(`📝 Agregando segmento: ${segment.street_name}`);
    
    const segmentsList = document.getElementById('selectedSegmentsList');
    const placeholder = document.getElementById('segmentsPlaceholder');
    const btnLimpiar = document.getElementById('btnLimpiarSegmentos');
    
    if (!segmentsList || !placeholder) {
        console.error("❌ Elementos no encontrados");
        return;
    }
    
    // Mostrar lista, ocultar placeholder
    placeholder.style.display = 'none';
    segmentsList.style.display = 'block';
    if (btnLimpiar) btnLimpiar.style.display = 'block';
    
    // Obtener índice
    const segments = getSelectedSegmentsArray();
    const index = segments.length;
    
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
    
    // Event listener para eliminar
    segmentItem.querySelector('.segment-remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        removeSegment(parseInt(e.target.dataset.index));
    });
    
    console.log(`✅ Segmento agregado (total: ${index + 1})`);
}

function removeSegment(index) {
    console.log(`🗑️ Eliminando segmento ${index}`);
    
    if (removeSegmentByIndex(index)) {
        redrawSegmentList();
        console.log(`✅ Segmento ${index} eliminado`);
    } else {
        console.error(`❌ No se pudo eliminar segmento ${index}`);
    }
}

function clearSelectedSegmentsList() {
    console.log("🧹 Limpiando lista de segmentos...");
    
    const segmentsList = document.getElementById('selectedSegmentsList');
    const placeholder = document.getElementById('segmentsPlaceholder');
    const btnLimpiar = document.getElementById('btnLimpiarSegmentos');
    
    if (!segmentsList || !placeholder) return;
    
    segmentsList.innerHTML = '';
    segmentsList.style.display = 'none';
    placeholder.style.display = 'block';
    if (btnLimpiar) btnLimpiar.style.display = 'none';
    
    document.getElementById('segmentCount').textContent = '0';
}

function redrawSegmentList() {
    console.log("🔄 Redibujando lista...");
    
    const segmentsList = document.getElementById('selectedSegmentsList');
    const placeholder = document.getElementById('segmentsPlaceholder');
    const segments = getSelectedSegmentsArray();
    
    if (!segmentsList || !placeholder) return;
    
    segmentsList.innerHTML = '';
    
    if (segments.length === 0) {
        segmentsList.style.display = 'none';
        placeholder.style.display = 'block';
        document.getElementById('btnLimpiarSegmentos').style.display = 'none';
        document.getElementById('segmentCount').textContent = '0';
        return;
    }
    
    placeholder.style.display = 'none';
    segmentsList.style.display = 'block';
    
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
        
        segmentItem.querySelector('.segment-remove-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            removeSegment(parseInt(e.target.dataset.index));
        });
    });
    
    document.getElementById('segmentCount').textContent = segments.length;

    console.log(`✅ Lista redibujada: ${segments.length} segmentos`);
}

// --- Utilidades ---
function updateMapInfo(nombre, empresa, segmentos) {
    console.log(`📊 Actualizando info: ${nombre}, ${empresa}, ${segmentos}`);
    
    document.getElementById('selectedRutaName').textContent = nombre;
    document.getElementById('selectedRutaEmpresa').textContent = empresa;
    document.getElementById('selectedRutaSegments').textContent = segmentos;
}

async function saveRuta() {
    console.log("💾 Guardando ruta...");
    
    const nombre_ruta = document.getElementById('rutaNombre').value.trim();
    const empresa = document.getElementById('rutaEmpresa').value;
    const descripcion = document.getElementById('rutaDescripcion').value.trim();
    const segments = getSelectedSegmentsArray();
    const segment_ids = segments.map(s => s.segment_id).join(',');
    
    if (!nombre_ruta || !empresa) {
        alert('Complete todos los campos requeridos');
        return;
    }
    
    if (segments.length === 0) {
        alert('Seleccione al menos un segmento');
        return;
    }
    
    const basePath = window.getBasePath ? window.getBasePath() : '';
    const url = isEditMode 
        ? `${basePath}/api/rutas/${selectedRuta.id}`
        : `${basePath}/api/rutas`;
    
    try {
        const response = await fetch(url, {
            method: isEditMode ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre_ruta, empresa, segment_ids, descripcion: descripcion || null })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(isEditMode ? 'Ruta actualizada' : 'Ruta creada');
            hideEditor();
            await loadRutas(currentEmpresaFilter);
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al guardar ruta');
    }
}