// static/js/modules/api.js

// Module-level variables to store the map state
let map;
let marker;
let polyline;
let routeLayer;

/**
 * Initializes the Leaflet map.
 * @param {string} elementId - The ID of the div where the map should be rendered.
 */
export function initMap(elementId) {
    // Default view centered on Barranquilla
    map = L.map(elementId).setView([10.9639, -74.7964], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
}

/**
 * Creates or updates the main marker on the map.
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 */
export function updateMarker(lat, lon) {
    if (!map) return;
    const latLng = [lat, lon];

    if (marker) {
        marker.setLatLng(latLng);
    } else {
        // Create the marker if it doesn't exist
        marker = L.marker(latLng).addTo(map);
    }
    map.panTo(latLng); // Move the map view to the marker
}

/**
 * Creates or updates the blue trajectory line.
 * @param {Array<[number, number]>} points - An array of [lat, lon] coordinates.
 */
export function updatePolyline(points) {
    if (!map) return;
    
    if (polyline) {
        polyline.setLatLngs(points);
    } else {
        // Create the polyline if it doesn't exist
        polyline = L.polyline(points, { color: 'blue' }).addTo(map);
    }
}

/**
 * Draws a GeoJSON route (from OSRM) on the map.
 * @param {object} geometry - The GeoJSON geometry object.
 */
export function drawGeoJSONRoute(geometry) {
    if (!map) return;

    // Remove the previous route layer if it exists
    if (routeLayer) {
        map.removeLayer(routeLayer);
    }

    // Add the new route
    routeLayer = L.geoJSON(geometry, {
        style: {
            color: 'red',
            weight: 5,
            opacity: 0.7
        }
    }).addTo(map);

    // Zoom the map to fit the route bounds
    map.fitBounds(routeLayer.getBounds());
}

/**
 * Removes the marker, polyline, and route from the map.
 */
export function clearMap() {
    if (!map) return;

    if (marker) {
        map.removeLayer(marker);
        marker = null;
    }
    if (polyline) {
        map.removeLayer(polyline);
        polyline = null;
    }
    if (routeLayer) {
        map.removeLayer(routeLayer);
        routeLayer = null;
    }
}

const BASE_PATH = window.getBasePath();

/**
 * Función genérica para fetch
 * @param {string} url - La URL del endpoint
 * @returns {Promise<object>} - Los datos JSON
 */
async function fetchData(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Error fetching data:", error);
        return null;
    }
}

/** Obtiene la última coordenada */
export function fetchLastCoordinate() {
    return fetchData(`${BASE_PATH}/coordenadas`);
}

/** Obtiene datos históricos por rango */
export function fetchHistoricalRange(inicio, fin, hora_inicio, hora_fin) {
    const params = new URLSearchParams({
        inicio,
        fin,
        hora_inicio,
        hora_fin
    });
    return fetchData(`${BASE_PATH}/historico/rango?${params.toString()}`);
}

/** Obtiene datos históricos por geocerca */
export function fetchHistoricalGeofence(bounds) {
     const params = new URLSearchParams({
        min_lat: bounds.getSouthWest().lat,
        min_lon: bounds.getSouthWest().lng,
        max_lat: bounds.getNorthEast().lat,
        max_lon: bounds.getNorthEast().lng
    });
    return fetchData(`${BASE_PATH}/historico/geocerca?${params.toString()}`);
}

/**
 * Llama al proxy OSRM para obtener una ruta
 * @param {Array<[number, number]>} coordinates - Array de [lat, lon]
 * @returns {Promise<object>} - La respuesta JSON de OSRM
 */
export function fetchOSRMRoute(coordinates) {
    // OSRM espera {lon},{lat};{lon},{lat}
    const coordsString = coordinates.map(c => `${c[1]},${c[0]}`).join(';');
    const url = `/test/osrm/route/${coordsString}?overview=full&geometries=geojson`;
    return fetchData(url);
}