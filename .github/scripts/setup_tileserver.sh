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

PBF_SOURCE="/tmp/Geolocation.osm.pbf"
if [ ! -f "$PBF_SOURCE" ]; then
    echo "❌ ERROR: Archivo PBF no encontrado en ${PBF_SOURCE}"
    exit 1
fi
echo "✅ Archivo PBF encontrado: $(ls -lh $PBF_SOURCE | awk '{print $5}')"

# ============================================
# PASO 2: INSTALAR DEPENDENCIAS
# ============================================
echo ""
echo "📦 PASO 2: Instalando dependencias..."

# NodeJS 18
if ! command -v node &> /dev/null; then
    echo "   Instalando NodeJS 18..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# PostgreSQL y PostGIS
if ! command -v psql &> /dev/null; then
    echo "   Instalando PostgreSQL y PostGIS..."
    sudo apt-get update -qq
    sudo apt-get install -y postgresql postgresql-contrib postgis postgresql-15-postgis-3 \
                            osm2pgsql osmctools
fi

# Dependencias Node globales
sudo npm install -g pm2

echo "✅ Dependencias instaladas"

# ============================================
# PASO 3: CONFIGURAR POSTGRESQL
# ============================================
echo ""
echo "🐘 PASO 3: Configurando PostgreSQL..."

# Asegurar que PostgreSQL está corriendo
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Crear usuario y base de datos
sudo -u postgres psql -c "DROP DATABASE IF EXISTS gis;" 2>/dev/null || true
sudo -u postgres psql -c "DROP USER IF EXISTS ubuntu;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE USER ubuntu WITH SUPERUSER PASSWORD 'postgres';"
sudo -u postgres psql -c "CREATE DATABASE gis OWNER ubuntu;"
sudo -u postgres psql -d gis -c "CREATE EXTENSION IF NOT EXISTS postgis;"
sudo -u postgres psql -d gis -c "CREATE EXTENSION IF NOT EXISTS hstore;"

echo "✅ PostgreSQL configurado"

# ============================================
# PASO 4: IMPORTAR DATOS CON osm2pgsql
# ============================================
echo ""
echo "📥 PASO 4: Importando datos OSM a PostGIS..."
echo "   (Puede tardar 5-10 minutos con 3.7GB RAM)"

# Limpiar importaciones previas
rm -f /tmp/osm2pgsql.cache 2>/dev/null || true

# Usar caché en disco para ahorrar RAM
osm2pgsql \
    --create \
    --database gis \
    --username ubuntu \
    --host localhost \
    --port 5432 \
    --password \
    --prefix planet \
    --slim \
    --drop \
    --cache 500 \
    --number-processes 2 \
    --style /usr/share/osm2pgsql/default.style \
    --hstore \
    --multi-geometry \
    --input-reader pbf \
    "$PBF_SOURCE" <<EOF
postgres
EOF

if [ $? -ne 0 ]; then
    echo "❌ ERROR: Falló la importación con osm2pgsql"
    exit 1
fi
echo "✅ Datos OSM importados exitosamente"

# ============================================
# PASO 5: CREAR FUNCIÓN TILEBBOX
# ============================================
echo ""
echo "🔧 PASO 5: Creando función TileBBox..."

sudo -u postgres psql -d gis << 'EOF'
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

-- Crear índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_planet_line_way ON planet_osm_line USING GIST (way);
CREATE INDEX IF NOT EXISTS idx_planet_polygon_way ON planet_osm_polygon USING GIST (way);
CREATE INDEX IF NOT EXISTS idx_planet_line_highway ON planet_osm_line (highway) WHERE highway IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_planet_polygon_admin ON planet_osm_polygon (admin_level) WHERE admin_level IS NOT NULL;
EOF

echo "✅ Función TileBBox creada"

# ============================================
# PASO 6: CREAR API NODEJS
# ============================================
echo ""
echo "🌐 PASO 6: Creando API de tiles en NodeJS..."

TILE_API_DIR="/opt/tile-api"
sudo mkdir -p $TILE_API_DIR
sudo chown ubuntu:ubuntu $TILE_API_DIR
cd $TILE_API_DIR

# Crear package.json
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

# Instalar dependencias
npm install

# Crear servidor
cat > server.js << 'EOF'
const express = require('express');
const { Pool } = require('pg');
const compression = require('compression');
const app = express();
const port = 3001;

app.use(compression());

const pool = new Pool({
    user: 'ubuntu',
    host: 'localhost',
    database: 'gis',
    password: 'postgres',
    port: 5432,
    max: 5,
    idleTimeoutMillis: 30000
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

// Endpoint de tiles MVT
app.get('/tiles/:z/:x/:y.mvt', async (req, res) => {
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
                    'road' AS layer,
                    name,
                    highway AS class,
                    ST_AsMVTGeom(
                        way,
                        (SELECT geom FROM bounds),
                        4096, 256, true
                    ) AS geom
                FROM planet_osm_line, bounds
                WHERE 
                    ST_Intersects(way, bounds.geom)
                    AND highway IS NOT NULL
                    AND name IS NOT NULL
                    AND ($1::int >= 10 OR highway IN ('motorway', 'trunk', 'primary'))
            ),
            buildings AS (
                SELECT
                    'building' AS layer,
                    building AS type,
                    ST_AsMVTGeom(
                        way,
                        (SELECT geom FROM bounds),
                        4096, 256, true
                    ) AS geom
                FROM planet_osm_polygon, bounds
                WHERE 
                    ST_Intersects(way, bounds.geom)
                    AND building IS NOT NULL
                    AND building != 'no'
                    AND $1::int >= 14
            ),
            landuse AS (
                SELECT
                    'landuse' AS layer,
                    landuse AS type,
                    ST_AsMVTGeom(
                        way,
                        (SELECT geom FROM bounds),
                        4096, 256, true
                    ) AS geom
                FROM planet_osm_polygon, bounds
                WHERE 
                    ST_Intersects(way, bounds.geom)
                    AND landuse IS NOT NULL
                    AND $1::int >= 10
            ),
            places AS (
                SELECT
                    'place' AS layer,
                    name,
                    place AS type,
                    ST_AsMVTGeom(
                        way,
                        (SELECT geom FROM bounds),
                        4096, 256, true
                    ) AS geom
                FROM planet_osm_point, bounds
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
            res.set('Content-Encoding', 'gzip');
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

echo "✅ API de tiles creada"

# ============================================
# PASO 7: INICIAR CON PM2
# ============================================
echo ""
echo "🚀 PASO 7: Iniciando API con PM2..."

cd $TILE_API_DIR
pm2 stop tile-api 2>/dev/null || true
pm2 delete tile-api 2>/dev/null || true

# Liberar puerto
sudo fuser -k 3001/tcp 2>/dev/null || true
sleep 2

# Iniciar con PM2
pm2 start server.js --name tile-api --interpreter node --log-date-format "YYYY-MM-DD HH:mm:ss"
pm2 save

# Verificar que inició
sleep 5
if pm2 show tile-api | grep -q "online"; then
    echo "✅ API de tiles iniciada correctamente en puerto 3001"
else
    echo "❌ ERROR: La API no inició correctamente"
    pm2 logs tile-api --lines 50 --nostream
    exit 1
fi

# ============================================
# PASO 8: CONFIGURAR NGINX (si no existe el bloque)
# ============================================
echo ""
echo "🌐 PASO 8: Verificando configuración de Nginx..."

NGINX_CONF="/etc/nginx/sites-available/location-tracker"

# Verificar si ya existe el bloque /tiles/ en Nginx
if ! sudo grep -q "location /tiles/" ${NGINX_CONF}; then
    echo "   Agregando bloque /tiles/ a Nginx..."
    
    # Crear backup
    sudo cp ${NGINX_CONF} ${NGINX_CONF}.backup
    
    # Insertar bloque antes del último }
    sudo sed -i '/^}$/i \
    \
    # ===== TILE SERVER API =====\
    location /tiles/ {\
        rewrite ^/tiles/(.*) /$1 break;\
        proxy_pass http://localhost:3001;\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
        proxy_buffering off;\
        proxy_cache off;\
        expires epoch;\
        add_header Cache-Control "no-cache, no-store, must-revalidate";\
        add_header Pragma "no-cache";\
        add_header Expires "0";\
        add_header Access-Control-Allow-Origin "*" always;\
        add_header Access-Control-Allow-Methods "GET, OPTIONS" always;\
        add_header Access-Control-Allow-Headers "Range" always;\
    }\
    ' ${NGINX_CONF}
    
    # Verificar configuración
    if sudo nginx -t; then
        sudo systemctl reload nginx
        echo "✅ Nginx configurado correctamente"
    else
        echo "❌ Error en configuración de Nginx, restaurando backup..."
        sudo cp ${NGINX_CONF}.backup ${NGINX_CONF}
        sudo nginx -t
        exit 1
    fi
else
    echo "✅ Bloque /tiles/ ya existe en Nginx"
fi

# ============================================
# PASO 9: VERIFICACIÓN FINAL
# ============================================
echo ""
echo "🧪 PASO 9: Verificando tile server..."

MAX_RETRIES=15
RETRY=0
TILE_OK=false

while [ $RETRY -lt $MAX_RETRIES ]; do
    if curl -s -f http://localhost:3001/health > /dev/null 2>&1; then
        echo "✅ API de tiles responde en http://localhost:3001"
        TILE_OK=true
        break
    fi
    RETRY=$((RETRY+1))
    echo "   Intento ${RETRY}/${MAX_RETRIES}..."
    sleep 2
done

if [ "$TILE_OK" = false ]; then
    echo "❌ ERROR: API de tiles no responde"
    echo ""
    echo "📋 Logs de PM2:"
    pm2 logs tile-api --lines 30 --nostream
    exit 1
fi

# Probar un tile específico (centro de Barranquilla)
echo "   Probando tile z=14 x=4787 y=7686..."
TEST_TILE=$(curl -s -I http://localhost:3001/tiles/14/4787/7686.mvt 2>&1 | head -n 1)

if echo "$TEST_TILE" | grep -q "200\|304"; then
    echo "✅ Tile generado correctamente"
else
    echo "⚠️  Advertencia: El tile no respondió como se esperaba"
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
echo "   ✅ PostgreSQL/PostGIS: localhost:5432 (gis)"
echo "   ✅ Tile API: localhost:3001 (PM2: tile-api)"
echo "   ✅ Nginx: /tiles/ → http://localhost:3001"
echo ""
echo "🔗 ENDPOINTS:"
echo "   - Tile MVT:  https://tudominio.com/tiles/{z}/{x}/{y}.mvt"
echo "   - Health:    https://tudominio.com/tiles/health"
echo ""
echo "📁 DATOS IMPORTADOS:"
echo "   - Archivo: ${PBF_SOURCE}"
echo "   - Tablas: planet_osm_line, planet_osm_polygon, planet_osm_point"
echo "   - Capas: roads, buildings, landuse, places"
echo ""
echo "🛠️ COMANDOS ÚTILES:"
echo "   - Logs:     pm2 logs tile-api"
echo "   - Restart:  pm2 restart tile-api"
echo "   - Stop:     pm2 stop tile-api"
echo "   - PostGIS:  sudo -u postgres psql -d gis"
echo ""
echo "📊 USO EN TU APP FLASK:"
echo "   - En lugar de: /tiles/styles/tile/{z}/{x}/{y}.png"
echo "   - Usar:        /tiles/tiles/{z}/{x}/{y}.mvt"
echo "========================================="