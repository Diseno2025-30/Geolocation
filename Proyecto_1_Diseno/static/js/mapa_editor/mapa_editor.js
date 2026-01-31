/**
 * ============================================================================
 * EDITOR DE MAPAS OSRM
 * ============================================================================
 *
 * Este módulo proporciona funcionalidad completa para editar mapas:
 * - Dibujar calles (ways) en el mapa
 * - Editar calles existentes
 * - Guardar cambios en la base de datos
 * - Exportar a formato OSM
 * - Actualizar OSRM Docker
 *
 * Modos de edición:
 * - VIEW: Solo ver (por defecto)
 * - DRAW: Dibujar nueva calle
 * - EDIT: Editar calle existente
 * - DELETE: Eliminar elementos
 *
 * ============================================================================
 */

class MapaEditor {
    constructor(mapId, options = {}) {
        this.mapId = mapId;
        this.map = null;
        this.mode = 'VIEW'; // VIEW, DRAW, EDIT, DELETE
        this.currentWay = null; // Calle que se está dibujando/editando
        this.tempMarkers = []; // Marcadores temporales al dibujar
        this.tempLine = null; // Línea temporal al dibujar
        this.ways = {}; // Calles cargadas {id: {data, layer}}
        this.selectedWay = null; // Calle seleccionada

        // API endpoints
        this.API_BASE = window.BASE_PATH ? `${window.BASE_PATH}/api/mapa` : '/api/mapa';

        // Opciones
        this.options = {
            center: options.center || [11.0041, -74.8070],
            zoom: options.zoom || 13,
            drawColor: options.drawColor || '#FF4444',
            wayColor: options.wayColor || '#3388ff',
            selectedColor: options.selectedColor || '#FFaa00',
            ...options
        };

        this.init();
    }

    // ========================================================================
    // INICIALIZACIÓN
    // ========================================================================

    init() {
        console.log('🗺️ Inicializando Editor de Mapas...');

        // Crear mapa
        this.map = L.map(this.mapId).setView(this.options.center, this.options.zoom);

        // Agregar capa de tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(this.map);

        // Event listeners
        this.setupEventListeners();

        // Cargar calles existentes
        this.loadExistingWays();

        // Actualizar UI
        this.updateModeUI();

        console.log('✓ Editor inicializado');
    }

    setupEventListeners() {
        // Click en el mapa (para dibujar)
        this.map.on('click', (e) => this.handleMapClick(e));

        // Teclas
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));
    }

    // ========================================================================
    // MANEJO DE EVENTOS
    // ========================================================================

    handleMapClick(e) {
        const lat = e.latlng.lat;
        const lon = e.latlng.lng;

        switch (this.mode) {
            case 'DRAW':
                this.addPointToCurrentWay(lat, lon);
                break;

            case 'DELETE':
                // Implementar lógica de eliminación
                break;

            default:
                // Mostrar coordenadas
                L.popup()
                    .setLatLng(e.latlng)
                    .setContent(`<b>Coordenadas</b><br>Lat: ${lat.toFixed(6)}<br>Lon: ${lon.toFixed(6)}`)
                    .openOn(this.map);
        }
    }

    handleKeyPress(e) {
        // ESC: Cancelar operación actual
        if (e.key === 'Escape') {
            this.cancelCurrentOperation();
        }

        // Enter: Finalizar dibujo
        if (e.key === 'Enter' && this.mode === 'DRAW') {
            this.finishDrawing();
        }

        // Delete/Backspace: Eliminar último punto
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.mode === 'DRAW') {
            e.preventDefault();
            this.removeLastPoint();
        }
    }

    // ========================================================================
    // MODOS DE EDICIÓN
    // ========================================================================

    setMode(newMode) {
        console.log(`Cambiando modo: ${this.mode} → ${newMode}`);

        // Cancelar operación actual
        this.cancelCurrentOperation();

        this.mode = newMode;
        this.updateModeUI();

        // Cambiar cursor del mapa
        const mapContainer = document.getElementById(this.mapId);
        switch (newMode) {
            case 'DRAW':
                mapContainer.style.cursor = 'crosshair';
                this.showNotification('Haz clic en el mapa para dibujar una calle. Enter para finalizar, Esc para cancelar.', 'info');
                break;
            case 'EDIT':
                mapContainer.style.cursor = 'pointer';
                this.showNotification('Selecciona una calle para editar', 'info');
                break;
            case 'DELETE':
                mapContainer.style.cursor = 'not-allowed';
                this.showNotification('Haz clic en una calle para eliminarla', 'warning');
                break;
            default:
                mapContainer.style.cursor = '';
        }
    }

    updateModeUI() {
        // Actualizar botones de modo
        document.querySelectorAll('[data-mode]').forEach(btn => {
            if (btn.dataset.mode === this.mode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    // ========================================================================
    // DIBUJO DE CALLES
    // ========================================================================

    startDrawing() {
        this.setMode('DRAW');
        this.currentWay = {
            points: [],
            nodes: []
        };
    }

    addPointToCurrentWay(lat, lon) {
        if (!this.currentWay) {
            this.currentWay = { points: [], nodes: [] };
        }

        // Agregar punto
        this.currentWay.points.push([lat, lon]);

        // Crear marcador temporal
        const marker = L.circleMarker([lat, lon], {
            radius: 6,
            color: this.options.drawColor,
            fillColor: '#fff',
            fillOpacity: 1,
            weight: 2
        }).addTo(this.map);

        marker.bindPopup(`Punto ${this.currentWay.points.length}`);
        this.tempMarkers.push(marker);

        // Actualizar línea temporal
        this.updateTempLine();

        console.log(`Punto agregado: ${lat.toFixed(6)}, ${lon.toFixed(6)} (Total: ${this.currentWay.points.length})`);
    }

    updateTempLine() {
        if (this.tempLine) {
            this.map.removeLayer(this.tempLine);
        }

        if (this.currentWay.points.length >= 2) {
            this.tempLine = L.polyline(this.currentWay.points, {
                color: this.options.drawColor,
                weight: 4,
                opacity: 0.7,
                dashArray: '10, 10'
            }).addTo(this.map);
        }
    }

    removeLastPoint() {
        if (!this.currentWay || this.currentWay.points.length === 0) return;

        // Eliminar punto y marcador
        this.currentWay.points.pop();
        const marker = this.tempMarkers.pop();
        if (marker) {
            this.map.removeLayer(marker);
        }

        // Actualizar línea
        this.updateTempLine();

        console.log(`Punto eliminado. Quedan: ${this.currentWay.points.length}`);
    }

    async finishDrawing() {
        if (!this.currentWay || this.currentWay.points.length < 2) {
            this.showNotification('Una calle debe tener al menos 2 puntos', 'error');
            return;
        }

        // Pedir datos de la calle
        const name = prompt('Nombre de la calle (opcional):');
        const highwayType = prompt('Tipo de vía (road, residential, primary, secondary):', 'road');

        try {
            this.showNotification('Guardando calle...', 'info');

            // 1. Crear nodos en la BD
            const nodeIds = await this.createNodes(this.currentWay.points);

            // 2. Crear way en la BD
            const wayData = await this.createWay(nodeIds, {
                name: name || null,
                highway_type: highwayType || 'road',
                oneway: false
            });

            this.showNotification('✓ Calle guardada exitosamente', 'success');

            // Limpiar y recargar
            this.clearTempDrawing();
            this.loadExistingWays();
            this.setMode('VIEW');

        } catch (error) {
            console.error('Error guardando calle:', error);
            this.showNotification('❌ Error guardando calle: ' + error.message, 'error');
        }
    }

    clearTempDrawing() {
        // Eliminar marcadores temporales
        this.tempMarkers.forEach(marker => this.map.removeLayer(marker));
        this.tempMarkers = [];

        // Eliminar línea temporal
        if (this.tempLine) {
            this.map.removeLayer(this.tempLine);
            this.tempLine = null;
        }

        this.currentWay = null;
    }

    cancelCurrentOperation() {
        this.clearTempDrawing();
        this.selectedWay = null;
        this.setMode('VIEW');
    }

    // ========================================================================
    // API - OPERACIONES CON NODOS Y WAYS
    // ========================================================================

    async createNodes(points) {
        const nodeIds = [];

        for (const [lat, lon] of points) {
            const response = await fetch(`${this.API_BASE}/nodes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat, lon })
            });

            if (!response.ok) {
                throw new Error(`Error creando nodo: ${response.statusText}`);
            }

            const data = await response.json();
            nodeIds.push(data.node.id);
        }

        return nodeIds;
    }

    async createWay(nodeIds, metadata = {}) {
        const response = await fetch(`${this.API_BASE}/ways`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                node_ids: nodeIds,
                ...metadata
            })
        });

        if (!response.ok) {
            throw new Error(`Error creando calle: ${response.statusText}`);
        }

        return await response.json();
    }

    async loadExistingWays() {
        try {
            const response = await fetch(`${this.API_BASE}/ways`);

            if (!response.ok) {
                throw new Error(`Error cargando calles: ${response.statusText}`);
            }

            const data = await response.json();

            // Limpiar calles anteriores
            Object.values(this.ways).forEach(({ layer }) => {
                if (layer) this.map.removeLayer(layer);
            });
            this.ways = {};

            // Dibujar calles en el mapa
            data.ways.forEach(way => this.drawWay(way));

            console.log(`✓ Cargadas ${data.ways.length} calles`);
            this.showNotification(`Cargadas ${data.ways.length} calles`, 'success');

        } catch (error) {
            console.error('Error cargando calles:', error);
            this.showNotification('Error cargando calles: ' + error.message, 'error');
        }
    }

    drawWay(wayData) {
        // Convertir nodos a coordenadas
        const coords = wayData.nodes.map(node => [node.lat, node.lon]);

        // Crear polyline
        const layer = L.polyline(coords, {
            color: this.options.wayColor,
            weight: 4,
            opacity: 0.8
        }).addTo(this.map);

        // Popup con información
        layer.bindPopup(`
            <div class="way-popup">
                <h4>${wayData.name || 'Sin nombre'}</h4>
                <p><b>ID:</b> ${wayData.id}</p>
                <p><b>Tipo:</b> ${wayData.highway_type}</p>
                <p><b>Nodos:</b> ${wayData.nodes.length}</p>
                ${wayData.maxspeed ? `<p><b>Velocidad:</b> ${wayData.maxspeed} km/h</p>` : ''}
                <div class="way-actions">
                    <button onclick="mapaEditor.editWay(${wayData.id})">Editar</button>
                    <button onclick="mapaEditor.deleteWay(${wayData.id})">Eliminar</button>
                </div>
            </div>
        `);

        // Click para seleccionar
        layer.on('click', () => {
            if (this.mode === 'DELETE') {
                this.deleteWay(wayData.id);
            }
        });

        // Guardar referencia
        this.ways[wayData.id] = { data: wayData, layer };
    }

    async deleteWay(wayId) {
        if (!confirm('¿Estás seguro de eliminar esta calle?')) {
            return;
        }

        try {
            const response = await fetch(`${this.API_BASE}/ways/${wayId}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error(`Error eliminando calle: ${response.statusText}`);
            }

            // Eliminar del mapa
            if (this.ways[wayId]) {
                this.map.removeLayer(this.ways[wayId].layer);
                delete this.ways[wayId];
            }

            this.showNotification('✓ Calle eliminada', 'success');

        } catch (error) {
            console.error('Error eliminando calle:', error);
            this.showNotification('Error eliminando calle: ' + error.message, 'error');
        }
    }

    editWay(wayId) {
        // TODO: Implementar edición de calles
        this.showNotification('Función de edición en desarrollo', 'info');
    }

    // ========================================================================
    // EXPORTACIÓN
    // ========================================================================

    async exportToGeoJSON() {
        try {
            this.showNotification('Exportando a GeoJSON...', 'info');

            const response = await fetch(`${this.API_BASE}/export/geojson`);

            if (!response.ok) {
                throw new Error(`Error en exportación: ${response.statusText}`);
            }

            const geojson = await response.json();

            // Descargar como archivo
            this.downloadJSON(geojson, 'mapa_export.geojson');

            this.showNotification('✓ GeoJSON exportado', 'success');

        } catch (error) {
            console.error('Error exportando GeoJSON:', error);
            this.showNotification('Error exportando: ' + error.message, 'error');
        }
    }

    async exportToOSM() {
        if (!confirm('¿Exportar datos a formato OSM?')) return;

        try {
            this.showNotification('Exportando a formato OSM...', 'info');

            const response = await fetch(`${this.API_BASE}/export/osm`, {
                method: 'POST'
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || response.statusText);
            }

            const result = await response.json();

            this.showNotification(`✓ Archivo OSM generado: ${result.file_path}`, 'success');

            // Mostrar estadísticas
            console.log('Validación:', result.validation);

        } catch (error) {
            console.error('Error exportando OSM:', error);
            this.showNotification('Error exportando: ' + error.message, 'error');
        }
    }

    async updateOSRM() {
        if (!confirm('¿Actualizar OSRM con los cambios? Esto puede tomar varios minutos.')) return;

        try {
            this.showNotification('Actualizando OSRM Docker... Por favor espera...', 'info');

            const response = await fetch(`${this.API_BASE}/export/osrm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    container_name: 'osrm',
                    restart_service: false
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || response.statusText);
            }

            const result = await response.json();

            this.showNotification('✓ OSRM actualizado exitosamente', 'success');
            console.log('Resultado:', result);

        } catch (error) {
            console.error('Error actualizando OSRM:', error);
            this.showNotification('Error actualizando OSRM: ' + error.message, 'error');
        }
    }

    // ========================================================================
    // UTILIDADES
    // ========================================================================

    downloadJSON(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    showNotification(message, type = 'info') {
        console.log(`[${type.toUpperCase()}] ${message}`);

        // Mostrar en UI si existe elemento de notificación
        const notificationEl = document.getElementById('editor-notification');
        if (notificationEl) {
            notificationEl.textContent = message;
            notificationEl.className = `notification ${type}`;
            notificationEl.style.display = 'block';

            setTimeout(() => {
                notificationEl.style.display = 'none';
            }, 5000);
        }
    }
}

// ============================================================================
// INICIALIZACIÓN GLOBAL
// ============================================================================

let mapaEditor;

document.addEventListener('DOMContentLoaded', () => {
    // Inicializar editor cuando el DOM esté listo
    if (document.getElementById('map')) {
        mapaEditor = new MapaEditor('map');

        // Exponer globalmente para acceso desde HTML
        window.mapaEditor = mapaEditor;

        console.log('✓ Editor de mapas disponible globalmente como window.mapaEditor');
    }
});
