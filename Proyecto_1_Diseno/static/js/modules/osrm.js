export async function getOSRMRoute(lat1, lon1, lat2, lon2) {
  try {
    const coords = `${lon1},${lat1};${lon2},${lat2}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`OSRM error: ${response.status}`);
      return null; // CORRECCIÓN: Retornar null en vez de undefined
    }
    
    const data = await response.json();
    
    if (data.routes && data.routes.length > 0) {
      const coordinates = data.routes[0].geometry.coordinates;
      // Convertir de [lon, lat] a [lat, lon]
      return coordinates.map(coord => [coord[1], coord[0]]);
    }
    
    return null; // CORRECCIÓN: Retornar null si no hay rutas
  } catch (error) {
    console.error('Error en getOSRMRoute:', error);
    return null; // CORRECCIÓN: Retornar null en caso de error
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
  console.log(
    `Generando ruta por calles para ${puntos.length} puntos (en lotes)...`
  );

  const BATCH_SIZE = 10;
  let progress = 0;

  for (let i = 0; i < totalSegmentos; i += BATCH_SIZE) {
    const batchPromises = [];
    const batchEnd = Math.min(i + BATCH_SIZE, totalSegmentos);

    for (let j = i; j < batchEnd; j++) {
      const [lat1, lon1] = [puntos[j].lat, puntos[j].lon];
      const [lat2, lon2] = [puntos[j + 1].lat, puntos[j + 1].lon];

      const promise = getOSRMRoute(lat1, lon1, lat2, lon2).then((rutaOSRM) => {
        if (rutaOSRM && rutaOSRM.length > 0) {
          onSegmentRenderedCallback(rutaOSRM);
        } else {
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
