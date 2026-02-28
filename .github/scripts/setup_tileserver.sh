#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ CONFIGURANDO TILE SERVER - BARRANQUILLA COMPLETA"
echo "🗺️ ========================================="

TILE_DIR="/opt/tile-data"
TILE_PBF="${TILE_DIR}/barranquilla-completo.osm.pbf"
TILE_VOLUME="openstreetmap-tile-data"
CONTAINER_NAME="tile-server"

echo "🎯 Objetivo: Mapa completo para tiles (edificios, agua, landuse, etc.)"

# ========== VERIFICAR SI YA ESTÁ FUNCIONANDO ==========

if docker ps 2>/dev/null | grep -q ${CONTAINER_NAME}; then
  echo "🔍 Tile server ya está corriendo, verificando..."
  if curl -s -f -o /dev/null "http://localhost:8080/tile/13/4541/3633.png" 2>/dev/null; then
    echo "✅ Tile server responde correctamente - saltando reinstalación"
    exit 0
  else
    echo "⚠️ Tile server no responde, reinstalando..."
    docker update --restart=no ${CONTAINER_NAME} 2>/dev/null || true
    docker stop ${CONTAINER_NAME} 2>/dev/null || true
    docker rm ${CONTAINER_NAME} 2>/dev/null || true
  fi
fi

# ========== INSTALAR DEPENDENCIAS ==========

echo "📦 Verificando dependencias..."

if ! command -v docker &> /dev/null; then
  echo "❌ Error: Docker no está instalado"
  exit 1
fi

echo "✅ Dependencias listas"

# ========== CONFIGURAR DIRECTORIOS ==========

CURRENT_USER=$(whoami)
sudo mkdir -p ${TILE_DIR}
sudo chown ${CURRENT_USER}:${CURRENT_USER} ${TILE_DIR}
cd ${TILE_DIR}

# ========== LIMPIAR INSTALACIÓN ANTERIOR ==========

echo "🧹 Limpiando instalación anterior..."

docker update --restart=no ${CONTAINER_NAME} 2>/dev/null || true
docker update --restart=no tile-import 2>/dev/null || true
docker stop ${CONTAINER_NAME} 2>/dev/null || true
docker stop tile-import 2>/dev/null || true
docker rm -f ${CONTAINER_NAME} 2>/dev/null || true
docker rm -f tile-import 2>/dev/null || true

rm -f ${TILE_DIR}/barranquilla-completo.*
docker volume rm ${TILE_VOLUME} 2>/dev/null || true

echo "🔄 Eliminando imagen vieja del tile server..."
docker image rm overv/openstreetmap-tile-server 2>/dev/null || true
echo "📥 Descargando imagen fresca del tile server..."
docker pull overv/openstreetmap-tile-server
echo "✅ Limpieza completada"

# ========== USAR ARCHIVO LOCAL ==========

LOCAL_OSM_FILE="/tmp/Geolocation.osm.pbf"
if [ ! -f "$LOCAL_OSM_FILE" ]; then
    echo "❌ ERROR: Archivo local no encontrado: $LOCAL_OSM_FILE"
    exit 1
fi

cp "$LOCAL_OSM_FILE" "${TILE_PBF}"
echo "✅ Archivo PBF copiado: $(ls -lh ${TILE_PBF} | awk '{print $5}')"

# ========== CONFIGURAR SWAP ==========

if [ -f /swapfile ]; then
  swapon --show | grep -q /swapfile || sudo swapon /swapfile 2>/dev/null || true
  echo "✅ Swap activo"
else
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo "✅ Swap 2GB creado y activado"
fi
free -h

# ========== PREPARAR ARCHIVOS DE CONFIGURACIÓN ==========

echo "📝 Preparando archivos de configuración..."

cat > /tmp/pg-custom.conf << 'PGCONF'
shared_buffers = 32MB
min_wal_size = 256MB
max_wal_size = 512MB
maintenance_work_mem = 32MB
max_connections = 20
temp_buffers = 8MB
work_mem = 16MB
wal_buffers = 256kB
wal_writer_delay = 500ms
commit_delay = 10000
random_page_cost = 1.1
track_activity_query_size = 16384
autovacuum_vacuum_scale_factor = 0.05
autovacuum_analyze_scale_factor = 0.02
listen_addresses = '*'
autovacuum = on
PGCONF

cat > /tmp/pg-hba.conf << 'HBACONF'
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
HBACONF

sudo rm -rf /tmp/renderd-run
mkdir -p /tmp/renderd-run
chmod 777 /tmp/renderd-run

# Script que arranca PostgreSQL, crea permisos necesarios y luego corre el import normal
cat > /tmp/custom-init.sh << 'EOF'
#!/bin/bash

# Parchear run.sh para crear schema 'loading' justo antes de get-external-data.py
# (run.sh crea la bd desde cero, por eso no podemos crear el schema antes)
sed -i 's|sudo -E -u renderer python3 /data/style/scripts/get-external-data.py|sudo -u postgres psql -d gis -c "CREATE SCHEMA IF NOT EXISTS loading; GRANT ALL ON SCHEMA loading TO renderer;" \&\& sudo -E -u renderer python3 /data/style/scripts/get-external-data.py|' /run.sh

# Crear rol root para renderd (también lo hacemos aquí, run.sh no lo borra)
# Lo hacemos después del import vía el sed, así que lo añadimos al final de run.sh
echo 'sudo -u postgres psql -c "CREATE ROLE root SUPERUSER LOGIN;" 2>/dev/null || true' >> /run.sh

exec /run.sh import
EOF
chmod +x /tmp/custom-init.sh

echo "✅ Archivos de configuración listos"

# ========== EJECUTAR IMPORT ==========

echo ""
echo "📥 ========================================="
echo "📥 IMPORTANDO DATOS + DESCARGANDO SHAPEFILES"
echo "📥 ========================================="
echo "   Esto puede tardar 20-40 minutos (descarga completa de shapefiles)"
echo ""

docker volume create ${TILE_VOLUME}

docker run -d --name tile-import \
  --memory=1536m \
  -e THREADS=1 \
  -e "OSM2PGSQL_EXTRA_ARGS=--cache 256 --number-processes 1" \
  -v /tmp/renderd-run:/run/renderd \
  -v ${TILE_PBF}:/data/region.osm.pbf \
  -v ${TILE_VOLUME}:/data/database/ \
  -v /tmp/pg-hba.conf:/etc/postgresql/15/main/pg_hba.conf \
  -v /tmp/pg-custom.conf:/etc/postgresql/15/main/postgresql.custom.conf.tmpl \
  -v /tmp/custom-init.sh:/tmp/custom-init.sh \
  --entrypoint /bin/bash \
  overv/openstreetmap-tile-server \
  -c 'bash /tmp/custom-init.sh'

echo "📊 Monitoreando progreso..."
while docker ps -q -f name=tile-import | grep -q .; do
  docker logs --tail 3 tile-import 2>&1 | tail -1
  echo "   ⏳ Import en progreso... $(date '+%H:%M:%S')"
  sleep 30
done

IMPORT_EXIT_CODE=$(docker inspect tile-import --format='{{.State.ExitCode}}')

if [ "$IMPORT_EXIT_CODE" != "0" ]; then
  echo "❌ Error en import (exit code: ${IMPORT_EXIT_CODE})"
  docker logs --tail 100 tile-import 2>&1
  free -h
  OOM=$(docker inspect tile-import --format='{{.State.OOMKilled}}' 2>/dev/null)
  echo "   OOMKilled: ${OOM}"
  docker rm tile-import 2>/dev/null || true
  exit 1
fi

docker rm tile-import 2>/dev/null || true
echo "✅ Import exitoso"

# ========== INICIAR TILE SERVER ==========

echo ""
echo "🚀 ========================================="
echo "🚀 INICIANDO TILE SERVER"
echo "🚀 ========================================="

docker run -d \
  --name ${CONTAINER_NAME} \
  --restart unless-stopped \
  --memory=900m \
  -v /tmp/renderd-run:/run/renderd \
  -p 8080:80 \
  -p 5433:5432 \
  -v ${TILE_VOLUME}:/data/database/ \
  -v /tmp/pg-custom.conf:/etc/postgresql/15/main/postgresql.custom.conf.tmpl \
  -v /tmp/pg-hba.conf:/etc/postgresql/15/main/pg_hba.conf \
  -e ALLOW_CORS=enabled \
  -e THREADS=2 \
  overv/openstreetmap-tile-server \
  run

echo "⏳ Esperando arranque del contenedor..."
sleep 20

CONTAINER_STATUS=$(docker inspect ${CONTAINER_NAME} --format='{{.State.Status}}' 2>/dev/null || echo "missing")
RESTART_COUNT=$(docker inspect ${CONTAINER_NAME} --format='{{.RestartCount}}' 2>/dev/null || echo "0")

if [ "$CONTAINER_STATUS" != "running" ]; then
  echo "❌ El contenedor no está corriendo (estado: ${CONTAINER_STATUS})"
  docker logs --tail 50 ${CONTAINER_NAME} 2>&1
  exit 1
fi

if [ "$RESTART_COUNT" -gt "2" ]; then
  echo "❌ Loop de reinicios detectado (reinicios: ${RESTART_COUNT})"
  docker logs --tail 100 ${CONTAINER_NAME} 2>&1
  exit 1
fi

echo "✅ Contenedor corriendo (reinicios: ${RESTART_COUNT})"

# ========== VERIFICAR FUNCIONAMIENTO ==========

echo "⏳ Esperando que el tile server esté listo..."

MAX_RETRIES=40
RETRY=0
READY=false

while [ $RETRY -lt $MAX_RETRIES ]; do
  CURRENT_RESTARTS=$(docker inspect ${CONTAINER_NAME} --format='{{.RestartCount}}' 2>/dev/null || echo "99")
  if [ "$CURRENT_RESTARTS" -gt "2" ]; then
    echo "❌ Loop de reinicios (reinicios: ${CURRENT_RESTARTS})"
    docker logs --tail 200 ${CONTAINER_NAME} 2>&1
    exit 1
  fi

  if curl -s -f -o /dev/null "http://localhost:8080/tile/0/0/0.png" 2>/dev/null; then
    echo "✅ Tile server funcionando"
    READY=true
    break
  fi

  RETRY=$((RETRY + 1))
  [ $((RETRY % 10)) -eq 0 ] && echo "   Esperando... (${RETRY}/${MAX_RETRIES}) - reinicios: ${CURRENT_RESTARTS}"
  sleep 4
done

if [ "$READY" = false ]; then
  echo "⚠️ Tile server no responde después de $(( MAX_RETRIES * 4 ))s"
  echo "   Estado: $(docker inspect ${CONTAINER_NAME} --format='{{.State.Status}}' 2>/dev/null) | Reinicios: $(docker inspect ${CONTAINER_NAME} --format='{{.RestartCount}}' 2>/dev/null)"
  echo ""
  echo "📋 Últimos logs:"
  docker logs --tail 50 ${CONTAINER_NAME} 2>&1
  echo ""
  echo "   (El primer tile puede tardar más - continúa el deploy)"
fi

# ========== CONFIGURAR SERVICIO SYSTEMD ==========

echo "🔧 Configurando servicio systemd..."

sudo tee /etc/systemd/system/tileserver.service > /dev/null << SERVICEEOF
[Unit]
Description=OpenStreetMap Tile Server - Barranquilla
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=${CURRENT_USER}
Restart=always
RestartSec=15
ExecStartPre=-/usr/bin/docker update --restart=no ${CONTAINER_NAME}
ExecStartPre=-/usr/bin/docker stop ${CONTAINER_NAME}
ExecStartPre=-/usr/bin/docker rm ${CONTAINER_NAME}
ExecStart=/usr/bin/docker run --rm --name ${CONTAINER_NAME} --memory=900m -v /tmp/renderd-run:/run/renderd -p 8080:80 -p 5433:5432 -v ${TILE_VOLUME}:/data/database/ -v /tmp/pg-custom.conf:/etc/postgresql/15/main/postgresql.custom.conf.tmpl -v /tmp/pg-hba.conf:/etc/postgresql/15/main/pg_hba.conf -e ALLOW_CORS=enabled -e THREADS=2 overv/openstreetmap-tile-server run
ExecStop=/usr/bin/docker stop ${CONTAINER_NAME}

[Install]
WantedBy=multi-user.target
SERVICEEOF

sudo systemctl daemon-reload
sudo systemctl enable tileserver
echo "✅ Servicio systemd configurado"

echo ""
echo "========================================="
echo "🎉 TILE SERVER CONFIGURADO"
echo "========================================="
echo "   Puerto tiles:  8080"
echo "   Puerto PostGIS: 5433"
echo ""
echo "🧪 PRUEBA:"
echo "   curl -I http://localhost:8080/tile/13/4541/3633.png"
echo "========================================="