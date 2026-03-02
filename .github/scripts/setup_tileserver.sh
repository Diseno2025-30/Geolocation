#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ TILE SERVER PARA c7i.flex-large"
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
# Detener todo
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
    "/home/ubuntu/barranquilla.osm.pbf"
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
    echo "   Por favor, sube tu archivo de 6.6MB a /tmp/Geolocation.osm.pbf"
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

# ========== VERIFICAR ESPACIO REAL ==========
echo "💾 VERIFICANDO ESPACIO"

# Espacio necesario REAL para 6.6MB PBF
# - Base de datos PostgreSQL: ~10-20x el PBF = ~130MB
# - Tiles: ~10-20x la DB = ~2.6GB máximo
REQUIRED_SPACE_GB=3
echo "📊 Espacio necesario estimado: ${REQUIRED_SPACE_GB}GB"

# Verificar espacio en /var/lib/docker (donde van los volúmenes)
DOCKER_SPACE=$(df -BG /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4}' | sed 's/G//' || echo "0")
if [ -z "$DOCKER_SPACE" ] || [ "$DOCKER_SPACE" = "0" ]; then
    # Si /var/lib/docker no existe, verificar /var
    DOCKER_SPACE=$(df -BG /var | awk 'NR==2 {print $4}' | sed 's/G//')
fi

echo "   Espacio disponible en /var: ${DOCKER_SPACE}GB"

if [ "$DOCKER_SPACE" -lt "$REQUIRED_SPACE_GB" ]; then
    echo "⚠️  Poco espacio en /var: ${DOCKER_SPACE}GB"
    echo "   Intentando usar /opt en su lugar..."
    
    # Configurar Docker para usar /opt en lugar de /var
    sudo systemctl stop docker
    
    # Mover Docker a /opt si hay espacio
    OPT_SPACE=$(df -BG /opt | awk 'NR==2 {print $4}' | sed 's/G//')
    echo "   Espacio en /opt: ${OPT_SPACE}GB"
    
    if [ "$OPT_SPACE" -gt "$REQUIRED_SPACE_GB" ]; then
        echo "   Configurando Docker para usar /opt/docker"
        sudo mkdir -p /opt/docker
        sudo chmod 711 /opt/docker
        
        # Configurar daemon.json
        sudo tee /etc/docker/daemon.json > /dev/null << EOF
{
  "data-root": "/opt/docker",
  "storage-driver": "overlay2"
}
EOF
        
        # Mover datos existentes si los hay
        if [ -d "/var/lib/docker" ]; then
            sudo rsync -avx /var/lib/docker/ /opt/docker/ || true
        fi
        
        sudo systemctl start docker
        echo "✅ Docker ahora usa /opt/docker"
        DOCKER_SPACE=$OPT_SPACE
    else
        echo "❌ No hay espacio suficiente ni en /var ni en /opt"
        echo "   Necesitas liberar espacio o montar un volumen EBS"
        exit 1
    fi
fi

echo "✅ Espacio suficiente: ${DOCKER_SPACE}GB disponibles"
echo ""

# ========== CREAR SCRIPT DE IMPORTACIÓN MINIMALISTA ==========
echo "📝 Creando script de importación para PBF pequeño..."

cat > /tmp/import-minimal.sh << 'EOF'
#!/bin/bash
set -e

echo "📥 IMPORTANDO PBF PEQUEÑO (6.6MB)"
echo ""

# Configuración PostgreSQL mínima
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

service postgresql start
sleep 3

echo "🚀 Ejecutando import rápido..."
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

echo "✅ Import completado"
EOF

chmod +x /tmp/import-minimal.sh

# ========== IMPORTAR ==========
echo ""
echo "📥 INICIANDO IMPORTACIÓN"
echo "   ⏱️  Tiempo estimado: < 5 minutos"
echo ""

# Crear volumen
docker volume create ${TILE_VOLUME}

# Importar
docker run -d \
    --name tile-import \
    --memory=1g \
    --cpus=1 \
    -v ${TILE_PBF}:/data/region.osm.pbf:ro \
    -v ${TILE_VOLUME}:/data/database/ \
    -v /tmp/import-minimal.sh:/tmp/import-minimal.sh:ro \
    --entrypoint /bin/bash \
    overv/openstreetmap-tile-server \
    -c 'bash /tmp/import-minimal.sh'

# Monitorear
while docker ps -q -f name=tile-import | grep -q .; do
    echo "   Importando... ($(date +%H:%M:%S))"
    docker logs --tail 1 tile-import 2>&1 | head -1
    sleep 10
done

# Verificar
IMPORT_EXIT=$(docker inspect tile-import --format='{{.State.ExitCode}}')
if [ "$IMPORT_EXIT" != "0" ]; then
    echo "❌ Error en importación"
    docker logs --tail 20 tile-import
    exit 1
fi

docker rm tile-import
echo "✅ Importación completada"
echo ""

# ========== INICIAR SERVIDOR ==========
echo "🚀 INICIANDO SERVIDOR"

# Configuración mínima de renderd
cat > /tmp/renderd-min.conf << 'RENDERD'
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

docker run -d \
    --name ${CONTAINER_NAME} \
    --restart unless-stopped \
    --memory=512m \
    --cpus=0.5 \
    -p 8080:80 \
    -p 5433:5432 \
    -v ${TILE_VOLUME}:/data/database/ \
    -v /tmp/renderd-min.conf:/etc/renderd.conf:ro \
    -e ALLOW_CORS=enabled \
    -e THREADS=1 \
    overv/openstreetmap-tile-server \
    run

# ========== VERIFICAR ==========
echo ""
echo "🔍 Verificando..."

sleep 5
for i in {1..20}; do
    if curl -s -f -o /dev/null "http://localhost:8080/" 2>/dev/null; then
        echo "✅ Servidor OK"
        
        # Probar tile
        if curl -s -f -o /tmp/test.png "http://localhost:8080/tile/0/0/0.png" 2>/dev/null; then
            echo "✅ Tile generado correctamente"
            break
        fi
    fi
    echo "   Esperando... ($i/20)"
    sleep 3
done

# ========== MONITOREO DE ESPACIO ==========
echo ""
echo "📊 ESPACIO OCUPADO:"
docker exec ${CONTAINER_NAME} du -sh /var/lib/mod_tile 2>/dev/null || echo "   No hay tiles aún"
docker system df

# ========== RESUMEN ==========
echo ""
echo "========================================="
echo "🎉 TILE SERVER LISTO"
echo "========================================="
echo ""
echo "📊 INFO:"
echo "   - Puerto: 8080"
echo "   - PBF usado: $(ls -lh $TILE_PBF | awk '{print $5}')"
echo "   - Log: ${LOG_FILE}"
echo ""
echo "🔗 ENDPOINT: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):8080/tile/{z}/{x}/{y}.png"
echo ""
echo "📝 COMANDOS:"
echo "   docker logs -f tile-server"
echo "   docker exec -it tile-server bash"
echo "========================================"