#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ CONFIGURANDO TILE SERVER - BARRANQUILLA COMPLETA"
echo "🗺️ ========================================="

# Directorios separados para cada servicio
TILE_DIR="/opt/tile-data"
TILE_PBF="${TILE_DIR}/barranquilla-completo.osm.pbf"
TILE_VOLUME="openstreetmap-tile-data"
CONTAINER_NAME="tile-server"

echo "🎯 Objetivo: Mapa completo para tiles (edificios, agua, landuse, etc.)"
echo "   Diferente al OSRM que solo usa highways"

# ========== VERIFICAR SI YA ESTÁ FUNCIONANDO ==========

if docker ps 2>/dev/null | grep -q ${CONTAINER_NAME}; then
  echo "🔍 Tile server ya está corriendo, verificando..."

  # Probar si responde correctamente
  if curl -s -f -o /dev/null "http://localhost:8080/tile/13/4541/3633.png" 2>/dev/null; then
    echo "✅ Tile server responde correctamente"
    echo "   Saltando reinstalación completa"
    exit 0
  else
    echo "⚠️ Tile server no responde, reinstalando..."
    # ✅ FIX: Deshabilitar restart policy antes de detener para evitar loop
    docker update --restart=no ${CONTAINER_NAME} 2>/dev/null || true
    docker stop ${CONTAINER_NAME} 2>/dev/null || true
    docker rm ${CONTAINER_NAME} 2>/dev/null || true
  fi
fi

# ========== INSTALAR DEPENDENCIAS ==========

echo "📦 Verificando dependencias..."

# Verificar Docker
if ! command -v docker &> /dev/null; then
  echo "❌ Error: Docker no está instalado"
  exit 1
fi
echo "✅ Docker disponible"

# Instalar herramientas OSM si no están
if ! command -v osmconvert &> /dev/null || ! command -v osmium &> /dev/null; then
  echo "🔧 Instalando osmctools y osmium-tool..."
  sudo apt-get update -qq
  sudo apt-get install -y osmctools osmium-tool
  echo "✅ Herramientas OSM instaladas"
else
  echo "✅ Herramientas OSM disponibles"
fi

# ========== CONFIGURAR DIRECTORIOS ==========

echo "📁 Configurando directorios para tiles..."

CURRENT_USER=$(whoami)
sudo mkdir -p ${TILE_DIR}
sudo chown ${CURRENT_USER}:${CURRENT_USER} ${TILE_DIR}
cd ${TILE_DIR}

echo "✅ Directorio tiles: ${TILE_DIR}"

# ========== LIMPIAR INSTALACIÓN ANTERIOR ==========

echo "🧹 Limpiando instalación anterior..."

# ✅ FIX: Deshabilitar restart policy ANTES de detener (evita el loop de reinicios)
docker update --restart=no ${CONTAINER_NAME} 2>/dev/null || true
docker update --restart=no tile-import 2>/dev/null || true

docker stop ${CONTAINER_NAME} 2>/dev/null || true
docker stop tile-import 2>/dev/null || true
docker rm -f ${CONTAINER_NAME} 2>/dev/null || true
docker rm -f tile-import 2>/dev/null || true

# Limpiar datos anteriores para re-importar
rm -f ${TILE_DIR}/barranquilla-completo.*
rm -f ${TILE_DIR}/colombia-latest.osm.pbf
docker volume rm ${TILE_VOLUME} 2>/dev/null || true

# Eliminar imagen vieja del tile server para descargar fresca
echo "🔄 Eliminando imagen vieja del tile server..."
docker image rm overv/openstreetmap-tile-server 2>/dev/null || true

echo "📥 Descargando imagen fresca del tile server..."
docker pull overv/openstreetmap-tile-server

echo "✅ Limpieza completada - imagen fresca descargada"

# ========== USAR ARCHIVO LOCAL COMPLETO ==========

echo ""
echo "📥 ========================================="
echo "📥 USANDO ARCHIVO LOCAL HOT EXPORT TOOL"
echo "📥 ========================================="
echo ""
echo "🎯 Fuente: Tu archivo personalizado de HOT Export Tool"
echo "   Contenido: Edificios, calles, agua, landuse (tu selección)"
echo "   Ventaja: Sin descargas, datos optimizados"
echo ""

# Verificar que el archivo local existe
LOCAL_OSM_FILE="/tmp/Geolocation.osm.pbf"

if [ ! -f "$LOCAL_OSM_FILE" ]; then
    echo "❌ ERROR: Archivo local no encontrado: $LOCAL_OSM_FILE"
    echo "   Asegúrate de que el workflow transfirió el archivo correctamente"
    exit 1
fi

echo "✅ Archivo local encontrado: $(ls -lh $LOCAL_OSM_FILE | awk '{print $5}')"

# Copiar el archivo al directorio correcto
echo ""
echo "📁 Copiando archivo para tile server..."
cp "$LOCAL_OSM_FILE" "${TILE_PBF}"

if [ ! -f "${TILE_PBF}" ]; then
    echo "❌ Error copiando archivo local"
    exit 1
fi

echo "✅ Archivo copiado exitosamente"
echo "   Ubicación: ${TILE_PBF}"
echo "   Tamaño: $(ls -lh ${TILE_PBF} | awk '{print $5}')"
echo "   Contenido: Tu selección HOT personalizada"

DOWNLOAD_SUCCESS=true
SKIP_CONVERSION=true  # Ya está en formato PBF

# ========== PREPARAR MEMORIA PARA IMPORT ==========

echo ""
echo "💾 ========================================="
echo "💾 CONFIGURANDO SWAP (t2.micro tiene solo 1GB RAM)"
echo "💾 ========================================="

REQUIRED_SWAP="2G"

if [ -f /swapfile ]; then
  if ! swapon --show | grep -q /swapfile; then
    sudo swapon /swapfile 2>/dev/null || true
  fi
  echo "✅ Swap ya existe y está activo"
else
  echo "📦 Creando swapfile de ${REQUIRED_SWAP}..."
  sudo fallocate -l ${REQUIRED_SWAP} /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo "✅ Swap creado y activado (${REQUIRED_SWAP})"
fi

echo "📊 Memoria disponible:"
free -h

# ========== IMPORTAR DATOS AL TILE SERVER ==========

echo ""
echo "📥 ========================================="
echo "📥 IMPORTANDO MAPA COMPLETO AL TILE SERVER"
echo "📥 ========================================="
echo ""
echo "   PBF: ${TILE_PBF}"
echo "   Contenido: Calles + edificios + etc."
echo "   RAM: 1GB + 2GB swap = 3GB disponibles"
echo "   🚫 Water-polygons globales deshabilitados (no necesarios)"
echo "   🚫 external-data.yml eliminado (sin errores de Python)"
echo "   Esto puede tardar 5-15 minutos..."
echo ""

# Crear volumen Docker
docker volume create ${TILE_VOLUME}

# Crear script de inicialización personalizado
cat > /tmp/custom-init.sh << 'EOF'
#!/bin/bash
# Eliminar external-data.yml
rm -f /home/renderer/src/openstreetmap-carto/external-data.yml
rm -f /data/style/external-data.yml
rm -f /home/renderer/src/openstreetmap-carto-backup/external-data.yml

# Iniciar PostgreSQL
service postgresql start
sleep 5

# Configurar trust para el import
cat > /etc/postgresql/15/main/pg_hba.conf << 'PGEOF'
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
PGEOF

# Reiniciar PostgreSQL
service postgresql restart
sleep 3

# ✅ FIX: Bajar consumo de RAM de PostgreSQL para que quepa en t2.micro
echo "🔧 Ajustando memoria de PostgreSQL para t2.micro..."
sudo -u postgres psql -c "ALTER SYSTEM SET shared_buffers = '32MB';" 2>/dev/null || true
sudo -u postgres psql -c "ALTER SYSTEM SET work_mem = '16MB';" 2>/dev/null || true
sudo -u postgres psql -c "ALTER SYSTEM SET maintenance_work_mem = '64MB';" 2>/dev/null || true
sudo -u postgres psql -c "ALTER SYSTEM SET max_connections = '20';" 2>/dev/null || true
service postgresql restart
sleep 3

# ✅ Ejecutar import UNA SOLA VEZ
echo "📥 Ejecutando import..."
/run.sh import

# ✅ FIX: Crear rol root en PostgreSQL
# renderd corre como root dentro del contenedor y postgres no tiene ese rol por defecto
echo "🔧 Creando rol root en PostgreSQL..."
sudo -u postgres psql -c "CREATE ROLE root SUPERUSER LOGIN;" 2>/dev/null || echo "   (Rol root ya existe, continuando...)"
sudo -u postgres psql -d gis -c "GRANT ALL ON SCHEMA public TO root;" 2>/dev/null || true
sudo -u postgres psql -d gis -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO root;" 2>/dev/null || true
echo "✅ Rol root configurado en PostgreSQL"

# Configurar renderd para que corra como usuario renderer
echo "🔧 Configurando renderd..."

# Crear directorio de renderd si no existe
mkdir -p /run/renderd
chown -R renderer:renderer /run/renderd

# Modificar el script de inicio de renderd
cat > /etc/init.d/renderd << 'RENDERDEOF'
#!/bin/bash
### BEGIN INIT INFO
# Provides:          renderd
# Required-Start:    $local_fs $remote_fs postgresql
# Required-Stop:     $local_fs $remote_fs
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: Start renderd
### END INIT INFO

USER=renderer
DAEMON=/usr/bin/renderd
PIDFILE=/run/renderd/renderd.pid

case "$1" in
  start)
    echo "Starting renderd"
    start-stop-daemon --start --quiet --pidfile $PIDFILE --chuid $USER --exec $DAEMON -- -c /etc/renderd.conf
    ;;
  stop)
    echo "Stopping renderd"
    start-stop-daemon --stop --quiet --pidfile $PIDFILE
    ;;
  restart)
    $0 stop
    $0 start
    ;;
  status)
    if [ -f $PIDFILE ]; then
      echo "renderd is running"
    else
      echo "renderd is not running"
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac
exit 0
RENDERDEOF

chmod +x /etc/init.d/renderd

# Limpiar sockets viejos
rm -f /run/renderd/*

echo "✅ Renderd configurado correctamente"
EOF

chmod +x /tmp/custom-init.sh

# Crear config de PostgreSQL optimizada para t2.micro
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
echo "🚫 Eliminando external-data.yml antes del import..."
echo "🔄 Iniciando importación..."

# Ejecutar el import
docker run -d --name tile-import \
  --memory=1536m \
  -e THREADS=1 \
  -e "OSM2PGSQL_EXTRA_ARGS=--cache 256 --number-processes 1" \
  -v ${TILE_PBF}:/data/region.osm.pbf \
  -v ${TILE_VOLUME}:/data/database/ \
  -v /tmp/custom-init.sh:/tmp/custom-init.sh \
  -v /tmp/pg-custom.conf:/etc/postgresql/15/main/postgresql.custom.conf.tmpl \
  --entrypoint /bin/bash \
  overv/openstreetmap-tile-server \
  -c 'bash /tmp/custom-init.sh'

# Monitorear progreso: mostrar output cada 30s para mantener SSH vivo
echo "📊 Monitoreando progreso de importación..."
while docker ps -q -f name=tile-import | grep -q .; do
  docker logs --tail 3 tile-import 2>&1 | tail -1
  echo "   ⏳ Import en progreso... $(date '+%H:%M:%S')"
  sleep 30
done

# Verificar que terminó exitosamente
IMPORT_EXIT_CODE=$(docker inspect tile-import --format='{{.State.ExitCode}}')

if [ "$IMPORT_EXIT_CODE" != "0" ]; then
  echo "❌ Error importando mapa completo al tile server (exit code: ${IMPORT_EXIT_CODE})"
  echo ""
  echo "📋 ========================================="
  echo "📋 LOGS DEL IMPORT (últimas 100 líneas):"
  echo "📋 ========================================="
  docker logs --tail 100 tile-import 2>&1
  echo ""
  echo "📊 Memoria al momento del fallo:"
  free -h
  echo ""
  echo "📊 Estado de Docker:"
  OOM=$(docker inspect tile-import --format='{{.State.OOMKilled}}' 2>/dev/null)
  echo "   OOMKilled: ${OOM}"
  if [ "$OOM" = "true" ]; then
    echo "   ⚠️ El contenedor fue matado por falta de memoria"
  fi
  docker rm tile-import 2>/dev/null || true
  exit 1
fi

docker rm tile-import 2>/dev/null || true

echo "✅ Importación de mapa completo exitosa"

# ========== INICIAR TILE SERVER ==========

echo ""
echo "🚀 ========================================="
echo "🚀 INICIANDO TILE SERVER"
echo "🚀 ========================================="

docker run -d \
  --name ${CONTAINER_NAME} \
  --restart unless-stopped \
  --memory=900m \
  -p 8080:80 \
  -p 5433:5432 \
  -v ${TILE_VOLUME}:/data/database/ \
  -v /tmp/pg-custom.conf:/etc/postgresql/15/main/postgresql.custom.conf.tmpl \
  -e ALLOW_CORS=enabled \
  -e THREADS=2 \
  overv/openstreetmap-tile-server \
  run

# Esperar que el contenedor arranque y configurar permisos de renderd
echo "⏳ Esperando arranque del contenedor..."
sleep 15

# ✅ FIX: Verificar que el contenedor no está en loop antes de continuar
CONTAINER_STATUS=$(docker inspect ${CONTAINER_NAME} --format='{{.State.Status}}' 2>/dev/null || echo "missing")
RESTART_COUNT=$(docker inspect ${CONTAINER_NAME} --format='{{.RestartCount}}' 2>/dev/null || echo "0")

if [ "$CONTAINER_STATUS" != "running" ]; then
  echo "❌ El contenedor no está corriendo (estado: ${CONTAINER_STATUS})"
  echo "📋 Últimos logs:"
  docker logs --tail 30 ${CONTAINER_NAME} 2>&1
  exit 1
fi

if [ "$RESTART_COUNT" -gt "2" ]; then
  echo "❌ El contenedor se está reiniciando en loop (reinicios: ${RESTART_COUNT})"
  echo "📋 Últimos logs:"
  docker logs --tail 50 ${CONTAINER_NAME} 2>&1
  exit 1
fi

echo "✅ Contenedor corriendo (reinicios: ${RESTART_COUNT})"

# Configurar permisos de renderd
docker exec ${CONTAINER_NAME} bash -c "chown -R renderer:renderer /run/renderd && service renderd restart" 2>/dev/null || true

# ========== VERIFICAR FUNCIONAMIENTO ==========

echo "⏳ Esperando que el tile server esté listo..."

MAX_RETRIES=40
RETRY=0
READY=false

while [ $RETRY -lt $MAX_RETRIES ]; do
  # Verificar que el contenedor sigue vivo y no en loop
  CURRENT_RESTARTS=$(docker inspect ${CONTAINER_NAME} --format='{{.RestartCount}}' 2>/dev/null || echo "99")
  if [ "$CURRENT_RESTARTS" -gt "2" ]; then
    echo "❌ El contenedor entró en loop de reinicios (reinicios: ${CURRENT_RESTARTS})"
    echo "📋 Últimos logs:"
    docker logs --tail 200 ${CONTAINER_NAME} 2>&1
    echo "📋 Logs de PostgreSQL dentro del contenedor:"
    docker exec ${CONTAINER_NAME} cat /var/log/postgresql/postgresql-15-main.log 2>/dev/null | tail -30 || echo "No se pudo acceder al log de PostgreSQL"
    exit 1
  fi

  if curl -s -f -o /dev/null "http://localhost:8080/tile/0/0/0.png" 2>/dev/null; then
    echo "✅ Tile server funcionando"
    READY=true
    break
  fi

  RETRY=$((RETRY + 1))
  if [ $((RETRY % 10)) -eq 0 ]; then
    echo "   Esperando... (${RETRY}/${MAX_RETRIES}) - reinicios del contenedor: ${CURRENT_RESTARTS}"
  fi
  sleep 4
done

if [ "$READY" = false ]; then
  echo "⚠️ Tile server no responde después de $(( MAX_RETRIES * 4 ))s"
  echo "   Verificando estado final del contenedor..."
  FINAL_RESTARTS=$(docker inspect ${CONTAINER_NAME} --format='{{.RestartCount}}' 2>/dev/null || echo "?")
  FINAL_STATUS=$(docker inspect ${CONTAINER_NAME} --format='{{.State.Status}}' 2>/dev/null || echo "?")
  echo "   Estado: ${FINAL_STATUS} | Reinicios: ${FINAL_RESTARTS}"
  echo ""
  echo "📋 Últimos logs del tile server:"
  docker logs --tail 30 ${CONTAINER_NAME} 2>&1
  echo ""
  echo "   (Puede continuar el deploy - el renderizado inicial puede tomar más tiempo)"
fi

# ========== CONFIGURAR SERVICIO SYSTEMD ==========

echo "🔧 Configurando servicio systemd..."

sudo tee /etc/systemd/system/tileserver.service > /dev/null << SERVICEEOF
[Unit]
Description=OpenStreetMap Tile Server - Barranquilla Completa
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
ExecStart=/usr/bin/docker run --rm --name ${CONTAINER_NAME} --memory=900m -p 8080:80 -p 5433:5432 -v ${TILE_VOLUME}:/data/database/ -v /tmp/pg-custom.conf:/etc/postgresql/15/main/postgresql.custom.conf.tmpl -e ALLOW_CORS=enabled -e THREADS=2 overv/openstreetmap-tile-server run
ExecStop=/usr/bin/docker stop ${CONTAINER_NAME}

[Install]
WantedBy=multi-user.target
SERVICEEOF

sudo systemctl daemon-reload
sudo systemctl enable tileserver
echo "✅ Servicio systemd configurado"

# ========== LIMPIAR ARCHIVOS TEMPORALES ==========

echo "🧹 Limpiando archivos temporales..."
rm -f barranquilla-completo.osm.pbf
rm -f colombia-latest.osm.pbf
rm -f /tmp/water_query.overpassql /tmp/custom-init.sh 2>/dev/null || true
echo "✅ Archivos temporales limpiados"

echo ""
echo "========================================="
echo "🎉 TILE SERVER CONFIGURADO"
echo "========================================="
echo ""
echo "📊 INFORMACIÓN:"
echo "   - Contenedor: ${CONTAINER_NAME}"
echo "   - Puerto tiles: 8080"
echo "   - Puerto PostGIS: 5433"
echo "   - Datos: Barranquilla COMPLETA"
echo "   - Contenido: Calles + edificios + agua + landuse"
echo ""
echo "🔗 ENDPOINTS:"
echo "   - Tiles: http://localhost:8080/tile/{z}/{x}/{y}.png"
echo "   - PostGIS: postgresql://renderer@localhost:5433/gis"
echo ""
echo "🗺️ DIFERENCIAS CON OSRM:"
echo "   ✅ OSRM (puerto 5001): Solo highways para routing"
echo "   ✅ Tiles (puerto 8080): Mapa visual completo"
echo ""
echo "🧪 PRUEBA:"
echo "   curl -I http://localhost:8080/tile/13/4541/3633.png"
echo "========================================"