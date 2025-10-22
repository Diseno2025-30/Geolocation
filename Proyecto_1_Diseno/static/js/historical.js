let map;
let polylineHistorica = null;
let polylinesHistoricas = []; // Para los segmentos de ruta recortados
let marcadoresHistoricos = [];
let marcadoresVisibles = true;
let datosHistoricos = [];
let datosHistoricosOriginales = [];
let geofenceLayer = null;
let drawnItems;

// 1. AÑADIMOS UNA VARIABLE GLOBAL PARA CANCELAR
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
            polygon: false, // Deshabilitar otras formas
            polyline: false,
            circle: false,
            circlemarker: false,
            marker: false,
            rectangle: { // Habilitar solo rectángulos
                shapeOptions: {
                    color: '#3b82f6', // Color azul
                    weight: 3,
                    opacity: 0.7
                }
            }
        }
    });
    map.addControl(drawControl);

    
    map.on(L.Draw.Event.CREATED, function (e) {
        // Si ya existe una, borrarla primero
        if (geofenceLayer) {
            drawnItems.removeLayer(geofenceLayer);
        }
        geofenceLayer = e.layer;
        drawnItems.addLayer(geofenceLayer);
        
        // --- LÓGICA DUAL ---
        // Si `datosHistoricosOriginales` tiene datos, es porque ya hicimos un filtro de TIEMPO.
        // En ese caso, filtramos localmente.
        if (datosHistoricosOriginales.length > 0) {
            console.log("Filtrando datos locales por geocerca");
            aplicarFiltroGeocerca();
        } else {
            // Si no hay datos, es un filtro de GEOCERCA solamente.
            // Llamamos al nuevo endpoint.
            console.log("Consultando al servidor por geocerca");
            fetchDatosPorGeocerca(geofenceLayer.getBounds());
        }
    });

    // Al EDITAR una geocerca
    map.on(L.Draw.Event.EDITED, function (e) {
        geofenceLayer = e.layers.getLayers()[0]; // Asumimos una sola capa
        
        // --- LÓGICA DUAL ---
        if (datosHistoricosOriginales.length > 0) {
            aplicarFiltroGeocerca();
        } else {
            fetchDatosPorGeocerca(geofenceLayer.getBounds());
        }
    });

    // Al BORRAR una geocerca (con el botón de la barra de herramientas)
    map.on(L.Draw.Event.DELETED, function () {
        geofenceLayer = null;
        // Esto funciona para ambos casos:
        // 1. Si había filtro de tiempo, recarga la ruta de tiempo.
        // 2. Si solo había geocerca, limpia el mapa (porque datosHistoricosOriginales está vacío).
        aplicarFiltroGeocerca();
    });
    
    // 3. Eliminamos el queryInfo, ya que la duración va en otro lado
    const infoDiv = document.getElementById('queryInfo');
    if (infoDiv) {
        infoDiv.remove();
    }
}

/**
 * Recorta una polilínea (array de coords) contra un L.LatLngBounds.
 * Devuelve un array de segmentos (arrays de coords) que están DENTRO.
 */
function clipPolyline(coordinates, bounds) {
    const segments = [];
    let currentSegment = [];

    for (let i = 0; i < coordinates.length; i++) {
        // Coordenadas de la ruta OSRM (Leaflet usa [lat, lon])
        const latlng = L.latLng(coordinates[i][0], coordinates[i][1]);
        
        if (bounds.contains(latlng)) {
            // Este punto está DENTRO del rectángulo
            currentSegment.push(coordinates[i]);
        } else {
            // Este punto está FUERA del rectángulo
            if (currentSegment.length > 0) {
                // Acabamos de salir. Guardar el segmento que teníamos.
                segments.push(currentSegment);
                currentSegment = [];
            }
        }
    }

    // Si el último punto estaba dentro, guardar el segmento final
    if (currentSegment.length > 0) {
        segments.push(currentSegment);
    }

    return segments;
}


function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function parseTimestamp(timestamp) {
    const [datePart, timePart] = timestamp.split(' ');
    const [day, month, year] = datePart.split('/');
    return new Date(`${year}-${month}-${day}T${timePart}`);
}

function filtrarPorRangoCompleto(datos, fechaInicio, horaInicio, fechaFin, horaFin) {
    if (!fechaInicio || !fechaFin) return datos;
    
    const fechaHoraInicio = new Date(`${fechaInicio}T${horaInicio || '00:00'}:00`);
    const fechaHoraFin = new Date(`${fechaFin}T${horaFin || '23:59'}:59`);
    
    return datos.filter(punto => {
        const fechaPunto = parseTimestamp(punto.timestamp);
        return fechaPunto >= fechaHoraInicio && fechaPunto <= fechaHoraFin;
    });
}

// ========== FUNCIONES PARA ROUTING POR CALLES ==========

/**
 * Obtiene la ruta por calles entre dos puntos usando OSRM
 */
async function obtenerRutaOSRM(lat1, lon1, lat2, lon2) {
    try {
        const basePath = window.getBasePath ? window.getBasePath() : '';
        const url = `${basePath}/osrm/route/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            console.warn(`OSRM route not available (${response.status}), using straight line`);
            return null;
        }
        
        const data = await response.json();
        
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const coordinates = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
            return coordinates;
        }
        
        console.warn('OSRM no encontró ruta, usando línea recta');
        return null;
    } catch (error) {
        console.error('Error obteniendo ruta de OSRM:', error);
        return null;
    }
}

/**
 * Genera la ruta completa siguiendo las calles
 */
async function generarRutaPorCalles(puntos) {
    if (puntos.length < 2) {
        return puntos;
    }
    
    // 1. RESETEAMOS LA BANDERA DE CANCELACIÓN
    isRouteGenerationCancelled = false;
    
    // Mostrar indicador de carga
    const loadingOverlay = document.getElementById('loadingOverlay');
    const progressBar = document.getElementById('routeProgressBar');
    const progressText = document.getElementById('routeProgressText');
    
    if (loadingOverlay) {
        loadingOverlay.classList.add('active');
    }
    
    const segmentosRuta = [];
    let rutasExitosas = 0;
    let rutasFallidas = 0;
    const totalSegmentos = puntos.length - 1;
    
    console.log(`Generando ruta por calles para ${puntos.length} puntos...`);
    
    for (let i = 0; i < puntos.length - 1; i++) {
        
        // 1. COMPROBAMOS SI EL USUARIO CANCELÓ
        if (isRouteGenerationCancelled) {
            console.log("¡Ruta cancelada por el usuario!");
            break; // Salir del bucle
        }

        // **IMPORTANTE**: Usamos los puntos filtrados originales (que ya están en la calle)
        // para calcular la ruta OSRM *entre* ellos.
        const [lat1, lon1] = [puntos[i].lat, puntos[i].lon];
        const [lat2, lon2] = [puntos[i+1].lat, puntos[i+1].lon];
        
        // Actualizar progreso
        const progreso = Math.round(((i + 1) / totalSegmentos) * 100);
        if (progressBar) {
            progressBar.style.width = `${progreso}%`;
        }
        if (progressText) {
            progressText.textContent = `${i + 1} / ${totalSegmentos} segmentos`;
        }
        
        // Intentar obtener ruta por calles
        const rutaOSRM = await obtenerRutaOSRM(lat1, lon1, lat2, lon2);
        
        if (rutaOSRM && rutaOSRM.length > 0) {
            if (i === 0) {
                segmentosRuta.push(...rutaOSRM);
            } else {
                segmentosRuta.push(...rutaOSRM.slice(1));
            }
            rutasExitosas++;
        } else {
            // Fallback a línea recta (tal como lo teníamos)
            if (i === 0) {
                segmentosRuta.push([lat1, lon1]);
            }
            segmentosRuta.push([lat2, lon2]);
            rutasFallidas++;
        }
    }
    
    // Ocultar indicador de carga
    if (loadingOverlay) {
        loadingOverlay.classList.remove('active');
    }
    
    console.log(`✓ Ruta generada: ${rutasExitosas} segmentos por calles, ${rutasFallidas} líneas rectas`);
    return segmentosRuta;
}

async function dibujarRutaEnMapa(datosFiltrados) {
    limpiarMapa(true); // Limpiar mapa pero preservar geocerca
    
    if (datosFiltrados.length === 0) {
        document.getElementById('historicalControls').style.display = 'block';
        actualizarInformacionHistorica(datosFiltrados); // Limpiará la info
        return;
    }

    datosHistoricos = datosFiltrados; // Actualizar datos globales
    
    // --- ¡NUEVA LÓGICA DE DIBUJO HÍBRIDA! ---

    // 1. Agrupar puntos GPS por coordenada para los popups
    console.log(`Agrupando ${datosFiltrados.length} puntos GPS...`);
    const puntosAgrupados = new Map();
    for (const punto of datosFiltrados) {
        const key = `${punto.lat},${punto.lon}`;
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

    // 2. OBTENER LA RUTA OSRM COMPLETA (o parcial si se cancela)
    // Pasamos los 'datosFiltrados' (que tienen lat/lon)
    const puntosRuta = await generarRutaPorCalles(datosFiltrados);
    
    // 1. CORRECCIÓN CANCELAR: No usamos 'return', solo seguimos con la ruta parcial
    if (isRouteGenerationCancelled) {
        console.log('Dibujo de ruta parcial por cancelación.');
    }

    const polylineOptions = {
        color: '#4C1D95', // Color morado para la ruta OSRM
        weight: 4,
        opacity: 0.8
    };

    // 3. DIBUJAR LA RUTA (parcial, recortada, o completa)
    if (geofenceLayer) {
        // MODO GEOCERCA: Recortar la ruta OSRM y dibujar segmentos
        console.log('Geocerca activa. Recortando ruta OSRM...');
        const geofenceBounds = geofenceLayer.getBounds();
        const clippedSegments = clipPolyline(puntosRuta, geofenceBounds);
        
        console.log(`Ruta recortada en ${clippedSegments.length} segmentos.`);
        
        clippedSegments.forEach(segment => {
            if (segment.length > 1) { // Solo dibujar si hay más de 1 punto
                const poly = L.polyline(segment, polylineOptions).addTo(map);
                polylinesHistoricas.push(poly);
            }
        });
        
    } else {
        // MODO NORMAL: Dibujar ruta OSRM completa (o parcial)
        console.log('Sin geocerca. Dibujando ruta OSRM...');
        if (puntosRuta.length > 0) {
            polylineHistorica = L.polyline(puntosRuta, polylineOptions).addTo(map);
        }
    }

    // 4. DIBUJAR LOS MARCADORES (PUNTOS)
    // Esto se ejecuta SIEMPRE, incluso si la ruta se canceló.
    console.log(`Dibujando ${uniquePoints.length} puntos únicos en la trayectoria...`);
    uniquePoints.forEach(punto => {
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
    });


    // 5. AJUSTAR LA VISTA
    if (geofenceLayer) {
        // Si hay geocerca, ajustar a la geocerca
        map.fitBounds(geofenceLayer.getBounds());
    } else if (polylineHistorica) {
        // Si no hay geocerca y sí ruta, ajustar a la ruta
        map.fitBounds(polylineHistorica.getBounds());
    } else if (polylinesHistoricas.length > 0) {
        // Si se canceló y hay segmentos, ajustar a los segmentos
        const segmentsGroup = L.featureGroup(polylinesHistoricas);
        map.fitBounds(segmentsGroup.getBounds());
    } else if (marcadoresHistoricos.length > 0) {
        // Fallback: ajustar a los puntos
        const pointsGroup = L.featureGroup(marcadoresHistoricos);
        map.fitBounds(pointsGroup.getBounds());
    }

    // --- FIN NUEVA LÓGICA ---
    
    actualizarInformacionHistorica(datosFiltrados);
    
    document.getElementById('historicalControls').style.display = 'block';
    
    const ahoraColombia = obtenerFechaHoraColombia();
    lastQueryElement.textContent = ahoraColombia.toLocaleTimeString('es-CO', { 
        timeZone: 'UTC',
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
    
    if (window.updateModalInfo) {
        window.updateModalInfo();
    }
}


async function mostrarHistorico(coordenadas) {
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
    
    await dibujarRutaEnMapa(datosFiltrados);
}

// === 3. FUNCIÓN DE DURACIÓN ACTUALIZADA ===
// === FUNCIÓN DE DURACIÓN ACTUALIZADA ===
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

    // Lógica de Distancia (sin cambios)
    let distanciaTotal = 0;
    for (let i = 1; i < datos.length; i++) {
        distanciaTotal += calcularDistancia(
            datos[i-1].lat, datos[i-1].lon,
            datos[i].lat, datos[i].lon
        );
    }
    distanciaTotalElement.textContent = `${distanciaTotal.toFixed(2)} km`;

    // --- ¡AQUÍ EMPIEZA LA LÓGICA DE DURACIÓN MODIFICADA! ---

    // Función auxiliar para formatear la duración
    function formatDuration(durationMs) {
        const dias = Math.floor(durationMs / (1000 * 60 * 60 * 24));
        const horas = Math.floor((durationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutos = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
        //const segundos = Math.floor((durationMs % (1000 * 60)) / 1000); // Añadimos segundos

        let parts = [];
        if (dias > 0) parts.push(`${dias} ${dias === 1 ? 'día' : 'días'}`);
        if (horas > 0) parts.push(`${horas} ${horas === 1 ? 'hora' : 'horas'}`);
        if (minutos > 0) parts.push(`${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`);
        //if (segundos > 0 || parts.length === 0) parts.push(`${segundos} ${segundos === 1 ? 'segundo' : 'segundos'}`); // Mostrar segundos si es lo único o si hay
        // Decidimos no mostrar segundos para mantenerlo más limpio
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
            const diaKey = fechaPunto.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' }); // Formato DD/MM/YYYY

            // Calculamos la duración desde el punto anterior (si existe y es del mismo día)
            let duracionSegmentoMs = 0;
            if (i > 0) {
                const puntoAnterior = datos[i - 1];
                const fechaAnterior = parseTimestamp(puntoAnterior.timestamp);
                // Solo sumar si es consecutivo en el mismo día
                if (fechaAnterior.toDateString() === fechaPunto.toDateString()) {
                     // Estimamos la duración como el tiempo hasta el siguiente punto
                    duracionSegmentoMs = fechaPunto - fechaAnterior;
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
             htmlDuracion = '---'; // Fallback
        }

        // Ordenar los días antes de mostrarlos (usando un truco para ordenar DD/MM/YYYY)
        const diasOrdenados = Array.from(mapaDias.keys()).sort((a, b) => {
            const [dayA, monthA, yearA] = a.split('/');
            const [dayB, monthB, yearB] = b.split('/');
            return new Date(`${yearA}-${monthA}-${dayA}`) - new Date(`${yearB}-${monthB}-${dayB}`);
        });


        for (const dia of diasOrdenados) {
            const stats = mapaDias.get(dia);
            const formattedDuration = formatDuration(stats.totalDurationMs);
            htmlDuracion += `${dia}: ${formattedDuration}<br>`;
        }

        duracionElement.innerHTML = htmlDuracion; // Usar innerHTML por los <br>

    } else {
        // 2. CÁLCULO DE DURACIÓN TOTAL (Sin Geocerca)
        const tiempoInicial = parseTimestamp(primerPunto.timestamp);
        const tiempoFinal = parseTimestamp(ultimoPunto.timestamp);
        const duracionMs = tiempoFinal - tiempoInicial;
        const formattedDuration = formatDuration(duracionMs);

        duracionElement.textContent = formattedDuration; // Usar textContent
    }
}


async function verHistoricoRango() {
    const fechaInicio = document.getElementById('fechaInicio').value;
    const horaInicio = document.getElementById('horaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const horaFin = document.getElementById('horaFin').value;
    
    // Validaciones básicas
    if (!fechaInicio || !fechaFin) {
        alert('Debes seleccionar tanto la fecha de inicio como la fecha de fin');
        return;
    }
    
    // Validación adicional: verificar que las fechas no sean futuras (usando hora de Colombia)
    const ahoraColombia = new Date();
    const fechaInicioCompleta = new Date(`${fechaInicio}T${horaInicio || '00:00'}:00`);
    const fechaFinCompleta = new Date(`${fechaFin}T${horaFin || '23:59'}:00`);
    
    // Convertir ahoraColombia a fecha comparable (en UTC para comparación justa)
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

    // Mostrar overlay de carga ANTES de llamar
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.classList.add('active');
    }
    
    const basePath = window.getBasePath ? window.getBasePath() : '';
    // --- URL ACTUALIZADA ---
    const url = `${basePath}/historico/rango?inicio=${fechaInicio}&fin=${fechaFin}&hora_inicio=${horaInicio}&hora_fin=${horaFin}`;
    
    try {
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            
            datosHistoricosOriginales = data;
            
            // Si hay una geocerca, aplicarla. Si no, solo mostrar historico
            if (geofenceLayer) {
                await aplicarFiltroGeocerca();
            } else {
                await mostrarHistorico(data);
            }
            
            const searchModal = document.getElementById('searchModal');
            if (searchModal) {
                searchModal.classList.remove('active');
            }
        } else {
            alert('No hay datos para ese rango de fechas');
            if (loadingOverlay) loadingOverlay.classList.remove('active');
        }
    } catch (error) {
        console.error('Error al consultar histórico:', error);
        alert('Error al consultar histórico');
        if (loadingOverlay) loadingOverlay.classList.remove('active');
    }
}

function limpiarMapa(preserveGeofence = false) {
    if (polylineHistorica) {
        map.removeLayer(polylineHistorica);
        polylineHistorica = null;
    }
    
    // --- ACTUALIZADO ---
    // Limpiar los segmentos de polilínea recortados
    polylinesHistoricas.forEach(poly => {
        map.removeLayer(poly);
    });
    polylinesHistoricas = [];
    // --- FIN ACTUALIZADO ---
    
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
    duracionElement.innerHTML = '---'; // .innerHTML para consistencia
    
    datosHistoricos = [];
    
    if (!preserveGeofence) {
        if (drawnItems) {
            drawnItems.clearLayers();
        }
        geofenceLayer = null;
        datosHistoricosOriginales = []; // Limpiar datos originales también
        
        // 2. Limpiar los campos de fecha al valor por defecto
        establecerValoresDefectoFechas();
    }
    
    if (window.updateModalInfo) {
        window.updateModalInfo();
    }
}

// Esta función ahora SÍ filtra los puntos
async function aplicarFiltroGeocerca() {
    const fechaInicio = document.getElementById('fechaInicio').value;
    const horaInicio = document.getElementById('horaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const horaFin = document.getElementById('horaFin').value;

    let datosFiltradosTiempo = filtrarPorRangoCompleto(datosHistoricosOriginales, fechaInicio, horaInicio, fechaFin, horaFin);

    let datosParaMostrar = datosFiltradosTiempo;

    // Esta es la lógica clave: filtramos los PUNTOS
    // antes de pasarlos a dibujar.
    if (geofenceLayer) {
        const bounds = geofenceLayer.getBounds();
        datosParaMostrar = datosFiltradosTiempo.filter(p => 
            bounds.contains([p.lat, p.lon])
        );
    }

    await dibujarRutaEnMapa(datosParaMostrar);
}

/**
 * Busca en la base de datos todos los puntos dentro de una geocerca
 */
async function fetchDatosPorGeocerca(bounds) {
    const startTime = performance.now();
    const sw = bounds.getSouthWest(); // Esquina Suroeste (min_lat, min_lon)
    const ne = bounds.getNorthEast(); // Esquina Noreste (max_lat, max_lon)
    if (!sw || !ne || isNaN(sw.lat) || isNaN(sw.lng) || isNaN(ne.lat) || isNaN(ne.lng)) {
        console.error('Coordenadas de geocerca inválidas:', bounds);
        alert('Error: El área seleccionada no es válida.');
        return;
    }
    const basePath = window.getBasePath ? window.getBasePath() : '';
    const url = `${basePath}/historico/geocerca?min_lat=${sw.lat}&min_lon=${sw.lng}&max_lat=${ne.lat}&max_lon=${ne.lng}`;

    // Limpiar cualquier ruta anterior, pero mantener la geocerca
    limpiarMapa(true);

    // Mostrar overlay de carga
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.classList.add('active');
    }

    let responseData = null;
    try {
        const response = await fetch(url);
        if (response.ok) {
            // Intenta parsear JSON solo si la respuesta fue OK
            responseData = await response.json();
            const endTime = performance.now(); // Parar contador aquí
            const duration = ((endTime - startTime) / 1000).toFixed(2);
            console.log(`Consulta de geocerca (servidor) completada en ${duration} segundos.`);

            if (responseData.length === 0) {
                 alert('No se encontraron datos históricos en esta área');
                 if (loadingOverlay) loadingOverlay.classList.remove('active');
                 return;
            }

            // Ya no mostramos showQueryInfo aquí, lo hará actualizarInformacionHistorica

            // ¡Importante!
            // NO establecemos datosHistoricosOriginales
            // Solo dibujamos lo que recibimos
            await dibujarRutaEnMapa(responseData);

        } else {
            // Si el servidor devolvió un error (4xx, 5xx)
            console.error('Error del servidor al consultar geocerca:', response.status, response.statusText);
            // Intentar leer el cuerpo del error como texto
            let errorBody = 'No se pudo leer el cuerpo del error.';
            try {
                errorBody = await response.text();
                console.error('Cuerpo del error:', errorBody);
            } catch (e) {
                console.error('Error al leer el cuerpo de la respuesta de error:', e);
            }
            alert(`Error del servidor (${response.status}): ${response.statusText}. ${errorBody.substring(0, 100)}`);
            // Asegurarse de ocultar el overlay en caso de error de servidor
             if (loadingOverlay) loadingOverlay.classList.remove('active');
        }
    } catch (error) {
        // Si falló el fetch, el .json(), o dibujarRutaEnMapa()
        console.error('Error detallado en fetchDatosPorGeocerca:', error); // Log más detallado
        // Mostrar un mensaje más específico si es posible
        let errorMessage = 'Error al consultar por geocerca.';
        if (error instanceof SyntaxError) {
            errorMessage = 'Error: La respuesta del servidor no es JSON válido.';
        } else if (error instanceof TypeError) {
             errorMessage = 'Error: Problema de red o configuración (CORS?).';
        } else if (error.message) {
            errorMessage = `Error: ${error.message}`;
        }
        alert(errorMessage);
        // Asegurarse de ocultar el overlay en caso de error general
        if (loadingOverlay) loadingOverlay.classList.remove('active');
    }
}

function limpiarGeocerca() {
    if (geofenceLayer) {
        drawnItems.removeLayer(geofenceLayer);
        geofenceLayer = null;
        aplicarFiltroGeocerca(); // Vuelve a aplicar filtros (sin geocerca)
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
        // Si hay geocerca, ajustar a la geocerca
        map.fitBounds(geofenceLayer.getBounds());
    } else if (polylineHistorica) {
        // Si no hay geocerca y sí ruta, ajustar a la ruta
        map.fitBounds(polylineHistorica.getBounds());
    } else if (polylinesHistoricas.length > 0) {
        // Si hay segmentos (ruta parcial/recortada), ajustar a ellos
        const segmentsGroup = L.featureGroup(polylinesHistoricas);
        map.fitBounds(segmentsGroup.getBounds());
    } else if (marcadoresHistoricos.length > 0) {
        // Fallback: ajustar a los puntos
        const pointsGroup = L.featureGroup(marcadoresHistoricos);
        map.fitBounds(pointsGroup.getBounds());
    }
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

/**
 * Obtiene la fecha y hora actual en zona horaria de Colombia (UTC-5)
 */
function obtenerFechaHoraColombia() {
    // Obtener fecha/hora UTC
    const ahoraUTC = new Date();
    
    // Convertir a UTC-5 (Colombia)
    // getTime() da milisegundos desde epoch
    // Restamos 5 horas (5 * 60 * 60 * 1000 ms)
    const offsetColombia = -5 * 60 * 60 * 1000;
    const ahoraColombia = new Date(ahoraUTC.getTime() + offsetColombia);
    
    return ahoraColombia;
}

/**
 * Obtiene la fecha actual en formato YYYY-MM-DD (hora de Colombia)
 */
function obtenerFechaActual() {
    const ahoraColombia = obtenerFechaHoraColombia();
    const año = ahoraColombia.getUTCFullYear();
    const mes = String(ahoraColombia.getUTCMonth() + 1).padStart(2, '0');
    const dia = String(ahoraColombia.getUTCDate()).padStart(2, '0');
    return `${año}-${mes}-${dia}`;
}

/**
 * Obtiene la hora actual en formato HH:MM (hora de Colombia)
 */
function obtenerHoraActual() {
    const ahoraColombia = obtenerFechaHoraColombia();
    const horas = String(ahoraColombia.getUTCHours()).padStart(2, '0');
    const minutos = String(ahoraColombia.getUTCMinutes()).padStart(2, '0');
    return `${horas}:${minutos}`;
}

/**
 * 2. NUEVA FUNCIÓN: Solo establece los valores por defecto, sin buscar
 */
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

    // 2. EJECUTAR LA BÚSQUEDA INMEDIATAMENTE (al hacer clic)
    verHistoricoRango();
}

function establecerRangoUltimos7Dias() {
    const hoy = new Date();
    const hace7Dias = new Date(hoy);
    hace7Dias.setDate(hoy.getDate() - 7);
    
    document.getElementById('fechaInicio').value = hace7Dias.toISOString().split('T')[0];
    document.getElementById('fechaFin').value = obtenerFechaActual();
    document.getElementById('horaInicio').value = '00:00';
    document.getElementById('horaFin').value = obtenerHoraActual();
    
    actualizarRestriccionesFechas();

    // 2. EJECUTAR LA BÚSQUEDA INMEDIATAMENTE (al hacer clic)
    verHistoricoRango();
}

/**
 * Actualiza las restricciones de los campos de fecha
 */
function actualizarRestriccionesFechas() {
    const fechaInicio = document.getElementById('fechaInicio');
    const fechaFin = document.getElementById('fechaFin');
    const hoy = obtenerFechaActual();
    
    // IMPORTANTE: Las fechas SIEMPRE tienen como máximo HOY
    // No debemos cambiar este max bajo ninguna circunstancia
    fechaInicio.max = hoy;
    fechaFin.max = hoy;
    
    // La fecha de fin no puede ser anterior a la fecha de inicio
    if (fechaInicio.value) {
        fechaFin.min = fechaInicio.value;
        
        // Si fecha fin es anterior a fecha inicio, ajustarla
        if (fechaFin.value && fechaFin.value < fechaInicio.value) {
            fechaFin.value = fechaInicio.value;
        }
    } else {
        // Si no hay fecha inicio, remover restricción min
        fechaFin.removeAttribute('min');
    }
    
    // Si fecha inicio es posterior a fecha fin, ajustar fecha inicio
    if (fechaInicio.value && fechaFin.value && fechaInicio.value > fechaFin.value) {
        fechaInicio.value = fechaFin.value;
    }
    
    // Actualizar restricciones de hora
    actualizarRestriccionesHora();
}

/**
 * Configura los event listeners para validación de fechas
 */
function configurarValidacionFechas() {
    const fechaInicio = document.getElementById('fechaInicio');
    const fechaFin = document.getElementById('fechaFin');
    const horaInicio = document.getElementById('horaInicio');
    const horaFin = document.getElementById('horaFin');
    
    // Establecer valores máximos iniciales
    const hoy = obtenerFechaActual();
    fechaInicio.max = hoy;
    fechaFin.max = hoy;
    
    // Event listener para fecha de inicio
    fechaInicio.addEventListener('change', function() {
        actualizarRestriccionesFechas();
    });
    
    // Event listener para fecha de fin
    fechaFin.addEventListener('change', function() {
        actualizarRestriccionesFechas();
    });
    
    // Event listeners para horas
    horaInicio.addEventListener('change', function() {
        actualizarRestriccionesHora();
    });
    
    horaFin.addEventListener('change', function() {
        actualizarRestriccionesHora();
    });
}

/**
 * Actualiza las restricciones de los campos de hora
 */
function actualizarRestriccionesHora() {
    const fechaInicio = document.getElementById('fechaInicio');
    const fechaFin = document.getElementById('fechaFin');
    const horaInicio = document.getElementById('horaInicio');
    const horaFin = document.getElementById('horaFin');
    const hoy = obtenerFechaActual();
    const horaActual = obtenerHoraActual();
    
    // Remover restricciones previas
    horaInicio.removeAttribute('max');
    horaFin.removeAttribute('min');
    horaFin.removeAttribute('max');
    horaInicio.removeAttribute('min');
    
    // Si la fecha de inicio es hoy, la hora de inicio no puede ser futura
    if (fechaInicio.value === hoy) {
        horaInicio.max = horaActual;
        
        // Si la hora de inicio es mayor que la actual, ajustarla
        if (horaInicio.value > horaActual) {
            horaInicio.value = horaActual;
        }
    }
    
    // Si la fecha de fin es hoy, la hora de fin no puede ser futura
    if (fechaFin.value === hoy) {
        horaFin.max = horaActual;
        
        // Si la hora de fin es mayor que la actual, ajustarla
        if (horaFin.value > horaActual) {
            horaFin.value = horaActual;
        }
    }
    
    // Si las fechas son iguales, aplicar restricciones entre horas
    if (fechaInicio.value && fechaFin.value && fechaInicio.value === fechaFin.value) {
        if (horaInicio.value) {
            // Si es el mismo día, hora fin no puede ser anterior a hora inicio
            const minHoraFin = horaInicio.value;
            // Pero si es hoy, no puede exceder la hora actual
            if (fechaFin.value === hoy) {
                horaFin.min = minHoraFin;
                horaFin.max = horaActual;
            } else {
                horaFin.min = minHoraFin;
            }
            
            // Ajustar hora fin si es necesaria
            if (horaFin.value && horaFin.value < horaInicio.value) {
                horaFin.value = horaInicio.value;
            }
        }
        
        if (horaFin.value) {
            // Si es el mismo día, hora inicio no puede ser posterior a hora fin
            horaInicio.max = horaFin.value;
            
            // Ajustar hora inicio si es necesaria
            if (horaInicio.value && horaInicio.value > horaFin.value) {
                horaInicio.value = horaFin.value;
            }
        }
    }
}

// ==================== MODAL DE BÚSQUEDA ====================
function initSearchModal() {
    const searchBtn = document.getElementById('searchBtn');
    const searchModal = document.getElementById('searchModal');
    const closeSearchModal = document.getElementById('closeSearchModal');

    if (!searchBtn || !searchModal || !closeSearchModal) {
        console.error('Elementos del modal no encontrados');
        return;
    }

    // Abrir modal
    searchBtn.addEventListener('click', () => {
        searchModal.classList.add('active');
    });

    // Cerrar modal con botón X
    closeSearchModal.addEventListener('click', () => {
        searchModal.classList.remove('active');
    });

    // Cerrar modal al hacer clic fuera
    searchModal.addEventListener('click', (e) => {
        if (e.target === searchModal) {
            searchModal.classList.remove('active');
        }
    });

    // Cerrar con tecla ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && searchModal.classList.contains('active')) {
            searchModal.classList.remove('active');
        }
    });
}

// --- MODIFICAMOS DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', () => {
    if (window.setupViewNavigation) {
        window.setupViewNavigation();
    }
    initializeMap();
    
    establecerValoresDefectoFechas(); 
    
    configurarValidacionFechas();

    const cancelBtn = document.getElementById('cancelRouteBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            isRouteGenerationCancelled = true;
        });
    }
});

// Ejecutar DESPUÉS de que todo esté cargado
window.addEventListener('load', () => {
    initSearchModal();
});