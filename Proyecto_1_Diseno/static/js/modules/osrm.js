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

export async function generateFullStreetRoute(puntos, progressCallback = null, cancellationToken = { isCancelled: false }) {
    if (puntos.length < 2) {
        return puntos.map(p => [p.lat, p.lon]);
    }
    
    const segmentosRuta = [];
    let rutasExitosas = 0;
    let rutasFallidas = 0;
    const totalSegmentos = puntos.length - 1;

    console.log(`Generando ruta por calles para ${puntos.length} puntos...`);

    for (let i = 0; i < totalSegmentos; i++) {
        if (cancellationToken.isCancelled) {
            console.log("¡Ruta cancelada por el usuario!");
            break;
        }

        if (progressCallback) {
            progressCallback(i + 1, totalSegmentos);
        }

        const [lat1, lon1] = [puntos[i].lat, puntos[i].lon];
        const [lat2, lon2] = [puntos[i+1].lat, puntos[i+1].lon];

        const rutaOSRM = await getOSRMRoute(lat1, lon1, lat2, lon2);
        
        if (rutaOSRM && rutaOSRM.length > 0) {
            if (i === 0) {
                segmentosRuta.push(...rutaOSRM);
            } else {
                segmentosRuta.push(...rutaOSRM.slice(1));
            }
            rutasExitosas++;
        } else {
            if (i === 0) {
                segmentosRuta.push([lat1, lon1]);
            }
            segmentosRuta.push([lat2, lon2]);
            rutasFallidas++;
        }
    }
    
    console.log(`✓ Ruta generada: ${rutasExitosas} segmentos por calles, ${rutasFallidas} líneas rectas`);
    return segmentosRuta;
}