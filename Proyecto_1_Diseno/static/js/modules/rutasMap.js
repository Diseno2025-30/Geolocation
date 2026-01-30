// static/js/modules/rutasMap.js

let mainMap;
let clickListeners = [];
let selectedSegments = [];
let segmentMarkers = [];
let routeLayer = null; // Nueva variable para la capa de la ruta visualizada

// --- Inicialización ---
export function initializeMainMap() {
    console.log("🗺️ Inicializando mapa principal...");
    mainMap = L.map('map').setView([11.0, -74.8], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(mainMap);
    
    console.log('✅ Mapa principal inicializado');
}

// --- Selección de segmentos ---
export function enableSegmentSelection(onSegmentSelected) {
    console.log("🔵 enableSegmentSelection llamado");
    
    if (!mainMap) {
        console.error("❌ mainMap no inicializado");
        return;
    }
    
    disableSegmentSelection();
    
    const clickHandler = async (e) => {
        console.log("🟣 CLICK detectado:", e.latlng);
        
        try {
            const segment = await getSegmentFromClick(e.latlng.lat, e.latlng.lng);
            console.log("🟢 Segmento obtenido:", segment);
            if (segment && onSegmentSelected) {
                onSegmentSelected(segment);
            }
        } catch (error) {
            console.error('❌ Error:', error);
            alert('No se pudo obtener información de la calle');
        }
    };
    
    mainMap.on('click', clickHandler);
    clickListeners.push({ event: 'click', handler: clickHandler, map: mainMap });
    
    if (mainMap.getContainer()) {
        mainMap.getContainer().style.cursor = 'crosshair';
    }
    
    console.log('✅ Selección activada');
}

export function disableSegmentSelection() {
    console.log("🟡 Desactivando selección...");
    
    clickListeners.forEach((listener) => {
        if (listener.map) {
            listener.map.off(listener.event, listener.handler);
        }
    });
    clickListeners = [];
    
    if (mainMap && mainMap.getContainer()) {
        mainMap.getContainer().style.cursor = '';
    }
    
    console.log('✅ Selección desactivada');
}

// --- Marcadores para modo edición ---
export function addSegmentMarker(segment, index) {
    if (!mainMap) {
        console.error("❌ mainMap no inicializado");
        return null;
    }
    
    console.log(`📍 Agregando marcador ${index + 1}:`, segment.street_name);
    
    const marker = L.marker([segment.snapped_lat, segment.snapped_lon], {
        icon: L.divIcon({
            className: 'segment-marker',
            html: `<div style="background: #2196f3; color: white; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-weight: bold;">${index + 1}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        })
    }).addTo(mainMap);
    
    marker.bindPopup(`<strong>${segment.street_name}</strong><br>ID: ${segment.segment_id}`);
    
    segmentMarkers[index] = marker;
    selectedSegments[index] = segment;
    
    return marker;
}

export function clearSegmentMarkers() {
    segmentMarkers.forEach(marker => {
        if (marker && mainMap) {
            mainMap.removeLayer(marker);
        }
    });
    segmentMarkers = [];
    selectedSegments = [];
    console.log("🧹 Marcadores limpiados");
}

export function removeSegmentByIndex(index) {
    console.log(`🗑️ Eliminando índice ${index}`);
    
    if (index >= 0 && index < selectedSegments.length) {
        if (segmentMarkers[index] && mainMap) {
            mainMap.removeLayer(segmentMarkers[index]);
        }
        
        selectedSegments.splice(index, 1);
        segmentMarkers.splice(index, 1);
        
        // Reindexar
        segmentMarkers.forEach((marker, newIndex) => {
            if (marker) {
                marker.setIcon(L.divIcon({
                    className: 'segment-marker',
                    html: `<div style="background: #2196f3; color: white; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-weight: bold;">${newIndex + 1}</div>`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                }));
                
                if (selectedSegments[newIndex]) {
                    const seg = selectedSegments[newIndex];
                    marker.bindPopup(`<strong>${seg.street_name}</strong><br>ID: ${seg.segment_id}`);
                }
            }
        });
        
        return true;
    }
    
    return false;
}

// --- NUEVA FUNCIÓN: Dibujar ruta completa ---
export async function drawCompleteRoute(segmentIds) {
    console.log("🎨 Dibujando ruta completa con segmentos:", segmentIds);
    
    // Limpiar ruta anterior
    clearRouteLayer();
    
    if (!segmentIds || segmentIds.length === 0) {
        console.warn("⚠️ No hay segmentos para dibujar");
        return;
    }
    
    try {
        // Obtener detalles de cada segmento
        const segmentDetails = await Promise.all(
            segmentIds.map(id => getSegmentById(id))
        );
        
        console.log("📦 Detalles de segmentos obtenidos:", segmentDetails.length);
        
        // Crear grupo de capas para la ruta
        routeLayer = L.featureGroup();
        
        // Array para las coordenadas de la polilínea
        const routeCoordinates = [];
        
        // Dibujar cada segmento
        segmentDetails.forEach((segment, index) => {
            if (!segment) {
                console.warn(`⚠️ Segmento ${index} no tiene datos`);
                return;
            }
            
            // Extraer coordenadas del segmento
            const coords = extractSegmentCoordinates(segment);
            
            if (coords && coords.length > 0) {
                // Agregar coordenadas a la ruta completa
                routeCoordinates.push(...coords);
                
                // Crear marcador numerado
                const marker = L.marker(coords[0], {
                    icon: L.divIcon({
                        className: 'route-segment-marker',
                        html: `<div style="
                            background: linear-gradient(135deg, #4caf50 0%, #388e3c 100%);
                            color: white;
                            width: 32px;
                            height: 32px;
                            border-radius: 50%;
                            border: 3px solid white;
                            box-shadow: 0 3px 10px rgba(0,0,0,0.4);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-weight: bold;
                            font-size: 14px;
                        ">${index + 1}</div>`,
                        iconSize: [32, 32],
                        iconAnchor: [16, 16]
                    })
                });
                
                marker.bindPopup(`
                    <div style="font-family: Arial; min-width: 200px;">
                        <strong style="color: #4caf50;">Segmento #${index + 1}</strong><br>
                        <hr style="margin: 5px 0;">
                        <strong>Calle:</strong> ${segment.street_name || 'Sin nombre'}<br>
                        <strong>ID:</strong> ${segment.segment_id}<br>
                        ${segment.segment_length ? `<strong>Longitud:</strong> ${segment.segment_length}m<br>` : ''}
                    </div>
                `);
                
                routeLayer.addLayer(marker);
            }
        });
        
        // Dibujar polilínea conectando todos los segmentos
        if (routeCoordinates.length > 1) {
            const polyline = L.polyline(routeCoordinates, {
                color: '#4caf50',
                weight: 4,
                opacity: 0.7,
                smoothFactor: 1
            });
            
            routeLayer.addLayer(polyline);
        }
        
        // Agregar la capa al mapa
        routeLayer.addTo(mainMap);
        
        // Ajustar el mapa para mostrar toda la ruta
        if (routeLayer.getBounds().isValid()) {
            mainMap.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });
        }
        
        console.log("✅ Ruta dibujada con éxito");
        
    } catch (error) {
        console.error("❌ Error dibujando ruta:", error);
        alert("Error al cargar la ruta: " + error.message);
    }
}

// --- NUEVA FUNCIÓN: Limpiar capa de ruta ---
export function clearRouteLayer() {
    if (routeLayer && mainMap) {
        mainMap.removeLayer(routeLayer);
        routeLayer = null;
        console.log("🧹 Capa de ruta limpiada");
    }
}

export function clearMap() {
    clearSegmentMarkers();
    clearRouteLayer();
    selectedSegments = [];
}

export function getSelectedSegmentsArray() {
    return [...selectedSegments];
}

// --- API Helpers ---
async function getSegmentFromClick(lat, lng) {
    console.log("🌐 Llamando API para coordenadas...");
    const basePath = window.getBasePath ? window.getBasePath() : '';
    const url = `${basePath}/api/segment/from-coords?lat=${lat}&lon=${lng}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.success) {
        return {
            ...data.segment,
            original_lat: data.original_coords.lat,
            original_lon: data.original_coords.lon,
            snapped_lat: data.snapped_coords.lat,
            snapped_lon: data.snapped_coords.lon
        };
    } else {
        throw new Error(data.error || 'No se pudo obtener el segmento');
    }
}

// --- NUEVA FUNCIÓN: Obtener segmento por ID ---
async function getSegmentById(segmentId) {
    console.log(`🌐 Obteniendo segmento por ID: ${segmentId}`);
    const basePath = window.getBasePath ? window.getBasePath() : '';
    const url = `${basePath}/api/segment/${segmentId}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            console.log(`✅ Segmento ${segmentId} obtenido`);
            return data.segment;
        } else {
            console.error(`❌ Error obteniendo segmento ${segmentId}:`, data.error);
            return null;
        }
    } catch (error) {
        console.error(`❌ Error en petición para segmento ${segmentId}:`, error);
        return null;
    }
}

// --- NUEVA FUNCIÓN: Extraer coordenadas del segmento ---
function extractSegmentCoordinates(segment) {
    // El segmento puede tener diferentes formatos de coordenadas
    // Intenta extraer del campo 'nodes' o 'geometry'
    
    if (segment.nodes && Array.isArray(segment.nodes)) {
        // Formato: [{lat, lon}, {lat, lon}]
        return segment.nodes.map(node => [node.lat, node.lon]);
    }
    
    if (segment.geometry && segment.geometry.coordinates) {
        // Formato GeoJSON: [[lon, lat], [lon, lat]]
        return segment.geometry.coordinates.map(coord => [coord[1], coord[0]]);
    }
    
    // Fallback: usar coordenadas snapped si existen
    if (segment.snapped_lat && segment.snapped_lon) {
        return [[segment.snapped_lat, segment.snapped_lon]];
    }
    
    console.warn("⚠️ No se pudieron extraer coordenadas del segmento:", segment);
    return [];
}