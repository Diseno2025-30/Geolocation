#!/bin/bash
set -e

# Recibir parámetros
SUBDOMAIN="${1}"
DOMAIN_BASE="${2}"
INSTANCE_NUM="${3}"
BRANCH_NAME="${4}"
PERSON_NAME="${5}"

echo "🔧 Configuración de despliegue /test:"
echo "   - Rama: ${BRANCH_NAME}"
echo "   - Persona: ${PERSON_NAME}"
echo "   - Subdominio: ${SUBDOMAIN}"
echo "   - Dominio: ${SUBDOMAIN}.${DOMAIN_BASE}"
echo "   - Instancia: ${INSTANCE_NUM}"

# Determinar ruta base del proyecto
if [ -d "/home/ubuntu/Web-server-UDP" ]; then
  BASE_DIR="/home/ubuntu/Web-server-UDP"
else
  BASE_DIR="/opt/location-tracker"
  sudo mkdir -p ${BASE_DIR}
  sudo chown $USER:$USER ${BASE_DIR}
fi

# Crear directorio para la versión test
TEST_DIR="${BASE_DIR}/test"
mkdir -p "${TEST_DIR}"
cd "${TEST_DIR}"

echo "📁 Directorio de test: ${TEST_DIR}"

# Actualizar o clonar el código de la rama
if [ -d .git ]; then
  echo "📦 Actualizando código de la rama ${BRANCH_NAME}..."
  git fetch origin ${BRANCH_NAME}
  git checkout ${BRANCH_NAME}
  git reset --hard origin/${BRANCH_NAME}
  CODE_UPDATED=true
else
  echo "📥 Clonando repositorio en rama ${BRANCH_NAME}..."
  cd ..
  rm -rf test
  mkdir -p test
  cd test
  git clone -b ${BRANCH_NAME} https://github.com/Diseno2025-30/Geolocation.git .
  CODE_UPDATED=true
fi

# Navegar al directorio del proyecto
cd Proyecto_1_Diseno
PROJECT_PATH=$(pwd)

# 🔒 CORRECCIÓN DE PERMISOS PARA NGINX
echo "🔒 Configurando permisos para que Nginx (www-data) pueda acceder..."
chmod o+rx ${BASE_DIR}
chmod o+rx ${TEST_DIR}
chmod o+rx ${PROJECT_PATH}

# Si existe carpeta static, configurar permisos recursivamente
if [ -d "static" ]; then
  find static -type d -exec chmod o+rx {} \;
  find static -type f -exec chmod o+r {} \;
  echo "✅ Permisos configurados para carpeta static"
fi

# Copiar el archivo .env de producción y modificarlo
if [ -f "${BASE_DIR}/Proyecto_1_Diseno/.env" ]; then
  cp "${BASE_DIR}/Proyecto_1_Diseno/.env" .env
fi

# Agregar configuración específica para test
echo "" >> .env
echo "# Configuración de test" >> .env
echo "TEST_MODE=true" >> .env
echo "BRANCH_NAME=${BRANCH_NAME}" >> .env
echo "PERSON_NAME=${PERSON_NAME}" >> .env

FULL_DOMAIN="${SUBDOMAIN}.${DOMAIN_BASE}"
APP_NAME="flask-test-${SUBDOMAIN}"
TEST_PORT=6000

echo "📊 Configuración:"
echo "   - APP_NAME: ${APP_NAME}"
echo "   - Puerto test: ${TEST_PORT}"
echo "   - Proyecto: ${PROJECT_PATH}"

# Instalar dependencias
echo "📦 Instalando dependencias..."
sudo apt-get update -qq
sudo systemctl stop unattended-upgrades 2>/dev/null || true
sudo killall unattended-upgr 2>/dev/null || true
sleep 3
sudo apt-get install -y python3-pip python3-venv nginx build-essential cmake libosmium2-dev libprotozero-dev liblz4-dev libboost-dev

# PM2 si no está instalado
if ! command -v pm2 &> /dev/null; then
  if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
  sudo npm install -g pm2
  pm2 startup systemd -u $USER --hp /home/$USER
fi

# Configurar entorno virtual de Python
echo "🐍 Configurando entorno Python para test..."
if [ ! -d "venv" ]; then
  python3 -m venv venv
fi

source venv/bin/activate
pip install --upgrade pip

# PASO 1: Instalar pyosmium primero (necesita compilación)
echo "🔧 Instalando pyosmium (requiere dependencias del sistema)..."
if pip install osmium; then
  echo "✅ pyosmium instalado correctamente"
else
  echo "❌ ERROR: No se pudo instalar pyosmium"
  echo "📋 Verificando dependencias del sistema..."
  dpkg -l | grep -E "libosmium|libprotozero|liblz4|libboost"
  exit 1
fi

# PASO 2: Instalar el resto desde requirements.txt
if [ -f requirements.txt ]; then
  echo "📦 Instalando dependencias desde requirements.txt..."
  pip install -r requirements.txt
else
  echo "⚠️ ADVERTENCIA: requirements.txt no encontrado"
  echo "📦 Instalando dependencias manualmente..."
  pip install flask psycopg2-binary python-dotenv requests firebase-admin Flask-JWT-Extended
fi

# PASO 3: Verificar que osmium funciona
echo "🧪 Verificando instalación de osmium..."
if python -c "import osmium; print('✅ osmium importado correctamente')"; then
  echo "✅ Todas las dependencias instaladas correctamente"
else
  echo "❌ ERROR: osmium no se puede importar"
  echo "📋 Información del entorno:"
  pip list | grep osmium
  python -c "import sys; print(sys.path)"
  exit 1
fi

# Detener aplicación test anterior si existe
pm2 stop ${APP_NAME} 2>/dev/null || true
pm2 delete ${APP_NAME} 2>/dev/null || true

# Liberar puerto
sudo fuser -k ${TEST_PORT}/tcp 2>/dev/null || true
sleep 2

# Crear script de inicio para test
cat > start_test_app.sh << STARTSCRIPT
#!/bin/bash
cd "\$(dirname "\$0")"
source venv/bin/activate
export FLASK_APP=run.py
export FLASK_ENV=development
python run.py --port ${TEST_PORT}
STARTSCRIPT
chmod +x start_test_app.sh

# Actualizar configuración de Nginx para agregar /test
echo "🌐 Configurando Nginx para /test..."

NGINX_CONF="/etc/nginx/sites-available/location-tracker"

# Crear config base si no existe
if [ ! -f "${NGINX_CONF}" ]; then
  echo "📝 Creando config base de Nginx desde cero..."
  sudo tee ${NGINX_CONF} > /dev/null << NGINXBASE
server {
    listen 80;
    server_name ${FULL_DOMAIN};

    location / {
        proxy_pass http://localhost:6000/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINXBASE
  sudo ln -sf ${NGINX_CONF} /etc/nginx/sites-enabled/location-tracker
  sudo rm -f /etc/nginx/sites-enabled/default
fi

# Eliminar configuraciones de test anteriores (bloques marcados)
sudo sed -i '/# ===== INICIO RUTAS TEST/,/# ===== FIN RUTAS TEST/d' ${NGINX_CONF}

# ✅ FIX: Eliminar bloque /osrm/ con contador de llaves usando Python
# El sed simple no funciona porque el bloque tiene if{} anidados con sus propias llaves
echo "🧹 Eliminando bloque /osrm/ anterior de Nginx..."
sudo python3 - "${NGINX_CONF}" << 'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    lines = f.readlines()

out = []
skip = False
depth = 0
for line in lines:
    if not skip and 'location' in line and '/osrm/' in line:
        skip = True
        depth = 0
    if skip:
        depth += line.count('{') - line.count('}')
        if depth <= 0:
            skip = False
        continue
    out.append(line)

with open(path, 'w') as f:
    f.writelines(out)
print("✅ Bloque /osrm/ eliminado correctamente")
PYEOF

# Crear archivo temporal con las rutas de test
cat > /tmp/nginx-test-inject.conf << NGINXTEST

# ===== INICIO RUTAS TEST =====
# Rama: ${BRANCH_NAME} - Persona: ${PERSON_NAME}
# Actualizado: $(date)

# PROXY PARA OSRM (SNAP-TO-ROADS)
location /osrm/ {
    rewrite ^/osrm/(.*) /\$1 break;
    proxy_pass http://localhost:5001;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;

    # Timeouts para OSRM
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
    proxy_hide_header 'Access-Control-Allow-Origin';

    # CORS para permitir acceso desde JavaScript
    add_header 'Access-Control-Allow-Origin' '*' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range' always;

    # Manejar preflight requests
    if (\$request_method = 'OPTIONS') {
        add_header 'Access-Control-Allow-Origin' '*';
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS';
        add_header 'Access-Control-Max-Age' 1728000;
        add_header 'Content-Type' 'text/plain; charset=utf-8';
        add_header 'Content-Length' 0;
        return 204;
    }
}

# PROXY PARA TILE SERVER
location /tiles/ {
    rewrite ^/tiles/(.*) /$1 break;
    proxy_pass http://localhost:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_buffering off;
    proxy_cache off;
    expires epoch;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    add_header Pragma "no-cache";
    add_header Expires "0";
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Range" always;
}

location = /test {
    return 301 /test/;
}

location /test/static/ {
    alias ${PROJECT_PATH}/static/;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    add_header Pragma "no-cache";
    add_header Expires "0";
}

location /test/ {
    proxy_pass http://localhost:${TEST_PORT}/;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Script-Name /test;
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
    proxy_buffering off;
}

location ~ ^/test/(coordenadas|database|version|health)$ {
    proxy_pass http://localhost:${TEST_PORT}/\$1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
}

# ===== FIN RUTAS TEST =====

NGINXTEST

# Insertar las rutas de test en el servidor HTTPS (no en el HTTP)
sudo awk '
BEGIN {
    in_https_server = 0
    inserted = 0
    brace_count = 0
}

# Detectar inicio de bloque server
/^[[:space:]]*server[[:space:]]*\{/ {
    brace_count = 1
    print
    getline
    # Si la siguiente línea contiene "listen 443", es el servidor HTTPS
    if ($0 ~ /listen 443/ || $0 ~ /listen 80/) {
        in_https_server = 1
    }
    print
    next
}

# Contar llaves para saber cuándo termina el bloque server
in_https_server == 1 {
    if ($0 ~ /\{/) brace_count++
    if ($0 ~ /\}/) brace_count--

    # Si llegamos al cierre del server, ya no estamos en HTTPS
    if (brace_count == 0) {
        in_https_server = 0
    }
}

# Insertar el bloque TEST antes del PRIMER "location /" dentro del servidor HTTPS
in_https_server == 1 && /^[[:space:]]*location[[:space:]]+\/[[:space:]]+\{/ && inserted == 0 {
    # Leer e insertar el archivo de configuraciones TEST
    while ((getline line < "/tmp/nginx-test-inject.conf") > 0) {
        print line
    }
    close("/tmp/nginx-test-inject.conf")
    inserted = 1
    print
    next
}

# Imprimir todas las demás líneas
{ print }
' ${NGINX_CONF} > /tmp/nginx-new.conf

# Verificar que el archivo se creó correctamente
if [ ! -s /tmp/nginx-new.conf ]; then
    echo "❌ Error: El archivo de configuración generado está vacío"
    exit 1
fi

sudo mv /tmp/nginx-new.conf ${NGINX_CONF}
rm -f /tmp/nginx-test-inject.conf

# ✅ FIX: Verificar que las rutas /test fueron inyectadas correctamente
echo "🔍 Verificando inyección de rutas /test en Nginx..."
if ! sudo grep -q "INICIO RUTAS TEST" ${NGINX_CONF}; then
    echo "❌ Error CRÍTICO: Las rutas /test NO fueron inyectadas en Nginx"
    echo "   El awk no encontró 'location / {' dentro del bloque server HTTPS"
    echo ""
    echo "📋 Estructura actual del nginx.conf (bloques server):"
    sudo grep -n "server\|listen\|location" ${NGINX_CONF} | head -40
    exit 1
fi
echo "✅ Rutas /test inyectadas correctamente en Nginx"

# Verificar y recargar Nginx
if sudo nginx -t; then
  sudo systemctl reload nginx
  echo "✅ Nginx configurado para /test, OSRM y Tiles"
else
  echo "❌ Error en configuración de Nginx"
  sudo nginx -t
  exit 1
fi

# Iniciar aplicación con PM2
echo "🚀 Iniciando aplicación de test..."
pm2 start start_test_app.sh \
  --name ${APP_NAME} \
  --interpreter bash \
  --cwd ${PROJECT_PATH} \
  --log-date-format "YYYY-MM-DD HH:mm:ss"

pm2 save

# Esperar y verificar
echo "⏳ Esperando inicio de la aplicación..."
sleep 8

# Verificar que PM2 esté ejecutando el proceso
echo "📊 Estado de PM2:"
pm2 status ${APP_NAME}

# Verificar que el puerto esté en escucha
echo "🔍 Verificando puerto ${TEST_PORT}..."
if sudo ss -tlnp | grep :${TEST_PORT}; then
    echo "✅ Puerto ${TEST_PORT} está en escucha"
else
    echo "❌ Puerto ${TEST_PORT} NO está en escucha"
    echo ""
    echo "📋 Logs de PM2:"
    pm2 logs ${APP_NAME} --lines 50 --nostream
    echo ""
    echo "🔍 Procesos en el puerto ${TEST_PORT}:"
    sudo lsof -i :${TEST_PORT} -P || echo "Ninguno"
    exit 1
fi

# Test de conectividad HTTP
echo "🧪 Probando aplicación HTTP..."
for i in {1..10}; do
    if curl -s -f http://localhost:${TEST_PORT}/ > /dev/null 2>&1; then
        echo "✅ Aplicación respondiendo en puerto ${TEST_PORT}"
        echo "🌐 URL pública: https://${FULL_DOMAIN}/test/"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "❌ La aplicación no responde después de múltiples intentos"
        echo ""
        echo "📋 Últimos logs de la aplicación:"
        pm2 logs ${APP_NAME} --lines 100 --nostream
        echo ""
        echo "🔍 Estado detallado de PM2:"
        pm2 describe ${APP_NAME}
        exit 1
    fi
    echo "Intento $i/10 - esperando..."
    sleep 2
done

# Resumen final
echo ""
echo "========================================="
echo "🎉 AMBIENTE DE TEST DESPLEGADO"
echo "========================================="
echo ""
echo "📊 INFORMACIÓN:"
echo "   - Persona: ${PERSON_NAME}"
echo "   - Rama: ${BRANCH_NAME}"
echo "   - Instancia EC2: ${INSTANCE_NUM}"
echo "   - Aplicación PM2: ${APP_NAME}"
echo "   - Puerto interno: ${TEST_PORT}"
echo "   - OSRM: http://localhost:5001"
echo "   - Tile Server: http://localhost:3001 (NodeJS/PM2)"
echo ""
echo "🔗 URLS:"
echo "   - Producción (main): https://${FULL_DOMAIN}/"
echo "   - Test (${BRANCH_NAME}): https://${FULL_DOMAIN}/test"
echo ""
echo "📍 ENDPOINTS DE TEST:"
echo "   - https://${FULL_DOMAIN}/test/coordenadas"
echo "   - https://${FULL_DOMAIN}/test/database"
echo "   - https://${FULL_DOMAIN}/test/version"
echo "   - https://${FULL_DOMAIN}/test/health"
echo ""
echo "🛠️ COMANDOS ÚTILES:"
echo "   - Ver logs test: pm2 logs ${APP_NAME}"
echo "   - Reiniciar test: pm2 restart ${APP_NAME}"
echo "   - Ver logs prod: pm2 logs flask-app-${SUBDOMAIN}"
echo "   - Estado: pm2 status"
echo "   - OSRM logs: docker logs -f osrm-backend"
echo "   - Tile logs: docker logs -f tile-server"
echo "========================================="