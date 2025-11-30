import * as osrm from "./modules/osrm.js";
import * as map from "./modules/historicalMap.js";
import * as ui from "./modules/historicalUI.js";

// ==================== VARIABLES GLOBALES ====================
let datosHistoricosOriginales = [];
let datosHistoricosFiltrados = [];
let geofenceLayer = null;
let estadoAnimacion = {
  puntosCompletos: [],
  segmentosRuta: {},
  indiceActual: 0,
  animacionActiva: false,
  intervalId: null,
  calculando: false,
};

// ==================== INICIALIZACIÓN ====================
document.addEventListener("DOMContentLoaded", () => {
  map.initializeMap(onGeofenceCreated, onGeofenceEdited, onGeofenceDeleted);

  ui.initializeUI(
    onVerHistorico,
    onLimpiarMapa,
    onExportarDatos,
    onToggleMarcadores,
    onAjustarVista,
    onLimpiarGeocerca
  );

  window.addEventListener("start-drawing-polygon", () => {
    map.startDrawingPolygon();
  });

  window.addEventListener("start-drawing-circle", () => {
    map.startDrawingCircle();
  });

  window.addEventListener("start-editing-geofence", () => {
    map.enableEditing(geofenceLayer);
  });

  window.addEventListener("stop-editing-geofence", () => {
    map.disableEditing(geofenceLayer);
  });

  window.addEventListener("save-editing-geofence", () => {
    map.disableEditing(geofenceLayer);
    onGeofenceEdited(geofenceLayer);
  });

  window.addEventListener("check-geofence-status", () => {
    ui.updateGeofenceModalState(!!geofenceLayer);
  });

  if (window.setupViewNavigation) {
    window.setupViewNavigation();
  }

  configurarSliderAnimacion();
  configurarEventosSelector();
  inicializarSelectorUsuarios();
});

// ==================== SELECTOR DE USUARIOS ====================
let todosLosUsuarios = [];
let usuariosSeleccionados = [];

async function obtenerUsuariosRegistrados() {
  const url = `/test/api/users/registered`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("No se pudo obtener la lista de usuarios");
    }
    const data = await response.json();
    return data.users; // Retorna un array de user_ids únicos
  } catch (error) {
    console.error("Error al obtener usuarios registrados:", error);
    return [];
  }
}

async function inicializarSelectorUsuarios() {
  todosLosUsuarios = await obtenerUsuariosRegistrados();

  // Por defecto, todos los usuarios están seleccionados
  usuariosSeleccionados = [...todosLosUsuarios];

  renderizarListaUsuarios();
  actualizarChipsUsuarios();
}

function renderizarListaUsuarios(filtro = '') {
  const lista = document.getElementById('userSelectorList');
  if (!lista) return;

  lista.innerHTML = '';

  const usuariosFiltrados = todosLosUsuarios.filter(user_id =>
    user_id.toLowerCase().includes(filtro.toLowerCase())
  );

  usuariosFiltrados.forEach(user_id => {
    const item = document.createElement('label');
    item.className = 'user-selector-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = user_id;
    checkbox.checked = usuariosSeleccionados.includes(user_id);
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        if (!usuariosSeleccionados.includes(user_id)) {
          usuariosSeleccionados.push(user_id);
        }
      } else {
        usuariosSeleccionados = usuariosSeleccionados.filter(id => id !== user_id);
      }
      actualizarChipsUsuarios();
    });

    const label = document.createElement('span');
    label.textContent = user_id;

    item.appendChild(checkbox);
    item.appendChild(label);
    lista.appendChild(item);
  });
}

function actualizarChipsUsuarios() {
  const chipsContainer = document.getElementById('userChips');
  if (!chipsContainer) return;

  chipsContainer.innerHTML = '';

  // Si no hay usuarios seleccionados, mostrar mensaje
  if (usuariosSeleccionados.length === 0) {
    const mensaje = document.createElement('span');
    mensaje.className = 'user-chips-empty';
    mensaje.textContent = 'Ningún usuario seleccionado';
    chipsContainer.appendChild(mensaje);
    return;
  }

  // Mostrar los primeros 3 usuarios
  const usuariosAMostrar = usuariosSeleccionados.slice(0, 3);

  usuariosAMostrar.forEach(user_id => {
    const chip = document.createElement('div');
    chip.className = 'user-chip';

    const texto = document.createElement('span');
    texto.textContent = user_id;

    const btnEliminar = document.createElement('button');
    btnEliminar.className = 'user-chip-remove';
    btnEliminar.innerHTML = '&times;';
    btnEliminar.onclick = () => {
      usuariosSeleccionados = usuariosSeleccionados.filter(id => id !== user_id);
      actualizarChipsUsuarios();
      renderizarListaUsuarios(document.getElementById('userSearchInput')?.value || '');
    };

    chip.appendChild(texto);
    chip.appendChild(btnEliminar);
    chipsContainer.appendChild(chip);
  });

  // Si hay más de 3, mostrar botón "+N más"
  if (usuariosSeleccionados.length > 3) {
    const btnVerMas = document.createElement('button');
    btnVerMas.className = 'user-chip-more';
    btnVerMas.textContent = `+${usuariosSeleccionados.length - 3} más`;
    btnVerMas.onclick = abrirModalListaUsuarios;
    chipsContainer.appendChild(btnVerMas);
  }
}

function abrirModalListaUsuarios() {
  const modal = document.getElementById('userListModal');
  const modalBody = document.getElementById('userListModalBody');

  if (!modal || !modalBody) return;

  modalBody.innerHTML = '';

  usuariosSeleccionados.forEach(user_id => {
    const item = document.createElement('div');
    item.className = 'user-list-item';

    const texto = document.createElement('span');
    texto.textContent = user_id;

    const btnEliminar = document.createElement('button');
    btnEliminar.className = 'user-list-item-remove';
    btnEliminar.textContent = 'Eliminar';
    btnEliminar.onclick = () => {
      usuariosSeleccionados = usuariosSeleccionados.filter(id => id !== user_id);
      actualizarChipsUsuarios();
      renderizarListaUsuarios(document.getElementById('userSearchInput')?.value || '');
      abrirModalListaUsuarios(); // Refrescar el modal
    };

    item.appendChild(texto);
    item.appendChild(btnEliminar);
    modalBody.appendChild(item);
  });

  modal.style.display = 'flex';
}

function configurarEventosSelector() {
  // Toggle dropdown
  const toggleBtn = document.getElementById('userSelectorToggle');
  const dropdown = document.getElementById('userSelectorDropdown');

  if (toggleBtn && dropdown) {
    toggleBtn.addEventListener('click', () => {
      const isVisible = dropdown.style.display === 'block';
      dropdown.style.display = isVisible ? 'none' : 'block';
    });
  }

  // Búsqueda
  const searchInput = document.getElementById('userSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderizarListaUsuarios(e.target.value);
    });
  }

  // Seleccionar todos
  const selectAllBtn = document.getElementById('selectAllUsers');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      usuariosSeleccionados = [...todosLosUsuarios];
      actualizarChipsUsuarios();
      renderizarListaUsuarios(searchInput?.value || '');
    });
  }

  // Deseleccionar todos
  const deselectAllBtn = document.getElementById('deselectAllUsers');
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', () => {
      usuariosSeleccionados = [];
      actualizarChipsUsuarios();
      renderizarListaUsuarios(searchInput?.value || '');
    });
  }

  // Cerrar modal
  const closeModalBtn = document.getElementById('closeUserListModal');
  const modal = document.getElementById('userListModal');

  if (closeModalBtn && modal) {
    closeModalBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });

    // Cerrar al hacer click fuera del modal
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });
  }
}

// ==================== CONSULTAS ====================

async function onVerHistorico(fechaInicio, horaInicio, fechaFin, horaFin) {
  const basePath =
    window.BASE_PATH ||
    (window.location.pathname.startsWith("/test") ? "/test" : "");
  const url = `${basePath}/historico/rango?inicio=${fechaInicio}&fin=${fechaFin}&hora_inicio=${horaInicio}&hora_fin=${horaFin}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        errorData?.error || "No hay datos para ese rango de fechas"
      );
    }
    datosHistoricosOriginales = await response.json();
    ui.closeSearchModal();
    await aplicarFiltrosYActualizarMapa();
  } catch (error) {
    console.error("Error al consultar histórico:", error);
    alert(error.message);
  }
}

async function fetchDatosPorGeocerca(bounds) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const basePath =
    window.BASE_PATH ||
    (window.location.pathname.startsWith("/test") ? "/test" : "");
  // Nota: Seguimos enviando el rectángulo (bounds) al backend para la consulta SQL inicial rápida.
  // El filtrado preciso de "forma de polígono" se hace en Javascript en el siguiente paso.
  const url = `${basePath}/historico/geocerca?min_lat=${sw.lat}&min_lon=${sw.lng}&max_lat=${ne.lat}&max_lon=${ne.lng}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("No se encontraron datos en esta área");
    }
    const data = await response.json();
    datosHistoricosOriginales = [];

    // Aquí es donde simulamos que "datosHistoricosOriginales" son los datos crudos del rectángulo
    // y luego los filtramos estrictamente.
    // Usamos una variable temporal para no ensuciar la lógica si quisiéramos guardar el set completo.
    const datosRectangulo = data;

    if (geofenceLayer) {
      // Filtrado estricto inmediato
      datosHistoricosFiltrados = datosRectangulo.filter((p) =>
        map.isPointInsideGeofence(p.lat, p.lon, geofenceLayer)
      );
    } else {
      datosHistoricosFiltrados = datosRectangulo;
    }

    await dibujarRutaFiltrada();
  } catch (error) {
    console.error("Error al consultar por geocerca:", error);
    alert(error.message);
  }
}

// ==================== FILTROS Y ACTUALIZACIÓN ====================
async function aplicarFiltrosYActualizarMapa() {
  if (geofenceLayer) {
    // CAMBIO CRÍTICO: Usar la verificación precisa, no el rectángulo (bounds)
    datosHistoricosFiltrados = datosHistoricosOriginales.filter((p) =>
      map.isPointInsideGeofence(p.lat, p.lon, geofenceLayer)
    );
  } else {
    datosHistoricosFiltrados = [...datosHistoricosOriginales];
  }

  await dibujarRutaFiltrada();
}

async function dibujarRutaFiltrada() {
  if (datosHistoricosFiltrados.length === 0) {
    map.clearMap(!!geofenceLayer);
    ui.actualizarInformacionHistorica(datosHistoricosFiltrados, geofenceLayer);
    const controlAnimacion = document.getElementById("routeAnimationControl");
    if (controlAnimacion) controlAnimacion.style.display = "none";

    // Solo mostramos alerta si teníamos datos originales y el filtro los ocultó todos
    if (datosHistoricosOriginales.length > 0) {
      // Opcional: alert("No hay puntos dentro de la zona exacta.");
    }
    return;
  }

  const controlAnimacion = document.getElementById("routeAnimationControl");
  if (controlAnimacion) controlAnimacion.style.display = "block";

  prepararAnimacionRuta();
}

function prepararAnimacionRuta() {
  map.clearMap(!!geofenceLayer);
  resetearEstadoAnimacion();

  estadoAnimacion.puntosCompletos = [...datosHistoricosFiltrados];
  configurarUISlider();

  renderizarHastaIndice(0);
  ui.actualizarInformacionHistorica(datosHistoricosFiltrados, geofenceLayer);
}

function resetearEstadoAnimacion() {
  if (estadoAnimacion.intervalId) {
    clearInterval(estadoAnimacion.intervalId);
  }
  estadoAnimacion = {
    puntosCompletos: [],
    segmentosRuta: {},
    indiceActual: 0,
    animacionActiva: false,
    intervalId: null,
    calculando: false,
  };
}

function configurarUISlider() {
  const slider = document.getElementById("routeAnimationSlider");
  const totalPoints = document.getElementById("totalPointsCount");
  if (slider && totalPoints) {
    slider.max = datosHistoricosFiltrados.length - 1;
    slider.value = 0;
    totalPoints.textContent = datosHistoricosFiltrados.length;
  }
}

async function renderizarHastaIndice(indice) {
  if (estadoAnimacion.calculando) return;
  estadoAnimacion.calculando = true;
  map.clearPolylines();
  map.clearMarkers();

  // Dibujar primer punto
  map.dibujarPuntoIndividual(estadoAnimacion.puntosCompletos[0]);

  // Para cada punto subsiguiente: dibujar línea desde anterior + punto actual
  for (let i = 1; i <= indice; i++) {
    // Primero dibujar la línea que conecta el punto anterior con el actual
    await dibujarSegmentoConCache(i - 1);

    // Luego dibujar el punto actual
    map.dibujarPuntoIndividual(estadoAnimacion.puntosCompletos[i]);
  }

  const currentPointElement = document.getElementById("currentPointIndex");
  if (currentPointElement) currentPointElement.textContent = indice + 1;

  if (indice === 0) map.fitView(geofenceLayer);

  estadoAnimacion.calculando = false;
}

async function dibujarSegmentoConCache(indice) {
  if (estadoAnimacion.segmentosRuta[indice]) {
    map.dibujarSegmentoRuta(
      estadoAnimacion.segmentosRuta[indice],
      geofenceLayer
    );
    return;
  }
  const punto1 = estadoAnimacion.puntosCompletos[indice];
  const punto2 = estadoAnimacion.puntosCompletos[indice + 1];

  try {
    const rutaOSRM = await osrm.getOSRMRoute(
      punto1.lat,
      punto1.lon,
      punto2.lat,
      punto2.lon
    );
    if (rutaOSRM && rutaOSRM.length > 0) {
      estadoAnimacion.segmentosRuta[indice] = rutaOSRM;
      map.dibujarSegmentoRuta(rutaOSRM, geofenceLayer);
    } else {
      const fallback = [
        [punto1.lat, punto1.lon],
        [punto2.lat, punto2.lon],
      ];
      estadoAnimacion.segmentosRuta[indice] = fallback;
      map.dibujarSegmentoRuta(fallback, geofenceLayer);
    }
  } catch (error) {
    const fallback = [
      [punto1.lat, punto1.lon],
      [punto2.lat, punto2.lon],
    ];
    estadoAnimacion.segmentosRuta[indice] = fallback;
    map.dibujarSegmentoRuta(fallback, geofenceLayer);
  }
}

function configurarSliderAnimacion() {
  const slider = document.getElementById("routeAnimationSlider");
  if (slider) {
    slider.addEventListener("input", async (e) => {
      const indice = parseInt(e.target.value);
      estadoAnimacion.indiceActual = indice;
      await renderizarHastaIndice(indice);
    });
  }
}

window.animarRutaAutomatica = async function () {
  if (estadoAnimacion.animacionActiva) return;
  estadoAnimacion.animacionActiva = true;
  toggleBotonesPlayPause(false);
  const slider = document.getElementById("routeAnimationSlider");
  const velocidad = parseInt(document.getElementById("animationSpeed").value);

  estadoAnimacion.intervalId = setInterval(async () => {
    const maxIndice = estadoAnimacion.puntosCompletos.length - 1;
    if (estadoAnimacion.indiceActual >= maxIndice) {
      window.pausarAnimacion();
      return;
    }
    estadoAnimacion.indiceActual++;
    if (slider) slider.value = estadoAnimacion.indiceActual;
    await renderizarHastaIndice(estadoAnimacion.indiceActual);
  }, velocidad);
};

window.pausarAnimacion = function () {
  estadoAnimacion.animacionActiva = false;
  if (estadoAnimacion.intervalId) {
    clearInterval(estadoAnimacion.intervalId);
    estadoAnimacion.intervalId = null;
  }
  toggleBotonesPlayPause(true);
};

window.reiniciarAnimacion = async function () {
  window.pausarAnimacion();
  estadoAnimacion.indiceActual = 0;
  const slider = document.getElementById("routeAnimationSlider");
  if (slider) slider.value = 0;
  await renderizarHastaIndice(0);
};

window.cerrarAnimacion = function () {
  window.pausarAnimacion();
  const controlAnimacion = document.getElementById("routeAnimationControl");
  if (controlAnimacion) controlAnimacion.style.display = "none";
  resetearEstadoAnimacion();

  if (datosHistoricosFiltrados.length > 0) {
    map.dibujarPuntosEnMapa(datosHistoricosFiltrados);
    // dibujarTodasLasPolylineas(); // (Implementar si es necesario)
  }
};

function toggleBotonesPlayPause(mostrarPlay) {
  const playBtn = document.getElementById("playBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  if (playBtn && pauseBtn) {
    playBtn.style.display = mostrarPlay ? "flex" : "none";
    pauseBtn.style.display = mostrarPlay ? "none" : "flex";
  }
}

function onGeofenceCreated(layer) {
  geofenceLayer = layer;
  ui.updateGeofenceModalState(true);
  // Si ya tenemos datos (por fecha), filtramos. Si no, buscamos en servidor.
  if (datosHistoricosOriginales.length > 0) {
    aplicarFiltrosYActualizarMapa();
  } else {
    fetchDatosPorGeocerca(layer.getBounds());
  }
}

function onGeofenceEdited(layer) {
  geofenceLayer = layer;
  if (datosHistoricosOriginales.length > 0) {
    aplicarFiltrosYActualizarMapa();
  } else {
    fetchDatosPorGeocerca(layer.getBounds());
  }
}

function onGeofenceDeleted() {
  geofenceLayer = null;
  ui.updateGeofenceModalState(false);
  if (datosHistoricosOriginales.length === 0) {
    onLimpiarMapa();
  } else {
    aplicarFiltrosYActualizarMapa();
  }
}

function onLimpiarMapa() {
  window.pausarAnimacion();
  datosHistoricosOriginales = [];
  datosHistoricosFiltrados = [];
  geofenceLayer = null;
  map.clearMap(false);
  ui.actualizarInformacionHistorica([], null);
  ui.resetDatePickers();
  ui.updateGeofenceModalState(false);
  const controlAnimacion = document.getElementById("routeAnimationControl");
  if (controlAnimacion) controlAnimacion.style.display = "none";
  resetearEstadoAnimacion();
}

function onLimpiarGeocerca() {
  if (geofenceLayer) {
    map.removeGeofence(geofenceLayer);
    onGeofenceDeleted();
  }
}

function onExportarDatos() {
  if (datosHistoricosFiltrados.length === 0) {
    alert("No hay datos para exportar");
    return;
  }
  ui.exportarDatos(datosHistoricosFiltrados);
}

function onToggleMarcadores() {
  map.toggleMarkers();
}

function onAjustarVista() {
  map.fitView(geofenceLayer);
}

// ==================== EXPORTAR FUNCIONES PÚBLICAS ====================
window.obtenerUsuariosRegistrados = obtenerUsuariosRegistrados;
window.getUsuariosSeleccionados = () => usuariosSeleccionados;
