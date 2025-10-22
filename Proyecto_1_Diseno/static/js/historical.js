let map;
let polylineHistorica = null;
// Ya no necesitamos 'polylinesHistoricas'
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
    // ---------------------------------
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

// ========== FUNCIÓN OBTENERRUTAOSRM ELIMINADA ==========
// ========== FUNCIÓN GENERARRUTAPORCALLES ELIMINADA ==========
// La data ya viene con "snap-to-road" desde el backend.
// Llamar a OSRM de nuevo en el frontend era el error.

async function dibujarRutaEnMapa(datosFiltrados) {
    limpiarMapa(true); // Limpiar mapa pero preservar geocerca
    
    // Ocultar overlay de carga (lo movimos aquí, ya no hay 'await' de OSRM)
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.classList.remove('active');
    }
    
    if (datosFiltrados.length === 0) {
        document.getElementById('historicalControls').style.display = 'block';
        actualizarInformacionHistorica(datosFiltrados); // Limpiará la info
        return;
    }

    datosHistoricos = datosFiltrados; // Actualizar datos globales
    
    // --- ¡NUEVA LÓGICA DE DIBUJO! ---
    // 1. Agrupar puntos por coordenada para "unir" fechas
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
    
    // `uniquePoints` mantiene el orden de aparición gracias a Map
    const uniquePoints = Array.from(puntosAgrupados.values());
    
    // 2. Crear las coordenadas para la polilínea
    // Usamos los datos originales (datosFiltrados), no los únicos,
    // para que la línea se dibuje en el orden temporal correcto.
    const polylineCoords = datosFiltrados.map(p => [p.lat, p.lon]);

    const polylineOptions = {
        color: '#4C1D95', // Color morado para la ruta
        weight: 4,
        opacity: 0.8
    };

    // 3. Dibujar la "trayectoria" (la línea que conecta los puntos)
    // Esta línea SÍ sigue el orden original.
    if (polylineCoords.length > 1) {
        polylineHistorica = L.polyline(polylineCoords, polylineOptions).addTo(map);
    }

    // 4. Dibujar los "puntos" (los marcadores únicos y clicables)
    console.log(`Dibujando ${uniquePoints.length} puntos únicos en la trayectoria...`);
    uniquePoints.forEach(punto => {
        const marker = L.circleMarker([punto.lat, punto.lon], {
            radius: 5,
            color: '#FFFFFF',      // Borde blanco
            weight: 2,
            fillColor: '#EF4444', // Relleno rojo
            fillOpacity: 1.0
        }).addTo(map);
        
        // Crear el contenido del popup con todas las fechas
        const popupContent = `<b>Fechas en este punto:</b><br>${punto.timestamps.join('<br>')}`;
        marker.bindPopup(popupContent);
        
        marcadoresHistoricos.push(marker); // Añadir a la lista para 'toggleMarcadores'
    });
    
    // 5. AJUSTAR LA VISTA
    if (geofenceLayer) {
        // Si hay geocerca, ajustar a la geocerca
        map.fitBounds(geofenceLayer.getBounds());
    } else if (polylineHistorica) {
        // Si no hay geocerca y sí ruta, ajustar a la ruta
        map.fitBounds(polylineHistorica.getBounds());
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
    
    // Ya no es 'async', no hay 'await' para OSRM
    dibujarRutaEnMapa(datosFiltrados);
}

function actualizarInformacionHistorica(datos) {
    puntosHistoricosElement.textContent = datos.length;

    const fechaInicio = document.getElementById('fechaInicio').value;
    const horaInicio = document.getElementById('horaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const horaFin = document.getElementById('horaFin').value;
    
    // Si hay datos, pero no hay filtro de tiempo (ej. solo geocerca)
    // Mostramos el rango de los datos recibidos
    if (datos.length > 0 && (!fechaInicio || !fechaFin)) {
        const primerPunto = datos[0];
        const ultimoPunto = datos[datos.length - 1];
        rangoConsultadoElement.textContent = `${primerPunto.timestamp} - ${ultimoPunto.timestamp}`;
        
        const inicio = parseTimestamp(primerPunto.timestamp);
        const fin = parseTimestamp(ultimoPunto.timestamp);
        const diasDiff = Math.ceil((fin - inicio) / (1000 * 60 * 60 * 24)) + 1;
        diasIncluidosElement.textContent = diasDiff;

    } else if (fechaInicio && fechaFin) {
        rangoConsultadoElement.textContent = `${fechaInicio} ${horaInicio} - ${fechaFin} ${horaFin}`;
        const inicio = new Date(fechaInicio);
        const fin = new Date(fechaFin);
        const diasDiff = Math.ceil((fin - inicio) / (1000 * 60 * 60 * 24)) + 1;
        diasIncluidosElement.textContent = diasDiff;
    } else {
        rangoConsultadoElement.textContent = '---';
        diasIncluidosElement.textContent = '---';
    }


    if (datos.length === 0) {
        puntoInicialElement.textContent = '---.------';
        puntoFinalElement.textContent = '---.------';
        distanciaTotalElement.textContent = '--- km';
        duracionElement.textContent = '---';
        return;
    }
    
    const primerPunto = datos[0];
    const ultimoPunto = datos[datos.length - 1];
    
    puntoInicialElement.textContent = `${primerPunto.lat.toFixed(6)}, ${primerPunto.lon.toFixed(6)}`;
    puntoFinalElement.textContent = `${ultimoPunto.lat.toFixed(6)}, ${ultimoPunto.lon.toFixed(6)}`;
    
    // La distancia se calcula sobre los puntos originales (en orden)
    let distanciaTotal = 0;
    for (let i = 1; i < datos.length; i++) {
        distanciaTotal += calcularDistancia(
            datos[i-1].lat, datos[i-1].lon,
            datos[i].lat, datos[i].lon
        );
    }
    distanciaTotalElement.textContent = `${distanciaTotal.toFixed(2)} km`;
    
    const tiempoInicial = parseTimestamp(primerPunto.timestamp);
    const tiempoFinal = parseTimestamp(ultimoPunto.timestamp);
    const duracionMs = tiempoFinal - tiempoInicial;
    const dias = Math.floor(duracionMs / (1000 * 60 * 60 * 24));
    const horas = Math.floor((duracionMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutos = Math.floor((duracionMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (dias > 0) {
        duracionElement.textContent = `${dias}d ${horas}h ${minutos}m`;
    } else {
        duracionElement.textContent = `${horas}h ${minutos}m`;
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
                aplicarFiltroGeocerca();
            } else {
                // await eliminado
                mostrarHistorico(data);
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
    duracionElement.textContent = '---';
    
    datosHistoricos = [];
    
    if (!preserveGeofence) {
        if (drawnItems) {
            drawnItems.clearLayers();
        }
        geofenceLayer = null;
        datosHistoricosOriginales = []; // Limpiar datos originales también
        
        // Limpiar los campos de fecha al valor por defecto (Hoy)
        establecerRangoHoy();
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

    // Ya no es 'async', no hay 'await'
    dibujarRutaEnMapa(datosParaMostrar);
}

/**
 * Busca en la base de datos todos los puntos dentro de una geocerca
 */
async function fetchDatosPorGeocerca(bounds) {
    const sw = bounds.getSouthWest(); // Esquina Suroeste (min_lat, min_lon)
    const ne = bounds.getNorthEast(); // Esquina Noreste (max_lat, max_lon)

    const basePath = window.getBasePath ? window.getBasePath() : '';
    const url = `${basePath}/historico/geocerca?min_lat=${sw.lat}&min_lon=${sw.lng}&max_lat=${ne.lat}&max_lon=${ne.lng}`;

    // Limpiar cualquier ruta anterior, pero mantener la geocerca
    limpiarMapa(true); 
    
    // Mostrar overlay de carga
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.classList.add('active');
    }

    try {
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            
            if (data.length === 0) {
                 alert('No se encontraron datos históricos en esta área');
                 if (loadingOverlay) loadingOverlay.classList.remove('active');
                 return;
            }
            
            // ¡Importante!
            // NO establecemos datosHistoricosOriginales
            // Solo dibujamos lo que recibimos
            // await eliminado
            dibujarRutaEnMapa(data);
        } else {
            alert('Error al consultar los datos de la geocerca');
            if (loadingOverlay) loadingOverlay.classList.remove('active');
        }
    } catch (error) {
        console.error('Error al consultar por geocerca:', error);
        alert('Error al consultar por geocerca');
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

function establecerRangoHoy() {
    const hoy = obtenerFechaActual();
    document.getElementById('fechaInicio').value = hoy;
    document.getElementById('fechaFin').value = hoy;
    document.getElementById('horaInicio').value = '00:00';
    document.getElementById('horaFin').value = obtenerHoraActual();
    
    actualizarRestriccionesFechas();
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

document.addEventListener('DOMContentLoaded', () => {
    if (window.setupViewNavigation) {
        window.setupViewNavigation();
    }
    initializeMap();
    establecerRangoHoy();
    configurarValidacionFechas();
});

// Ejecutar DESPUÉS de que todo esté cargado
window.addEventListener('load', () => {
    initSearchModal();
});