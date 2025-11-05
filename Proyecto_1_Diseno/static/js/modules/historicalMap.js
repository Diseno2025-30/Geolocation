let map;
let drawnItems;
let polylineHistorica = null;
let polylinesHistoricas = [];
let marcadoresHistoricos = [];
let marcadoresVisibles = true;

export function initializeMap(onCreate, onEdit, onDelete) {
    map = L.map('map').setView([11.0, -74.8], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    drawnItems = new L.FeatureGroup().addTo(map);

    const drawControl = new L.Control.Draw({
        edit: {
            featureGroup: drawnItems,
            remove: true
        },
        draw: {
            polygon: false,
            polyline: false,
            circle: false,
            circlemarker: false,
            marker: false,
            rectangle: {
                shapeOptions: {
                    color: '#3b82f6',
                    weight: 3,
                    opacity: 0.7
                }
            }
        }
    });
    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, function (e) {
        drawnItems.clearLayers();
        const layer = e.layer;
        drawnItems.addLayer(layer);
        onCreate(layer);
    });

    map.on(L.Draw.Event.EDITED, function (e) {
        const layer = e.layers.getLayers()[0];
        onEdit(layer);
    });

    map.on(L.Draw.Event.DELETED, function () {
        onDelete();
    });
}

function clipPolyline(coordinates, bounds) {
    const segments = [];
    let currentSegment = [];

    for (let i = 0; i < coordinates.length; i++) {
        const latlng = L.latLng(coordinates[i][0], coordinates[i][1]);
        
        if (bounds.contains(latlng)) {
            currentSegment.push(coordinates[i]);
        } else {
            if (currentSegment.length > 0) {
                segments.push(currentSegment);
                currentSegment = [];
            }
        }
    }
    if (currentSegment.length > 0) {
        segments.push(currentSegment);
    }
    return segments;
}

export function dibujarRutaEnMapa(datosFiltrados, puntosRuta, geofenceLayer) {
    clearMap(!!geofenceLayer);
    const puntosAgrupados = new Map();
    for (const punto of datosFiltrados) {
        const key = `${punto.lat},${punto.lon}`;
        if (!puntosAgrupados.has(key)) {
            puntosAgrupados.set(key, {
                lat: punto.lat,
                lon: punto.lon,
                timestamps: []
            });
        }
        puntosAgrupados.get(key).timestamps.push(punto.timestamp);
    }
    const uniquePoints = Array.from(puntosAgrupados.values());

    const polylineOptions = {
        color: '#4C1D95',
        weight: 4,
        opacity: 0.8
    };

    if (geofenceLayer) {
        const geofenceBounds = geofenceLayer.getBounds();
        const clippedSegments = clipPolyline(puntosRuta, geofenceBounds);
        
        clippedSegments.forEach(segment => {
            if (segment.length > 1) {
                const poly = L.polyline(segment, polylineOptions).addTo(map);
                polylinesHistoricas.push(poly);
            }
        });
    } else {
        if (puntosRuta.length > 0) {
            polylineHistorica = L.polyline(puntosRuta, polylineOptions).addTo(map);
        }
    }

    uniquePoints.forEach(punto => {
        const marker = L.circleMarker([punto.lat, punto.lon], {
            radius: 5,
            color: '#FFFFFF',
            weight: 2,
            fillColor: '#EF4444',
            fillOpacity: 1.0,
            pane: 'markerPane'
        }).addTo(map);
        
        const popupContent = `<b>Fechas en este punto:</b><br>${punto.timestamps.join('<br>')}`;
        marker.bindPopup(popupContent, { maxHeight: 200 });
        
        marcadoresHistoricos.push(marker);
    });

    if (!marcadoresVisibles) {
        toggleMarkers();
    }

    fitView(geofenceLayer);
}

export function clearMap(preserveGeofence = false) {
    if (polylineHistorica) {
        map.removeLayer(polylineHistorica);
        polylineHistorica = null;
    }
    polylinesHistoricas.forEach(poly => map.removeLayer(poly));
    polylinesHistoricas = [];
    
    marcadoresHistoricos.forEach(marker => map.removeLayer(marker));
    marcadoresHistoricos = [];
    
    if (!preserveGeofence) {
        if (drawnItems) {
            drawnItems.clearLayers();
        }
    }
}

export function removeGeofence(geofenceLayer) {
    if (geofenceLayer && drawnItems) {
        drawnItems.removeLayer(geofenceLayer);
    }
}

export function toggleMarkers() {
    marcadoresVisibles = !marcadoresVisibles;
    const toggleText = document.getElementById('toggleMarcadoresText');
    
    marcadoresHistoricos.forEach(marker => {
        if (marcadoresVisibles) {
            map.addLayer(marker);
        } else {
            map.removeLayer(marker);
        }
    });
    
    toggleText.textContent = marcadoresVisibles ? 'Ocultar Marcadores' : 'Mostrar Marcadores';
}

export function fitView(geofenceLayer) {
    if (geofenceLayer) {
        map.fitBounds(geofenceLayer.getBounds());
    } else if (polylineHistorica) {
        map.fitBounds(polylineHistorica.getBounds());
    } else if (polylinesHistoricas.length > 0) {
        const segmentsGroup = L.featureGroup(polylinesHistoricas);
        map.fitBounds(segmentsGroup.getBounds());
    } else if (marcadoresHistoricos.length > 0) {
        const pointsGroup = L.featureGroup(marcadoresHistoricos);
        map.fitBounds(pointsGroup.getBounds());
    }
}