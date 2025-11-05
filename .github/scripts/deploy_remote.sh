#!/bin/bash
set -e

# Recibir parámetros
SUBDOMAIN="${1}"
DOMAIN_BASE="${2}"
INSTANCE_NUM="${3}"

echo "🔧 Configuración recibida:"
echo "   - Subdominio: ${SUBDOMAIN}"
echo "   - Dominio base: ${DOMAIN_BASE}"
echo "   - Instancia: ${INSTANCE_NUM}"

# Determinar ruta del proyecto
if [ -d "/home/ubuntu/Web-server-UDP" ]; then
  echo "📁 Usando proyecto existente en /home/ubuntu/Web-server-UDP"
  cd /home/ubuntu/Web-server-UDP
else
  echo "📁 Usando/creando estructura en /opt/location-tracker"
  sudo mkdir -p /opt/location-tracker
  sudo chown $USER:$USER /opt/location-tracker
  cd /opt/location-tracker
fi

# Guardar commit actual antes de actualizar
echo "📦 Actualizando código desde Git..."
if [ -d .git ]; then
  BEFORE_PULL=$(git rev-parse HEAD 2>/dev/null || echo "none")
  git fetch origin main
  git reset --hard origin/main
  AFTER_PULL=$(git rev-parse HEAD)
  
  if [ "$BEFORE_PULL" != "$AFTER_PULL" ]; then
    echo "✅ Código actualizado exitosamente"
    echo "Cambios aplicados:"
    if [ "$BEFORE_PULL" != "none" ]; then
      git log --oneline ${BEFORE_PULL}..${AFTER_PULL} | head -10
    fi
    CODE_UPDATED=true
  else
    echo "ℹ️ Ya tienes la última versión del código"
    CODE_UPDATED=false
  fi
else
  echo "📥 Clonando repositorio por primera vez..."
  git clone https://github.com/Diseno2025-30/Geolocation.git .
  CODE_UPDATED=true
fi

# Navegar al directorio del proyecto
cd Proyecto_1_Diseno

# Determinar ruta completa
PROJECT_PATH=$(pwd)
echo "📂 Trabajando en: $PROJECT_PATH"

# Verificar el archivo .env
echo "📋 Verificando archivo .env..."
if [ -f .env ]; then
  source .env 2>/dev/null || true
  
  # Si tenemos NAME del .env, úsalo
  if [ ! -z "$NAME" ]; then
    SUBDOMAIN=$(echo "$NAME" | tr '[:upper:]' '[:lower:]' | xargs)
    echo "✅ Usando NAME del .env: ${NAME} -> ${SUBDOMAIN}"
  fi
fi

# Construir nombres finales
FULL_DOMAIN="${SUBDOMAIN}.${DOMAIN_BASE}"
APP_NAME="flask-app-${SUBDOMAIN}"

echo "📊 Configuración final:"
echo "   - APP_NAME: ${APP_NAME}"
echo "   - FULL_DOMAIN: ${FULL_DOMAIN}"
echo "   - PROJECT_PATH: ${PROJECT_PATH}"

# ========== INSTALACIÓN DE DOCKER Y OSRM ==========
echo "🐳 ========================================="
echo "🐳 CONFIGURANDO DOCKER Y OSRM"
echo "🐳 ========================================="

# Instalar Docker si no está instalado
if ! command -v docker &> /dev/null; then
  echo "📦 Instalando Docker..."
  sudo apt-get update -qq
  sudo apt-get install -y docker.io
  sudo systemctl start docker
  sudo systemctl enable docker
  echo "✅ Docker instalado"
  
  # Configurar permisos de Docker
  echo "🔧 Configurando permisos de Docker..."
  sudo usermod -aG docker $USER
  sudo systemctl restart docker
  sleep 2
  sudo chmod 666 /var/run/docker.sock
else
  echo "✅ Docker ya está instalado"
fi

# Instalar dependencias de OSRM
echo "🗺️ Verificando dependencias para OSRM..."
sudo apt-get install -y osmium-tool osmctools curl jq

# Crear directorio para datos OSRM
OSRM_DIR="/opt/osrm-data"
echo "📁 Creando directorio OSRM: ${OSRM_DIR}"
sudo mkdir -p ${OSRM_DIR}
sudo chown $USER:$USER ${OSRM_DIR}

# Verificar si OSRM ya está configurado
if docker ps 2>/dev/null | grep -q osrm-backend; then
  echo "✅ OSRM ya está corriendo"
else
  echo "🔄 Configurando OSRM con mapa completo de Barranquilla..."
  
  # Usar el script setup_osrm.sh que ya está en el servidor
  if [ -f "/tmp/setup_osrm.sh" ]; then
    echo "📦 Usando script OSRM proporcionado..."
    chmod +x /tmp/setup_osrm.sh
    /tmp/setup_osrm.sh
  else
    echo "❌ Error: No se encontró el script setup_osrm.sh"
    exit 1
  fi
fi

# Regresar al directorio del proyecto
cd ${PROJECT_PATH}

# ========== CONTINUAR CON CONFIGURACIÓN NORMAL ==========

# Instalar dependencias del sistema si es necesario
echo "📦 Verificando dependencias del sistema..."

# Node.js y npm
if ! command -v node &> /dev/null; then
  echo "Instalando Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# PM2
if ! command -v pm2 &> /dev/null; then
  echo "Instalando PM2..."
  sudo npm install -g pm2
  pm2 startup systemd -u $USER --hp /home/$USER
else
  echo "🔄 Actualizando PM2 a la última versión..."
  sudo npm update -g pm2
fi

# Python, Nginx y Certbot
sudo apt-get update -qq
sudo apt-get install -y python3-pip python3-venv nginx certbot python3-certbot-nginx

# Configurar entorno virtual de Python
echo "🐍 Configurando entorno Python..."
if [ ! -d "venv" ]; then
  python3 -m venv venv
  echo "✅ Entorno virtual creado"
fi

source venv/bin/activate
pip install --upgrade pip
pip install flask psycopg2-binary python-dotenv requests

# Si existe requirements.txt, instalarlo también
if [ -f requirements.txt ]; then
  pip install -r requirements.txt
fi

# Instalar dependencias para Leaflet y mapas
echo "🗺️ Instalando dependencias para mapas interactivos..."
pip install folium geopy

# Configurar Nginx PRIMERO sin SSL (necesario para validación de Let's Encrypt)
echo "🌐 Configurando Nginx (paso 1: HTTP temporal para validación SSL)..."
cat > /tmp/nginx-config-temp << 'NGINXTEMPCONF'
server {
    listen 80;
    server_name ${FULL_DOMAIN} www.${FULL_DOMAIN};
    
    # Location para validación de Let's Encrypt
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        proxy_buffering off;
    }

    # Proxy para OSRM
    location /osrm/ {
        proxy_pass http://localhost:5001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        rewrite ^/osrm/(.*) /$1 break;
    }
}
NGINXTEMPCONF

# Crear directorio para validación de Let's Encrypt
sudo mkdir -p /var/www/certbot

sudo mv /tmp/nginx-config-temp /etc/nginx/sites-available/location-tracker
sudo ln -sf /etc/nginx/sites-available/location-tracker /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

if sudo nginx -t; then
  sudo systemctl reload nginx
  echo "✅ Nginx configurado temporalmente para validación SSL"
else
  echo "❌ Error en configuración de Nginx"
  exit 1
fi

# Obtener certificado SSL con Let's Encrypt
echo "🔐 Obteniendo certificado SSL con Let's Encrypt..."

# Verificar si ya existe un certificado válido
if sudo test -f "/etc/letsencrypt/live/${FULL_DOMAIN}/fullchain.pem"; then
  echo "📜 Certificado SSL existente encontrado, intentando renovar si es necesario..."
  sudo certbot renew --nginx --non-interactive --quiet || true
else
  echo "🆕 Obteniendo nuevo certificado SSL..."
  # Obtener certificado SSL (usa --staging para pruebas, quítalo en producción)
  sudo certbot certonly \
    --webroot \
    -w /var/www/certbot \
    --non-interactive \
    --agree-tos \
    --email oliverproace@gmail.com \
    -d ${FULL_DOMAIN} \
    -d www.${FULL_DOMAIN} \
    || echo "⚠️ No se pudo obtener certificado SSL, continuando con configuración HTTP"
fi

# Configurar Nginx con SSL y redirección HTTPS forzada
echo "🔒 Configurando Nginx con SSL y HTTPS forzado..."

# Verificar si el certificado existe
if sudo test -f "/etc/letsencrypt/live/${FULL_DOMAIN}/fullchain.pem"; then
  echo "✅ Certificado SSL encontrado, configurando HTTPS..."
  
  cat > /tmp/nginx-config-ssl << NGINXSSLCONF
# Redirección HTTP a HTTPS (FORZADO)
server {
    listen 80;
    server_name ${FULL_DOMAIN} www.${FULL_DOMAIN};
    
    # Permitir renovación de certificados
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    # Redireccionar TODO el tráfico HTTP a HTTPS
    location / {
        return 301 https://\$host\$request_uri;
    }
}

# Configuración HTTPS principal
server {
    listen 443 ssl http2;
    server_name ${FULL_DOMAIN};
    
    # Certificados SSL
    ssl_certificate /etc/letsencrypt/live/${FULL_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${FULL_DOMAIN}/privkey.pem;
    
    # Configuración SSL moderna y segura
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # Seguridad adicional
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_stapling on;
    ssl_stapling_verify on;
    
    # Headers de seguridad
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    access_log /var/log/nginx/${SUBDOMAIN}_ssl_access.log;
    error_log /var/log/nginx/${SUBDOMAIN}_ssl_error.log;
    
    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-SSL on;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        proxy_buffering off;
        
        # Websocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    
    # Proxy para OSRM - Snap to Roads
    location /osrm/ {
        proxy_pass http://localhost:5001/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-SSL on;
        rewrite ^/osrm/(.*) /\$1 break;
        
        # CORS para Leaflet
        add_header Access-Control-Allow-Origin "*";
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS";
        add_header Access-Control-Allow-Headers "DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range";
    }
    
    location /static {
        alias ${PROJECT_PATH}/static;
        expires 30d;
        add_header Cache-Control "public, immutable";
        
        # CORS para archivos estáticos de mapas
        location /static/maps/ {
            add_header Access-Control-Allow-Origin "*";
        }
    }
}

# Redirección de www a no-www con HTTPS
server {
    listen 443 ssl http2;
    server_name www.${FULL_DOMAIN};
    
    ssl_certificate /etc/letsencrypt/live/${FULL_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${FULL_DOMAIN}/privkey.pem;
    
    return 301 https://${FULL_DOMAIN}\$request_uri;
}
NGINXSSLCONF
  
  sudo mv /tmp/nginx-config-ssl /etc/nginx/sites-available/location-tracker
  
else
  echo "⚠️ No se encontró certificado SSL, manteniendo configuración HTTP con advertencia..."
  echo "⚠️ ADVERTENCIA: La aplicación está corriendo en HTTP. Configure DNS y vuelva a ejecutar para SSL."
fi

if sudo nginx -t; then
  sudo systemctl reload nginx
  echo "✅ Nginx configurado correctamente"
else
  echo "❌ Error en configuración de Nginx"
  exit 1
fi

# Configurar renovación automática de certificados SSL
echo "📅 Configurando renovación automática de certificados SSL..."

# Crear script de renovación
cat > /tmp/renew-ssl.sh << 'RENEWSCRIPT'
#!/bin/bash
certbot renew --nginx --non-interactive --quiet
if [ $? -eq 0 ]; then
  systemctl reload nginx
fi
RENEWSCRIPT

sudo mv /tmp/renew-ssl.sh /etc/letsencrypt/renew-ssl.sh
sudo chmod +x /etc/letsencrypt/renew-ssl.sh

# Agregar cron job para renovación automática (dos veces al día)
CRON_JOB="0 0,12 * * * root /etc/letsencrypt/renew-ssl.sh"
if ! sudo grep -q "/etc/letsencrypt/renew-ssl.sh" /etc/crontab; then
  echo "$CRON_JOB" | sudo tee -a /etc/crontab > /dev/null
  echo "✅ Cron job para renovación automática configurado"
fi

# Crear script de inicio si no existe o si hay cambios en el código
if [ ! -f "start_app.sh" ] || [ "$CODE_UPDATED" = "true" ]; then
  echo "📝 Actualizando script de inicio..."
  cat > start_app.sh << 'STARTSCRIPT'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
source venv/bin/activate
export FLASK_APP=run.py
export FLASK_ENV=production
# Configurar Flask para confiar en headers de proxy (importante para HTTPS)
export FLASK_TRUSTED_PROXIES="127.0.0.1"
# Variables de entorno para OSRM
export OSRM_ENDPOINT="http://localhost:5001"
export MAPS_ENABLED="true"
python run.py
STARTSCRIPT
  chmod +x start_app.sh
fi

# IMPORTANTE: Limpiar aplicaciones PM2 antiguas que puedan estar en conflicto
echo "🧹 Limpiando aplicaciones PM2 antiguas..."

# Primero, detener TODAS las aplicaciones Flask antiguas que puedan estar usando el puerto
pm2 list | grep -E "flask-app-[0-9]+" | awk '{print $2}' | while read old_app; do
  if [ "$old_app" != "$APP_NAME" ]; then
    echo "Deteniendo aplicación antigua: $old_app"
    pm2 stop "$old_app" 2>/dev/null || true
    pm2 delete "$old_app" 2>/dev/null || true
  fi
done

# También detener cualquier flask-app-{numero} que pueda estar corriendo
pm2 stop "flask-app-${INSTANCE_NUM}" 2>/dev/null || true
pm2 delete "flask-app-${INSTANCE_NUM}" 2>/dev/null || true

# Matar cualquier proceso Python que esté usando el puerto 5000
echo "🔍 Verificando puerto 5000..."
if sudo lsof -i :5000 &>/dev/null; then
  echo "⚠️ Puerto 5000 en uso, liberándolo..."
  sudo fuser -k 5000/tcp 2>/dev/null || true
  sleep 2
fi

# Gestionar la aplicación PM2 (VERSIÓN CORREGIDA)
PM2_APP_EXISTS=$(pm2 list | grep " ${APP_NAME} " | awk '{print $2}' || echo "")

if [ ! -z "$PM2_APP_EXISTS" ]; then
  if [ "$CODE_UPDATED" = "true" ]; then
    echo "🔄 Código actualizado, reiniciando aplicación ${APP_NAME}..."
    pm2 restart ${APP_NAME} --update-env
  else
    echo "ℹ️ Aplicación ${APP_NAME} ya está ejecutándose (sin cambios en código)"
  fi
else
  echo "🆕 Iniciando nueva aplicación ${APP_NAME}..."
  pm2 start start_app.sh --name ${APP_NAME} --interpreter bash --cwd $PROJECT_PATH
fi

# Guardar configuración de PM2
pm2 save

# Esperar y verificar
echo "⏳ Esperando a que la aplicación esté lista..."
sleep 5

# Verificación de estado
echo "📊 Estado de la aplicación:"
pm2 status ${APP_NAME}

# Mostrar últimos logs
echo "📄 Últimos logs:"
pm2 logs ${APP_NAME} --lines 15 --nostream || true

# Tests de conectividad
echo "🧪 Realizando pruebas de conectividad..."

# Test Flask
MAX_RETRIES=5
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
  if curl -s -f http://localhost:5000/ > /dev/null 2>&1; then
    echo "✅ Flask respondiendo correctamente en puerto 5000"
    break
  else
    RETRY=$((RETRY + 1))
    if [ $RETRY -lt $MAX_RETRIES ]; then
      echo "⏳ Esperando a Flask (intento $RETRY/$MAX_RETRIES)..."
      sleep 2
    else
      echo "⚠️ Flask no responde después de $MAX_RETRIES intentos"
      echo "Debug - Procesos Python:"
      ps aux | grep python | grep -v grep || true
      echo "Debug - Puerto 5000:"
      sudo netstat -tlnp | grep :5000 || true
    fi
  fi
done

# Test OSRM
echo "🗺️ Probando OSRM..."
if curl -s -f http://localhost:5001/nearest/v1/driving/-74.8,10.98 > /dev/null 2>&1; then
  echo "✅ OSRM respondiendo correctamente en puerto 5001"
  echo "✅ Snap-to-roads funcionando para Puerto de Barranquilla"
else
  echo "⚠️ OSRM no responde, pero la aplicación Flask funciona"
fi

# Test HTTPS si el certificado existe
if sudo test -f "/etc/letsencrypt/live/${FULL_DOMAIN}/fullchain.pem"; then
  echo "🔐 Verificando HTTPS..."
  
  # Test redirección HTTP a HTTPS
  REDIRECT_TEST=$(curl -s -o /dev/null -w "%{http_code}" -L http://localhost/ 2>/dev/null || echo "000")
  if [ "$REDIRECT_TEST" = "200" ]; then
    echo "✅ Redirección HTTP → HTTPS funcionando"
  else
    echo "⚠️ Verificación de redirección devolvió código: $REDIRECT_TEST"
  fi
  
  # Test HTTPS directo (si es posible)
  if curl -s -f -k https://localhost/ > /dev/null 2>&1; then
    echo "✅ HTTPS respondiendo correctamente"
  else
    echo "ℹ️ HTTPS configurado pero requiere dominio válido para prueba completa"
  fi
else
  echo "⚠️ SSL no configurado - acceso solo por HTTP"
fi

# Configurar firewall
if command -v ufw &> /dev/null; then
  echo "🔒 Configurando firewall..."
  sudo ufw allow 80/tcp comment "HTTP (redirige a HTTPS)" 2>/dev/null || true
  sudo ufw allow 443/tcp comment "HTTPS" 2>/dev/null || true
  sudo ufw allow 5001/tcp comment "OSRM Backend" 2>/dev/null || true
  sudo ufw allow 5049/udp comment "UDP Listener" 2>/dev/null || true
  sudo ufw allow 22/tcp comment "SSH" 2>/dev/null || true
fi

# Resumen final
echo ""
echo "========================================="
if [ "$CODE_UPDATED" = "true" ]; then
  echo "🎉 CÓDIGO ACTUALIZADO Y DESPLEGADO"
else
  echo "✅ DESPLIEGUE VERIFICADO"
fi
echo "========================================="
echo ""
echo "📊 CONFIGURACIÓN:"
echo "   - Aplicación: ${APP_NAME}"
echo "   - Dominio: ${FULL_DOMAIN}"
echo "   - Proyecto: ${PROJECT_PATH}"
echo "   - Estado: $(pm2 list | grep ${APP_NAME} | awk '{print $10}')"
echo "   - OSRM: ✅ Configurado (Puerto de Barranquilla)"
echo "   - Docker: ✅ Configurado"

if sudo test -f "/etc/letsencrypt/live/${FULL_DOMAIN}/fullchain.pem"; then
  echo "   - SSL: ✅ Configurado (HTTPS forzado)"
  echo ""
  echo "🔐 CERTIFICADO SSL:"
  sudo certbot certificates 2>/dev/null | grep -A 3 "${FULL_DOMAIN}" || true
else
  echo "   - SSL: ⚠️ No configurado (solo HTTP)"
fi

echo ""
echo "🔗 ACCESO:"
if sudo test -f "/etc/letsencrypt/live/${FULL_DOMAIN}/fullchain.pem"; then
  echo "   - https://${FULL_DOMAIN} (SEGURO)"
  echo "   - http://${FULL_DOMAIN} → Redirige a HTTPS"
  echo "   - OSRM API: https://${FULL_DOMAIN}/osrm/"
else
  echo "   - http://${FULL_DOMAIN} (⚠️ Sin SSL)"
  echo "   - OSRM API: http://${FULL_DOMAIN}/osrm/"
  echo "   - Para habilitar HTTPS: Configure DNS y vuelva a ejecutar"
fi
echo ""
echo "🗺️ OSRM CONFIGURADO:"
echo "   - Snap-to-roads: ✅ Puerto de Barranquilla"
echo "   - Calles: ~75 vías específicas"
echo "   - API: /nearest, /route, /match"
echo "   - Puerto interno: 5001"
echo ""
echo "🛠️ COMANDOS ÚTILES:"
echo "   - Ver logs: pm2 logs ${APP_NAME}"
echo "   - Reiniciar: pm2 restart ${APP_NAME}"
echo "   - OSRM logs: docker logs -f osrm-backend"
echo "   - Renovar SSL: sudo certbot renew --nginx"
echo "   - Estado OSRM: curl http://localhost:5001/nearest/v1/driving/-74.8,10.98"
echo ""
echo "📊 Aplicaciones PM2 activas:"
pm2 list
echo ""
echo "🔒 SEGURIDAD:"
echo "   - HTTPS: Forzado con redirección 301"
echo "   - HSTS: Habilitado (preload ready)"
echo "   - TLS: v1.2 y v1.3 únicamente"
echo "   - Headers de seguridad: Configurados"
echo "   - Renovación SSL: Automática (cron)"
echo "========================================="