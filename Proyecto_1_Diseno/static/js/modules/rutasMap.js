// static/js/modules/rutasMap.js

let mainMap;
let clickListeners = [];
let selectedSegments = [];
let segmentMarkers = [];
let routeLayer = null; // Nueva variable para la capa de la ruta visualizada

// --- Inicialización ---
export function initializeMainMap() {
    console.log("🗺️ Inicializando mapa principal...");
    mainMap = L.map('map').setView([10.9639, -74.7964], 13);

    // Capa base OSM rasterizada (contexto de la ciudad)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(mainMap);

    // Instancia fondo — solo landuse (endpoint dedicado, canvas independiente)
    L.vectorGrid.protobuf('/tiles-bg/{z}/{x}/{y}.mvt', {
        vectorTileLayerStyles: {
            landuse: { weight: 0, fill: true, fillColor: '#f5f0e8', fillOpacity: 1 },
        },
        maxZoom: 19,
        zIndex: 5,
    }).addTo(mainMap);

    // Instancia features — roads, buildings, water, place (sin landuse)
    L.vectorGrid.protobuf('/tiles/{z}/{x}/{y}.mvt', {
        vectorTileLayerStyles: {
            roads:    { weight: 1.5, color: '#aaa', opacity: 0.9, fill: false },
            building: { weight: 1, color: '#c9b99a', opacity: 1, fill: true, fillColor: '#d9d0c9', fillOpacity: 0.5 },
            water:    { weight: 1, color: '#4fc3f7', opacity: 0.8, fill: true, fillColor: '#81d4fa', fillOpacity: 0.5 },
            place:    { radius: 3, weight: 1, color: '#fff', opacity: 1, fill: true, fillColor: '#3388ff', fillOpacity: 0.8 },
        },
        maxZoom: 19,
        zIndex: 10,
        attribution: '&copy; OpenStreetMap contributors | Tiles: Barranquilla Local',
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
        // Obtener coordenadas de todos los segmentos en batch
        const segmentsMap = await getSegmentCoordsBatch(segmentIds);

        console.log("📦 Coordenadas obtenidas:", Object.keys(segmentsMap).length, "de", segmentIds.length);

        // Crear grupo de capas para la ruta
        routeLayer = L.featureGroup();

        // Recolectar coordenadas válidas en orden
        const waypoints = [];
        const validSegments = [];

        segmentIds.forEach((segmentId, index) => {
            const segment = segmentsMap[segmentId];
            if (segment) {
                waypoints.push({ lat: segment.lat, lon: segment.lon });
                validSegments.push({ segment, index });
            } else {
                console.warn(`⚠️ Segmento ${index} (${segmentId}) no tiene coordenadas en BD`);
            }
        });

        // Agregar marcadores para cada parada
        validSegments.forEach(({ segment, index }) => {
            const coords = [segment.lat, segment.lon];

            const marker = L.marker(coords, {
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

            const buildingInfo = segment.building_name
                ? `<strong>Edificio:</strong> ${segment.building_name}<br>`
                : '';

            marker.bindPopup(`
                <div style="font-family: Arial; min-width: 200px;">
                    <strong style="color: #4caf50;">Parada #${index + 1}</strong><br>
                    <hr style="margin: 5px 0;">
                    ${buildingInfo}
                    <strong>Calle:</strong> ${segment.street_name || 'Sin nombre'}<br>
                    <strong>ID:</strong> ${segment.segment_id}<br>
                </div>
            `);

            routeLayer.addLayer(marker);
        });

        // Obtener ruta OSRM si hay al menos 2 puntos
        if (waypoints.length >= 2) {
            console.log("🛣️ Solicitando ruta OSRM...");

            const osrmRoute = await getOSRMRoute(waypoints);

            if (osrmRoute && osrmRoute.coordinates.length > 0) {
                // Dibujar polilínea con la geometría de OSRM (sobre las calles)
                const polyline = L.polyline(osrmRoute.coordinates, {
                    color: '#4caf50',
                    weight: 5,
                    opacity: 0.8,
                    smoothFactor: 1
                });

                routeLayer.addLayer(polyline);

                console.log(`✅ Ruta OSRM dibujada: ${osrmRoute.distance}m, ${osrmRoute.duration}s`);
            } else {
                // Fallback: línea recta si OSRM falla
                console.warn("⚠️ OSRM no disponible, usando líneas rectas");
                const fallbackCoords = waypoints.map(wp => [wp.lat, wp.lon]);
                const polyline = L.polyline(fallbackCoords, {
                    color: '#4caf50',
                    weight: 4,
                    opacity: 0.7,
                    dashArray: '10, 10' // Línea punteada para indicar que no es ruta real
                });

                routeLayer.addLayer(polyline);
            }
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

// --- Obtener ruta desde OSRM ---
async function getOSRMRoute(waypoints) {
    const basePath = window.getBasePath ? window.getBasePath() : '';

    try {
        // Construir string de coordenadas: lon,lat;lon,lat;...
        const coordsString = waypoints
            .map(wp => `${wp.lon},${wp.lat}`)
            .join(';');

        const url = `${basePath}/osrm/route/${coordsString}?overview=full&geometries=geojson`;

        console.log("🌐 OSRM URL:", url);

        const response = await fetch(url);
        const data = await response.json();

        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const route = data.routes[0];

            // Convertir coordenadas GeoJSON [lon, lat] a Leaflet [lat, lon]
            const coordinates = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);

            return {
                coordinates: coordinates,
                distance: Math.round(route.distance), // metros
                duration: Math.round(route.duration)  // segundos
            };
        } else {
            console.error("❌ OSRM error:", data.code, data.message);
            return null;
        }
    } catch (error) {
        console.error("❌ Error llamando OSRM:", error);
        return null;
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

// --- Obtener coordenadas de segmentos en batch desde BD ---
async function getSegmentCoordsBatch(segmentIds) {
    console.log(`🌐 Obteniendo coordenadas de ${segmentIds.length} segmentos...`);
    const basePath = window.getBasePath ? window.getBasePath() : '';

    try {
        const response = await fetch(`${basePath}/api/segment-coords/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segment_ids: segmentIds })
        });

        const data = await response.json();

        if (data.success) {
            console.log(`✅ Coordenadas obtenidas: ${data.found}/${data.requested}`);
            return data.segments; // Dict con segment_id como clave
        } else {
            console.error(`❌ Error obteniendo coordenadas:`, data.error);
            return {};
        }
    } catch (error) {
        console.error(`❌ Error en petición batch:`, error);
        return {};
    }
}