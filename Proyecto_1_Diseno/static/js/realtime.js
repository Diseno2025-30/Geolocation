import * as map from "./modules/realtimeMap.js";

let statusHiddenElement,
  lastUpdateHiddenElement,
  puntosTrayectoriaHiddenElement;
let latitudeElement, longitudeElement, deviceIdElement, timestampElement;

// Almacenar datos de todos los dispositivos
const devicesData = {};

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
    // Obtener coordenadas de todos los dispositivos
    const response = await fetch(`${basePath}/coordenadas/all`);
    const devices = await response.json();

    let totalPuntos = 0;

    // Procesar cada dispositivo
    if (Array.isArray(devices) && devices.length > 0) {
      for (const device of devices) {
        const deviceId = device.device_id || device.source || `user_${device.user_id}`;
        const lat = device.lat;
        const lon = device.lon;

        // Actualizar datos del dispositivo en memoria
        devicesData[deviceId] = {
          lat,
          lon,
          timestamp: device.timestamp,
          user_id: device.user_id,
          source: device.source
        };

        // Actualizar marcador y trayectoria (el color se asigna automáticamente en el módulo)
        map.updateMarkerPosition(lat, lon, deviceId);
        const numPuntos = await map.agregarPuntoTrayectoria(lat, lon, deviceId);
        totalPuntos = numPuntos;
      }

      puntosTrayectoriaHiddenElement.textContent = totalPuntos;
      updateRealtimeModalInfo();
      updateDevicesList();
    } else {
      console.log("No hay dispositivos activos");
    }
  } catch (err) {
    console.error("Error obteniendo coordenadas para mapa:", err);
  }
}

function updateDevicesList() {
  const devicesList = document.getElementById("devicesList");
  if (!devicesList) return;

  const devicesInfo = map.getDevicesInfo();
  
  if (devicesInfo.length === 0) {
    devicesList.innerHTML = '<p class="no-devices">No hay dispositivos activos</p>';
    return;
  }

  devicesList.innerHTML = '';
  
  devicesInfo.forEach(device => {
    const deviceData = devicesData[device.id];
    if (!deviceData) return;

    const deviceItem = document.createElement('div');
    deviceItem.className = 'device-item';
    deviceItem.innerHTML = `
      <span class="device-color" style="background-color: ${device.color}"></span>
      <div class="device-info">
        <div class="device-id">${device.id}</div>
        <div class="device-coords">${deviceData.lat.toFixed(6)}, ${deviceData.lon.toFixed(6)}</div>
        <div class="device-meta">
          <span class="device-points">${device.puntos} puntos</span>
          ${deviceData.timestamp ? `<span class="device-time">${new Date(deviceData.timestamp).toLocaleTimeString()}</span>` : ''}
        </div>
      </div>
      <div class="device-actions">
        <button class="device-action-btn" onclick="toggleDeviceTrayectoria('${device.id}')" title="Toggle trayectoria">
          ${device.visible ? '👁️' : '👁️‍🗨️'}
        </button>
        <button class="device-action-btn" onclick="limpiarDeviceTrayectoria('${device.id}')" title="Limpiar trayectoria">
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