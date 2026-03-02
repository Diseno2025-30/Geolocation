#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ TILE SERVER PARA c7i.flex-large (CORREGIDO)"
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

# ========== LIMPIEZA PROFUNDA DE DOCKER ==========
echo "🧹 LIMPIEZA PROFUNDA DE DOCKER..."
docker stop $(docker ps -a -q) 2>/dev/null || true
docker rm -f $(docker ps -a -q) 2>/dev/null || true

# Eliminar TODOS los volúmenes
echo "   Eliminando volúmenes..."
for vol in $(docker volume ls -q); do
    docker volume rm $vol 2>/dev/null || true
done

# Limpiar sistema Docker
echo "   Limpiando sistema Docker..."
docker system prune -a -f --volumes

# ========== VERIFICAR ARCHIVO PBF ==========
echo ""
echo "📥 VERIFICANDO ARCHIVO PBF"

# Buscar el archivo de 6.6MB
PBF_FILE=""
PBF_CANDIDATES=(
    "/tmp/Geolocation.osm.pbf"
    "/home/ubuntu/Geolocation.osm.pbf"
    "/opt/Geolocation.osm.pbf"
    "/tmp/Puerto_MAP.osm.pbf"
    "/opt/location-tracker/test/.github/osm/Geolocation.osm.pbf"
)

for file in "${PBF_CANDIDATES[@]}"; do
    if [ -f "$file" ]; then
        SIZE=$(ls -lh "$file" | awk '{print $5}')
        echo "✅ Encontrado: $file ($SIZE)"
        PBF_FILE="$file"
        break
    fi
done

if [ -z "$PBF_FILE" ]; then
    echo "❌ No se encontró archivo PBF"
    echo "   Por favor, sube tu archivo a /tmp/Geolocation.osm.pbf"
    exit 1
fi

# Crear directorio
sudo mkdir -p ${TILE_DIR}
sudo chown $(whoami):$(whoami) ${TILE_DIR}

# Copiar PBF
cp "$PBF_FILE" "${TILE_DIR}/map.osm.pbf"
TILE_PBF="${TILE_DIR}/map.osm.pbf"

echo "✅ Archivo listo: $(ls -lh $TILE_PBF)"
echo ""

# ========== VERIFICAR ESPACIO ==========
echo "💾 VERIFICANDO ESPACIO"
echo "📊 Espacio necesario estimado: 3GB"
DOCKER_SPACE=$(df -BG /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4}' | sed 's/G//' || echo "7")
echo "   Espacio disponible: ${DOCKER_SPACE}GB"
echo "✅ Espacio suficiente"
echo ""

# ========== CREAR SCRIPT DE IMPORTACIÓN CORREGIDO ==========
echo "📝 Creando script de importación corregido..."

cat > /tmp/import-corregido.sh << 'EOF'
#!/bin/bash
set -e

echo "📥 IMPORTANDO PBF PEQUEÑO (6.6MB)"
echo ""

# ===== CONFIGURAR POSTGRESQL CORRECTAMENTE =====
echo "🔄 Configurando PostgreSQL..."

# Crear el cluster de PostgreSQL si no existe
if [ ! -d /var/lib/postgresql/15/main ]; then
    echo "   Creando cluster PostgreSQL 15/main..."
    pg_createcluster 15 main --start
fi

# Iniciar PostgreSQL
service postgresql start
sleep 3

# Verificar que PostgreSQL está corriendo
if ! pg_isready -q; then
    echo "❌ PostgreSQL no está corriendo"
    exit 1
fi
echo "✅ PostgreSQL está activo"

# ===== CONFIGURAR BASE DE DATOS =====
echo "🔄 Configurando base de datos..."

# Crear usuario renderer si no existe
sudo -u postgres psql -c "CREATE USER renderer WITH PASSWORD 'renderer';" 2>/dev/null || true

# Crear base de datos gis
sudo -u postgres psql -c "CREATE DATABASE gis OWNER renderer;" 2>/dev/null || true

# Instalar extensiones
sudo -u postgres psql -d gis -c "CREATE EXTENSION IF NOT EXISTS postgis;"
sudo -u postgres psql -d gis -c "CREATE EXTENSION IF NOT EXISTS hstore;"

echo "✅ Base de datos configurada"

# ===== CONFIGURACIÓN POSTGRESQL OPTIMIZADA =====
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

# Reiniciar PostgreSQL
service postgresql restart
sleep 3

# ===== IMPORTAR DATOS =====
echo "🚀 Ejecutando import rápido..."
echo "   Esto tomará menos de 2 minutos..."

sudo -u renderer osm2pgsql \
    --create \
    --slim \
    --cache 64 \
    --number-processes 1 \
    --style /home/renderer/src/openstreetmap-carto/openstreetmap-carto.style \
    --multi-geometry \
    --hstore \
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

echo "✅ Todo listo"
EOF

chmod +x /tmp/import-corregido.sh

# ========== IMPORTAR ==========
echo ""
echo "📥 INICIANDO IMPORTACIÓN"
echo "   ⏱️  Tiempo estimado: < 2 minutos"
echo ""

# Crear volumen
docker volume create ${TILE_VOLUME}

# Importar con el script corregido
docker run -d \
    --name tile-import \
    --memory=1g \
    --cpus=1 \
    -v ${TILE_PBF}:/data/region.osm.pbf:ro \
    -v ${TILE_VOLUME}:/data/database/ \
    -v /tmp/import-corregido.sh:/tmp/import-corregido.sh:ro \
    --entrypoint /bin/bash \
    overv/openstreetmap-tile-server \
    -c 'bash /tmp/import-corregido.sh'

# Monitorear con más detalle
echo "📊 Monitoreando importación (mostrando logs en tiempo real)..."
echo ""

# Mostrar logs en tiempo real
docker logs -f tile-import &
LOGS_PID=$!

# Esperar a que termine
while docker ps -q -f name=tile-import | grep -q .; do
    sleep 2
done

# Matar el proceso de logs
kill $LOGS_PID 2>/dev/null || true

# Verificar resultado
IMPORT_EXIT=$(docker inspect tile-import --format='{{.State.ExitCode}}')
echo "Código de salida: $IMPORT_EXIT"

if [ "$IMPORT_EXIT" != "0" ]; then
    echo "❌ Error en importación"
    echo ""
    echo "📋 Últimas líneas del log:"
    docker logs --tail 30 tile-import
    exit 1
fi

docker rm tile-import
echo "✅ Importación completada"
echo ""

# ========== INICIAR SERVIDOR ==========
echo "🚀 INICIANDO SERVIDOR DE TILES"

# Configuración de renderd
cat > /tmp/renderd.conf << 'RENDERD'
[renderd]
num_threads=1
tile_dir=/var/lib/mod_tile

[mapnik]
plugins_dir=/usr/lib/mapnik/3.0/input
font_dir=/usr/share/fonts/truetype

[default]
URI=/tile/
TILEDIR=/var/lib/mod_tile
XML=/home/renderer/src/openstreetmap-carto/mapnik.xml
MINZOOM=0
MAXZOOM=18
RENDERD

# Iniciar servidor
docker run -d \
    --name ${CONTAINER_NAME} \
    --restart unless-stopped \
    --memory=512m \
    --cpus=0.5 \
    -p 8080:80 \
    -p 5433:5432 \
    -v ${TILE_VOLUME}:/data/database/ \
    -v /tmp/renderd.conf:/etc/renderd.conf:ro \
    -e ALLOW_CORS=enabled \
    -e THREADS=1 \
    overv/openstreetmap-tile-server \
    run

# ========== VERIFICAR ==========
echo ""
echo "🔍 Verificando servidor..."

sleep 10
MAX_RETRIES=20
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

# ========== VERIFICAR ESPACIO FINAL ==========
echo ""
echo "📊 ESPACIO OCUPADO:"
echo "   Volumen Docker: $(sudo du -sh /var/lib/docker/volumes/${TILE_VOLUME} 2>/dev/null | cut -f1 || echo '0')"
echo "   Tiles generados: $(docker exec ${CONTAINER_NAME} du -sh /var/lib/mod_tile 2>/dev/null | cut -f1 || echo '0')"

# ========== SERVICIO SYSTEMD ==========
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

# ========== SCRIPT DE MONITOREO ==========
cat > /home/ubuntu/monitor-tiles.sh << 'EOF'
#!/bin/bash
echo "📊 TILE SERVER - ESTADO"
echo "========================"
echo ""
echo "🔍 Contenedor:"
docker ps --filter "name=tile-server" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "📊 Recursos:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" tile-server
echo ""
echo "💾 Espacio:"
df -h / | grep -v Filesystem
echo ""
echo "🗺️  Tiles generados:"
docker exec tile-server find /var/lib/mod_tile -name "*.png" 2>/dev/null | wc -l | awk '{print "   " $1 " tiles"}'
echo ""
echo "📋 Últimos logs:"
docker logs --tail 5 tile-server 2>&1
EOF

chmod +x /home/ubuntu/monitor-tiles.sh

# ========== LIMPIEZA ==========
rm -f /tmp/import-corregido.sh
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
echo "📝 COMANDOS:"
echo "   - Ver logs: docker logs -f tile-server"
echo "   - Ver estado: ./monitor-tiles.sh"
echo "   - Entrar: docker exec -it tile-server bash"
echo ""
echo "🧪 PRUEBA:"
echo "   curl -o test.png http://localhost:8080/tile/0/0/0.png"
echo "========================================"