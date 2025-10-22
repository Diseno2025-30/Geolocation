import socket
import threading
from flask import Flask, jsonify, render_template, send_from_directory, redirect, url_for, request
import psycopg2
import os
from dotenv import load_dotenv
import argparse
import subprocess
from datetime import datetime, timedelta
import requests
import time  # ← NUEVO: Para medir tiempos

load_dotenv()

DB_HOST = os.getenv('DB_HOST')
DB_NAME = os.getenv('DB_NAME')
DB_USER = os.getenv('DB_USER')
DB_PASSWORD = os.getenv('DB_PASSWORD')
NAME = os.getenv('NAME', 'Default')
BRANCH_NAME = os.getenv('BRANCH_NAME', 'main')

# Detectar si estamos en modo test
IS_TEST_MODE = os.getenv('TEST_MODE', 'false').lower() == 'true'

def get_db():
    conn = psycopg2.connect(
        host=DB_HOST,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )
    return conn

def create_table():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS coordinates (
            id serial PRIMARY KEY,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            timestamp TEXT NOT NULL,
            source TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

create_table()

# ========== FUNCIÓN SNAP TO ROADS MEJORADA ==========
def snap_to_road(lat, lon):
    """
    Ajusta las coordenadas GPS a la calle más cercana usando OSRM local.
    """
    print(f"🎯 [SNAP-START] Procesando: ({lat:.6f}, {lon:.6f})")
    
    try:
        # AUMENTAR TIMEOUT para mapa completo de Barranquilla
        url = f"http://localhost:5001/nearest/v1/driving/{lon},{lat}"
        print(f"🎯 [SNAP-URL] Llamando a: {url}")
        
        start_time = time.time()
        response = requests.get(url, params={'number': 1}, timeout=10)  # ← 10 segundos
        elapsed = time.time() - start_time
        
        print(f"🎯 [SNAP-TIME] OSRM respondió en {elapsed:.3f}s - Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"🎯 [SNAP-RESPONSE] Código OSRM: {data.get('code')}")
            
            if data.get('code') == 'Ok' and len(data.get('waypoints', [])) > 0:
                # Obtener coordenadas ajustadas a la calle
                snapped_location = data['waypoints'][0]['location']
                snapped_lon = snapped_location[0]
                snapped_lat = snapped_location[1]
                
                # Distancia del ajuste en metros
                distance = data['waypoints'][0].get('distance', 0)
                name = data['waypoints'][0].get('name', 'Unknown')
                
                print(f"✅ [SNAP-SUCCESS] ({lat:.6f}, {lon:.6f}) → ({snapped_lat:.6f}, {snapped_lon:.6f})")
                print(f"✅ [SNAP-DETAILS] Calle: '{name}' | Distancia: {distance:.2f}m | Tiempo: {elapsed:.3f}s")
                
                return snapped_lat, snapped_lon
            else:
                error_code = data.get('code', 'Unknown')
                error_msg = data.get('message', 'No message')
                print(f"❌ [SNAP-ERROR] OSRM error: {error_code} - {error_msg}")
                print(f"❌ [SNAP-FALLBACK] Usando coordenadas originales")
                return lat, lon
        else:
            print(f"❌ [SNAP-HTTP] HTTP error {response.status_code}")
            print(f"❌ [SNAP-FALLBACK] Usando coordenadas originales")
            return lat, lon
            
    except requests.exceptions.Timeout:
        print(f"⏰ [SNAP-TIMEOUT] Timeout después de 10s - OSRM no responde")
        return lat, lon
    except requests.exceptions.ConnectionError:
        print(f"🔌 [SNAP-CONNECTION] ConnectionError - OSRM no disponible en localhost:5001")
        return lat, lon
    except Exception as e:
        print(f"💥 [SNAP-EXCEPTION] {type(e).__name__}: {e}")
        return lat, lon
# ============================================

UDP_IP = "0.0.0.0"
UDP_PORT = 5049

def udp_listener():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_IP, UDP_PORT))
    print(f"🔊 [UDP] Listening on {UDP_IP}:{UDP_PORT}")
    print(f"🗺️ [OSRM] Snap-to-roads: {'ACTIVO' if check_osrm_available() else 'INACTIVO'}")
    
    while True:
        data, addr = sock.recvfrom(1024)
        msg = data.decode().strip()
        print(f"📨 [UDP-RECEIVED] From {addr}: {msg}")
        
        try:
            campos = msg.split(",")
            lat_original = float(campos[0].split(":")[1].strip())
            lon_original = float(campos[1].split(":")[1].strip())
            timestamp = campos[2].split(":", 1)[1].strip()
            source = f"{addr[0]}:{addr[1]}"

            print(f"📍 [COORDS-ORIGINAL] Lat: {lat_original:.6f}, Lon: {lon_original:.6f}")

            # ========== APLICAR SNAP TO ROADS ==========
            lat_final, lon_final = snap_to_road(lat_original, lon_original)
            # ===========================================

            print(f"💾 [DB-SAVE] Guardando: ({lat_final:.6f}, {lon_final:.6f})")

            # Conecta a la base de datos e inserta los datos AJUSTADOS
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO coordinates (lat, lon, timestamp, source) VALUES (%s, %s, %s, %s)",
                (lat_final, lon_final, timestamp, source)
            )
            conn.commit()
            conn.close()

            print(f"✅ [DB-SUCCESS] Guardado en BD: {lat_final:.6f}, {lon_final:.6f}")

        except Exception as e:
            print(f"❌ [UDP-ERROR] Invalid packet: {msg}")
            print(f"❌ [UDP-ERROR] Exception: {e}")

def check_osrm_available():
    """Verifica si OSRM está disponible al iniciar con mejor diagnóstico"""
    try:
        print("🔍 [OSRM-CHECK] Verificando OSRM en localhost:5001...")
        start_time = time.time()
        response = requests.get("http://localhost:5001/nearest/v1/driving/-74.8,11.0", timeout=5)
        elapsed = time.time() - start_time
        
        if response.status_code == 200:
            data = response.json()
            if data.get('code') == 'Ok':
                print(f"✅ [OSRM-READY] OSRM disponible - respuesta en {elapsed:.3f}s")
                return True
            else:
                print(f"⚠️ [OSRM-WARNING] OSRM responde pero con error: {data.get('code')}")
                return False
        else:
            print(f"❌ [OSRM-ERROR] HTTP {response.status_code} - OSRM no disponible")
            return False
    except requests.exceptions.Timeout:
        print("⏰ [OSRM-TIMEOUT] Timeout verificando OSRM")
        return False
    except requests.exceptions.ConnectionError:
        print("🔌 [OSRM-CONNECTION] No se puede conectar a OSRM")
        return False
    except Exception as e:
        print(f"💥 [OSRM-EXCEPTION] Error verificando OSRM: {e}")
        return False

app = Flask(__name__)

@app.context_processor
def utility_processor():
    def get_static_path(filename):
        """Genera la ruta correcta para archivos estáticos según el modo"""
        if IS_TEST_MODE or request.path.startswith('/test/'):
            return f'/test/static/{filename}'
        return f'/static/{filename}'
    
    def get_base_path():
        """Retorna el base path según si estamos en test o no"""
        if IS_TEST_MODE or request.path.startswith('/test/'):
            return '/test'
        return ''
    
    return dict(
        get_static_path=get_static_path,
        get_base_path=get_base_path
    )

# Función para obtener información de la rama actual
def get_git_info():
    try:
        # Si estamos en modo test, usar el BRANCH_NAME del environment
        if IS_TEST_MODE and BRANCH_NAME != 'main':
            branch = BRANCH_NAME
            environment = 'TEST'
        else:
            # Obtener la rama actual de git
            try:
                branch = subprocess.check_output(['git', 'rev-parse', '--abbrev-ref', 'HEAD']).decode('utf-8').strip()
            except:
                branch = 'main'
            environment = 'PRODUCTION'
        
        # Obtener el último commit
        try:
            commit = subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD']).decode('utf-8').strip()
        except:
            commit = 'unknown'
        
        # Obtener la fecha del último commit
        try:
            date = subprocess.check_output(['git', 'log', '-1', '--format=%cd', '--date=short']).decode('utf-8').strip()
        except:
            date = 'unknown'
        
        return {
            'branch': branch,
            'commit': commit,
            'date': date,
            'is_test': IS_TEST_MODE,
            'environment': environment,
            'server_name': NAME
        }
    except:
        return {
            'branch': BRANCH_NAME if IS_TEST_MODE else 'main',
            'commit': 'unknown',
            'date': 'unknown',
            'is_test': IS_TEST_MODE,
            'environment': 'TEST' if IS_TEST_MODE else 'PRODUCTION',
            'server_name': NAME
        }

def parse_date_to_db_format(date_str):
    """Convert YYYY-MM-DD to DD/MM/YYYY format for database queries"""
    try:
        date_obj = datetime.strptime(date_str, '%Y-%m-%d')
        return date_obj.strftime('%d/%m/%Y')
    except ValueError:
        return None

def generate_date_range_patterns(start_date, end_date):
    """Generate all date patterns between start_date and end_date for LIKE queries"""
    patterns = []
    current_date = datetime.strptime(start_date, '%Y-%m-%d')
    end_date_obj = datetime.strptime(end_date, '%Y-%m-%d')
    
    while current_date <= end_date_obj:
        pattern = current_date.strftime('%d/%m/%Y')
        patterns.append(pattern)
        current_date += timedelta(days=1)
    
    return patterns

# ===== PRODUCTION ROUTES =====

@app.route('/')
def home():
    """Ruta principal - muestra el frontend real-time"""
    git_info = get_git_info()
    
    # Si estamos en modo test, mostrar un banner indicativo
    test_warning = None
    if IS_TEST_MODE:
        test_warning = f"⚠ AMBIENTE DE PRUEBA - Rama: {git_info['branch']}"
    
    return render_template('frontend.html', 
                         name=NAME, 
                         git_info=git_info, 
                         is_test=IS_TEST_MODE,
                         test_warning=test_warning)

@app.route('/historics/')
def historics():
    """Ruta histórica - muestra el frontend histórico"""
    git_info = get_git_info()
    
    # Si estamos en modo test, mostrar un banner indicativo
    test_warning = None
    if IS_TEST_MODE:
        test_warning = f"⚠ AMBIENTE DE PRUEBA - Rama: {git_info['branch']}"
    
    return render_template('frontend_historical.html', 
                         name=NAME, 
                         git_info=git_info, 
                         is_test=IS_TEST_MODE,
                         test_warning=test_warning)

@app.route('/coordenadas')
def coordenadas():
    """API endpoint para obtener las últimas coordenadas"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM coordinates ORDER BY id DESC LIMIT 1")
    data = cursor.fetchone()
    conn.close()

    if data:
        column_names = ['id', 'lat', 'lon', 'timestamp', 'source']
        result = dict(zip(column_names, data))
    else:
        result = {}

    return jsonify(result)

@app.route('/historico/<fecha>')
def get_historico(fecha):
    """Endpoint para obtener datos históricos por fecha (mantenido por compatibilidad)"""
    conn = None
    try:
        # fecha viene en formato YYYY-MM-DD, convertir a DD/MM/YYYY
        year, month, day = fecha.split('-')
        fecha_formateada = f"{day}/{month}/{year}"
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Usar LIKE para buscar todos los registros que contengan esa fecha
        query = "SELECT lat, lon, timestamp FROM coordinates WHERE timestamp LIKE %s ORDER BY timestamp"
        cursor.execute(query, (f"{fecha_formateada}%",))
        results = cursor.fetchall()
        
        # Convertir a JSON
        coordenadas = []
        for row in results:
            coordenadas.append({
                'lat': float(row[0]),
                'lon': float(row[1]),
                'timestamp': row[2]  # Mantener el formato original DD/MM/YYYY HH:MM:SS
            })
        
        print(f"Consulta histórica: {fecha_formateada} - {len(coordenadas)} registros encontrados")
        return jsonify(coordenadas)
        
    except Exception as e:
        print(f"Error en consulta histórica: {e}")
        return jsonify([]), 500
    finally:
        if conn:
            conn.close()

@app.route('/historico/rango')
def get_historico_rango():
    """Endpoint para obtener datos históricos por rango de fechas"""
    conn = None
    try:
        # Obtener parámetros de la URL
        fecha_inicio = request.args.get('inicio')
        fecha_fin = request.args.get('fin')
        
        if not fecha_inicio or not fecha_fin:
            return jsonify({'error': 'Se requieren los parámetros inicio y fin'}), 400
        
        # Validar formato de fechas
        try:
            datetime.strptime(fecha_inicio, '%Y-%m-%d')
            datetime.strptime(fecha_fin, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'Formato de fecha inválido. Use YYYY-MM-DD'}), 400
        
        # Verificar que fecha_inicio <= fecha_fin
        if fecha_inicio > fecha_fin:
            return jsonify({'error': 'La fecha de inicio debe ser anterior o igual a la fecha de fin'}), 400
        
        # Generar todos los patrones de fecha en el rango
        date_patterns = generate_date_range_patterns(fecha_inicio, fecha_fin)
        
        conn = get_db()
        cursor = conn.cursor()
        
        coordenadas = []
        
        # Consultar para cada fecha en el rango
        for pattern in date_patterns:
            query = "SELECT lat, lon, timestamp FROM coordinates WHERE timestamp LIKE %s"
            cursor.execute(query, (f"{pattern}%",))
            results = cursor.fetchall()
            
            for row in results:
                coordenadas.append({
                    'lat': float(row[0]),
                    'lon': float(row[1]),
                    'timestamp': row[2]  # Mantener el formato original DD/MM/YYYY HH:MM:SS
                })
        
        # Ordenar por timestamp
        def parse_timestamp_for_sort(timestamp_str):
            try:
                return datetime.strptime(timestamp_str, '%d/%m/%Y %H:%M:%S')
            except ValueError:
                return datetime.min
        
        coordenadas.sort(key=lambda x: parse_timestamp_for_sort(x['timestamp']))
        
        print(f"Consulta histórica por rango: {fecha_inicio} a {fecha_fin} - {len(coordenadas)} registros encontrados")
        return jsonify(coordenadas)
        
    except Exception as e:
        print(f"Error en consulta histórica por rango: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            conn.close()

# ===== TEST MODE ROUTES =====

@app.route('/test/')
def test_home():
    """Ruta de test - muestra el frontend real-time en modo test"""
    git_info = get_git_info()
    
    # Forzar el banner de test para estas rutas
    test_warning = f"⚠ AMBIENTE DE PRUEBA - Rama: {git_info['branch']}"
    
    return render_template('frontend.html', 
                         name=NAME, 
                         git_info=git_info, 
                         is_test=True,
                         test_warning=test_warning)

@app.route('/test/historics/')
def test_historics():
    """Ruta histórica de test - muestra el frontend histórico en modo test"""
    git_info = get_git_info()
    
    # Forzar el banner de test para estas rutas
    test_warning = f"⚠ AMBIENTE DE PRUEBA - Rama: {git_info['branch']}"
    
    return render_template('frontend_historical.html', 
                         name=NAME, 
                         git_info=git_info, 
                         is_test=True,
                         test_warning=test_warning)

@app.route('/test/coordenadas')
def test_coordenadas():
    """API endpoint de test para obtener las últimas coordenadas"""
    return coordenadas()

@app.route('/test/historico/<fecha>')
def test_get_historico(fecha):
    """Endpoint de test para obtener datos históricos por fecha"""
    return get_historico(fecha)

@app.route('/test/historico/rango')
def test_get_historico_rango():
    """Endpoint de test para obtener datos históricos por rango de fechas"""
    return get_historico_rango()

# ===== OTHER EXISTING ROUTES =====

@app.route('/osrm/route/<path:params>')
def osrm_proxy(params):
    """Proxy para llamadas OSRM desde el frontend"""
    try:
        url = f"http://localhost:5001/route/v1/driving/{params}"
        response = requests.get(url, params=request.args, timeout=5)
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({'error': str(e), 'code': 'Error'}), 500

@app.route('/test/osrm/route/<path:params>')
def test_osrm_proxy(params):
    """Proxy de test para llamadas OSRM desde el frontend"""
    return osrm_proxy(params)

@app.route('/database')
def database():
    """Vista de la base de datos"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM coordinates ORDER BY id DESC LIMIT 20")
    data = cursor.fetchall()
    conn.close()
    
    git_info = get_git_info()
    test_warning = None
    if IS_TEST_MODE:
        test_warning = f"⚠ AMBIENTE DE PRUEBA - Rama: {git_info['branch']}"
    
    return render_template('database.html',
                         coordinates=data,
                         name=NAME,
                         git_info=git_info,
                         is_test=IS_TEST_MODE,
                         test_warning=test_warning)

@app.route('/version')
def version():
    """Endpoint para verificar la versión actual del código"""
    return jsonify(get_git_info())

@app.route('/health')
def health():
    """Health check endpoint"""
    try:
        # Verificar conexión a la base de datos
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        conn.close()
        db_status = 'healthy'
    except:
        db_status = 'unhealthy'
    
    # Verificar estado de OSRM
    try:
        response = requests.get("http://localhost:5001/nearest/v1/driving/-74.8,11.0", timeout=3)
        osrm_status = 'healthy' if response.status_code == 200 else 'degraded'
    except:
        osrm_status = 'unavailable'
    
    return jsonify({
        'status': 'healthy' if db_status == 'healthy' else 'degraded',
        'database': db_status,
        'osrm': osrm_status,
        'snap_to_roads': osrm_status == 'healthy',
        'name': NAME,
        'mode': 'test' if IS_TEST_MODE else 'production',
        **get_git_info()
    })

if __name__ == "__main__":
    # Manejar el puerto desde argumentos de línea de comandos
    parser = argparse.ArgumentParser(description='Flask UDP Server')
    parser.add_argument('--port', type=int, default=5000, help='Port to run the web server on')
    args = parser.parse_args()

    # Iniciar el listener UDP en un thread separado
    udp_thread = threading.Thread(target=udp_listener, daemon=True)
    udp_thread.start()
    
    # Determinar el modo de ejecución
    mode = 'TEST' if IS_TEST_MODE else 'PRODUCTION'
    print(f"🚀 Starting Flask app on port {args.port} - Mode: {mode}")
    print(f"🔧 Environment: NAME={NAME}, BRANCH_NAME={BRANCH_NAME}, TEST_MODE={IS_TEST_MODE}")
    
    # Iniciar la aplicación Flask
    app.run(host='0.0.0.0', port=args.port, debug=IS_TEST_MODE)
