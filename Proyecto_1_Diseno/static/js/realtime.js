import * as map from "./modules/realtimeMap.js";

// --- Elementos de la UI ---
let statusHiddenElement,
  lastUpdateHiddenElement,
  puntosTrayectoriaHiddenElement;
let latitudeElement, longitudeElement, deviceIdElement, timestampElement;

// --- Estado en Memoria ---
// Almacena datos de todos los dispositivos que hemos visto en esta sesión
const devicesData = {};

// --- Colores ---
// Colores fijos por user_id (para consistencia)
const userIdColors = {
  1: "#FF4444", // Rojo
  2: "#44FF44", // Verde
  3: "#4444FF", // Azul
  4: "#FFAA00", // Naranja
  5: "#FF44FF", // Magenta
  6: "#44FFFF", // Cian
  7: "#FFFF44", // Amarillo
  8: "#AA44FF", // Púrpura
  9: "#FF8888", // Rosa
  10: "#88FF88", // Verde claro
  11: "#8888FF", // Azul claro
  12: "#FFCC00", // Dorado
  13: "#FF0088", // Fucsia
  14: "#00FFAA", // Turquesa
  15: "#AAFF00", // Lima
  16: "#AA00FF", // Violeta
  17: "#FF6600", // Naranja oscuro
  18: "#0066FF", // Azul real
  19: "#FF0066", // Rosa intenso
  20: "#66FF00", // Verde lima
};

/**
 * Obtiene un color consistente basado en el user_id.
 * @param {string|number} userId - El ID del usuario.
 * @returns {string} Un color HSL o hexadecimal.
 */
function getColorByUserId(userId) {
  if (userIdColors[userId]) {
    return userIdColors[userId];
  }
  // Si no existe, generar color basado en el ID
  const numId = parseInt(String(userId).slice(-3)) || 0;
  const hue = (numId * 137.508) % 360; // Golden angle
  return `hsl(${hue}, 70%, 50%)`;
}

// --- Actualizadores de UI ---

/**
 * Actualiza el panel principal de "Posición Actual".
 * Muestra los datos del *último* dispositivo recibido o un resumen.
 * @param {object|null} data - El objeto de coordenadas o null para mostrar resumen
 * @param {number} totalDevices - Número total de dispositivos activos
 */
function updateDisplay(data, totalDevices = 0) {
  if (totalDevices > 1) {
    // Mostrar resumen cuando hay múltiples dispositivos
    latitudeElement.textContent = "Múltiples";
    longitudeElement.textContent = "Dispositivos";
    deviceIdElement.textContent = `${totalDevices} activos`;
    timestampElement.textContent = new Date().toLocaleTimeString();
  } else if (data && data.lat) {
    latitudeElement.textContent = data.lat.toFixed(6);
    longitudeElement.textContent = data.lon.toFixed(6);
    deviceIdElement.textContent = data.user_id || data.source || "---";
    timestampElement.textContent = data.timestamp || "---";
  } else {
    // Si no hay datos, limpiar el panel
    latitudeElement.textContent = "---.------";
    longitudeElement.textContent = "---.------";
    deviceIdElement.textContent = "---";
    timestampElement.textContent = "---";
  }
}

/**
 * Actualiza el estado global (ONLINE/OFFLINE) en los elementos ocultos.
 * @param {boolean} online - true si está online, false si está offline.
 */
function setOnlineStatus(online) {
  const statusText = online ? "ONLINE" : "OFFLINE";
  statusHiddenElement.textContent = statusText;

  // Actualizar hora de última actualización solo si estamos online
  if (online) {
    const currentTime = new Date().toLocaleTimeString();
    lastUpdateHiddenElement.textContent = currentTime;
  }
}

/**
 * Actualiza el contenido del modal de información.
 */
function updateRealtimeModalInfo() {
  const modalStatus = document.getElementById("modalStatus");
  const modalLastUpdate = document.getElementById("modalLastUpdate");
  const modalPuntos = document.getElementById("modalPuntos");

  if (modalStatus && statusHiddenElement) {
    const status = statusHiddenElement.textContent;
    modalStatus.textContent = status;
    modalStatus.className =
      status === "ONLINE" ? "modal-value online" : "modal-value offline";
  }
  if (modalLastUpdate && lastUpdateHiddenElement) {
    modalLastUpdate.textContent = lastUpdateHiddenElement.textContent;
  }
  if (modalPuntos && puntosTrayectoriaHiddenElement) {
    modalPuntos.textContent = puntosTrayectoriaHiddenElement.textContent;
  }
}

/**
 * Dibuja la lista de dispositivos activos en el sidebar.
 */
function updateDevicesList() {
  const devicesList = document.getElementById("devicesList");
  if (!devicesList) return;

  if (Object.keys(devicesData).length === 0) {
    devicesList.innerHTML =
      '<p class="no-devices">No hay dispositivos activos</p>';
    return;
  }

  devicesList.innerHTML = "";

  // Ordenar por ID de usuario para consistencia
  const sortedDeviceIds = Object.keys(devicesData).sort((a, b) => {
    return (devicesData[a].user_id || 0) - (devicesData[b].user_id || 0);
  });

  for (const deviceId of sortedDeviceIds) {
    const deviceData = devicesData[deviceId];
    const hasDestination = map.hasActiveDestination(deviceId);
    
    const deviceItem = document.createElement("div");
    deviceItem.className = "device-item";
    deviceItem.innerHTML = `
      <span class="device-color" style="background-color: ${deviceData.color}"></span>
      <div class="device-info">
        <div class="device-id">
          ${deviceId} (ID: ${deviceData.user_id})
          ${hasDestination ? '<span class="destination-badge">🎯</span>' : ''}
        </div>
        <div class="device-coords">${deviceData.lat.toFixed(6)}, ${deviceData.lon.toFixed(6)}</div>
        <div class="device-meta">
          <span class="device-source">${deviceData.source || "N/A"}</span>
          ${deviceData.timestamp
            ? `<span class="device-time">${new Date(
                deviceData.timestamp.replace(
                  /(\d{2})\/(\d{2})\/(\d{4})/,
                  "$3-$2-$1"
                )
              ).toLocaleTimeString()}</span>`
            : ""
          }
        </div>
      </div>
      <div class="device-actions">
        <button class="device-action-btn" onclick="toggleDeviceTrayectoria('${deviceId}')" title="Toggle trayectoria">
          👁️
        </button>
        <button class="device-action-btn" onclick="limpiarDeviceTrayectoria('${deviceId}')" title="Limpiar trayectoria">
          🗑️
        </button>
        ${hasDestination ? `
          <button class="device-action-btn" onclick="toggleDeviceRecommendedRoute('${deviceId}')" title="Toggle ruta recomendada">
            🗺️
          </button>
        ` : ''}
      </div>
    `;
    devicesList.appendChild(deviceItem);
  }
}

// --- Lógica Principal ---

/**
 * Función principal que se ejecuta en bucle.
 * Obtiene las coordenadas de TODOS los dispositivos activos.
 */
async function actualizarPosicion() {
  const basePath = getBasePath();

  try {
    // Usar /coordenadas/all para obtener TODOS los dispositivos activos
    const response = await fetch(`${basePath}/coordenadas/all`);

    if (!response.ok) {
      console.error("Error al obtener coordenadas:", response.status);
      setOnlineStatus(false);
      updateRealtimeModalInfo();
      return;
    }

    const devicesArray = await response.json();

    // Verificar que hay dispositivos activos
    if (!Array.isArray(devicesArray) || devicesArray.length === 0) {
      console.warn("No hay dispositivos activos en este momento");
      setOnlineStatus(false);
      updateDisplay(null, 0);
      updateRealtimeModalInfo();
      return;
    }

    // Hay dispositivos activos
    setOnlineStatus(true);
    console.log(`📡 Recibidos ${devicesArray.length} dispositivos activos`);

    // Procesar CADA dispositivo
    let totalPuntos = 0;
    for (const data of devicesArray) {
      // Validar datos
      if (!data || !data.lat || !data.lon) {
        console.warn("Datos inválidos para dispositivo:", data);
        continue;
      }

      // Extraer datos y crear ID único
      const userId = data.user_id || 1;
      const deviceId = `user_${userId}`;
      const lat = data.lat;
      const lon = data.lon;
      const color = getColorByUserId(userId);

      // Almacenar/Actualizar datos de este dispositivo en la memoria
      devicesData[deviceId] = {
        lat,
        lon,
        timestamp: data.timestamp,
        user_id: userId,
        source: data.source,
        color: color,
      };

      // Actualizar el mapa (marcador y trayectoria)
      map.updateMarkerPosition(lat, lon, deviceId, color);
      const numPuntos = await map.agregarPuntoTrayectoria(
        lat,
        lon,
        deviceId,
        color
      );
      totalPuntos += numPuntos;

      console.log(`✓ Dispositivo ${deviceId}: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
    }

    // Actualizar el panel de "Posición Actual"
    if (devicesArray.length === 1) {
      updateDisplay(devicesArray[0], 1);
    } else {
      updateDisplay(null, devicesArray.length);
    }

    // Actualizar contadores y listas de la UI
    puntosTrayectoriaHiddenElement.textContent = totalPuntos;
    updateRealtimeModalInfo();
    updateDevicesList();

    // ==================== NUEVO: Verificar destinos activos ====================
    await checkActiveDestinations(devicesArray);

  } catch (err) {
    console.error("Error en actualizarPosicion:", err);
    setOnlineStatus(false);
    updateRealtimeModalInfo();
  }
}

/**
 * ==================== NUEVO: Verifica y muestra destinos activos ====================
 * Consulta los destinos pendientes/enviados para cada dispositivo activo
 */
async function checkActiveDestinations(devicesArray) {
  const basePath = getBasePath();

  for (const device of devicesArray) {
    const userId = device.user_id;
    const deviceId = `user_${userId}`;

    // Solo verificar si no tiene ya un destino activo en el mapa
    // o si queremos actualizar periódicamente
    try {
      const response = await fetch(`${basePath}/database/destination/${userId}`);
      
      if (!response.ok) continue;

      const data = await response.json();

      if (data.success && data.destinations && data.destinations.length > 0) {
        // Buscar destino pendiente o enviado (no completado)
        const activeDestination = data.destinations.find(
          d => d.status === 'pending' || d.status === 'sent'
        );

        if (activeDestination) {
          // Verificar si ya tenemos este destino en el mapa
          const currentDest = map.getActiveDestination(deviceId);
          
          // Si no hay destino o es diferente, establecerlo
          if (!currentDest || 
              currentDest.lat !== activeDestination.latitude || 
              currentDest.lon !== activeDestination.longitude) {
            
            const color = getColorByUserId(userId);
            await map.setDestination(
              deviceId,
              activeDestination.latitude,
              activeDestination.longitude,
              device.lat,
              device.lon,
              color
            );

            console.log(`🎯 Destino cargado para ${deviceId}: ${activeDestination.latitude.toFixed(6)}, ${activeDestination.longitude.toFixed(6)}`);
            
            // Mostrar notificación
            showDestinationNotification(deviceId, activeDestination);
          }
        } else {
          // No hay destino activo, limpiar si existe
          if (map.hasActiveDestination(deviceId)) {
            map.clearDestination(deviceId);
            console.log(`✓ Destino completado/eliminado para ${deviceId}`);
          }
        }
      }
    } catch (error) {
      // Silenciar errores de destinos - no es crítico
      console.debug(`No se pudo verificar destino para ${userId}:`, error.message);
    }
  }
}

/**
 * Muestra una notificación cuando se detecta un nuevo destino
 */
function showDestinationNotification(deviceId, destination) {
  // Crear notificación toast si no existe
  let toastContainer = document.getElementById('realtimeToastContainer');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'realtimeToastContainer';
    toastContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.style.cssText = `
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.95) 0%, rgba(5, 150, 105, 0.95) 100%);
    color: white;
    padding: 12px 20px;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    display: flex;
    align-items: center;
    gap: 10px;
    animation: slideIn 0.3s ease-out;
    max-width: 350px;
  `;
  toast.innerHTML = `
    <span style="font-size: 1.5rem;">🎯</span>
    <div>
      <div style="font-weight: 600;">Nuevo destino asignado</div>
      <div style="font-size: 0.85rem; opacity: 0.9;">${deviceId}</div>
    </div>
  `;

  toastContainer.appendChild(toast);

  // Remover después de 4 segundos
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// --- Funciones Globales para Botones ---

window.toggleDeviceTrayectoria = (deviceId) => {
  map.toggleTrayectoria(deviceId);
};

window.limpiarDeviceTrayectoria = (deviceId) => {
  if (confirm(`¿Limpiar trayectoria de ${deviceId}?`)) {
    const numPuntos = map.limpiarTrayectoria(deviceId);
    puntosTrayectoriaHiddenElement.textContent = numPuntos;
    updateRealtimeModalInfo();
  }
};

window.limpiarTrayectoria = () => {
  if (confirm("¿Limpiar todas las trayectorias?")) {
    const numPuntos = map.limpiarTrayectoria();
    puntosTrayectoriaHiddenElement.textContent = numPuntos;
    updateRealtimeModalInfo();
  }
};

window.toggleTrayectoria = () => {
  map.toggleTrayectoria();
};

window.regenerarRuta = () => {
  map.regenerarRuta();
};

// ==================== NUEVO: Toggle ruta recomendada ====================
window.toggleDeviceRecommendedRoute = (deviceId) => {
  map.toggleRecommendedRoute(deviceId);
};

window.toggleAllRecommendedRoutes = () => {
  map.toggleRecommendedRoute();
};

// Estado de visibilidad de marcadores
let marcadoresVisibles = true;

window.toggleMarcadores = () => {
  marcadoresVisibles = !marcadoresVisibles;
  map.toggleMarkers(marcadoresVisibles);

  const btnText = document.getElementById('toggleMarcadoresText');
  if (btnText) {
    btnText.textContent = marcadoresVisibles ? 'Ocultar Marcadores' : 'Mostrar Marcadores';
  }
};

window.ajustarVista = () => {
  map.fitView();
};

// --- Inicialización ---

document.addEventListener("DOMContentLoaded", () => {
  // 1. Encontrar todos los elementos de la UI
  statusHiddenElement = document.getElementById("status");
  lastUpdateHiddenElement = document.getElementById("lastUpdate");
  puntosTrayectoriaHiddenElement = document.getElementById("puntosTrayectoria");
  latitudeElement = document.getElementById("latitude");
  longitudeElement = document.getElementById("longitude");
  deviceIdElement = document.getElementById("deviceId");
  timestampElement = document.getElementById("timestamp");

  // 2. Configurar navegación (si existe)
  if (window.setupViewNavigation) {
    window.setupViewNavigation(false);
  }

  // 3. Inicializar el mapa
  map.initializeMap();

  // 4. Agregar estilos para animaciones de toast
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
    .destination-badge {
      display: inline-block;
      margin-left: 5px;
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(1.1); }
    }
  `;
  document.head.appendChild(style);

  // 5. Iniciar el bucle de actualización
  actualizarPosicion(); // Llamar una vez al cargar
  setInterval(actualizarPosicion, 5000); // Cada 5 segundos

  // 6. Conectar el actualizador del modal
  if (typeof window.updateModalInfo !== "undefined") {
    window.updateModalInfo = updateRealtimeModalInfo;
  }

  console.log("✓ Realtime multi-dispositivo con comparación de rutas inicializado");
});