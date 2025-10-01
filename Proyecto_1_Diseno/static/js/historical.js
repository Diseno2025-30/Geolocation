// historical.js - Lógica específica para vista Historical

let map;
let polylineHistorica = null;
let marcadoresHistoricos = [];
let marcadoresVisibles = true;
let datosHistoricos = [];

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

function mostrarHistorico(coordenadas) {
    limpiarMapa();
    
    if (coordenadas.length === 0) {
        alert('No hay datos para ese rango de fechas');
        return;
    }
    
    const fechaInicio = document.getElementById('fechaInicio').value;
    const horaInicio = document.getElementById('horaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const horaFin = document.getElementById('horaFin').value;
    
    const datosFiltrados = filtrarPorRangoCompleto(coordenadas, fechaInicio, horaInicio, fechaFin, horaFin);
    
    if (datosFiltrados.length === 0) {
        alert('No hay datos para ese rango de tiempo');
        return;
    }
    
    datosHistoricos = datosFiltrados;
    
    const puntos = datosFiltrados.map(c => [c.lat, c.lon]);
    polylineHistorica = L.polyline(puntos, {
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
    
    lastQueryElement.textContent = new Date().toLocaleTimeString();
    
    if (window.updateModalInfo) {
        window.updateModalInfo();
    }
}

function actualizarInformacionHistorica(datos) {
    if (datos.length === 0) return;
    
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
    
    // Validaciones explícitas
    if (!fechaInicio || !fechaFin) {
        alert('Debes seleccionar tanto la fecha de inicio como la fecha de fin');
        return;
    }
    
    if (fechaInicio > fechaFin) {
        alert('ERROR: La fecha de inicio no puede ser posterior a la fecha de fin.\n\nFecha inicio: ' + fechaInicio + '\nFecha fin: ' + fechaFin);
        return;
    }
    
    // Si las fechas son iguales, validar las horas
    if (fechaInicio === fechaFin) {
        const horaInicioValue = horaInicio || '00:00';
        const horaFinValue = horaFin || '23:59';
        
        if (horaInicioValue > horaFinValue) {
            alert('ERROR: Para el mismo día, la hora de inicio no puede ser posterior a la hora de fin.\n\nHora inicio: ' + horaInicioValue + '\nHora fin: ' + horaFinValue);
            return;
        }
    }
    
    const basePath = window.getBasePath ? window.getBasePath() : '';
    const url = `${basePath}/historico/rango?inicio=${fechaInicio}&fin=${fechaFin}`;
    
    try {
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            mostrarHistorico(data);
            
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

function limpiarMapa() {
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
    
    if (window.updateModalInfo) {
        window.updateModalInfo();
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

function establecerRangoHoy() {
    const hoy = new Date().toISOString().split('T')[0];
    document.getElementById('fechaInicio').value = hoy;
    document.getElementById('fechaFin').value = hoy;
    document.getElementById('horaInicio').value = '00:00';
    document.getElementById('horaFin').value = '23:59';
    
    // Actualizar restricciones después de establecer valores
    actualizarRestriccionesFechas();
}

function establecerRangoUltimos7Dias() {
    const hoy = new Date();
    const hace7Dias = new Date(hoy);
    hace7Dias.setDate(hoy.getDate() - 7);
    
    document.getElementById('fechaInicio').value = hace7Dias.toISOString().split('T')[0];
    document.getElementById('fechaFin').value = hoy.toISOString().split('T')[0];
    document.getElementById('horaInicio').value = '00:00';
    document.getElementById('horaFin').value = '23:59';
    
    // Actualizar restricciones después de establecer valores
    actualizarRestriccionesFechas();
}

function actualizarRestriccionesFechas() {
    const fechaInicio = document.getElementById('fechaInicio');
    const fechaFin = document.getElementById('fechaFin');
    
    // La fecha de fin no puede ser anterior a la fecha de inicio
    if (fechaInicio.value) {
        fechaFin.min = fechaInicio.value;
    }
    
    // La fecha de inicio no puede ser posterior a la fecha de fin
    if (fechaFin.value) {
        fechaInicio.max = fechaFin.value;
    }
}

function configurarValidacionFechas() {
    const fechaInicio = document.getElementById('fechaInicio');
    const fechaFin = document.getElementById('fechaFin');
    const horaInicio = document.getElementById('horaInicio');
    const horaFin = document.getElementById('horaFin');
    
    // Validar en tiempo real cuando se cambia la fecha de inicio
    fechaInicio.addEventListener('change', function() {
        // Si hay una fecha de fin seleccionada, validar
        if (fechaFin.value && this.value > fechaFin.value) {
            alert('ATENCIÓN: La fecha de inicio no puede ser posterior a la fecha de fin.\n\nSe ha restablecido la fecha de inicio.');
            this.value = fechaFin.value;
        }
        // Establecer mínimo para fecha fin
        if (this.value) {
            fechaFin.min = this.value;
        }
    });
    
    // Validar en tiempo real cuando se cambia la fecha de fin
    fechaFin.addEventListener('change', function() {
        // Si hay una fecha de inicio seleccionada, validar
        if (fechaInicio.value && this.value < fechaInicio.value) {
            alert('ATENCIÓN: La fecha de fin no puede ser anterior a la fecha de inicio.\n\nSe ha restablecido la fecha de fin.');
            this.value = fechaInicio.value;
        }
        // Establecer máximo para fecha inicio
        if (this.value) {
            fechaInicio.max = this.value;
        }
    });
    
    // Validar horas cuando las fechas son iguales
    horaInicio.addEventListener('change', validarHoras);
    horaFin.addEventListener('change', validarHoras);
    
    function validarHoras() {
        // Solo validar si las fechas son iguales
        if (fechaInicio.value && fechaFin.value && fechaInicio.value === fechaFin.value) {
            const horaInicioValue = horaInicio.value || '00:00';
            const horaFinValue = horaFin.value || '23:59';
            
            if (horaInicioValue > horaFinValue) {
                alert('ATENCIÓN: Para el mismo día, la hora de inicio no puede ser posterior a la hora de fin.\n\nHora inicio: ' + horaInicioValue + '\nHora fin: ' + horaFinValue);
                // Ajustar automáticamente
                if (this === horaInicio) {
                    horaInicio.value = horaFinValue;
                } else {
                    horaFin.value = horaInicioValue;
                }
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
    configurarValidacionFechas(); // Nueva función de validación
});

// Ejecutar DESPUÉS de que todo esté cargado
window.addEventListener('load', () => {
    initSearchModal();
});