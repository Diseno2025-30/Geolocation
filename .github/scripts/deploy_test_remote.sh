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

if [ -d "static" ]; then
  find static -type d -exec chmod o+rx {} \;
  find static -type f -exec chmod o+r {} \;
  echo "✅ Permisos configurados para carpeta static"
fi

# Copiar el archivo .env de producción y modificarlo
if [ -f "${BASE_DIR}/Proyecto_1_Diseno/.env" ]; then
  cp "${BASE_DIR}/Proyecto_1_Diseno/.env" .env
fi

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
sudo apt-get install -y python3-pip python3-venv nginx build-essential cmake libosmium2-dev libprotozero-dev liblz4-dev libboost-dev certbot python3-certbot-nginx

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

echo "🔧 Instalando pyosmium (requiere dependencias del sistema)..."
if pip install osmium; then
  echo "✅ pyosmium instalado correctamente"
else
  echo "❌ ERROR: No se pudo instalar pyosmium"
  dpkg -l | grep -E "libosmium|libprotozero|liblz4|libboost"
  exit 1
fi

if [ -f requirements.txt ]; then
  echo "📦 Instalando dependencias desde requirements.txt..."
  pip install -r requirements.txt
else
  echo "⚠️ ADVERTENCIA: requirements.txt no encontrado"
  pip install flask psycopg2-binary python-dotenv requests firebase-admin Flask-JWT-Extended
fi

echo "🧪 Verificando instalación de osmium..."
if python -c "import osmium; print('✅ osmium importado correctamente')"; then
  echo "✅ Todas las dependencias instaladas correctamente"
else
  echo "❌ ERROR: osmium no se puede importar"
  pip list | grep osmium
  python -c "import sys; print(sys.path)"
  exit 1
fi

# Detener aplicación test anterior si existe
pm2 stop ${APP_NAME} 2>/dev/null || true
pm2 delete ${APP_NAME} 2>/dev/null || true

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

# =========================================================
# 🌐 CONFIGURACIÓN DE NGINX
# =========================================================
echo "🌐 Configurando Nginx para /test..."

NGINX_CONF="/etc/nginx/sites-available/location-tracker"

# Crear config base si no existe
if [ ! -f "${NGINX_CONF}" ]; then
  echo "📝 Creando config base de Nginx desde cero..."
  # Puerto 5000 = producción (default de run.py)
  # Puerto 6000 = test (TEST_PORT definido en este script)
  PROD_PORT=5000
  sudo tee ${NGINX_CONF} > /dev/null << NGINXBASE
server {
    listen 80;
    server_name ${FULL_DOMAIN};

    # Producción: rama main en puerto ${PROD_PORT}
    location / {
        proxy_pass http://localhost:${PROD_PORT}/;
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

# =========================================================
# 🔧 PASO 1: LIMPIAR RUTAS ANTERIORES CON PYTHON
# sed y awk no son confiables con bloques anidados.
# Python parsea el archivo completo contando llaves.
# =========================================================
echo "🧹 Limpiando rutas de test y bloques anteriores..."
sudo python3 << PYEOF
import re

path = "${NGINX_CONF}"

with open(path) as f:
    lines = f.readlines()

out = []
skip = False
depth = 0
in_marker = False

i = 0
while i < len(lines):
    line = lines[i]

    # Eliminar bloque marcado INICIO/FIN RUTAS TEST
    if '# ===== INICIO RUTAS TEST' in line:
        in_marker = True
    if in_marker:
        if '# ===== FIN RUTAS TEST' in line:
            in_marker = False
        i += 1
        continue

    # Eliminar bloques location /osrm/, /tiles/, /test (redirect y proxy)
    if not skip and 'location' in line and any(p in line for p in ['/osrm/', '/tiles/', '/test']):
        skip = True
        depth = 0

    if skip:
        depth += line.count('{') - line.count('}')
        if depth <= 0:
            skip = False
        i += 1
        continue

    out.append(line)
    i += 1

with open(path, 'w') as f:
    f.writelines(out)

print("✅ Limpieza de rutas anteriores completada")
PYEOF

# =========================================================
# 🔧 PASO 2: GENERAR BLOQUE DE RUTAS TEST
# IMPORTANTE: Variables Nginx escapadas con \$ para que
# bash no las expanda dentro del heredoc.
# =========================================================
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
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
    proxy_hide_header 'Access-Control-Allow-Origin';
    add_header 'Access-Control-Allow-Origin' '*' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range' always;
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
    rewrite ^/tiles/(.*) /\$1 break;
    proxy_pass http://localhost:3001;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
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

# =========================================================
# 🔧 PASO 3: INYECTAR RUTAS EN EL BLOQUE SERVER CON PYTHON
#
# FIX PRINCIPAL: El awk anterior asumía que "listen 443"
# estaba en la línea inmediatamente después de "server {".
# Certbot reorganiza el archivo: pone server_name primero
# y listen 443 ssl puede aparecer 40+ líneas después.
#
# Este script Python escanea el bloque COMPLETO para saber
# si contiene listen 443 o listen 80, y luego inyecta
# las rutas antes del primer "location / {" encontrado.
# =========================================================
echo "🔍 Inyectando rutas /test en el bloque server correcto..."
sudo python3 << PYEOF
import sys
import re

nginx_conf  = "${NGINX_CONF}"
inject_file = "/tmp/nginx-test-inject.conf"

with open(nginx_conf) as f:
    lines = f.readlines()

with open(inject_file) as f:
    inject_lines = f.readlines()

# ----------------------------------------------------------
# Función: encontrar todos los bloques server {} del archivo
# Devuelve lista de (start_idx, end_idx, has_443, has_80)
# ----------------------------------------------------------
def find_server_blocks(lines):
    blocks = []
    i = 0
    while i < len(lines):
        # Detectar inicio de bloque server
        if re.match(r'\s*server\s*\{', lines[i]):
            start = i
            depth = lines[i].count('{') - lines[i].count('}')
            i += 1
            while i < len(lines) and depth > 0:
                depth += lines[i].count('{') - lines[i].count('}')
                i += 1
            end = i - 1
            content = ''.join(lines[start:end+1])
            has_443 = bool(re.search(r'listen\s+443', content))
            has_80  = bool(re.search(r'listen\s+80',  content))
            blocks.append((start, end, has_443, has_80))
        else:
            i += 1
    return blocks

blocks = find_server_blocks(lines)

if not blocks:
    print("❌ No se encontraron bloques server en", nginx_conf)
    sys.exit(1)

print(f"📋 Bloques server encontrados: {len(blocks)}")
for b in blocks:
    print(f"   líneas {b[0]+1}-{b[1]+1} | listen 443={b[2]} | listen 80={b[3]}")

# Elegir bloque objetivo:
# Preferir 443 (HTTPS generado por certbot) sobre 80.
target_block = None
for b in blocks:
    if b[2]:  # has listen 443
        target_block = b
        break
if target_block is None:
    for b in blocks:
        if b[3]:  # has listen 80
            target_block = b
            break

if target_block is None:
    print("❌ No se encontró ningún bloque server con listen 80 o listen 443")
    sys.exit(1)

print(f"✅ Bloque objetivo: líneas {target_block[0]+1}-{target_block[1]+1}")

# ----------------------------------------------------------
# Encontrar el primer "location / {" dentro del bloque
# e inyectar las rutas de test justo antes de él.
# Si no existe ese location, inyectar antes del cierre }.
# ----------------------------------------------------------
start_idx, end_idx = target_block[0], target_block[1]
inject_at = None

for i in range(start_idx, end_idx + 1):
    if re.match(r'\s*location\s+/\s*\{', lines[i]):
        inject_at = i
        break

if inject_at is None:
    print("⚠️  No se encontró 'location / {', inyectando antes del cierre del bloque server")
    inject_at = end_idx  # justo antes del cierre }

# Reconstruir archivo con la inyección
new_lines = lines[:inject_at] + inject_lines + lines[inject_at:]

with open(nginx_conf, 'w') as f:
    f.writelines(new_lines)

print(f"✅ Rutas /test inyectadas correctamente antes de la línea {inject_at + 1}")
PYEOF

# Limpiar archivo temporal
rm -f /tmp/nginx-test-inject.conf

# Verificar inyección
echo "🔍 Verificando inyección de rutas /test en Nginx..."
if ! sudo grep -q "INICIO RUTAS TEST" ${NGINX_CONF}; then
    echo "❌ Error CRÍTICO: Las rutas /test NO fueron inyectadas"
    sudo grep -n "server\|listen\|location" ${NGINX_CONF} | head -50
    exit 1
fi
echo "✅ Rutas /test inyectadas correctamente en Nginx"

# Verificar y recargar Nginx
if sudo nginx -t; then
  sudo systemctl reload nginx
  echo "✅ Nginx recargado correctamente"
else
  echo "❌ Error en configuración de Nginx"
  sudo nginx -t
  exit 1
fi

# =========================================================
# 🔒 CONFIGURACIÓN DE HTTPS CON CERTBOT
# =========================================================
echo "🔒 Verificando certificado SSL para ${FULL_DOMAIN}..."
if sudo certbot certificates 2>/dev/null | grep -q "${FULL_DOMAIN}"; then
  echo "✅ Certificado SSL ya existe, renovando si es necesario..."
  sudo certbot renew --quiet --nginx
else
  echo "📜 Solicitando nuevo certificado SSL para ${FULL_DOMAIN}..."
  sudo certbot --nginx \
    --non-interactive \
    --agree-tos \
    --email admin@${DOMAIN_BASE} \
    --domains ${FULL_DOMAIN} \
    --redirect
  echo "✅ HTTPS configurado correctamente para ${FULL_DOMAIN}"
fi

sudo systemctl reload nginx

# =========================================================
# 🚀 INICIAR APLICACIÓN CON PM2
# =========================================================
echo "🚀 Iniciando aplicación de test..."
pm2 start start_test_app.sh \
  --name ${APP_NAME} \
  --interpreter bash \
  --cwd ${PROJECT_PATH} \
  --log-date-format "YYYY-MM-DD HH:mm:ss"

pm2 save

echo "⏳ Esperando inicio de la aplicación..."
sleep 8

echo "📊 Estado de PM2:"
pm2 status ${APP_NAME}

echo "🔍 Verificando puerto ${TEST_PORT}..."
if sudo ss -tlnp | grep :${TEST_PORT}; then
    echo "✅ Puerto ${TEST_PORT} está en escucha"
else
    echo "❌ Puerto ${TEST_PORT} NO está en escucha"
    pm2 logs ${APP_NAME} --lines 50 --nostream
    sudo lsof -i :${TEST_PORT} -P || echo "Ninguno"
    exit 1
fi

echo "🧪 Probando aplicación HTTP..."
for i in {1..10}; do
    if curl -s -f http://localhost:${TEST_PORT}/ > /dev/null 2>&1; then
        echo "✅ Aplicación respondiendo en puerto ${TEST_PORT}"
        echo "🌐 URL pública: https://${FULL_DOMAIN}/test/"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "❌ La aplicación no responde después de múltiples intentos"
        pm2 logs ${APP_NAME} --lines 100 --nostream
        pm2 describe ${APP_NAME}
        exit 1
    fi
    echo "Intento $i/10 - esperando..."
    sleep 2
done

# =========================================================
# 🎉 RESUMEN FINAL
# =========================================================
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
echo "   - Renovar SSL: sudo certbot renew"
echo "========================================="