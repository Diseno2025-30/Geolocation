// static/js/modules/rutasMap.js

let map;
let currentRutaLayer = null;
let clickListeners = [];
let selectedSegments = [];
let segmentMarkers = [];

export function initializeMap() {
  map = L.map('map').setView([11.0, -74.8], 13);
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  
  console.log('✓ Mapa de rutas inicializado');
}

export function enableSegmentSelection(onSegmentSelected) {
  // Deshabilitar cualquier listener anterior
  disableSegmentSelection();
  
  // Agregar nuevo listener para clicks
  const clickHandler = async (e) => {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    
    try {
      const segment = await getSegmentFromClick(lat, lng);
      if (segment && onSegmentSelected) {
        onSegmentSelected(segment);
      }
    } catch (error) {
      console.error('Error obteniendo segmento:', error);
      alert('No se pudo obtener información de la calle en esta ubicación.');
    }
  };
  
  map.on('click', clickHandler);
  clickListeners.push({ event: 'click', handler: clickHandler });
  
  // Cambiar cursor para indicar modo selección
  map.getContainer().style.cursor = 'crosshair';
  console.log('✓ Modo selección de segmentos activado');
}

export function disableSegmentSelection() {
  // Remover todos los listeners
  clickListeners.forEach(listener => {
    map.off(listener.event, listener.handler);
  });
  clickListeners = [];
  
  // Restaurar cursor normal
  map.getContainer().style.cursor = '';
  console.log('✓ Modo selección de segmentos desactivado');
}

export function clearMap() {
  if (!map) return;
  
  if (currentRutaLayer) {
    map.removeLayer(currentRutaLayer);
    currentRutaLayer = null;
  }
  
  // Limpiar marcadores de segmentos seleccionados
  clearSegmentMarkers();
  selectedSegments = [];
}

export function clearSegmentMarkers() {
  segmentMarkers.forEach(marker => {
    if (marker && map) {
      map.removeLayer(marker);
    }
  });
  segmentMarkers = [];
  selectedSegments = [];
}

export function getSelectedSegments() {
  return [...selectedSegments];
}

export function addSegmentMarker(segment, index) {
  if (!map) return null;
  
  // Asegurarnos de que el índice sea válido
  if (index < 0) {
    index = segmentMarkers.length;
  }
  
  const marker = L.marker([segment.snapped_lat, segment.snapped_lon], {
    icon: L.divIcon({
      className: 'segment-marker',
      html: `
        <div style="
          background: #3b82f6;
          color: white;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 3px solid white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 12px;
        ">${index + 1}</div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    })
  }).addTo(map);
  
  marker.bindPopup(`
    <div style="font-family: Arial, sans-serif; min-width: 200px;">
      <strong style="color: #3b82f6;">Segmento #${index + 1}</strong><br>
      <hr style="margin: 5px 0;">
      <strong>Calle:</strong> ${segment.street_name}<br>
      <strong>ID:</strong> ${segment.segment_id}<br>
      <strong>Coordenadas:</strong><br>
      ${segment.snapped_lat.toFixed(6)}, ${segment.snapped_lon.toFixed(6)}
    </div>
  `);
  
  // Insertar en la posición correcta
  segmentMarkers[index] = marker;
  selectedSegments[index] = segment;
  
  return marker;
}

export function drawRutaSegments(segments) {
  clearMap();
  
  if (!segments || segments.length === 0) return;
  
  // Dibujar marcadores
  segments.forEach((segment, index) => {
    addSegmentMarker(segment, index);
  });
  
  // Conectar los puntos con líneas
  const latlngs = segments.map(s => [s.snapped_lat, s.snapped_lon]);
  
  currentRutaLayer = L.polyline(latlngs, {
    color: '#3b82f6',
    weight: 4,
    opacity: 0.8,
    lineJoin: 'round',
    lineCap: 'round'
  }).addTo(map);
  
  // Ajustar vista para mostrar toda la ruta
  map.fitBounds(currentRutaLayer.getBounds(), { padding: [50, 50] });
  
  console.log(`✓ Ruta dibujada con ${segments.length} segmentos`);
}

export function getMap() {
  return map;
}

// Función auxiliar para obtener segmento desde coordenadas
async function getSegmentFromClick(lat, lng) {
  const basePath = window.getBasePath ? window.getBasePath() : '';
  
  const response = await fetch(`${basePath}/api/segment/from-coords?lat=${lat}&lon=${lng}`);
  const data = await response.json();
  
  if (data.success) {
    return {
      ...data.segment,
      original_lat: data.original_coords.lat,
      original_lon: data.original_coords.lon,
      snapped_lat: data.snapped_coords.lat,
      snapped_lon: data.snapped_coords.lon
    };
  } else {
    throw new Error(data.error || 'No se pudo obtener el segmento');
  }
}

export function getSegmentMarkers() {
  return [...segmentMarkers];
}

export function getSelectedSegmentsArray() {
  return [...selectedSegments];
}

export function removeSegmentByIndex(index) {
  if (index >= 0 && index < selectedSegments.length) {
    // Remover el marcador del mapa
    if (segmentMarkers[index]) {
      map.removeLayer(segmentMarkers[index]);
    }
    
    // Remover de los arrays
    selectedSegments.splice(index, 1);
    segmentMarkers.splice(index, 1);
    
    // Reindexar marcadores restantes
    segmentMarkers.forEach((marker, newIndex) => {
      if (marker) {
        marker.setIcon(L.divIcon({
          className: 'segment-marker',
          html: `
            <div style="
              background: #3b82f6;
              color: white;
              width: 28px;
              height: 28px;
              border-radius: 50%;
              border: 3px solid white;
              box-shadow: 0 2px 4px rgba(0,0,0,0.3);
              display: flex;
              align-items: center;
              justify-content: center;
              font-weight: bold;
              font-size: 12px;
            ">${newIndex + 1}</div>
          `,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        }));
        
        // Actualizar popup con nuevo índice si hay segmento correspondiente
        if (selectedSegments[newIndex]) {
          const segment = selectedSegments[newIndex];
          marker.bindPopup(`
            <div style="font-family: Arial, sans-serif; min-width: 200px;">
              <strong style="color: #3b82f6;">Segmento #${newIndex + 1}</strong><br>
              <hr style="margin: 5px 0;">
              <strong>Calle:</strong> ${segment.street_name}<br>
              <strong>ID:</strong> ${segment.segment_id}<br>
              <strong>Coordenadas:</strong><br>
              ${segment.snapped_lat.toFixed(6)}, ${segment.snapped_lon.toFixed(6)}
            </div>
          `);
        }
      }
    });
    
    return true;
  }
  return false;
}

// Función para actualizar todos los índices (útil para reordenar)
export function updateSegmentIndexes() {
  segmentMarkers.forEach((marker, index) => {
    if (marker) {
      marker.setIcon(L.divIcon({
        className: 'segment-marker',
        html: `
          <div style="
            background: #3b82f6;
            color: white;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 12px;
          ">${index + 1}</div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      }));
      
      if (selectedSegments[index]) {
        const segment = selectedSegments[index];
        marker.bindPopup(`
          <div style="font-family: Arial, sans-serif; min-width: 200px;">
            <strong style="color: #3b82f6;">Segmento #${index + 1}</strong><br>
            <hr style="margin: 5px 0;">
            <strong>Calle:</strong> ${segment.street_name}<br>
            <strong>ID:</strong> ${segment.segment_id}<br>
            <strong>Coordenadas:</strong><br>
            ${segment.snapped_lat.toFixed(6)}, ${segment.snapped_lon.toFixed(6)}
          </div>
        `);
      }
    }
  });
}