#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ CONFIGURANDO OSRM - BARRANQUILLA OFICIAL"
echo "🗺️ ========================================="

# ========== SIEMPRE REGENERAR MAPA OSM ==========
echo "🔍 Limpiando datos OSM anteriores para regenerar..."

# Siempre detener contenedor y limpiar archivos para evitar problemas de versionamiento
echo "🗑️  Eliminando mapa anterior y contenedor..."

# Detener y eliminar contenedor
docker stop osrm-backend 2>/dev/null || true
docker rm osrm-backend 2>/dev/null || true

# Eliminar todos los archivos OSM/OSRM antiguos (excepto mantener el PBF si existe para referencia)
sudo rm -f /opt/osrm-data/puerto-barranquilla.*
sudo rm -f /opt/osrm-data/barranquilla-oficial.osrm*

echo "✅ Archivos OSRM anteriores eliminados (se regenerarán)"
FORCE_REINSTALL=true

echo "📦 Instalando dependencias..."

# Instalar Docker si no está instalado
if ! command -v docker &> /dev/null; then
  echo "🐳 Instalando Docker..."
  sudo apt-get update -qq
  sudo apt-get install -y docker.io
  sudo systemctl start docker
  sudo systemctl enable docker
  echo "✅ Docker instalado"
else
  echo "✅ Docker ya está instalado"
fi

# Instalar osmium-tool Y osmctools para convertir formatos
if ! command -v osmium &> /dev/null; then
  echo "🔧 Instalando osmium-tool y osmctools..."
  sudo apt-get update -qq
  sudo apt-get install -y osmium-tool osmctools
  echo "✅ osmium-tool y osmctools instalados"
else
  echo "✅ osmium-tool ya está instalado"
  # Asegurar que osmctools también esté instalado
  if ! command -v osmconvert &> /dev/null; then
    echo "🔧 Instalando osmctools..."
    sudo apt-get install -y osmctools
    echo "✅ osmctools instalado"
  else
    echo "✅ osmctools ya está instalado"
  fi
fi

# ========== PERMISOS DE DOCKER ==========
echo "🔧 Configurando permisos de Docker..."

CURRENT_USER=$(whoami)
echo "   Usuario detectado: ${CURRENT_USER}"

if ! groups ${CURRENT_USER} | grep -q docker; then
  echo "   Agregando usuario '${CURRENT_USER}' al grupo docker..."
  sudo usermod -aG docker ${CURRENT_USER}
else
  echo "   Usuario '${CURRENT_USER}' ya está en el grupo docker"
fi

echo "   Reiniciando Docker daemon..."
sudo systemctl restart docker
sleep 2

sudo chmod 666 /var/run/docker.sock
echo "✅ Permisos de Docker configurados"
# =========================================

# Crear directorio para datos OSRM
OSRM_DIR="/opt/osrm-data"
echo "📁 Creando directorio: ${OSRM_DIR}"
sudo mkdir -p ${OSRM_DIR}
sudo chown ${CURRENT_USER}:${CURRENT_USER} ${OSRM_DIR}
cd ${OSRM_DIR}

echo ""
echo "📥 ========================================="
echo "📥 DESCARGANDO MAPA OFICIAL DE BARRANQUILLA"
echo "📥 ========================================="
echo ""
echo "🗺️ Método: Relación administrativa oficial"
echo "   ID Relación: 1335179"
echo ""

# Limpiar descargas previas
rm -f barranquilla-oficial.osm barranquilla-oficial.osm.pbf

# Query de Overpass para MAPA COMPLETO de Barranquilla (calles, edificios, agua, landuse, etc.)
# Se usa tanto para OSRM (que filtra internamente solo highways via car.lua)
# como para el tile server (que necesita todo para renderizar tiles completos)
OVERPASS_QUERY='
[out:xml][timeout:900][maxsize:536870912];
relation(1335179);
map_to_area;
(
  way(area);
  node(area);
  relation(area);
  >;
);
out body;
>;
out skel qt;'

echo "$OVERPASS_QUERY" > /tmp/overpass_query.txt

echo "🌐 Descargando mapa COMPLETO de Barranquilla desde Overpass API..."
echo "   (Mapa completo: calles, edificios, agua, landuse, etc.)"
echo "   (Esto puede tardar 5-15 minutos debido al volumen de datos)"
echo ""

curl -L --connect-timeout 300 --max-time 1200 \
  --retry 2 --retry-delay 30 \
  -d @/tmp/overpass_query.txt \
  "https://overpass-api.de/api/interpreter" \
  -o barranquilla-oficial.osm

# Verificar que el archivo se descargó correctamente
if [ ! -f "barranquilla-oficial.osm" ] || [ ! -s "barranquilla-oficial.osm" ]; then
  echo "❌ Error: No se pudo descargar el mapa de Barranquilla"
  exit 1
fi

echo "✅ Descarga completada exitosamente"
echo "   Archivo OSM: $(ls -lh barranquilla-oficial.osm | awk '{print $5}')"

# Convertir OSM a PBF usando osmconvert
echo ""
echo "🔄 Convirtiendo formato OSM a PBF..."

if command -v osmconvert &> /dev/null; then
  echo "   Usando osmconvert..."
  osmconvert barranquilla-oficial.osm -o=barranquilla-oficial.osm.pbf
else
  echo "   Usando osmium como fallback..."
  osmium cat barranquilla-oficial.osm -o barranquilla-oficial.osm.pbf --overwrite --input-format=xml,add_metadata=false
fi

if [ ! -f "barranquilla-oficial.osm.pbf" ]; then
  echo "❌ Error en conversión"
  exit 1
fi

rm -f barranquilla-oficial.osm
echo "✅ Conversión completada"
echo "   Archivo PBF: $(ls -lh barranquilla-oficial.osm.pbf | awk '{print $5}')"


# ========== PROCESAR CON OSRM ==========
echo ""
echo "⚙️ ========================================="
echo "⚙️ PROCESANDO MAPA CON OSRM"
echo "⚙️ ========================================="
echo ""
echo "   Algoritmo: MLD (Multi-Level Dijkstra)"
echo "   Perfil: Car (automóviles)"
echo "   Tiempo estimado: 3-8 minutos"
echo ""

echo "📍 Paso 1/3: Extracción de datos de rutas..."
if ! docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/barranquilla-oficial.osm.pbf; then
  echo "❌ Error en extracción OSRM"
  echo "💡 Verifica los logs arriba para más detalles"
  exit 1
fi
echo "✅ Extracción completada"

echo ""
echo "🗂️ Paso 2/3: Particionamiento de grafo..."
if ! docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-partition /data/barranquilla-oficial.osrm; then
  echo "❌ Error en particionamiento OSRM"
  exit 1
fi
echo "✅ Particionamiento completado"

echo ""
echo "🎨 Paso 3/3: Personalización de rutas..."
if ! docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-customize /data/barranquilla-oficial.osrm; then
  echo "❌ Error en personalización OSRM"
  exit 1
fi
echo "✅ Personalización completada"

echo ""
echo "✅ Procesamiento OSRM completado exitosamente"

# Limpiar archivos temporales (mantener PBF para tile server y cálculo de centroides)
echo ""
echo "🧹 Limpiando archivos temporales..."
rm -f /tmp/overpass_query.txt /tmp/overpass_query_alt.txt

echo ""
echo "💾 Espacio utilizado:"
du -sh ${OSRM_DIR}
echo ""
echo "📂 Archivos finales:"
ls -lh ${OSRM_DIR}/ | grep barranquilla-oficial

echo ""
echo "🚀 ========================================="
echo "🚀 INICIANDO SERVIDOR OSRM"
echo "🚀 ========================================="

# Detener contenedor anterior si existe
docker stop osrm-backend 2>/dev/null || true
docker rm osrm-backend 2>/dev/null || true

# Iniciar servidor OSRM en puerto 5001
echo "   Puerto: 5001"
echo "   Algoritmo: MLD"
echo "   Auto-reinicio: Habilitado"
echo ""

docker run -d --name osrm-backend \
  --restart unless-stopped \
  -p 5001:5000 \
  -v "${PWD}:/data" \
  ghcr.io/project-osrm/osrm-backend \
  osrm-routed --algorithm mld /data/barranquilla-oficial.osrm

# Esperar a que OSRM esté listo
echo "⏳ Esperando que OSRM esté listo..."
for i in {1..40}; do
  if curl -s -f "http://localhost:5001/nearest/v1/driving/-74.81,10.99" > /dev/null 2>&1; then
    echo ""
    echo "✅ OSRM está funcionando correctamente"
    break
  fi
  if [ $i -eq 40 ]; then
    echo ""
    echo "❌ Timeout esperando OSRM. Ver logs:"
    docker logs osrm-backend --tail 50
    exit 1
  fi
  echo -n "."
  sleep 3
done

echo ""
echo "🔧 Configurando servicio systemd para auto-inicio..."

# Crear servicio systemd
sudo tee /etc/systemd/system/osrm.service > /dev/null << SERVICEEOF
[Unit]
Description=OSRM Backend Service - Barranquilla Oficial
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=${CURRENT_USER}
Restart=always
RestartSec=10
ExecStartPre=-/usr/bin/docker stop osrm-backend
ExecStartPre=-/usr/bin/docker rm osrm-backend
ExecStart=/usr/bin/docker run --rm --name osrm-backend -p 5001:5000 -v ${OSRM_DIR}:/data ghcr.io/project-osrm/osrm-backend osrm-routed --algorithm mld /data/barranquilla-oficial.osrm
ExecStop=/usr/bin/docker stop osrm-backend

[Install]
WantedBy=multi-user.target
SERVICEEOF

sudo systemctl daemon-reload
sudo systemctl enable osrm

echo "✅ Servicio systemd configurado"

# Prueba final exhaustiva
echo ""
echo "🧪 ========================================="
echo "🧪 PRUEBA EXHAUSTIVA DE SNAP-TO-ROADS"
echo "🧪 ========================================="
echo ""

# Probar con diferentes ubicaciones representativas de Barranquilla
TEST_POINTS=(
  "-74.7818,10.9876"  # Centro Histórico
  "-74.8065,10.9352"  # Suroriente
  "-74.8250,10.9630"  # Suroccidente
  "-74.7523,10.9741"  # Norte - Riomar
  "-74.7889,10.9198"  # Sur - Las Nieves
)

echo "📍 Probando snap-to-roads en 5 ubicaciones clave:"
for point in "${TEST_POINTS[@]}"; do
  lon=$(echo $point | cut -d',' -f1)
  lat=$(echo $point | cut -d',' -f2)
  echo ""
  echo "   Ubicación: ($lat, $lon)"
  RESPONSE=$(curl -s "http://localhost:5001/nearest/v1/driving/$lon,$lat")

  if echo "$RESPONSE" | grep -q '"code":"Ok"'; then
    SNAPPED_LAT=$(echo "$RESPONSE" | grep -o '"location":\[[^]]*\]' | head -1 | grep -o '[0-9.-]*' | tail -1)
    SNAPPED_LON=$(echo "$RESPONSE" | grep -o '"location":\[[^]]*\]' | head -1 | grep -o '[0-9.-]*' | head -1)
    DISTANCE=$(echo "$RESPONSE" | grep -o '"distance":[0-9.-]*' | head -1 | grep -o '[0-9.-]*')

    echo "   ✅ Ajustado a: ($SNAPPED_LAT, $SNAPPED_LON)"
    echo "   📏 Distancia: ${DISTANCE}m"
  else
    echo "   ❌ No se pudo ajustar (fuera del mapa)"
  fi
done

echo ""
echo "========================================="
echo "✅ INSTALACIÓN COMPLETADA"
echo "========================================="
echo ""
echo "📊 INFORMACIÓN DEL SISTEMA:"
echo "   - Contenedor: osrm-backend"
echo "   - Puerto: 5001 (host) → 5000 (contenedor)"
echo "   - Datos: ${OSRM_DIR}"
echo "   - Área: Barranquilla Oficial (166 km²)"
echo "   - Servicio systemd: Habilitado"
echo ""
echo "🗺️ COBERTURA DEL MAPA:"
echo "   ✅ Todo el municipio de Barranquilla"
echo "   ✅ Todas las vías principales y secundarias"
echo "   ✅ Calles residenciales"
echo "   ✅ Vías de servicio"
echo ""
echo "🔗 ENDPOINTS DISPONIBLES:"
echo "   - Nearest: http://localhost:5001/nearest/v1/driving/{lon},{lat}"
echo "   - Route: http://localhost:5001/route/v1/driving/{coords}"
echo "   - Match: http://localhost:5001/match/v1/driving/{coords}"
echo ""
echo "🛠️ COMANDOS ÚTILES:"
echo "   - Ver logs: docker logs -f osrm-backend"
echo "   - Reiniciar: docker restart osrm-backend"
echo "   - Estado: docker ps | grep osrm"
echo "   - Detener: docker stop osrm-backend"
echo "   - Servicio: sudo systemctl status osrm"
echo "========================================="
