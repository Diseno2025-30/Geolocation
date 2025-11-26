import * as osrm from "./modules/osrm.js";
import * as map from "./modules/historicalMap.js";
import * as ui from "./modules/historicalUI.js";

// ==================== VARIABLES GLOBALES ====================
let datosHistoricosOriginales = [];
let datosHistoricosFiltrados = [];
let geofenceLayer = null;
let estadoAnimacion = {
  puntosCompletos: [],
  segmentosRuta: {},
  indiceActual: 0,
  animacionActiva: false,
  intervalId: null,
  calculando: false,
};

// ==================== INICIALIZACIÓN ====================
document.addEventListener("DOMContentLoaded", () => {
  // Inicializar mapa
  map.initializeMap(onGeofenceCreated, onGeofenceEdited, onGeofenceDeleted);

  // Inicializar UI
  ui.initializeUI(
    onVerHistorico,
    onLimpiarMapa,
    onExportarDatos,
    onToggleMarcadores,
    onAjustarVista,
    onLimpiarGeocerca
  );

  // Event Listeners para el puente UI-Mapa
  window.addEventListener("start-drawing-polygon", () => {
    map.startDrawingPolygon();
  });

  window.addEventListener("start-drawing-circle", () => {
    map.startDrawingCircle();
  });

  window.addEventListener("start-editing-geofence", () => {
    map.enableEditing(geofenceLayer);
  });

  window.addEventListener("stop-editing-geofence", () => {
    map.disableEditing(geofenceLayer);
  });

  window.addEventListener("save-editing-geofence", () => {
    map.disableEditing(geofenceLayer);
    onGeofenceEdited(geofenceLayer);
  });

  window.addEventListener("check-geofence-status", () => {
    ui.updateGeofenceModalState(!!geofenceLayer);
  });

  if (window.setupViewNavigation) {
    window.setupViewNavigation();
  }

  configurarSliderAnimacion();
});

// ==================== CONSULTAS DE DATOS ====================
async function onVerHistorico(fechaInicio, horaInicio, fechaFin, horaFin) {
  const basePath =
    window.BASE_PATH ||
    (window.location.pathname.startsWith("/test") ? "/test" : "");
  const url = `${basePath}/historico/rango?inicio=${fechaInicio}&fin=${fechaFin}&hora_inicio=${horaInicio}&hora_fin=${horaFin}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        errorData?.error || "No hay datos para ese rango de fechas"
      );
    }

    datosHistoricosOriginales = await response.json();
    ui.closeSearchModal();
    await aplicarFiltrosYActualizarMapa();
  } catch (error) {
    console.error("Error al consultar histórico:", error);
    alert(error.message);
  }
}

async function fetchDatosPorGeocerca(bounds) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const basePath =
    window.BASE_PATH ||
    (window.location.pathname.startsWith("/test") ? "/test" : "");
  const url = `${basePath}/historico/geocerca?min_lat=${sw.lat}&min_lon=${sw.lng}&max_lat=${ne.lat}&max_lon=${ne.lng}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("No se encontraron datos en esta área");
    }

    const data = await response.json();
    datosHistoricosOriginales = []; // Limpiamos originales porque es búsqueda directa
    datosHistoricosFiltrados = data;
    await dibujarRutaFiltrada();
  } catch (error) {
    console.error("Error al consultar por geocerca:", error);
    alert(error.message);
  }
}

// ==================== FILTROS Y ACTUALIZACIÓN ====================
async function aplicarFiltrosYActualizarMapa() {
  if (geofenceLayer) {
    const bounds = geofenceLayer.getBounds();
    datosHistoricosFiltrados = datosHistoricosOriginales.filter((p) =>
      bounds.contains([p.lat, p.lon])
    );
  } else {
    datosHistoricosFiltrados = [...datosHistoricosOriginales];
  }

  await dibujarRutaFiltrada();
}

// ==================== RENDERIZADO DE RUTA ====================
async function dibujarRutaFiltrada() {
  if (datosHistoricosFiltrados.length === 0) {
    // Si no hay datos, limpiamos el mapa pero MANTENEMOS la geocerca visible si existe
    map.clearMap(!!geofenceLayer);
    ui.actualizarInformacionHistorica(datosHistoricosFiltrados, geofenceLayer);

    // Ocultar controles de animación si no hay ruta
    const controlAnimacion = document.getElementById("routeAnimationControl");
    if (controlAnimacion) controlAnimacion.style.display = "none";

    if (datosHistoricosOriginales.length > 0) {
      alert("No se encontraron puntos con los filtros aplicados.");
    }
    return;
  }

  const controlAnimacion = document.getElementById("routeAnimationControl");
  if (controlAnimacion) {
    controlAnimacion.style.display = "block";
  }

  prepararAnimacionRuta();
}

function prepararAnimacionRuta() {
  // Limpiar estado anterior
  map.clearMap(!!geofenceLayer);
  resetearEstadoAnimacion();

  estadoAnimacion.puntosCompletos = [...datosHistoricosFiltrados];
  configurarUISlider();

  renderizarHastaIndice(0);
  ui.actualizarInformacionHistorica(datosHistoricosFiltrados, geofenceLayer);
}

function resetearEstadoAnimacion() {
  if (estadoAnimacion.intervalId) {
    clearInterval(estadoAnimacion.intervalId);
  }

  estadoAnimacion = {
    puntosCompletos: [],
    segmentosRuta: {},
    indiceActual: 0,
    animacionActiva: false,
    intervalId: null,
    calculando: false,
  };
}

function configurarUISlider() {
  const slider = document.getElementById("routeAnimationSlider");
  const totalPoints = document.getElementById("totalPointsCount");

  if (slider && totalPoints) {
    slider.max = datosHistoricosFiltrados.length - 1;
    slider.value = 0;
    totalPoints.textContent = datosHistoricosFiltrados.length;
  }
}

async function renderizarHastaIndice(indice) {
  if (estadoAnimacion.calculando) return;

  estadoAnimacion.calculando = true;
  map.clearPolylines();
  map.clearMarkers();

  for (let i = 0; i <= indice; i++) {
    map.dibujarPuntoIndividual(estadoAnimacion.puntosCompletos[i]);
  }

  for (let i = 0; i < indice; i++) {
    await dibujarSegmentoConCache(i);
  }

  const currentPointElement = document.getElementById("currentPointIndex");
  if (currentPointElement) {
    currentPointElement.textContent = indice + 1;
  }

  if (indice === 0) {
    map.fitView(geofenceLayer);
  }

  estadoAnimacion.calculando = false;
}

async function dibujarSegmentoConCache(indice) {
  if (estadoAnimacion.segmentosRuta[indice]) {
    map.dibujarSegmentoRuta(
      estadoAnimacion.segmentosRuta[indice],
      geofenceLayer
    );
    return;
  }

  const punto1 = estadoAnimacion.puntosCompletos[indice];
  const punto2 = estadoAnimacion.puntosCompletos[indice + 1];

  try {
    const rutaOSRM = await osrm.getOSRMRoute(
      punto1.lat,
      punto1.lon,
      punto2.lat,
      punto2.lon
    );

    if (rutaOSRM && rutaOSRM.length > 0) {
      estadoAnimacion.segmentosRuta[indice] = rutaOSRM;
      map.dibujarSegmentoRuta(rutaOSRM, geofenceLayer);
    } else {
      const fallback = [
        [punto1.lat, punto1.lon],
        [punto2.lat, punto2.lon],
      ];
      estadoAnimacion.segmentosRuta[indice] = fallback;
      map.dibujarSegmentoRuta(fallback, geofenceLayer);
    }
  } catch (error) {
    const fallback = [
      [punto1.lat, punto1.lon],
      [punto2.lat, punto2.lon],
    ];
    estadoAnimacion.segmentosRuta[indice] = fallback;
    map.dibujarSegmentoRuta(fallback, geofenceLayer);
  }
}

function configurarSliderAnimacion() {
  const slider = document.getElementById("routeAnimationSlider");
  if (slider) {
    slider.addEventListener("input", async (e) => {
      const indice = parseInt(e.target.value);
      estadoAnimacion.indiceActual = indice;
      await renderizarHastaIndice(indice);
    });
  }
}

window.animarRutaAutomatica = async function () {
  if (estadoAnimacion.animacionActiva) return;

  estadoAnimacion.animacionActiva = true;
  toggleBotonesPlayPause(false);

  const slider = document.getElementById("routeAnimationSlider");
  const velocidad = parseInt(document.getElementById("animationSpeed").value);

  estadoAnimacion.intervalId = setInterval(async () => {
    const maxIndice = estadoAnimacion.puntosCompletos.length - 1;
    if (estadoAnimacion.indiceActual >= maxIndice) {
      window.pausarAnimacion();
      return;
    }
    estadoAnimacion.indiceActual++;
    if (slider) slider.value = estadoAnimacion.indiceActual;
    await renderizarHastaIndice(estadoAnimacion.indiceActual);
  }, velocidad);
};

window.pausarAnimacion = function () {
  estadoAnimacion.animacionActiva = false;
  if (estadoAnimacion.intervalId) {
    clearInterval(estadoAnimacion.intervalId);
    estadoAnimacion.intervalId = null;
  }
  toggleBotonesPlayPause(true);
};

window.reiniciarAnimacion = async function () {
  window.pausarAnimacion();
  estadoAnimacion.indiceActual = 0;
  const slider = document.getElementById("routeAnimationSlider");
  if (slider) slider.value = 0;
  await renderizarHastaIndice(0);
};

window.cerrarAnimacion = function () {
  window.pausarAnimacion();
  const controlAnimacion = document.getElementById("routeAnimationControl");
  if (controlAnimacion) {
    controlAnimacion.style.display = "none";
  }
  resetearEstadoAnimacion();

  // Volver a dibujar todo si hay datos
  if (datosHistoricosFiltrados.length > 0) {
    map.dibujarPuntosEnMapa(datosHistoricosFiltrados);
    dibujarTodasLasPolylineas(); // Necesitas importar/definir esta función si la usas
  }
};

function toggleBotonesPlayPause(mostrarPlay) {
  const playBtn = document.getElementById("playBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  if (playBtn && pauseBtn) {
    playBtn.style.display = mostrarPlay ? "flex" : "none";
    pauseBtn.style.display = mostrarPlay ? "none" : "flex";
  }
}

// ==================== CALLBACKS DE GEOFENCE ====================
function onGeofenceCreated(layer) {
  geofenceLayer = layer;
  ui.updateGeofenceModalState(true);

  if (datosHistoricosOriginales.length > 0) {
    aplicarFiltrosYActualizarMapa();
  } else {
    fetchDatosPorGeocerca(layer.getBounds());
  }
}

function onGeofenceEdited(layer) {
  geofenceLayer = layer;
  if (datosHistoricosOriginales.length > 0) {
    aplicarFiltrosYActualizarMapa();
  } else {
    fetchDatosPorGeocerca(layer.getBounds());
  }
}

function onGeofenceDeleted() {
  geofenceLayer = null;
  ui.updateGeofenceModalState(false);

  // CAMBIO IMPORTANTE:
  // Si datosHistoricosOriginales está vacío, significa que los datos actuales
  // se trajeron específicamente por la geocerca (modo "Fetch por Geocerca").
  // Al borrar la geocerca, esos datos ya no tienen contexto, así que limpiamos todo.
  if (datosHistoricosOriginales.length === 0) {
    onLimpiarMapa();
  } else {
    // Si hay datos originales (modo "Búsqueda por Fecha"), simplemente quitamos el filtro
    aplicarFiltrosYActualizarMapa();
  }
}

// ==================== ACCIONES DE USUARIO ====================
function onLimpiarMapa() {
  window.pausarAnimacion();

  datosHistoricosOriginales = [];
  datosHistoricosFiltrados = [];
  geofenceLayer = null;

  map.clearMap(false);
  ui.actualizarInformacionHistorica([], null);
  ui.resetDatePickers();
  ui.updateGeofenceModalState(false);

  // Asegurar que el control de animación se oculta
  const controlAnimacion = document.getElementById("routeAnimationControl");
  if (controlAnimacion) {
    controlAnimacion.style.display = "none";
  }

  resetearEstadoAnimacion();
}

function onLimpiarGeocerca() {
  if (geofenceLayer) {
    map.removeGeofence(geofenceLayer);
    onGeofenceDeleted();
  }
}

function onExportarDatos() {
  if (datosHistoricosFiltrados.length === 0) {
    alert("No hay datos para exportar");
    return;
  }
  ui.exportarDatos(datosHistoricosFiltrados);
}

function onToggleMarcadores() {
  map.toggleMarkers();
}

function onAjustarVista() {
  map.fitView(geofenceLayer);
}

// Helper simple para dibujar todas las líneas si se cierra animación (si no usas OSRM para todo)
async function dibujarTodasLasPolylineas() {
  try {
    await osrm.generateFullStreetRoute(
      datosHistoricosFiltrados,
      null,
      (segment) => map.dibujarSegmentoRuta(segment, geofenceLayer)
    );
  } catch (error) {
    console.error("Error durante la generación de ruta OSRM:", error);
  }
}
