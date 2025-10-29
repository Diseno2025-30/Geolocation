import { getOSRMRoute, generateFullStreetRoute } from './osrm.js';

let map;
let marker;
let trayectoria = [];
let trayectoriaRaw = [];
let polyline = null;
let trayectoriaVisible = true;
let ultimaPosicion = null;
let isGeneratingRoute = false;

export function initializeMap() {
    map = L.map('map').setView([11.0, -74.8], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    
    marker = L.marker([11.0, -74.8]).addTo(map);
}

export function updateMarkerPosition(lat, lon) {
    marker.setLatLng([lat, lon]);
    
    if (trayectoria.length === 0) {
        map.setView([lat, lon], 15);
    } else {
        map.panTo([lat, lon]);
    }
}

async function generarRutaPorCallesRealtime(puntosRaw) {
    if (puntosRaw.length < 2) {
        return puntosRaw;
    }
    
    const ultimoIndice = puntosRaw.length - 1;
    const [lat1, lon1] = puntosRaw[ultimoIndice - 1];
    const [lat2, lon2] = puntosRaw[ultimoIndice];
    
    const rutaOSRM = await getOSRMRoute(lat1, lon1, lat2, lon2);
    
    if (rutaOSRM && rutaOSRM.length > 0) {
        console.log(`✓ Segmento ${ultimoIndice} generado por calles (${rutaOSRM.length} puntos)`);
        return rutaOSRM.slice(1);
    } else {
        console.log(`⚠ Segmento ${ultimoIndice} usando línea recta`);
        return [[lat2, lon2]];
    }
}

export async function agregarPuntoTrayectoria(lat, lon) {
    const nuevaPosicion = [lat, lon];
    
    if (ultimaPosicion === null || 
        Math.abs(ultimaPosicion[0] - lat) > 0.00001 || 
        Math.abs(ultimaPosicion[1] - lon) > 0.00001) {
        
        trayectoriaRaw.push(nuevaPosicion);
        ultimaPosicion = nuevaPosicion;
        
        if (trayectoria.length === 0) {
            trayectoria.push(nuevaPosicion);
            actualizarPolyline();
            return trayectoriaRaw.length;
        }
        
        if (!isGeneratingRoute) {
            isGeneratingRoute = true;
            try {
                const nuevoSegmento = await generarRutaPorCallesRealtime(trayectoriaRaw);
                trayectoria.push(...nuevoSegmento);
                actualizarPolyline();
            } catch (error) {
                console.error('Error generando ruta:', error);
                trayectoria.push(nuevaPosicion);
                actualizarPolyline();
            } finally {
                isGeneratingRoute = false;
            }
        }
    }
    return trayectoriaRaw.length;
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

export function limpiarTrayectoria() {
    trayectoria = [];
    trayectoriaRaw = [];
    ultimaPosicion = null;
    
    if (polyline) {
        map.removeLayer(polyline);
        polyline = null;
    }
    return 0;
}

export function toggleTrayectoria() {
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

export async function regenerarRuta() {
    if (trayectoriaRaw.length < 2) {
        alert('No hay suficientes puntos para regenerar la ruta');
        return;
    }
    
    const confirmar = confirm(`¿Regenerar toda la ruta usando ${trayectoriaRaw.length} puntos GPS?`);
    if (!confirmar) return;
    
    console.log('🔄 Regenerando ruta completa...');
    
    try {
        const puntosObj = trayectoriaRaw.map(p => ({ lat: p[0], lon: p[1] }));        
        const nuevaRuta = await generateFullStreetRoute(puntosObj);
        
        trayectoria = nuevaRuta;
        actualizarPolyline();
        alert('✓ Ruta regenerada exitosamente');
    } catch (error) {
        console.error('Error regenerando ruta:', error);
        alert('✗ Error al regenerar la ruta');
    }
}