// static/js/modules/rutasMap.js

let mainMap;          // Mapa principal (fuera del modal)
let modalMap;         // Mapa dentro del modal
let currentRutaLayer = null;
let clickListeners = [];
let selectedSegments = [];
let segmentMarkers = [];

// --- Funciones principales ---

export function initializeMainMap() {
    console.log("🗺️ Inicializando mapa principal...");
    mainMap = L.map('map').setView([11.0, -74.8], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(mainMap);
    
    console.log('✅ Mapa principal inicializado');
}

export function initializeModalMap() {
    console.log("🗺️ Inicializando mapa del modal...");
    
    // Esperar a que el contenedor sea visible
    setTimeout(() => {
        if (!document.getElementById('modalMap')) {
            console.error("❌ Contenedor modalMap no encontrado");
            return;
        }
        
        modalMap = L.map('modalMap').setView([11.0, -74.8], 13);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(modalMap);
        
        console.log('✅ Mapa del modal inicializado');
    }, 100);
}

export function enableSegmentSelection(onSegmentSelected) {
    console.log("🔵 enableSegmentSelection llamado");
    
    if (!modalMap) {
        console.error("❌ ERROR: modalMap no está inicializado");
        initializeModalMap();
    }
    
    // Usar el mapa del modal para selección
    const selectionMap = modalMap || mainMap;
    console.log("🔵 Usando mapa para selección:", selectionMap === modalMap ? "modalMap" : "mainMap");
    
    // Deshabilitar cualquier listener anterior
    disableSegmentSelection();
    
    // Agregar nuevo listener para clicks
    const clickHandler = async (e) => {
        console.log("🟣 CLICK EN EL MAPA DETECTADO en:", e.latlng);
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        
        try {
            console.log("🟠 Obteniendo segmento para:", lat, lng);
            const segment = await getSegmentFromClick(lat, lng);
            console.log("🟢 Segmento obtenido:", segment);
            if (segment && onSegmentSelected) {
                console.log("🎯 Ejecutando callback con segmento");
                onSegmentSelected(segment);
            }
        } catch (error) {
            console.error('❌ Error obteniendo segmento:', error);
            alert('No se pudo obtener información de la calle en esta ubicación.');
        }
    };
    
    selectionMap.on('click', clickHandler);
    clickListeners.push({ 
        event: 'click', 
        handler: clickHandler,
        map: selectionMap 
    });
    
    // Cambiar cursor para indicar modo selección
    if (selectionMap.getContainer()) {
        selectionMap.getContainer().style.cursor = 'crosshair';
        console.log("🎯 Cursor cambiado a crosshair");
    }
    
    console.log('✅ enableSegmentSelection completado');
}

export function disableSegmentSelection() {
    console.log("🟡 disableSegmentSelection llamado");
    
    // Remover todos los listeners
    clickListeners.forEach((listener, index) => {
        console.log(`🟡 Removiendo listener ${index} del mapa`);
        if (listener.map) {
            listener.map.off(listener.event, listener.handler);
        }
    });
    clickListeners = [];
    
    // Restaurar cursor normal en ambos mapas
    if (mainMap && mainMap.getContainer()) {
        mainMap.getContainer().style.cursor = '';
    }
    if (modalMap && modalMap.getContainer()) {
        modalMap.getContainer().style.cursor = '';
    }
    
    console.log('✅ Modo selección de segmentos desactivado');
}

export function clearMap() {
    if (mainMap && currentRutaLayer) {
        mainMap.removeLayer(currentRutaLayer);
        currentRutaLayer = null;
    }
    
    clearSegmentMarkers();
    selectedSegments = [];
}

export function clearSegmentMarkers() {
    segmentMarkers.forEach(marker => {
        if (marker && modalMap) {
            modalMap.removeLayer(marker);
        }
    });
    segmentMarkers = [];
    selectedSegments = [];
    
    console.log("🧹 Marcadores de segmentos limpiados");
}

export function addSegmentMarker(segment, index) {
    if (!modalMap) {
        console.error("❌ No se puede agregar marcador: modalMap no inicializado");
        return null;
    }
    
    console.log(`📍 Agregando marcador para segmento ${index + 1}:`, segment.street_name);
    
    const marker = L.marker([segment.snapped_lat, segment.snapped_lon], {
        icon: L.divIcon({
            className: 'segment-marker',
            html: `
                <div style="
                    background: #2196f3;
                    color: white;
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    border: 3px solid white;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: bold;
                    font-size: 14px;
                ">${index + 1}</div>
            `,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        })
    }).addTo(modalMap);
    
    marker.bindPopup(`
        <div style="font-family: Arial, sans-serif; min-width: 220px;">
            <strong style="color: #2196f3;">Segmento #${index + 1}</strong><br>
            <hr style="margin: 5px 0;">
            <strong>Calle:</strong> ${segment.street_name}<br>
            <strong>ID:</strong> ${segment.segment_id}<br>
            <strong>Coordenadas:</strong><br>
            ${segment.snapped_lat.toFixed(6)}, ${segment.snapped_lon.toFixed(6)}
        </div>
    `);
    
    segmentMarkers[index] = marker;
    selectedSegments[index] = segment;
    
    return marker;
}

export function drawRutaSegments(segments) {
    clearMap();
    
    if (!segments || segments.length === 0) return;
    
    // Dibujar marcadores en el mapa principal
    segments.forEach((segment, index) => {
        addSegmentToMainMap(segment, index);
    });
}

function addSegmentToMainMap(segment, index) {
    if (!mainMap) return;
    
    const marker = L.marker([segment.snapped_lat, segment.snapped_lon], {
        icon: L.divIcon({
            className: 'segment-marker',
            html: `
                <div style="
                    background: #2196f3;
                    color: white;
                    width: 28px;
                    height: 28px;
                    border-radius: 50%;
                    border: 2px solid white;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: bold;
                    font-size: 12px;
                ">${index + 1}</div>
            `,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        })
    }).addTo(mainMap);
    
    marker.bindPopup(`
        <div style="font-family: Arial, sans-serif; min-width: 200px;">
            <strong style="color: #2196f3;">Segmento #${index + 1}</strong><br>
            <strong>Calle:</strong> ${segment.street_name}<br>
            <strong>ID:</strong> ${segment.segment_id}
        </div>
    `);
}

// --- Funciones auxiliares ---

async function getSegmentFromClick(lat, lng) {
    console.log("🌐 Llamando API para obtener segmento...");
    const basePath = window.getBasePath ? window.getBasePath() : '';
    const url = `${basePath}/api/segment/from-coords?lat=${lat}&lon=${lng}`;
    console.log("🌐 URL:", url);
    
    try {
        const response = await fetch(url);
        console.log("🌐 Respuesta HTTP:", response.status, response.statusText);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log("🌐 Datos recibidos:", data);
        
        if (data.success) {
            const segmento = {
                ...data.segment,
                original_lat: data.original_coords.lat,
                original_lon: data.original_coords.lon,
                snapped_lat: data.snapped_coords.lat,
                snapped_lon: data.snapped_coords.lon
            };
            console.log("🌐 Segmento procesado:", segmento);
            return segmento;
        } else {
            throw new Error(data.error || 'No se pudo obtener el segmento');
        }
    } catch (error) {
        console.error('❌ Error en getSegmentFromClick:', error);
        throw error;
    }
}

export function getSelectedSegmentsArray() {
    return [...selectedSegments];
}

export function getSegmentMarkers() {
    return [...segmentMarkers];
}

export function removeSegmentByIndex(index) {
    console.log(`🗑️ Intentando eliminar segmento en índice ${index}`);
    
    if (index >= 0 && index < selectedSegments.length) {
        // Remover el marcador del mapa
        if (segmentMarkers[index] && modalMap) {
            modalMap.removeLayer(segmentMarkers[index]);
            console.log(`🗑️ Marcador ${index} eliminado del mapa`);
        }
        
        // Remover de los arrays
        const removedSegment = selectedSegments.splice(index, 1)[0];
        segmentMarkers.splice(index, 1);
        
        console.log(`🗑️ Segmento eliminado:`, removedSegment.street_name);
        
        // Reindexar marcadores restantes
        segmentMarkers.forEach((marker, newIndex) => {
            if (marker) {
                marker.setIcon(L.divIcon({
                    className: 'segment-marker',
                    html: `
                        <div style="
                            background: #2196f3;
                            color: white;
                            width: 32px;
                            height: 32px;
                            border-radius: 50%;
                            border: 3px solid white;
                            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-weight: bold;
                            font-size: 14px;
                        ">${newIndex + 1}</div>
                    `,
                    iconSize: [32, 32],
                    iconAnchor: [16, 16]
                }));
                
                // Actualizar popup con nuevo índice
                if (selectedSegments[newIndex]) {
                    const segment = selectedSegments[newIndex];
                    marker.bindPopup(`
                        <div style="font-family: Arial, sans-serif; min-width: 220px;">
                            <strong style="color: #2196f3;">Segmento #${newIndex + 1}</strong><br>
                            <hr style="margin: 5px 0;">
                            <strong>Calle:</strong> ${segment.street_name}<br>
                            <strong>ID:</strong> ${segment.segment_id}<br>
                            <strong>Coordenadas:</strong><br>
                            ${segment.snapped_lat.toFixed(6)}, ${segment.snapped_lon.toFixed(6)}
                        </div>
                    `);
                }
            }
        });
        
        return true;
    }
    
    console.warn(`⚠️ Índice ${index} fuera de rango`);
    return false;
}

export function destroyModalMap() {
    if (modalMap) {
        modalMap.remove();
        modalMap = null;
        console.log("🗺️ Mapa del modal destruido");
    }
}