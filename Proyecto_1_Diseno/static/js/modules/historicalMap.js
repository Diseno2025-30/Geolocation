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
  const center = map.getCenter();
  const bounds = map.getBounds();
  const pointC = map.latLngToContainerPoint(center);
  const mapSize = map.getSize();
  // Radio dinámico: 25% del ancho del mapa
  const pointX = L.point(pointC.x + mapSize.x * 0.25, pointC.y);
  const latLngX = map.containerPointToLatLng(pointX);
  const radius = center.distanceTo(latLngX);

  const circleLayer = new L.Circle(center, {
    radius: radius,
    color: "#ec4899",
    weight: 3,
    opacity: 0.7,
    fillOpacity: 0.2,
  });

  drawnItems.clearLayers();
  drawnItems.addLayer(circleLayer);

  map.fire(L.Draw.Event.CREATED, {
    layer: circleLayer,
    layerType: "circle",
  });
}

export function enableEditing(geofenceLayer) {
  if (geofenceLayer && geofenceLayer.editing) {
    geofenceLayer.editing.enable();
  }
}

export function disableEditing(geofenceLayer) {
  if (geofenceLayer && geofenceLayer.editing) {
    geofenceLayer.editing.disable();
    map.fire(L.Draw.Event.EDITED, {
      layers: L.layerGroup([geofenceLayer]),
    });
  }
}

// === LÓGICA DE FILTRADO ESTRICTO (Ray Casting y Distancia) ===

/**
 * Verifica si un punto (lat, lon) está matemáticamente dentro de la capa.
 * Soluciona el problema de los puntos fuera del polígono pero dentro del rectángulo.
 */
export function isPointInsideGeofence(lat, lng, layer) {
  if (!layer) return true; // Si no hay geocerca, todo es válido

  const point = L.latLng(lat, lng);

  // 1. Caso CÍRCULO
  if (layer instanceof L.Circle) {
    return point.distanceTo(layer.getLatLng()) <= layer.getRadius();
  }

  // 2. Caso POLÍGONO o RECTÁNGULO
  if (layer instanceof L.Polygon || layer instanceof L.Rectangle) {
    // Algoritmo Ray Casting
    const polyPoints = layer.getLatLngs()[0]; // Asumimos polígono simple sin agujeros
    let x = lat,
      y = lng;

    let inside = false;
    for (let i = 0, j = polyPoints.length - 1; i < polyPoints.length; j = i++) {
      let xi = polyPoints[i].lat,
        yi = polyPoints[i].lng;
      let xj = polyPoints[j].lat,
        yj = polyPoints[j].lng;

      let intersect =
        yi > y != yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Fallback: usar bounds si es otro tipo de capa desconocido
  return layer.getBounds().contains(point);
}

// === RENDERIZADO ===

export function dibujarPuntosEnMapa(datosFiltrados) {
  marcadoresHistoricos.forEach((marker) => map.removeLayer(marker));
  marcadoresHistoricos = [];

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
  const uniquePoints = Array.from(puntosAgrupados.values());

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

  if (!marcadoresVisibles) toggleMarkers();
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
  )
    return;

  if (geofenceLayer) {
    // FILTRADO VISUAL ESTRICTO
    const segments = [];
    let currentSegment = [];

    for (let i = 0; i < segmentoCoords.length; i++) {
      // Usamos la nueva función de verificación estricta
      if (
        isPointInsideGeofence(
          segmentoCoords[i][0],
          segmentoCoords[i][1],
          geofenceLayer
        )
      ) {
        currentSegment.push(segmentoCoords[i]);
      } else {
        // Si el punto sale de la geocerca, cortamos la línea
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
  clearMarkers();
  stopDrawing();
  if (!preserveGeofence) {
    if (drawnItems) drawnItems.clearLayers();
  }
}

export function removeGeofence(geofenceLayer) {
  if (geofenceLayer && drawnItems) drawnItems.removeLayer(geofenceLayer);
}

export function toggleMarkers() {
  marcadoresVisibles = !marcadoresVisibles;
  const toggleText = document.getElementById("toggleMarcadoresText");
  marcadoresHistoricos.forEach((marker) => {
    if (marcadoresVisibles) map.addLayer(marker);
    else map.removeLayer(marker);
  });
  if (toggleText)
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
