let map;
let polylineHistorica = null;
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
        
        // Aplicar el filtro
        aplicarFiltroGeocerca();
    });

    // Al EDITAR una geocerca
    map.on(L.Draw.Event.EDITED, function (e) {
        geofenceLayer = e.layers.getLayers()[0]; // Asumimos una sola capa
        aplicarFiltroGeocerca();
    });

    // Al BORRAR una geocerca (con el botón de la barra de herramientas)
    map.on(L.Draw.Event.DELETED, function () {
        geofenceLayer = null;
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

// ========== FUNCIONES PARA ROUTING POR CALLES ==========

/**
 * Obtiene la ruta por calles entre dos puntos usando OSRM
 * @param {number} lat1 - Latitud punto inicial
 * @param {number} lon1 - Longitud punto inicial
 * @param {number} lat2 - Latitud punto final
 * @param {number} lon2 - Longitud punto final
 * @returns {Array|null} - Array de coordenadas [lat, lon] o null si falla
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
            // OSRM devuelve coordenadas en formato [lon, lat]
            // Convertir a [lat, lon] para Leaflet
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
 * Genera la ruta completa siguiendo las calles del puerto
 * @param {Array} puntos - Array de puntos [lat, lon]
 * @returns {Array} - Array con todos los puntos de la ruta siguiendo calles
 */
async function generarRutaPorCalles(puntos) {
    if (puntos.length < 2) {
        return puntos;
    }
    
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
        const [lat1, lon1] = puntos[i];
        const [lat2, lon2] = puntos[i + 1];
        
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
    limpiarMapa(true);
    
    if (datosFiltrados.length === 0) {
        document.getElementById('historicalControls').style.display = 'block';
        actualizarInformacionHistorica(datosFiltrados); // Limpiará la info
        return;
    }

    datosHistoricos = datosFiltrados; // Actualizar datos globales para 'exportarDatos'
    
    const puntos = datosFiltrados.map(c => [c.lat, c.lon]);
    
    console.log('🗺️ Generando ruta por calles del puerto...');
    const puntosRuta = await generarRutaPorCalles(puntos);
    console.log(`✓ Ruta completa generada con ${puntosRuta.length} puntos`);
    
    polylineHistorica = L.polyline(puntosRuta, {
        color: '#4C1D95',
        weight: 4,
        opacity: 0.8
    }).addTo(map);
    
    if (puntos.length > 0) {
        const startMarker = L.marker(puntos[0], {
            icon: L.divIcon({
                className: 'custom-marker',
                html: '<div style="background-color: #22C55E; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff;"></div>',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            })
        }).addTo(map);
        startMarker.bindPopup(`Inicio: ${datosFiltrados[0].timestamp}`);
        marcadoresHistoricos.push(startMarker);
        
        if (puntos.length > 1) {
            const endMarker = L.marker(puntos[puntos.length - 1], {
                icon: L.divIcon({
                    className: 'custom-marker',
                    html: '<div style="background-color: #EF4444; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff;"></div>',
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                })
            }).addTo(map);
            endMarker.bindPopup(`Final: ${datosFiltrados[datosFiltrados.length - 1].timestamp}`);
            marcadoresHistoricos.push(endMarker);
        }
    }
    
    map.fitBounds(polylineHistorica.getBounds());
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

function actualizarInformacionHistorica(datos) {
    puntosHistoricosElement.textContent = datos.length;

    const fechaInicio = document.getElementById('fechaInicio').value;
    const horaInicio = document.getElementById('horaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const horaFin = document.getElementById('horaFin').value;
    
    rangoConsultadoElement.textContent = `${fechaInicio} ${horaInicio} - ${fechaFin} ${horaFin}`;
    
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    const diasDiff = Math.ceil((fin - inicio) / (1000 * 60 * 60 * 24)) + 1;
    diasIncluidosElement.textContent = diasDiff;

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
    
    const basePath = window.getBasePath ? window.getBasePath() : '';
    const url = `${basePath}/historico/rango?inicio=${fechaInicio}&fin=${fechaFin}`;
    
    try {
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            
            datosHistoricosOriginales = data;
            
            if (geofenceLayer) {
                drawnItems.removeLayer(geofenceLayer);
                geofenceLayer = null;
            }

            await mostrarHistorico(data);
            
            const searchModal = document.getElementById('searchModal');
            if (searchModal) {
                searchModal.classList.remove('active');
            }
        } else {
            alert('No hay datos para ese rango de fechas');
        }
    } catch (error) {
        console.error('Error al consultar histórico:', error);
        alert('Error al consultar histórico');
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
    }
    
    if (window.updateModalInfo) {
        window.updateModalInfo();
    }
}

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

    dibujarRutaEnMapa(datosParaMostrar);
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
    if (polylineHistorica) {
        map.fitBounds(polylineHistorica.getBounds());
    } else if (geofenceLayer) {
        map.fitBounds(geofenceLayer.getBounds());
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
    link.setAttribute('download', `historical_data_${fechaInicio}_to_${fechaFin}.csv`);
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