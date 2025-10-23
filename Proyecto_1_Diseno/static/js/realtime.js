// realtime.js - Lógica específica para vista Real-Time con routing por calles

let map;
let marker;
let trayectoria = [];
let trayectoriaRaw = []; // Puntos GPS originales
let polyline = null;
let trayectoriaVisible = true;
let ultimaPosicion = null;
let isGeneratingRoute = false; // Flag para evitar generar múltiples rutas simultáneas

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
 * Optimizado para real-time: solo genera ruta del último segmento
 * @param {Array} puntos - Array de puntos [lat, lon]
 * @returns {Array} - Array con todos los puntos de la ruta siguiendo calles
 */
async function generarRutaPorCallesRealtime(puntos) {
    if (puntos.length < 2) {
        return puntos;
    }
    
    // En real-time, solo generamos la ruta del último segmento añadido
    const ultimoIndice = puntos.length - 1;
    const [lat1, lon1] = puntos[ultimoIndice - 1];
    const [lat2, lon2] = puntos[ultimoIndice];
    
    // Intentar obtener ruta por calles
    const rutaOSRM = await obtenerRutaOSRM(lat1, lon1, lat2, lon2);
    
    if (rutaOSRM && rutaOSRM.length > 0) {
        console.log(`✓ Segmento ${ultimoIndice} generado por calles (${rutaOSRM.length} puntos)`);
        // Remover el primer punto para evitar duplicados y agregar la ruta
        return rutaOSRM.slice(1);
    } else {
        console.log(`⚠ Segmento ${ultimoIndice} usando línea recta`);
        // Si falla, solo agregar el punto final
        return [[lat2, lon2]];
    }
}

/**
 * Genera la ruta completa desde cero (útil al recargar la página)
 * @param {Array} puntos - Array de puntos [lat, lon]
 * @returns {Array} - Array con todos los puntos de la ruta siguiendo calles
 */
async function regenerarRutaCompleta(puntos) {
    if (puntos.length < 2) {
        return puntos;
    }
    
    console.log(`🗺️ Regenerando ruta completa para ${puntos.length} puntos...`);
    
    const segmentosRuta = [];
    let rutasExitosas = 0;
    let rutasFallidas = 0;
    
    for (let i = 0; i < puntos.length - 1; i++) {
        const [lat1, lon1] = puntos[i];
        const [lat2, lon2] = puntos[i + 1];
        
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
    
    console.log(`✓ Ruta regenerada: ${rutasExitosas} segmentos por calles, ${rutasFallidas} líneas rectas`);
    return segmentosRuta;
}

// ==============================================================

async function agregarPuntoTrayectoria(lat, lon) {
    const nuevaPosicion = [lat, lon];
    
    // Verificar si es un punto realmente nuevo
    if (ultimaPosicion === null || 
        Math.abs(ultimaPosicion[0] - lat) > 0.00001 || 
        Math.abs(ultimaPosicion[1] - lon) > 0.00001) {
        
        // Guardar punto GPS original
        trayectoriaRaw.push(nuevaPosicion);
        ultimaPosicion = nuevaPosicion;
        
        // Si es el primer punto, solo agregarlo
        if (trayectoria.length === 0) {
            trayectoria.push(nuevaPosicion);
            puntosTrayectoriaHiddenElement.textContent = trayectoriaRaw.length;
            actualizarPolyline();
            return;
        }
        
        // Si ya hay puntos, generar ruta por calles del último segmento
        if (!isGeneratingRoute) {
            isGeneratingRoute = true;
            
            try {
                const nuevoSegmento = await generarRutaPorCallesRealtime(trayectoriaRaw);
                
                // Agregar el nuevo segmento a la trayectoria
                trayectoria.push(...nuevoSegmento);
                
                // Actualizar contador de puntos GPS originales
                puntosTrayectoriaHiddenElement.textContent = trayectoriaRaw.length;
                
                // Actualizar visualización
                actualizarPolyline();
            } catch (error) {
                console.error('Error generando ruta:', error);
                // Si falla, agregar el punto directamente
                trayectoria.push(nuevaPosicion);
                actualizarPolyline();
            } finally {
                isGeneratingRoute = false;
            }
        }
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
            
            polyline.bindPopup(`Trayectoria: ${trayectoriaRaw.length} puntos GPS (${trayectoria.length} puntos en ruta)`);
        }
    }
}

function limpiarTrayectoria() {
    trayectoria = [];
    trayectoriaRaw = [];
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

/**
 * Botón adicional para regenerar ruta completa (útil si OSRM estaba caído)
 */
async function regenerarRuta() {
    if (trayectoriaRaw.length < 2) {
        alert('No hay suficientes puntos para regenerar la ruta');
        return;
    }
    
    const confirmar = confirm(`¿Regenerar toda la ruta usando ${trayectoriaRaw.length} puntos GPS?`);
    if (!confirmar) return;
    
    console.log('🔄 Regenerando ruta completa...');
    
    try {
        // Regenerar ruta completa desde los puntos GPS originales
        const nuevaRuta = await regenerarRutaCompleta(trayectoriaRaw);
        trayectoria = nuevaRuta;
        
        // Actualizar visualización
        actualizarPolyline();
        
        alert('✓ Ruta regenerada exitosamente');
    } catch (error) {
        console.error('Error regenerando ruta:', error);
        alert('✗ Error al regenerar la ruta');
    }
}

// Exponer función globalmente para uso desde HTML
window.regenerarRuta = regenerarRuta;

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