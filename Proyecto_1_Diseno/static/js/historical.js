let map;
let polylineHistorica = null;
let polylinesHistoricas = []; // Para los segmentos de ruta recortados
let marcadoresHistoricos = [];
let marcadoresVisibles = true;
let datosHistoricos = [];
let datosHistoricosOriginales = [];
let geofenceLayer = null;
let drawnItems;

// 1. VARIABLE GLOBAL PARA CANCELAR (RESTAURADA)
let isRouteGenerationCancelled = false;

const lastQueryElement = document.getElementById('lastQuery');
const puntosHistoricosElement = document.getElementById('puntosHistoricos');
const rangoConsultadoElement = document.getElementById('rangoConsultado');
const diasIncluidosElement = document.getElementById('diasIncluidos');
const puntoInicialElement = document.getElementById('puntoInicial');
const puntoFinalElement = document.getElementById('puntoFinal');
const distanciaTotalElement = document.getElementById('distanciaTotal');
const duracionElement = document.getElementById('duracion');

function initializeMap() {
    map = L.map('map').setView([11.0, -74.8], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    drawnItems = new L.FeatureGroup().addTo(map);

    const drawControl = new L.Control.Draw({
        edit: {
            featureGroup: drawnItems,
            remove: true
        },
        draw: {
            polygon: false,
            polyline: false,
            circle: false,
            circlemarker: false,
            marker: false,
            rectangle: {
                shapeOptions: {
                    color: '#3b82f6',
                    weight: 3,
                    opacity: 0.7
                }
            }
        }
    });
    map.addControl(drawControl);


    map.on(L.Draw.Event.CREATED, function (e) {
        if (geofenceLayer) {
            drawnItems.removeLayer(geofenceLayer);
        }
        geofenceLayer = e.layer;
        drawnItems.addLayer(geofenceLayer);

        if (datosHistoricosOriginales.length > 0) {
            console.log("Filtrando datos locales por geocerca");
            aplicarFiltroGeocerca(); // Ahora es async
        } else {
            console.log("Consultando al servidor por geocerca");
            fetchDatosPorGeocerca(geofenceLayer.getBounds());
        }
    });

    map.on(L.Draw.Event.EDITED, function (e) {
        geofenceLayer = e.layers.getLayers()[0];
        if (datosHistoricosOriginales.length > 0) {
            aplicarFiltroGeocerca(); // Ahora es async
        } else {
            fetchDatosPorGeocerca(geofenceLayer.getBounds());
        }
    });

    map.on(L.Draw.Event.DELETED, function () {
        geofenceLayer = null;
        aplicarFiltroGeocerca(); // Ahora es async
    });

}

/**
 * Recorta una polilínea (array de coords [lat, lon]) contra un L.LatLngBounds.
 * Devuelve un array de segmentos (arrays de coords) que están DENTRO.
 * Versión Reforzada con validaciones y try-catch.
 */
function clipPolyline(coordinates, bounds) {
    const segments = [];
    if (!coordinates || coordinates.length < 1 || !bounds || !(bounds instanceof L.LatLngBounds)) {
        console.warn("clipPolyline: Coordenadas o bounds inválidos recibidos.");
        return segments;
    }

    let currentSegment = [];
    let firstPointLatLng = null;

    // Validar y procesar el primer punto
    try {
        if (!coordinates[0] || !Array.isArray(coordinates[0]) || coordinates[0].length < 2 || typeof coordinates[0][0] !== 'number' || typeof coordinates[0][1] !== 'number') {
            throw new Error("Primer punto inválido o mal formado");
        }
        firstPointLatLng = L.latLng(coordinates[0][0], coordinates[0][1]);
        if (isNaN(firstPointLatLng.lat) || isNaN(firstPointLatLng.lng)) {
             throw new Error("Primer punto LatLng es NaN");
        }
    } catch(e) {
        console.warn("clipPolyline: Ignorando primer punto inválido:", coordinates[0], e.message);
        firstPointLatLng = null; // Marcar como inválido para la lógica 'wasInside'
    }

    let wasInside = firstPointLatLng ? bounds.contains(firstPointLatLng) : false;

    if (wasInside && firstPointLatLng) { // Solo añadir si es válido y está dentro
        currentSegment.push(coordinates[0]);
    }

    for (let i = 1; i < coordinates.length; i++) {
        let p1LatLng = null;
        let p2LatLng = null;

        // Validar puntos del segmento actual
        try {
            // Validar punto anterior (ahora p1)
             if (!coordinates[i-1] || !Array.isArray(coordinates[i-1]) || coordinates[i-1].length < 2 || typeof coordinates[i-1][0] !== 'number' || typeof coordinates[i-1][1] !== 'number') {
                 throw new Error(`Punto anterior (índice ${i-1}) inválido o mal formado`);
            }
             p1LatLng = L.latLng(coordinates[i-1][0], coordinates[i-1][1]);
             if (isNaN(p1LatLng.lat) || isNaN(p1LatLng.lng)) {
                  throw new Error(`Punto anterior LatLng (índice ${i-1}) es NaN`);
             }

             // Validar punto actual (ahora p2)
             if (!coordinates[i] || !Array.isArray(coordinates[i]) || coordinates[i].length < 2 || typeof coordinates[i][0] !== 'number' || typeof coordinates[i][1] !== 'number') {
                 throw new Error(`Punto actual (índice ${i}) inválido o mal formado`);
            }
            p2LatLng = L.latLng(coordinates[i][0], coordinates[i][1]);
            if (isNaN(p2LatLng.lat) || isNaN(p2LatLng.lng)) {
                 throw new Error(`Punto actual LatLng (índice ${i}) es NaN`);
            }

        } catch(e) {
            console.warn(`clipPolyline: Ignorando segmento ${i-1}-${i} debido a punto inválido:`, e.message, coordinates[i-1], coordinates[i]);
            // Si un punto es inválido, no podemos procesar este segmento.
            // Rompemos el segmento actual y evaluamos el siguiente punto como si fuera el inicio.
            if (currentSegment.length > 1) { segments.push(currentSegment); }
            currentSegment = [];
            wasInside = false; // Asumir que estamos fuera hasta encontrar un punto válido dentro
            continue; // Saltar al siguiente segmento
        }

        const isInside = bounds.contains(p2LatLng);
        let intersectionPointCoord = null; // Guardará [lat, lng]

        // Intentar calcular la intersección si cruzamos el borde
        if (isInside !== wasInside) {
             try {
                 // Usamos L.LineUtil.clipSegment directamente con LatLng
                 const intersectionResult = L.LineUtil.clipSegment(p1LatLng, p2LatLng, bounds, false); // No pasar 'true'

                 if (intersectionResult && intersectionResult.length > 0 && intersectionResult[0]) {
                     // **NUEVA VALIDACIÓN AQUÍ**
                     // Asegurarse que el resultado es un L.Point válido antes de convertir
                     if (intersectionResult[0] instanceof L.Point && typeof intersectionResult[0].x === 'number' && typeof intersectionResult[0].y === 'number') {
                        const intersectionLatLng = map.layerPointToLatLng(intersectionResult[0]);
                        // Validar también el resultado de la conversión
                        if (intersectionLatLng && typeof intersectionLatLng.lat === 'number' && typeof intersectionLatLng.lng === 'number' && !isNaN(intersectionLatLng.lat) && !isNaN(intersectionLatLng.lng)) {
                            intersectionPointCoord = [intersectionLatLng.lat, intersectionLatLng.lng];
                        } else {
                            console.warn(`clipPolyline: No se pudo convertir el punto de intersección a LatLng válido en segmento ${i-1}-${i}. Resultado:`, intersectionLatLng);
                        }
                     } else {
                         console.warn(`clipPolyline: Resultado de clipSegment no fue un L.Point válido en segmento ${i-1}-${i}. Resultado:`, intersectionResult[0]);
                     }
                 } else {
                     //console.log(`clipPolyline: No se encontró intersección para segmento ${i-1}-${i}`); // Log opcional
                 }
             } catch (clipError) {
                 // Si L.LineUtil.clipSegment falla (el error 'x'), lo capturamos aquí
                 console.error(`Error en L.LineUtil.clipSegment para segmento ${i-1}-${i}:`, clipError, "Puntos:", p1LatLng, p2LatLng);
                 // No hacemos nada con intersectionPointCoord, se quedará null
             }
        }


        // Lógica de construcción de segmentos (igual que antes)
        if (isInside && wasInside) {
            currentSegment.push(coordinates[i]);
        } else if (isInside && !wasInside) {
            // Entró al rectángulo
            if (intersectionPointCoord) {
                 currentSegment = [intersectionPointCoord];
            } else {
                 currentSegment = [coordinates[i]];
                 console.warn(`Segmento ${i-1}-${i}: Entró a bounds pero falló/no hubo intersección. Iniciando segmento solo con punto actual.`);
            }
             currentSegment.push(coordinates[i]);
        } else if (!isInside && wasInside) {
            // Salió del rectángulo
            if (intersectionPointCoord) {
                currentSegment.push(intersectionPointCoord);
            } else {
                 console.warn(`Segmento ${i-1}-${i}: Salió de bounds pero falló/no hubo intersección. Terminando segmento en punto anterior.`);
            }
             if (currentSegment.length > 1) {
                segments.push(currentSegment);
             }
             currentSegment = [];
        }

        wasInside = isInside;
    }

    // Guardar el último segmento si era válido y terminaba dentro
    if (currentSegment.length > 1) {
        segments.push(currentSegment);
    }

    return segments;
}

// Funciones calcularDistancia y parseTimestamp (sin cambios)
function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distancia en km
}
function parseTimestamp(timestamp) {
    // Asume formato DD/MM/YYYY HH:MM:SS
    const [datePart, timePart] = timestamp.split(' ');
    if (!datePart || !timePart) return new Date(NaN); // Manejo de formato inválido
    const [day, month, year] = datePart.split('/');
    // Validar partes numéricas
    if (isNaN(parseInt(day)) || isNaN(parseInt(month)) || isNaN(parseInt(year)) || !timePart.includes(':')) {
        return new Date(NaN);
    }
    return new Date(`${year}-${month}-${day}T${timePart}`);
}


function filtrarPorRangoCompleto(datos, fechaInicio, horaInicio, fechaFin, horaFin) {
    if (!fechaInicio || !fechaFin) return datos; // Si no hay fechas, devolver todo

    // Asegurar horas por defecto si no se proporcionan
    const inicioStr = `${fechaInicio}T${horaInicio || '00:00'}:00`;
    const finStr = `${fechaFin}T${horaFin || '23:59'}:59`;

    let fechaHoraInicio, fechaHoraFin;
    try {
        fechaHoraInicio = new Date(inicioStr);
        fechaHoraFin = new Date(finStr);
        if (isNaN(fechaHoraInicio) || isNaN(fechaHoraFin)) throw new Error("Fecha inválida");
    } catch (e) {
        console.error("Error parseando fechas/horas para filtro:", inicioStr, finStr, e);
        return datos; // Devolver todo si hay error
    }


    return datos.filter(punto => {
        const fechaPunto = parseTimestamp(punto.timestamp);
        // Ignorar puntos con fecha inválida en el filtro
        return !isNaN(fechaPunto) && fechaPunto >= fechaHoraInicio && fechaPunto <= fechaHoraFin;
    });
}

// ========== FUNCIONES OSRM FRONTEND (RESTAURADAS) ==========
async function obtenerRutaOSRM(lat1, lon1, lat2, lon2) {
    try {
        const basePath = window.getBasePath ? window.getBasePath() : '';
        const url = `${basePath}/osrm/route/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;

        const response = await fetch(url);

        if (!response.ok) {
            console.warn(`OSRM route not available (${response.status}), using straight line`);
            return null; // Devolver null para indicar fallo
        }

        const data = await response.json();

        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            // OSRM devuelve [lon, lat], convertir a [lat, lon]
            const coordinates = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
            return coordinates;
        }

        console.warn('OSRM no encontró ruta, usando línea recta');
        return null; // Devolver null para indicar fallo
    } catch (error) {
        console.error('Error obteniendo ruta de OSRM:', error);
        return null; // Devolver null en caso de error
    }
}

async function generarRutaPorCalles(puntos) {
    if (puntos.length < 2) {
        // Si hay menos de 2 puntos, devolvemos sus coordenadas directamente
        return puntos.map(p => [p.lat, p.lon]);
    }

    // 1. RESETEAMOS LA BANDERA DE CANCELACIÓN
    isRouteGenerationCancelled = false;

    // Mostrar indicador de carga
    const loadingOverlay = document.getElementById('loadingOverlay');
    const progressBar = document.getElementById('routeProgressBar');
    const progressText = document.getElementById('routeProgressText');

    if (loadingOverlay) {
        // Resetear progreso
        if(progressBar) progressBar.style.width = '0%';
        if(progressText) progressText.textContent = '0 / 0 segmentos';
        loadingOverlay.classList.add('active');
    }

    const rutaCompleta = [];
    let rutasExitosasOSRM = 0;
    let rutasFallidasOSRM = 0;
    const totalSegmentos = puntos.length - 1;

    console.log(`Generando ruta OSRM para ${puntos.length} puntos...`);

    for (let i = 0; i < puntos.length - 1; i++) {

        // 1. COMPROBAMOS SI EL USUARIO CANCELÓ
        if (isRouteGenerationCancelled) {
            console.log("¡Generación de ruta cancelada por el usuario!");
            // Añadir el último punto procesado para que la línea llegue hasta ahí
            if (i > 0 && puntos[i] && typeof puntos[i].lat === 'number' && typeof puntos[i].lon === 'number') {
                rutaCompleta.push([puntos[i].lat, puntos[i].lon]);
            }
            break; // Salir del bucle
        }

        const p1 = puntos[i];
        const p2 = puntos[i+1];

        // Validar puntos antes de llamar a OSRM
        if (!p1 || !p2 || typeof p1.lat !== 'number' || typeof p1.lon !== 'number' || typeof p2.lat !== 'number' || typeof p2.lon !== 'number') {
            console.warn(`Saltando segmento ${i}-${i+1} por puntos inválidos:`, p1, p2);
            continue; // Saltar al siguiente segmento
        }

        // Actualizar progreso
        const progreso = Math.round(((i + 1) / totalSegmentos) * 100);
        if (progressBar) {
            progressBar.style.width = `${progreso}%`;
        }
        if (progressText) {
            progressText.textContent = `${i + 1} / ${totalSegmentos} segmentos`;
        }

        // Intentar obtener ruta OSRM entre p1 y p2
        const segmentoOSRM = await obtenerRutaOSRM(p1.lat, p1.lon, p2.lat, p2.lon);

        if (segmentoOSRM && segmentoOSRM.length > 0) {
            // Añadir el segmento OSRM a la ruta completa
            // Evitar duplicar el punto de conexión
            if (rutaCompleta.length === 0) {
                rutaCompleta.push(...segmentoOSRM);
            } else {
                rutaCompleta.push(...segmentoOSRM.slice(1));
            }
            rutasExitosasOSRM++;
        } else {
            // Fallback: Si OSRM falla, añadir línea recta (como último recurso)
            console.warn(`Fallback a línea recta entre punto ${i} y ${i+1}`);
            if (rutaCompleta.length === 0) { // Si es el primer segmento
                 rutaCompleta.push([p1.lat, p1.lon]);
            }
             rutaCompleta.push([p2.lat, p2.lon]); // Añadir solo el punto final del segmento fallido
            rutasFallidasOSRM++;
        }
    }

    // Ocultar indicador de carga
    if (loadingOverlay) {
        loadingOverlay.classList.remove('active');
    }

    console.log(`✓ Ruta OSRM generada: ${rutasExitosasOSRM} segmentos OSRM, ${rutasFallidasOSRM} fallbacks a línea recta.`);
    return rutaCompleta; // Devuelve array de [lat, lon]
}
// =========================================================

async function dibujarRutaEnMapa(datosFiltrados) { // Marcado como async de nuevo
    limpiarMapa(true);

    // No ocultamos el overlay aquí, lo hace generarRutaPorCalles

    if (datosFiltrados.length === 0) {
        document.getElementById('historicalControls').style.display = 'block';
        actualizarInformacionHistorica(datosFiltrados);
        // Asegurarse de ocultar el overlay si no hay datos
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) loadingOverlay.classList.remove('active');
        return;
    }

    datosHistoricos = datosFiltrados; // Actualizar datos globales

    // --- LÓGICA DE DIBUJO CON OSRM FRONTEND ---

    // 1. Agrupar puntos GPS por coordenada para los popups (sin cambios)
    console.log(`Agrupando ${datosFiltrados.length} puntos GPS...`);
    const puntosAgrupados = new Map();
    for (const punto of datosFiltrados) {
        // Validar punto antes de agrupar
        if (punto && typeof punto.lat === 'number' && typeof punto.lon === 'number' && punto.timestamp) {
            const key = `${punto.lat.toFixed(6)},${punto.lon.toFixed(6)}`; // Usar precisión fija
            if (!puntosAgrupados.has(key)) {
                puntosAgrupados.set(key, {
                    lat: punto.lat,
                    lon: punto.lon,
                    timestamps: []
                });
            }
            puntosAgrupados.get(key).timestamps.push(punto.timestamp);
        } else {
            console.warn("Punto inválido encontrado durante agrupación:", punto);
        }
    }
    const uniquePoints = Array.from(puntosAgrupados.values());

    // 2. OBTENER LA RUTA OSRM DETALLADA (o parcial si se cancela)
    // Pasamos los 'datosFiltrados' originales
    const puntosRutaOSRM = await generarRutaPorCalles(datosFiltrados);

    // Si la generación de ruta se canceló, 'puntosRutaOSRM' estará incompleto.
    if (isRouteGenerationCancelled) {
        console.log('Dibujo de ruta parcial por cancelación.');
    }

    const polylineOptions = {
        color: '#4C1D95', // Color morado para la ruta OSRM
        weight: 4,
        opacity: 0.8
    };

    // 3. DIBUJAR LA RUTA OSRM (parcial, recortada, o completa)
    if (geofenceLayer) {
        // MODO GEOCERCA: Recortar la RUTA OSRM y dibujar segmentos
        console.log('Geocerca activa. Recortando ruta OSRM...');
        const geofenceBounds = geofenceLayer.getBounds();
        const clippedSegments = clipPolyline(puntosRutaOSRM, geofenceBounds);

        console.log(`Ruta OSRM recortada en ${clippedSegments.length} segmentos.`);

        clippedSegments.forEach(segment => {
            if (segment.length > 1) {
                const poly = L.polyline(segment, polylineOptions).addTo(map);
                polylinesHistoricas.push(poly);
            }
        });

    } else {
        // MODO NORMAL: Dibujar ruta OSRM completa (o parcial)
        console.log('Sin geocerca. Dibujando ruta OSRM...');
        if (puntosRutaOSRM.length > 0) {
            polylineHistorica = L.polyline(puntosRutaOSRM, polylineOptions).addTo(map);
        }
    }

    // 4. DIBUJAR LOS MARCADORES (PUNTOS ROJOS AGRUPADOS)
    // Dibujamos los puntos *únicos* que agrupamos
    console.log(`Dibujando ${uniquePoints.length} puntos únicos en la trayectoria...`);
    uniquePoints.forEach(punto => {
        // Asegurarnos que el punto único caiga dentro si hay geocerca
        if (!geofenceLayer || (geofenceLayer && geofenceLayer.getBounds().contains([punto.lat, punto.lon]))) {
            const marker = L.circleMarker([punto.lat, punto.lon], {
                radius: 5,
                color: '#FFFFFF',      // Borde blanco
                weight: 2,
                fillColor: '#EF4444', // Relleno rojo
                fillOpacity: 1.0,
                pane: 'markerPane' // Asegura que esté sobre la línea
            }).addTo(map);

            const popupContent = `<b>Coordenada:</b><br>${punto.lat.toFixed(6)}, ${punto.lon.toFixed(6)}<br><br><b>Fechas en este punto:</b><br>${punto.timestamps.join('<br>')}`;
            marker.bindPopup(popupContent, { maxHeight: 200 });

            marcadoresHistoricos.push(marker);
        }
    });


    // 5. AJUSTAR LA VISTA (sin cambios)
    ajustarVista();

    // --- FIN NUEVA LÓGICA ---

    actualizarInformacionHistorica(datosFiltrados);

    document.getElementById('historicalControls').style.display = 'block';

    // === CORRECCIÓN toLocaleTimeString ===
    // Llamar a la función directamente para asegurar que tenemos un objeto Date
    lastQueryElement.textContent = obtenerFechaHoraColombia().toLocaleTimeString('es-CO', {
        timeZone: 'UTC', // Mantener UTC si así lo prefieres
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    // === FIN CORRECCIÓN ===


    if (window.updateModalInfo) {
        window.updateModalInfo();
    }
}


async function mostrarHistorico(coordenadas) { // Async de nuevo
    if (coordenadas.length === 0) {
        alert('No hay datos para ese rango de fechas');
        limpiarMapa();
        return;
    }

    const fechaInicio = document.getElementById('fechaInicio').value;
    const horaInicio = document.getElementById('horaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const horaFin = document.getElementById('horaFin').value;

    const datosFiltrados = filtrarPorRangoCompleto(coordenadas, fechaInicio, horaInicio, fechaFin, horaFin);

    if (datosFiltrados.length === 0) {
        alert('No hay datos para ese rango de tiempo');
        limpiarMapa();
        return;
    }

    await dibujarRutaEnMapa(datosFiltrados); // Await de nuevo
}

// Función actualizarInformacionHistorica (sin cambios respecto a la última versión que te di)
function actualizarInformacionHistorica(datos) {
    puntosHistoricosElement.textContent = datos.length;

    const fechaInicio = document.getElementById('fechaInicio').value;
    const horaInicio = document.getElementById('horaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const horaFin = document.getElementById('horaFin').value;

    // Lógica de Rango Consultado
    if (datos.length > 0 && (!fechaInicio || !fechaFin)) {
        const primerPunto = datos[0];
        const ultimoPunto = datos[datos.length - 1];
        rangoConsultadoElement.textContent = `${primerPunto.timestamp} - ${ultimoPunto.timestamp}`;

        const inicio = parseTimestamp(primerPunto.timestamp);
        const fin = parseTimestamp(ultimoPunto.timestamp);
         if (!isNaN(inicio) && !isNaN(fin)) {
            const diffTime = Math.abs(fin - inicio);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + (inicio.toDateString() === fin.toDateString() ? 0 : 1);
            diasIncluidosElement.textContent = diffDays > 0 ? diffDays : 1;
         } else {
             diasIncluidosElement.textContent = '???'; // Indicar error en fechas
         }


    } else if (fechaInicio && fechaFin) {
        rangoConsultadoElement.textContent = `${fechaInicio} ${horaInicio} - ${fechaFin} ${horaFin}`;
        try {
            const inicio = new Date(fechaInicio);
            const fin = new Date(fechaFin);
            if (isNaN(inicio) || isNaN(fin)) throw new Error(); // Validar fechas
            const diffTime = Math.abs(fin - inicio);
            // +1 si son días distintos
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
            diasIncluidosElement.textContent = diffDays > 0 ? diffDays : 1;
        } catch(e) {
            diasIncluidosElement.textContent = '???'; // Indicar error en fechas
        }

    } else {
        rangoConsultadoElement.textContent = '---';
        diasIncluidosElement.textContent = '---';
    }

    // Lógica de reseteo
    if (datos.length === 0) {
        puntoInicialElement.textContent = '---.------';
        puntoFinalElement.textContent = '---.------';
        distanciaTotalElement.textContent = '--- km';
        duracionElement.innerHTML = '---';
        return;
    }

    const primerPunto = datos[0];
    const ultimoPunto = datos[datos.length - 1];

    puntoInicialElement.textContent = `${primerPunto.lat.toFixed(6)}, ${primerPunto.lon.toFixed(6)}`;
    puntoFinalElement.textContent = `${ultimoPunto.lat.toFixed(6)}, ${ultimoPunto.lon.toFixed(6)}`;

    // Lógica de Distancia
    let distanciaTotal = 0;
    for (let i = 1; i < datos.length; i++) {
        // Validar puntos antes de calcular distancia
        if (datos[i-1] && datos[i] && typeof datos[i-1].lat === 'number' && typeof datos[i].lat === 'number') {
            distanciaTotal += calcularDistancia(
                datos[i-1].lat, datos[i-1].lon,
                datos[i].lat, datos[i].lon
            );
        }
    }
    distanciaTotalElement.textContent = `${distanciaTotal.toFixed(2)} km`;

    // --- LÓGICA DE DURACIÓN ---

    function formatDuration(durationMs) {
        const dias = Math.floor(durationMs / (1000 * 60 * 60 * 24));
        const horas = Math.floor((durationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutos = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

        let parts = [];
        if (dias > 0) parts.push(`${dias} ${dias === 1 ? 'día' : 'días'}`);
        if (horas > 0) parts.push(`${horas} ${horas === 1 ? 'hora' : 'horas'}`);
        if (minutos > 0) parts.push(`${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`);

        if (durationMs < 60000 && parts.length === 0) return "0 minutos";

        return parts.join(' ');
    }

    if (geofenceLayer) {
        const mapaDias = new Map();
        for (let i = 0; i < datos.length; i++) {
            const puntoActual = datos[i];
            const fechaPunto = parseTimestamp(puntoActual.timestamp);
            if (isNaN(fechaPunto)) continue;

            const diaKey = fechaPunto.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });

            let duracionSegmentoMs = 0;
            if (i > 0) {
                const puntoAnterior = datos[i - 1];
                const fechaAnterior = parseTimestamp(puntoAnterior.timestamp);
                if (isNaN(fechaAnterior)) continue;

                if (fechaAnterior.toDateString() === fechaPunto.toDateString()) {
                    duracionSegmentoMs = fechaPunto - fechaAnterior;
                    if (duracionSegmentoMs < 0) duracionSegmentoMs = 0;
                }
            }

            if (!mapaDias.has(diaKey)) {
                mapaDias.set(diaKey, { totalDurationMs: duracionSegmentoMs });
            } else {
                mapaDias.get(diaKey).totalDurationMs += duracionSegmentoMs;
            }
        }

        if (mapaDias.size === 0) {
             duracionElement.innerHTML = '---';
        } else {
            const diasOrdenados = Array.from(mapaDias.keys()).sort((a, b) => {
                const [dayA, monthA, yearA] = a.split('/');
                const [dayB, monthB, yearB] = b.split('/');
                return new Date(`${yearA}-${monthA}-${dayA}`) - new Date(`${yearB}-${monthB}-${dayB}`);
            });

            let htmlDuracion = '<b>Duración en geocerca:</b><br>';

            for (const dia of diasOrdenados) {
                const stats = mapaDias.get(dia);
                const formattedDuration = formatDuration(stats.totalDurationMs);
                htmlDuracion += `${dia}: ${formattedDuration}<br>`;
            }
            duracionElement.innerHTML = htmlDuracion;
        }

    } else {
        const tiempoInicial = parseTimestamp(primerPunto.timestamp);
        const tiempoFinal = parseTimestamp(ultimoPunto.timestamp);
        if (isNaN(tiempoInicial) || isNaN(tiempoFinal)) {
            duracionElement.textContent = "Error en fechas";
        } else {
            const duracionMs = tiempoFinal - tiempoInicial;
            const formattedDuration = formatDuration(duracionMs);
            duracionElement.textContent = formattedDuration;
        }
    }
}


async function verHistoricoRango() { // Async de nuevo
    const fechaInicio = document.getElementById('fechaInicio').value;
    const horaInicio = document.getElementById('horaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const horaFin = document.getElementById('horaFin').value;

    if (!fechaInicio || !fechaFin) {
        alert('Debes seleccionar tanto la fecha de inicio como la fecha de fin');
        return;
    }
    // ... validaciones de fecha futura y rango ...
    const ahoraColombia = new Date();
    let fechaInicioCompleta, fechaFinCompleta;
    try {
        fechaInicioCompleta = new Date(`${fechaInicio}T${horaInicio || '00:00'}:00`);
        fechaFinCompleta = new Date(`${fechaFin}T${horaFin || '23:59'}:59`);
        if (isNaN(fechaInicioCompleta) || isNaN(fechaFinCompleta)) throw new Error("Fecha inválida");
    } catch(e) {
         alert('Formato de fecha u hora inválido.');
         return;
    }
    const ahoraComparable = new Date(Date.UTC(
        ahoraColombia.getUTCFullYear(),
        ahoraColombia.getUTCMonth(),
        ahoraColombia.getUTCDate(),
        ahoraColombia.getUTCHours(),
        ahoraColombia.getUTCMinutes(),
        ahoraColombia.getUTCSeconds()
    ));
    if (fechaInicioCompleta > ahoraComparable) { alert('La fecha de inicio no puede ser futura'); return; }
    if (fechaFinCompleta > ahoraComparable) { alert('La fecha de fin no puede ser futura'); return; }
    if (fechaInicioCompleta > fechaFinCompleta) { alert('La fecha de inicio no puede ser posterior a la fecha de fin'); return; }


    // NO mostramos overlay aquí, lo hará generarRutaPorCalles si es necesario

    const basePath = window.getBasePath ? window.getBasePath() : '';
    const url = `${basePath}/historico/rango?inicio=${fechaInicio}&fin=${fechaFin}&hora_inicio=${horaInicio}&hora_fin=${horaFin}`;

    // Mostramos overlay ANTES del fetch
     const loadingOverlay = document.getElementById('loadingOverlay');
     if (loadingOverlay) loadingOverlay.classList.add('active');


    try {
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            datosHistoricosOriginales = data;

            if (geofenceLayer) {
                await aplicarFiltroGeocerca(); // Await de nuevo
            } else {
                await mostrarHistorico(data); // Await de nuevo
            }

            const searchModal = document.getElementById('searchModal');
            if (searchModal) {
                searchModal.classList.remove('active');
            }
        } else {
            alert('No hay datos para ese rango de fechas o error del servidor.');
            // Ocultar overlay si fetch falla
             if (loadingOverlay) loadingOverlay.classList.remove('active');
        }
    } catch (error) {
        console.error('Error al consultar histórico:', error);
        alert('Error al consultar histórico.');
         if (loadingOverlay) loadingOverlay.classList.remove('active');
    }
}

// limpiarMapa (sin cambios respecto a la última versión)
function limpiarMapa(preserveGeofence = false) {
    if (polylineHistorica) {
        map.removeLayer(polylineHistorica);
        polylineHistorica = null;
    }
    polylinesHistoricas.forEach(poly => { map.removeLayer(poly); });
    polylinesHistoricas = [];
    marcadoresHistoricos.forEach(marker => { map.removeLayer(marker); });
    marcadoresHistoricos = [];

    document.getElementById('historicalControls').style.display = 'none';
    puntosHistoricosElement.textContent = '0';
    rangoConsultadoElement.textContent = '---';
    diasIncluidosElement.textContent = '---';
    puntoInicialElement.textContent = '---.------';
    puntoFinalElement.textContent = '---.------';
    distanciaTotalElement.textContent = '--- km';
    duracionElement.innerHTML = '---';
    datosHistoricos = [];

    if (!preserveGeofence) {
        if (drawnItems) drawnItems.clearLayers();
        geofenceLayer = null;
        datosHistoricosOriginales = [];
        // No resetear fechas aquí al limpiar
    }
    if (window.updateModalInfo) window.updateModalInfo();
}


async function aplicarFiltroGeocerca() { // Async de nuevo
    const fechaInicio = document.getElementById('fechaInicio').value;
    const horaInicio = document.getElementById('horaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const horaFin = document.getElementById('horaFin').value;

    let datosFiltradosTiempo = filtrarPorRangoCompleto(datosHistoricosOriginales, fechaInicio, horaInicio, fechaFin, horaFin);
    let datosParaMostrar = datosFiltradosTiempo;

    if (geofenceLayer) {
        const bounds = geofenceLayer.getBounds();
        datosParaMostrar = datosFiltradosTiempo.filter(p =>
            p && typeof p.lat === 'number' && typeof p.lon === 'number' && // Validar punto
            bounds.contains([p.lat, p.lon])
        );
    }
    await dibujarRutaEnMapa(datosParaMostrar); // Await de nuevo
}


async function fetchDatosPorGeocerca(bounds) { // Async de nuevo
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    if (!sw || !ne || isNaN(sw.lat) || isNaN(sw.lng) || isNaN(ne.lat) || isNaN(ne.lng)) {
        console.error('Coordenadas de geocerca inválidas:', bounds);
        alert('Error: El área seleccionada no es válida.');
        return;
    }
    const basePath = window.getBasePath ? window.getBasePath() : '';
    const url = `${basePath}/historico/geocerca?min_lat=${sw.lat}&min_lon=${sw.lng}&max_lat=${ne.lat}&max_lon=${ne.lng}`;

    limpiarMapa(true);

    // No mostramos overlay aquí, lo hará generarRutaPorCalles

    // Mostrar overlay ANTES del fetch
     const loadingOverlay = document.getElementById('loadingOverlay');
     if (loadingOverlay) loadingOverlay.classList.add('active');

    try {
        const response = await fetch(url);
        if (response.ok) {
            const responseData = await response.json();
            if (responseData.length === 0) {
                 alert('No se encontraron datos históricos en esta área');
                 // Ocultar overlay si no hay datos
                 if (loadingOverlay) loadingOverlay.classList.remove('active');
                 return;
            }
            await dibujarRutaEnMapa(responseData); // Await de nuevo

        } else {
            console.error('Error del servidor al consultar geocerca:', response.status, response.statusText);
            let errorBody = await response.text();
            alert(`Error del servidor (${response.status}): ${response.statusText}. ${errorBody.substring(0, 100)}`);
             if (loadingOverlay) loadingOverlay.classList.remove('active');
        }
    } catch (error) {
        console.error('Error detallado en fetchDatosPorGeocerca:', error);
        let errorMessage = 'Error al consultar por geocerca.';
         if (error instanceof SyntaxError) {
            errorMessage = 'Error: La respuesta del servidor no es JSON válido.';
        } else if (error instanceof TypeError) {
             errorMessage = 'Error: Problema de red o configuración (CORS?).';
        } else if (error.message) {
            errorMessage = `Error: ${error.message}`;
        }
        alert(errorMessage);
        if (loadingOverlay) loadingOverlay.classList.remove('active');
    }
}

// limpiarGeocerca (sin cambios)
function limpiarGeocerca() {
    if (geofenceLayer) {
        drawnItems.removeLayer(geofenceLayer);
        geofenceLayer = null;
        // Si teníamos datos originales cargados (filtro de tiempo),
        // volvemos a mostrarlos completos.
        if (datosHistoricosOriginales.length > 0) {
            // Necesitamos que sea async para llamar a dibujarRutaEnMapa
            (async () => {
                await mostrarHistorico(datosHistoricosOriginales);
            })();
        } else {
             limpiarMapa(); // Si no, simplemente limpiamos
        }
    }
}


// toggleMarcadores (sin cambios)
function toggleMarcadores() {
    marcadoresVisibles = !marcadoresVisibles;
    const toggleText = document.getElementById('toggleMarcadoresText');
    marcadoresHistoricos.forEach(marker => {
        if (marcadoresVisibles) { map.addLayer(marker); } else { map.removeLayer(marker); }
    });
    toggleText.textContent = marcadoresVisibles ? 'Ocultar Marcadores' : 'Mostrar Marcadores';
}

// ajustarVista (sin cambios)
function ajustarVista() {
    if (geofenceLayer) { map.fitBounds(geofenceLayer.getBounds()); }
    else if (polylineHistorica) { map.fitBounds(polylineHistorica.getBounds()); }
    else if (polylinesHistoricas.length > 0) {
        const segmentsGroup = L.featureGroup(polylinesHistoricas);
        marcadoresHistoricos.forEach(m => segmentsGroup.addLayer(m));
        map.fitBounds(segmentsGroup.getBounds());
    } else if (marcadoresHistoricos.length > 0) {
        const pointsGroup = L.featureGroup(marcadoresHistoricos);
        map.fitBounds(pointsGroup.getBounds());
    }
}

// exportarDatos (sin cambios)
function exportarDatos() {
    if (datosHistoricos.length === 0) { alert('No hay datos para exportar'); return; }
    const fechaInicio = document.getElementById('fechaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const csvContent = 'data:text/csv;charset=utf-8,' +
        'Latitud,Longitud,Timestamp\n' +
        datosHistoricos.map(p => `${p.lat},${p.lon},${p.timestamp}`).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `historical_data_${fechaInicio||'geofence'}_to_${fechaFin||'all'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Funciones de fecha/hora (sin cambios)
function obtenerFechaHoraColombia() {
    const ahoraUTC = new Date();
    const offsetColombia = -5 * 60 * 60 * 1000;
    return new Date(ahoraUTC.getTime() + offsetColombia);
}
function obtenerFechaActual() {
    const ahoraColombia = obtenerFechaHoraColombia();
    const año = ahoraColombia.getUTCFullYear();
    const mes = String(ahoraColombia.getUTCMonth() + 1).padStart(2, '0');
    const dia = String(ahoraColombia.getUTCDate()).padStart(2, '0');
    return `${año}-${mes}-${dia}`;
}
function obtenerHoraActual() {
    const ahoraColombia = obtenerFechaHoraColombia();
    const horas = String(ahoraColombia.getUTCHours()).padStart(2, '0');
    const minutos = String(ahoraColombia.getUTCMinutes()).padStart(2, '0');
    return `${horas}:${minutos}`;
}

// Funciones de establecer rangos (sin cambios)
function establecerValoresDefectoFechas() {
    const hoy = obtenerFechaActual();
    document.getElementById('fechaInicio').value = hoy;
    document.getElementById('fechaFin').value = hoy;
    document.getElementById('horaInicio').value = '00:00';
    document.getElementById('horaFin').value = obtenerHoraActual();
    actualizarRestriccionesFechas();
}
function establecerRangoHoy() {
    const hoy = obtenerFechaActual();
    document.getElementById('fechaInicio').value = hoy;
    document.getElementById('fechaFin').value = hoy;
    document.getElementById('horaInicio').value = '00:00';
    document.getElementById('horaFin').value = obtenerHoraActual();
    actualizarRestriccionesFechas();
    verHistoricoRango(); // Ejecutar búsqueda
}
function establecerRangoUltimos7Dias() {
    const hoy = new Date(); // Usar hora local para calcular la fecha
    const hace7Dias = new Date(hoy);
    hace7Dias.setDate(hoy.getDate() - 7); // Retroceder 7 días
    const inicioStr = hace7Dias.toISOString().split('T')[0];
    const finStr = obtenerFechaActual(); // Fin es hoy (formato YYYY-MM-DD)
    document.getElementById('fechaInicio').value = inicioStr;
    document.getElementById('fechaFin').value = finStr;
    document.getElementById('horaInicio').value = '00:00';
    document.getElementById('horaFin').value = obtenerHoraActual(); // Hasta la hora actual
    actualizarRestriccionesFechas();
    verHistoricoRango(); // Ejecutar búsqueda
}

// Funciones de validación de fechas/horas (sin cambios)
function actualizarRestriccionesFechas() {
    const fechaInicio = document.getElementById('fechaInicio');
    const fechaFin = document.getElementById('fechaFin');
    const hoy = obtenerFechaActual(); // YYYY-MM-DD de hoy
    fechaInicio.max = hoy;
    fechaFin.max = hoy;
    if (fechaInicio.value) {
        fechaFin.min = fechaInicio.value;
        if (fechaFin.value && fechaFin.value < fechaInicio.value) { fechaFin.value = fechaInicio.value; }
    } else { fechaFin.removeAttribute('min'); }
    if (fechaFin.value && fechaInicio.value && fechaInicio.value > fechaFin.value) { fechaInicio.value = fechaFin.value; }
    actualizarRestriccionesHora();
}
function configurarValidacionFechas() {
    const fechaInicio = document.getElementById('fechaInicio');
    const fechaFin = document.getElementById('fechaFin');
    const horaInicio = document.getElementById('horaInicio');
    const horaFin = document.getElementById('horaFin');
    const hoy = obtenerFechaActual();
    fechaInicio.max = hoy; fechaFin.max = hoy;
    fechaInicio.addEventListener('change', actualizarRestriccionesFechas);
    fechaFin.addEventListener('change', actualizarRestriccionesFechas);
    horaInicio.addEventListener('change', actualizarRestriccionesHora);
    horaFin.addEventListener('change', actualizarRestriccionesHora);
}
function actualizarRestriccionesHora() {
    const fechaInicio = document.getElementById('fechaInicio');
    const fechaFin = document.getElementById('fechaFin');
    const horaInicio = document.getElementById('horaInicio');
    const horaFin = document.getElementById('horaFin');
    const hoy = obtenerFechaActual();
    const horaActual = obtenerHoraActual(); // HH:MM
    horaInicio.removeAttribute('max'); horaFin.removeAttribute('min'); horaFin.removeAttribute('max');
    if (fechaFin.value === hoy) {
        horaFin.max = horaActual;
        if (horaFin.value > horaActual) { horaFin.value = horaActual; }
    }
    if (fechaInicio.value && fechaFin.value && fechaInicio.value === fechaFin.value) {
        if (horaInicio.value) {
            horaFin.min = horaInicio.value;
            if (horaFin.value && horaFin.value < horaInicio.value) { horaFin.value = horaInicio.value; }
             if (fechaFin.value === hoy && horaFin.max && horaFin.value > horaFin.max) { horaFin.value = horaFin.max; }
        }
        if (horaFin.value) {
             let maxHoraInicio = horaFin.value;
             if (fechaInicio.value === hoy && horaActual < maxHoraInicio) { maxHoraInicio = horaActual; }
             horaInicio.max = maxHoraInicio;
             if (horaInicio.value > maxHoraInicio) { horaInicio.value = maxHoraInicio; }
         }
    } else { horaFin.removeAttribute('min'); }
    if (fechaInicio.value === hoy) {
         horaInicio.max = horaActual;
         if (horaInicio.value > horaActual) { horaInicio.value = horaActual; }
    }
}

// initSearchModal (sin cambios)
function initSearchModal() {
    const searchBtn = document.getElementById('searchBtn');
    const searchModal = document.getElementById('searchModal');
    const closeSearchModal = document.getElementById('closeSearchModal');
    if (!searchBtn || !searchModal || !closeSearchModal) { console.error('Elementos del modal no encontrados'); return; }
    searchBtn.addEventListener('click', () => searchModal.classList.add('active'));
    closeSearchModal.addEventListener('click', () => searchModal.classList.remove('active'));
    searchModal.addEventListener('click', (e) => { if (e.target === searchModal) searchModal.classList.remove('active'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && searchModal.classList.contains('active')) searchModal.classList.remove('active'); });
}

// DOMContentLoaded (RESTAURADO listener de cancelar)
document.addEventListener('DOMContentLoaded', () => {
    if (window.setupViewNavigation) {
        window.setupViewNavigation();
    }
    initializeMap();
    establecerValoresDefectoFechas(); // Solo establece valores, no busca
    configurarValidacionFechas();

    // 1. RESTAURAR EL LISTENER PARA CANCELAR
    const cancelBtn = document.getElementById('cancelRouteBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            isRouteGenerationCancelled = true;
        });
    }
});

// window.onload (sin cambios)
window.addEventListener('load', () => {
    initSearchModal();
});