// static/js/historical.js
import * as Map from './modules/map.js';
import * as API from './modules/api.js';
import * as UI from './modules/ui.js';

let historicalData = [];
let isRouteGenerationCancelled = false;
let areMarkersVisible = true;

document.addEventListener("DOMContentLoaded", () => {
  const map = Map.initMap("map");

  // Inicializar Leaflet.Draw
  Map.initDrawControl((layer) => {
    // Callback cuando se dibuja un rectángulo
    buscarPorGeocerca(layer.getBounds());
  });

  // Eventos del Modal de Búsqueda
  UI.setVisible("#searchModal", false);
  document
    .getElementById("searchBtn")
    .addEventListener("click", () => UI.setVisible("#searchModal", true));
  document
    .getElementById("closeSearchModal")
    .addEventListener("click", () => UI.setVisible("#searchModal", false));

  document
    .getElementById("btnHoy")
    .addEventListener("click", establecerRangoHoy);
  document
    .getElementById("btn7Dias")
    .addEventListener("click", establecerRangoUltimos7Dias);
  document
    .getElementById("btnBuscar")
    .addEventListener("click", verHistoricoRango);
  document
    .getElementById("btnLimpiarMapa")
    .addEventListener("click", limpiarMapa);

  // Eventos de controles del mapa
  document
    .getElementById("btnToggleMarcadores")
    .addEventListener("click", toggleMarcadores);
  document
    .getElementById("btnAjustarVista")
    .addEventListener("click", Map.fitBounds);
  document
    .getElementById("btnLimpiarGeocerca")
    .addEventListener("click", Map.clearGeofence);
  document
    .getElementById("btnExportar")
    .addEventListener("click", exportarDatos);

  // Evento de cancelación
  document.getElementById("cancelRouteBtn").addEventListener("click", () => {
    isRouteGenerationCancelled = true;
  });

  // Setear fechas por defecto
  establecerRangoHoy();
});

// ====================
// Lógica de Búsqueda
// ====================

function establecerRangoHoy() {
  const hoy = UI.formatDate(new Date());
  UI.setValue("#fechaInicio", hoy);
  UI.setValue("#fechaFin", hoy);
  UI.setValue("#horaInicio", "00:00");
  UI.setValue("#horaFin", "23:59");
}

function establecerRangoUltimos7Dias() {
  const hoy = new Date();
  const hace7Dias = new Date(hoy.getTime() - 7 * 24 * 60 * 60 * 1000);

  UI.setValue("#fechaInicio", UI.formatDate(hace7Dias));
  UI.setValue("#fechaFin", UI.formatDate(hoy));
  UI.setValue("#horaInicio", "00:00");
  UI.setValue("#horaFin", "23:59");
}

async function verHistoricoRango() {
  UI.setVisible("#searchModal", false);
  UI.setVisible("#loadingOverlay", true);
  UI.updateText("#loadingText", "Buscando datos...");
  UI.updateText("#loadingSubtext", "Consultando la base de datos");
  UI.setVisible(".route-progress", false);

  const params = {
    inicio: UI.getValue("#fechaInicio"),
    fin: UI.getValue("#fechaFin"),
    hora_inicio: UI.getValue("#horaInicio"),
    hora_fin: UI.getValue("#horaFin"),
  };

  const data = await API.fetchHistoricalRange(
    params.inicio,
    params.fin,
    params.hora_inicio,
    params.hora_fin
  );

  if (data) {
    procesarDatos(data, `Rango: ${params.inicio} a ${params.fin}`);
  } else {
    UI.setVisible("#loadingOverlay", false);
    alert("No se encontraron datos o hubo un error.");
  }
}

async function buscarPorGeocerca(bounds) {
  UI.setVisible("#loadingOverlay", true);
  UI.updateText("#loadingText", "Buscando en geocerca...");
  UI.updateText("#loadingSubtext", "Consultando la base de datos");
  UI.setVisible(".route-progress", false);

  const data = await API.fetchHistoricalGeofence(bounds);

  if (data) {
    procesarDatos(data, "Consulta por Geocerca");
  } else {
    UI.setVisible("#loadingOverlay", false);
    alert("No se encontraron datos o hubo un error.");
  }
}

// ====================
// Procesamiento de Datos
// ====================

function procesarDatos(data, rangoConsultado) {
  limpiarMapa(false); // Limpia mapa sin limpiar geocerca
  historicalData = data;

  UI.updateText("#puntosHistoricos", data.length.toString());
  UI.updateText("#lastQuery", new Date().toLocaleString());
  UI.updateText("#rangoConsultado", rangoConsultado);

  if (data.length === 0) {
    UI.setVisible("#loadingOverlay", false);
    UI.setVisible("#historicalControls", false);
    alert("No se encontraron puntos en este rango.");
    return;
  }

  const latLngs = data.map((p) => [p.lat, p.lon]);

  // Dibujar puntos GPS
  Map.drawHistoricalMarkers(latLngs);
  areMarkersVisible = true;
  UI.updateText("#btnToggleMarcadores", "Ocultar Marcadores");

  // Generar ruta OSRM
  generarRutaOSRM(latLngs);

  // Actualizar UI
  actualizarInfoRecorrido(data);
  UI.setVisible("#historicalControls", true);
  UI.updateInfoModal();
}

async function generarRutaOSRM(latLngs) {
  isRouteGenerationCancelled = false;
  UI.updateText("#loadingText", "Generando ruta...");
  UI.updateText("#loadingSubtext", "Conectando puntos por las calles");
  UI.setVisible(".route-progress", true);

  const CHUNK_SIZE = 100; // Límite de OSRM
  let allRouteGeometry = { type: "MultiLineString", coordinates: [] };

  for (let i = 0; i < latLngs.length; i += CHUNK_SIZE) {
    if (isRouteGenerationCancelled) {
      UI.setVisible("#loadingOverlay", false);
      return;
    }

    const chunk = latLngs.slice(i, i + CHUNK_SIZE);
    if (chunk.length < 2) continue;

    UI.updateProgress(
      "#routeProgressBar",
      "#routeProgressText",
      i,
      latLngs.length
    );

    try {
      const routeData = await API.fetchOSRMRoute(chunk);
      if (routeData && routeData.routes && routeData.routes.length > 0) {
        allRouteGeometry.coordinates.push(
          ...routeData.routes[0].geometry.coordinates
        );
      }
    } catch (error) {
      console.warn(`Error en segmento OSRM ${i}:`, error);
    }
  }

  UI.setVisible("#loadingOverlay", false);
  if (!isRouteGenerationCancelled) {
    Map.drawGeoJSONRoute(allRouteGeometry);
  }
}

// ====================
// Controles y UI
// ====================

function limpiarMapa(limpiarGeocerca = true) {
  Map.clearMap();
  if (limpiarGeocerca) {
    Map.clearGeofence();
  }
  historicalData = [];

  UI.setVisible("#historicalControls", false);
  UI.updateText("#puntosHistoricos", "0");
  UI.updateText("#rangoConsultado", "---");
  UI.updateText("#diasIncluidos", "---");

  // Resetear stats
  UI.updateField("puntoInicial", "---.------");
  UI.updateField("puntoFinal", "---.------");
  UI.updateField("distanciaTotal", "--- km");
  UI.updateField("duracion", "---");

  UI.updateInfoModal();
}

function toggleMarcadores() {
  areMarkersVisible = !areMarkersVisible;
  Map.toggleHistoricalMarkers(areMarkersVisible);
  UI.updateText(
    "#btnToggleMarcadores",
    areMarkersVisible ? "Ocultar Marcadores" : "Mostrar Marcadores"
  );
}

function actualizarInfoRecorrido(data) {
  if (data.length === 0) return;

  const inicio = data[0];
  const fin = data[data.length - 1];

  UI.updateField(
    "puntoInicial",
    `${inicio.lat.toFixed(5)}, ${inicio.lon.toFixed(5)} (${inicio.timestamp})`
  );
  UI.updateField(
    "puntoFinal",
    `${fin.lat.toFixed(5)}, ${fin.lon.toFixed(5)} (${fin.timestamp})`
  );

  // Calcular duración
  try {
    const parseDate = (ts) => {
      const [date, time] = ts.split(" ");
      const [day, month, year] = date.split("/");
      return new Date(`${year}-${month}-${day}T${time}`);
    };
    const dateInicio = parseDate(inicio.timestamp);
    const dateFin = parseDate(fin.timestamp);
    const diffMs = dateFin - dateInicio;
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor((diffMs % 3600000) / 60000);
    UI.updateField("duracion", `${diffHrs}h ${diffMins}m`);

    // Calcular días
    const dias = new Set(data.map((p) => p.timestamp.split(" ")[0]));
    UI.updateText("#diasIncluidos", `${dias.size} día(s)`);
  } catch (e) {
    console.error("Error parseando fechas:", e);
    UI.updateField("duracion", "Error");
    UI.updateText("#diasIncluidos", "Error");
  }

  // Distancia (simplificada, se debería usar OSRM)
  UI.updateField("distanciaTotal", "Calculando..."); // Se podría tomar de la respuesta de OSRM
}

function exportarDatos() {
  if (historicalData.length === 0) {
    alert("No hay datos para exportar.");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,lat,lon,timestamp\n";
  historicalData.forEach((row) => {
    csvContent += `${row.lat},${row.lon},"${row.timestamp}"\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute(
    "download",
    `historico_${UI.getValue("#fechaInicio")}_a_${UI.getValue("#fechaFin")}.csv`
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
