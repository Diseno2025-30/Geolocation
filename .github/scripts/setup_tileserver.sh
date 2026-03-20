#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ NUEVO TILE SERVER - POSTGIS + NODEJS"
echo "🗺️ ========================================="
echo ""

# ============================================
# PASO 1: VERIFICAR ARCHIVO PBF
# ============================================
echo "📁 PASO 1: Verificando archivo PBF..."

PBF_SOURCE="/tmp/PuertoFinal.osm.pbf"
if [ ! -f "$PBF_SOURCE" ]; then
    echo "❌ ERROR: Archivo PBF no encontrado en ${PBF_SOURCE}"
    exit 1
fi
echo "✅ Archivo PBF encontrado: $(ls -lh $PBF_SOURCE | awk '{print $5}')"

# ============================================
# PASO 2: CONFIGURAR REPOSITORIO POSTGRESQL OFICIAL
# ============================================
echo ""
echo "📦 PASO 2: Configurando repositorio PostgreSQL oficial..."

sudo apt-get update -qq
sudo apt-get install -y curl wget gnupg lsb-release ca-certificates software-properties-common

sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
sudo sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
sudo apt-get update -qq

echo "✅ Repositorio PostgreSQL configurado"

# ============================================
# PASO 3: INSTALAR POSTGRESQL Y POSTGIS
# ============================================
echo ""
echo "🐘 PASO 3: Instalando PostgreSQL y PostGIS..."

sudo apt-get install -y postgresql postgresql-contrib postgis postgresql-16-postgis-3 \
                        osm2pgsql osmctools \
                        build-essential cmake libosmium2-dev libprotozero-dev liblz4-dev libboost-dev

echo "✅ PostgreSQL y PostGIS instalados"

# ============================================
# PASO 4: CONFIGURAR POSTGRESQL
# ============================================
echo ""
echo "🔧 PASO 4: Configurando PostgreSQL..."

sudo systemctl start postgresql
sudo systemctl enable postgresql

# DETECTAR VERSIÓN DE POSTGRESQL
echo "   Detectando versión de PostgreSQL..."
PG_VERSION=$(ls /etc/postgresql/ 2>/dev/null | head -1)
if [ -z "$PG_VERSION" ]; then
    PG_VERSION=$(psql --version | grep -oP '\d+' | head -1)
fi
echo "   Usando PostgreSQL versión: ${PG_VERSION}"

# Configurar pg_hba.conf
PG_HBA="/etc/postgresql/${PG_VERSION}/main/pg_hba.conf"
if [ -f "$PG_HBA" ]; then
    sudo cp ${PG_HBA} ${PG_HBA}.backup 2>/dev/null || true
    sudo sed -i 's/local   all             all                                     peer/local   all             all                                     trust/g' ${PG_HBA}
    sudo sed -i 's/host    all             all             127.0.0.1\/32            md5/host    all             all             127.0.0.1\/32            trust/g' ${PG_HBA}
    echo "   ✅ Configuración de autenticación actualizada"
fi

# Optimizar memoria
PG_CONF="/etc/postgresql/${PG_VERSION}/main/postgresql.conf"
if [ -f "$PG_CONF" ]; then
    sudo cp ${PG_CONF} ${PG_CONF}.backup 2>/dev/null || true
    sudo sed -i 's/^shared_buffers = .*/shared_buffers = 512MB/' ${PG_CONF}
    sudo sed -i 's/^work_mem = .*/work_mem = 32MB/' ${PG_CONF}
    sudo sed -i 's/^maintenance_work_mem = .*/maintenance_work_mem = 128MB/' ${PG_CONF}
    sudo sed -i 's/^effective_cache_size = .*/effective_cache_size = 1GB/' ${PG_CONF}
    echo "   ✅ Configuración de memoria optimizada"
fi

# Configurar usuario y base de datos
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE USER ubuntu WITH SUPERUSER PASSWORD 'postgres';" 2>/dev/null || true
sudo -u postgres psql -c "DROP DATABASE IF EXISTS gis;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE gis OWNER ubuntu;" 2>/dev/null || true
sudo -u postgres psql -d gis -c "CREATE EXTENSION IF NOT EXISTS postgis;"
sudo -u postgres psql -d gis -c "CREATE EXTENSION IF NOT EXISTS postgis_topology;"
sudo -u postgres psql -d gis -c "CREATE EXTENSION IF NOT EXISTS hstore;"

sudo systemctl restart postgresql
sleep 3

echo "✅ PostgreSQL configurado correctamente"

# ============================================
# PASO 5: IMPORTAR DATOS CON osm2pgsql
# ============================================
echo ""
echo "📥 PASO 5: Importando datos OSM a PostGIS..."
echo "   (Puede tardar 5-10 minutos con 3.7GB RAM)"

# Verificar versión
OSM2PGSQL_VERSION=$(osm2pgsql --version | head -1)
echo "   Usando ${OSM2PGSQL_VERSION}"

# Limpiar caché
rm -f /tmp/osm2pgsql.cache 2>/dev/null || true

# Configurar variables de entorno para PostgreSQL
export PGHOST=localhost
export PGPORT=5432
export PGDATABASE=gis
export PGUSER=ubuntu
export PGPASSWORD=postgres

# Verificar conexión a PostgreSQL
echo "   Verificando conexión a PostgreSQL..."
if psql -c "SELECT 1" > /dev/null 2>&1; then
    echo "   ✅ Conexión exitosa con usuario ubuntu"
elif PGPASSWORD=postgres PGUSER=postgres psql -c "SELECT 1" > /dev/null 2>&1; then
    echo "   ✅ Conexión exitosa con usuario postgres"
    export PGUSER=postgres
else
    echo "❌ ERROR: No se puede conectar a PostgreSQL"
    exit 1
fi

echo "   Importando con usuario: ${PGUSER}"

# Ordenar y reasignar IDs negativos (elementos editados en JOSM con IDs temporales negativos)
echo "🔧 Ordenando y reasignando IDs negativos..."
sudo apt-get install -y osmium-tool -qq
SORTED_FILE="/tmp/PuertoFinal_sorted.osm.pbf"
IMPORT_FILE="/tmp/PuertoFinal_renumbered.osm.pbf"
osmium sort "$PBF_SOURCE" -o "$SORTED_FILE" --overwrite
osmium renumber "$SORTED_FILE" -o "$IMPORT_FILE" --overwrite
echo "✅ Archivo listo para importar"

osm2pgsql \
    --create \
    --slim \
    --drop \
    --cache 500 \
    --number-processes 2 \
    --style /usr/share/osm2pgsql/default.style \
    --hstore \
    --multi-geometry \
    --input-reader pbf \
    --prefix planet \
    "$IMPORT_FILE"

if [ $? -eq 0 ]; then
    echo "✅ Datos OSM importados exitosamente"
else
    echo "❌ ERROR: Falló la importación"
    unset PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
    exit 1
fi

# Limpiar variables de entorno
unset PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD

echo "✅ Importación completada"

# ============================================
# PASO 6: CREAR FUNCIÓN TILEBBOX
# ============================================
echo ""
echo "🔧 PASO 6: Creando función TileBBox..."

export PGPASSWORD=postgres
PSQL_USER="ubuntu"
psql -U ubuntu -d gis -h localhost -c "SELECT 1" > /dev/null 2>&1 || PSQL_USER="postgres"
echo "   Usando usuario psql: ${PSQL_USER}"

psql -U $PSQL_USER -d gis -h localhost << 'SQLEOF'
CREATE OR REPLACE FUNCTION TileBBox(z int, x int, y int, srid int = 3857)
RETURNS geometry
LANGUAGE plpgsql IMMUTABLE AS
$func$
DECLARE
    max numeric := 20037508.34;
    res numeric := (max*2)/(2^z);
    bbox geometry;
BEGIN
    bbox := ST_MakeEnvelope(
        -max + (x * res),
        max - (y * res),
        -max + (x * res) + res,
        max - (y * res) - res,
        3857
    );
    IF srid = 3857 THEN
        RETURN bbox;
    ELSE
        RETURN ST_Transform(bbox, srid);
    END IF;
END;
$func$;

CREATE INDEX IF NOT EXISTS idx_planet_line_way ON planet_line USING GIST (way);
CREATE INDEX IF NOT EXISTS idx_planet_polygon_way ON planet_polygon USING GIST (way);
CREATE INDEX IF NOT EXISTS idx_planet_line_highway ON planet_line (highway) WHERE highway IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_planet_polygon_admin ON planet_polygon (admin_level) WHERE admin_level IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_planet_point_place ON planet_point (place) WHERE place IS NOT NULL;
SQLEOF

unset PGPASSWORD
echo "✅ Función TileBBox creada"

# ============================================
# PASO 7: INSTALAR NODEJS Y CREAR API
# ============================================
echo ""
echo "🌐 PASO 7: Instalando NodeJS y creando API..."

# NodeJS 18
if ! command -v node &> /dev/null; then
    echo "   Instalando NodeJS 18..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Instalar PM2 global
echo "   Instalando PM2 global..."
sudo npm install -g pm2

TILE_API_DIR="/opt/tile-api"
echo "   Creando directorio: ${TILE_API_DIR}"
sudo mkdir -p $TILE_API_DIR
sudo chown ubuntu:ubuntu $TILE_API_DIR
cd $TILE_API_DIR

echo "   Directorio actual: $(pwd)"

# Crear package.json
echo "   Creando package.json..."
cat > package.json << 'EOF'
{
  "name": "tile-api",
  "version": "1.0.0",
  "description": "Vector tile server from PostGIS",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.0",
    "compression": "^1.7.4"
  }
}
EOF

# Verificar package.json
if [ -f "package.json" ]; then
    echo "   ✅ package.json creado"
else
    echo "❌ ERROR: No se pudo crear package.json"
    exit 1
fi

# Instalar dependencias
echo "   Instalando dependencias npm..."
npm install

if [ $? -eq 0 ]; then
    echo "   ✅ Dependencias instaladas correctamente"
else
    echo "❌ ERROR: Falló npm install"
    exit 1
fi

# Crear servidor con la consulta SQL CORREGIDA
echo "   Creando server.js..."
cat > server.js << 'EOF'
const express = require('express');
const { Pool } = require('pg');
const compression = require('compression');
const app = express();
const port = 3001;

app.use(compression());

const pool = new Pool({
    user: process.env.PGUSER || 'ubuntu',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'gis',
    password: process.env.PGPASSWORD || 'postgres',
    port: process.env.PGPORT || 5432,
    max: 5,
    idleTimeoutMillis: 30000
});

// Health check
app.get('/health', (req, res) => {
    pool.query('SELECT 1', (err) => {
        if (err) {
            res.status(500).json({ status: 'error', error: err.message });
        } else {
            res.json({ status: 'ok', timestamp: new Date() });
        }
    });
});

// Endpoint de tiles MVT (Nginx strip-ea /tiles/ → llega como /:z/:x/:y.mvt)
app.get('/:z/:x/:y.mvt', async (req, res) => {
    const { z, x, y } = req.params;
    
    if (z < 0 || z > 20 || x < 0 || y < 0) {
        return res.status(400).send('Invalid tile coordinates');
    }

    try {
        const result = await pool.query(`
            WITH 
            bounds AS (
                SELECT TileBBox($1::int, $2::int, $3::int, 3857) AS geom
            ),
            roads AS (
                SELECT
                    'roads' AS layer,
                    name,
                    highway AS class,
                    NULL::text AS type,
                    NULL::bigint AS osm_id,
                    ST_AsMVTGeom(
                        way,
                        (SELECT geom FROM bounds),
                        4096, 256, true
                    ) AS geom
                FROM planet_line, bounds
                WHERE 
                    ST_Intersects(way, bounds.geom)
                    AND highway IS NOT NULL
                    AND name IS NOT NULL
                    AND ($1::int >= 10 OR highway IN ('motorway', 'trunk', 'primary'))
            ),
            buildings AS (
                SELECT
                    'building' AS layer,
                    name,
                    NULL::text AS class,
                    building AS type,
                    osm_id,
                    ST_AsMVTGeom(
                        way,
                        (SELECT geom FROM bounds),
                        4096, 256, true
                    ) AS geom
                FROM planet_polygon, bounds
                WHERE
                    ST_Intersects(way, bounds.geom)
                    AND building IS NOT NULL
                    AND building != 'no'
                    AND $1::int >= 14
            ),
            landuse AS (
                SELECT
                    'landuse' AS layer,
                    NULL::text AS name,
                    NULL::text AS class,
                    landuse AS type,
                    NULL::bigint AS osm_id,
                    ST_AsMVTGeom(
                        way,
                        (SELECT geom FROM bounds),
                        4096, 256, true
                    ) AS geom
                FROM planet_polygon, bounds
                WHERE
                    ST_Intersects(way, bounds.geom)
                    AND landuse IS NOT NULL
                    AND $1::int >= 10
            ),
            places AS (
                SELECT
                    'place' AS layer,
                    name,
                    NULL::text AS class,
                    place AS type,
                    NULL::bigint AS osm_id,
                    ST_AsMVTGeom(
                        way,
                        (SELECT geom FROM bounds),
                        4096, 256, true
                    ) AS geom
                FROM planet_point, bounds
                WHERE
                    ST_Intersects(way, bounds.geom)
                    AND place IS NOT NULL
                    AND name IS NOT NULL
            ),
            all_features AS (
                SELECT * FROM roads
                UNION ALL
                SELECT * FROM buildings
                UNION ALL
                SELECT * FROM landuse
                UNION ALL
                SELECT * FROM places
            )
            SELECT ST_AsMVT(all_features.*, all_features.layer) AS mvt
            FROM all_features
            GROUP BY all_features.layer
        `, [z, x, y]);

        if (result.rows.length > 0) {
            const mvtBuffer = Buffer.concat(result.rows.map(row => row.mvt));
            res.set('Content-Type', 'application/x-protobuf');
            res.send(mvtBuffer);
        } else {
            res.set('Content-Type', 'application/x-protobuf');
            res.send(Buffer.from([]));
        }
    } catch (err) {
        console.error('Error generating tile:', err);
        res.status(500).send('Internal server error');
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Tile API listening at http://0.0.0.0:${port}`);
});
EOF

# Verificar server.js
if [ -f "server.js" ]; then
    echo "   ✅ server.js creado: $(wc -c < server.js) bytes"
else
    echo "❌ ERROR: No se pudo crear server.js"
    exit 1
fi

echo "✅ API de tiles creada exitosamente"

# ============================================
# PASO 8: INICIAR CON PM2
# ============================================
echo ""
echo "🚀 PASO 8: Iniciando API con PM2..."

cd $TILE_API_DIR

# Configurar variables de entorno para la API
export PGUSER=ubuntu
export PGPASSWORD=postgres
export PGDATABASE=gis
export PGHOST=localhost
export PGPORT=5432

# Detener instancia anterior si existe
pm2 stop tile-api 2>/dev/null || true
pm2 delete tile-api 2>/dev/null || true

# Liberar puerto
sudo fuser -k 3001/tcp 2>/dev/null || true
sleep 2

# Iniciar con PM2
echo "   Iniciando con PM2..."
pm2 start server.js --name tile-api --interpreter node --log-date-format "YYYY-MM-DD HH:mm:ss"
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu > /dev/null 2>&1 || true

# Verificar que inició
echo "   Esperando 5 segundos..."
sleep 5

if pm2 show tile-api | grep -q "online"; then
    echo "✅ API de tiles iniciada correctamente en puerto 3001"
    
    # Probar health check
    echo "   Probando health check..."
    if curl -s http://localhost:3001/health | grep -q "ok"; then
        echo "   ✅ Health check OK"
    else
        echo "   ⚠️ Health check no responde, pero el proceso está online"
    fi
else
    echo "❌ ERROR: La API no inició correctamente"
    pm2 logs tile-api --lines 30 --nostream
    exit 1
fi

# ============================================
# PASO 9: VERIFICACIÓN FINAL DEL TILE
# ============================================
echo ""
echo "🧪 PASO 9: Verificando generación de tiles..."

# Probar un tile específico (centro de Barranquilla)
echo "   Probando tile z=14 x=4787 y=7686..."
sleep 2

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/tiles/14/4787/7686.mvt)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Tile generado correctamente (HTTP 200)"
elif [ "$HTTP_CODE" = "204" ] || [ "$HTTP_CODE" = "304" ]; then
    echo "✅ Tile respondió correctamente (HTTP $HTTP_CODE)"
else
    echo "⚠️  El tile respondió con código HTTP $HTTP_CODE"
    echo "   Verificando logs para más detalles:"
    pm2 logs tile-api --lines 5 --nostream
fi

# ============================================
# RESUMEN FINAL
# ============================================
echo ""
echo "========================================="
echo "🎉 TILE SERVER INSTALADO EXITOSAMENTE"
echo "========================================="
echo ""
echo "📊 SERVICIOS:"
echo "   ✅ PostgreSQL: localhost:5432 (gis)"
echo "   ✅ Tile API: localhost:3001 (PM2: tile-api)"
echo ""
echo "🔗 ENDPOINTS LOCALES:"
echo "   - Tile MVT:  http://localhost:3001/tiles/{z}/{x}/{y}.mvt"
echo "   - Health:    http://localhost:3001/health"
echo ""
echo "📁 CAPAS DISPONIBLES:"
echo "   - roads (carreteras con nombre)"
echo "   - buildings (edificios)"
echo "   - landuse (uso de suelo)"
echo "   - places (lugares con nombre)"
echo ""
echo "🛠️ COMANDOS ÚTILES:"
echo "   - Logs:     pm2 logs tile-api"
echo "   - Restart:  pm2 restart tile-api"
echo "   - PostGIS:  PGPASSWORD=postgres psql -U ubuntu -d gis"
echo "========================================="