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
  
  map.on('click', function(e) {
        console.log("🔴 CLICK SIMPLE DE DEBUG EN:", e.latlng);
    });
    
  console.log('✓ Mapa de rutas inicializado');
}

export function enableSegmentSelection(onSegmentSelected) {
    console.log("🔵 enableSegmentSelection llamado");
    console.log("🔵 Mapa actual:", map);
    console.log("🔵 ¿Mapa existe?:", !!map);
    console.log("🔵 Event listeners antes:", clickListeners.length);
    
    // Deshabilitar cualquier listener anterior
    disableSegmentSelection();
    console.log("🔵 Event listeners después de disable:", clickListeners.length);
    
    // Verificar que el mapa todavía existe
    if (!map) {
        console.error("❌ ERROR: El mapa es null/undefined después de disableSelection");
        return;
    }
    
    // Agregar nuevo listener para clicks
    const clickHandler = async (e) => {
        console.log("🟣 CLICK EN EL MAPA DETECTADO en:", e.latlng);
        console.log("🟣 Coordenadas:", e.latlng.lat, e.latlng.lng);
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        
        try {
            console.log("🟠 Obteniendo segmento para:", lat, lng);
            const segment = await getSegmentFromClick(lat, lng);
            console.log("🟢 Segmento obtenido:", segment);
            if (segment && onSegmentSelected) {
                console.log("🎯 Ejecutando callback con segmento");
                onSegmentSelected(segment);
            } else {
                console.warn("⚠️ No hay segmento o callback");
            }
        } catch (error) {
            console.error('❌ Error obteniendo segmento:', error);
            alert('No se pudo obtener información de la calle en esta ubicación.');
        }
    };
    
    console.log("🔵 Agregando event listener al mapa...");
    map.on('click', clickHandler);
    clickListeners.push({ event: 'click', handler: clickHandler });
    console.log("🔵 Event listeners después de agregar:", clickListeners.length);
    
    // Verificar que el listener se agregó
    console.log("🔵 ¿Tiene eventos click?:", map._events && map._events.click);
    
    // Cambiar cursor para indicar modo selección
    if (map.getContainer()) {
        map.getContainer().style.cursor = 'crosshair';
        console.log("🎯 Cursor cambiado a crosshair");
    } else {
        console.error("❌ No se puede cambiar cursor: getContainer() es null");
    }
    
    console.log('✅ enableSegmentSelection completado');
}

export function disableSegmentSelection() {
    console.log("🟡 disableSegmentSelection llamado");
    console.log("🟡 Event listeners a remover:", clickListeners.length);
    
    // Remover todos los listeners
    clickListeners.forEach((listener, index) => {
        console.log(`🟡 Removiendo listener ${index}:`, listener.event);
        if (map) {
            map.off(listener.event, listener.handler);
        }
    });
    clickListeners = [];
    
    // Restaurar cursor normal
    if (map && map.getContainer()) {
        map.getContainer().style.cursor = '';
        console.log("🟡 Cursor restaurado");
    }
    
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
    console.log("🌐 Llamando API para obtener segmento...");
    const basePath = window.getBasePath ? window.getBasePath() : '';
    const url = `${basePath}/api/segment/from-coords?lat=${lat}&lon=${lng}`;
    console.log("🌐 URL:", url);
    
    try {
        const response = await fetch(url);
        console.log("🌐 Respuesta HTTP:", response.status, response.statusText);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log("🌐 Datos recibidos:", data);
        
        if (data.success) {
            const segmento = {
                ...data.segment,
                original_lat: data.original_coords.lat,
                original_lon: data.original_coords.lon,
                snapped_lat: data.snapped_coords.lat,
                snapped_lon: data.snapped_coords.lon
            };
            console.log("🌐 Segmento procesado:", segmento);
            return segmento;
        } else {
            throw new Error(data.error || 'No se pudo obtener el segmento');
        }
    } catch (error) {
        console.error('❌ Error en getSegmentFromClick:', error);
        throw error;
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