// ==================== MÓDULO DE MAPA PARA TORRE DE CONTROL ====================
// Este módulo maneja toda la lógica del mapa de Leaflet para la Torre de Control

import L from "leaflet" // Import Leaflet

let map = null
let destinationMarker = null
let mapInitialized = false
let onDestinationSelected = null // Callback para cuando se selecciona un destino

// ==================== INICIALIZACIÓN ====================

/**
 * Inicializa el mapa de Leaflet
 * El centro se determinará dinámicamente basado en el primer dispositivo activo
 */
export function initializeMap() {
  // Crear mapa con centro temporal (será actualizado dinámicamente)
  // Usar coordenadas genéricas que se ajustarán automáticamente
  map = L.map("map").setView([4.6097, -74.0817], 12)

  // Agregar capa de tiles de OpenStreetMap
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map)

  // Evento de clic en el mapa
  map.on("click", handleMapClick)

  console.log("✓ Mapa de Torre de Control inicializado")
}

/**
 * Centra el mapa basado en el primer dispositivo activo
 */
export async function centerMapOnFirstDevice() {
  if (mapInitialized || !map) {
    return
  }

  try {
    // Obtener la última coordenada para centrar el mapa
    const response = await fetch("/coordenadas")
    if (response.ok) {
      const data = await response.json()
      if (data && data.lat && data.lon) {
        map.setView([data.lat, data.lon], 14)
        mapInitialized = true
        console.log(`✓ Mapa centrado automáticamente en: ${data.lat.toFixed(6)}, ${data.lon.toFixed(6)}`)
      }
    }
  } catch (error) {
    console.warn("No se pudo centrar el mapa automáticamente:", error)
    // El mapa quedará con las coordenadas por defecto
  }
}

/**
 * Maneja el clic en el mapa
 */
function handleMapClick(e) {
  // Llamar al callback si está definido
  if (onDestinationSelected) {
    onDestinationSelected(e.latlng)
  }
}

/**
 * Establece el callback para cuando se selecciona un destino
 */
export function setDestinationCallback(callback) {
  onDestinationSelected = callback
}

// ==================== GESTIÓN DEL MARCADOR DE DESTINO ====================

/**
 * Actualiza o crea el marcador de destino en el mapa
 */
export function updateDestinationMarker(latlng) {
  // Remover marcador anterior si existe
  if (destinationMarker) {
    map.removeLayer(destinationMarker)
  }

  // Crear nuevo marcador con estilo personalizado
  destinationMarker = L.marker(latlng, {
    icon: L.divIcon({
      className: "custom-destination-marker",
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
        ">📍</div>
      `,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    }),
  }).addTo(map)

  // Agregar popup con información
  destinationMarker
    .bindPopup(`
    <strong>📍 Destino Seleccionado</strong><br>
    Lat: ${latlng.lat.toFixed(6)}<br>
    Lng: ${latlng.lng.toFixed(6)}
  `)
    .openPopup()

  console.log("✓ Marcador de destino actualizado")
}

/**
 * Elimina el marcador de destino del mapa
 */
export function clearDestinationMarker() {
  if (destinationMarker) {
    map.removeLayer(destinationMarker)
    destinationMarker = null
    console.log("✓ Marcador de destino eliminado")
  }
}

// ==================== MODOS DE SELECCIÓN ====================

/**
 * Habilita el modo de selección en el mapa
 * Agrega estilos visuales para indicar que el mapa está listo para seleccionar
 */
export function enableMapSelectionMode() {
  const mapContainer = document.getElementById("map")
  if (mapContainer) {
    mapContainer.classList.add("selection-mode")
  }
}

/**
 * Deshabilita el modo de selección en el mapa
 */
export function disableMapSelectionMode() {
  const mapContainer = document.getElementById("map")
  if (mapContainer) {
    mapContainer.classList.remove("selection-mode")
  }
}

// ==================== UTILIDADES ====================

/**
 * Obtiene la instancia del mapa (para debugging)
 */
export function getMap() {
  return map
}

/**
 * Centra el mapa en una ubicación específica
 */
export function centerMap(lat, lon, zoom = 14) {
  if (map) {
    map.setView([lat, lon], zoom)
  }
}

// Exponer el mapa globalmente para debugging
if (typeof window !== "undefined") {
  window.controlMap = map
}
