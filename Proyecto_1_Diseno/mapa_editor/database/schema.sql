-- ============================================================================
-- SCHEMA DE BASE DE DATOS PARA EDITOR DE MAPAS OSRM
-- ============================================================================
-- Este esquema almacena modificaciones de calles para exportar a OSRM
--
-- Estructura:
--   - nodes: Puntos individuales (lat/lon)
--   - ways: Calles (colección de nodos)
--   - way_nodes: Relación entre calles y nodos (orden)
--   - tags: Metadatos de calles (nombre, tipo, velocidad, etc.)
-- ============================================================================

-- Tabla de NODOS (puntos en el mapa)
CREATE TABLE IF NOT EXISTS nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    osm_id INTEGER UNIQUE,              -- ID compatible con OSM (opcional)
    lat REAL NOT NULL,                   -- Latitud
    lon REAL NOT NULL,                   -- Longitud
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_lat CHECK (lat >= -90 AND lat <= 90),
    CONSTRAINT valid_lon CHECK (lon >= -180 AND lon <= 180)
);

-- Índices para búsquedas rápidas por coordenadas
CREATE INDEX IF NOT EXISTS idx_nodes_lat_lon ON nodes(lat, lon);
CREATE INDEX IF NOT EXISTS idx_nodes_osm_id ON nodes(osm_id);

-- Tabla de WAYS (calles/caminos)
CREATE TABLE IF NOT EXISTS ways (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    osm_id INTEGER UNIQUE,              -- ID compatible con OSM (opcional)
    name TEXT,                           -- Nombre de la calle
    highway_type TEXT DEFAULT 'road',    -- Tipo: road, residential, primary, etc.
    oneway BOOLEAN DEFAULT 0,            -- 0=bidireccional, 1=un solo sentido
    maxspeed INTEGER,                    -- Velocidad máxima (km/h)
    surface TEXT,                        -- Superficie: paved, unpaved, etc.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ways_osm_id ON ways(osm_id);
CREATE INDEX IF NOT EXISTS idx_ways_name ON ways(name);

-- Tabla de relación WAYS-NODES (orden de nodos en una calle)
CREATE TABLE IF NOT EXISTS way_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    way_id INTEGER NOT NULL,             -- ID de la calle
    node_id INTEGER NOT NULL,            -- ID del nodo
    sequence INTEGER NOT NULL,           -- Orden del nodo en la calle (1, 2, 3...)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (way_id) REFERENCES ways(id) ON DELETE CASCADE,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    UNIQUE(way_id, node_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_way_nodes_way ON way_nodes(way_id);
CREATE INDEX IF NOT EXISTS idx_way_nodes_sequence ON way_nodes(way_id, sequence);

-- Tabla de TAGS (metadatos adicionales)
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,           -- 'node' o 'way'
    entity_id INTEGER NOT NULL,          -- ID del nodo o way
    key TEXT NOT NULL,                   -- Clave (ej: 'lanes', 'access', 'bridge')
    value TEXT NOT NULL,                 -- Valor (ej: '2', 'private', 'yes')
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(entity_type, entity_id, key)
);

CREATE INDEX IF NOT EXISTS idx_tags_entity ON tags(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_tags_key ON tags(key);

-- Tabla de HISTORIAL DE EXPORTACIONES a OSRM
CREATE TABLE IF NOT EXISTS export_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    export_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_nodes INTEGER,
    total_ways INTEGER,
    osm_file_path TEXT,                  -- Ruta del archivo .osm generado
    status TEXT DEFAULT 'pending',       -- pending, success, error
    error_message TEXT,
    CONSTRAINT valid_status CHECK (status IN ('pending', 'success', 'error'))
);

-- ============================================================================
-- VISTAS ÚTILES
-- ============================================================================

-- Vista: Calles con todos sus nodos ordenados
CREATE VIEW IF NOT EXISTS ways_complete AS
SELECT
    w.id AS way_id,
    w.name AS way_name,
    w.highway_type,
    w.oneway,
    w.maxspeed,
    wn.sequence,
    n.id AS node_id,
    n.lat,
    n.lon
FROM ways w
JOIN way_nodes wn ON w.id = wn.way_id
JOIN nodes n ON wn.node_id = n.id
ORDER BY w.id, wn.sequence;

-- Vista: Estadísticas generales
CREATE VIEW IF NOT EXISTS map_stats AS
SELECT
    (SELECT COUNT(*) FROM nodes) AS total_nodes,
    (SELECT COUNT(*) FROM ways) AS total_ways,
    (SELECT COUNT(*) FROM tags) AS total_tags,
    (SELECT COUNT(*) FROM export_history WHERE status = 'success') AS successful_exports;

-- ============================================================================
-- TRIGGERS PARA AUTO-ACTUALIZAR updated_at
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS update_nodes_timestamp
AFTER UPDATE ON nodes
BEGIN
    UPDATE nodes SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_ways_timestamp
AFTER UPDATE ON ways
BEGIN
    UPDATE ways SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- ============================================================================
-- DATOS INICIALES DE EJEMPLO (opcional)
-- ============================================================================

-- Ejemplo: Insertar tipo de calles comunes
-- Estos datos son opcionales, solo para referencia

-- INSERT INTO tags (entity_type, entity_id, key, value) VALUES
-- ('way', 0, 'highway_types', 'motorway,trunk,primary,secondary,tertiary,residential,service,road');
