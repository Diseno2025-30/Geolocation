// static/js/modules/rutasMap.js

let map;
let currentRutaLayer = null;

export function initializeMap() {
  map = L.map('map').setView([11.0, -74.8], 13);
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  
  console.log('✓ Mapa de rutas inicializado');
}

export function displayRuta(segmentIds, rutaNombre) {
  if (!map) return;
  
  // Limpiar ruta anterior
  clearMap();
  
  console.log(`Mostrando ruta: ${rutaNombre}`);
  console.log('Segmentos:', segmentIds);
  
  // TODO: Implementar visualización de segmentos
  // Por ahora solo mostramos un mensaje
  alert(`Ruta "${rutaNombre}" cargada con ${segmentIds.length} segmentos.\n\nVisualización pendiente de implementación.`);
}

export function clearMap() {
  if (!map) return;
  
  if (currentRutaLayer) {
    map.removeLayer(currentRutaLayer);
    currentRutaLayer = null;
  }
}

export function getMap() {
  return map;
}