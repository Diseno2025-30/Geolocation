// ==================== MÓDULO OSRM PARA TORRE DE CONTROL ====================
// Este módulo maneja las interacciones con el servidor OSRM local
// para funcionalidades relacionadas con rutas en la Torre de Control

/**
 * Obtiene una ruta entre dos puntos usando el servidor OSRM local
 * @param {number} lat1 - Latitud del punto de origen
 * @param {number} lon1 - Longitud del punto de origen
 * @param {number} lat2 - Latitud del punto de destino
 * @param {number} lon2 - Longitud del punto de destino
 * @returns {Promise<Array|null>} Array de coordenadas [lat, lon] o null si falla
 */
export async function getOSRMRoute(lat1, lon1, lat2, lon2) {
  try {
    // Usar la ruta de test o producción según el contexto
    const basePath = window.location.pathname.includes("/test") ? "/test" : "";
    const url = `${basePath}/osrm/route/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;

    const response = await fetch(url);

    if (!response.ok) {
      console.warn(
        `OSRM route not available (${response.status}), ruta no disponible`
      );
      return null;
    }

    const data = await response.json();

    if (data.code === "Ok" && data.routes && data.routes.length > 0) {
      // Convertir coordenadas de [lon, lat] a [lat, lon] para Leaflet
      return data.routes[0].geometry.coordinates.map((coord) => [
        coord[1],
        coord[0],
      ]);
    }

    console.warn("OSRM no encontró ruta");
    return null;
  } catch (error) {
    console.error("Error obteniendo ruta de OSRM:", error);
    return null;
  }
}

/**
 * Verifica si el servidor OSRM está disponible
 * @returns {Promise<boolean>} true si OSRM está disponible, false en caso contrario
 */
export async function checkOSRMAvailable() {
  try {
    const response = await fetch("/health");
    if (response.ok) {
      const data = await response.json();
      return data.osrm === "healthy";
    }
    return false;
  } catch (error) {
    console.error("Error verificando disponibilidad de OSRM:", error);
    return false;
  }
}

/**
 * Obtiene información de una ruta (distancia, duración, etc.)
 * @param {number} lat1 - Latitud del punto de origen
 * @param {number} lon1 - Longitud del punto de origen
 * @param {number} lat2 - Latitud del punto de destino
 * @param {number} lon2 - Longitud del punto de destino
 * @returns {Promise<Object|null>} Objeto con información de la ruta o null si falla
 */
export async function getRouteInfo(lat1, lon1, lat2, lon2) {
  try {
    const basePath = window.location.pathname.includes("/test") ? "/test" : "";
    const url = `${basePath}/osrm/route/${lon1},${lat1};${lon2},${lat2}?overview=false`;

    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.code === "Ok" && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      return {
        distance: route.distance, // en metros
        duration: route.duration, // en segundos
        distanceKm: (route.distance / 1000).toFixed(2),
        durationMin: Math.round(route.duration / 60),
      };
    }

    return null;
  } catch (error) {
    console.error("Error obteniendo información de ruta:", error);
    return null;
  }
}

/**
 * Calcula la distancia en línea recta entre dos puntos (fallback cuando OSRM no está disponible)
 * @param {number} lat1 - Latitud del punto de origen
 * @param {number} lon1 - Longitud del punto de origen
 * @param {number} lat2 - Latitud del punto de destino
 * @param {number} lon2 - Longitud del punto de destino
 * @returns {number} Distancia en kilómetros
 */
export function calculateStraightLineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radio de la Tierra en km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Dibuja una ruta en el mapa usando OSRM
 * @param {Object} map - Instancia del mapa de Leaflet
 * @param {number} lat1 - Latitud del punto de origen
 * @param {number} lon1 - Longitud del punto de origen
 * @param {number} lat2 - Latitud del punto de destino
 * @param {number} lon2 - Longitud del punto de destino
 * @param {string} color - Color de la línea (por defecto '#3b82f6')
 * @returns {Promise<Object|null>} Objeto Leaflet polyline o null si falla
 */
export async function drawRouteOnMap(
  map,
  lat1,
  lon1,
  lat2,
  lon2,
  color = "#3b82f6"
) {
  const routeCoords = await getOSRMRoute(lat1, lon1, lat2, lon2);

  if (routeCoords && routeCoords.length > 0) {
    const polyline = L.polyline(routeCoords, {
      color: color,
      weight: 4,
      opacity: 0.7,
      smoothFactor: 1,
    }).addTo(map);

    return polyline;
  }

  // Fallback: línea recta si OSRM no está disponible
  console.warn("Usando línea recta como fallback");
  const straightLine = L.polyline(
    [
      [lat1, lon1],
      [lat2, lon2],
    ],
    {
      color: color,
      weight: 4,
      opacity: 0.5,
      dashArray: "10, 10", // Línea punteada para indicar que es estimada
    }
  ).addTo(map);

  return straightLine;
}
