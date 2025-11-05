import * as osrm from './modules/osrm.js';
import * as map from './modules/historicalMap.js';
import * as ui from './modules/historicalUI.js';

let datosHistoricosOriginales = [];
let datosHistoricosFiltrados = [];
let geofenceLayer = null;

document.addEventListener('DOMContentLoaded', () => {
    map.initializeMap(
        onGeofenceCreated,
        onGeofenceEdited,
        onGeofenceDeleted
    );
    
    ui.initializeUI(
        onVerHistorico,
        onLimpiarMapa,
        onExportarDatos,
        onToggleMarcadores,
        onAjustarVista,
        onLimpiarGeocerca
    );

    if (window.setupViewNavigation) {
        window.setupViewNavigation();
    }
});

async function onVerHistorico(fechaInicio, horaInicio, fechaFin, horaFin) {
    ui.showLoading(true);
    const basePath = window.getBasePath ? window.getBasePath() : '';
    const url = `${basePath}/historico/rango?inicio=${fechaInicio}&fin=${fechaFin}&hora_inicio=${horaInicio}&hora_fin=${horaFin}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            throw new Error(errorData?.error || 'No hay datos para ese rango de fechas');
        }
        
        datosHistoricosOriginales = await response.json();
        await aplicarFiltrosYActualizarMapa();
        ui.closeSearchModal();

    } catch (error) {
        console.error('Error al consultar histórico:', error);
        alert(error.message);
    } finally {
        ui.showLoading(false);
    }
}

async function fetchDatosPorGeocerca(bounds) {
    ui.showLoading(true);
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const basePath = window.getBasePath ? window.getBasePath() : '';
    const url = `${basePath}/historico/geocerca?min_lat=${sw.lat}&min_lon=${sw.lng}&max_lat=${ne.lat}&max_lon=${ne.lng}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('No se encontraron datos en esta área');
        }
        
        const data = await response.json();
        datosHistoricosOriginales = [];
        datosHistoricosFiltrados = data;
        await dibujarRutaFiltrada();

    } catch (error) {
        console.error('Error al consultar por geocerca:', error);
        alert(error.message);
    } finally {
        ui.showLoading(false);
    }
}

async function aplicarFiltrosYActualizarMapa() {
    if (geofenceLayer) {
        const bounds = geofenceLayer.getBounds();
        datosHistoricosFiltrados = datosHistoricosOriginales.filter(p => 
            bounds.contains([p.lat, p.lon])
        );
    } else {
        datosHistoricosFiltrados = [...datosHistoricosOriginales]; // Copia
    }
    
    await dibujarRutaFiltrada();
}

async function dibujarRutaFiltrada() {
    if (datosHistoricosFiltrados.length === 0) {
        map.clearMap(!!geofenceLayer);
        ui.actualizarInformacionHistorica(datosHistoricosFiltrados, geofenceLayer);
        if (datosHistoricosOriginales.length > 0) {
             alert('No se encontraron puntos con los filtros aplicados.');
        }
        return;
    }
    
    ui.showRouteLoading(true, 0, datosHistoricosFiltrados.length - 1);
    const puntosRuta = await osrm.generateFullStreetRoute(
        datosHistoricosFiltrados,
        (current, total) => ui.updateRouteProgress(current, total),
        ui.cancellationToken
    );

    if (ui.cancellationToken.isCancelled) {
        ui.showRouteLoading(false);
        map.clearMap(!!geofenceLayer);
        return;
    }

    map.dibujarRutaEnMapa(datosHistoricosFiltrados, puntosRuta, geofenceLayer);    
    ui.actualizarInformacionHistorica(datosHistoricosFiltrados, geofenceLayer);
    ui.showRouteLoading(false);
}

function onGeofenceCreated(layer) {
    geofenceLayer = layer;
    if (datosHistoricosOriginales.length > 0) {
        aplicarFiltrosYActualizarMapa();
    } else {
        fetchDatosPorGeocerca(layer.getBounds());
    }
}

function onGeofenceEdited(layer) {
    geofenceLayer = layer;
    if (datosHistoricosOriginales.length > 0) {
        aplicarFiltrosYActualizarMapa();
    } else {
        fetchDatosPorGeocerca(layer.getBounds());
    }
}

function onGeofenceDeleted() {
    geofenceLayer = null;
    aplicarFiltrosYActualizarMapa();
}

function onLimpiarMapa() {
    datosHistoricosOriginales = [];
    datosHistoricosFiltrados = [];
    geofenceLayer = null;
    map.clearMap(false);
    ui.actualizarInformacionHistorica([], null);
    ui.resetDatePickers();
}

function onLimpiarGeocerca() {
    if (geofenceLayer) {
        map.removeGeofence(geofenceLayer);
        geofenceLayer = null;
        aplicarFiltrosYActualizarMapa();
    }
}

function onExportarDatos() {
    if (datosHistoricosFiltrados.length === 0) {
        alert('No hay datos para exportar');
        return;
    }
    ui.exportarDatos(datosHistoricosFiltrados);
}

function onToggleMarcadores() {
    map.toggleMarkers();
}

function onAjustarVista() {
    map.fitView(geofenceLayer);
}