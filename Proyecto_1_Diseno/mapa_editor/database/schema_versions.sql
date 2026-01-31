-- ============================================================================
-- EXTENSIÓN DE SCHEMA PARA VERSIONADO DE MAPAS
-- ============================================================================
-- Este archivo extiende el schema original con soporte para versiones
-- ============================================================================

-- Tabla de VERSIONES DE MAPAS
CREATE TABLE IF NOT EXISTS map_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                      -- Nombre de la versión (ej: "Puerto v1")
    description TEXT,                        -- Descripción de cambios
    osm_file_path TEXT,                      -- Ruta del .osm exportado
    osrm_data_path TEXT,                     -- Ruta de datos OSRM procesados
    is_active BOOLEAN DEFAULT 0,             -- Si está activa (solo 1 puede estar activa)
    parent_version_id INTEGER,               -- Versión padre (de dónde deriva)
    total_nodes INTEGER DEFAULT 0,           -- Estadísticas
    total_ways INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_version_id) REFERENCES map_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_versions_active ON map_versions(is_active);
CREATE INDEX IF NOT EXISTS idx_versions_created ON map_versions(created_at DESC);

-- Agregar campo version_id a las tablas existentes
-- Esto permite que cada nodo/way pertenezca a una versión específica

-- Para ways (calles)
ALTER TABLE ways ADD COLUMN version_id INTEGER DEFAULT NULL;
ALTER TABLE ways ADD COLUMN visible BOOLEAN DEFAULT 1;  -- Si está visible en esta versión
ALTER TABLE ways ADD COLUMN deleted BOOLEAN DEFAULT 0;  -- Si fue eliminado en esta versión
ALTER TABLE ways ADD COLUMN source TEXT DEFAULT 'manual'; -- 'manual', 'imported', 'osm_base'

-- Para nodes (nodos)
ALTER TABLE nodes ADD COLUMN version_id INTEGER DEFAULT NULL;
ALTER TABLE nodes ADD COLUMN visible BOOLEAN DEFAULT 1;
ALTER TABLE nodes ADD COLUMN deleted BOOLEAN DEFAULT 0;
ALTER TABLE nodes ADD COLUMN source TEXT DEFAULT 'manual';

-- Índices para versiones
CREATE INDEX IF NOT EXISTS idx_ways_version ON ways(version_id);
CREATE INDEX IF NOT EXISTS idx_ways_visible ON ways(visible, deleted);
CREATE INDEX IF NOT EXISTS idx_nodes_version ON nodes(version_id);
CREATE INDEX IF NOT EXISTS idx_nodes_visible ON nodes(visible, deleted);

-- Vista: Calles visibles de una versión específica
CREATE VIEW IF NOT EXISTS ways_by_version AS
SELECT
    w.*,
    v.name as version_name,
    v.is_active as version_active
FROM ways w
LEFT JOIN map_versions v ON w.version_id = v.id
WHERE w.visible = 1 AND w.deleted = 0;

-- Vista: Estadísticas por versión
CREATE VIEW IF NOT EXISTS version_stats AS
SELECT
    v.id,
    v.name,
    v.is_active,
    COUNT(DISTINCT w.id) as total_ways,
    COUNT(DISTINCT n.id) as total_nodes,
    SUM(CASE WHEN w.source = 'manual' THEN 1 ELSE 0 END) as manual_ways,
    SUM(CASE WHEN w.source = 'imported' THEN 1 ELSE 0 END) as imported_ways,
    v.created_at
FROM map_versions v
LEFT JOIN ways w ON w.version_id = v.id AND w.visible = 1 AND w.deleted = 0
LEFT JOIN nodes n ON n.version_id = v.id AND n.visible = 1 AND n.deleted = 0
GROUP BY v.id;

-- Trigger para asegurar solo 1 versión activa
CREATE TRIGGER IF NOT EXISTS ensure_single_active_version
BEFORE UPDATE ON map_versions
WHEN NEW.is_active = 1
BEGIN
    UPDATE map_versions SET is_active = 0 WHERE id != NEW.id;
END;

-- Trigger para actualizar timestamp
CREATE TRIGGER IF NOT EXISTS update_versions_timestamp
AFTER UPDATE ON map_versions
BEGIN
    UPDATE map_versions SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- ============================================================================
-- DATOS INICIALES
-- ============================================================================

-- Crear versión por defecto "Base" si no existe
INSERT OR IGNORE INTO map_versions (id, name, description, is_active)
VALUES (1, 'Base', 'Versión base del mapa (creada automáticamente)', 1);

-- Asignar todos los nodos/ways existentes a la versión base
UPDATE ways SET version_id = 1 WHERE version_id IS NULL;
UPDATE nodes SET version_id = 1 WHERE version_id IS NULL;
