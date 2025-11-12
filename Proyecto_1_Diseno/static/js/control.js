// ==================== IMPORTAR MÓDULO DE MAPA ====================
import * as controlMap from "./modules/controlMap.js";
import * as routeManager from "./modules/routeManager.js";

// ==================== VARIABLES GLOBALES ====================
let selectedDeviceId = null;
let selectedDestination = null;
let activeDevices = [];

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
  document.getElementById('devicesList').innerHTML = `
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
 * Selecciona un dispositivo
 */
function selectDevice(userId, cardElement) {
  // Remover selección anterior
  document.querySelectorAll('.device-card').forEach(card => {
    card.classList.remove('selected');
  });
  
  // Seleccionar nuevo dispositivo
  cardElement.classList.add('selected');
  selectedDeviceId = userId;
  updateHiddenField('selectedDeviceId', userId);
  
  // Actualizar UI
  updateMapInstruction('ready', '✅', 'Haz clic en el mapa para seleccionar el destino');
  controlMap.enableMapSelectionMode();
  clearDestination();
  
  console.log(`✓ Dispositivo seleccionado: ${userId}`);
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
 * Establece el destino seleccionado (llamado desde el callback del mapa)
 */
function setDestination(latlng) {
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
  
  // Actualizar instrucciones
  updateMapInstruction('ready', '🎯', 'Destino establecido. Haz clic en "Enviar Destino" para confirmar');
  
  console.log(`✓ Destino establecido: ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`);
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
  if (btnSendDestination) btnSendDestination.disabled = false;
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
  if (btnSendDestination) btnSendDestination.disabled = true;
  
  // Remover marcador del mapa
  controlMap.clearDestinationMarker();
  
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
    alert('⚠️ Por favor selecciona un dispositivo y un destino');
    return;
  }
  
  const btn = document.getElementById('btnSendDestination');
  if (!btn) return;
  
  btn.disabled = true;
  btn.innerHTML = '⏳ Enviando...';
  
  try {
    const response = await fetch('/test/api/destination/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user_id: selectedDeviceId,
        latitude: selectedDestination.lat,
        longitude: selectedDestination.lng
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      handleSendSuccess();
    } else {
      handleSendError(data.error, btn);
    }
  } catch (error) {
    console.error('Error:', error);
    handleSendError('Error de conexión', btn);
  }
}

/**
 * Maneja el éxito al enviar el destino
 */
function handleSendSuccess() {
  alert('✅ Destino enviado correctamente!\n\nEl dispositivo recibirá el destino en su próxima actualización.');
  
  // Limpiar selección
  resetSelection();
  
  console.log('✓ Destino enviado correctamente');
}

/**
 * Maneja el error al enviar el destino
 */
function handleSendError(errorMessage, btn) {
  alert('❌ Error al enviar destino: ' + (errorMessage || 'Error desconocido'));
  btn.disabled = false;
  btn.innerHTML = '✈️ Enviar Destino';
}

/**
 * Resetea toda la selección (dispositivo y destino)
 */
function resetSelection() {
  clearDestination();
  selectedDeviceId = null;
  
  document.querySelectorAll('.device-card').forEach(card => {
    card.classList.remove('selected');
  });
  
  controlMap.disableMapSelectionMode();
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
  }, 30000);
  
  console.log('✓ Torre de Control inicializada');
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', init);
