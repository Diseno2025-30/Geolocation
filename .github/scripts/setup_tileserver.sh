#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ INSTALACIÓN AUTOMÁTICA DE TILE SERVER"
echo "🗺️ ========================================="
echo "🎯 Modo silencioso - sin interacción"
echo ""

# ========== CONFIGURACIÓN FIJA ==========
TILE_DIR="/opt/tile-data"
TILE_VOLUME="openstreetmap-tile-data"
CONTAINER_NAME="tile-server"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="/tmp/tile-server-install-${TIMESTAMP}.log"

# Redirigir todo a log (útil para debugging)
exec > >(tee -a ${LOG_FILE}) 2>&1
echo "📝 Log guardado en: ${LOG_FILE}"

# ========== BUSCAR ARCHIVO PBF AUTOMÁTICAMENTE ==========
echo "📥 Buscando archivo PBF..."

# Ubicaciones posibles (ordenadas por prioridad)
PBF_LOCATIONS=(
    "/tmp/Geolocation.osm.pbf"
    "/home/ubuntu/Geolocation.osm.pbf"
    "/opt/location-tracker/test/.github/osm/Geolocation.osm.pbf"
    "/github/workspace/Geolocation.osm.pbf"  # Para GitHub Actions
    "/github/workspace/*.osm.pbf"            # Cualquier PBF en el workspace
)

PBF_FILE=""
for loc in "${PBF_LOCATIONS[@]}"; do
    # Expandir wildcards si existen
    for file in $loc; do
        if [ -f "$file" ]; then
            PBF_FILE="$file"
            echo "✅ Encontrado: $file ($(ls -lh $file | awk '{print $5}'))"
            break 2
        fi
    done
done

# Si no encuentra, buscar recursivamente
if [ -z "$PBF_FILE" ]; then
    echo "🔍 Buscando cualquier archivo .osm.pbf..."
    PBF_FILE=$(find / -name "*.osm.pbf" -type f 2>/dev/null | head -1)
    if [ -n "$PBF_FILE" ]; then
        echo "✅ Encontrado: $PBF_FILE ($(ls -lh $PBF_FILE | awk '{print $5}'))"
    fi
fi

# Si aún no hay archivo, descargar Barranquilla automáticamente
if [ -z "$PBF_FILE" ]; then
    echo "⚠️ No se encontró archivo PBF. Descargando Barranquilla automáticamente..."
    mkdir -p /tmp/barranquilla
    wget -q -O /tmp/barranquilla.osm.bz2 "https://overpass-api.de/api/map?bbox=-74.9,10.9,-74.7,11.1"
    echo "   Convirtiendo a PBF..."
    osmconvert /tmp/barranquilla.osm.bz2 -o=/tmp/barranquilla.osm.pbf
    PBF_FILE="/tmp/barranquilla.osm.pbf"
    rm -f /tmp/barranquilla.osm.bz2
    echo "✅ Descarga completada: $(ls -lh $PBF_FILE | awk '{print $5}')"
fi

# Preparar directorio
sudo mkdir -p ${TILE_DIR}
sudo chown $(whoami):$(whoami) ${TILE_DIR}
cp "$PBF_FILE" "${TILE_DIR}/map.osm.pbf"
TILE_PBF="${TILE_DIR}/map.osm.pbf"
echo "✅ Archivo listo en: ${TILE_PBF}"
echo ""

# ========== CREAR SCRIPT DE IMPORTACIÓN SIN WATER POLYGONS ==========
cat > /tmp/import-auto.sh << 'EOF'
#!/bin/bash
set -e

echo "📥 IMPORTANDO MAPA AUTOMÁTICAMENTE"

# Iniciar PostgreSQL
service postgresql start
sleep 3

# Configurar base de datos
sudo -u postgres psql -c "CREATE USER renderer WITH PASSWORD 'renderer';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE gis OWNER renderer;" 2>/dev/null || true
sudo -u postgres psql -d gis -c "CREATE EXTENSION postgis;"
sudo -u postgres psql -d gis -c "CREATE EXTENSION hstore;"

# Deshabilitar water polygons
cd /data/style/
echo "# No external data" > /data/style/external-data.yml
echo "tables: {}" >> /data/style/external-data.yml

# Generar mapnik.xml
carto project.mml > /data/style/mapnik.xml

# Importar
echo "🚀 Importando $(ls -lh /data/region.osm.pbf | awk '{print $5}')..."
sudo -u renderer osm2pgsql \
    --create \
    --slim \
    --cache 512 \
    --number-processes 1 \
    --style /data/style/openstreetmap-carto.style \
    --multi-geometry \
    --hstore \
    --tag-transform-script /data/style/openstreetmap-carto.lua \
    -d gis \
    -U renderer \
    -H /var/run/postgresql \
    /data/region.osm.pbf

# Índices básicos
sudo -u postgres psql -d gis -c "CREATE INDEX IF NOT EXISTS idx_planet_osm_polygon_way ON planet_osm_polygon USING gist(way);"
sudo -u postgres psql -d gis -c "CREATE INDEX IF NOT EXISTS idx_planet_osm_line_way ON planet_osm_line USING gist(way);"
sudo -u postgres psql -d gis -c "CREATE INDEX IF NOT EXISTS idx_planet_osm_point_way ON planet_osm_point USING gist(way);"

echo "✅ Importación completada"
EOF

chmod +x /tmp/import-auto.sh

# ========== CONFIGURACIÓN RENDERD ==========
cat > /tmp/renderd-auto.conf << 'RENDERD'
[renderd]
num_threads=1
tile_dir=/var/lib/mod_tile

[mapnik]
plugins_dir=/usr/lib/mapnik/3.0/input
font_dir=/usr/share/fonts/truetype

[default]
URI=/tile/
TILEDIR=/var/lib/mod_tile
XML=/data/style/mapnik.xml
MINZOOM=0
MAXZOOM=18
RENDERD

# ========== IMPORTAR ==========
echo "📥 Iniciando importación (tiempo estimado: 2-3 minutos)..."

# Crear volumen
docker volume create ${TILE_VOLUME} > /dev/null

# Ejecutar import
docker run -d \
    --name tile-import \
    --memory=1g \
    --cpus=1 \
    -v ${TILE_PBF}:/data/region.osm.pbf:ro \
    -v ${TILE_VOLUME}:/data/database/ \
    -v /tmp/import-auto.sh:/tmp/import-auto.sh:ro \
    --entrypoint /bin/bash \
    overv/openstreetmap-tile-server \
    -c "bash /tmp/import-auto.sh"

# Esperar sin logs (modo silencioso)
echo "   Procesando..."
while docker ps -q -f name=tile-import | grep -q .; do
    sleep 5
done

# Verificar
IMPORT_EXIT=$(docker inspect tile-import --format='{{.State.ExitCode}}')
if [ "$IMPORT_EXIT" != "0" ]; then
    echo "❌ Error en importación (código: $IMPORT_EXIT)"
    docker logs --tail 20 tile-import
    exit 1
fi

docker rm tile-import > /dev/null
echo "✅ Importación completada"
echo ""

# ========== INICIAR SERVIDOR ==========
echo "🚀 Iniciando servidor de tiles..."

# Detener servidor anterior si existe
docker stop ${CONTAINER_NAME} 2>/dev/null || true
docker rm ${CONTAINER_NAME} 2>/dev/null || true

# Iniciar nuevo
docker run -d \
    --name ${CONTAINER_NAME} \
    --restart unless-stopped \
    --memory=512m \
    --cpus=0.5 \
    -p 8080:80 \
    -p 5433:5432 \
    -v ${TILE_VOLUME}:/data/database/ \
    -v /tmp/renderd-auto.conf:/etc/renderd.conf:ro \
    -e ALLOW_CORS=enabled \
    -e THREADS=1 \
    overv/openstreetmap-tile-server \
    run

# ========== VERIFICACIÓN RÁPIDA ==========
echo "🔍 Verificando instalación..."
sleep 10

# Probar servidor web
if curl -s -f -o /dev/null "http://localhost:8080/" 2>/dev/null; then
    echo "✅ Servidor web respondiendo"
    
    # Probar tile
    if curl -s -f -o /tmp/test.png "http://localhost:8080/tile/0/0/0.png" 2>/dev/null; then
        echo "✅ Tile generado correctamente"
        rm -f /tmp/test.png
    fi
else
    echo "⚠️ El servidor está iniciando (puede tomar 1-2 minutos)"
fi

# ========== CONFIGURAR SERVICIO SYSTEMD ==========
echo "🔧 Configurando servicio automático..."

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

sudo systemctl daemon-reload > /dev/null
sudo systemctl enable tileserver > /dev/null

# ========== LIMPIEZA ==========
rm -f /tmp/import-auto.sh
rm -f /tmp/renderd-auto.conf

# ========== RESUMEN FINAL ==========
echo ""
echo "========================================="
echo "✅ TILE SERVER INSTALADO AUTOMÁTICAMENTE"
echo "========================================="
echo "📊 INFORMACIÓN:"
echo "   - Puerto tiles: 8080"
echo "   - Puerto PostGIS: 5433"
echo "   - Archivo: $(basename $TILE_PBF) ($(ls -lh $TILE_PBF | awk '{print $5}'))"
echo "   - Log: ${LOG_FILE}"
echo ""
echo "🔗 ENDPOINTS:"
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "localhost")
echo "   - Tiles: http://${PUBLIC_IP}:8080/tile/{z}/{x}/{y}.png"
echo ""
echo "📝 COMANDOS ÚTILES (para debugging manual):"
echo "   docker logs tile-server"
echo "   docker ps | grep tile-server"
echo "========================================="