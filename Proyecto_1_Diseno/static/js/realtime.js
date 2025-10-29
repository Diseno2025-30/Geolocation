// static/js/realtime.js
import * as Map from "./map.js";
import * as API from "./api.js";
import * as UI from "./ui.js";

let trajectoryPoints = [];
let isTrajectoryVisible = true;
let updateInterval;

document.addEventListener("DOMContentLoaded", () => {
  Map.initMap("map");

  // Asignar eventos a botones
  document
    .getElementById("btnLimpiar")
    .addEventListener("click", limpiarTrayectoria);
  document
    .getElementById("btnToggleRuta")
    .addEventListener("click", toggleTrayectoria);
  document
    .getElementById("btnRegenerar")
    .addEventListener("click", regenerarRuta);

  // Iniciar el bucle de actualización
  startUpdateLoop();
});

/** Inicia el bucle de actualización */
function startUpdateLoop() {
  if (updateInterval) clearInterval(updateInterval);
  fetchData(); // Cargar la primera vez
  updateInterval = setInterval(fetchData, 5000); // Actualizar cada 5 segundos
}

/** Función principal de fetch */
async function fetchData() {
  const data = await API.fetchLastCoordinate();
  if (!data || !data.lat) {
    UI.updateText("#status", "OFFLINE");
    UI.toggleClass("#modalStatus", "offline", true);
    UI.toggleClass("#modalStatus", "online", false);
    return;
  }

  const { lat, lon, timestamp, source, id } = data;
  const latLng = [lat, lon];

  // Actualizar UI
  UI.updateText("#status", "ONLINE");
  UI.updateText("#lastUpdate", timestamp);
  UI.updateText("#latitude", lat.toFixed(6));
  UI.updateText("#longitude", lon.toFixed(6));
  UI.updateText("#deviceId", source);
  UI.updateText("#timestamp", timestamp);

  // Actualizar clases de status
  UI.toggleClass("#modalStatus", "online", true);
  UI.toggleClass("#modalStatus", "offline", false);

  // Actualizar mapa
  Map.updateMarker(lat, lon);

  // Añadir a trayectoria si es un punto nuevo
  if (
    trajectoryPoints.length === 0 ||
    trajectoryPoints[trajectoryPoints.length - 1][0] !== lat
  ) {
    trajectoryPoints.push(latLng);
    if (isTrajectoryVisible) {
      Map.updatePolyline(trajectoryPoints);
    }
    UI.updateText("#puntosTrayectoria", trajectoryPoints.length.toString());
  }

  UI.updateInfoModal();
}

/** Limpia la trayectoria del mapa */
function limpiarTrayectoria() {
  trajectoryPoints = [];
  Map.clearMap(); // Limpia marcador y polilínea
  UI.updateText("#puntosTrayectoria", "0");
  fetchData(); // Vuelve a poner el marcador actual
  UI.updateInfoModal();
}

/** Muestra/oculta la trayectoria */
function toggleTrayectoria() {
  isTrajectoryVisible = !isTrajectoryVisible;
  if (isTrajectoryVisible) {
    UI.updateText("#toggleText", "Ocultar Trayectoria");
    Map.updatePolyline(trajectoryPoints);
  } else {
    UI.updateText("#toggleText", "Mostrar Trayectoria");
    Map.clearMap(); // Limpia polilínea (y marcador)
    fetchData(); // Redibuja el marcador
  }
}

/** Regenera la ruta usando OSRM */
async function regenerarRuta() {
  if (trajectoryPoints.length < 2) return;

  // Limitar a 100 puntos por llamada OSRM
  const pointsToRoute = trajectoryPoints.slice(-100);

  UI.setVisible(".loading-overlay", true); // (Asumiendo que existe un overlay)

  try {
    const routeData = await API.fetchOSRMRoute(pointsToRoute);
    if (routeData && routeData.routes && routeData.routes.length > 0) {
      Map.drawGeoJSONRoute(routeData.routes[0].geometry);
    } else {
      console.error("No se pudo generar la ruta OSRM");
    }
  } catch (error) {
    console.error("Error al regenerar ruta:", error);
  } finally {
    UI.setVisible(".loading-overlay", false);
  }
}
