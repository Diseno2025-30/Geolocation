let map;
let drawnItems;
let polylinesHistoricas = [];
let marcadoresHistoricos = [];
let marcadoresVisibles = true;
// Handler for current drawing tool
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

  // No añadimos la toolbar estándar, usamos botones propios

  map.on(L.Draw.Event.CREATED, function (e) {
    const layer = e.layer;
    drawnItems.clearLayers(); // Solo una geocerca permitida
    drawnItems.addLayer(layer);
    onCreate(layer);
    stopDrawing(); // Desactivar herramienta tras crear
  });

  map.on(L.Draw.Event.EDITED, function (e) {
    const layers = e.layers;
    layers.eachLayer(function (layer) {
      onEdit(layer);
    });
  });

  map.on(L.Draw.Event.DELETED, function () {
    // onDelete(); // Manejado por UI
  });
}

// === NUEVOS CONTROLES DE DIBUJO ===

function stopDrawing() {
  if (currentDrawer) {
    currentDrawer.disable();
    currentDrawer = null;
  }
}

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

export function startDrawingCircle() {
  stopDrawing();

  currentDrawer = new L.Draw.Circle(map, {
    shapeOptions: {
      color: "#ec4899", // Diferente color para círculo
      weight: 3,
      opacity: 0.7,
      fillOpacity: 0.2,
    },
    showRadius: true,
  });

  currentDrawer.enable();
}

export function enableEditing(geofenceLayer) {
  if (geofenceLayer && geofenceLayer.editing) {
    geofenceLayer.editing.enable();
  }
}

export function disableEditing(geofenceLayer) {
  if (geofenceLayer && geofenceLayer.editing) {
    geofenceLayer.editing.disable();
    // Disparar evento manualmente para guardar
    map.fire(L.Draw.Event.EDITED, {
      layers: L.layerGroup([geofenceLayer]),
    });
  }
}

// === Funciones Auxiliares ===

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
    // Nota: clipPolyline usa Bounds (rectángulo).
    // Para polígonos/círculos complejos, se recomienda usar turf.js o una lógica más avanzada de intersección.
    // Por simplicidad mantenemos bounds, pero lo ideal es usar geofenceLayer.contains(latlng).

    // Mejor aproximación si es círculo o polígono irregular:
    // Validar punto a punto si está dentro.

    const segments = [];
    let currentSegment = [];

    for (let i = 0; i < segmentoCoords.length; i++) {
      const pt = L.latLng(segmentoCoords[i][0], segmentoCoords[i][1]);

      // Verificación polimórfica (funciona para Rect, Circle, Polygon)
      let contains = false;
      if (geofenceLayer instanceof L.Circle) {
        contains =
          pt.distanceTo(geofenceLayer.getLatLng()) <= geofenceLayer.getRadius();
      } else if (
        geofenceLayer instanceof L.Polygon ||
        geofenceLayer instanceof L.Rectangle
      ) {
        contains = geofenceLayer.getBounds().contains(pt); // Simplificación (Bounds)
        // Para precisión exacta en polígonos irregulares se requiere 'ray casting'
      } else {
        contains = geofenceLayer.getBounds().contains(pt);
      }

      if (contains) {
        currentSegment.push(segmentoCoords[i]);
      } else {
        if (currentSegment.length > 0) {
          segments.push(currentSegment);
          currentSegment = [];
        }
      }
    }
    if (currentSegment.length > 0) segments.push(currentSegment);

    segments.forEach((segment) => {
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

  marcadoresHistoricos.forEach((marker) => map.removeLayer(marker));
  marcadoresHistoricos = [];

  stopDrawing(); // Detener cualquier herramienta activa

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
