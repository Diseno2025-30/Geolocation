// static/js/modules/api.js

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
    const url = `${BASE_PATH}/osrm/route/${coordsString}?overview=full&geometries=geojson`;
    return fetchData(url);
}