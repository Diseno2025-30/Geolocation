import * as map from './modules/realtimeMap.js';

let statusHiddenElement, lastUpdateHiddenElement, puntosTrayectoriaHiddenElement;
let latitudeElement, longitudeElement, deviceIdElement, timestampElement;

function updateDisplay(data) {
    if (data && Object.keys(data).length > 0) {
        latitudeElement.textContent = data.lat ? data.lat.toFixed(6) : '---.------';
        longitudeElement.textContent = data.lon ? data.lon.toFixed(6) : '---.------';
        deviceIdElement.textContent = data.source || '---';
        timestampElement.textContent = data.timestamp || '---';
        
        const currentTime = new Date().toLocaleTimeString();
        lastUpdateHiddenElement.textContent = currentTime;
        
        setOnlineStatus(true);
    } else {
        setOnlineStatus(false);
        latitudeElement.textContent = '---.------';
        longitudeElement.textContent = '---.------';
        deviceIdElement.textContent = '---';
        timestampElement.textContent = '---';
    }
    updateRealtimeModalInfo();
}

function setOnlineStatus(online) {
    const statusText = online ? 'ONLINE' : 'OFFLINE';
    statusHiddenElement.textContent = statusText;
}

async function fetchCoordinates() {
    const basePath = getBasePath();
    
    try {
        const response = await fetch(`${basePath}/coordenadas`);
        if (response.ok) {
            const data = await response.json();
            updateDisplay(data);
            setOnlineStatus(true);
            fetchCoordinates();
        } else {
            setOnlineStatus(false);
            setTimeout(fetchCoordinates, 5000);
        }
    } catch (error) {
        console.error('Error fetching coordinates:', error);
        setOnlineStatus(false);
        setTimeout(fetchCoordinates, 5000);
    }
}

async function actualizarPosicion() {
    const basePath = getBasePath();
    
    try {
        const response = await fetch(`${basePath}/coordenadas`);
        const data = await response.json();
        
        const lat = data.lat;
        const lon = data.lon;
        
        map.updateMarkerPosition(lat, lon);        
        const numPuntos = await map.agregarPuntoTrayectoria(lat, lon);        
        puntosTrayectoriaHiddenElement.textContent = numPuntos;
        updateRealtimeModalInfo();

    } catch (err) {
        console.error('Error obteniendo coordenadas para mapa:', err);
    }
}

function updateRealtimeModalInfo() {
    const modalStatus = document.getElementById('modalStatus');
    const modalLastUpdate = document.getElementById('modalLastUpdate');
    const modalPuntos = document.getElementById('modalPuntos');
    
    if (modalStatus && statusHiddenElement) {
        modalStatus.textContent = statusHiddenElement.textContent;
        const isOnline = statusHiddenElement.textContent === 'ONLINE';
        modalStatus.className = isOnline ? 'modal-value online' : 'modal-value offline';
    }
    if (modalLastUpdate && lastUpdateHiddenElement) {
        modalLastUpdate.textContent = lastUpdateHiddenElement.textContent;
    }
    if (modalPuntos && puntosTrayectoriaHiddenElement) {
        modalPuntos.textContent = puntosTrayectoriaHiddenElement.textContent;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    statusHiddenElement = document.getElementById('status');
    lastUpdateHiddenElement = document.getElementById('lastUpdate');
    puntosTrayectoriaHiddenElement = document.getElementById('puntosTrayectoria');
    latitudeElement = document.getElementById('latitude');
    longitudeElement = document.getElementById('longitude');
    deviceIdElement = document.getElementById('deviceId');
    timestampElement = document.getElementById('timestamp');

    if (window.setupViewNavigation) {
        window.setupViewNavigation(false);
    }
    
    map.initializeMap();    
    fetchCoordinates();
    actualizarPosicion();
    setInterval(actualizarPosicion, 10000);

    if (typeof window.updateModalInfo !== 'undefined') {
        window.updateModalInfo = updateRealtimeModalInfo;
    }

    window.limpiarTrayectoria = () => {
        const numPuntos = map.limpiarTrayectoria();
        puntosTrayectoriaHiddenElement.textContent = numPuntos;
        updateRealtimeModalInfo();
    };
    window.toggleTrayectoria = map.toggleTrayectoria;
    window.regenerarRuta = map.regenerarRuta;
});