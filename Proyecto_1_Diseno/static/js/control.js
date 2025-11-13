// ==================== IMPORTAR MÓDULO DE MAPA ====================
import * as controlMap from "./modules/controlMap.js";
import * as routeManager from "./modules/routeManager.js";

// ==================== VARIABLES GLOBALES ====================
let selectedDeviceId = null;
let selectedDestination = null;
let activeDevices = [];
let deviceLocationUpdateInterval = null;

// Variables para detección de desviación de ruta
let currentRouteCoordinates = null; // Coordenadas de la ruta OSRM activa
let isOffRoute = false;
let offRouteThreshold = 100; // Metros de tolerancia
let lastOffRouteAlert = 0; // Timestamp de la última alerta

function showToast(message, type = "info") {
  // Crear contenedor de toasts si no existe
  let toastContainer = document.getElementById("toastContainer")
  if (!toastContainer) {
    toastContainer = document.createElement("div")
    toastContainer.id = "toastContainer"
    toastContainer.className = "toast-container"
    document.body.appendChild(toastContainer)
  }

  // Crear toast
  const toast = document.createElement("div")
  toast.className = `toast toast-${type}`

  // Seleccionar icono según el tipo
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

  // Auto-cerrar después de 4 segundos
  setTimeout(() => {
    toast.style.animation = "slideOut 0.3s ease-out forwards"
    setTimeout(() => toast.remove(), 300)
  }, 4000)
}


// ==================== GESTIÓN DE DISPOSITIVOS ====================

/**
 * Carga los dispositivos activos desde el servidor
 */
async function loadActiveDevices() {
  try {
    const response = await fetch('/test/api/devices/active');
    const devices = await response.json();
    
    activeDevices = devices;
    updateActiveDevicesCount(devices.length);
    renderDevicesList(devices);
    
    // Centrar el mapa en el primer dispositivo activo
    if (devices.length > 0) {
      await controlMap.centerMapOnFirstDevice();
    }
    
    console.log(devices);
    console.log(`✓ Cargados ${devices.length} dispositivos activos`);
  } catch (error) {
    console.error('Error cargando dispositivos:', error);
    showDevicesError();
  }
}

/**
 * Actualiza el contador de dispositivos activos en el modal
 */
function updateActiveDevicesCount(count) {
  const modalCount = document.getElementById('modalActiveDevices');
  if (modalCount) {
    modalCount.textContent = count;
  }
}

/**
 * Renderiza la lista de dispositivos
 */
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

/**
 * Crea una tarjeta de dispositivo
 */
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

/**
 * Muestra mensaje de error al cargar dispositivos
 */
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

/**
 * Selecciona un dispositivo y muestra su ubicación en tiempo real
 */
async function selectDevice(userId, cardElement) {
  // Si hay un dispositivo anterior diferente, limpiar todo antes de seleccionar nuevo
  if (selectedDeviceId && selectedDeviceId !== userId) {
    // Detener actualización de ubicación del dispositivo anterior
    if (deviceLocationUpdateInterval) {
      clearInterval(deviceLocationUpdateInterval);
      deviceLocationUpdateInterval = null;
    }
    
    // Limpiar marcador del dispositivo anterior
    controlMap.clearDeviceMarker();
    
    // Limpiar destino y ruta
    clearDestination();
  }
  
  // Remover selección visual anterior
  document.querySelectorAll('.device-card').forEach(card => {
    card.classList.remove('selected');
  });
  
  // Seleccionar nuevo dispositivo
  cardElement.classList.add('selected');
  selectedDeviceId = userId;
  updateHiddenField('selectedDeviceId', userId);
  
  // Obtener y mostrar la ubicación actual del dispositivo
  try {
    const response = await fetch(`/test/api/location/${userId}`);
    const data = await response.json();
    
    if (data.success) {
      // Mostrar marcador del dispositivo en el mapa
      controlMap.showDeviceLocation(data.lat, data.lon, userId);
      
      // Actualizar UI
      updateMapInstruction('ready', '✅', `Dispositivo ubicado en ${data.lat.toFixed(4)}, ${data.lon.toFixed(4)}. Haz clic en el mapa para seleccionar el destino`);
      controlMap.enableMapSelectionMode();
      
      // Iniciar actualización periódica de la ubicación del dispositivo
      startDeviceLocationUpdates(userId);
      
      console.log(`✓ Dispositivo seleccionado y ubicado: ${userId} (${data.lat.toFixed(6)}, ${data.lon.toFixed(6)})`);
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
 * Inicia la actualización periódica de la ubicación del dispositivo
 */
function startDeviceLocationUpdates(userId) {
  // Limpiar intervalo anterior si existe
  if (deviceLocationUpdateInterval) {
    clearInterval(deviceLocationUpdateInterval);
  }
  
  // Actualizar cada 10 segundos
  deviceLocationUpdateInterval = setInterval(async () => {
    if (selectedDeviceId !== userId) {
      clearInterval(deviceLocationUpdateInterval);
      return;
    }
    
    try {
      const response = await fetch(`/test/api/location/${userId}`);
      const data = await response.json();
      
      if (data.success) {
        // Actualizar posición del marcador
        controlMap.updateDeviceLocation(data.lat, data.lon, userId);
        
        // Verificar si está fuera de ruta (si hay ruta activa)
        if (selectedDestination && currentRouteCoordinates) {
          checkIfOffRoute(data.lat, data.lon);
        }
        
        // Si hay destino, actualizar la ruta
        if (selectedDestination) {
          await drawRoute(data.lat, data.lon, selectedDestination.lat, selectedDestination.lng);
        }
      }
    } catch (error) {
      console.error('Error actualizando ubicación del dispositivo:', error);
    }
  }, 10000); // 10 segundos
}

/**
 * Actualiza el mensaje de instrucción del mapa
 */
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

/**
 * Establece el destino seleccionado y dibuja la ruta
 */
async function setDestination(latlng) {
  if (!selectedDeviceId) {
    console.warn('⚠️ Selecciona un dispositivo primero');
    return;
  }
  
  selectedDestination = latlng;
  
  // Actualizar campos
  updateHiddenField('destinationLat', latlng.lat);
  updateHiddenField('destinationLng', latlng.lng);
  updateModalDestinationStatus('Sí');
  
  // Mostrar información del destino
  showDestinationInfo(latlng);
  
  // Actualizar marcador en el mapa
  controlMap.updateDestinationMarker(latlng);
  
  // Obtener ubicación actual del dispositivo y dibujar ruta
  try {
    const response = await fetch(`/test/api/location/${selectedDeviceId}`);
    const data = await response.json();
    
    if (data.success) {
      // Dibujar ruta OSRM
      const routeDrawn = await drawRoute(data.lat, data.lon, latlng.lat, latlng.lng);
      
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
 * Dibuja la ruta en el mapa usando OSRM
 */
async function drawRoute(startLat, startLng, endLat, endLng) {
  const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const coords = route.geometry.coordinates.map(c => [c[1], c[0]]); // [lat, lng]
      
      // Guardar coordenadas de la ruta para verificación de desviación
      currentRouteCoordinates = coords;
      
      // Dibujar la ruta en el mapa
      controlMap.drawRouteOnMap(coords, route.distance, route.duration);
      
      console.log(`✓ Ruta dibujada: ${(route.distance / 1000).toFixed(2)} km, ${Math.round(route.duration / 60)} min`);
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
 * Verifica si el dispositivo se salió de la ruta
 */
function checkIfOffRoute(currentLat, currentLng) {
  if (!currentRouteCoordinates || currentRouteCoordinates.length === 0) {
    return;
  }
  
  // Calcular la distancia mínima a la ruta
  let minDistance = Infinity;
  
  for (let i = 0; i < currentRouteCoordinates.length; i++) {
    const routePoint = currentRouteCoordinates[i];
    const distance = calculateDistance(currentLat, currentLng, routePoint[0], routePoint[1]);
    
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  
  console.log(`📏 Distancia a la ruta: ${minDistance.toFixed(2)}m`);
  
  // Si está a más de 100 metros de la ruta
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

/**
 * Calcula la distancia entre dos puntos en metros (Fórmula de Haversine)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Radio de la Tierra en metros
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c; // Distancia en metros
}

/**
 * Muestra alerta de desviación de ruta
 */
function showOffRouteAlert(distance) {
  // Evitar múltiples alertas en corto tiempo (cooldown de 30 segundos)
  const now = Date.now();
  if (now - lastOffRouteAlert < 30000) {
    return;
  }
  lastOffRouteAlert = now;
  
  const message = `⚠️ ¡${selectedDeviceId} se desvió de la ruta! Distancia: ${Math.round(distance)}m`;
  
  // Mostrar toast de advertencia
  showToast(message, 'warning');
  
  // Actualizar instrucción del mapa
  updateMapInstruction('warning', '⚠️', `Dispositivo fuera de ruta (${Math.round(distance)}m). La ruta se recalculará en la próxima actualización.`);
  
  console.log(`⚠️ ALERTA: Dispositivo ${selectedDeviceId} fuera de ruta - ${Math.round(distance)}m`);
}

/**
 * Oculta alerta de desviación de ruta
 */
function hideOffRouteAlert() {
  // Restaurar mensaje de éxito
  updateMapInstruction('success', '✅', 'Dispositivo de vuelta en la ruta. Destino enviado y en seguimiento.');
  
  showToast(`✅ Dispositivo ${selectedDeviceId} ha vuelto a la ruta`, 'success');
  
  console.log(`✅ Dispositivo ${selectedDeviceId} de vuelta en la ruta`);
}

/**
 * Muestra la información del destino
 */
function showDestinationInfo(latlng) {
  const destLatDisplay = document.getElementById('destLatDisplay');
  const destLngDisplay = document.getElementById('destLngDisplay');
  const destinationInfo = document.getElementById('destinationInfo');
  const btnSendDestination = document.getElementById('btnSendDestination');
  
  if (destLatDisplay) destLatDisplay.value = latlng.lat.toFixed(6);
  if (destLngDisplay) destLngDisplay.value = latlng.lng.toFixed(6);
  if (destinationInfo) destinationInfo.classList.add('show');
  
  // Rehabilitar y restaurar el texto del botón (en caso de que haya sido enviado antes)
  if (btnSendDestination) {
    btnSendDestination.disabled = false;
    btnSendDestination.innerHTML = '✈️ Enviar Destino';
  }
}

/**
 * Limpia el destino seleccionado
 */
function clearDestination() {
  selectedDestination = null;
  
  // Limpiar campos
  updateHiddenField('destinationLat', '');
  updateHiddenField('destinationLng', '');
  updateModalDestinationStatus('No');
  
  // Ocultar información
  const destinationInfo = document.getElementById('destinationInfo');
  const btnSendDestination = document.getElementById('btnSendDestination');
  
  if (destinationInfo) destinationInfo.classList.remove('show');
  
  // Restaurar el botón a su estado original
  if (btnSendDestination) {
    btnSendDestination.disabled = true;
    btnSendDestination.innerHTML = '✈️ Enviar Destino';
  }
  
  // Remover marcador y ruta del mapa
  controlMap.clearDestinationMarker();
  controlMap.clearRoute();
  
  // Limpiar datos de detección de ruta
  currentRouteCoordinates = null;
  isOffRoute = false;
  lastOffRouteAlert = 0;
  
  // Actualizar instrucciones si hay dispositivo seleccionado
  if (selectedDeviceId) {
    updateMapInstruction('ready', '✅', 'Haz clic en el mapa para seleccionar el destino');
  }
  
  console.log('✓ Destino limpiado');
}

// ==================== ENVÍO DE DESTINO ====================

/**
 * Envía el destino al dispositivo seleccionado
 */
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

/**
 * Maneja el éxito al enviar el destino
 */
function handleSendSuccess() {
  showToast("✅ Destino enviado correctamente! El dispositivo recibirá el destino en su próxima actualización.", "success")

  // NO limpiar nada - mantener ruta, destino y dispositivo visibles
  // Deshabilitar el botón de envío para evitar re-envíos
  const btnSendDestination = document.getElementById('btnSendDestination');
  if (btnSendDestination) {
    btnSendDestination.disabled = true;
    btnSendDestination.innerHTML = '✅ Destino Enviado';
  }
  
  // Actualizar el mensaje de instrucción
  updateMapInstruction('success', '✅', 'Destino enviado y en seguimiento. La ruta permanecerá hasta cambiar de dispositivo.');

  console.log("✓ Destino enviado correctamente (ruta y destino mantienen visibles)")
}

/**
 * Maneja el error al enviar el destino
 */
function handleSendError(errorMessage, btn, originalText) {
  showToast("Error al enviar destino: " + (errorMessage || "Error desconocido"), "error")
  btn.disabled = false
  btn.innerHTML = originalText
}

/**
 * Resetea toda la selección (dispositivo y destino)
 */
function resetSelection() {
  // Detener actualización de ubicación
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

/**
 * Actualiza la visualización de rutas asignadas
 */
async function updateRoutesVisualization() {
  if (activeDevices.length === 0) return;
  
  const map = controlMap.getMap();
  await routeManager.updateAllRoutes(activeDevices, map);
}

// ==================== UTILIDADES ====================

/**
 * Actualiza un campo oculto
 */
function updateHiddenField(id, value) {
  const field = document.getElementById(id);
  if (field) {
    field.textContent = value;
  }
}

/**
 * Actualiza el estado del destino en el modal
 */
function updateModalDestinationStatus(status) {
  const modalStatus = document.getElementById('modalDestinationStatus');
  if (modalStatus) {
    modalStatus.textContent = status;
  }
}

// ==================== EVENT LISTENERS ====================

/**
 * Configura los event listeners
 */
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

/**
 * Inicializa la aplicación de Torre de Control
 */
function init() {
  // Inicializar el mapa
  controlMap.initializeMap();
  
  // Configurar el callback para selección de destino
  controlMap.setDestinationCallback((latlng) => {
    if (selectedDeviceId) {
      setDestination(latlng);
    }
  });
  
  // Configurar event listeners
  setupEventListeners();
  
  // Cargar dispositivos activos
  loadActiveDevices().then(() => {
    // Actualizar rutas después de cargar dispositivos
    updateRoutesVisualization();
  });
  
  // Recargar dispositivos Y rutas cada 30 segundos
  setInterval(() => {
    loadActiveDevices().then(updateRoutesVisualization);
  }, 5000);
  
  console.log('✓ Torre de Control inicializada');
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', init);