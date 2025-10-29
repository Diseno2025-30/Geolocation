export async function getOSRMRoute(lat1, lon1, lat2, lon2) {
    try {
        const url = `/test/osrm/route/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
        const response = await fetch(url);
        
        if (!response.ok) {
            console.warn(`OSRM route not available (${response.status}), using straight line`);
            return null;
        }
        
        const data = await response.json();
        
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            return data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
        }
        
        console.warn('OSRM no encontró ruta, usando línea recta');
        return null;
    } catch (error) {
        console.error('Error obteniendo ruta de OSRM:', error);
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
    console.log(`Generando ruta por calles para ${puntos.length} puntos (en lotes)...`);

    const BATCH_SIZE = 10;
    let progress = 0;

    for (let i = 0; i < totalSegmentos; i += BATCH_SIZE) {
        const batchPromises = [];
        const batchEnd = Math.min(i + BATCH_SIZE, totalSegmentos);

        for (let j = i; j < batchEnd; j++) {
            const [lat1, lon1] = [puntos[j].lat, puntos[j].lon];
            const [lat2, lon2] = [puntos[j+1].lat, puntos[j+1].lon];
            
            const promise = getOSRMRoute(lat1, lon1, lat2, lon2)
                .then(rutaOSRM => {                    
                    if (rutaOSRM && rutaOSRM.length > 0) {
                        onSegmentRenderedCallback(rutaOSRM);
                    } else {
                        onSegmentRenderedCallback([[lat1, lon1], [lat2, lon2]]);
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