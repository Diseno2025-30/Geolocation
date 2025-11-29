// modules/routeManager.js

let activeRoutes = new Map(); // Almacena rutas por user_id
let routeLayers = new Map(); // Capas de Leaflet por user_id

/**
 * Verifica si un dispositivo tiene destino asignado
 */
export async function checkDeviceDestination(userId) {
  try {
    const response = await fetch(`/test/api/location/${userId}`);
    const data = await response.json();

    if (data.success && data.destinations.length > 0) {
      // Tomar el destino más reciente (status puede ser 'pending' o 'active')
      const destination = data.destinations[0];
      return {
        hasDestination: true,
        destination: destination,
      };
    }

    return { hasDestination: false };
  } catch (error) {
    console.error(`Error verificando destino para ${userId}:`, error);
    return { hasDestination: false };
  }
}

/**
 * Obtiene la ubicación actual del dispositivo
 */
async function getCurrentLocation(userId) {
  try {
    const response = await fetch(`/test/api/location/${userId}`);
    const data = await response.json();

    if (data.success) {
      return {
        lat: data.lat,
        lng: data.lon,
        timestamp: data.timestamp,
      };
    }

    console.warn(`No se encontró ubicación para ${userId}`);
    return null;
  } catch (error) {
    console.error(`Error obteniendo ubicación de ${userId}:`, error);
    return null;
  }
}

/**
 * Dibuja la ruta en el mapa usando OSRM
 */
export async function drawRoute(
  userId,
  startLat,
  startLng,
  endLat,
  endLng,
  map
) {
  const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const coords = route.geometry.coordinates.map((c) => [c[1], c[0]]); // [lat, lng]

      // Remover ruta anterior si existe
      if (routeLayers.has(userId)) {
        map.removeLayer(routeLayers.get(userId));
      }

      // Crear nueva polyline
      const routeLine = L.polyline(coords, {
        color: "#3b82f6",
        weight: 4,
        opacity: 0.7,
      }).addTo(map);

      // Agregar popup con información
      routeLine.bindPopup(`
        <strong>🚗 Ruta de ${userId}</strong><br>
        Distancia: ${(route.distance / 1000).toFixed(2)} km<br>
        Tiempo estimado: ${Math.round(route.duration / 60)} min
      `);

      // Guardar referencia
      routeLayers.set(userId, routeLine);
      activeRoutes.set(userId, {
        startLat,
        startLng,
        endLat,
        endLng,
        distance: route.distance,
        duration: route.duration,
      });

      console.log(`✓ Ruta dibujada para ${userId}`);
      return true;
    }
  } catch (error) {
    console.error(`Error dibujando ruta para ${userId}:`, error);
    return false;
  }
}

/**
 * Actualiza todas las rutas activas
 */
export async function updateAllRoutes(devices, map) {
  console.log("🔄 Actualizando rutas...");

  for (const device of devices) {
    const destInfo = await checkDeviceDestination(device.user_id);

    if (destInfo.hasDestination) {
      const location = await getCurrentLocation(device.user_id);

      if (location) {
        await drawRoute(
          device.user_id,
          location.lat,
          location.lng,
          destInfo.destination.latitude,
          destInfo.destination.longitude,
          map
        );
      }
    }
  }
}

/**
 * Limpia todas las rutas del mapa
 */
export function clearAllRoutes(map) {
  routeLayers.forEach((layer) => map.removeLayer(layer));
  routeLayers.clear();
  activeRoutes.clear();
}
