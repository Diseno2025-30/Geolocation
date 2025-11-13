// ==================== MÓDULO DE MAPA PARA TORRE DE CONTROL ====================
// Este módulo maneja toda la lógica del mapa de Leaflet para la Torre de Control

let map = null;
let destinationMarker = null;
let deviceMarker = null;
let routeLine = null;
let routeInfoBox = null;
let mapInitialized = false;
let onDestinationSelected = null; // Callback para cuando se selecciona un destino

// ==================== INICIALIZACIÓN ====================

/**
 * Inicializa el mapa de Leaflet
 * El centro se determinará dinámicamente basado en el primer dispositivo activo
 */
export function initializeMap() {
  // Crear mapa con centro temporal (será actualizado dinámicamente)
  map = L.map('map').setView([4.6097, -74.0817], 12);
  
  // Agregar capa de tiles de OpenStreetMap
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  // Evento de clic en el mapa
  map.on('click', handleMapClick);
  
  console.log('✓ Mapa de Torre de Control inicializado');
}

/**
 * Centra el mapa basado en el primer dispositivo activo
 */
export async function centerMapOnFirstDevice() {
  if (mapInitialized || !map) {
    return;
  }

  try {
    // Obtener la última coordenada para centrar el mapa
    const response = await fetch('/coordenadas');
    if (response.ok) {
      const data = await response.json();
      if (data && data.lat && data.lon) {
        map.setView([data.lat, data.lon], 14);
        mapInitialized = true;
        console.log(`✓ Mapa centrado automáticamente en: ${data.lat.toFixed(6)}, ${data.lon.toFixed(6)}`);
      }
    }
  } catch (error) {
    console.warn('No se pudo centrar el mapa automáticamente:', error);
    // El mapa quedará con las coordenadas por defecto
  }
}

/**
 * Maneja el clic en el mapa
 */
function handleMapClick(e) {
  // Llamar al callback si está definido
  if (onDestinationSelected) {
    onDestinationSelected(e.latlng);
  }
}

/**
 * Establece el callback para cuando se selecciona un destino
 */
export function setDestinationCallback(callback) {
  onDestinationSelected = callback;
}

// ==================== GESTIÓN DEL MARCADOR DE DISPOSITIVO ====================

/**
 * Muestra la ubicación del dispositivo seleccionado
 */
export function showDeviceLocation(lat, lon, userId) {
  // Remover marcador anterior si existe
  if (deviceMarker) {
    map.removeLayer(deviceMarker);
  }
  
  // Crear icono personalizado para el dispositivo (azul)
  const deviceIcon = L.divIcon({
    className: 'custom-device-marker',
    html: `
      <div style="
        background: #2563eb; 
        width: 30px; 
        height: 30px; 
        border-radius: 50%; 
        border: 4px solid white; 
        box-shadow: 0 4px 12px rgba(0,0,0,0.3); 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        font-size: 16px;
      ">🚗</div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
  
  // Crear marcador del dispositivo
  deviceMarker = L.marker([lat, lon], { icon: deviceIcon }).addTo(map);
  
  // Agregar popup con información
  deviceMarker.bindPopup(`
    <strong>📱 Dispositivo: ${userId}</strong><br>
    Lat: ${lat.toFixed(6)}<br>
    Lng: ${lon.toFixed(6)}
  `).openPopup();
  
  // Centrar el mapa en el dispositivo
  map.setView([lat, lon], 15);
  
  console.log(`✓ Marcador de dispositivo creado para ${userId}`);
}

/**
 * Actualiza la ubicación del dispositivo
 */
export function updateDeviceLocation(lat, lon, userId) {
  if (deviceMarker) {
    deviceMarker.setLatLng([lat, lon]);
    deviceMarker.getPopup().setContent(`
      <strong>📱 Dispositivo: ${userId}</strong><br>
      Lat: ${lat.toFixed(6)}<br>
      Lng: ${lon.toFixed(6)}<br>
      <span style="color: #10b981;">● Actualizado</span>
    `);
  }
}

/**
 * Elimina el marcador del dispositivo
 */
export function clearDeviceMarker() {
  if (deviceMarker) {
    map.removeLayer(deviceMarker);
    deviceMarker = null;
    console.log('✓ Marcador de dispositivo eliminado');
  }
}

// ==================== GESTIÓN DEL MARCADOR DE DESTINO ====================

/**
 * Actualiza o crea el marcador de destino en el mapa
 */
export function updateDestinationMarker(latlng) {
  // Remover marcador anterior si existe
  if (destinationMarker) {
    map.removeLayer(destinationMarker);
  }
  
  // Crear nuevo marcador con estilo personalizado (rojo)
  destinationMarker = L.marker(latlng, {
    icon: L.divIcon({
      className: 'custom-destination-marker',
      html: `
        <div style="
          background: #ef4444; 
          width: 30px; 
          height: 30px; 
          border-radius: 50%; 
          border: 4px solid white; 
          box-shadow: 0 4px 12px rgba(0,0,0,0.3); 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          font-size: 16px;
        ">🎯</div>
      `,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    })
  }).addTo(map);
  
  // Agregar popup con información
  destinationMarker.bindPopup(`
    <strong>🎯 Destino Seleccionado</strong><br>
    Lat: ${latlng.lat.toFixed(6)}<br>
    Lng: ${latlng.lng.toFixed(6)}
  `).openPopup();
  
  console.log('✓ Marcador de destino actualizado');
}

/**
 * Elimina el marcador de destino del mapa
 */
export function clearDestinationMarker() {
  if (destinationMarker) {
    map.removeLayer(destinationMarker);
    destinationMarker = null;
    console.log('✓ Marcador de destino eliminado');
  }
}

// ==================== GESTIÓN DE RUTAS ====================

/**
 * Dibuja la ruta en el mapa
 */
export function drawRouteOnMap(coordinates, distance, duration) {
  // Remover ruta anterior si existe
  clearRoute();
  
  // Crear polyline con estilo
  routeLine = L.polyline(coordinates, {
    color: '#4C1D95',
    weight: 4,
    opacity: 0.8,
    smoothFactor: 1
  }).addTo(map);
  
  // Calcular distancia y tiempo
  const distanceKm = (distance / 1000).toFixed(2);
  const durationMin = Math.round(duration / 60);
  
  // Agregar popup con información de la ruta
  routeLine.bindPopup(`
    <strong>🚗 Ruta Calculada</strong><br>
    Distancia: ${distanceKm} km<br>
    Tiempo estimado: ${durationMin} min
  `);
  
  // Crear caja de información en el mapa
  createRouteInfoBox(distanceKm, durationMin);
  
  // Ajustar vista del mapa para mostrar toda la ruta
  const bounds = routeLine.getBounds();
  map.fitBounds(bounds, { padding: [50, 50] });
  
  console.log(`✓ Ruta dibujada: ${distanceKm} km, ${durationMin} min`);
}

/**
 * Crea una caja de información sobre la ruta
 */
function createRouteInfoBox(distanceKm, durationMin) {
  // Remover caja anterior si existe
  if (routeInfoBox) {
    routeInfoBox.remove();
  }
  
  // Crear nueva caja de información
  routeInfoBox = L.control({ position: 'bottomleft' });
  
  routeInfoBox.onAdd = function() {
    const div = L.DomUtil.create('div', 'route-info-box');
    div.style.cssText = `
      background: white;
      padding: 10px 15px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      font-family: Arial, sans-serif;
    `;
    div.innerHTML = `
      <div style="font-weight: bold; color: #4C1D95; margin-bottom: 5px;">🚗 Información de Ruta</div>
      <div><span style="color: #666;">Distancia:</span> <strong>${distanceKm} km</strong></div>
      <div><span style="color: #666;">Tiempo:</span> <strong>${durationMin} min</strong></div>
    `;
    return div;
  };
  
  routeInfoBox.addTo(map);
}

/**
 * Limpia la ruta del mapa
 */
export function clearRoute() {
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
  
  if (routeInfoBox) {
    routeInfoBox.remove();
    routeInfoBox = null;
  }
  
  console.log('✓ Ruta eliminada');
}

// ==================== MODOS DE SELECCIÓN ====================

/**
 * Habilita el modo de selección en el mapa
 * Agrega estilos visuales para indicar que el mapa está listo para seleccionar
 */
export function enableMapSelectionMode() {
  const mapContainer = document.getElementById('map');
  if (mapContainer) {
    mapContainer.classList.add('selection-mode');
    mapContainer.style.cursor = 'crosshair';
  }
}

/**
 * Deshabilita el modo de selección en el mapa
 */
export function disableMapSelectionMode() {
  const mapContainer = document.getElementById('map');
  if (mapContainer) {
    mapContainer.classList.remove('selection-mode');
    mapContainer.style.cursor = 'grab';
  }
}

// ==================== UTILIDADES ====================

/**
 * Obtiene la instancia del mapa (para debugging y uso externo)
 */
export function getMap() {
  return map;
}

/**
 * Centra el mapa en una ubicación específica
 */
export function centerMap(lat, lon, zoom = 14) {
  if (map) {
    map.setView([lat, lon], zoom);
  }
}

// Exponer el mapa globalmente para debugging
if (typeof window !== 'undefined') {
  window.controlMap = {
    getMap,
    centerMap,
    showDeviceLocation,
    updateDeviceLocation,
    clearDeviceMarker,
    updateDestinationMarker,
    clearDestinationMarker,
    drawRouteOnMap,
    clearRoute
  };
}