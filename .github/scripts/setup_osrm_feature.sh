#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ CONFIGURANDO OSRM - SOLO HIGHWAYS"
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

# Instalar herramientas OSM
if ! command -v osmium &> /dev/null || ! command -v osmconvert &> /dev/null; then
  echo "🔧 Instalando osmium-tool y osmctools..."
  sudo apt-get update -qq
  sudo apt-get install -y osmium-tool osmctools
  echo "✅ Herramientas OSM instaladas"
else
  echo "✅ Herramientas OSM ya están instaladas"
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

# Crear directorio para datos OSRM
echo "📁 Creando directorio: ${OSRM_DIR}"
sudo mkdir -p ${OSRM_DIR}
sudo chown ${CURRENT_USER}:${CURRENT_USER} ${OSRM_DIR}
cd ${OSRM_DIR}

# ========== LIMPIAR ARCHIVOS ANTERIORES ==========
echo "🧹 Limpiando mapas anteriores..."
docker stop osrm-backend 2>/dev/null || true
docker rm osrm-backend 2>/dev/null || true

sudo rm -f /opt/osrm-data/puerto-barranquilla.*
sudo rm -f /opt/osrm-data/barranquilla-oficial.*
sudo rm -f /opt/osrm-data/colombia-latest.osm.pbf
sudo rm -f /tmp/overpass_*.txt

echo "✅ Limpieza completa realizada"

echo ""
echo "🛣️ ========================================="
echo "🛣️ DESCARGANDO SOLO HIGHWAYS DE BARRANQUILLA"
echo "🛣️ ========================================="
echo ""
echo "🎯 Objetivo: Solo calles para routing (sin edificios/relaciones complejas)"
echo "   Ventaja: Archivo pequeño, sin errores de anidamiento XML"
echo ""

# Función para validar archivo OSM
validate_osm_file() {
    local file=$1
    local min_size=200000  # 200KB mínimo (highways son menos datos)
    
    if [ ! -f "$file" ]; then
        echo "❌ Archivo no existe: $file"
        return 1
    fi
    
    local file_size=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo 0)
    
    if [ $file_size -lt $min_size ]; then
        echo "❌ Archivo muy pequeño: $file_size bytes (mínimo: $min_size)"
        return 1
    fi
    
    # Verificar que sea XML válido con contenido OSM
    if ! grep -q "<osm" "$file" 2>/dev/null; then
        echo "❌ Archivo no contiene datos OSM válidos"
        return 1
    fi
    
    # Verificar que tenga highways
    local way_count=$(grep -c "<way" "$file" 2>/dev/null || echo 0)
    if [ $way_count -lt 20 ]; then
        echo "❌ Archivo con muy pocas calles: $way_count (mínimo: 20)"
        return 1
    fi
    
    echo "✅ Archivo válido: $file_size bytes, $way_count ways"
    return 0
}

# Limpiar descargas previas
rm -f barranquilla-oficial.osm barranquilla-oficial.osm.pbf

echo "🛣️ Descargando SOLO highways de Barranquilla..."

# ✅ TU QUERY ESPECÍFICA ORIGINAL (solo highways)
OVERPASS_QUERY='[out:xml][timeout:600];
(
  relation(1335179);
  map_to_area;
  way(area)["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|pedestrian|track|road)$"];
  >;
);
out body;'

echo "$OVERPASS_QUERY" > /tmp/overpass_query.txt

echo "   Query: Solo highways específicos (motorway, trunk, primary, etc.)"
echo "   Tiempo estimado: 1-3 minutos (archivo mucho más pequeño)"

MAX_ATTEMPTS=2
ATTEMPT=1
DOWNLOAD_SUCCESS=false

while [ $ATTEMPT -le $MAX_ATTEMPTS ] && [ "$DOWNLOAD_SUCCESS" != "true" ]; do
    echo ""
    echo "   Intento $ATTEMPT de $MAX_ATTEMPTS..."
    
    if curl -L --connect-timeout 120 --max-time 400 \
      --retry 1 --retry-delay 15 \
      -d @/tmp/overpass_query.txt \
      "https://overpass-api.de/api/interpreter" \
      -o barranquilla-oficial.osm; then
        
        if validate_osm_file "barranquilla-oficial.osm"; then
            echo "✅ DESCARGA EXITOSA - Solo highways"
            DOWNLOAD_SUCCESS=true
        else
            echo "❌ Descarga corrupta en intento $ATTEMPT"
            rm -f barranquilla-oficial.osm
            ATTEMPT=$((ATTEMPT+1))
            if [ $ATTEMPT -le $MAX_ATTEMPTS ]; then
                echo "   Esperando 30 segundos antes de reintentar..."
                sleep 30
            fi
        fi
    else
        echo "❌ Error de conexión en intento $ATTEMPT"
        rm -f barranquilla-oficial.osm
        ATTEMPT=$((ATTEMPT+1))
    fi
done

# Limpiar archivo de query
rm -f /tmp/overpass_query.txt

# Verificación final
if [ "$DOWNLOAD_SUCCESS" != "true" ]; then
    echo ""
    echo "❌ ERROR CRÍTICO: No se pudo descargar highways de Barranquilla"
    exit 1
fi

echo ""
echo "✅ Descarga de highways completada"
echo "   Archivo OSM: $(ls -lh barranquilla-oficial.osm | awk '{print $5}')"

# ========== CONVERSIÓN A PBF ==========
echo ""
echo "🔄 Convirtiendo highways OSM a PBF..."

# Con solo highways, ambas herramientas deberían funcionar bien
if command -v osmium &> /dev/null; then
  echo "   Usando osmium (archivos simples de highways)..."
  osmium cat barranquilla-oficial.osm -o barranquilla-oficial.osm.pbf --overwrite --input-format=xml
elif command -v osmconvert &> /dev/null; then
  echo "   Usando osmconvert..."
  osmconvert barranquilla-oficial.osm -o=barranquilla-oficial.osm.pbf
else
  echo "❌ Ni osmium ni osmconvert disponibles"
  exit 1
fi

if [ ! -f "barranquilla-oficial.osm.pbf" ]; then
  echo "❌ Error en conversión"
  exit 1
fi

# Limpiar archivo OSM temporal
rm -f barranquilla-oficial.osm
echo "✅ Conversión completada"
echo "   Archivo PBF: $(ls -lh barranquilla-oficial.osm.pbf | awk '{print $5}')"

# ========== PROCESAR CON OSRM ==========
echo ""
echo "⚙️ ========================================="
echo "⚙️ PROCESANDO HIGHWAYS CON OSRM"
echo "⚙️ ========================================="

echo "📍 Paso 1/3: Extracción de datos de rutas..."
if ! docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/barranquilla-oficial.osm.pbf; then
  echo "❌ Error en extracción OSRM"
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

# Limpiar archivo PBF temporal
rm -f barranquilla-oficial.osm.pbf
echo "🧹 Archivos temporales limpiados"

echo ""
echo "🚀 ========================================="
echo "🚀 INICIANDO SERVIDOR OSRM"
echo "🚀 ========================================="

# Detener contenedor anterior si existe
docker stop osrm-backend 2>/dev/null || true
docker rm osrm-backend 2>/dev/null || true

# Iniciar servidor OSRM
docker run -d --name osrm-backend \
  --restart unless-stopped \
  -p 5001:5000 \
  -v "${PWD}:/data" \
  ghcr.io/project-osrm/osrm-backend \
  osrm-routed --algorithm mld /data/barranquilla-oficial.osrm

# Verificar funcionamiento
echo "⏳ Verificando OSRM..."
sleep 10

MAX_RETRIES=15
RETRY=0
OSRM_READY=false

while [ $RETRY -lt $MAX_RETRIES ]; do
  if curl -s -f http://localhost:5001/nearest/v1/driving/-74.8,10.98 > /dev/null 2>&1; then
    echo "✅ OSRM funcionando correctamente"
    OSRM_READY=true
    break
  else
    RETRY=$((RETRY + 1))
    if [ $RETRY -lt $MAX_RETRIES ]; then
      echo "⏳ Esperando OSRM (intento $RETRY/$MAX_RETRIES)..."
      sleep 3
    fi
  fi
done

if [ "$OSRM_READY" = false ]; then
    echo "❌ OSRM no responde después de $MAX_RETRIES intentos"
    docker logs osrm-backend --tail 20
    exit 1
fi

# Test de routing
echo "🧪 Probando routing entre dos puntos..."
TEST_RESULT=$(curl -s "http://localhost:5001/route/v1/driving/-74.8,10.98;-74.79,10.99?overview=false")

if echo "$TEST_RESULT" | grep -q "\"code\":\"Ok\""; then
  echo "✅ Routing funciona correctamente"
else
  echo "⚠️ Advertencia: Routing no responde como se esperaba"
fi

# Configurar servicio systemd
echo "🔧 Configurando servicio systemd..."
sudo tee /etc/systemd/system/osrm.service > /dev/null << SERVICEEOF
[Unit]
Description=OSRM Backend Service - Barranquilla Highways
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
echo "🎉 OSRM INSTALADO EXITOSAMENTE"
echo "========================================="
echo ""
echo "✅ OSRM: Puerto 5001 (solo highways)"
echo "✅ Datos: Barranquilla highways específicos"
echo "✅ Archivo: Pequeño y eficiente"
echo "✅ Auto-inicio: Habilitado"
echo ""
echo "🛣️ COBERTURA:"
echo "   ✅ Todas las calles de routing"
echo "   ✅ Sin edificios/relaciones complejas"
echo "   ✅ Optimizado para snap-to-roads"
echo ""
echo "🧪 Prueba: curl http://localhost:5001/nearest/v1/driving/-74.8,10.98"
echo ""
echo "📋 PRÓXIMO PASO: Configurar Tile Server por separado"
echo "   (Para tiles necesitarás descargar mapa completo con edificios)"
echo "========================================"