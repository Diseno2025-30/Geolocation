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

# ========== DESCARGAR MAPA COMPLETO ==========

echo ""
echo "📥 ========================================="
echo "📥 DESCARGANDO MAPA COMPLETO DE BARRANQUILLA"
echo "📥 ========================================="
echo ""
echo "🗺️ Para tiles: edificios, agua, landuse, etc. (TODO)"
echo "   Diferente al OSRM que solo necesita highways"
echo ""

# Función de validación para mapa completo
validate_complete_osm() {
    local file=$1
    local min_size=5000000  # 5MB mínimo para mapa completo
    
    if [ ! -f "$file" ]; then
        echo "❌ Archivo no existe: $file"
        return 1
    fi
    
    local file_size=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo 0)
    
    if [ $file_size -lt $min_size ]; then
        echo "❌ Archivo muy pequeño: $file_size bytes (mínimo: $min_size)"
        return 1
    fi
    
    # Verificar XML válido
    if ! grep -q "<osm" "$file" 2>/dev/null; then
        echo "❌ No es archivo OSM válido"
        return 1
    fi
    
    # Verificar que tenga edificios (no solo highways)
    local building_count=$(grep -c 'k="building"' "$file" 2>/dev/null || echo 0)
    local way_count=$(grep -c "<way" "$file" 2>/dev/null || echo 0)
    
    if [ $building_count -lt 10 ]; then
        echo "⚠️ Pocas edificaciones: $building_count (puede ser normal si solo hay highways)"
    fi
    
    echo "✅ Mapa completo válido: $file_size bytes, $way_count ways, $building_count edificios"
    return 0
}

# Query para MAPA COMPLETO (no solo highways)
OVERPASS_QUERY_COMPLETE='[out:xml][timeout:900][maxsize:536870912];
(
  relation(1335179);
  map_to_area;
  (
    // Todos los ways (calles, edificios, etc.)
    way(area);
    
    // Todas las relaciones importantes
    relation(area);
  );
  >;
);
out body;'

echo "$OVERPASS_QUERY_COMPLETE" > /tmp/overpass_tiles.txt

echo "🌐 MÉTODO 1: Overpass API (mapa completo)..."
echo "   (Tiempo estimado: 8-15 minutos - archivo grande con edificios)"

if curl -L --connect-timeout 180 --max-time 1200 \
  --retry 1 --retry-delay 30 \
  -d @/tmp/overpass_tiles.txt \
  "https://overpass-api.de/api/interpreter" \
  -o barranquilla-completo.osm; then
  
  if validate_complete_osm "barranquilla-completo.osm"; then
    echo "✅ Descarga completa exitosa con Overpass"
    DOWNLOAD_SUCCESS=true
  else
    echo "❌ Descarga Overpass corrupta o muy pequeña"
    rm -f barranquilla-completo.osm
    DOWNLOAD_SUCCESS=false
  fi
else
  echo "❌ Error de conexión en descarga Overpass"
  DOWNLOAD_SUCCESS=false
fi

# MÉTODO ALTERNATIVO: Geofabrik + osmconvert (más eficiente)
if [ "$DOWNLOAD_SUCCESS" != "true" ]; then
  echo ""
  echo "🌍 MÉTODO 2: Geofabrik + extracción eficiente..."
  echo "   Usando osmconvert (menos memoria que osmium)"
  
  # Descargar Colombia
  if wget -O colombia-latest.osm.pbf "https://download.geofabrik.de/south-america/colombia-latest.osm.pbf"; then
    echo "✅ Colombia descargado ($(ls -lh colombia-latest.osm.pbf | awk '{print $5}'))"
    echo "🔧 Extrayendo Barranquilla con osmconvert..."
    
    # CAMBIO CLAVE: Usar osmconvert (más eficiente en memoria)
    if osmconvert colombia-latest.osm.pbf -b=-74.95,10.85,-74.70,11.10 -o=barranquilla-completo.osm.pbf; then
      echo "✅ Extracción completada con osmconvert"
      rm -f colombia-latest.osm.pbf
      DOWNLOAD_SUCCESS=true
      SKIP_CONVERSION=true
    else
      echo "❌ Error en extracción con osmconvert"
      rm -f colombia-latest.osm.pbf
      DOWNLOAD_SUCCESS=false
    fi
  else
    echo "❌ Error descargando Colombia"
    DOWNLOAD_SUCCESS=false
  fi
fi

# Limpiar archivo temporal
rm -f /tmp/overpass_tiles.txt

# Verificación final
if [ "$DOWNLOAD_SUCCESS" != "true" ]; then
  echo ""
  echo "❌ ERROR CRÍTICO: No se pudo descargar mapa completo"
  echo "💡 Sin mapa completo, el tile server solo mostraría calles sin edificios"
  exit 1
fi

echo "✅ Mapa completo disponible para tiles"

# ========== CONVERSIÓN A PBF (si es necesario) ==========

if [ "$SKIP_CONVERSION" != "true" ]; then
  echo ""
  echo "🔄 Convirtiendo mapa completo OSM a PBF..."
  
  if command -v osmconvert &> /dev/null; then
    echo "   Usando osmconvert..."
    osmconvert barranquilla-completo.osm -o=barranquilla-completo.osm.pbf
  elif command -v osmium &> /dev/null; then
    echo "   Usando osmium como fallback..."
    osmium cat barranquilla-completo.osm -o barranquilla-completo.osm.pbf --overwrite --input-format=xml
  else
    echo "❌ Herramientas de conversión no disponibles"
    exit 1
  fi
  
  if [ ! -f "barranquilla-completo.osm.pbf" ]; then
    echo "❌ Error en conversión"
    exit 1
  fi
  
  # Limpiar OSM temporal
  rm -f barranquilla-completo.osm
  echo "✅ Conversión completada"
fi

echo "   Archivo PBF completo: $(ls -lh barranquilla-completo.osm.pbf | awk '{print $5}')"

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