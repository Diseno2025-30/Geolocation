#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ CONFIGURANDO TILE SERVER - BARRANQUILLA"
echo "🗺️ ========================================="

OSRM_DIR="/opt/osrm-data"
PBF_FILE="${OSRM_DIR}/barranquilla-oficial.osm.pbf"
TILE_VOLUME="openstreetmap-tile-data"
CONTAINER_NAME="tile-server"

# ========== VERIFICAR PREREQUISITOS ==========

# Verificar que el PBF existe (debería haber sido creado por setup_osrm)
if [ ! -f "${PBF_FILE}" ]; then
  echo "❌ Error: No se encontró ${PBF_FILE}"
  echo "   Asegúrate de ejecutar setup_osrm.sh primero"
  exit 1
fi

echo "✅ PBF encontrado: $(ls -lh ${PBF_FILE} | awk '{print $5}')"

# Verificar Docker
if ! command -v docker &> /dev/null; then
  echo "❌ Error: Docker no está instalado"
  exit 1
fi

# ========== VERIFICAR SI YA ESTÁ CORRIENDO ==========

if docker ps 2>/dev/null | grep -q ${CONTAINER_NAME}; then
  echo "🔍 Tile server ya está corriendo, verificando..."

  # Probar si responde correctamente
  if curl -s -f -o /dev/null "http://localhost:8080/tile/13/4541/3633.png" 2>/dev/null; then
    echo "✅ Tile server responde correctamente"
    echo "   Saltando reinstalación"
    exit 0
  else
    echo "⚠️ Tile server no responde, reiniciando..."
    docker stop ${CONTAINER_NAME} 2>/dev/null || true
    docker rm ${CONTAINER_NAME} 2>/dev/null || true
  fi
fi

# ========== LIMPIAR INSTALACIÓN ANTERIOR ==========

echo "🧹 Limpiando instalación anterior..."
docker stop ${CONTAINER_NAME} 2>/dev/null || true
docker rm ${CONTAINER_NAME} 2>/dev/null || true

# Eliminar volumen anterior para reimportar datos frescos
docker volume rm ${TILE_VOLUME} 2>/dev/null || true

echo "✅ Limpieza completada"

# ========== IMPORTAR DATOS OSM ==========

echo ""
echo "📥 ========================================="
echo "📥 IMPORTANDO DATOS OSM AL TILE SERVER"
echo "📥 ========================================="
echo ""
echo "   PBF: ${PBF_FILE}"
echo "   Esto puede tardar 5-20 minutos dependiendo del tamaño..."
echo ""

# Crear volumen Docker para persistencia
docker volume create ${TILE_VOLUME}

# Importar datos OSM al tile server
# El contenedor overv/openstreetmap-tile-server:
# 1. Inicia PostgreSQL + PostGIS internamente
# 2. Ejecuta osm2pgsql para importar el PBF
# 3. Genera estilos Mapnik para renderizado
if ! docker run \
  -v ${PBF_FILE}:/data/region.osm.pbf \
  -v ${TILE_VOLUME}:/data/database/ \
  overv/openstreetmap-tile-server \
  import; then
  echo "❌ Error importando datos al tile server"
  echo "   Posibles causas:"
  echo "   - PBF corrupto o vacío"
  echo "   - Memoria insuficiente (necesita ~2-4GB)"
  echo "   - Disco lleno"
  exit 1
fi

echo ""
echo "✅ Importación completada"

# ========== INICIAR TILE SERVER ==========

echo ""
echo "🚀 ========================================="
echo "🚀 INICIANDO TILE SERVER"
echo "🚀 ========================================="
echo ""
echo "   Puerto HTTP: 8080 (tiles)"
echo "   Puerto PostGIS: 5433 (consultas internas)"
echo "   Auto-reinicio: Habilitado"
echo ""

docker run -d \
  --name ${CONTAINER_NAME} \
  --restart unless-stopped \
  -p 8080:80 \
  -p 5433:5432 \
  -v ${TILE_VOLUME}:/data/database/ \
  -e ALLOW_CORS=enabled \
  overv/openstreetmap-tile-server \
  run

# ========== ESPERAR A QUE ESTÉ LISTO ==========

echo "⏳ Esperando que el tile server esté listo..."
echo "   (El primer inicio puede tardar 1-2 minutos mientras se levanta PostgreSQL)"

MAX_RETRIES=60
RETRY=0
READY=false

while [ $RETRY -lt $MAX_RETRIES ]; do
  # El tile server tarda en levantar Apache + PostgreSQL + renderd
  if curl -s -f -o /dev/null "http://localhost:8080/tile/0/0/0.png" 2>/dev/null; then
    echo ""
    echo "✅ Tile server está listo y sirviendo tiles"
    READY=true
    break
  fi

  RETRY=$((RETRY + 1))
  if [ $((RETRY % 10)) -eq 0 ]; then
    echo "   Esperando... (${RETRY}/${MAX_RETRIES})"
  fi
  sleep 3
done

if [ "$READY" = false ]; then
  echo ""
  echo "❌ Tile server no responde después de ${MAX_RETRIES} intentos"
  echo ""
  echo "📋 Logs del contenedor:"
  docker logs ${CONTAINER_NAME} --tail 50
  echo ""
  echo "💡 Esto puede ser normal en el primer inicio."
  echo "   El servidor puede tardar varios minutos en pre-renderizar tiles."
  echo "   Verifica manualmente con: curl http://localhost:8080/tile/13/4541/3633.png"
fi

# ========== CONFIGURAR SERVICIO SYSTEMD ==========

echo ""
echo "🔧 Configurando servicio systemd para auto-inicio..."

CURRENT_USER=$(whoami)

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
ExecStartPre=-/usr/bin/docker stop ${CONTAINER_NAME}
ExecStartPre=-/usr/bin/docker rm ${CONTAINER_NAME}
ExecStart=/usr/bin/docker run --rm --name ${CONTAINER_NAME} -p 8080:80 -p 5433:5432 -v ${TILE_VOLUME}:/data/database/ -e ALLOW_CORS=enabled overv/openstreetmap-tile-server run
ExecStop=/usr/bin/docker stop ${CONTAINER_NAME}

[Install]
WantedBy=multi-user.target
SERVICEEOF

sudo systemctl daemon-reload
sudo systemctl enable tileserver

echo "✅ Servicio systemd configurado"

# ========== PRUEBA DE TILES ==========

echo ""
echo "🧪 ========================================="
echo "🧪 PROBANDO TILE SERVER"
echo "🧪 ========================================="
echo ""

# Probar tiles en diferentes zoom levels para Barranquilla
TEST_TILES=(
  "13/4541/3633"  # Barranquilla centro, zoom 13
  "15/18165/14531" # Barranquilla detalle, zoom 15
  "10/567/454"     # Vista general, zoom 10
)

echo "📍 Probando tiles en diferentes niveles de zoom:"
for tile in "${TEST_TILES[@]}"; do
  echo -n "   Tile /${tile}.png ... "
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/tile/${tile}.png" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "200" ]; then
    SIZE=$(curl -s "http://localhost:8080/tile/${tile}.png" 2>/dev/null | wc -c)
    echo "✅ OK (${SIZE} bytes)"
  else
    echo "⚠️ HTTP ${HTTP_CODE}"
  fi
done

# ========== VERIFICAR POSTGIS ==========

echo ""
echo "🔍 Verificando acceso PostGIS..."

if docker exec ${CONTAINER_NAME} psql -U renderer -d gis -c "SELECT COUNT(*) FROM planet_osm_polygon LIMIT 1;" 2>/dev/null; then
  echo "✅ PostGIS accesible y con datos"

  # Contar edificios disponibles
  BUILDING_COUNT=$(docker exec ${CONTAINER_NAME} psql -U renderer -d gis -t -c "SELECT COUNT(*) FROM planet_osm_polygon WHERE building IS NOT NULL;" 2>/dev/null | tr -d ' ')
  echo "   Edificios en la base de datos: ${BUILDING_COUNT}"
else
  echo "⚠️ No se pudo verificar PostGIS (el servidor puede estar iniciando)"
fi

# ========== RESUMEN ==========

echo ""
echo "========================================="
echo "✅ TILE SERVER CONFIGURADO"
echo "========================================="
echo ""
echo "📊 INFORMACIÓN:"
echo "   - Contenedor: ${CONTAINER_NAME}"
echo "   - Puerto HTTP: 8080 (tiles PNG)"
echo "   - Puerto PostGIS: 5433 (consultas SQL)"
echo "   - Volumen: ${TILE_VOLUME}"
echo "   - Datos: Barranquilla completa"
echo "   - Servicio systemd: Habilitado"
echo ""
echo "🔗 ENDPOINTS:"
echo "   - Tiles: http://localhost:8080/tile/{z}/{x}/{y}.png"
echo "   - PostGIS: postgresql://renderer:renderer@localhost:5433/gis"
echo ""
echo "🛠️ COMANDOS ÚTILES:"
echo "   - Ver logs: docker logs -f ${CONTAINER_NAME}"
echo "   - Reiniciar: docker restart ${CONTAINER_NAME}"
echo "   - Estado: docker ps | grep ${CONTAINER_NAME}"
echo "   - Servicio: sudo systemctl status tileserver"
echo "   - Query PostGIS: docker exec ${CONTAINER_NAME} psql -U renderer -d gis"
echo "========================================="
