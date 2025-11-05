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
  // Si no existe, generar color basado en el ID
  const hue = (userId * 137.508) % 360; // Golden angle
  return `hsl(${hue}, 70%, 50%)`;
}

function updateDisplay(data) {
  if (data && Object.keys(data).length > 0) {
    latitudeElement.textContent = data.lat ? data.lat.toFixed(6) : "---.------";
    longitudeElement.textContent = data.lon
      ? data.lon.toFixed(6)
      : "---.------";
    deviceIdElement.textContent = data.source || "---";
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
    console.error("Error fetching coordinates:", error);
    setOnlineStatus(false);
    setTimeout(fetchCoordinates, 5000);
  }
}

async function actualizarPosicion() {
  const basePath = getBasePath();

  try {
    // Intentar obtener coordenadas de todos los dispositivos
    const response = await fetch(`${basePath}/coordenadas/all`);
    
    if (!response.ok) {
      // Por ahora, usamos el endpoint sin user_id
      const singleResponse = await fetch(`${basePath}/coordenadas`);
      
      if (!singleResponse.ok) {
        console.error("Error al obtener coordenadas:", singleResponse.status);
        setOnlineStatus(false);
        return;
      }
      
      const data = await singleResponse.json();
      
      // Verificar que hay datos válidos
      if (!data || !data.lat || !data.lon) {
        console.warn("No hay datos válidos en la respuesta");
        setOnlineStatus(false);
        return;
      }
      
      // Extraer user_id de la respuesta si existe
      const userId = data.user_id || 1; // Default a 1 si no existe
      const deviceId = `user_${userId}`;
      const lat = data.lat;
      const lon = data.lon;
      const color = getColorByUserId(userId);

      devicesData[deviceId] = {
        lat,
        lon,
        timestamp: data.timestamp,
        source: data.source,
        user_id: userId,
        color: color
      };

      // IMPORTANTE: Actualizar display principal y estado online
      updateDisplay(data);
      setOnlineStatus(true);
      
      // Actualizar mapa y trayectoria
      map.updateMarkerPosition(lat, lon, deviceId, color);
      const numPuntos = await map.agregarPuntoTrayectoria(lat, lon, deviceId, color);
      puntosTrayectoriaHiddenElement.textContent = numPuntos;
      updateRealtimeModalInfo();
      updateDevicesList();
      return;
    }

    const devices = await response.json();
    let totalPuntos = 0;

    // Procesar cada dispositivo
    if (Array.isArray(devices) && devices.length > 0) {
      // Actualizar estado online
      setOnlineStatus(true);
      
      // Actualizar display con el primer dispositivo (o el más reciente)
      if (devices[0]) {
        updateDisplay(devices[0]);
      }
      
      for (const device of devices) {
        const userId = device.user_id || 1;
        const deviceId = `user_${userId}`;
        const lat = device.lat;
        const lon = device.lon;
        const color = getColorByUserId(userId);

        // Actualizar datos del dispositivo en memoria
        devicesData[deviceId] = {
          lat,
          lon,
          timestamp: device.timestamp,
          user_id: userId,
          source: device.source,
          color: color
        };

        // Actualizar marcador y trayectoria con color basado en user_id
        map.updateMarkerPosition(lat, lon, deviceId, color);
        const numPuntos = await map.agregarPuntoTrayectoria(lat, lon, deviceId, color);
        totalPuntos = numPuntos;
      }

      puntosTrayectoriaHiddenElement.textContent = totalPuntos;
      updateRealtimeModalInfo();
      updateDevicesList();
    } else {
      console.log("No hay dispositivos activos");
      setOnlineStatus(false);
    }
  } catch (err) {
    console.error("Error obteniendo coordenadas para mapa:", err);
    setOnlineStatus(false);
  }
}

function updateDevicesList() {
  const devicesList = document.getElementById("devicesList");
  if (!devicesList) return;

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
          ${deviceData.timestamp ? `<span class="device-time">${new Date(deviceData.timestamp).toLocaleTimeString()}</span>` : ''}
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

  if (window.setupViewNavigation) {
    window.setupViewNavigation(false);
  }

  map.initializeMap();
  fetchCoordinates();
  actualizarPosicion();
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