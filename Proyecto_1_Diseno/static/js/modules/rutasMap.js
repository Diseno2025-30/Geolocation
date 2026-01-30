// static/js/modules/rutasMap.js

let mainMap;
let clickListeners = [];
let selectedSegments = [];
let segmentMarkers = [];

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

// --- Marcadores ---
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

export function clearMap() {
    clearSegmentMarkers();
    selectedSegments = [];
}

export function getSelectedSegmentsArray() {
    return [...selectedSegments];
}

// --- API ---
async function getSegmentFromClick(lat, lng) {
    console.log("🌐 Llamando API...");
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