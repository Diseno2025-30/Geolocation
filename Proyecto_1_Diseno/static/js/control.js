// ==================== IMPORTAR MÓDULO DE MAPA ====================
import * as controlMap from "./modules/controlMap.js";
import * as routeManager from "./modules/routeManager.js";

// ==================== VARIABLES GLOBALES ====================
let selectedDeviceId = null;
let selectedDestination = null;
let activeDevices = [];
let deviceLocationUpdateInterval = null;
let congestionMarkers = [];

// ✅ CRÍTICO: Variables separadas para ruta original y ruta actualizada
let originalRouteCoordinates = null; // Ruta ORIGINAL que NO se modifica
let currentRouteCoordinates = null; // Ruta actual (puede actualizarse)
let isOffRoute = false;
let offRouteThreshold = 100; // Metros de tolerancia
let lastOffRouteAlert = 0; // Timestamp de la última alerta

function showToast(message, type = "info") {
  let toastContainer = document.getElementById("toastContainer")
  if (!toastContainer) {
    toastContainer = document.createElement("div")
    toastContainer.id = "toastContainer"
    toastContainer.className = "toast-container"
    document.body.appendChild(toastContainer)
  }

  const toast = document.createElement("div")
  toast.className = `toast toast-${type}`

  const icons = {
    success: "✅",
    error: "❌",
    warning: "⚠️",
    info: "ℹ️",
  }

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `

  toastContainer.appendChild(toast)

  setTimeout(() => {
    toast.style.animation = "slideOut 0.3s ease-out forwards"
    setTimeout(() => toast.remove(), 300)
  }, 4000)
}

// ==================== GESTIÓN DE DISPOSITIVOS ====================

async function loadActiveDevices() {
  try {
    const response = await fetch('/test/api/devices/active');
    const devices = await response.json();
    
    activeDevices = devices;
    updateActiveDevicesCount(devices.length);
    renderDevicesList(devices);
    
    if (devices.length > 0) {
      await controlMap.centerMapOnFirstDevice();
    }
    
    console.log(`✓ Cargados ${devices.length} dispositivos activos`);
  } catch (error) {
    console.error('Error cargando dispositivos:', error);
    showDevicesError();
  }
}

function updateActiveDevicesCount(count) {
  const modalCount = document.getElementById('modalActiveDevices');
  if (modalCount) {
    modalCount.textContent = count;
  }
}

function renderDevicesList(devices) {
  const devicesList = document.getElementById('devicesList');
  devicesList.classList.remove('loading');
  
  if (devices.length === 0) {
    devicesList.innerHTML = `
      <div class="no-devices">
        <div class="no-devices-icon">📡</div>
        <p><strong>No hay dispositivos activos</strong></p>
        <p>Los dispositivos deben haber enviado una ubicación en los últimos 5 minutos</p>
      </div>
    `;
    return;
  }
  
  devicesList.innerHTML = '';
  devices.forEach(device => {
    const card = createDeviceCard(device);
    devicesList.appendChild(card);
  });
}

function createDeviceCard(device) {
  const card = document.createElement('div');
  card.className = 'device-card';
  card.setAttribute('data-user-id', device.user_id);
  card.innerHTML = `
    <div class="device-name">
      <span>🚗</span>
      <span>${device.name}</span>
    </div>
    <div class="device-id">ID: ${device.user_id}</div>
    <div class="device-status">Activo</div>
    <div class="device-timestamp">Última actualización: ${device.last_seen}</div>
  `;
  
  card.addEventListener('click', () => selectDevice(device.user_id, card));
  return card;
}

function showDevicesError() {
  const devicesList = document.getElementById('devicesList');
  devicesList.innerHTML = `
    <div class="no-devices">
      <div class="no-devices-icon">⚠️</div>
      <p><strong>Error al cargar dispositivos</strong></p>
      <p>Por favor, recarga la página</p>
    </div>
  `;
  devicesList.classList.remove('loading');
}

// ==================== SELECCIÓN DE DISPOSITIVO ====================

async function selectDevice(userId, cardElement) {
  if (selectedDeviceId && selectedDeviceId !== userId) {
    if (deviceLocationUpdateInterval) {
      clearInterval(deviceLocationUpdateInterval);
      deviceLocationUpdateInterval = null;
    }
    
    controlMap.clearDeviceMarker();
    clearDestination();
  }
  
  document.querySelectorAll('.device-card').forEach(card => {
    card.classList.remove('selected');
  });
  
  cardElement.classList.add('selected');
  selectedDeviceId = userId;
  updateHiddenField('selectedDeviceId', userId);
  
  try {
    const response = await fetch(`/test/api/location/${userId}`);
    const data = await response.json();
    
    if (data.success) {
      controlMap.showDeviceLocation(data.lat, data.lon, userId);
      
      updateMapInstruction('ready', '✅', `Dispositivo ubicado en ${data.lat.toFixed(4)}, ${data.lon.toFixed(4)}. Haz clic en el mapa para seleccionar el destino`);
      controlMap.enableMapSelectionMode();
      
      startDeviceLocationUpdates(userId);
      
      console.log(`✓ Dispositivo seleccionado y ubicado: ${userId}`);
    } else {
      showToast(`No se pudo obtener la ubicación del dispositivo ${userId}`, 'warning');
      updateMapInstruction('warning', '⚠️', 'No se encontró ubicación del dispositivo');
    }
  } catch (error) {
    console.error('Error obteniendo ubicación del dispositivo:', error);
    showToast('Error al obtener la ubicación del dispositivo', 'error');
    updateMapInstruction('warning', '⚠️', 'Error obteniendo ubicación del dispositivo');
  }
}

/**
 * Carga y muestra congestión en el mapa
 */
async function loadCongestion() {
  try {
    const response = await fetch('/test/api/congestion?time_window=5');
    const data = await response.json();
    
    if (data.success) {
      clearCongestionMarkers();
      
      // Procesar cada segmento con congestión
      for (const segment of data.congestion) {
        await showCongestionSegment(segment);
      }
      
      console.log(`🚦 ${data.total} segmentos con congestión detectados`);
    }
  } catch (error) {
    console.error('Error cargando congestión:', error);
  }
}

async function showCongestionSegment(segment) {
  // Verificar que tengamos al menos 2 puntos
  if (!segment.segment_coords || segment.segment_coords.length < 2) {
    console.warn(`⚠️ Segmento ${segment.segment_id} no tiene suficientes coordenadas`);
    return;
  }
  
  try {
    const coords = segment.segment_coords;
    
    // Encontrar puntos extremos del segmento
    let minLat = coords[0][0], maxLat = coords[0][0];
    let minLon = coords[0][1], maxLon = coords[0][1];
    
    coords.forEach(coord => {
      if (coord[0] < minLat) minLat = coord[0];
      if (coord[0] > maxLat) maxLat = coord[0];
      if (coord[1] < minLon) minLon = coord[1];
      if (coord[1] > maxLon) maxLon = coord[1];
    });
    
    // Puntos de inicio y fin del segmento
    const start = [minLat, minLon];
    const end = [maxLat, maxLon];
    
    // Llamar a OSRM LOCAL para obtener la geometría exacta del segmento de calle
    const url = `http://localhost:5001/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const routeCoords = route.geometry.coordinates.map(c => [c[1], c[0]]); // [lat, lon]
      
      // Dibujar línea roja GRUESA sobre el segmento de calle
      const polyline = L.polyline(routeCoords, {
        color: '#ef4444',        // Rojo intenso
        weight: 10,              // Grosor de línea
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
        className: 'congestion-line'
      });
      
      // Popup informativo
      polyline.bindPopup(`
        <div style="font-family: Arial, sans-serif;">
          <strong style="color: #ef4444; font-size: 16px;">🚦 Congestión Detectada</strong><br>
          <hr style="margin: 5px 0;">
          <strong>Calle:</strong> ${segment.street_name}<br>
          <strong>Vehículos:</strong> ${segment.vehicle_count}<br>
          <strong>IDs:</strong> ${segment.vehicle_ids.join(', ')}<br>
          <strong>Distancia:</strong> ${(route.distance).toFixed(0)} metros<br>
          <small style="color: #666;">Segmento ID: ${segment.segment_id}</small>
        </div>
      `);
      
      polyline.addTo(controlMap.getMap());
      congestionMarkers.push(polyline);
      
      console.log(`✅ Línea de congestión dibujada: ${segment.street_name} (${segment.vehicle_count} vehículos, ${(route.distance).toFixed(0)}m)`);
      
    } else {
      console.warn(`⚠️ OSRM no encontró ruta para segmento ${segment.segment_id}, usando línea simple`);
      drawSimpleCongestionLine(segment);
    }
    
  } catch (error) {
    console.error(`❌ Error dibujando segmento ${segment.segment_id}:`, error);
    drawSimpleCongestionLine(segment);
  }
}

function drawSimpleCongestionLine(segment) {
  if (segment.segment_coords && segment.segment_coords.length >= 2) {
    const polyline = L.polyline(segment.segment_coords, {
      color: '#ef4444',
      weight: 8,
      opacity: 0.8
    });
    
    polyline.bindPopup(`
      <strong style="color: #ef4444;">🚦 Congestión</strong><br>
      <strong>${segment.street_name}</strong><br>
      Vehículos: <strong>${segment.vehicle_count}</strong><br>
      IDs: ${segment.vehicle_ids.join(', ')}
    `);
    
    polyline.addTo(controlMap.getMap());
    congestionMarkers.push(polyline);
    
    console.log(`✅ Línea simple dibujada: ${segment.street_name}`);
  }
}

/**
 * Limpia todos los marcadores de congestión
 */
function clearCongestionMarkers() {
  congestionMarkers.forEach(marker => {
    controlMap.getMap().removeLayer(marker);
  });
  congestionMarkers = [];
}


function startDeviceLocationUpdates(userId) {
  if (deviceLocationUpdateInterval) {
    clearInterval(deviceLocationUpdateInterval);
  }
  
  deviceLocationUpdateInterval = setInterval(async () => {
    if (selectedDeviceId !== userId) {
      clearInterval(deviceLocationUpdateInterval);
      return;
    }
    
    try {
      const response = await fetch(`/test/api/location/${userId}`);
      const data = await response.json();
      
      if (data.success) {
        controlMap.updateDeviceLocation(data.lat, data.lon, userId);
        
        // ✅ CRÍTICO: Verificar desviación usando la ruta ORIGINAL
        if (selectedDestination && originalRouteCoordinates) {
          checkIfOffRoute(data.lat, data.lon);
        }
        
        // ✅ CAMBIO: Solo actualizar visualmente la ruta, NO la ruta de referencia
        if (selectedDestination) {
          await updateRouteVisualization(data.lat, data.lon, selectedDestination.lat, selectedDestination.lng);
        }
      }
    } catch (error) {
      console.error('Error actualizando ubicación del dispositivo:', error);
    }
  }, 10000); // 10 segundos
}

function updateMapInstruction(className, emoji, text) {
  const instruction = document.getElementById('mapInstruction');
  if (!instruction) return;
  
  instruction.className = `map-instruction ${className}`;
  instruction.innerHTML = `
    <span style="font-size: 1.5rem;">${emoji}</span>
    <span>${text}</span>
  `;
}

// ==================== GESTIÓN DE DESTINO ====================

async function setDestination(latlng) {
  if (!selectedDeviceId) {
    console.warn('⚠️ Selecciona un dispositivo primero');
    return;
  }
  
  selectedDestination = latlng;
  
  updateHiddenField('destinationLat', latlng.lat);
  updateHiddenField('destinationLng', latlng.lng);
  updateModalDestinationStatus('Sí');
  
  showDestinationInfo(latlng);
  controlMap.updateDestinationMarker(latlng);
  
  try {
    const response = await fetch(`/test/api/location/${selectedDeviceId}`);
    const data = await response.json();
    
    if (data.success) {
      // ✅ CRÍTICO: Dibujar ruta inicial y guardarla como referencia
      const routeDrawn = await drawInitialRoute(data.lat, data.lon, latlng.lat, latlng.lng);
      
      if (routeDrawn) {
        updateMapInstruction('success', '🎯', 'Ruta calculada. Haz clic en "Enviar Destino" para confirmar');
      } else {
        updateMapInstruction('warning', '⚠️', 'Destino establecido pero no se pudo calcular la ruta');
      }
    }
  } catch (error) {
    console.error('Error dibujando ruta:', error);
    updateMapInstruction('warning', '⚠️', 'Destino establecido pero no se pudo calcular la ruta');
  }
  
  console.log(`✓ Destino establecido: ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`);
}

/**
 * ✅ NUEVO: Dibuja la ruta INICIAL y la guarda como referencia permanente
 */
async function drawInitialRoute(startLat, startLng, endLat, endLng) {
  const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const coords = route.geometry.coordinates.map(c => [c[1], c[0]]); // [lat, lng]
      
      // ✅ CRÍTICO: Guardar como ruta ORIGINAL (no se modifica)
      originalRouteCoordinates = coords;
      currentRouteCoordinates = coords;
      
      // Dibujar en el mapa
      controlMap.drawRouteOnMap(coords, route.distance, route.duration);
      
      console.log(`✓ Ruta ORIGINAL guardada: ${(route.distance / 1000).toFixed(2)} km`);
      return true;
    } else {
      console.warn('⚠️ No se encontró ruta OSRM');
      return false;
    }
  } catch (error) {
    console.error('❌ Error al obtener ruta OSRM:', error);
    return false;
  }
}

/**
 * ✅ NUEVO: Actualiza solo la visualización de la ruta, NO la referencia original
 */
async function updateRouteVisualization(startLat, startLng, endLat, endLng) {
  const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
      
      // ✅ Solo actualizar la visualización, NO la ruta original
      currentRouteCoordinates = coords;
      
      // Dibujar en el mapa
      controlMap.drawRouteOnMap(coords, route.distance, route.duration);
      
      console.log(`🔄 Ruta actualizada visualmente: ${(route.distance / 1000).toFixed(2)} km`);
    }
  } catch (error) {
    console.error('❌ Error actualizando visualización de ruta:', error);
  }
}

/**
 * ✅ CORREGIDO: Verifica desviación usando la ruta ORIGINAL
 */
function checkIfOffRoute(currentLat, currentLng) {
  // ✅ Usar originalRouteCoordinates en lugar de currentRouteCoordinates
  if (!originalRouteCoordinates || originalRouteCoordinates.length === 0) {
    return;
  }
  
  let minDistance = Infinity;
  
  for (let i = 0; i < originalRouteCoordinates.length; i++) {
    const routePoint = originalRouteCoordinates[i];
    const distance = calculateDistance(currentLat, currentLng, routePoint[0], routePoint[1]);
    
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  
  console.log(`📏 Distancia a la ruta ORIGINAL: ${minDistance.toFixed(2)}m`);
  
  if (minDistance > offRouteThreshold) {
    if (!isOffRoute) {
      isOffRoute = true;
      showOffRouteAlert(minDistance);
    }
  } else {
    if (isOffRoute) {
      isOffRoute = false;
      hideOffRouteAlert();
    }
  }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}

function showOffRouteAlert(distance) {
  const now = Date.now();
  if (now - lastOffRouteAlert < 30000) {
    return;
  }
  lastOffRouteAlert = now;
  
  const message = `⚠️ ¡${selectedDeviceId} se desvió de la ruta! Distancia: ${Math.round(distance)}m`;
  
  showToast(message, 'warning');
  
  updateMapInstruction('warning', '⚠️', `Dispositivo fuera de ruta (${Math.round(distance)}m). La visualización se actualiza pero se compara con la ruta original.`);
  
  console.log(`⚠️ ALERTA: Dispositivo ${selectedDeviceId} fuera de ruta - ${Math.round(distance)}m`);
}

function hideOffRouteAlert() {
  updateMapInstruction('success', '✅', 'Dispositivo de vuelta en la ruta. Destino enviado y en seguimiento.');
  
  showToast(`✅ Dispositivo ${selectedDeviceId} ha vuelto a la ruta`, 'success');
  
  console.log(`✅ Dispositivo ${selectedDeviceId} de vuelta en la ruta`);
}

function showDestinationInfo(latlng) {
  const destLatDisplay = document.getElementById('destLatDisplay');
  const destLngDisplay = document.getElementById('destLngDisplay');
  const destinationInfo = document.getElementById('destinationInfo');
  const btnSendDestination = document.getElementById('btnSendDestination');
  
  if (destLatDisplay) destLatDisplay.value = latlng.lat.toFixed(6);
  if (destLngDisplay) destLngDisplay.value = latlng.lng.toFixed(6);
  if (destinationInfo) destinationInfo.classList.add('show');
  
  if (btnSendDestination) {
    btnSendDestination.disabled = false;
    btnSendDestination.innerHTML = '✈️ Enviar Destino';
  }
}

function clearDestination() {
  selectedDestination = null;
  
  updateHiddenField('destinationLat', '');
  updateHiddenField('destinationLng', '');
  updateModalDestinationStatus('No');
  
  const destinationInfo = document.getElementById('destinationInfo');
  const btnSendDestination = document.getElementById('btnSendDestination');
  
  if (destinationInfo) destinationInfo.classList.remove('show');
  
  if (btnSendDestination) {
    btnSendDestination.disabled = true;
    btnSendDestination.innerHTML = '✈️ Enviar Destino';
  }
  
  controlMap.clearDestinationMarker();
  controlMap.clearRoute();
  
  // ✅ CRÍTICO: Limpiar AMBAS rutas
  originalRouteCoordinates = null;
  currentRouteCoordinates = null;
  isOffRoute = false;
  lastOffRouteAlert = 0;
  
  if (selectedDeviceId) {
    updateMapInstruction('ready', '✅', 'Haz clic en el mapa para seleccionar el destino');
  }
  
  console.log('✓ Destino limpiado');
}

// ==================== ENVÍO DE DESTINO ====================

async function sendDestination() {
  if (!selectedDeviceId || !selectedDestination) {
    showToast("Por favor selecciona un dispositivo y un destino", "warning")
    return
  }

  const btn = document.getElementById("btnSendDestination")
  if (!btn) return

  const originalText = btn.innerHTML
  btn.disabled = true
  btn.innerHTML = "⏳ Enviando..."

  try {
    const response = await fetch("/test/api/destination/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: selectedDeviceId,
        latitude: selectedDestination.lat,
        longitude: selectedDestination.lng,
      }),
    })

    const data = await response.json()

    if (data.success) {
      btn.disabled = false
      btn.innerHTML = originalText
      handleSendSuccess()
    } else {
      handleSendError(data.error, btn, originalText)
    }
  } catch (error) {
    console.error("Error:", error)
    handleSendError("Error de conexión", btn, originalText)
  }
}

function handleSendSuccess() {
  showToast("✅ Destino enviado correctamente! El dispositivo recibirá el destino en su próxima actualización.", "success")

  const btnSendDestination = document.getElementById('btnSendDestination');
  if (btnSendDestination) {
    btnSendDestination.disabled = true;
    btnSendDestination.innerHTML = '✅ Destino Enviado';
  }
  
  updateMapInstruction('success', '✅', 'Destino enviado. Se detectarán desviaciones de la ruta original.');

  console.log("✓ Destino enviado correctamente")
}

function handleSendError(errorMessage, btn, originalText) {
  showToast("Error al enviar destino: " + (errorMessage || "Error desconocido"), "error")
  btn.disabled = false
  btn.innerHTML = originalText
}

function resetSelection() {
  if (deviceLocationUpdateInterval) {
    clearInterval(deviceLocationUpdateInterval);
    deviceLocationUpdateInterval = null;
  }
  
  clearDestination();
  selectedDeviceId = null;
  
  document.querySelectorAll('.device-card').forEach(card => {
    card.classList.remove('selected');
  });
  
  controlMap.disableMapSelectionMode();
  controlMap.clearDeviceMarker();
  updateMapInstruction('waiting', '⚠️', 'Selecciona un dispositivo para continuar');
}

async function updateRoutesVisualization() {
  if (activeDevices.length === 0) return;
  
  const map = controlMap.getMap();
  await routeManager.updateAllRoutes(activeDevices, map);
}

// ==================== UTILIDADES ====================

function updateHiddenField(id, value) {
  const field = document.getElementById(id);
  if (field) {
    field.textContent = value;
  }
}

function updateModalDestinationStatus(status) {
  const modalStatus = document.getElementById('modalDestinationStatus');
  if (modalStatus) {
    modalStatus.textContent = status;
  }
}

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
  const btnSendDestination = document.getElementById('btnSendDestination');
  const btnCancelDestination = document.getElementById('btnCancelDestination');
  
  if (btnSendDestination) {
    btnSendDestination.addEventListener('click', sendDestination);
  }
  
  if (btnCancelDestination) {
    btnCancelDestination.addEventListener('click', clearDestination);
  }
}

// ==================== INICIALIZACIÓN ====================

function init() {
  controlMap.initializeMap();
  
  controlMap.setDestinationCallback((latlng) => {
    if (selectedDeviceId) {
      setDestination(latlng);
    }
  });
  
  setupEventListeners();
  
  loadActiveDevices().then(() => {
    updateRoutesVisualization();
    loadCongestion();
  });
  
  setInterval(() => {
    loadActiveDevices().then(() => {
      updateRoutesVisualization();
      loadCongestion();
    });
  }, 5000);
  
  console.log('✓ Torre de Control inicializada');
}

document.addEventListener('DOMContentLoaded', init);