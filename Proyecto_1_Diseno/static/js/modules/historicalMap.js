let map;
let drawnItems;
let polylinesHistoricas = [];
let marcadoresHistoricos = [];
let marcadoresVisibles = true;
let currentDrawer = null;

const polylineOptions = {
  color: "#4C1D95",
  weight: 4,
  opacity: 0.8,
};

export function initializeMap(onCreate, onEdit, onDelete) {
  map = L.map("map").setView([11.0, -74.8], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  drawnItems = new L.FeatureGroup().addTo(map);

  map.on(L.Draw.Event.CREATED, function (e) {
    const layer = e.layer;
    drawnItems.clearLayers();
    drawnItems.addLayer(layer);

    // Notificamos a la UI
    onCreate(layer);
    stopDrawing();
  });

  map.on(L.Draw.Event.EDITED, function (e) {
    const layers = e.layers;
    layers.eachLayer(function (layer) {
      onEdit(layer);
    });
  });
}

// === CONTROLES DE DIBUJO ===

function stopDrawing() {
  if (currentDrawer) {
    currentDrawer.disable();
    currentDrawer = null;
  }
}

// Dibujo libre (Polígono manual: el usuario hace clic punto por punto)
export function startDrawingPolygon() {
  stopDrawing();

  currentDrawer = new L.Draw.Polygon(map, {
    allowIntersection: false,
    showArea: true,
    shapeOptions: {
      color: "#3b82f6",
      weight: 3,
      opacity: 0.7,
      fillOpacity: 0.2,
    },
  });

  currentDrawer.enable();
}

/**
 * CÍRCULO AUTOMÁTICO DINÁMICO
 * Crea un L.Circle real (no polígono) en el centro de la pantalla.
 * Calcula el radio basándose en el nivel de zoom actual.
 */
export function startDrawingCircle() {
  stopDrawing();

  // 1. Obtener el centro del mapa
  const center = map.getCenter();

  // 2. Calcular un radio dinámico basado en los límites visibles
  // Obtenemos la distancia desde el centro hasta el borde este (en metros)
  // y usamos un 25% de esa distancia para que el círculo sea visible y cómodo.
  const bounds = map.getBounds();
  const centerPoint = map.latLngToContainerPoint(center);
  const eastPoint = map.latLngToContainerPoint(bounds.getEast()); // Esto no funciona directo con containerPoint si no pasamos LatLng

  // Mejor aproximación usando distancia geodésica:
  const eastLatLng = L.latLng(center.lat, bounds.getEast());
  const distanceToEdge = map.distance(center, eastLatLng);

  // Radio = 25% del ancho visible del mapa
  const dynamicRadius = distanceToEdge * 0.25;

  // 3. Crear el Círculo real
  const circleLayer = new L.Circle(center, {
    radius: dynamicRadius,
    color: "#ec4899",
    weight: 3,
    opacity: 0.7,
    fillOpacity: 0.2,
  });

  // 4. Agregarlo al mapa
  drawnItems.clearLayers();
  drawnItems.addLayer(circleLayer);

  // 5. Disparar evento de creación para la UI
  map.fire(L.Draw.Event.CREATED, {
    layer: circleLayer,
    layerType: "circle",
  });

  // 6. Activar la edición inmediatamente para ver los manejadores
  setTimeout(() => {
    enableEditing(circleLayer);
    // Notificar a la UI que estamos en modo edición
    window.dispatchEvent(new CustomEvent("start-editing-geofence"));
  }, 100);
}

export function enableEditing(geofenceLayer) {
  if (geofenceLayer && geofenceLayer.editing) {
    geofenceLayer.editing.enable();
  }
}

export function disableEditing(geofenceLayer) {
  if (geofenceLayer && geofenceLayer.editing) {
    geofenceLayer.editing.disable();
    // Disparar evento manualmente para guardar cambios
    map.fire(L.Draw.Event.EDITED, {
      layers: L.layerGroup([geofenceLayer]),
    });
  }
}

// === Funciones Auxiliares (Sin cambios) ===

function agruparPuntos(datosFiltrados) {
  const puntosAgrupados = new Map();
  for (const punto of datosFiltrados) {
    const key = `${punto.lat},${punto.lon}`;
    if (!puntosAgrupados.has(key)) {
      puntosAgrupados.set(key, {
        lat: punto.lat,
        lon: punto.lon,
        timestamps: [],
      });
    }
    puntosAgrupados.get(key).timestamps.push(punto.timestamp);
  }
  return Array.from(puntosAgrupados.values());
}

function clipPolyline(coordinates, bounds) {
  const segments = [];
  let currentSegment = [];

  for (let i = 0; i < coordinates.length; i++) {
    const latlng = L.latLng(coordinates[i][0], coordinates[i][1]);

    if (bounds.contains(latlng)) {
      currentSegment.push(coordinates[i]);
    } else {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
        currentSegment = [];
      }
    }
  }
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }
  return segments;
}

export function dibujarPuntosEnMapa(datosFiltrados) {
  marcadoresHistoricos.forEach((marker) => map.removeLayer(marker));
  marcadoresHistoricos = [];

  const uniquePoints = agruparPuntos(datosFiltrados);

  uniquePoints.forEach((punto) => {
    const marker = L.circleMarker([punto.lat, punto.lon], {
      radius: 5,
      color: "#FFFFFF",
      weight: 2,
      fillColor: "#EF4444",
      fillOpacity: 1.0,
      pane: "markerPane",
    }).addTo(map);

    const popupContent = `<b>Fechas en este punto:</b><br>${punto.timestamps.join(
      "<br>"
    )}`;
    marker.bindPopup(popupContent, { maxHeight: 200 });

    marcadoresHistoricos.push(marker);
  });

  if (!marcadoresVisibles) {
    toggleMarkers();
  }

  fitView(null);
}

export function dibujarPuntoIndividual(punto) {
  const marker = L.circleMarker([punto.lat, punto.lon], {
    radius: 5,
    color: "#FFFFFF",
    weight: 2,
    fillColor: "#EF4444",
    fillOpacity: 1.0,
    pane: "markerPane",
  }).addTo(map);

  const popupContent = `<b>Fecha:</b><br>${
    punto.timestamp || punto.created_at
  }`;
  marker.bindPopup(popupContent);

  marcadoresHistoricos.push(marker);
}

export function clearMarkers() {
  marcadoresHistoricos.forEach((marker) => map.removeLayer(marker));
  marcadoresHistoricos = [];
}

export function dibujarSegmentoRuta(segmentoCoords, geofenceLayer) {
  if (
    !segmentoCoords ||
    !Array.isArray(segmentoCoords) ||
    segmentoCoords.length < 2
  ) {
    return;
  }

  if (geofenceLayer) {
    // Para visualización limpia, recortamos líneas fuera de la geocerca
    // Nota: L.Circle también tiene getBounds(), así que esto funciona para Rect, Poly y Circle.
    const geofenceBounds = geofenceLayer.getBounds();
    const clippedSegments = clipPolyline(segmentoCoords, geofenceBounds);

    clippedSegments.forEach((segment) => {
      if (segment.length > 1) {
        const poly = L.polyline(segment, polylineOptions).addTo(map);
        polylinesHistoricas.push(poly);
      }
    });
  } else {
    const poly = L.polyline(segmentoCoords, polylineOptions).addTo(map);
    polylinesHistoricas.push(poly);
  }
}

export function clearPolylines() {
  polylinesHistoricas.forEach((poly) => map.removeLayer(poly));
  polylinesHistoricas = [];
}

export function clearMap(preserveGeofence = false) {
  clearPolylines();
  clearMarkers();
  stopDrawing();

  if (!preserveGeofence) {
    if (drawnItems) {
      drawnItems.clearLayers();
    }
  }
}

export function removeGeofence(geofenceLayer) {
  if (geofenceLayer && drawnItems) {
    drawnItems.removeLayer(geofenceLayer);
  }
}

export function toggleMarkers() {
  marcadoresVisibles = !marcadoresVisibles;
  const toggleText = document.getElementById("toggleMarcadoresText");

  marcadoresHistoricos.forEach((marker) => {
    if (marcadoresVisibles) {
      map.addLayer(marker);
    } else {
      map.removeLayer(marker);
    }
  });

  toggleText.textContent = marcadoresVisibles
    ? "Ocultar Marcadores"
    : "Mostrar Marcadores";
}

export function fitView(geofenceLayer) {
  if (geofenceLayer) {
    map.fitBounds(geofenceLayer.getBounds());
  } else if (polylinesHistoricas.length > 0) {
    const segmentsGroup = L.featureGroup(polylinesHistoricas);
    map.fitBounds(segmentsGroup.getBounds());
  } else if (marcadoresHistoricos.length > 0) {
    const pointsGroup = L.featureGroup(marcadoresHistoricos);
    map.fitBounds(pointsGroup.getBounds());
  }
}
