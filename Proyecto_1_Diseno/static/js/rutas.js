// static/js/rutas.js

import { 
    initializeMainMap, 
    initializeModalMap,
    clearMap, 
    enableSegmentSelection, 
    disableSegmentSelection,
    addSegmentMarker,
    clearSegmentMarkers,
    getSelectedSegmentsArray,
    getSegmentMarkers,
    removeSegmentByIndex,
    destroyModalMap
} from './modules/rutasMap.js';

let empresasData = [];
let rutasData = [];
let selectedRuta = null;
let currentEmpresaFilter = '';
let isSelectingSegments = false;

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
            rutasList.innerHTML = '<p class="loading-text" style="color: #dc2626;">Error cargando rutas</p>';
        }
    } catch (error) {
        console.error('❌ Error cargando rutas:', error);
        const rutasList = document.getElementById('rutasList');
        rutasList.innerHTML = '<p class="loading-text" style="color: #dc2626;">Error cargando rutas</p>';
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
    
    // Selector en modal
    if (rutaEmpresa) {
        rutaEmpresa.innerHTML = '<option value="">Seleccione una empresa</option>';
        empresasData.forEach(empresa => {
            const option = document.createElement('option');
            option.value = empresa;
            option.textContent = empresa;
            rutaEmpresa.appendChild(option);
        });
        console.log("✅ Selector del modal poblado");
    }
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
    
    console.log(`✅ ${rutasData.length} rutas mostradas`);
}

// --- Acciones de Rutas ---
function viewRuta(rutaId) {
    console.log(`👁️ Viendo ruta ${rutaId}`);
    const ruta = rutasData.find(r => r.id === rutaId);
    if (!ruta) return;
    
    selectedRuta = ruta;
    
    // Actualizar UI
    document.querySelectorAll('.ruta-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-ruta-id="${rutaId}"]`)?.classList.add('active');
    
    // Actualizar info del mapa
    const elementos = ['selectedRutaName', 'selectedRutaEmpresa', 'selectedRutaSegments'];
    elementos.forEach(id => {
        const elem = document.getElementById(id);
        if (elem) {
            if (id === 'selectedRutaName') elem.textContent = ruta.nombre_ruta;
            else if (id === 'selectedRutaEmpresa') elem.textContent = ruta.empresa;
            else if (id === 'selectedRutaSegments') {
                const segmentCount = ruta.segment_ids.split(',').filter(s => s.trim()).length;
                elem.textContent = segmentCount;
            }
        }
    });
    
    // TODO: Mostrar ruta en el mapa principal
    console.log('📌 Mostrando ruta:', ruta);
}

function editRuta(rutaId) {
    console.log(`✏️ Editando ruta ${rutaId}`);
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
    console.log(`📌 Segmentos existentes: ${segmentIds.length}`);
    
    // TODO: Cargar información completa de los segmentos
    
    // Mostrar modal
    showRutaModal();
    selectedRuta = ruta;
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
                updateMapInfo('Ninguna', '---', '0');
            }
        } else {
            alert('Error al eliminar ruta: ' + data.error);
        }
    } catch (error) {
        console.error('Error eliminando ruta:', error);
        alert('Error al eliminar ruta');
    }
}

// --- Manejo del Modal ---
function showRutaModal() {
    console.log("🪟 Mostrando modal...");
    
    // Inicializar mapa del modal
    initializeModalMap();
    
    // Mostrar modal
    const modal = document.getElementById('rutaModal');
    if (modal) {
        modal.style.display = 'flex';
        console.log("✅ Modal mostrado");
        
        // Actualizar debug
        const debugModal = document.getElementById('debugModal');
        if (debugModal) {
            debugModal.textContent = '✅';
            debugModal.style.color = '#0f0';
        }
    } else {
        console.error("❌ Modal no encontrado");
    }
    
    // Activar modo selección de segmentos después de que el mapa esté listo
    setTimeout(() => {
        startSegmentSelection();
    }, 500);
}

function hideRutaModal() {
    console.log("🪟 Ocultando modal...");
    
    const modal = document.getElementById('rutaModal');
    if (modal) {
        modal.style.display = 'none';
        console.log("✅ Modal ocultado");
        
        // Actualizar debug
        const debugModal = document.getElementById('debugModal');
        if (debugModal) {
            debugModal.textContent = '❌';
            debugModal.style.color = '#f00';
        }
    }
    
    // Limpiar mapa del modal
    destroyModalMap();
    stopSegmentSelection();
}

// --- Event Listeners ---
function setupEventListeners() {
    console.log("🔧 Configurando event listeners...");
    
    // Filtro de empresa
    const empresaSelector = document.getElementById('empresaSelector');
    if (empresaSelector) {
        empresaSelector.addEventListener('change', async (e) => {
            currentEmpresaFilter = e.target.value;
            console.log(`🔍 Filtrando por empresa: ${currentEmpresaFilter || 'Todas'}`);
            await loadRutas(currentEmpresaFilter);
            selectedRuta = null;
            clearMap();
            updateMapInfo('Ninguna', '---', '0');
        });
    }
    
    // Botón crear ruta
    const btnCrearRuta = document.getElementById('btnCrearRuta');
    if (btnCrearRuta) {
        btnCrearRuta.addEventListener('click', () => {
            console.log("🎯 Creando nueva ruta...");
            document.getElementById('modalTitle').textContent = 'Crear Nueva Ruta';
            document.getElementById('rutaForm').reset();
            selectedRuta = null;
            
            // Limpiar selección previa
            clearSelectedSegmentsList();
            clearSegmentMarkers();
            
            // Mostrar modal
            showRutaModal();
        });
    }
    
    // Cerrar modal
    const closeRutaModal = document.getElementById('closeRutaModal');
    if (closeRutaModal) {
        closeRutaModal.addEventListener('click', () => {
            console.log("❌ Cerrando modal...");
            hideRutaModal();
        });
    }
    
    const cancelRutaBtn = document.getElementById('cancelRutaBtn');
    if (cancelRutaBtn) {
        cancelRutaBtn.addEventListener('click', () => {
            console.log("❌ Cancelando...");
            hideRutaModal();
        });
    }
    
    // Submit formulario
    const rutaForm = document.getElementById('rutaForm');
    if (rutaForm) {
        rutaForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log("📤 Enviando formulario...");
            await saveRuta();
        });
    }
    
    // Botón limpiar segmentos
    const btnLimpiarSegmentos = document.getElementById('btnLimpiarSegmentos');
    if (btnLimpiarSegmentos) {
        btnLimpiarSegmentos.addEventListener('click', () => {
            console.log("🧹 Limpiando segmentos...");
            clearSelectedSegmentsList();
            clearSegmentMarkers();
        });
    }
    
    console.log("✅ Event listeners configurados");
}

// --- Manejo de Segmentos ---
function startSegmentSelection() {
    console.log("🎯 Iniciando selección de segmentos...");
    isSelectingSegments = true;
    
    enableSegmentSelection((segment) => {
        console.log("🎯 Segmento seleccionado:", segment.street_name);
        addSegmentToList(segment);
    });
    
    console.log('✅ Modo selección de segmentos activado');
}

function stopSegmentSelection() {
    console.log("🎯 Deteniendo selección de segmentos...");
    isSelectingSegments = false;
    disableSegmentSelection();
    console.log('✅ Modo selección de segmentos desactivado');
}

function addSegmentToList(segment) {
    console.log(`📝 Agregando segmento a la lista: ${segment.street_name}`);
    
    const segmentsList = document.getElementById('selectedSegmentsList');
    const placeholder = document.getElementById('segmentsPlaceholder');
    
    if (!segmentsList || !placeholder) {
        console.error("❌ Elementos de lista de segmentos no encontrados");
        return;
    }
    
    // Ocultar placeholder y mostrar lista
    if (placeholder) placeholder.style.display = 'none';
    segmentsList.style.display = 'block';
    
    // Obtener el índice actual
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
    
    // Actualizar debug
    const debugSegments = document.getElementById('debugSegments');
    if (debugSegments) {
        debugSegments.textContent = index + 1;
    }
    
    // Event listener para eliminar segmento
    segmentItem.querySelector('.segment-remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const removeIndex = parseInt(e.target.dataset.index);
        console.log(`🗑️ Eliminando segmento ${removeIndex}`);
        removeSegment(removeIndex);
    });
    
    console.log(`✅ Segmento agregado (total: ${index + 1})`);
}

function removeSegment(index) {
    console.log(`🗑️ Eliminando segmento en índice ${index}`);
    
    // Usar la función del módulo de mapa
    if (removeSegmentByIndex(index)) {
        // Actualizar UI de lista de segmentos
        clearSelectedSegmentsList();
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
    
    if (!segmentsList || !placeholder) return;
    
    segmentsList.innerHTML = '';
    segmentsList.style.display = 'none';
    
    placeholder.style.display = 'block';
    
    // Actualizar debug
    const debugSegments = document.getElementById('debugSegments');
    if (debugSegments) {
        debugSegments.textContent = '0';
    }
}

function redrawSegmentList() {
    console.log("🔄 Redibujando lista de segmentos...");
    
    const segmentsList = document.getElementById('selectedSegmentsList');
    const placeholder = document.getElementById('segmentsPlaceholder');
    const segments = getSelectedSegmentsArray();
    
    if (!segmentsList || !placeholder) return;
    
    // Limpiar lista actual
    segmentsList.innerHTML = '';
    
    if (segments.length === 0) {
        // Mostrar placeholder si no hay segmentos
        segmentsList.style.display = 'none';
        placeholder.style.display = 'block';
        document.getElementById('segmentCount').textContent = '0';
        return;
    }
    
    // Ocultar placeholder y mostrar lista
    placeholder.style.display = 'none';
    segmentsList.style.display = 'block';
    
    // Redibujar todos los segmentos
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
    
    // Actualizar debug
    const debugSegments = document.getElementById('debugSegments');
    if (debugSegments) {
        debugSegments.textContent = segments.length;
    }
    
    console.log(`✅ Lista redibujada con ${segments.length} segmentos`);
}

// --- Funciones de utilidad ---
function updateMapInfo(nombre, empresa, segmentos) {
    console.log(`📊 Actualizando info del mapa: ${nombre}, ${empresa}, ${segmentos}`);
    
    const elementos = [
        { id: 'selectedRutaName', value: nombre },
        { id: 'selectedRutaEmpresa', value: empresa },
        { id: 'selectedRutaSegments', value: segmentos }
    ];
    
    elementos.forEach(item => {
        const elem = document.getElementById(item.id);
        if (elem) {
            elem.textContent = item.value;
        }
    });
}

async function saveRuta() {
    console.log("💾 Guardando ruta...");
    
    const nombre_ruta = document.getElementById('rutaNombre').value.trim();
    const empresa = document.getElementById('rutaEmpresa').value;
    const descripcion = document.getElementById('rutaDescripcion').value.trim();
    
    // Obtener segment_ids
    const segments = getSelectedSegmentsArray();
    const segment_ids = segments.map(s => s.segment_id).join(',');
    
    console.log("📋 Datos a guardar:", {
        nombre_ruta,
        empresa,
        segment_ids,
        segmentCount: segments.length,
        descripcion
    });
    
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
    
    console.log("📤 Enviando datos:", requestData);
    
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
        console.log("📥 Respuesta del servidor:", data);
        
        if (data.success) {
            alert(isEdit ? 'Ruta actualizada exitosamente' : 'Ruta creada exitosamente');
            hideRutaModal();
            await loadRutas(currentEmpresaFilter);
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        console.error('❌ Error guardando ruta:', error);
        alert('Error al guardar ruta');
    }
}

// Exportar funciones necesarias
window.clearSelectedSegmentsList = clearSelectedSegmentsList;
window.startSegmentSelection = startSegmentSelection;
window.stopSegmentSelection = stopSegmentSelection;
window.addSegmentToList = addSegmentToList;
window.removeSegment = removeSegment;