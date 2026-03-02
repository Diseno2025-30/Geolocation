#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ TILE SERVER - VERSIÓN SIMPLE Y FUNCIONAL"
echo "🗺️ ========================================="
echo "🎯 Usando el script original de la imagen"
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

# Buscar el archivo PBF
PBF_FILE=""
for loc in "/tmp/Geolocation.osm.pbf" "/opt/tile-data/map.osm.pbf" "/home/ubuntu/Geolocation.osm.pbf"; do
    if [ -f "$loc" ]; then
        PBF_FILE="$loc"
        echo "✅ Encontrado: $loc"
        break
    fi
done

if [ -z "$PBF_FILE" ]; then
    echo "❌ No se encontró archivo PBF"
    exit 1
fi

# Crear directorio y copiar archivo
sudo mkdir -p ${TILE_DIR}
sudo chown $(whoami):$(whoami) ${TILE_DIR}
cp "$PBF_FILE" "${TILE_DIR}/map.osm.pbf"
TILE_PBF="${TILE_DIR}/map.osm.pbf"

echo "✅ Archivo listo: $(ls -lh $TILE_PBF)"
echo ""

# ========== IMPORTAR USANDO EL SCRIPT ORIGINAL ==========
echo ""
echo "📥 INICIANDO IMPORTACIÓN (usando script original)"
echo "   ⏱️  Tiempo estimado: 2-3 minutos"
echo ""

# Crear volumen
docker volume create ${TILE_VOLUME}

# IMPORTAR - usando el comando "import" de la imagen
echo "🚀 Ejecutando import..."
docker run -d \
    --name tile-import \
    --memory=1g \
    --cpus=1 \
    -v ${TILE_PBF}:/data/region.osm.pbf:ro \
    -v ${TILE_VOLUME}:/data/database/ \
    -e THREADS=1 \
    -e OSM2PGSQL_CACHE=512 \
    overv/openstreetmap-tile-server \
    import

# Monitorear
echo "📊 Monitoreando importación..."
echo ""

# Mostrar logs en tiempo real
docker logs -f tile-import &
LOGS_PID=$!

# Esperar a que termine
while docker ps -q -f name=tile-import | grep -q .; do
    sleep 2
done

# Matar proceso de logs
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

# Iniciar servidor en modo "run"
docker run -d \
    --name ${CONTAINER_NAME} \
    --restart unless-stopped \
    --memory=512m \
    --cpus=0.5 \
    -p 8080:80 \
    -p 5433:5432 \
    -v ${TILE_VOLUME}:/data/database/ \
    -e ALLOW_CORS=enabled \
    -e THREADS=1 \
    overv/openstreetmap-tile-server \
    run

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
echo ""
echo "🧪 PRUEBA RÁPIDA:"
echo "   curl -o test.png http://localhost:8080/tile/0/0/0.png"
echo "   file test.png  # Debería mostrar: PNG image data"
echo ""
echo "========================================"