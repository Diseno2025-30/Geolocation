// osrm.js

// osrm.js - CONFIGURACIÓN CORRECTA

// URL de tu servidor OSRM local
const OSRM_SERVER = 'http://localhost:5001';

export async function getOSRMRoute(lat1, lon1, lat2, lon2) {
  try {
    // OSRM espera: longitud,latitud;longitud,latitud
    const coords = `${lon1},${lat1};${lon2},${lat2}`;
    const url = `${OSRM_SERVER}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    
    console.log(`🌐 Consultando OSRM: ${url}`); // DEBUG
    
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`⚠️ OSRM HTTP error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    console.log(`📦 OSRM response:`, data); // DEBUG
    
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const coordinates = data.routes[0].geometry.coordinates;
      // OSRM retorna [lon, lat], convertir a [lat, lon] para Leaflet
      const converted = coordinates.map(coord => [coord[1], coord[0]]);
      console.log(`✅ Snap to road: ${converted.length} puntos`); // DEBUG
      return converted;
    }
    
    console.warn(`⚠️ OSRM no encontró ruta`);
    return null;
  } catch (error) {
    console.error('❌ Error en getOSRMRoute:', error);
    return null;
  }
}

export async function generateFullStreetRoute(
  puntos,
  progressCallback = null,
  onSegmentRenderedCallback = null
) {
  if (puntos.length < 2 || !onSegmentRenderedCallback) {
    return;
  }

  const totalSegmentos = puntos.length - 1;
  console.log(`Generando ruta por calles para ${puntos.length} puntos...`);

  const BATCH_SIZE = 10;
  let progress = 0;

  for (let i = 0; i < totalSegmentos; i += BATCH_SIZE) {
    const batchPromises = [];
    const batchEnd = Math.min(i + BATCH_SIZE, totalSegmentos);

    for (let j = i; j < batchEnd; j++) {
      const lat1 = puntos[j].lat;
      const lon1 = puntos[j].lon;
      const lat2 = puntos[j + 1].lat;
      const lon2 = puntos[j + 1].lon;

      const promise = getOSRMRoute(lat1, lon1, lat2, lon2).then((rutaOSRM) => {
        if (rutaOSRM && rutaOSRM.length > 0) {
          onSegmentRenderedCallback(rutaOSRM);
        } else {
          // Fallback: línea recta
          onSegmentRenderedCallback([
            [lat1, lon1],
            [lat2, lon2],
          ]);
        }

        progress++;
        if (progressCallback) {
          progressCallback(progress, totalSegmentos);
        }
      });
      batchPromises.push(promise);
    }

    await Promise.all(batchPromises);
  }

  console.log(`✓ Generación de ruta finalizada.`);
}