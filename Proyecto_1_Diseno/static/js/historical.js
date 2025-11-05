import * as osrm from "./modules/osrm.js"
import * as map from "./modules/historicalMap.js"
import * as ui from "./modules/historicalUI.js"

let datosHistoricosOriginales = []
let datosHistoricosFiltrados = []
let geofenceLayer = null

document.addEventListener("DOMContentLoaded", () => {
  map.initializeMap(onGeofenceCreated, onGeofenceEdited, onGeofenceDeleted)

  ui.initializeUI(onVerHistorico, onLimpiarMapa, onExportarDatos, onToggleMarcadores, onAjustarVista, onLimpiarGeocerca)

  const geofenceBtn = document.getElementById("geofenceBtn")
  const geofenceModal = document.getElementById("geofenceModal")
  const closeGeofenceModal = document.getElementById("closeGeofenceModal")

  if (geofenceBtn && geofenceModal) {
    geofenceBtn.addEventListener("click", () => {
      geofenceModal.classList.add("active")
      updateGeofenceList()
    })
  }

  if (closeGeofenceModal && geofenceModal) {
    closeGeofenceModal.addEventListener("click", () => {
      geofenceModal.classList.remove("active")
    })
  }

  // Close modal when clicking outside
  if (geofenceModal) {
    geofenceModal.addEventListener("click", (e) => {
      if (e.target === geofenceModal) {
        geofenceModal.classList.remove("active")
      }
    })
  }

  if (window.setupViewNavigation) {
    window.setupViewNavigation()
  }
})

function updateGeofenceList() {
  const container = document.getElementById("geofenceListContainer")
  if (!container) return

  if (geofenceLayer) {
    container.innerHTML = `
      <div class="geofence-item">
        <span class="geofence-item-name">Geovalla Activa</span>
        <div class="geofence-item-actions">
          <button class="geofence-item-btn" onclick="editarGeocerca()" title="Editar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="geofence-item-btn" onclick="limpiarGeocerca()" title="Eliminar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    `
  } else {
    container.innerHTML = '<p class="no-geofences">No hay geovallas activas</p>'
  }
}

window.crearGeocerca = () => {
  const geofenceModal = document.getElementById("geofenceModal")
  if (geofenceModal) {
    geofenceModal.classList.remove("active")
  }
  map.startDrawingGeofence()
}

window.editarGeocerca = () => {
  const geofenceModal = document.getElementById("geofenceModal")
  if (geofenceModal) {
    geofenceModal.classList.remove("active")
  }
  if (geofenceLayer) {
    map.editGeofence(geofenceLayer)
  } else {
    alert("No hay geovalla para editar")
  }
}

window.limpiarGeocerca = () => {
  if (geofenceLayer) {
    map.removeGeofence(geofenceLayer)
    geofenceLayer = null
    aplicarFiltrosYActualizarMapa()
    updateGeofenceList()

    const geofenceModal = document.getElementById("geofenceModal")
    if (geofenceModal && geofenceModal.classList.contains("active")) {
      // Keep modal open to show updated list
    }
  } else {
    alert("No hay geovalla para eliminar")
  }
}

async function onVerHistorico(fechaInicio, horaInicio, fechaFin, horaFin) {
  const basePath = window.BASE_PATH || (window.location.pathname.startsWith("/test") ? "/test" : "")
  const url = `${basePath}/historico/rango?inicio=${fechaInicio}&fin=${fechaFin}&hora_inicio=${horaInicio}&hora_fin=${horaFin}`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      throw new Error(errorData?.error || "No hay datos para ese rango de fechas")
    }

    datosHistoricosOriginales = await response.json()
    ui.closeSearchModal()
    await aplicarFiltrosYActualizarMapa()
  } catch (error) {
    console.error("Error al consultar histórico:", error)
    alert(error.message)
  }
}

async function fetchDatosPorGeocerca(bounds) {
  const sw = bounds.getSouthWest()
  const ne = bounds.getNorthEast()
  const basePath = window.BASE_PATH || (window.location.pathname.startsWith("/test") ? "/test" : "")
  const url = `${basePath}/historico/geocerca?min_lat=${sw.lat}&min_lon=${sw.lng}&max_lat=${ne.lat}&max_lon=${ne.lng}`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error("No se encontraron datos en esta área")
    }

    const data = await response.json()
    datosHistoricosOriginales = []
    datosHistoricosFiltrados = data
    await dibujarRutaFiltrada()
  } catch (error) {
    console.error("Error al consultar por geocerca:", error)
    alert(error.message)
  }
}

async function aplicarFiltrosYActualizarMapa() {
  if (geofenceLayer) {
    const bounds = geofenceLayer.getBounds()
    datosHistoricosFiltrados = datosHistoricosOriginales.filter((p) => bounds.contains([p.lat, p.lon]))
  } else {
    datosHistoricosFiltrados = [...datosHistoricosOriginales]
  }

  await dibujarRutaFiltrada()
}

async function dibujarRutaFiltrada() {
  if (datosHistoricosFiltrados.length === 0) {
    map.clearMap(!!geofenceLayer)
    ui.actualizarInformacionHistorica(datosHistoricosFiltrados, geofenceLayer)
    if (datosHistoricosOriginales.length > 0) {
      alert("No se encontraron puntos con los filtros aplicados.")
    }
    return
  }
  map.clearPolylines()
  map.dibujarPuntosEnMapa(datosHistoricosFiltrados)
  ui.actualizarInformacionHistorica(datosHistoricosFiltrados, geofenceLayer)

  try {
    await osrm.generateFullStreetRoute(datosHistoricosFiltrados, null, (segment) =>
      map.dibujarSegmentoRuta(segment, geofenceLayer),
    )
  } catch (error) {
    console.error("Error durante la generación de ruta OSRM:", error)
    alert("Ocurrió un error al generar la ruta. Es posible que la ruta solo muestre líneas rectas.")
  }
  map.fitView(geofenceLayer)
}

function onGeofenceCreated(layer) {
  geofenceLayer = layer
  updateGeofenceList()
  if (datosHistoricosOriginales.length > 0) {
    aplicarFiltrosYActualizarMapa()
  } else {
    fetchDatosPorGeocerca(layer.getBounds())
  }
}

function onGeofenceEdited(layer) {
  geofenceLayer = layer
  updateGeofenceList()
  if (datosHistoricosOriginales.length > 0) {
    aplicarFiltrosYActualizarMapa()
  } else {
    fetchDatosPorGeocerca(layer.getBounds())
  }
}

function onGeofenceDeleted() {
  geofenceLayer = null
  updateGeofenceList()
  aplicarFiltrosYActualizarMapa()
}

function onLimpiarMapa() {
  datosHistoricosOriginales = []
  datosHistoricosFiltrados = []
  geofenceLayer = null
  map.clearMap(false)
  ui.actualizarInformacionHistorica([], null)
  ui.resetDatePickers()
  updateGeofenceList()
}

function onLimpiarGeocerca() {
  if (geofenceLayer) {
    map.removeGeofence(geofenceLayer)
    geofenceLayer = null
    aplicarFiltrosYActualizarMapa()
    updateGeofenceList()
  }
}

function onExportarDatos() {
  if (datosHistoricosFiltrados.length === 0) {
    alert("No hay datos para exportar")
    return
  }
  ui.exportarDatos(datosHistoricosFiltrados)
}

function onToggleMarcadores() {
  map.toggleMarkers()
}

function onAjustarVista() {
  map.fitView(geofenceLayer)
}
