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

  // Escuchar evento de creación (tanto manual como programático)
  map.on(L.Draw.Event.CREATED, function (e) {
    const layer = e.layer;
    drawnItems.clearLayers();
    drawnItems.addLayer(layer);

    // Notificar creación
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

// Dibujo libre (Polígono)
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
 * CÍRCULO AUTOMÁTICO
 * Crea un círculo en el centro y activa la edición inmediatamente.
 */
export function startDrawingCircle() {
  stopDrawing();

  // 1. Calcular el centro y un radio seguro en metros
  const center = map.getCenter();

  // Obtenemos el tamaño del contenedor en pixeles
  const mapSize = map.getSize();
  // Tomamos un punto desplazado X pixeles del centro
  const pointC = map.latLngToContainerPoint(center);
  const pointX = L.point(pointC.x + mapSize.x * 0.15, pointC.y); // 15% del ancho

  // Convertimos de nuevo a LatLng para medir distancia real en metros
  const latLngX = map.containerPointToLatLng(pointX);
  const radius = center.distanceTo(latLngX);

  // 2. Crear el Círculo
  const circleLayer = new L.Circle(center, {
    radius: radius,
    color: "#ec4899",
    weight: 3,
    opacity: 0.7,
    fillOpacity: 0.2,
  });

  // 3. Añadirlo al mapa (Esto dispara visualmente la capa)
  drawnItems.clearLayers();
  drawnItems.addLayer(circleLayer);

  // 4. Disparar evento CREATED para que historical.js sepa que hay geocerca
  // Importante: Pasamos el layer creado
  map.fire(L.Draw.Event.CREATED, {
    layer: circleLayer,
    layerType: "circle",
  });

  // 5. Activar edición inmediatamente (con un pequeño delay para asegurar renderizado)
  setTimeout(() => {
    if (circleLayer.editing) {
      circleLayer.editing.enable();
      // Notificar a la UI para que cambie los botones a "Guardar"
      window.dispatchEvent(new CustomEvent("start-editing-geofence"));
    }
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
    // Forzar evento EDITED para actualizar datos
    map.fire(L.Draw.Event.EDITED, {
      layers: L.layerGroup([geofenceLayer]),
    });
  }
}

// === FUNCIONES AUXILIARES DE RENDERIZADO ===
// (Igual que antes)

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
