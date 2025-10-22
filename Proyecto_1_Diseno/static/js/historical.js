let map;
let polylineHistorica = null;
let polylinesHistoricas = []; // Para los segmentos de ruta recortados
let marcadoresHistoricos = [];
let marcadoresVisibles = true;
let datosHistoricos = [];
let datosHistoricosOriginales = [];
let geofenceLayer = null;
let drawnItems;

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
            aplicarFiltroGeocerca();
        } else {
            console.log("Consultando al servidor por geocerca");
            fetchDatosPorGeocerca(geofenceLayer.getBounds());
        }
    });

    map.on(L.Draw.Event.EDITED, function (e) {
        geofenceLayer = e.layers.getLayers()[0];
        if (datosHistoricosOriginales.length > 0) {
            aplicarFiltroGeocerca();
        } else {
            fetchDatosPorGeocerca(geofenceLayer.getBounds());
        }
    });

    map.on(L.Draw.Event.DELETED, function () {
        geofenceLayer = null;
        aplicarFiltroGeocerca();
    });
}

/**
 * Recorta una polilínea (array de coords [lat, lon]) contra un L.LatLngBounds.
 * Devuelve un array de segmentos (arrays de coords) que están DENTRO.
 */
function clipPolyline(coordinates, bounds) {
    const segments = [];
    if (!coordinates || coordinates.length < 2) return segments;

    let currentSegment = [];
    let wasInside = bounds.contains(L.latLng(coordinates[0][0], coordinates[0][1])); // Check first point

     if (wasInside) {
        currentSegment.push(coordinates[0]);
    }

    for (let i = 1; i < coordinates.length; i++) {
        const p1 = L.latLng(coordinates[i-1][0], coordinates[i-1][1]);
        const p2 = L.latLng(coordinates[i][0], coordinates[i][1]);
        const isInside = bounds.contains(p2);

        if (isInside && wasInside) {
            // Segmento continúa dentro
            currentSegment.push(coordinates[i]);
        } else if (isInside && !wasInside) {
            // Entró al rectángulo
             // Intersección (aproximada, podríamos usar una librería si es crítico)
            const intersection = L.LineUtil.clipSegment(p1, p2, bounds, false);
            if (intersection && intersection.length > 0) {
                 // Empezar nuevo segmento desde la intersección
                 currentSegment = [[intersection[0].lat, intersection[0].lng]];
            } else {
                 currentSegment = []; // Si no hay intersección clara, empezar vacío
            }
            currentSegment.push(coordinates[i]); // Añadir el punto actual (que está dentro)
        } else if (!isInside && wasInside) {
            // Salió del rectángulo
            // Intersección (aproximada)
             const intersection = L.LineUtil.clipSegment(p1, p2, bounds, false);
             if (intersection && intersection.length > 0) {
                 currentSegment.push([intersection[0].lat, intersection[0].lng]); // Terminar segmento en la intersección
             }
             if (currentSegment.length > 1) { // Guardar si tiene más de un punto
                segments.push(currentSegment);
             }
             currentSegment = []; // Resetear
        }
        // else (!isInside && !wasInside) -> No hacer nada, sigue fuera

        wasInside = isInside;
    }

    // Guardar el último segmento si era válido
    if (currentSegment.length > 1) {
        segments.push(currentSegment);
    }

    return segments;
}


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
        return fechaPunto >= fechaHoraInicio && fechaPunto <= fechaHoraFin;
    });
}

// ========== FUNCIONES generarRutaPorCalles y obtenerRutaOSRM ELIMINADAS ==========

function dibujarRutaEnMapa(datosFiltrados) {
    limpiarMapa(true); // Limpiar mapa pero preservar geocerca

    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        // Ocultar overlay inmediatamente, ya no hay proceso largo
        loadingOverlay.classList.remove('active');
    }

    if (datosFiltrados.length === 0) {
        document.getElementById('historicalControls').style.display = 'block';
        actualizarInformacionHistorica(datosFiltrados);
        return;
    }

    datosHistoricos = datosFiltrados; // Actualizar datos globales

    // --- LÓGICA DE DIBUJO SIMPLIFICADA ---

    // 1. Agrupar puntos GPS por coordenada para los popups
    console.log(`Agrupando ${datosFiltrados.length} puntos GPS...`);
    const puntosAgrupados = new Map();
    for (const punto of datosFiltrados) {
        const key = `${punto.lat.toFixed(6)},${punto.lon.toFixed(6)}`; // Usar precisión fija
        if (!puntosAgrupados.has(key)) {
            puntosAgrupados.set(key, {
                lat: punto.lat,
                lon: punto.lon,
                timestamps: []
            });
        }
        puntosAgrupados.get(key).timestamps.push(punto.timestamp);
    }
    const uniquePoints = Array.from(puntosAgrupados.values());

    // 2. OBTENER LAS COORDENADAS PARA LA LÍNEA
    // Usamos los datos originales (datosFiltrados) que ya están "snap-to-road"
    const polylineCoords = datosFiltrados.map(p => [p.lat, p.lon]);

    const polylineOptions = {
        color: '#4C1D95', // Color morado para la ruta
        weight: 4,
        opacity: 0.8
    };

    // 3. DIBUJAR LA RUTA (Recortada o Completa)
    if (geofenceLayer) {
        // MODO GEOCERCA: Recortar la línea y dibujar segmentos
        console.log('Geocerca activa. Recortando línea de puntos...');
        const geofenceBounds = geofenceLayer.getBounds();
        // Usamos las coordenadas originales (ya ajustadas a la calle) para el recorte
        const clippedSegments = clipPolyline(polylineCoords, geofenceBounds);

        console.log(`Línea recortada en ${clippedSegments.length} segmentos.`);

        clippedSegments.forEach(segment => {
            if (segment.length > 1) {
                const poly = L.polyline(segment, polylineOptions).addTo(map);
                polylinesHistoricas.push(poly);
            }
        });

    } else {
        // MODO NORMAL: Dibujar línea completa
        console.log('Sin geocerca. Dibujando línea de puntos completa.');
        if (polylineCoords.length > 1) {
            polylineHistorica = L.polyline(polylineCoords, polylineOptions).addTo(map);
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

            // Crear el contenido del popup con todas las fechas
            const popupContent = `<b>Coordenada:</b><br>${punto.lat.toFixed(6)}, ${punto.lon.toFixed(6)}<br><br><b>Fechas en este punto:</b><br>${punto.timestamps.join('<br>')}`;
            marker.bindPopup(popupContent, { maxHeight: 200 });

            marcadoresHistoricos.push(marker); // Añadir a la lista para 'toggleMarcadores'
        }
    });


    // 5. AJUSTAR LA VISTA
    ajustarVista(); // Llamar a la función de ajuste

    // --- FIN NUEVA LÓGICA ---

    actualizarInformacionHistorica(datosFiltrados);

    document.getElementById('historicalControls').style.display = 'block';

    const ahoraColombia = obtenerFechaHoraColombia();
    lastQueryElement.textContent = ahoraColombia.toLocaleTimeString('es-CO', {
        timeZone: 'UTC', // Mantener UTC si así lo prefieres, o quitarlo para hora local
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    if (window.updateModalInfo) {
        window.updateModalInfo();
    }
}


function mostrarHistorico(coordenadas) {
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

    // Ya no es async
    dibujarRutaEnMapa(datosFiltrados);
}

function actualizarInformacionHistorica(datos) {
    puntosHistoricosElement.textContent = datos.length;

    const fechaInicio = document.getElementById('fechaInicio').value;
    const horaInicio = document.getElementById('horaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const horaFin = document.getElementById('horaFin').value;

    // Lógica de Rango Consultado (sin cambios)
    if (datos.length > 0 && (!fechaInicio || !fechaFin)) {
        const primerPunto = datos[0];
        const ultimoPunto = datos[datos.length - 1];
        rangoConsultadoElement.textContent = `${primerPunto.timestamp} - ${ultimoPunto.timestamp}`;

        const inicio = parseTimestamp(primerPunto.timestamp);
        const fin = parseTimestamp(ultimoPunto.timestamp);
        // Calcula días de forma inclusiva
        const diffTime = Math.abs(fin - inicio);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + (inicio.toDateString() === fin.toDateString() ? 0 : 1); // +1 si cruza medianoche
        diasIncluidosElement.textContent = diffDays > 0 ? diffDays : 1; // Mínimo 1 día


    } else if (fechaInicio && fechaFin) {
        rangoConsultadoElement.textContent = `${fechaInicio} ${horaInicio} - ${fechaFin} ${horaFin}`;
        const inicio = new Date(fechaInicio);
        const fin = new Date(fechaFin);
         // Calcula días de forma inclusiva
        const diffTime = Math.abs(fin - inicio);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + (inicio.toDateString() === fin.toDateString() ? 0 : 1); // +1 si cruza medianoche
        diasIncluidosElement.textContent = diffDays > 0 ? diffDays : 1; // Mínimo 1 día

    } else {
        rangoConsultadoElement.textContent = '---';
        diasIncluidosElement.textContent = '---';
    }

    // Lógica de reseteo (sin cambios)
    if (datos.length === 0) {
        puntoInicialElement.textContent = '---.------';
        puntoFinalElement.textContent = '---.------';
        distanciaTotalElement.textContent = '--- km';
        duracionElement.innerHTML = '---'; // Limpiamos la duración
        return;
    }

    const primerPunto = datos[0];
    const ultimoPunto = datos[datos.length - 1];

    puntoInicialElement.textContent = `${primerPunto.lat.toFixed(6)}, ${primerPunto.lon.toFixed(6)}`;
    puntoFinalElement.textContent = `${ultimoPunto.lat.toFixed(6)}, ${ultimoPunto.lon.toFixed(6)}`;

    // Lógica de Distancia (calculada sobre los puntos recibidos)
    let distanciaTotal = 0;
    for (let i = 1; i < datos.length; i++) {
        distanciaTotal += calcularDistancia(
            datos[i-1].lat, datos[i-1].lon,
            datos[i].lat, datos[i].lon
        );
    }
    distanciaTotalElement.textContent = `${distanciaTotal.toFixed(2)} km`;

    // --- LÓGICA DE DURACIÓN (Misma que antes) ---

    // Función auxiliar para formatear la duración
    function formatDuration(durationMs) {
        const dias = Math.floor(durationMs / (1000 * 60 * 60 * 24));
        const horas = Math.floor((durationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutos = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

        let parts = [];
        if (dias > 0) parts.push(`${dias} ${dias === 1 ? 'día' : 'días'}`);
        if (horas > 0) parts.push(`${horas} ${horas === 1 ? 'hora' : 'horas'}`);
        if (minutos > 0) parts.push(`${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`);

        if (durationMs < 60000 && parts.length === 0) return "0 minutos"; // Si dura menos de 1 min

        return parts.join(' ');
    }


    // Comprobamos si hay una geocerca activa
    if (geofenceLayer) {
        // 3. CÁLCULO DE DURACIÓN POR DÍA (Geocerca)
        const mapaDias = new Map();
        for (let i = 0; i < datos.length; i++) {
            const puntoActual = datos[i];
            const fechaPunto = parseTimestamp(puntoActual.timestamp);
            if (isNaN(fechaPunto)) continue; // Saltar si la fecha es inválida

            const diaKey = fechaPunto.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' }); // Formato DD/MM/YYYY

            // Calculamos la duración desde el punto anterior (si existe y es del mismo día)
            let duracionSegmentoMs = 0;
            if (i > 0) {
                const puntoAnterior = datos[i - 1];
                const fechaAnterior = parseTimestamp(puntoAnterior.timestamp);
                if (isNaN(fechaAnterior)) continue; // Saltar si la fecha anterior es inválida

                // Solo sumar si es consecutivo en el mismo día
                if (fechaAnterior.toDateString() === fechaPunto.toDateString()) {
                     // Estimamos la duración como el tiempo hasta el siguiente punto
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

        // Formatear la salida
        if (mapaDias.size === 0) {
             duracionElement.innerHTML = '---'; // Fallback directo
        } else {
            // Ordenar los días antes de mostrarlos
            const diasOrdenados = Array.from(mapaDias.keys()).sort((a, b) => {
                const [dayA, monthA, yearA] = a.split('/');
                const [dayB, monthB, yearB] = b.split('/');
                return new Date(`${yearA}-${monthA}-${dayA}`) - new Date(`${yearB}-${monthB}-${dayB}`);
            });

            // Declarar htmlDuracion aquí, DENTRO del else
            let htmlDuracion = '<b>Duración en geocerca:</b><br>';

            for (const dia of diasOrdenados) {
                const stats = mapaDias.get(dia);
                const formattedDuration = formatDuration(stats.totalDurationMs);
                htmlDuracion += `${dia}: ${formattedDuration}<br>`;
            }
            duracionElement.innerHTML = htmlDuracion; // Usar innerHTML por los <br>
        }

    } else {
        // 2. CÁLCULO DE DURACIÓN TOTAL (Sin Geocerca)
        const tiempoInicial = parseTimestamp(primerPunto.timestamp);
        const tiempoFinal = parseTimestamp(ultimoPunto.timestamp);
        // Comprobar si las fechas son válidas
        if (isNaN(tiempoInicial) || isNaN(tiempoFinal)) {
            duracionElement.textContent = "Error en fechas";
        } else {
            const duracionMs = tiempoFinal - tiempoInicial;
            const formattedDuration = formatDuration(duracionMs);
            duracionElement.textContent = formattedDuration; // Usar textContent
        }
    }
}


async function verHistoricoRango() {
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

    if (fechaInicioCompleta > ahoraComparable) {
        alert('La fecha de inicio no puede ser futura');
        return;
    }

    if (fechaFinCompleta > ahoraComparable) {
        alert('La fecha de fin no puede ser futura');
        return;
    }

    if (fechaInicioCompleta > fechaFinCompleta) {
        alert('La fecha de inicio no puede ser posterior a la fecha de fin');
        return;
    }


    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        // Resetear barra de progreso y texto (ya que no hay OSRM en frontend)
        const progressBar = document.getElementById('routeProgressBar');
        const progressText = document.getElementById('routeProgressText');
        if(progressBar) progressBar.style.width = '0%';
        if(progressText) progressText.textContent = 'Cargando datos...'; // Cambiar texto
        loadingOverlay.classList.add('active');
    }

    const basePath = window.getBasePath ? window.getBasePath() : '';
    const url = `${basePath}/historico/rango?inicio=${fechaInicio}&fin=${fechaFin}&hora_inicio=${horaInicio}&hora_fin=${horaFin}`;

    try {
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            datosHistoricosOriginales = data;

            if (geofenceLayer) {
                // Ya no es async
                aplicarFiltroGeocerca();
            } else {
                 // Ya no es async
                mostrarHistorico(data);
            }

            const searchModal = document.getElementById('searchModal');
            if (searchModal) {
                searchModal.classList.remove('active');
            }
        } else {
            alert('No hay datos para ese rango de fechas o error del servidor.');
            if (loadingOverlay) loadingOverlay.classList.remove('active');
        }
    } catch (error) {
        console.error('Error al consultar histórico:', error);
        alert('Error al consultar histórico.');
        if (loadingOverlay) loadingOverlay.classList.remove('active');
    }
}

function limpiarMapa(preserveGeofence = false) {
    if (polylineHistorica) {
        map.removeLayer(polylineHistorica);
        polylineHistorica = null;
    }

    polylinesHistoricas.forEach(poly => {
        map.removeLayer(poly);
    });
    polylinesHistoricas = [];

    marcadoresHistoricos.forEach(marker => {
        map.removeLayer(marker);
    });
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
        if (drawnItems) {
            drawnItems.clearLayers();
        }
        geofenceLayer = null;
        datosHistoricosOriginales = [];
        // No necesitamos llamar a establecerValoresDefectoFechas aquí,
        // porque solo queremos limpiar el mapa, no resetear la interfaz.
    }

    if (window.updateModalInfo) {
        window.updateModalInfo();
    }
}

// aplicarFiltroGeocerca ahora NO es async
function aplicarFiltroGeocerca() {
    const fechaInicio = document.getElementById('fechaInicio').value;
    const horaInicio = document.getElementById('horaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const horaFin = document.getElementById('horaFin').value;

    let datosFiltradosTiempo = filtrarPorRangoCompleto(datosHistoricosOriginales, fechaInicio, horaInicio, fechaFin, horaFin);

    let datosParaMostrar = datosFiltradosTiempo;

    if (geofenceLayer) {
        const bounds = geofenceLayer.getBounds();
        datosParaMostrar = datosFiltradosTiempo.filter(p =>
            bounds.contains([p.lat, p.lon])
        );
    }
    // No es async
    dibujarRutaEnMapa(datosParaMostrar);
}


async function fetchDatosPorGeocerca(bounds) {
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

    const loadingOverlay = document.getElementById('loadingOverlay');
     if (loadingOverlay) {
        // Resetear barra de progreso y texto (ya que no hay OSRM en frontend)
        const progressBar = document.getElementById('routeProgressBar');
        const progressText = document.getElementById('routeProgressText');
        if(progressBar) progressBar.style.width = '0%';
        if(progressText) progressText.textContent = 'Cargando datos...'; // Cambiar texto
        loadingOverlay.classList.add('active');
    }

    try {
        const response = await fetch(url);
        if (response.ok) {
            const responseData = await response.json(); // Renombrado para claridad
            if (responseData.length === 0) {
                 alert('No se encontraron datos históricos en esta área');
                 if (loadingOverlay) loadingOverlay.classList.remove('active');
                 return;
            }
            // Ya no es async
            dibujarRutaEnMapa(responseData);

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

function limpiarGeocerca() {
    if (geofenceLayer) {
        drawnItems.removeLayer(geofenceLayer);
        geofenceLayer = null;
        // Si teníamos datos originales cargados (filtro de tiempo),
        // volvemos a mostrarlos completos.
        if (datosHistoricosOriginales.length > 0) {
            mostrarHistorico(datosHistoricosOriginales);
        } else {
             limpiarMapa(); // Si no, simplemente limpiamos
        }
    }
}


function toggleMarcadores() {
    marcadoresVisibles = !marcadoresVisibles;
    const toggleText = document.getElementById('toggleMarcadoresText');

    marcadoresHistoricos.forEach(marker => {
        if (marcadoresVisibles) {
            map.addLayer(marker);
        } else {
            map.removeLayer(marker);
        }
    });

    toggleText.textContent = marcadoresVisibles ? 'Ocultar Marcadores' : 'Mostrar Marcadores';
}

function ajustarVista() {
    if (geofenceLayer) {
        map.fitBounds(geofenceLayer.getBounds());
    } else if (polylineHistorica) {
        map.fitBounds(polylineHistorica.getBounds());
    } else if (polylinesHistoricas.length > 0) {
        const segmentsGroup = L.featureGroup(polylinesHistoricas);
        // Añadir los marcadores al grupo para asegurar que se vean todos
        marcadoresHistoricos.forEach(m => segmentsGroup.addLayer(m));
        map.fitBounds(segmentsGroup.getBounds());
    } else if (marcadoresHistoricos.length > 0) {
        const pointsGroup = L.featureGroup(marcadoresHistoricos);
        map.fitBounds(pointsGroup.getBounds());
    }
     // Si no hay nada, no hacemos nada (el mapa se queda como está)
}

function exportarDatos() {
    if (datosHistoricos.length === 0) {
        alert('No hay datos para exportar');
        return;
    }

    const fechaInicio = document.getElementById('fechaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const csvContent = 'data:text/csv;charset=utf-8,' +
        'Latitud,Longitud,Timestamp\n' +
        datosHistoricos.map(punto =>
            `${punto.lat},${punto.lon},${punto.timestamp}`
        ).join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `historical_data_${fechaInicio || 'geofence'}_to_${fechaFin || 'all'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

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


function establecerValoresDefectoFechas() {
    const hoy = obtenerFechaActual();
    document.getElementById('fechaInicio').value = hoy;
    document.getElementById('fechaFin').value = hoy;
    document.getElementById('horaInicio').value = '00:00';
    document.getElementById('horaFin').value = obtenerHoraActual();

    actualizarRestriccionesFechas();
    // No llamamos a verHistoricoRango()
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

    // Convertir a YYYY-MM-DD
    const inicioStr = hace7Dias.toISOString().split('T')[0];
    const finStr = obtenerFechaActual(); // Fin es hoy (formato YYYY-MM-DD)

    document.getElementById('fechaInicio').value = inicioStr;
    document.getElementById('fechaFin').value = finStr;
    document.getElementById('horaInicio').value = '00:00';
    document.getElementById('horaFin').value = obtenerHoraActual(); // Hasta la hora actual

    actualizarRestriccionesFechas();
    verHistoricoRango(); // Ejecutar búsqueda
}


function actualizarRestriccionesFechas() {
    const fechaInicio = document.getElementById('fechaInicio');
    const fechaFin = document.getElementById('fechaFin');
    const hoy = obtenerFechaActual(); // YYYY-MM-DD de hoy

    // Máximo siempre es hoy
    fechaInicio.max = hoy;
    fechaFin.max = hoy;

    // Fin no puede ser antes que inicio
    if (fechaInicio.value) {
        fechaFin.min = fechaInicio.value;
        // Si fin actual es menor que el nuevo min, ajustarlo
        if (fechaFin.value && fechaFin.value < fechaInicio.value) {
            fechaFin.value = fechaInicio.value;
        }
    } else {
        fechaFin.removeAttribute('min'); // Si no hay inicio, no hay mínimo
    }

    // Inicio no puede ser después que fin (esto es redundante si min está bien, pero por si acaso)
    if (fechaFin.value && fechaInicio.value && fechaInicio.value > fechaFin.value) {
         fechaInicio.value = fechaFin.value;
    }


    actualizarRestriccionesHora();
}

function configurarValidacionFechas() {
    const fechaInicio = document.getElementById('fechaInicio');
    const fechaFin = document.getElementById('fechaFin');
    const horaInicio = document.getElementById('horaInicio');
    const horaFin = document.getElementById('horaFin');

    const hoy = obtenerFechaActual();
    fechaInicio.max = hoy;
    fechaFin.max = hoy;

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

    // Limpiar restricciones previas
    horaInicio.removeAttribute('max');
    horaFin.removeAttribute('min');
    horaFin.removeAttribute('max');

    // Si fecha fin es hoy, hora fin no puede ser futura
    if (fechaFin.value === hoy) {
        horaFin.max = horaActual;
        // Ajustar si se pasa
        if (horaFin.value > horaActual) {
            horaFin.value = horaActual;
        }
    }

    // Si las fechas son iguales
    if (fechaInicio.value && fechaFin.value && fechaInicio.value === fechaFin.value) {
        // Hora fin debe ser >= hora inicio
        if (horaInicio.value) {
            horaFin.min = horaInicio.value;
            // Ajustar si se pasa
            if (horaFin.value && horaFin.value < horaInicio.value) {
                 horaFin.value = horaInicio.value;
            }
             // Asegurarse de que el max (si es hoy) tenga precedencia
             if (fechaFin.value === hoy && horaFin.max && horaFin.value > horaFin.max) {
                 horaFin.value = horaFin.max;
             }

        }
        // Hora inicio debe ser <= hora fin (redundante si min está bien, pero por si acaso)
        // Y si es hoy, no puede ser mayor que la hora actual
         if (horaFin.value) {
             let maxHoraInicio = horaFin.value;
             if (fechaInicio.value === hoy && horaActual < maxHoraInicio) {
                 maxHoraInicio = horaActual;
             }
             horaInicio.max = maxHoraInicio;
             if (horaInicio.value > maxHoraInicio) {
                 horaInicio.value = maxHoraInicio;
             }
         }


    } else {
        // Si las fechas son distintas, no hay restricciones relativas entre horas
        // (solo la restricción de que hora fin no sea futura si fecha fin es hoy)
        horaFin.removeAttribute('min');

    }
     // Si fecha inicio es hoy, hora inicio no puede ser futura
    if (fechaInicio.value === hoy) {
         horaInicio.max = horaActual;
         if (horaInicio.value > horaActual) {
             horaInicio.value = horaActual;
         }
    }
}

function initSearchModal() {
    const searchBtn = document.getElementById('searchBtn');
    const searchModal = document.getElementById('searchModal');
    const closeSearchModal = document.getElementById('closeSearchModal');

    if (!searchBtn || !searchModal || !closeSearchModal) {
        console.error('Elementos del modal no encontrados');
        return;
    }

    searchBtn.addEventListener('click', () => searchModal.classList.add('active'));
    closeSearchModal.addEventListener('click', () => searchModal.classList.remove('active'));
    searchModal.addEventListener('click', (e) => {
        if (e.target === searchModal) searchModal.classList.remove('active');
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && searchModal.classList.contains('active')) {
            searchModal.classList.remove('active');
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (window.setupViewNavigation) {
        window.setupViewNavigation();
    }
    initializeMap();
    establecerValoresDefectoFechas(); // Solo establece valores, no busca
    configurarValidacionFechas();

    const cancelBtn = document.getElementById('cancelRouteBtn');
    if (cancelBtn) {
       cancelBtn.style.display = 'none'; // Ocultarlo o quitarlo del HTML
       // Ya no necesitamos el listener
    }
});

window.addEventListener('load', () => {
    initSearchModal();
});