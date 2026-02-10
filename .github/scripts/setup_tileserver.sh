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
docker stop ${CONTAINER_NAME} 2>/dev/null || true
docker rm ${CONTAINER_NAME} 2>/dev/null || true

# Limpiar datos anteriores para re-importar
rm -f ${TILE_DIR}/barranquilla-completo.*
rm -f ${TILE_DIR}/colombia-latest.osm.pbf
docker volume rm ${TILE_VOLUME} 2>/dev/null || true

echo "✅ Limpieza completada"

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
LOCAL_OSM_FILE="/tmp/Puerto_MAP.osm.pbf"

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

# ========== IMPORTAR DATOS AL TILE SERVER ==========

echo ""
echo "📥 ========================================="
echo "📥 IMPORTANDO MAPA COMPLETO AL TILE SERVER"
echo "📥 ========================================="
echo ""
echo "   PBF: ${TILE_PBF}"
echo "   Contenido: Calles + edificios + agua + landuse + etc."
echo "   Esto puede tardar 10-30 minutos..."
echo ""

# Crear volumen Docker
docker volume create ${TILE_VOLUME}

# Importar datos completos
if ! docker run \
  -v ${TILE_PBF}:/data/region.osm.pbf \
  -v ${TILE_VOLUME}:/data/database/ \
  overv/openstreetmap-tile-server \
  import; then
  echo "❌ Error importando mapa completo al tile server"
  exit 1
fi

echo "✅ Importación de mapa completo exitosa"

# ========== INICIAR TILE SERVER ==========

echo ""
echo "🚀 ========================================="
echo "🚀 INICIANDO TILE SERVER"
echo "🚀 ========================================="

docker run -d \
  --name ${CONTAINER_NAME} \
  --restart unless-stopped \
  -p 8080:80 \
  -p 5433:5432 \
  -v ${TILE_VOLUME}:/data/database/ \
  -e ALLOW_CORS=enabled \
  overv/openstreetmap-tile-server \
  run

# ========== VERIFICAR FUNCIONAMIENTO ==========

echo "⏳ Esperando que el tile server esté listo..."

MAX_RETRIES=40
RETRY=0
READY=false

while [ $RETRY -lt $MAX_RETRIES ]; do
  if curl -s -f -o /dev/null "http://localhost:8080/tile/0/0/0.png" 2>/dev/null; then
    echo "✅ Tile server funcionando"
    READY=true
    break
  fi
  
  RETRY=$((RETRY + 1))
  if [ $((RETRY % 10)) -eq 0 ]; then
    echo "   Esperando... (${RETRY}/${MAX_RETRIES})"
  fi
  sleep 4
done

if [ "$READY" = false ]; then
  echo "⚠️ Tile server no responde inmediatamente"
  echo "   (Puede ser normal - el renderizado inicial toma tiempo)"
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

# ========== LIMPIAR ARCHIVOS TEMPORALES ==========

echo "🧹 Limpiando archivos temporales..."
rm -f barranquilla-completo.osm.pbf  # Ya está importado en Docker
rm -f colombia-latest.osm.pbf        # Si queda colgado
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