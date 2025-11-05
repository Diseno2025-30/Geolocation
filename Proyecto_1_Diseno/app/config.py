import os
from dotenv import load_dotenv
from datetime import timedelta

# Cargar variables de entorno desde .env
load_dotenv()

# Configuración de la Base de Datos
DB_HOST = os.getenv('DB_HOST')
DB_NAME = os.getenv('DB_NAME')
DB_USER = os.getenv('DB_USER')
DB_PASSWORD = os.getenv('DB_PASSWORD')

# Configuración de la Aplicación
NAME = os.getenv('NAME', 'Default')
BRANCH_NAME = os.getenv('BRANCH_NAME', 'main')
IS_TEST_MODE = os.getenv('TEST_MODE', 'false').lower() == 'true'

FIREBASE_ADMIN_SDK_PATH = os.getenv('FIREBASE_ADMIN_SDK_PATH', './firebase-admin-sdk.json')

FIREBASE_WEB_API_KEY = os.getenv('FIREBASE_WEB_API_KEY')
if not FIREBASE_WEB_API_KEY:
    print("⚠️ ADVERTENCIA: FIREBASE_WEB_API_KEY no está configurada. El login fallará.")
    print("   Asegúrate de añadirla a tu .env desde la configuración de tu proyecto Firebase (Clave de API web).")


JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY')
if not JWT_SECRET_KEY:
    print("⚠️ ADVERTENCIA: JWT_SECRET_KEY no está configurada. La autenticación UDP fallará.")
    JWT_SECRET_KEY = "llave_insegura_por_defecto_cambiar"

UDP_IP = "0.0.0.0"
UDP_PORT = 5049

OSRM_HOST = "http://localhost:5001"
JWT_ACCESS_TOKEN_EXPIRES = timedelta(days=30)