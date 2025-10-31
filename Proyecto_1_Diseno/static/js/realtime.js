import * as map from "./modules/realtimeMap.js";

let statusHiddenElement,
  lastUpdateHiddenElement,
  puntosTrayectoriaHiddenElement;
let latitudeElement, longitudeElement, deviceIdElement, timestampElement;

// Almacenar datos de todos los dispositivos
const devicesData = {};

// Colores fijos por user_id (hasta 20 usuarios diferentes)
const userIdColors = {
  1: '#FF4444',   // Rojo
  2: '#44FF44',   // Verde
  3: '#4444FF',   // Azul
  4: '#FFAA00',   // Naranja
  5: '#FF44FF',   // Magenta
  6: '#44FFFF',   // Cian
  7: '#FFFF44',   // Amarillo
  8: '#AA44FF',   // Púrpura
  9: '#FF8888',   // Rosa
  10: '#88FF88',  // Verde claro
  11: '#8888FF',  // Azul claro
  12: '#FFCC00',  // Dorado
  13: '#FF0088',  // Fucsia
  14: '#00FFAA',  // Turquesa
  15: '#AAFF00',  // Lima
  16: '#AA00FF',  // Violeta
  17: '#FF6600',  // Naranja oscuro
  18: '#0066FF',  // Azul real
  19: '#FF0066',  // Rosa intenso
  20: '#66FF00',  // Verde lima
};

function getColorByUserId(userId) {
  if (userIdColors[userId]) {
    return userIdColors[userId];
  }
  const hue = (userId * 137.508) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

function updateDisplay(data) {
  if (data && data.lat && data.lon) {
    latitudeElement.textContent = data.lat.toFixed(6);
    longitudeElement.textContent = data.lon.toFixed(6);
    deviceIdElement.textContent = data.source || data.device_id || "---";
    timestampElement.textContent = data.timestamp || "---";

    const currentTime = new Date().toLocaleTimeString();
    lastUpdateHiddenElement.textContent = currentTime;

    setOnlineStatus(true);
  } else {
    setOnlineStatus(false);
    latitudeElement.textContent = "---.------";
    longitudeElement.textContent = "---.------";
    deviceIdElement.textContent = "---";
    timestampElement.textContent = "---";
  }
  updateRealtimeModalInfo();
}

function setOnlineStatus(online) {
  const statusText = online ? "ONLINE" : "OFFLINE";
  statusHiddenElement.textContent = statusText;
}

async function actualizarPosicion() {
  const basePath = getBasePath();

  try {
    console.log("🔄 Obteniendo coordenadas...");
    
    // Intentar obtener coordenadas de todos los dispositivos
    const response = await fetch(`${basePath}/coordenadas/all`);
    
    if (!response.ok) {
      console.warn("⚠️ Endpoint /coordenadas/all no disponible, usando /coordenadas");
      
      // Fallback al endpoint singular
      const singleResponse = await fetch(`${basePath}/coordenadas`);
      
      if (!singleResponse.ok) {
        console.error("❌ Error obteniendo coordenadas:", singleResponse.status);
        setOnlineStatus(false);
        return;
      }
      
      const data = await singleResponse.json();
      console.log("📦 Datos recibidos:", data);
      
      // Validar que los datos tengan lat y lon
      if (!data || !data.lat || !data.lon) {
        console.warn("⚠️ Datos sin coordenadas válidas:", data);
        setOnlineStatus(false);
        return;
      }
      
      const userId = data.user_id || 1;
      const deviceId = `user_${userId}`;
      const lat = data.lat;
      const lon = data.lon;
      const color = getColorByUserId(userId);

      devicesData[deviceId] = {
        lat,
        lon,
        timestamp: data.timestamp,
        source: data.source || deviceId,
        user_id: userId,
        color: color
      };

      console.log(`✅ Actualizando marcador: ${deviceId} (${lat}, ${lon})`);
      map.updateMarkerPosition(lat, lon, deviceId, color);
      const numPuntos = await map.agregarPuntoTrayectoria(lat, lon, deviceId, color);
      puntosTrayectoriaHiddenElement.textContent = numPuntos;
      updateDisplay(devicesData[deviceId]);
      updateRealtimeModalInfo();
      updateDevicesList();
      setOnlineStatus(true);
      return;
    }

    const devices = await response.json();
    console.log("📦 Dispositivos recibidos:", devices);
    
    let totalPuntos = 0;

    // Procesar cada dispositivo
    if (Array.isArray(devices) && devices.length > 0) {
      setOnlineStatus(true);
      
      for (const device of devices) {
        // Validar que el dispositivo tenga coordenadas
        if (!device || !device.lat || !device.lon) {
          console.warn("⚠️ Dispositivo sin coordenadas válidas:", device);
          continue;
        }
        
        const userId = device.user_id || 1;
        const deviceId = `user_${userId}`;
        const lat = device.lat;
        const lon = device.lon;
        const color = getColorByUserId(userId);

        devicesData[deviceId] = {
          lat,
          lon,
          timestamp: device.timestamp,
          user_id: userId,
          source: device.source || deviceId,
          color: color
        };

        console.log(`✅ Actualizando dispositivo: ${deviceId} (${lat}, ${lon})`);
        map.updateMarkerPosition(lat, lon, deviceId, color);
        const numPuntos = await map.agregarPuntoTrayectoria(lat, lon, deviceId, color);
        totalPuntos = numPuntos;
      }

      // Actualizar display con el primer dispositivo
      if (Object.keys(devicesData).length > 0) {
        const firstDevice = Object.values(devicesData)[0];
        updateDisplay(firstDevice);
      }

      puntosTrayectoriaHiddenElement.textContent = totalPuntos;
      updateRealtimeModalInfo();
      updateDevicesList();
    } else {
      console.log("⚠️ No hay dispositivos activos");
      setOnlineStatus(false);
    }
  } catch (err) {
    console.error("❌ Error obteniendo coordenadas:", err);
    setOnlineStatus(false);
  }
}

function updateDevicesList() {
  const devicesList = document.getElementById("devicesList");
  if (!devicesList) {
    console.warn("⚠️ Elemento devicesList no encontrado");
    return;
  }

  if (Object.keys(devicesData).length === 0) {
    devicesList.innerHTML = '<p class="no-devices">No hay dispositivos activos</p>';
    return;
  }

  devicesList.innerHTML = '';
  
  Object.entries(devicesData).forEach(([deviceId, deviceData]) => {
    const deviceItem = document.createElement('div');
    deviceItem.className = 'device-item';
    deviceItem.innerHTML = `
      <span class="device-color" style="background-color: ${deviceData.color}"></span>
      <div class="device-info">
        <div class="device-id">${deviceId} (ID: ${deviceData.user_id})</div>
        <div class="device-coords">${deviceData.lat.toFixed(6)}, ${deviceData.lon.toFixed(6)}</div>
        <div class="device-meta">
          <span class="device-source">${deviceData.source || 'N/A'}</span>
          ${deviceData.timestamp ? `<span class="device-time">${deviceData.timestamp}</span>` : ''}
        </div>
      </div>
      <div class="device-actions">
        <button class="device-action-btn" onclick="toggleDeviceTrayectoria('${deviceId}')" title="Toggle trayectoria">
          👁️
        </button>
        <button class="device-action-btn" onclick="limpiarDeviceTrayectoria('${deviceId}')" title="Limpiar trayectoria">
          🗑️
        </button>
      </div>
    `;
    devicesList.appendChild(deviceItem);
  });
  
  console.log(`✅ Lista de dispositivos actualizada: ${Object.keys(devicesData).length} dispositivos`);
}

function updateRealtimeModalInfo() {
  const modalStatus = document.getElementById("modalStatus");
  const modalLastUpdate = document.getElementById("modalLastUpdate");
  const modalPuntos = document.getElementById("modalPuntos");

  if (modalStatus && statusHiddenElement) {
    modalStatus.textContent = statusHiddenElement.textContent;
    const isOnline = statusHiddenElement.textContent === "ONLINE";
    modalStatus.className = isOnline
      ? "modal-value online"
      : "modal-value offline";
  }
  if (modalLastUpdate && lastUpdateHiddenElement) {
    modalLastUpdate.textContent = lastUpdateHiddenElement.textContent;
  }
  if (modalPuntos && puntosTrayectoriaHiddenElement) {
    modalPuntos.textContent = puntosTrayectoriaHiddenElement.textContent;
  }
}

// Funciones globales para acciones de dispositivos
window.toggleDeviceTrayectoria = (deviceId) => {
  map.toggleTrayectoria(deviceId);
  updateDevicesList();
};

window.limpiarDeviceTrayectoria = (deviceId) => {
  if (confirm(`¿Limpiar trayectoria de ${deviceId}?`)) {
    const numPuntos = map.limpiarTrayectoria(deviceId);
    puntosTrayectoriaHiddenElement.textContent = numPuntos;
    updateRealtimeModalInfo();
    updateDevicesList();
  }
};

document.addEventListener("DOMContentLoaded", () => {
  statusHiddenElement = document.getElementById("status");
  lastUpdateHiddenElement = document.getElementById("lastUpdate");
  puntosTrayectoriaHiddenElement = document.getElementById("puntosTrayectoria");
  latitudeElement = document.getElementById("latitude");
  longitudeElement = document.getElementById("longitude");
  deviceIdElement = document.getElementById("deviceId");
  timestampElement = document.getElementById("timestamp");

  console.log("🚀 Inicializando aplicación real-time...");

  if (window.setupViewNavigation) {
    window.setupViewNavigation(false);
  }

  map.initializeMap();
  
  // Primera actualización inmediata
  actualizarPosicion();
  
  // Actualizar cada 10 segundos
  setInterval(actualizarPosicion, 10000);

  if (typeof window.updateModalInfo !== "undefined") {
    window.updateModalInfo = updateRealtimeModalInfo;
  }

  window.limpiarTrayectoria = () => {
    if (confirm('¿Limpiar todas las trayectorias?')) {
      const numPuntos = map.limpiarTrayectoria();
      puntosTrayectoriaHiddenElement.textContent = numPuntos;
      updateRealtimeModalInfo();
      updateDevicesList();
    }
  };
  
  window.toggleTrayectoria = () => {
    map.toggleTrayectoria();
    updateDevicesList();
  };
  
  window.regenerarRuta = () => {
    map.regenerarRuta();
  };
});