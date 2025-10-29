#!/bin/bash
set -e

# Recibir parámetros
NAME_VALUE="${1}"
DOMAIN_BASE="${2}"
INSTANCE_NUM="${3}"
FULL_DOMAIN="${NAME_VALUE}.${DOMAIN_BASE}"
APP_NAME="flask-app-${NAME_VALUE}"

echo "🚀 ========================================="
echo "🚀 INICIANDO DESPLIEGUE A PRODUCCIÓN"
echo "🚀 ========================================="
echo "   - Aplicación: ${APP_NAME}"
echo "   - Dominio: ${FULL_DOMAIN}"
echo "   - Instancia: ${INSTANCE_NUM}"

# Determinar ruta base del proyecto
if [ -d "/home/ubuntu/Web-server-UDP" ]; then
  BASE_DIR="/home/ubuntu/Web-server-UDP"
else
  BASE_DIR="/opt/location-tracker"
fi

PROJECT_PATH="${BASE_DIR}/Proyecto_1_Diseno"
cd ${PROJECT_PATH}

echo "📁 Ubicación: ${PROJECT_PATH}"

# 1. Actualizar código
echo "📦 Actualizando código desde la rama 'main'..."
git fetch origin main
git checkout main
git reset --hard origin/main

# 2. Configurar entorno virtual
echo "🐍 Configurando entorno Python..."
if [ ! -d "venv" ]; then
  python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip
pip install flask psycopg2-binary python-dotenv requests

# Instalar otras dependencias si existen
if [ -f "requirements.txt" ]; then
  pip install -r requirements.txt
fi

# 3. Corregir permisos de Nginx para la nueva estructura
echo "🔒 Configurando permisos de Nginx..."
# Dar permiso de entrar a la carpeta 'app'
chmod o+rx ${PROJECT_PATH}/app
# Dar permiso de leer los estáticos
if [ -d "app/static" ]; then
  find app/static -type d -exec chmod o+rx {} \;
  find app/static -type f -exec chmod o+r {} \;
  echo "✅ Permisos configurados para app/static/"
fi

# 4. Corregir Nginx para apuntar a 'app/static'
NGINX_CONF="/etc/nginx/sites-available/location-tracker"
echo "🌐 Actualizando Nginx en ${NGINX_CONF}..."

# Cambiar la ruta estática de producción
# Busca 'alias .../static/' y lo cambia por 'alias .../app/static/'
sudo sed -i 's|alias .*/Proyecto_1_Diseno/static/|alias '"${PROJECT_PATH}"'/app/static/|g' ${NGINX_CONF}
echo "   - Ruta estática actualizada a app/static/"

# Verificar y recargar Nginx
if sudo nginx -t; then
  sudo systemctl reload nginx
  echo "✅ Nginx recargado."
else
  echo "❌ Error en configuración de Nginx. Despliegue abortado."
  sudo nginx -t
  exit 1
fi

# 5. Reiniciar PM2 apuntando al NUEVO archivo 'run.py'
echo "🔄 Reiniciando aplicación de producción con PM2..."
# Detener la app (no importa si falla)
pm2 stop ${APP_NAME} 2>/dev/null || true
pm2 delete ${APP_NAME} 2>/dev/null || true
sleep 1

# Iniciar la aplicación con el nuevo 'run.py'
# Usamos 'app:run.py' porque el FLASK_APP está dentro de 'run.py'
pm2 start "python3 ${PROJECT_PATH}/run.py --port 5000" \
  --name ${APP_NAME} \
  --interpreter bash \
  --cwd ${PROJECT_PATH} \
  --log-date-format "YYYY-MM-DD HH:mm:ss"

pm2 save
sleep 2

echo "📊 Estado de la aplicación:"
pm2 status ${APP_NAME}

# 6. Verificación final
echo "🧪 Probando aplicación..."
if curl -s -f http://localhost:5000/ > /dev/null 2>&1; then
  echo "✅ Aplicación de producción respondiendo en puerto 5000."
else
  echo "⚠️ La aplicación de producción NO responde."
  pm2 logs ${APP_NAME} --lines 20 --nostream
fi

echo ""
echo "========================================="
echo "🎉 DESPLIEGUE DE PRODUCCIÓN COMPLETADO"
echo "========================================="
echo "   - URL: https://${FULL_DOMAIN}/"
echo "========================================="