# app/config.py
import os
from dotenv import load_dotenv

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

# Configuración UDP
UDP_IP = "0.0.0.0"
UDP_PORT = 5049


# Configuración OSRM
OSRM_HOST = "http://localhost:5001"

# Ruta al archivo PBF de OpenStreetMap (para cálculo de centroides de edificios)
OSM_PBF_PATH = os.getenv('OSM_PBF_PATH', '/opt/osrm-data/barranquilla-oficial.osm.pbf')

# Configuración Tile Server (overv/openstreetmap-tile-server)
TILESERVER_HOST = os.getenv('TILESERVER_HOST', 'http://localhost:8080')
TILESERVER_DB_HOST = os.getenv('TILESERVER_DB_HOST', 'localhost')
TILESERVER_DB_PORT = os.getenv('TILESERVER_DB_PORT', '5432')
TILESERVER_DB_NAME = os.getenv('TILESERVER_DB_NAME', 'gis')
TILESERVER_DB_USER = os.getenv('TILESERVER_DB_USER', 'ubuntu')
TILESERVER_DB_PASSWORD = os.getenv('TILESERVER_DB_PASSWORD', 'postgres')