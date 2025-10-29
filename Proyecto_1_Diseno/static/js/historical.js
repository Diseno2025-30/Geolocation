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
    const basePath = window.BASE_PATH || (window.location.pathname.startsWith('/test') ? '/test' : '');
    const url = `${basePath}/historico/rango?inicio=${fechaInicio}&fin=${fechaFin}&hora_inicio=${horaInicio}&hora_fin=${horaFin}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            throw new Error(errorData?.error || 'No hay datos para ese rango de fechas');
        }
        
        datosHistoricosOriginales = await response.json();
        ui.closeSearchModal();        
        await aplicarFiltrosYActualizarMapa();

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
    const basePath = window.BASE_PATH || (window.location.pathname.startsWith('/test') ? '/test' : '');
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
    map.clearPolylines();    
    map.dibujarPuntosEnMapa(datosHistoricosFiltrados);
    ui.actualizarInformacionHistorica(datosHistoricosFiltrados, geofenceLayer);

    try {
        await osrm.generateFullStreetRoute(
            datosHistoricosFiltrados,
            null,
            (segment) => map.dibujarSegmentoRuta(segment, geofenceLayer)
        );
    } catch (error) {
        console.error("Error durante la generación de ruta OSRM:", error);
        alert("Ocurrió un error al generar la ruta. Es posible que la ruta solo muestre líneas rectas.");
    }
    map.fitView(geofenceLayer);
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