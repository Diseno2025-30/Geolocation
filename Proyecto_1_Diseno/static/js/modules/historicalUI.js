import * as utils from './utils.js';

let fechaInicioEl, horaInicioEl, fechaFinEl, horaFinEl;
let lastQueryElement, puntosHistoricosElement, rangoConsultadoElement, diasIncluidosElement;
let puntoInicialElement, puntoFinalElement, distanciaTotalElement, duracionElement;
let searchModal, closeSearchModalEl, searchBtn;

export function initializeUI(
    onVerHistorico,
    onLimpiarMapa,
    onExportarDatos,
    onToggleMarcadores,
    onAjustarVista,
    onLimpiarGeocerca
) {
    fechaInicioEl = document.getElementById('fechaInicio');
    horaInicioEl = document.getElementById('horaInicio');
    fechaFinEl = document.getElementById('fechaFin');
    horaFinEl = document.getElementById('horaFin');

    lastQueryElement = document.getElementById('lastQuery');
    puntosHistoricosElement = document.getElementById('puntosHistoricos');
    rangoConsultadoElement = document.getElementById('rangoConsultado');
    diasIncluidosElement = document.getElementById('diasIncluidos');

    puntoInicialElement = document.getElementById('puntoInicial');
    puntoFinalElement = document.getElementById('puntoFinal');
    distanciaTotalElement = document.getElementById('distanciaTotal');
    duracionElement = document.getElementById('duracion');

    searchModal = document.getElementById('searchModal');
    closeSearchModalEl = document.getElementById('closeSearchModal');
    searchBtn = document.getElementById('searchBtn');

    document.querySelector('.btn[onclick="toggleMarcadores()"]').onclick = (e) => { e.preventDefault(); onToggleMarcadores(); };
    document.querySelector('.btn[onclick="ajustarVista()"]').onclick = (e) => { e.preventDefault(); onAjustarVista(); };
    document.querySelector('.btn[onclick="limpiarGeocerca()"]').onclick = (e) => { e.preventDefault(); onLimpiarGeocerca(); };
    document.querySelector('.btn[onclick="exportarDatos()"]').onclick = (e) => { e.preventDefault(); onExportarDatos(); };

    document.querySelector('.search-btn-action[onclick="verHistoricoRango()"]').onclick = (e) => {
        e.preventDefault();
        if (validarFechas()) {
            onVerHistorico(fechaInicioEl.value, horaInicioEl.value, fechaFinEl.value, horaFinEl.value);
        }
    };
    document.querySelector('.search-btn-action.secondary[onclick="limpiarMapa()"]').onclick = (e) => { e.preventDefault(); onLimpiarMapa(); };
    document.querySelector('.search-quick-btn[onclick="establecerRangoHoy()"]').onclick = (e) => { e.preventDefault(); establecerRangoHoy(onVerHistorico); };
    document.querySelector('.search-quick-btn[onclick="establecerRangoUltimos7Dias()"]').onclick = (e) => { e.preventDefault(); establecerRangoUltimos7Dias(onVerHistorico); };

    initSearchModal();    
    configurarValidacionFechas();
    resetDatePickers();
    if (typeof window.updateModalInfo !== 'undefined') {
        window.updateModalInfo = () => actualizarInfoModal([], null);
    }
}

function validarFechas() {
    const ahoraColombia = new Date();
    const fechaInicioCompleta = new Date(`${fechaInicioEl.value}T${horaInicioEl.value || '00:00'}:00`);
    const fechaFinCompleta = new Date(`${fechaFinEl.value}T${horaFinEl.value || '23:59'}:00`);

    if (!fechaInicioEl.value || !fechaFinEl.value) {
        alert('Debes seleccionar tanto la fecha de inicio como la fecha de fin');
        return false;
    }
    if (fechaInicioCompleta > ahoraColombia) {
        alert('La fecha de inicio no puede ser futura');
        return false;
    }
    if (fechaFinCompleta > ahoraColombia) {
        fechaFinEl.value = utils.obtenerFechaActual();
        horaFinEl.value = utils.obtenerHoraActual();
    }
    if (fechaInicioCompleta > fechaFinCompleta) {
        alert('La fecha de inicio no puede ser posterior a la fecha de fin');
        return false;
    }
    return true;
}

export function resetDatePickers() {
    const hoy = utils.obtenerFechaActual();
    fechaInicioEl.value = hoy;
    fechaFinEl.value = hoy;
    horaInicioEl.value = '00:00';
    horaFinEl.value = utils.obtenerHoraActual();
    actualizarRestriccionesFechas();
}

function establecerRangoHoy(callback) {
    resetDatePickers();
    callback(fechaInicioEl.value, horaInicioEl.value, fechaFinEl.value, horaFinEl.value);
}

function establecerRangoUltimos7Dias(callback) {
    const hoy = utils.obtenerFechaHoraColombia();
    const hace7Dias = new Date(hoy.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    fechaInicioEl.value = hace7Dias.toISOString().split('T')[0];
    fechaFinEl.value = utils.obtenerFechaActual();
    horaInicioEl.value = '00:00';
    horaFinEl.value = utils.obtenerHoraActual();
    
    actualizarRestriccionesFechas();
    callback(fechaInicioEl.value, horaInicioEl.value, fechaFinEl.value, horaFinEl.value);
}

function configurarValidacionFechas() {
    const hoy = utils.obtenerFechaActual();
    fechaInicioEl.max = hoy;
    fechaFinEl.max = hoy;
    
    fechaInicioEl.addEventListener('change', actualizarRestriccionesFechas);
    fechaFinEl.addEventListener('change', actualizarRestriccionesFechas);
    horaInicioEl.addEventListener('change', actualizarRestriccionesHora);
    horaFinEl.addEventListener('change', actualizarRestriccionesHora);
}

function actualizarRestriccionesFechas() {
    const hoy = utils.obtenerFechaActual();
    fechaInicioEl.max = hoy;
    fechaFinEl.max = hoy;
    
    if (fechaInicioEl.value) {
        fechaFinEl.min = fechaInicioEl.value;
        if (fechaFinEl.value && fechaFinEl.value < fechaInicioEl.value) {
            fechaFinEl.value = fechaInicioEl.value;
        }
    } else {
        fechaFinEl.removeAttribute('min');
    }
    actualizarRestriccionesHora();
}

function actualizarRestriccionesHora() {
    const hoy = utils.obtenerFechaActual();
    const horaActual = utils.obtenerHoraActual();
    
    horaInicioEl.removeAttribute('max');
    horaFinEl.removeAttribute('min');
    horaFinEl.removeAttribute('max');
    
    if (fechaInicioEl.value === hoy) {
        horaInicioEl.max = horaActual;
        if (horaInicioEl.value > horaActual) horaInicioEl.value = horaActual;
    }
    
    if (fechaFinEl.value === hoy) {
        horaFinEl.max = horaActual;
        if (horaFinEl.value > horaActual) horaFinEl.value = horaActual;
    }
    
    if (fechaInicioEl.value === fechaFinEl.value) {
        if (horaInicioEl.value) {
            horaFinEl.min = horaInicioEl.value;
            if (horaFinEl.value < horaInicioEl.value) horaFinEl.value = horaInicioEl.value;
        }
    }
}

function initSearchModal() {
    if (!searchBtn || !searchModal || !closeSearchModalEl) return;
    searchBtn.addEventListener('click', () => searchModal.classList.add('active'));
    closeSearchModalEl.addEventListener('click', () => searchModal.classList.remove('active'));
    searchModal.addEventListener('click', (e) => {
        if (e.target === searchModal) searchModal.classList.remove('active');
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') searchModal.classList.remove('active');
    });
}

export function closeSearchModal() {
    if (searchModal) searchModal.classList.remove('active');
}

export function actualizarInformacionHistorica(datos, geofenceLayer) {
    puntosHistoricosElement.textContent = datos.length;

    if (datos.length > 0) {
        const primerPunto = datos[0];
        const ultimoPunto = datos[datos.length - 1];
        rangoConsultadoElement.textContent = `${primerPunto.timestamp} - ${ultimoPunto.timestamp}`;
        
        const inicio = utils.parseTimestamp(primerPunto.timestamp);
        const fin = utils.parseTimestamp(ultimoPunto.timestamp);
        const diffTime = Math.abs(fin - inicio);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + (inicio.toDateString() === fin.toDateString() ? 0 : 1);
        diasIncluidosElement.textContent = diffDays > 0 ? diffDays : 1;

    } else if (fechaInicioEl.value && fechaFinEl.value) {
        rangoConsultadoElement.textContent = `${fechaInicioEl.value} ${horaInicioEl.value} - ${fechaFinEl.value} ${horaFinEl.value}`;
        const inicio = new Date(fechaInicioEl.value);
        const fin = new Date(fechaFinEl.value);
        const diffTime = Math.abs(fin - inicio);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        diasIncluidosElement.textContent = diffDays;
    } else {
        rangoConsultadoElement.textContent = '---';
        diasIncluidosElement.textContent = '---';
    }

    if (datos.length === 0) {
        puntoInicialElement.textContent = '---.------';
        puntoFinalElement.textContent = '---.------';
        distanciaTotalElement.textContent = '--- km';
        duracionElement.textContent = '---';
        actualizarInfoModal(datos, geofenceLayer);
        return;
    }
    
    const primerPunto = datos[0];
    const ultimoPunto = datos[datos.length - 1];
    
    puntoInicialElement.textContent = `${primerPunto.lat.toFixed(6)}, ${primerPunto.lon.toFixed(6)}`;
    puntoFinalElement.textContent = `${ultimoPunto.lat.toFixed(6)}, ${ultimoPunto.lon.toFixed(6)}`;
    
    let distanciaTotal = 0;
    for (let i = 1; i < datos.length; i++) {
        distanciaTotal += utils.calcularDistancia(
            datos[i-1].lat, datos[i-1].lon,
            datos[i].lat, datos[i].lon
        );
    }
    distanciaTotalElement.textContent = `${distanciaTotal.toFixed(2)} km`;
    
    if (geofenceLayer) {
        const mapaDias = new Map();
        for (let i = 0; i < datos.length; i++) {
            const puntoActual = datos[i];
            const fechaPunto = utils.parseTimestamp(puntoActual.timestamp);
            const diaKey = fechaPunto.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });

            let duracionSegmentoMs = 0;
            if (i > 0) {
                const puntoAnterior = datos[i - 1];
                const fechaAnterior = utils.parseTimestamp(puntoAnterior.timestamp);
                if (fechaAnterior.toDateString() === fechaPunto.toDateString()) {
                    duracionSegmentoMs = fechaPunto - fechaAnterior;
                    if (duracionSegmentoMs < 0) duracionSegmentoMs = 0;
                }
            }
            
            const total = (mapaDias.get(diaKey) || 0) + duracionSegmentoMs;
            mapaDias.set(diaKey, total);
        }

        const diasOrdenados = Array.from(mapaDias.keys()).sort((a, b) => {
            const [dayA, monthA, yearA] = a.split('/');
            const [dayB, monthB, yearB] = b.split('/');
            return new Date(`${yearA}-${monthA}-${dayA}`) - new Date(`${yearB}-${monthB}-${dayB}`);
        });

        duracionElement.innerHTML = diasOrdenados
            .map(dia => `${dia}: ${utils.formatDuration(mapaDias.get(dia))}`)
            .join('<br>');

    } else {
        const tiempoInicial = utils.parseTimestamp(primerPunto.timestamp);
        const tiempoFinal = utils.parseTimestamp(ultimoPunto.timestamp);
        const duracionMs = tiempoFinal - tiempoInicial;
        duracionElement.textContent = utils.formatDuration(duracionMs);
    }

    actualizarInfoModal(datos, geofenceLayer);
}

export function actualizarInfoModal(datos, geofenceLayer) {
    document.getElementById('modalLastQuery').textContent = lastQueryElement.textContent;
    document.getElementById('modalPuntos').textContent = datos.length;
    document.getElementById('modalRango').textContent = rangoConsultadoElement.textContent;
    document.getElementById('modalDias').textContent = diasIncluidosElement.textContent;
    
    if (datos.length > 0) {
        lastQueryElement.textContent = new Date().toLocaleTimeString();
        document.getElementById('modalLastQuery').textContent = lastQueryElement.textContent;
    }
}

export function exportarDatos(datosFiltrados) {
    const csvContent = 'data:text/csv;charset=utf-8,' +
        'Latitud,Longitud,Timestamp\n' +
        datosFiltrados.map(punto => 
            `${punto.lat},${punto.lon},"${punto.timestamp}"`
        ).join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `historical_data_${fechaInicioEl.value || 'geofence'}_to_${fechaFinEl.value || 'all'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}