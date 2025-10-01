// realtime.js - Lógica específica para vista Real-Time

let map;
let marker;
let trayectoria = [];
let polyline = null;
let trayectoriaVisible = true;
let ultimaPosicion = null;

// Elementos ocultos para el modal
const statusHiddenElement = document.getElementById('status');
const lastUpdateHiddenElement = document.getElementById('lastUpdate');
const puntosTrayectoriaHiddenElement = document.getElementById('puntosTrayectoria');

// Elementos visibles en la página
const latitudeElement = document.getElementById('latitude');
const longitudeElement = document.getElementById('longitude');
const deviceIdElement = document.getElementById('deviceId');
const timestampElement = document.getElementById('timestamp');

function initializeMap() {
    map = L.map('map').setView([11.0, -74.8], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    
    marker = L.marker([11.0, -74.8]).addTo(map);
}

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
}

function setOnlineStatus(online) {
    const statusText = online ? 'ONLINE' : 'OFFLINE';
    statusHiddenElement.textContent = statusText;
    
    // Actualizar modal si existe
    const modalStatus = document.getElementById('modalStatus');
    if (modalStatus) {
        modalStatus.textContent = statusText;
        modalStatus.className = online ? 'modal-value online' : 'modal-value offline';
    }
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

function agregarPuntoTrayectoria(lat, lon) {
    const nuevaPosicion = [lat, lon];
    
    if (ultimaPosicion === null || 
        Math.abs(ultimaPosicion[0] - lat) > 0.00001 || 
        Math.abs(ultimaPosicion[1] - lon) > 0.00001) {
        
        trayectoria.push(nuevaPosicion);
        ultimaPosicion = nuevaPosicion;
        
        puntosTrayectoriaHiddenElement.textContent = trayectoria.length;
        actualizarPolyline();
    }
}

function actualizarPolyline() {
    if (trayectoria.length > 1) {
        if (polyline) {
            map.removeLayer(polyline);
        }
        
        if (trayectoriaVisible) {
            polyline = L.polyline(trayectoria, {
                color: '#4C1D95',
                weight: 3,
                opacity: 0.8,
                smoothFactor: 1
            }).addTo(map);
            
            polyline.bindPopup(`Trayectoria: ${trayectoria.length} puntos`);
        }
    }
}

function limpiarTrayectoria() {
    trayectoria = [];
    ultimaPosicion = null;
    puntosTrayectoriaHiddenElement.textContent = '0';
    
    if (polyline) {
        map.removeLayer(polyline);
        polyline = null;
    }
}

function toggleTrayectoria() {
    trayectoriaVisible = !trayectoriaVisible;
    const toggleText = document.getElementById('toggleText');
    
    if (trayectoriaVisible) {
        toggleText.textContent = 'Ocultar Trayectoria';
        actualizarPolyline();
    } else {
        toggleText.textContent = 'Mostrar Trayectoria';
        if (polyline) {
            map.removeLayer(polyline);
        }
    }
}

function actualizarPosicion() {
    const basePath = getBasePath();
    
    fetch(`${basePath}/coordenadas`)
        .then(res => res.json())
        .then(data => {
            const lat = data.lat;
            const lon = data.lon;
            
            marker.setLatLng([lat, lon]);
            
            if (trayectoria.length === 0) {
                map.setView([lat, lon], 15);
            } else {
                map.panTo([lat, lon]);
            }
            
            agregarPuntoTrayectoria(lat, lon);
        })
        .catch(err => console.error('Error obteniendo coordenadas:', err));
}

// Función para actualizar el modal (compatible con sidebar.js)
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

// Sobrescribir la función del modal para real-time
if (typeof window.updateModalInfo !== 'undefined') {
    window.updateModalInfo = updateRealtimeModalInfo;
}

document.addEventListener('DOMContentLoaded', () => {
    setupViewNavigation(false);
    initializeMap();
    fetchCoordinates();
    actualizarPosicion();
    setInterval(actualizarPosicion, 10000);
});