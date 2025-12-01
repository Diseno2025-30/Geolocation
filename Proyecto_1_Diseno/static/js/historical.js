import * as osrm from "./modules/osrm.js";
import * as map from "./modules/historicalMap.js";
import * as ui from "./modules/historicalUI.js";

// ==================== VARIABLES GLOBALES ====================
let datosHistoricosOriginales = [];
let datosHistoricosFiltrados = [];
let geofenceLayer = null;

// Paleta de colores para 5 usuarios
const COLORES_USUARIOS = [
  '#EF4444', // Rojo
  '#3B82F6', // Azul
  '#10B981', // Verde
  '#F59E0B', // Naranja
  '#8B5CF6'  // Púrpura
];

let estadoAnimacion = {
  puntosCompletos: [],
  segmentosRuta: {},
  indiceActual: 0,
  animacionActiva: false,
  intervalId: null,
  calculando: false,
};

// Nueva estructura para múltiples rutas por usuario
let estadoAnimacionMultiUsuario = {
  rutasPorUsuario: new Map(), // Map<user_id, {puntos: [], color: string, segmentos: Map, indiceActual: number}>
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

// ==================== CONTROL DE RANGO DE TIEMPO ====================
let rangoTiempoSeleccionado = {
  fechaInicio: null,
  horaInicio: null,
  fechaFin: null,
  horaFin: null
};

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

  // Por defecto, seleccionar los primeros 5 usuarios (máximo)
  usuariosSeleccionados = todosLosUsuarios.slice(0, 5);

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
        // Limitar a máximo 5 usuarios
        if (usuariosSeleccionados.length >= 5) {
          e.target.checked = false;
          mostrarAdvertencia(
            'Límite de Selección',
            'Solo puede seleccionar hasta 5 usuarios simultáneamente para la reconstrucción de rutas.',
            ['Deseleccione algún usuario antes de agregar otro']
          );
          return;
        }
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

  // Mostrar todos los usuarios seleccionados como chips
  usuariosSeleccionados.forEach(user_id => {
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
}

function configurarEventosSelector() {
  // Abrir/cerrar modal
  const selectorBtn = document.getElementById('userSelectorBtn');
  const modal = document.getElementById('userSelectorModal');
  const closeBtn = document.getElementById('closeUserSelectorModal');

  if (selectorBtn && modal) {
    selectorBtn.addEventListener('click', () => {
      const isActive = modal.classList.contains('active');
      if (isActive) {
        modal.classList.remove('active');
      } else {
        // Cerrar otros modales
        document.getElementById('searchModal')?.classList.remove('active');
        document.getElementById('geofenceModal')?.classList.remove('active');
        modal.classList.add('active');
      }
    });
  }

  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.classList.remove('active');
    });
  }

  // Búsqueda
  const searchInput = document.getElementById('userSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderizarListaUsuarios(e.target.value);
    });
  }

  // Seleccionar todos (máximo 5)
  const selectAllBtn = document.getElementById('selectAllUsers');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      usuariosSeleccionados = todosLosUsuarios.slice(0, 5);
      actualizarChipsUsuarios();
      renderizarListaUsuarios(searchInput?.value || '');

      if (todosLosUsuarios.length > 5) {
        mostrarAdvertencia(
          'Selección Limitada',
          `Se seleccionaron los primeros 5 usuarios de ${todosLosUsuarios.length} disponibles.`,
          ['Solo se pueden seleccionar hasta 5 usuarios para la reconstrucción de rutas']
        );
      }
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
}

// ==================== MODAL DE ADVERTENCIA ====================
function mostrarAdvertencia(titulo, mensaje, listaItems = null) {
  const modal = document.getElementById('warningModal');
  const tituloElement = document.getElementById('warningModalTitle');
  const mensajeElement = document.getElementById('warningModalMessage');
  const listaElement = document.getElementById('warningModalList');

  if (!modal) return;

  tituloElement.textContent = titulo;
  mensajeElement.textContent = mensaje;

  if (listaItems && listaItems.length > 0) {
    listaElement.style.display = 'block';
    listaElement.innerHTML = '';
    listaItems.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      listaElement.appendChild(li);
    });
  } else {
    listaElement.style.display = 'none';
  }

  modal.style.display = 'flex';
}

function cerrarAdvertencia() {
  const modal = document.getElementById('warningModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Configurar cierre del modal de advertencia
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('closeWarningModal');
  const modal = document.getElementById('warningModal');

  if (closeBtn) {
    closeBtn.addEventListener('click', cerrarAdvertencia);
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cerrarAdvertencia();
      }
    });
  }
});

// ==================== VALIDACIONES ====================
function validarSeleccionUsuarios() {
  if (usuariosSeleccionados.length === 0) {
    mostrarAdvertencia(
      'Selección de Usuario Requerida',
      'Debe seleccionar al menos un usuario antes de realizar la búsqueda histórica.',
      ['Haga clic en el botón de usuarios (👥) en la esquina superior derecha del mapa', 'Seleccione uno o más usuarios de la lista']
    );
    return false;
  }
  return true;
}

function validarRangoTiempo() {
  const { fechaInicio, horaInicio, fechaFin, horaFin } = rangoTiempoSeleccionado;

  if (!fechaInicio || !horaInicio || !fechaFin || !horaFin) {
    const faltantes = [];
    if (!fechaInicio || !horaInicio) faltantes.push('Fecha y hora de inicio');
    if (!fechaFin || !horaFin) faltantes.push('Fecha y hora de fin');

    mostrarAdvertencia(
      'Rango de Tiempo Requerido',
      'Debe configurar un rango de tiempo antes de usar la geocerca.',
      faltantes.map(f => `Configure: ${f}`)
    );
    return false;
  }
  return true;
}

function validarGeocerca() {
  const faltantes = [];

  if (!validarRangoTiempo()) {
    return false;
  }

  if (usuariosSeleccionados.length === 0) {
    faltantes.push('Seleccione al menos un usuario');
  }

  if (faltantes.length > 0) {
    mostrarAdvertencia(
      'Configuración Incompleta para Geocerca',
      'Para usar la geocerca debe completar lo siguiente:',
      faltantes
    );
    return false;
  }

  return true;
}

// ==================== CONSULTAS ====================

async function onVerHistorico(fechaInicio, horaInicio, fechaFin, horaFin) {
  // Validar que haya al menos un usuario seleccionado
  if (!validarSeleccionUsuarios()) {
    return;
  }

  // Guardar el rango de tiempo seleccionado
  rangoTiempoSeleccionado = {
    fechaInicio,
    horaInicio,
    fechaFin,
    horaFin
  };
  const basePath =
    window.BASE_PATH ||
    (window.location.pathname.startsWith("/test") ? "/test" : "");

  // Construir URL con usuarios seleccionados
  const userIdsParam = usuariosSeleccionados.join(',');
  const url = `${basePath}/historico/rango?inicio=${fechaInicio}&fin=${fechaFin}&hora_inicio=${horaInicio}&hora_fin=${horaFin}&user_ids=${encodeURIComponent(userIdsParam)}`;

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
  // Validar que se haya configurado el rango de tiempo y usuarios
  if (!validarGeocerca()) {
    return;
  }

  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const basePath =
    window.BASE_PATH ||
    (window.location.pathname.startsWith("/test") ? "/test" : "");

  // Construir URL con usuarios seleccionados y rango de tiempo
  const userIdsParam = usuariosSeleccionados.join(',');
  const { fechaInicio, horaInicio, fechaFin, horaFin } = rangoTiempoSeleccionado;

  const url = `${basePath}/historico/geocerca?min_lat=${sw.lat}&min_lon=${sw.lng}&max_lat=${ne.lat}&max_lon=${ne.lng}&user_ids=${encodeURIComponent(userIdsParam)}&inicio=${fechaInicio}&fin=${fechaFin}&hora_inicio=${horaInicio}&hora_fin=${horaFin}`;

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
    const controlAnimacion = document.getElementById("routeControlPanel");
    if (controlAnimacion) controlAnimacion.style.display = "none";

    // Solo mostramos alerta si teníamos datos originales y el filtro los ocultó todos
    if (datosHistoricosOriginales.length > 0) {
      // Opcional: alert("No hay puntos dentro de la zona exacta.");
    }
    return;
  }

  const controlAnimacion = document.getElementById("routeControlPanel");
  if (controlAnimacion) {
    controlAnimacion.style.display = "block";
    controlAnimacion.classList.remove('collapsed'); // Expandir al mostrar
  }

  prepararAnimacionRuta();
  actualizarInformacionPanel();
}

function prepararAnimacionRuta() {
  map.clearMap(!!geofenceLayer);
  resetearEstadoAnimacion();

  // Verificar si hay múltiples usuarios
  const usuariosUnicos = [...new Set(datosHistoricosFiltrados.map(d => d.user_id))];

  if (usuariosUnicos.length > 1 && usuariosUnicos.length <= 5) {
    // Modo multi-usuario: reorganizar datos por usuario
    prepararAnimacionMultiUsuario(usuariosUnicos);
  } else {
    // Modo single-usuario (legacy)
    estadoAnimacion.puntosCompletos = [...datosHistoricosFiltrados];
    configurarUISlider();
    renderizarHastaIndice(0);
  }

  ui.actualizarInformacionHistorica(datosHistoricosFiltrados, geofenceLayer);
}

function prepararAnimacionMultiUsuario(usuariosUnicos) {
  // Resetear estado multi-usuario
  estadoAnimacionMultiUsuario.rutasPorUsuario.clear();
  estadoAnimacionMultiUsuario.animacionActiva = false;
  estadoAnimacionMultiUsuario.calculando = false;

  // Organizar datos por usuario
  usuariosUnicos.forEach((user_id, index) => {
    const puntosUsuario = datosHistoricosFiltrados.filter(d => d.user_id === user_id);
    const color = COLORES_USUARIOS[index % COLORES_USUARIOS.length];

    estadoAnimacionMultiUsuario.rutasPorUsuario.set(user_id, {
      puntos: puntosUsuario,
      color: color,
      segmentos: new Map(), // Map<indice, coordenadas[]>
      indiceActual: 0 // Cada ruta empieza en índice 0
    });
  });

  // Limpiar el mapa antes de empezar
  map.clearPolylines();
  map.clearMarkers();

  // Configurar UI para multi-usuario
  configurarUISliderMultiUsuario();
  renderizarHastaIndiceMultiUsuario(0);
}

function configurarUISliderMultiUsuario() {
  const slider = document.getElementById("routeAnimationSlider");
  const totalPoints = document.getElementById("totalPointsCount");

  if (slider && totalPoints) {
    // Encontrar la ruta más larga para configurar el slider
    let maxPuntos = 0;
    estadoAnimacionMultiUsuario.rutasPorUsuario.forEach(ruta => {
      maxPuntos = Math.max(maxPuntos, ruta.puntos.length);
    });

    slider.max = maxPuntos - 1;
    slider.value = 0;
    totalPoints.textContent = maxPuntos;
  }
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

// ==================== RENDERIZADO MULTI-USUARIO ====================
async function renderizarHastaIndiceMultiUsuario(indice) {
  if (estadoAnimacionMultiUsuario.calculando) return;
  estadoAnimacionMultiUsuario.calculando = true;

  // MODO INCREMENTAL: Solo renderizar lo nuevo, no borrar lo anterior
  for (const [user_id, ruta] of estadoAnimacionMultiUsuario.rutasPorUsuario) {
    const maxIndice = Math.min(indice, ruta.puntos.length - 1);
    const ultimoIndiceRenderizado = ruta.indiceActual;

    if (maxIndice < 0) continue;

    // Si es la primera vez (índice 0), dibujar el marcador de inicio
    if (indice === 0 && ultimoIndiceRenderizado === 0) {
      map.dibujarMarcadorInicio(ruta.puntos[0], user_id, ruta.color);
      ruta.indiceActual = 0;
      continue;
    }

    // Renderizar solo los segmentos nuevos desde el último índice renderizado
    for (let i = ultimoIndiceRenderizado + 1; i <= maxIndice; i++) {
      // Dibujar el segmento desde el punto anterior al actual
      await dibujarSegmentoConCacheMultiUsuario(user_id, i - 1, ruta);

      // Dibujar el punto actual
      if (i === maxIndice && maxIndice === ruta.puntos.length - 1) {
        // Es el último punto de la ruta completa: marcador de fin
        map.dibujarMarcadorFin(ruta.puntos[i], user_id, ruta.color);
      } else {
        // Punto intermedio
        map.dibujarPuntoConColor(ruta.puntos[i], ruta.color);
      }
    }

    // Actualizar el índice renderizado para esta ruta
    ruta.indiceActual = maxIndice;
  }

  const currentPointElement = document.getElementById("currentPointIndex");
  if (currentPointElement) currentPointElement.textContent = indice + 1;

  if (indice === 0) map.fitView(geofenceLayer);

  estadoAnimacionMultiUsuario.calculando = false;
}

async function dibujarSegmentoConCacheMultiUsuario(user_id, indice, ruta) {
  // Verificar si el segmento ya está en caché
  if (ruta.segmentos.has(indice)) {
    map.dibujarSegmentoRutaConColor(
      ruta.segmentos.get(indice),
      geofenceLayer,
      ruta.color
    );
    return;
  }

  const punto1 = ruta.puntos[indice];
  const punto2 = ruta.puntos[indice + 1];

  try {
    const rutaOSRM = await osrm.getOSRMRoute(
      punto1.lat,
      punto1.lon,
      punto2.lat,
      punto2.lon
    );
    if (rutaOSRM && rutaOSRM.length > 0) {
      ruta.segmentos.set(indice, rutaOSRM);
      map.dibujarSegmentoRutaConColor(rutaOSRM, geofenceLayer, ruta.color);
    } else {
      const fallback = [
        [punto1.lat, punto1.lon],
        [punto2.lat, punto2.lon],
      ];
      ruta.segmentos.set(indice, fallback);
      map.dibujarSegmentoRutaConColor(fallback, geofenceLayer, ruta.color);
    }
  } catch (error) {
    const fallback = [
      [punto1.lat, punto1.lon],
      [punto2.lat, punto2.lon],
    ];
    ruta.segmentos.set(indice, fallback);
    map.dibujarSegmentoRutaConColor(fallback, geofenceLayer, ruta.color);
  }
}

function configurarSliderAnimacion() {
  const slider = document.getElementById("routeAnimationSlider");
  if (slider) {
    slider.addEventListener("input", async (e) => {
      const indice = parseInt(e.target.value);

      // Verificar si estamos en modo multi-usuario
      if (estadoAnimacionMultiUsuario.rutasPorUsuario.size > 0) {
        // Verificar si el usuario está retrocediendo en el slider
        const indiceActualMaximo = Math.max(
          ...Array.from(estadoAnimacionMultiUsuario.rutasPorUsuario.values()).map(r => r.indiceActual)
        );

        if (indice < indiceActualMaximo) {
          // Si retrocede, limpiar y redibujar desde cero
          map.clearPolylines();
          map.clearMarkers();
          estadoAnimacionMultiUsuario.rutasPorUsuario.forEach(ruta => {
            ruta.indiceActual = 0;
          });
        }

        await renderizarHastaIndiceMultiUsuario(indice);
      } else {
        estadoAnimacion.indiceActual = indice;
        await renderizarHastaIndice(indice);
      }
    });
  }
}

window.animarRutaAutomatica = async function () {
  // Verificar si estamos en modo multi-usuario
  if (estadoAnimacionMultiUsuario.rutasPorUsuario.size > 0) {
    return animarRutaMultiUsuario();
  }

  // Modo single-usuario (legacy)
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

async function animarRutaMultiUsuario() {
  if (estadoAnimacionMultiUsuario.animacionActiva) return;
  estadoAnimacionMultiUsuario.animacionActiva = true;
  toggleBotonesPlayPause(false);

  const slider = document.getElementById("routeAnimationSlider");
  const velocidad = 500; // 500ms entre puntos (más lento para multi-usuario)

  // Obtener el máximo de puntos entre todas las rutas
  let maxPuntos = 0;
  estadoAnimacionMultiUsuario.rutasPorUsuario.forEach(ruta => {
    maxPuntos = Math.max(maxPuntos, ruta.puntos.length);
  });

  let indiceGlobal = 0;

  estadoAnimacionMultiUsuario.intervalId = setInterval(async () => {
    if (indiceGlobal >= maxPuntos - 1) {
      window.pausarAnimacion();
      return;
    }
    indiceGlobal++;
    if (slider) slider.value = indiceGlobal;
    await renderizarHastaIndiceMultiUsuario(indiceGlobal);
  }, velocidad);
}

window.pausarAnimacion = function () {
  estadoAnimacion.animacionActiva = false;
  estadoAnimacionMultiUsuario.animacionActiva = false;

  if (estadoAnimacion.intervalId) {
    clearInterval(estadoAnimacion.intervalId);
    estadoAnimacion.intervalId = null;
  }
  if (estadoAnimacionMultiUsuario.intervalId) {
    clearInterval(estadoAnimacionMultiUsuario.intervalId);
    estadoAnimacionMultiUsuario.intervalId = null;
  }

  toggleBotonesPlayPause(true);
};

window.reiniciarAnimacion = async function () {
  window.pausarAnimacion();

  const slider = document.getElementById("routeAnimationSlider");
  if (slider) slider.value = 0;

  // Verificar si estamos en modo multi-usuario
  if (estadoAnimacionMultiUsuario.rutasPorUsuario.size > 0) {
    // Limpiar el mapa y resetear índices de cada ruta
    map.clearPolylines();
    map.clearMarkers();

    estadoAnimacionMultiUsuario.rutasPorUsuario.forEach(ruta => {
      ruta.indiceActual = 0;
    });

    await renderizarHastaIndiceMultiUsuario(0);
  } else {
    estadoAnimacion.indiceActual = 0;
    await renderizarHastaIndice(0);
  }
};

window.cerrarAnimacion = function () {
  window.pausarAnimacion();
  const controlAnimacion = document.getElementById("routeControlPanel");
  if (controlAnimacion) controlAnimacion.style.display = "none";
  resetearEstadoAnimacion();

  // Resetear estado multi-usuario
  estadoAnimacionMultiUsuario.rutasPorUsuario.clear();
  estadoAnimacionMultiUsuario.calculando = false;

  // Resetear barra de progreso
  const progressFill = document.getElementById('panelProgressFill');
  if (progressFill) progressFill.style.width = '0%';

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
  const controlAnimacion = document.getElementById("routeControlPanel");
  if (controlAnimacion) controlAnimacion.style.display = "none";
  resetearEstadoAnimacion();

  // Resetear barra de progreso
  const progressFill = document.getElementById('panelProgressFill');
  if (progressFill) progressFill.style.width = '0%';
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
