import { getOSRMRoute, generateFullStreetRoute } from "./osrm.js";

let map;
const markers = {}; // Marcadores por dispositivo
const trayectorias = {}; // Array de puntos de trayectoria por dispositivo
const trayectoriaRaw = {}; // Puntos GPS originales por dispositivo
const polylines = {}; // Polylines dibujadas por dispositivo
const trayectoriasVisibles = {}; // Estado de visibilidad por dispositivo
const ultimaPosicion = {}; // Última posición por dispositivo
const isGeneratingRoute = {}; // Estado de generación por dispositivo

// ==================== NUEVO: Destinos y Rutas Recomendadas ====================
const destinationMarkers = {}; // Marcadores de destino por dispositivo
const recommendedRoutes = {}; // Polylines de rutas recomendadas por dispositivo
const activeDestinations = {}; // Destinos activos por dispositivo
const recommendedRoutesVisible = {}; // Visibilidad de rutas recomendadas

// Colores disponibles para dispositivos
const deviceColors = {};
const availableColors = [
  "#FF4444", // Rojo
  "#44FF44", // Verde
  "#4444FF", // Azul
  "#FFAA00", // Naranja
  "#FF44FF", // Magenta
  "#44FFFF", // Cian
  "#FFFF44", // Amarillo
  "#AA44FF", // Púrpura
];
let colorIndex = 0;

function getDeviceColor(deviceId) {
  if (!deviceColors[deviceId]) {
    deviceColors[deviceId] =
      availableColors[colorIndex % availableColors.length];
    colorIndex++;
  }
  return deviceColors[deviceId];
}

export function initializeMap() {
  map = L.map("map").setView([11.0, -74.8], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
}

export function getMap() {
  return map;
}

export function updateMarkerPosition(
  lat,
  lon,
  deviceId = "default",
  color = null
) {
  if (!map) return;

  const deviceColor = color || getDeviceColor(deviceId);

  // Crear o actualizar marcador para este dispositivo
  if (!markers[deviceId]) {
    // Crear icono personalizado con el color del dispositivo
    const customIcon = L.divIcon({
      className: "custom-marker",
      html: `<div style="background-color: ${deviceColor}; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 14px;">🚗</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });

    markers[deviceId] = L.marker([lat, lon], { icon: customIcon })
      .addTo(map)
      .bindPopup(`<b>Dispositivo:</b> ${deviceId}`);

    // Inicializar estado de visibilidad
    trayectoriasVisibles[deviceId] = true;
    recommendedRoutesVisible[deviceId] = true;
  } else {
    // Actualizar posición del marcador existente
    markers[deviceId].setLatLng([lat, lon]);
    markers[deviceId].getPopup().setContent(`<b>Dispositivo:</b> ${deviceId}`);
  }

  // ==================== NUEVO: Actualizar ruta recomendada si hay destino ====================
  if (activeDestinations[deviceId]) {
    updateRecommendedRoute(deviceId, lat, lon);
  }
}

// ==================== NUEVO: Funciones de Destino y Ruta Recomendada ====================

/**
 * Establece un destino para un dispositivo y dibuja la ruta recomendada
 */
export async function setDestination(deviceId, destLat, destLon, deviceLat, deviceLon, color = null) {
  if (!map) return;

  const deviceColor = color || getDeviceColor(deviceId);

  // Guardar destino activo
  activeDestinations[deviceId] = {
    lat: destLat,
    lon: destLon,
    timestamp: new Date().toISOString()
  };

  // Crear o actualizar marcador de destino
  if (destinationMarkers[deviceId]) {
    map.removeLayer(destinationMarkers[deviceId]);
  }

  const destIcon = L.divIcon({
    className: "destination-marker",
    html: `<div style="background-color: #ef4444; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(239,68,68,0.5); display: flex; align-items: center; justify-content: center; font-size: 16px;">🎯</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

  destinationMarkers[deviceId] = L.marker([destLat, destLon], { icon: destIcon })
    .addTo(map)
    .bindPopup(`
      <b>🎯 Destino de ${deviceId}</b><br>
      Lat: ${destLat.toFixed(6)}<br>
      Lon: ${destLon.toFixed(6)}
    `);

  // Calcular y dibujar ruta recomendada
  await drawRecommendedRoute(deviceId, deviceLat, deviceLon, destLat, destLon, deviceColor);

  console.log(`✓ Destino establecido para ${deviceId}: ${destLat.toFixed(6)}, ${destLon.toFixed(6)}`);
}

/**
 * Dibuja la ruta recomendada (OSRM) desde la posición actual al destino
 */
async function drawRecommendedRoute(deviceId, startLat, startLon, endLat, endLon, color) {
  try {
    // Usar OSRM para calcular la ruta
    const routeCoords = await getOSRMRoute(startLat, startLon, endLat, endLon);

    if (!routeCoords || routeCoords.length < 2) {
      console.warn(`⚠️ No se pudo calcular ruta recomendada para ${deviceId}`);
      return;
    }

    // Eliminar ruta anterior si existe
    if (recommendedRoutes[deviceId]) {
      map.removeLayer(recommendedRoutes[deviceId]);
    }

    // Dibujar nueva ruta recomendada (línea punteada, más gruesa)
    recommendedRoutes[deviceId] = L.polyline(routeCoords, {
      color: "#10b981", // Verde esmeralda para ruta recomendada
      weight: 5,
      opacity: 0.7,
      dashArray: "10, 10", // Línea punteada
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);

    // Calcular distancia aproximada
    let distance = 0;
    for (let i = 0; i < routeCoords.length - 1; i++) {
      distance += map.distance(routeCoords[i], routeCoords[i + 1]);
    }

    recommendedRoutes[deviceId].bindPopup(`
      <b>🗺️ Ruta Recomendada</b><br>
      Dispositivo: ${deviceId}<br>
      Distancia: ${(distance / 1000).toFixed(2)} km<br>
      <small style="color: #10b981;">━━━ Línea punteada verde</small>
    `);

    recommendedRoutesVisible[deviceId] = true;

    console.log(`✓ Ruta recomendada dibujada para ${deviceId}: ${(distance / 1000).toFixed(2)} km`);

  } catch (error) {
    console.error(`❌ Error dibujando ruta recomendada para ${deviceId}:`, error);
  }
}

/**
 * Actualiza la ruta recomendada cuando el dispositivo se mueve
 */
async function updateRecommendedRoute(deviceId, currentLat, currentLon) {
  const dest = activeDestinations[deviceId];
  if (!dest) return;

  const color = getDeviceColor(deviceId);
  await drawRecommendedRoute(deviceId, currentLat, currentLon, dest.lat, dest.lon, color);
}

/**
 * Elimina el destino y la ruta recomendada de un dispositivo
 */
export function clearDestination(deviceId) {
  if (!map) return;

  // Eliminar marcador de destino
  if (destinationMarkers[deviceId]) {
    map.removeLayer(destinationMarkers[deviceId]);
    delete destinationMarkers[deviceId];
  }

  // Eliminar ruta recomendada
  if (recommendedRoutes[deviceId]) {
    map.removeLayer(recommendedRoutes[deviceId]);
    delete recommendedRoutes[deviceId];
  }

  // Eliminar destino activo
  delete activeDestinations[deviceId];
  delete recommendedRoutesVisible[deviceId];

  console.log(`✓ Destino eliminado para ${deviceId}`);
}

/**
 * Alterna la visibilidad de la ruta recomendada
 */
export function toggleRecommendedRoute(deviceId = null) {
  if (!map) return;

  if (deviceId) {
    // Toggle para un dispositivo específico
    if (recommendedRoutes[deviceId]) {
      recommendedRoutesVisible[deviceId] = !recommendedRoutesVisible[deviceId];
      
      if (recommendedRoutesVisible[deviceId]) {
        recommendedRoutes[deviceId].addTo(map);
      } else {
        map.removeLayer(recommendedRoutes[deviceId]);
      }
    }
  } else {
    // Toggle para todas las rutas recomendadas
    const allVisible = Object.values(recommendedRoutesVisible).every(v => v);

    Object.keys(recommendedRoutes).forEach(id => {
      recommendedRoutesVisible[id] = !allVisible;
      
      if (recommendedRoutesVisible[id]) {
        recommendedRoutes[id].addTo(map);
      } else {
        map.removeLayer(recommendedRoutes[id]);
      }
    });
  }
}

/**
 * Verifica si un dispositivo tiene un destino activo
 */
export function hasActiveDestination(deviceId) {
  return !!activeDestinations[deviceId];
}

/**
 * Obtiene información del destino activo de un dispositivo
 */
export function getActiveDestination(deviceId) {
  return activeDestinations[deviceId] || null;
}

/**
 * Obtiene todos los destinos activos
 */
export function getAllActiveDestinations() {
  return { ...activeDestinations };
}

// ==================== Funciones existentes de trayectoria ====================

async function generarRutaPorCallesRealtime(puntosRaw, deviceId) {
  if (puntosRaw.length < 2) {
    return puntosRaw;
  }

  const ultimoIndice = puntosRaw.length - 1;
  const [lat1, lon1] = puntosRaw[ultimoIndice - 1];
  const [lat2, lon2] = puntosRaw[ultimoIndice];

  const rutaOSRM = await getOSRMRoute(lat1, lon1, lat2, lon2);

  if (rutaOSRM && rutaOSRM.length > 0) {
    console.log(
      `✓ [${deviceId}] Segmento ${ultimoIndice} generado por calles (${rutaOSRM.length} puntos)`
    );
    return rutaOSRM.slice(1);
  } else {
    console.log(`⚠ [${deviceId}] Segmento ${ultimoIndice} usando línea recta`);
    return [[lat2, lon2]];
  }
}

export async function agregarPuntoTrayectoria(
  lat,
  lon,
  deviceId = "default",
  color = null
) {
  if (!map) return 0;

  const deviceColor = color || getDeviceColor(deviceId);

  // Inicializar estructuras para este dispositivo si no existen
  if (!trayectoriaRaw[deviceId]) {
    trayectoriaRaw[deviceId] = [];
    trayectorias[deviceId] = [];
    ultimaPosicion[deviceId] = null;
    isGeneratingRoute[deviceId] = false;
    trayectoriasVisibles[deviceId] = true;
  }

  const nuevaPosicion = [lat, lon];

  // Verificar si la posición cambió significativamente
  if (
    ultimaPosicion[deviceId] === null ||
    Math.abs(ultimaPosicion[deviceId][0] - lat) > 0.00001 ||
    Math.abs(ultimaPosicion[deviceId][1] - lon) > 0.00001
  ) {
    trayectoriaRaw[deviceId].push(nuevaPosicion);
    ultimaPosicion[deviceId] = nuevaPosicion;

    // Si es el primer punto, agregarlo directamente
    if (trayectorias[deviceId].length === 0) {
      trayectorias[deviceId].push(nuevaPosicion);
      actualizarPolyline(deviceId, deviceColor);
      return getTotalPuntos();
    }

    // Generar ruta por calles si no está generando
    if (!isGeneratingRoute[deviceId]) {
      isGeneratingRoute[deviceId] = true;
      try {
        const nuevoSegmento = await generarRutaPorCallesRealtime(
          trayectoriaRaw[deviceId],
          deviceId
        );
        trayectorias[deviceId].push(...nuevoSegmento);
        actualizarPolyline(deviceId, deviceColor);
      } catch (error) {
        console.error(`[${deviceId}] Error generando ruta:`, error);
        trayectorias[deviceId].push(nuevaPosicion);
        actualizarPolyline(deviceId, deviceColor);
      } finally {
        isGeneratingRoute[deviceId] = false;
      }
    }
  }

  return getTotalPuntos();
}

function actualizarPolyline(deviceId, color) {
  if (!map || !trayectorias[deviceId] || trayectorias[deviceId].length < 2)
    return;

  // Eliminar polyline anterior si existe
  if (polylines[deviceId]) {
    map.removeLayer(polylines[deviceId]);
  }

  // Crear nueva polyline si la trayectoria es visible
  if (trayectoriasVisibles[deviceId]) {
    polylines[deviceId] = L.polyline(trayectorias[deviceId], {
      color: color,
      weight: 4,
      opacity: 0.9,
      smoothFactor: 1,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);

    polylines[deviceId].bindPopup(
      `<b>📍 Trayectoria Real - ${deviceId}</b><br>
       Puntos GPS: ${trayectoriaRaw[deviceId].length}<br>
       Puntos en ruta: ${trayectorias[deviceId].length}<br>
       <small style="color: ${color};">━━━ Línea sólida</small>`
    );
  }
}

function getTotalPuntos() {
  return Object.values(trayectoriaRaw).reduce(
    (sum, puntos) => sum + puntos.length,
    0
  );
}

export function limpiarTrayectoria(deviceId = null) {
  if (!map) return 0;

  if (deviceId) {
    // Limpiar trayectoria de un dispositivo específico
    if (polylines[deviceId]) {
      map.removeLayer(polylines[deviceId]);
      delete polylines[deviceId];
    }
    trayectorias[deviceId] = [];
    trayectoriaRaw[deviceId] = [];
    ultimaPosicion[deviceId] = null;
  } else {
    // Limpiar todas las trayectorias
    Object.keys(polylines).forEach((id) => {
      if (polylines[id]) {
        map.removeLayer(polylines[id]);
      }
    });
    Object.keys(trayectorias).forEach((id) => {
      trayectorias[id] = [];
      trayectoriaRaw[id] = [];
      ultimaPosicion[id] = null;
    });
    Object.keys(polylines).forEach((id) => {
      delete polylines[id];
    });
  }

  return getTotalPuntos();
}

export function toggleTrayectoria(deviceId = null) {
  if (!map) return;

  const toggleText = document.getElementById("toggleText");

  if (deviceId) {
    // Toggle para un dispositivo específico
    trayectoriasVisibles[deviceId] = !trayectoriasVisibles[deviceId];
    const color = getDeviceColor(deviceId);

    if (trayectoriasVisibles[deviceId]) {
      actualizarPolyline(deviceId, color);
    } else if (polylines[deviceId]) {
      map.removeLayer(polylines[deviceId]);
      delete polylines[deviceId];
    }
  } else {
    // Toggle para todas las trayectorias
    const allVisible = Object.values(trayectoriasVisibles).every((v) => v);

    Object.keys(trayectoriasVisibles).forEach((id) => {
      trayectoriasVisibles[id] = !allVisible;
      const color = getDeviceColor(id);

      if (trayectoriasVisibles[id]) {
        actualizarPolyline(id, color);
      } else if (polylines[id]) {
        map.removeLayer(polylines[id]);
        delete polylines[id];
      }
    });

    if (toggleText) {
      toggleText.textContent = allVisible
        ? "Mostrar Trayectoria"
        : "Ocultar Trayectoria";
    }
  }
}

export function toggleMarkers(visible) {
  if (!map) return;

  Object.keys(markers).forEach((id) => {
    if (visible) {
      markers[id].addTo(map);
    } else {
      map.removeLayer(markers[id]);
    }
  });

  // También toggle de marcadores de destino
  Object.keys(destinationMarkers).forEach((id) => {
    if (visible) {
      destinationMarkers[id].addTo(map);
    } else {
      map.removeLayer(destinationMarkers[id]);
    }
  });
}

export function fitView() {
  if (!map) return;

  const allPoints = [];

  // Agregar posiciones de dispositivos
  Object.values(markers).forEach((marker) => {
    allPoints.push(marker.getLatLng());
  });

  // Agregar destinos
  Object.values(destinationMarkers).forEach((marker) => {
    allPoints.push(marker.getLatLng());
  });

  // Agregar puntos de trayectorias
  Object.values(trayectorias).forEach((tray) => {
    tray.forEach((point) => {
      allPoints.push(L.latLng(point[0], point[1]));
    });
  });

  if (allPoints.length > 0) {
    const bounds = L.latLngBounds(allPoints);
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}

export async function regenerarRuta(deviceId = null) {
  if (deviceId) {
    // Regenerar ruta de un dispositivo específico
    if (!trayectoriaRaw[deviceId] || trayectoriaRaw[deviceId].length < 2) {
      alert(`No hay suficientes puntos para regenerar la ruta de ${deviceId}`);
      return;
    }

    const confirmar = confirm(
      `¿Regenerar la ruta de ${deviceId} usando ${trayectoriaRaw[deviceId].length} puntos GPS?`
    );
    if (!confirmar) return;

    console.log(`🔄 [${deviceId}] Regenerando ruta completa...`);

    try {
      const puntosObj = trayectoriaRaw[deviceId].map((p) => ({
        lat: p[0],
        lon: p[1],
      }));
      const nuevaRuta = await generateFullStreetRoute(puntosObj);

      trayectorias[deviceId] = nuevaRuta;
      const color = getDeviceColor(deviceId);
      actualizarPolyline(deviceId, color);
      alert(`✓ Ruta de ${deviceId} regenerada exitosamente`);
    } catch (error) {
      console.error(`[${deviceId}] Error regenerando ruta:`, error);
      alert(`✗ Error al regenerar la ruta de ${deviceId}`);
    }
  } else {
    // Regenerar todas las rutas
    const totalDispositivos = Object.keys(trayectoriaRaw).length;
    if (totalDispositivos === 0) {
      alert("No hay dispositivos con trayectorias para regenerar");
      return;
    }

    const confirmar = confirm(
      `¿Regenerar las rutas de todos los dispositivos (${totalDispositivos})?`
    );
    if (!confirmar) return;

    console.log("🔄 Regenerando todas las rutas...");

    for (const id of Object.keys(trayectoriaRaw)) {
      if (trayectoriaRaw[id].length < 2) continue;

      try {
        const puntosObj = trayectoriaRaw[id].map((p) => ({
          lat: p[0],
          lon: p[1],
        }));
        const nuevaRuta = await generateFullStreetRoute(puntosObj);

        trayectorias[id] = nuevaRuta;
        const color = getDeviceColor(id);
        actualizarPolyline(id, color);
        console.log(`✓ [${id}] Ruta regenerada`);
      } catch (error) {
        console.error(`[${id}] Error regenerando ruta:`, error);
      }
    }

    alert("✓ Todas las rutas han sido regeneradas");
  }
}

// Función para obtener información de todos los dispositivos
export function getDevicesInfo() {
  return Object.keys(markers).map((deviceId) => ({
    id: deviceId,
    color: getDeviceColor(deviceId),
    puntos: trayectoriaRaw[deviceId] ? trayectoriaRaw[deviceId].length : 0,
    visible: trayectoriasVisibles[deviceId],
    position: markers[deviceId] ? markers[deviceId].getLatLng() : null,
    hasDestination: !!activeDestinations[deviceId],
    destination: activeDestinations[deviceId] || null,
  }));
}