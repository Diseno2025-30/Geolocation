import * as osrm from "./modules/osrm.js";
import * as map from "./modules/historicalMap.js";
import * as ui from "./modules/historicalUI.js";

// ==================== VARIABLES GLOBALES ====================
let datosHistoricosOriginales = [];
let datosHistoricosFiltrados = [];
let geofenceLayer = null;
let estadoAnimacion = {
  puntosCompletos: [],
  segmentosRuta: [],
  indiceActual: 0,
  animacionActiva: false,
  intervalId: null
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

  // Configurar navegación si existe
  if (window.setupViewNavigation) {
    window.setupViewNavigation();
  }

  // Configurar event listener del slider de animación
  configurarSliderAnimacion();
});

// ==================== CONSULTAS DE DATOS ====================
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
  const url = `${basePath}/historico/geocerca?min_lat=${sw.lat}&min_lon=${sw.lng}&max_lat=${ne.lat}&max_lon=${ne.lng}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("No se encontraron datos en esta área");
    }

    const data = await response.json();
    datosHistoricosOriginales = [];
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
    map.clearMap(!!geofenceLayer);
    ui.actualizarInformacionHistorica(datosHistoricosFiltrados, geofenceLayer);
    if (datosHistoricosOriginales.length > 0) {
      alert("No se encontraron puntos con los filtros aplicados.");
    }
    return;
  }

  // Mostrar el control de animación
  const controlAnimacion = document.getElementById('routeAnimationControl');
  if (controlAnimacion) {
    controlAnimacion.style.display = 'block';
  }
  
  // Preparar la animación
  await prepararAnimacionRuta();
}

async function prepararAnimacionRuta() {
  console.log("🚀 Preparando animación de ruta...");
  
  // Limpiar estado anterior
  map.clearMap(!!geofenceLayer);
  resetearEstadoAnimacion();
  
  // Configurar puntos
  estadoAnimacion.puntosCompletos = [...datosHistoricosFiltrados];
  
  // Configurar UI del slider
  configurarUISlider();
  
  // Pre-calcular todos los segmentos OSRM
  await precalcularSegmentosRuta();
  
  console.log("✅ Pre-cálculo completado");
  
  // Renderizar el primer punto
  renderizarHastaIndice(0);
  ui.actualizarInformacionHistorica(datosHistoricosFiltrados, geofenceLayer);
}

function resetearEstadoAnimacion() {
  if (estadoAnimacion.intervalId) {
    clearInterval(estadoAnimacion.intervalId);
  }
  
  estadoAnimacion = {
    puntosCompletos: [],
    segmentosRuta: [],
    indiceActual: 0,
    animacionActiva: false,
    intervalId: null
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

async function precalcularSegmentosRuta() {
  const totalSegmentos = datosHistoricosFiltrados.length - 1;
  console.log(`📊 Pre-calculando ${totalSegmentos} segmentos...`);
  
  // Mostrar indicador de carga
  const loadingDiv = document.getElementById('loadingProgress');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  if (loadingDiv) loadingDiv.style.display = 'block';
  
  // Inicializar array con el tamaño correcto
  estadoAnimacion.segmentosRuta = new Array(totalSegmentos);
  
  const BATCH_SIZE = 20; // Procesar 20 segmentos en paralelo
  let procesados = 0;
  
  for (let i = 0; i < totalSegmentos; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, totalSegmentos);
    const batchPromises = [];
    
    // Crear promesas para el lote actual
    for (let j = i; j < batchEnd; j++) {
      const punto1 = datosHistoricosFiltrados[j];
      const punto2 = datosHistoricosFiltrados[j + 1];
      const indice = j; // Capturar índice para el closure
      
      const promise = osrm.getOSRMRoute(
        punto1.lat, punto1.lon, 
        punto2.lat, punto2.lon
      ).then((rutaOSRM) => {
        if (rutaOSRM && rutaOSRM.length > 0) {
          estadoAnimacion.segmentosRuta[indice] = rutaOSRM;
        } else {
          // Fallback a línea recta
          estadoAnimacion.segmentosRuta[indice] = [
            [punto1.lat, punto1.lon], 
            [punto2.lat, punto2.lon]
          ];
        }
      }).catch((error) => {
        console.error(`❌ Error en segmento ${indice}:`, error);
        // Fallback en caso de error
        estadoAnimacion.segmentosRuta[indice] = [
          [punto1.lat, punto1.lon], 
          [punto2.lat, punto2.lon]
        ];
      });
      
      batchPromises.push(promise);
    }
    
    // Esperar a que termine el lote
    await Promise.all(batchPromises);
    
    // Actualizar progreso
    procesados = batchEnd;
    const porcentaje = Math.round((procesados / totalSegmentos) * 100);
    
    if (progressBar) progressBar.style.width = `${porcentaje}%`;
    if (progressText) {
      progressText.textContent = `Cargando rutas: ${porcentaje}% (${procesados}/${totalSegmentos})`;
    }
    
    console.log(`⏳ Progreso: ${procesados}/${totalSegmentos} (${porcentaje}%)`);
  }
  
  // Ocultar indicador de carga
  if (loadingDiv) loadingDiv.style.display = 'none';
  
  console.log(`✅ Total segmentos calculados: ${estadoAnimacion.segmentosRuta.length}`);
  console.log(`✅ Segmentos válidos: ${estadoAnimacion.segmentosRuta.filter(s => s && s.length > 0).length}`);
}

function renderizarHastaIndice(indice) {
  console.log(`\n🎨 ========== RENDERIZAR HASTA ÍNDICE ${indice} ==========`);
  console.log(`📊 Estado actual:`);
  console.log(`   - puntosCompletos.length: ${estadoAnimacion.puntosCompletos.length}`);
  console.log(`   - segmentosRuta.length: ${estadoAnimacion.segmentosRuta.length}`);
  
  // Limpiar capas anteriores
  map.clearPolylines();
  map.clearMarkers();
  
  console.log(`\n👉 Dibujando ${indice + 1} puntos...`);
  // Dibujar puntos hasta el índice actual (inclusive)
  for (let i = 0; i <= indice; i++) {
    const punto = estadoAnimacion.puntosCompletos[i];
    console.log(`   Punto ${i}:`, punto);
    map.dibujarPuntoIndividual(punto);
  }
  
  console.log(`\n📏 Dibujando ${indice} polilíneas...`);
  // Dibujar polilíneas hasta el índice actual (exclusive)
  for (let i = 0; i < indice; i++) {
    const segmento = estadoAnimacion.segmentosRuta[i];
    console.log(`   Segmento ${i}:`, segmento);
    
    if (segmento && segmento.length > 0) {
      console.log(`   ✅ Dibujando segmento ${i} con ${segmento.length} puntos`);
      map.dibujarSegmentoRuta(segmento, geofenceLayer);
    } else {
      console.warn(`   ⚠️ Segmento ${i} no disponible o vacío`);
    }
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
  
  console.log(`🎨 ========== FIN RENDERIZADO ==========\n`);
}

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

// ==================== CONTROL DE ANIMACIÓN ====================
function configurarSliderAnimacion() {
  const slider = document.getElementById('routeAnimationSlider');
  if (slider) {
    slider.addEventListener('input', (e) => {
      const indice = parseInt(e.target.value);
      renderizarHastaIndice(indice);
      estadoAnimacion.indiceActual = indice;
    });
  }
}

window.animarRutaAutomatica = function() {
  if (estadoAnimacion.animacionActiva) return;
  
  estadoAnimacion.animacionActiva = true;
  toggleBotonesPlayPause(false);
  
  const slider = document.getElementById('routeAnimationSlider');
  const velocidad = parseInt(document.getElementById('animationSpeed').value);
  
  estadoAnimacion.intervalId = setInterval(() => {
    const maxIndice = estadoAnimacion.puntosCompletos.length - 1;
    
    if (estadoAnimacion.indiceActual >= maxIndice) {
      window.pausarAnimacion();
      return;
    }
    
    estadoAnimacion.indiceActual++;
    if (slider) slider.value = estadoAnimacion.indiceActual;
    renderizarHastaIndice(estadoAnimacion.indiceActual);
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

window.reiniciarAnimacion = function() {
  window.pausarAnimacion();
  estadoAnimacion.indiceActual = 0;
  
  const slider = document.getElementById('routeAnimationSlider');
  if (slider) slider.value = 0;
  
  renderizarHastaIndice(0);
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
  aplicarFiltrosYActualizarMapa();
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
  
  const controlAnimacion = document.getElementById('routeAnimationControl');
  if (controlAnimacion) {
    controlAnimacion.style.display = 'none';
  }
  
  resetearEstadoAnimacion();
}

function onLimpiarGeocerca() {
  if (geofenceLayer) {
    map.removeGeofence(geofenceLayer);
    geofenceLayer = null;
    aplicarFiltrosYActualizarMapa();
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