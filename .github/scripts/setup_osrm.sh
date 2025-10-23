#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ CONFIGURANDO OSRM - BARRANQUILLA OFICIAL"
echo "🗺️ ========================================="

# VERIFICAR SI EL MAPA ACTUAL ES EL CORRECTO
OSRM_DIR="/opt/osrm-data"
CURRENT_MAP="$OSRM_DIR/barranquilla-oficial.osrm"

# Si existe el contenedor pero NO existe el mapa nuevo, forzar reinstalación
if docker ps 2>/dev/null | grep -q osrm-backend && [ ! -f "$CURRENT_MAP" ]; then
    echo "🔄 Contenedor OSRM corriendo pero con mapa antiguo. Forzando reinstalación..."
    docker stop osrm-backend 2>/dev/null || true
    docker rm osrm-backend 2>/dev/null || true
    sudo rm -f $OSRM_DIR/puerto-barranquilla.*
    FORCE_REINSTALL=true
elif docker ps 2>/dev/null | grep -q osrm-backend && [ -f "$CURRENT_MAP" ]; then
    echo "✅ OSRM ya está corriendo con mapa de Barranquilla oficial"
    docker ps | grep osrm-backend
    echo ""
    echo "🧪 Probando conectividad OSRM..."
    if curl -s -f http://localhost:5001/nearest/v1/driving/-74.8,10.98 > /dev/null 2>&1; then
        echo "✅ OSRM responde correctamente"
    else
        echo "⚠️ OSRM no responde, reiniciando..."
        docker restart osrm-backend
        sleep 5
    fi
    exit 0
else
    echo "🆕 Instalando OSRM desde cero..."
    FORCE_REINSTALL=true
fi

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

# ========== VERIFICAR Y ELIMINAR MAPA ANTIGUO ==========
echo "🔍 Verificando mapa actual..."

# Verificar si existe el mapa antiguo del puerto
if [ -f "/opt/osrm-data/puerto-barranquilla.osrm" ] || docker ps 2>/dev/null | grep -q osrm-backend; then
  echo "🗑️  Eliminando mapa antiguo del puerto y contenedor..."
  
  # Detener y eliminar contenedor
  docker stop osrm-backend 2>/dev/null || true
  docker rm osrm-backend 2>/dev/null || true
  
  # Eliminar archivos del mapa antiguo
  sudo rm -f /opt/osrm-data/puerto-barranquilla.*
  sudo rm -f /opt/osrm-data/barranquilla-oficial.* 2>/dev/null || true
  
  echo "✅ Mapa antiguo y contenedor eliminados"
  FORCE_REINSTALL=true
else
  echo "✅ No se encontró mapa antiguo, procediendo con instalación nueva"
  FORCE_REINSTALL=false
fi

echo ""
echo "📥 ========================================="
echo "📥 DESCARGANDO MAPA OFICIAL DE BARRANQUILLA"
echo "📥 ========================================="
echo ""
echo "🗺️ Método: Relación administrativa oficial"
echo "   ID Relación: 1335179"
echo "   Área: 166 km² (Municipio completo)"
echo "   Fuente: OpenStreetMap - Relación oficial"
echo ""

# Limpiar descargas previas
rm -f barranquilla-oficial.osm barranquilla-oficial.osm.pbf

# Query de Overpass CORREGIDA para obtener TODAS las calles dentro del límite oficial de Barranquilla
OVERPASS_QUERY='[out:xml][timeout:600];
(
  relation(1335179);
  map_to_area;
  way(area)["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|pedestrian|track|road)$"];
  >;
);
out body;'

echo "$OVERPASS_QUERY" > /tmp/overpass_query.txt

MAX_ATTEMPTS=3
ATTEMPT=1

echo "🌐 Descargando mapa oficial de Barranquilla desde Overpass API..."
echo "   (Esto puede tardar 2-5 minutos debido al área completa)"
echo ""

until curl -L --connect-timeout 300 --max-time 600 \
  --retry 3 --retry-delay 15 \
  -d @/tmp/overpass_query.txt \
  "https://overpass-api.de/api/interpreter" \
  -o barranquilla-oficial.osm; do

  if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
    echo ""
    echo "❌ Error: No se pudo descargar desde Overpass API después de $MAX_ATTEMPTS intentos"
    echo "💡 Intentando método alternativo con bounding box..."
    
    # Método alternativo: bounding box conservadora basada en la relación
    OVERPASS_QUERY_ALT='[out:xml][timeout:300][bbox:10.87,-74.93,11.08,-74.72];
    (
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|pedestrian|track|road)$"];
      >;
    );
    out body;'
    
    echo "$OVERPASS_QUERY_ALT" > /tmp/overpass_query_alt.txt
    
    curl -L --connect-timeout 300 --max-time 600 \
      -d @/tmp/overpass_query_alt.txt \
      "https://overpass-api.de/api/interpreter" \
      -o barranquilla-oficial.osm
    break
  fi
  
  echo ""
  echo "⚠️ Intento $ATTEMPT de $MAX_ATTEMPTS falló"
  echo "   Esperando 30 segundos antes de reintentar..."
  ATTEMPT=$((ATTEMPT+1))
  sleep 30
  rm -f barranquilla-oficial.osm
done

# Verificar que el archivo se descargó correctamente
if [ ! -f "barranquilla-oficial.osm" ] || [ ! -s "barranquilla-oficial.osm" ]; then
  echo "❌ Error: No se pudo descargar el mapa de Barranquilla"
  echo "💡 Intentando descargar Colombia completo y extraer Barranquilla..."
  
  wget -O colombia-latest.osm.pbf https://download.geofabrik.de/south-america/colombia-latest.osm.pbf
  
  # Bounding box basada en la relación oficial (aproximada)
  osmium extract --bbox -74.93,10.87,-74.72,11.08 colombia-latest.osm.pbf -o barranquilla-oficial.osm.pbf
  rm -f colombia-latest.osm.pbf
  
  # Si usamos PBF directamente, saltar conversión
  if [ -f "barranquilla-oficial.osm.pbf" ]; then
    echo "✅ Mapa descargado y extraído exitosamente"
    echo "   Archivo PBF: $(ls -lh barranquilla-oficial.osm.pbf | awk '{print $5}')"
    SKIP_CONVERSION=true
  else
    echo "❌ Error crítico: No se pudo obtener el mapa de Barranquilla"
    exit 1
  fi
else
  echo "✅ Descarga completada exitosamente"
  echo "   Archivo OSM: $(ls -lh barranquilla-oficial.osm | awk '{print $5}')"
  
  # Verificar que el archivo no esté vacío
  FILE_SIZE=$(stat -c%s barranquilla-oficial.osm 2>/dev/null || stat -f%z barranquilla-oficial.osm)
  if [ $FILE_SIZE -lt 100000 ]; then
    echo "⚠️ Archivo muy pequeño ($FILE_SIZE bytes), probablemente vacío"
    echo "💡 Usando método alternativo..."
    rm -f barranquilla-oficial.osm
    
    # Descargar Colombia completo
    wget -O colombia-latest.osm.pbf https://download.geofabrik.de/south-america/colombia-latest.osm.pbf
    osmium extract --bbox -74.93,10.87,-74.72,11.08 colombia-latest.osm.pbf -o barranquilla-oficial.osm.pbf
    rm -f colombia-latest.osm.pbf
    SKIP_CONVERSION=true
  else
    # Convertir OSM a PBF usando osmconvert (más robusto que osmium para archivos grandes)
    echo ""
    echo "🔄 Convirtiendo formato OSM a PBF..."
    
    # Usar osmconvert que es más robusto con archivos grandes y complejos
    if command -v osmconvert &> /dev/null; then
      echo "   Usando osmconvert (recomendado para archivos grandes)..."
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
    SKIP_CONVERSION=false
  fi
fi

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

# Limpiar archivo .osm.pbf para ahorrar espacio
echo ""
echo "🧹 Limpiando archivos temporales..."
rm -f barranquilla-oficial.osm.pbf /tmp/overpass_query.txt /tmp/overpass_query_alt.txt

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
MAX_RETRIES=10
RETRY=0
OSRM_READY=false

while [ $RETRY -lt $MAX_RETRIES ]; do
  if curl -s -f http://localhost:5001/nearest/v1/driving/-74.8,10.98 > /dev/null 2>&1; then
    echo "✅ OSRM responde correctamente"
    OSRM_READY=true
    break
  else
    RETRY=$((RETRY + 1))
    if [ $RETRY -lt $MAX_RETRIES ]; then
      echo "⏳ Esperando a OSRM (intento $RETRY/$MAX_RETRIES)..."
      sleep 2
    fi
  fi
done

if [ "$OSRM_READY" = false ]; then
  echo "❌ OSRM no responde después de $MAX_RETRIES intentos"
  echo "Logs del contenedor:"
  docker logs osrm-backend
  exit 1
fi

# Test adicional de routing
echo "🧪 Probando endpoint de routing..."
TEST_RESULT=$(curl -s "http://localhost:5001/route/v1/driving/-74.8,10.98;-74.79,10.99?overview=false")

if echo "$TEST_RESULT" | grep -q "\"code\":\"Ok\""; then
  echo "✅ Endpoint de routing funciona correctamente"
else
  echo "⚠️ Advertencia: Endpoint de routing no responde como se esperaba"
  echo "Respuesta: $TEST_RESULT"
fi

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

echo ""
echo "========================================="
echo "🎉 OSRM CONFIGURADO EXITOSAMENTE"
echo "========================================="
echo ""
echo "📊 INFORMACIÓN:"
echo "   - Área: Barranquilla Oficial (166 km²)"
echo "   - Método: Relación administrativa completa"
echo "   - Puerto: 5001 (interno: 5000)"
echo "   - Contenedor: osrm-backend"
echo "   - Estado: Corriendo"
echo "   - Servicio systemd: Habilitado"
echo ""
echo "🗺️ COBERTURA DEL MAPA:"
echo "   ✅ Todo el municipio de Barranquilla"
echo "   ✅ Todas las vías principales y secundarias"
echo "   ✅ Calles residenciales"
echo "   ✅ Vías de servicio"
echo ""
echo "🔗 ENDPOINTS DISPONIBLES:"
echo "   - /nearest - Punto más cercano en red"
echo "   - /route - Ruta entre puntos"
echo "   - /match - Map matching"
echo "   - /table - Matriz de distancias"
echo ""
echo "🧪 TEST:"
echo "   curl http://localhost:5001/nearest/v1/driving/-74.8,10.98"
echo ""
echo "🛠️ COMANDOS ÚTILES:"
echo "   - Ver logs: docker logs -f osrm-backend"
echo "   - Reiniciar: docker restart osrm-backend"
echo "   - Detener: docker stop osrm-backend"
echo "   - Estado: docker ps | grep osrm"
echo "   - Servicio: sudo systemctl status osrm"
echo "========================================"