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

// ==================== CONSULTAS ====================
async function onVerHistorico(fechaInicio, horaInicio, fechaFin, horaFin) {
  const basePath = window.BASE_PATH || 
    (window.location.pathname.startsWith("/test") ? "/test" : "");
  const url = `${basePath}/historico/rango?inicio=${fechaInicio}&fin=${fechaFin}&hora_inicio=${horaInicio}&hora_fin=${horaFin}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error || "No hay datos para ese rango de fechas");
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
  const basePath = window.BASE_PATH || 
    (window.location.pathname.startsWith("/test") ? "/test" : "");
  // Nota: Seguimos enviando el rectángulo (bounds) al backend para la consulta SQL inicial rápida.
  // El filtrado preciso de "forma de polígono" se hace en Javascript en el siguiente paso.
  const url = `${basePath}/historico/geocerca?min_lat=${sw.lat}&min_lon=${sw.lng}&max_lat=${ne.lat}&max_lon=${ne.lng}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("No se encontraron datos en esta área");
    }
    const data = await response.json();
    datosHistoricosOriginales = [];

    // Aquí es donde simulamos que "datosHistoricosOriginales" son los datos crudos del rectángulo
    // y luego los filtramos estrictamente.
    // Usamos una variable temporal para no ensuciar la lógica si quisiéramos guardar el set completo.
    const datosRectangulo = data;

    if (geofenceLayer) {
      // Filtrado estricto inmediato
      datosHistoricosFiltrados = datosRectangulo.filter((p) =>
        map.isPointInsideGeofence(p.lat, p.lon, geofenceLayer)
      );
    } else {
      datosHistoricosFiltrados = datosRectangulo;
    }

    await dibujarRutaFiltrada();
  } catch (error) {
    console.error("Error al consultar por geocerca:", error);
    alert(error.message);
  }
}

// ==================== FILTROS Y ACTUALIZACIÓN ====================
async function aplicarFiltrosYActualizarMapa() {
  if (geofenceLayer) {
    // CAMBIO CRÍTICO: Usar la verificación precisa, no el rectángulo (bounds)
    datosHistoricosFiltrados = datosHistoricosOriginales.filter((p) =>
      map.isPointInsideGeofence(p.lat, p.lon, geofenceLayer)
    );
  } else {
    datosHistoricosFiltrados = [...datosHistoricosOriginales];
  }

  await dibujarRutaFiltrada();
}

// ==================== RENDERIZADO DE RUTA ====================
async function dibujarRutaFiltrada() {
  if (datosHistoricosFiltrados.length === 0) {
    map.clearMap(!!geofenceLayer);
    ui.actualizarInformacionHistorica(datosHistoricosFiltrados, geofenceLayer);
    const controlAnimacion = document.getElementById("routeAnimationControl");
    if (controlAnimacion) controlAnimacion.style.display = "none";

    // Solo mostramos alerta si teníamos datos originales y el filtro los ocultó todos
    if (datosHistoricosOriginales.length > 0) {
      // Opcional: alert("No hay puntos dentro de la zona exacta.");
    }
    return;
  }

  const controlAnimacion = document.getElementById("routeAnimationControl");
  if (controlAnimacion) controlAnimacion.style.display = "block";

  prepararAnimacionRuta();
}

function prepararAnimacionRuta() {
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
  if (currentPointElement) currentPointElement.textContent = indice + 1;

  if (indice === 0) map.fitView(geofenceLayer);

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

  // Mostrar el control de animación INMEDIATAMENTE
  const controlAnimacion = document.getElementById('routeAnimationControl');
  if (controlAnimacion) {
    controlAnimacion.style.display = 'block';
  }
  
  // NO pre-calcular, solo preparar
  prepararAnimacionRuta();
}

function prepararAnimacionRuta() {
  console.log("🚀 Preparando animación de ruta...");
  
  // Limpiar estado anterior
  map.clearMap(!!geofenceLayer);
  resetearEstadoAnimacion();
  
  // Guardar SOLO los puntos (sin calcular rutas aún)
  estadoAnimacion.puntosCompletos = [...datosHistoricosFiltrados];
  
  // Configurar UI del slider
  configurarUISlider();
  
  console.log(`✅ Listo para animar ${estadoAnimacion.puntosCompletos.length} puntos`);
  
  // Renderizar el primer punto INMEDIATAMENTE
  renderizarHastaIndice(0);
  ui.actualizarInformacionHistorica(datosHistoricosFiltrados, geofenceLayer);
}

function resetearEstadoAnimacion() {
  if (estadoAnimacion.intervalId) {
    clearInterval(estadoAnimacion.intervalId);
  }
  
  estadoAnimacion = {
    puntosCompletos: [],
    segmentosRuta: {}, // Cache vacío como objeto
    indiceActual: 0,
    animacionActiva: false,
    intervalId: null,
    calculando: false
  };
}

function configurarUISlider() {
  const slider = document.getElementById('routeAnimationSlider');
  const totalPoints = document.getElementById('totalPointsCount');
  
  if (slider && totalPoints) {
    slider.max = datosHistoricosFiltrados.length - 1;
    slider.value = 0;
    totalPoints.textContent = datosHistoricosFiltrados.length;
  }
}

// ==================== RENDERIZADO CON CÁLCULO BAJO DEMANDA ====================
async function renderizarHastaIndice(indice) {
  // Evitar renderizados simultáneos
  if (estadoAnimacion.calculando) {
    return;
  }
  
  estadoAnimacion.calculando = true;
  
  // Limpiar capas anteriores
  map.clearPolylines();
  map.clearMarkers();
  
  // Dibujar puntos hasta el índice actual (inclusive)
  for (let i = 0; i <= indice; i++) {
    map.dibujarPuntoIndividual(estadoAnimacion.puntosCompletos[i]);
  }
  
  // Dibujar/calcular polilíneas hasta el índice actual (exclusive)
  for (let i = 0; i < indice; i++) {
    await dibujarSegmentoConCache(i);
  }
  
  // Actualizar contador en UI
  const currentPointElement = document.getElementById('currentPointIndex');
  if (currentPointElement) {
    currentPointElement.textContent = indice + 1;
  }
  
  // Ajustar vista solo al inicio
  if (indice === 0) {
    map.fitView(geofenceLayer);
  }
  
  estadoAnimacion.calculando = false;
}

async function dibujarSegmentoConCache(indice) {
  // Si ya está en cache, usar directamente
  if (estadoAnimacion.segmentosRuta[indice]) {
    map.dibujarSegmentoRuta(estadoAnimacion.segmentosRuta[indice], geofenceLayer);
    return;
  }
  
  // Si no está en cache, calcularlo AHORA con OSRM (snap to roads)
  const punto1 = estadoAnimacion.puntosCompletos[indice];
  const punto2 = estadoAnimacion.puntosCompletos[indice + 1];
  
  try {
    const rutaOSRM = await osrm.getOSRMRoute(
      punto1.lat, punto1.lon, 
      punto2.lat, punto2.lon
    );
    
    if (rutaOSRM && rutaOSRM.length > 0) {
      // Guardar en cache
      estadoAnimacion.segmentosRuta[indice] = rutaOSRM;
      // Dibujar con snap to roads
      map.dibujarSegmentoRuta(rutaOSRM, geofenceLayer);
    } else {
      // Fallback: línea recta (solo si OSRM falla)
      const fallback = [
        [punto1.lat, punto1.lon], 
        [punto2.lat, punto2.lon]
      ];
      estadoAnimacion.segmentosRuta[indice] = fallback;
      map.dibujarSegmentoRuta(fallback, geofenceLayer);
    }
  } catch (error) {
    console.error(`❌ Error en segmento ${indice}:`, error);
    // Fallback en caso de error
    const fallback = [
      [punto1.lat, punto1.lon], 
      [punto2.lat, punto2.lon]
    ];
    estadoAnimacion.segmentosRuta[indice] = fallback;
    map.dibujarSegmentoRuta(fallback, geofenceLayer);
  }
}

async function dibujarTodasLasPolylineas() {
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
  if (controlAnimacion) controlAnimacion.style.display = "none";
  resetearEstadoAnimacion();

  if (datosHistoricosFiltrados.length > 0) {
    map.dibujarPuntosEnMapa(datosHistoricosFiltrados);
    // dibujarTodasLasPolylineas(); // (Implementar si es necesario)
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

// ==================== CONTROL DE ANIMACIÓN ====================
function configurarSliderAnimacion() {
  const slider = document.getElementById('routeAnimationSlider');
  if (slider) {
    slider.addEventListener('input', async (e) => {
      const indice = parseInt(e.target.value);
      estadoAnimacion.indiceActual = indice;
      await renderizarHastaIndice(indice);
    });
  }
}

window.animarRutaAutomatica = async function() {
  if (estadoAnimacion.animacionActiva) return;
  
  estadoAnimacion.animacionActiva = true;
  toggleBotonesPlayPause(false);
  
  const slider = document.getElementById('routeAnimationSlider');
  const velocidad = parseInt(document.getElementById('animationSpeed').value);
  
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

window.pausarAnimacion = function() {
  estadoAnimacion.animacionActiva = false;
  
  if (estadoAnimacion.intervalId) {
    clearInterval(estadoAnimacion.intervalId);
    estadoAnimacion.intervalId = null;
  }
  
  toggleBotonesPlayPause(true);
};

window.reiniciarAnimacion = async function() {
  window.pausarAnimacion();
  estadoAnimacion.indiceActual = 0;
  
  const slider = document.getElementById('routeAnimationSlider');
  if (slider) slider.value = 0;
  
  await renderizarHastaIndice(0);
};

window.cerrarAnimacion = function() {
  window.pausarAnimacion();
  
  const controlAnimacion = document.getElementById('routeAnimationControl');
  if (controlAnimacion) {
    controlAnimacion.style.display = 'none';
  }
  
  resetearEstadoAnimacion();
  
  // Volver a dibujar todo normalmente
  if (datosHistoricosFiltrados.length > 0) {
    map.dibujarPuntosEnMapa(datosHistoricosFiltrados);
    dibujarTodasLasPolylineas();
  }
};

function toggleBotonesPlayPause(mostrarPlay) {
  const playBtn = document.getElementById('playBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  
  if (playBtn && pauseBtn) {
    playBtn.style.display = mostrarPlay ? 'flex' : 'none';
    pauseBtn.style.display = mostrarPlay ? 'none' : 'flex';
  }
}

// ==================== CALLBACKS DE GEOFENCE ====================
function onGeofenceCreated(layer) {
  geofenceLayer = layer;
  ui.updateGeofenceModalState(true);
  // Si ya tenemos datos (por fecha), filtramos. Si no, buscamos en servidor.
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
  if (datosHistoricosOriginales.length === 0) {
    onLimpiarMapa();
  } else {
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
  const controlAnimacion = document.getElementById("routeAnimationControl");
  if (controlAnimacion) controlAnimacion.style.display = "none";
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