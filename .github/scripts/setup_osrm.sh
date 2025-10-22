#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ CONFIGURANDO OSRM - PUERTO DE BARRANQUILLA"
echo "🗺️ ========================================="

# Verificar si OSRM ya está instalado y corriendo
if docker ps 2>/dev/null | grep -q osrm-backend; then
  echo "✅ OSRM ya está corriendo correctamente"
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

# Instalar osmium-tool para convertir formatos
if ! command -v osmium &> /dev/null; then
  echo "🔧 Instalando osmium-tool..."
  sudo apt-get update -qq
  sudo apt-get install -y osmium-tool
  echo "✅ osmium-tool instalado"
else
  echo "✅ osmium-tool ya está instalado"
fi

# ========== PERMISOS DE DOCKER ==========
echo "🔧 Configurando permisos de Docker..."

if ! groups $USER | grep -q docker; then
  echo "   Agregando usuario '$USER' al grupo docker..."
  sudo usermod -aG docker $USER
else
  echo "   Usuario '$USER' ya está en el grupo docker"
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
sudo chown $USER:$USER ${OSRM_DIR}
cd ${OSRM_DIR}

# Verificar si el mapa del puerto ya está procesado
if [ -f "puerto-barranquilla.osrm" ]; then
  echo "✅ Mapa del puerto ya procesado, saltando descarga"
else
  echo ""
  echo "📥 ========================================="
  echo "📥 DESCARGANDO MAPA DEL PUERTO"
  echo "📥 ========================================="
  echo ""
  echo "🗺️ Método: Overpass API con IDs específicos"
  echo "   Área: Puerto de Barranquilla"
  echo "   Calles: ~75 vías específicas"
  echo "   Nodos: 6 nodos clave"
  echo "   Fuente: OpenStreetMap"
  echo ""
  
  # Limpiar descargas previas
  rm -f puerto-barranquilla.osm puerto-barranquilla.osm.pbf
  
  # Descargar usando Overpass API con los IDs exactos del puerto
  MAX_ATTEMPTS=5
  ATTEMPT=1

  echo "🌐 Descargando desde Overpass API..."
  echo "   (Esto debería tardar 10-20 segundos)"
  echo ""

  # Query optimizada con los IDs exactos de las calles del puerto
  OVERPASS_QUERY='[out:xml][timeout:90];(way(id:110447827,962055972,183530006,100301189,250255381,1007963947,99509101,1211032219,1211032217,1211032218,1211032224,1211032225,1211032220,1141049217,1007248971,1007248970,100301186,613384233,1005153829,613384205,613384208,613384207,613384206,1006086573,1006126955,613384225,613384224,613384223,613384222,613384221,1006086571,1006086572,1006039189,613384220,1006039191,1007626213,1006039190,613384218,613384217,626724241,626724245,626724242,613384231,613384216,613384219,613384226,1006042462,613384227,613384228,613384204,1006042461,1007581441,1006039193,1006039192,1006042459,1007537492,1057537489,1007603926,1007603925,1211032216,1006062382,1006062385,1006062384,1006062383,1006062386,626724235,626724233,626724238,1007538907,1007538908,962055977,962055976,613384209);node(id:6402440891,1939277496,8899212525,1939277480,9282142137,9295853166););(._;>;);out body;'

  echo "$OVERPASS_QUERY" > /tmp/overpass_query.txt
  
  MAX_ATTEMPTS=5
  ATTEMPT=1

  until curl -L --connect-timeout 60 --max-time 120 \
    --retry 3 --retry-delay 5 \
    -d @/tmp/overpass_query.txt \
    "https://overpass-api.de/api/interpreter" \
    -o puerto-barranquilla.osm; do
    
    if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
      echo ""
      echo "❌ Error: No se pudo descargar desde Overpass API"
      exit 1
    fi
    
    echo ""
    echo "⚠️ Intento $ATTEMPT de $MAX_ATTEMPTS falló"
    echo "   Esperando 15 segundos antes de reintentar..."
    ATTEMPT=$((ATTEMPT+1))
    sleep 15
    rm -f puerto-barranquilla.osm
  done

  echo ""
  echo "✅ Descarga completada desde Overpass API"
  FILE_SIZE=$(stat -c%s puerto-barranquilla.osm 2>/dev/null || stat -f%z puerto-barranquilla.osm)

  if [ $FILE_SIZE -lt 10000 ]; then
    echo "⚠️ Archivo muy pequeño ($FILE_SIZE bytes)"
    
    # Intentar descomprimir si está en gzip
    if file puerto-barranquilla.osm | grep -q "gzip"; then
      echo "   Detectado formato gzip, descomprimiendo..."
      mv puerto-barranquilla.osm puerto-barranquilla.osm.gz
      gunzip puerto-barranquilla.osm.gz
      FILE_SIZE=$(stat -c%s puerto-barranquilla.osm 2>/dev/null || stat -f%z puerto-barranquilla.osm)
    fi
    
    if [ $FILE_SIZE -lt 10000 ]; then
      echo "❌ Archivo demasiado pequeño después de descomprimir"
      cat puerto-barranquilla.osm | head -20
      exit 1
    fi
  fi

  echo "   Tamaño del archivo: $FILE_SIZE bytes"
  
  # Validar estructura XML básica
  if ! head -1 puerto-barranquilla.osm | grep -q "<?xml"; then
    echo "⚠️ Archivo no parece XML válido"
    echo "   Primeras líneas:"
    head -5 puerto-barranquilla.osm
    exit 1
  fi
  
  echo "✅ Archivo XML válido"
  
  # Contar elementos del mapa
  WAY_COUNT=$(grep -c '<way ' puerto-barranquilla.osm || echo "0")
  NODE_COUNT=$(grep -c '<node ' puerto-barranquilla.osm || echo "0")
  
  echo "📊 Elementos en el mapa:"
  echo "   - Ways (calles): $WAY_COUNT"
  echo "   - Nodes (puntos): $NODE_COUNT"
  
  if [ $WAY_COUNT -lt 50 ]; then
    echo "⚠️ Advertencia: Menos ways de lo esperado (~75)"
  fi
  
  # Convertir a formato .osm.pbf (más eficiente)
  echo ""
  echo "🔄 Convirtiendo a formato PBF..."
  if osmium cat puerto-barranquilla.osm -o puerto-barranquilla.osm.pbf; then
    echo "✅ Conversión a PBF exitosa"
    
    # Verificar tamaño del PBF
    PBF_SIZE=$(stat -c%s puerto-barranquilla.osm.pbf 2>/dev/null || stat -f%z puerto-barranquilla.osm.pbf)
    echo "   Tamaño PBF: $PBF_SIZE bytes"
  else
    echo "⚠️ Falló conversión a PBF, usando OSM directamente"
  fi
fi

# ========== PROCESAR MAPA CON OSRM ==========
echo ""
echo "⚙️  ========================================="
echo "⚙️  PROCESANDO MAPA CON OSRM"
echo "⚙️  ========================================="

# Verificar si ya está procesado
if [ -f "puerto-barranquilla.osrm" ]; then
  echo "✅ Mapa ya procesado, saltando preprocesamiento"
else
  echo "🔧 Preprocesando mapa (esto puede tardar 1-2 minutos)..."
  
  # Determinar qué archivo usar
  if [ -f "puerto-barranquilla.osm.pbf" ]; then
    INPUT_FILE="puerto-barranquilla.osm.pbf"
    echo "   Usando archivo PBF"
  else
    INPUT_FILE="puerto-barranquilla.osm"
    echo "   Usando archivo OSM"
  fi
  
  # Extraer datos de routing
  echo "   Paso 1/3: Extrayendo datos de routing..."
  if ! docker run -t --rm \
    -v "${PWD}:/data" \
    ghcr.io/project-osrm/osrm-backend:latest \
    osrm-extract -p /opt/car.lua /data/${INPUT_FILE}; then
    echo "❌ Error en osrm-extract"
    exit 1
  fi
  echo "   ✅ Extracción completada"
  
  # Particionar el grafo
  echo "   Paso 2/3: Particionando grafo..."
  if ! docker run -t --rm \
    -v "${PWD}:/data" \
    ghcr.io/project-osrm/osrm-backend:latest \
    osrm-partition /data/puerto-barranquilla.osrm; then
    echo "❌ Error en osrm-partition"
    exit 1
  fi
  echo "   ✅ Particionado completado"
  
  # Customizar el grafo
  echo "   Paso 3/3: Customizando grafo..."
  if ! docker run -t --rm \
    -v "${PWD}:/data" \
    ghcr.io/project-osrm/osrm-backend:latest \
    osrm-customize /data/puerto-barranquilla.osrm; then
    echo "❌ Error en osrm-customize"
    exit 1
  fi
  echo "   ✅ Customización completada"
  
  echo ""
  echo "✅ ========================================="
  echo "✅ MAPA PROCESADO EXITOSAMENTE"
  echo "✅ ========================================="
fi

# ========== INICIAR SERVIDOR OSRM ==========
echo ""
echo "🚀 ========================================="
echo "🚀 INICIANDO SERVIDOR OSRM"
echo "🚀 ========================================="

# Detener contenedor anterior si existe
if docker ps -a | grep -q osrm-backend; then
  echo "🛑 Deteniendo contenedor anterior..."
  docker stop osrm-backend 2>/dev/null || true
  docker rm osrm-backend 2>/dev/null || true
fi

# Iniciar servidor OSRM
echo "🚀 Iniciando servidor OSRM en puerto 5001..."
docker run -d \
  --name osrm-backend \
  --restart unless-stopped \
  -p 5001:5000 \
  -v "${PWD}:/data" \
  ghcr.io/project-osrm/osrm-backend:latest \
  osrm-routed --algorithm mld /data/puerto-barranquilla.osrm

echo "⏳ Esperando a que OSRM esté listo..."
sleep 5

# Verificar que está corriendo
if docker ps | grep -q osrm-backend; then
  echo "✅ Contenedor OSRM corriendo"
else
  echo "❌ Error: Contenedor OSRM no está corriendo"
  docker logs osrm-backend
  exit 1
fi

# Test de conectividad
echo ""
echo "🧪 ========================================="
echo "🧪 PRUEBAS DE CONECTIVIDAD"
echo "🧪 ========================================="

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

# Resumen final
echo ""
echo "========================================="
echo "🎉 OSRM CONFIGURADO EXITOSAMENTE"
echo "========================================="
echo ""
echo "📊 INFORMACIÓN:"
echo "   - Área: Puerto de Barranquilla"
echo "   - Calles: ~75 vías específicas"
echo "   - Método: Overpass API con IDs"
echo "   - Puerto: 5001 (interno: 5000)"
echo "   - Contenedor: osrm-backend"
echo "   - Estado: Corriendo"
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
echo "========================================"