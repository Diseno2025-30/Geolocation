#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ TILE SERVER PARA c7i.flex-large (FINAL)"
echo "🗺️ ========================================="
echo "🎯 Usando PBF existente de 6.6MB"
echo ""

# ========== CONFIGURACIÓN ==========
TILE_DIR="/opt/tile-data"
TILE_VOLUME="openstreetmap-tile-data"
CONTAINER_NAME="tile-server"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="/tmp/tile-server-install-${TIMESTAMP}.log"

exec > >(tee -a ${LOG_FILE}) 2>&1
echo "📝 Log guardado en: ${LOG_FILE}"
echo ""

# ========== LIMPIEZA ==========
echo "🧹 LIMPIEZA DE DOCKER..."
docker stop $(docker ps -a -q) 2>/dev/null || true
docker rm -f $(docker ps -a -q) 2>/dev/null || true
docker volume prune -f 2>/dev/null || true
docker system prune -f 2>/dev/null || true

# ========== VERIFICAR ARCHIVO PBF ==========
echo ""
echo "📥 VERIFICANDO ARCHIVO PBF"

PBF_FILE="/tmp/Geolocation.osm.pbf"
if [ ! -f "$PBF_FILE" ]; then
    echo "❌ No se encontró archivo PBF en /tmp/Geolocation.osm.pbf"
    exit 1
fi

SIZE=$(ls -lh "$PBF_FILE" | awk '{print $5}')
echo "✅ Encontrado: $PBF_FILE ($SIZE)"

sudo mkdir -p ${TILE_DIR}
sudo chown $(whoami):$(whoami) ${TILE_DIR}
cp "$PBF_FILE" "${TILE_DIR}/map.osm.pbf"
TILE_PBF="${TILE_DIR}/map.osm.pbf"
echo "✅ Archivo listo: $(ls -lh $TILE_PBF)"
echo ""

# ========== CREAR SCRIPT DE IMPORTACIÓN COMPLETO ==========
echo "📝 Creando script de importación completo..."

cat > /tmp/import-completo.sh << 'EOF'
#!/bin/bash
set -e

echo "📥 IMPORTANDO PBF CON ESTILO COMPLETO"
echo ""

# ===== CONFIGURAR POSTGRESQL =====
echo "🔄 Configurando PostgreSQL..."

# Iniciar PostgreSQL
service postgresql start
sleep 3

# Verificar PostgreSQL
if ! pg_isready -q; then
    echo "❌ PostgreSQL no está corriendo"
    exit 1
fi
echo "✅ PostgreSQL activo"

# ===== CONFIGURAR BASE DE DATOS =====
echo "🔄 Configurando base de datos..."

# Crear usuario renderer
sudo -u postgres psql -c "CREATE USER renderer WITH PASSWORD 'renderer';" 2>/dev/null || true

# Crear base de datos gis
sudo -u postgres psql -c "CREATE DATABASE gis OWNER renderer;" 2>/dev/null || true

# Instalar extensiones
sudo -u postgres psql -d gis -c "CREATE EXTENSION IF NOT EXISTS postgis;"
sudo -u postgres psql -d gis -c "CREATE EXTENSION IF NOT EXISTS hstore;"
sudo -u postgres psql -d gis -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

echo "✅ Base de datos configurada"

# ===== CONFIGURAR ESTILO OPENSTREETMAP-CARTO =====
echo "🔄 Configurando estilo openstreetmap-carto..."

# Clonar repositorio si no existe
if [ ! -d "/home/renderer/src/openstreetmap-carto" ]; then
    echo "   Clonando openstreetmap-carto..."
    mkdir -p /home/renderer/src
    cd /home/renderer/src
    git clone https://github.com/gravitystorm/openstreetmap-carto.git
fi

cd /home/renderer/src/openstreetmap-carto

# Script para descargar shapefiles si es necesario
if [ ! -f "/home/renderer/src/openstreetmap-carto/data" ]; then
    echo "   Descargando shapefiles (esto puede tomar un minuto)..."
    ./scripts/get-shapefiles.py || true
fi

# Verificar que los archivos de estilo existen
if [ ! -f "/home/renderer/src/openstreetmap-carto/openstreetmap-carto.style" ]; then
    echo "❌ No se encontró archivo de estilo"
    exit 1
fi

echo "✅ Estilo configurado"

# ===== CONFIGURACIÓN POSTGRESQL =====
cat > /etc/postgresql/15/main/postgresql.conf << 'PGEOF'
listen_addresses = 'localhost'
port = 5432
max_connections = 10
shared_buffers = 128MB
work_mem = 4MB
maintenance_work_mem = 64MB
wal_level = minimal
fsync = off
synchronous_commit = off
full_page_writes = off
checkpoint_timeout = 15min
PGEOF

cat > /etc/postgresql/15/main/pg_hba.conf << 'PGAUTH'
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
PGAUTH

service postgresql restart
sleep 3

# ===== IMPORTAR DATOS =====
echo ""
echo "🚀 Ejecutando import con estilo completo..."
echo "   Usando archivo: /data/region.osm.pbf"
echo "   Tamaño: $(ls -lh /data/region.osm.pbf | awk '{print $5}')"
echo ""

# Usar el archivo de estilo correcto
sudo -u renderer osm2pgsql \
    --create \
    --slim \
    --cache 64 \
    --number-processes 1 \
    --style /home/renderer/src/openstreetmap-carto/openstreetmap-carto.style \
    --multi-geometry \
    --hstore \
    --tag-transform-script /home/renderer/src/openstreetmap-carto/openstreetmap-carto.lua \
    -d gis \
    -U renderer \
    -H /var/run/postgresql \
    /data/region.osm.pbf

IMPORT_EXIT=$?

if [ $IMPORT_EXIT -ne 0 ]; then
    echo "❌ Error en importación"
    tail -20 /var/log/postgresql/postgresql-15-main.log
    exit $IMPORT_EXIT
fi

echo "✅ Import completado exitosamente"

# ===== OPTIMIZAR =====
echo "📊 Optimizando base de datos..."
sudo -u postgres psql -d gis -c "VACUUM ANALYZE;"

# Crear índices básicos
echo "🔧 Creando índices..."
sudo -u postgres psql -d gis -c "CREATE INDEX IF NOT EXISTS idx_planet_osm_polygon_way ON planet_osm_polygon USING gist(way);"
sudo -u postgres psql -d gis -c "CREATE INDEX IF NOT EXISTS idx_planet_osm_line_way ON planet_osm_line USING gist(way);"
sudo -u postgres psql -d gis -c "CREATE INDEX IF NOT EXISTS idx_planet_osm_point_way ON planet_osm_point USING gist(way);"

echo "✅ Importación completada exitosamente"
EOF

chmod +x /tmp/import-completo.sh

# ========== CREAR SCRIPT DE INICIO ==========
cat > /tmp/start-server.sh << 'EOF'
#!/bin/bash
set -e

echo "🚀 INICIANDO SERVIDOR DE TILES"

# Asegurar que PostgreSQL está corriendo
service postgresql start

# Iniciar renderd
/usr/bin/renderd -c /etc/renderd.conf

# Iniciar apache en foreground
apache2ctl -D FOREGROUND
EOF

chmod +x /tmp/start-server.sh

# ========== CREAR CONFIGURACIÓN RENDERD ==========
cat > /tmp/renderd.conf << 'RENDERD'
[renderd]
socketname=/run/renderd/renderd.sock
num_threads=1
tile_dir=/var/lib/mod_tile

[mapnik]
plugins_dir=/usr/lib/mapnik/3.0/input
font_dir=/usr/share/fonts/truetype
font_dir_recurse=true

[default]
URI=/tile/
TILEDIR=/var/lib/mod_tile
XML=/home/renderer/src/openstreetmap-carto/mapnik.xml
HOST=localhost
MINZOOM=0
MAXZOOM=18
TILESIZE=256
RENDERD

# ========== IMPORTAR ==========
echo ""
echo "📥 INICIANDO IMPORTACIÓN COMPLETA"
echo "   ⏱️  Tiempo estimado: 3-5 minutos"
echo ""

# Crear volumen
docker volume create ${TILE_VOLUME}

# Ejecutar import
docker run -d \
    --name tile-import \
    --memory=1g \
    --cpus=1 \
    -v ${TILE_PBF}:/data/region.osm.pbf:ro \
    -v ${TILE_VOLUME}:/data/database/ \
    -v /tmp/import-completo.sh:/tmp/import-completo.sh:ro \
    --entrypoint /bin/bash \
    overv/openstreetmap-tile-server \
    -c 'bash /tmp/import-completo.sh'

# Monitorear
echo "📊 Monitoreando importación (mostrando logs en tiempo real)..."
docker logs -f tile-import &
LOGS_PID=$!

# Esperar
while docker ps -q -f name=tile-import | grep -q .; do
    sleep 2
done

kill $LOGS_PID 2>/dev/null || true

# Verificar resultado
IMPORT_EXIT=$(docker inspect tile-import --format='{{.State.ExitCode}}')
echo "Código de salida: $IMPORT_EXIT"

if [ "$IMPORT_EXIT" != "0" ]; then
    echo "❌ Error en importación"
    docker logs --tail 30 tile-import
    exit 1
fi

docker rm tile-import
echo "✅ Importación completada"
echo ""

# ========== INICIAR SERVIDOR ==========
echo "🚀 INICIANDO SERVIDOR DE TILES"

# Detener servidor anterior si existe
docker stop ${CONTAINER_NAME} 2>/dev/null || true
docker rm ${CONTAINER_NAME} 2>/dev/null || true

# Iniciar nuevo servidor
docker run -d \
    --name ${CONTAINER_NAME} \
    --restart unless-stopped \
    --memory=512m \
    --cpus=0.5 \
    -p 8080:80 \
    -p 5433:5432 \
    -v ${TILE_VOLUME}:/data/database/ \
    -v /tmp/renderd.conf:/etc/renderd.conf:ro \
    -v /tmp/start-server.sh:/tmp/start-server.sh:ro \
    -e ALLOW_CORS=enabled \
    -e THREADS=1 \
    --entrypoint /bin/bash \
    overv/openstreetmap-tile-server \
    -c 'bash /tmp/start-server.sh'

# ========== VERIFICAR ==========
echo ""
echo "🔍 Verificando servidor..."

sleep 10
MAX_RETRIES=30
for i in $(seq 1 $MAX_RETRIES); do
    if curl -s -f -o /dev/null "http://localhost:8080/" 2>/dev/null; then
        echo "✅ Servidor web OK"
        
        # Probar tile
        if curl -s -f -o /tmp/test.png "http://localhost:8080/tile/0/0/0.png" 2>/dev/null; then
            echo "✅ Tile generado correctamente"
            echo "   Tamaño del tile: $(ls -lh /tmp/test.png | awk '{print $5}')"
            break
        fi
    fi
    
    echo "   Esperando... ($i/$MAX_RETRIES)"
    sleep 3
done

# ========== CONFIGURAR SERVICIO ==========
echo ""
echo "🔧 Configurando servicio systemd..."

sudo tee /etc/systemd/system/tileserver.service > /dev/null << EOF
[Unit]
Description=OpenStreetMap Tile Server
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=$(whoami)
Restart=always
RestartSec=10
ExecStart=/usr/bin/docker start -a ${CONTAINER_NAME}
ExecStop=/usr/bin/docker stop ${CONTAINER_NAME}

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable tileserver

# ========== LIMPIEZA ==========
rm -f /tmp/import-completo.sh
rm -f /tmp/start-server.sh
rm -f /tmp/renderd.conf
rm -f /tmp/test.png

# ========== RESUMEN ==========
echo ""
echo "========================================="
echo "🎉 TILE SERVER LISTO"
echo "========================================="
echo ""

PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "localhost")

echo "📊 INFO:"
echo "   - Puerto tiles: 8080"
echo "   - Puerto PostGIS: 5433"
echo "   - PBF usado: $(ls -lh $TILE_PBF | awk '{print $5}')"
echo "   - Log: ${LOG_FILE}"
echo ""
echo "🔗 ENDPOINTS:"
echo "   - Servidor: http://${PUBLIC_IP}:8080"
echo "   - Tiles: http://${PUBLIC_IP}:8080/tile/{z}/{x}/{y}.png"
echo "   - PostGIS: postgresql://renderer@${PUBLIC_IP}:5433/gis"
echo ""
echo "📝 COMANDOS ÚTILES:"
echo "   - Ver logs: docker logs -f tile-server"
echo "   - Ver estado: docker ps | grep tile-server"
echo "   - Entrar: docker exec -it tile-server bash"
echo "   - Detener: docker stop tile-server"
echo "   - Iniciar: docker start tile-server"
echo ""
echo "🧪 PRUEBA RÁPIDA:"
echo "   curl -o test.png http://localhost:8080/tile/0/0/0.png"
echo "   file test.png  # Debería mostrar: PNG image data"
echo ""
echo "========================================"