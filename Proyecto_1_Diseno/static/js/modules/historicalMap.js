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

  map.on(L.Draw.Event.CREATED, function (e) {
    const layer = e.layer;
    drawnItems.clearLayers(); // Solo una geocerca permitida
    drawnItems.addLayer(layer);

    // Al terminar de crear (sea manual o automático), notificamos
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

// Dibujo libre (Polígono manual)
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
 * CAMBIO PRINCIPAL:
 * En lugar de pedirle al usuario que dibuje un círculo,
 * generamos uno automáticamente en el centro de la pantalla
 * y lo convertimos inmediatamente en un polígono editable.
 */
export function startDrawingCircle() {
  stopDrawing();

  // 1. Obtener centro y calcular un radio basado en la vista actual
  const center = map.getCenter();
  const bounds = map.getBounds();
  const mapWidth = bounds.getEast() - bounds.getWest();
  // El radio será aprox el 15% del ancho del mapa para que sea visible y cómodo
  const radiusInDegrees = mapWidth * 0.15;

  // 2. Generar puntos para simular un círculo (Polígono de N vértices)
  // Usamos 20 puntos para que sea redondo pero fácil de editar
  const points = createCirclePolygonCoordinates(
    center.lat,
    center.lng,
    radiusInDegrees,
    20
  );

  // 3. Crear el Polígono
  const circlePolygon = new L.Polygon(points, {
    color: "#ec4899",
    weight: 3,
    opacity: 0.7,
    fillOpacity: 0.2,
  });

  // 4. Agregarlo al mapa como si el usuario lo hubiera dibujado
  drawnItems.clearLayers();
  drawnItems.addLayer(circlePolygon);

  // 5. Disparar manualmente el evento de creación para que la UI se entere
  // Esto activa el modal en modo "Gestionar Geovalla"
  map.fire(L.Draw.Event.CREATED, {
    layer: circlePolygon,
    layerType: "polygon", // Importante: lo tratamos como polígono para que tenga vértices editables
  });

  // 6. Activar la edición inmediatamente para que aparezcan los puntos
  setTimeout(() => {
    enableEditing(circlePolygon);
    // Disparar evento a la UI para indicar que estamos editando
    window.dispatchEvent(new CustomEvent("start-editing-geofence"));
  }, 100);
}

// Función auxiliar para matemáticas de círculo
function createCirclePolygonCoordinates(lat, lng, radiusInDegrees, numPoints) {
  const points = [];
  for (let i = 0; i < numPoints; i++) {
    // Convertir ángulo a radianes
    const angle = ((i * 360) / numPoints) * (Math.PI / 180);

    // Calcular desplazamiento. Nota: Esto es una aproximación plana simple
    // suficiente para UX visual. Para precisión geodésica estricta se usarían librerías,
    // pero para dibujar una geocerca visual esto funciona perfecto.
    const dLat = radiusInDegrees * Math.cos(angle);
    const dLng = radiusInDegrees * Math.sin(angle);

    points.push([lat + dLat, lng + dLng]);
  }
  return points;
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
  // Nota: Mantenemos bounds para recorte rápido de visualización,
  // pero la lógica de filtrado real de datos usa la geometría completa en backend.
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
    // Si tenemos una capa de geocerca (incluso poligonal), usamos su BoundingBox
    // para recortar visualmente las líneas y no saturar el mapa fuera del área.
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
