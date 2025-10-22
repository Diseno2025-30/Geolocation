import socket
import threading
from flask import Flask, jsonify, render_template, send_from_directory, redirect, url_for, request
import psycopg2
import os
from dotenv import load_dotenv
import argparse
import subprocess
from datetime import datetime, timedelta
import requests  # Para llamar a OSRM

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

# ========== FUNCIÓN SNAP TO ROADS ==========
def snap_to_road(lat, lon):
    """
    Ajusta las coordenadas GPS a la calle más cercana usando OSRM local.
    
    Args:
        lat (float): Latitud original del GPS
        lon (float): Longitud original del GPS
    
    Returns:
        tuple: (latitud_ajustada, longitud_ajustada)
    """
    try:
        # Usar OSRM local en puerto 5001
        url = f"http://localhost:5001/nearest/v1/driving/{lon},{lat}"
        
        # Timeout corto para no bloquear si OSRM no responde
        response = requests.get(url, params={'number': 1}, timeout=2)
        
        if response.status_code == 200:
            data = response.json()
            
            # Verificar que la respuesta sea válida
            if data.get('code') == 'Ok' and len(data.get('waypoints', [])) > 0:
                # Obtener coordenadas ajustadas a la calle
                snapped_location = data['waypoints'][0]['location']
                snapped_lon = snapped_location[0]
                snapped_lat = snapped_location[1]
                
                # Distancia del ajuste en metros
                distance = data['waypoints'][0].get('distance', 0)
                
                # Log del ajuste
                print(f"✓ Snap-to-road: ({lat:.6f}, {lon:.6f}) → ({snapped_lat:.6f}, {snapped_lon:.6f}) | Ajuste: {distance:.2f}m")
                
                return snapped_lat, snapped_lon
            else:
                print(f"⚠ OSRM: No encontró calle cercana para ({lat:.6f}, {lon:.6f}), usando coordenadas originales")
                return lat, lon
        else:
            print(f"⚠ OSRM HTTP error {response.status_code}, usando coordenadas originales")
            return lat, lon
            
    except requests.exceptions.Timeout:
        print(f"⚠ OSRM timeout para ({lat:.6f}, {lon:.6f}), usando coordenadas originales")
        return lat, lon
    except requests.exceptions.ConnectionError:
        print(f"⚠ OSRM no disponible (ConnectionError), usando coordenadas originales")
        return lat, lon
    except Exception as e:
        print(f"⚠ Error en snap_to_road: {e}, usando coordenadas originales")
        return lat, lon
# ============================================

UDP_IP = "0.0.0.0"
UDP_PORT = 5049

def udp_listener():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_IP, UDP_PORT))
    print(f"Listening for UDP on {UDP_IP}:{UDP_PORT}")
    print(f"Snap-to-roads: {'ACTIVO' if check_osrm_available() else 'INACTIVO (OSRM no disponible)'}")
    
    while True:
        data, addr = sock.recvfrom(1024)
        msg = data.decode().strip()
        print(f"Received from {addr}: {msg}")
        try:
            campos = msg.split(",")
            lat_original = float(campos[0].split(":")[1].strip())  # ← Renombrado
            lon_original = float(campos[1].split(":")[1].strip())  # ← Renombrado
            timestamp = campos[2].split(":", 1)[1].strip()
            source = f"{addr[0]}:{addr[1]}"

            # ========== APLICAR SNAP TO ROADS ==========
            lat, lon = snap_to_road(lat_original, lon_original)
            # ===========================================

            # Conecta a la base de datos e inserta los datos AJUSTADOS
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO coordinates (lat, lon, timestamp, source) VALUES (%s, %s, %s, %s)",
                (lat, lon, timestamp, source)  # ← Ahora usa coordenadas ajustadas
            )
            conn.commit()
            conn.close()

            print(f"✓ Guardado en BD: {lat:.6f}, {lon:.6f}")

        except Exception as e:
            print("Invalid packet format:", msg)
            print(f"Error: {e}")

def check_osrm_available():
    """Verifica si OSRM está disponible al iniciar"""
    try:
        response = requests.get("http://localhost:5001/nearest/v1/driving/-74.8,11.0", timeout=2)
        if response.status_code == 200:
            print("✅ OSRM disponible en puerto 5001")
            return True
        else:
            print("⚠️ OSRM responde pero con error")
            return False
    except:
        print("⚠️ OSRM no disponible - snap-to-roads desactivado (usar coordenadas originales)")
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
    """Endpoint para obtener datos históricos por rango de fechas (Optimizado)"""
    conn = None
    try:
        # Obtener parámetros de la URL
        fecha_inicio_str = request.args.get('inicio')
        hora_inicio_str = request.args.get('hora_inicio', '00:00') # <-- NUEVO: Tomar la hora
        fecha_fin_str = request.args.get('fin')
        hora_fin_str = request.args.get('hora_fin', '23:59') # <-- NUEVO: Tomar la hora

        if not fecha_inicio_str or not fecha_fin_str:
            return jsonify({'error': 'Se requieren los parámetros inicio y fin'}), 400

        # Crear datetimes de inicio y fin para la consulta
        # El frontend envía YYYY-MM-DD y HH:MM
        try:
            start_datetime = datetime.strptime(f"{fecha_inicio_str} {hora_inicio_str}", '%Y-%m-%d %H:%M')
            # Para el fin, usamos 59 segundos para incluir todo el minuto
            end_datetime = datetime.strptime(f"{fecha_fin_str} {hora_fin_str}", '%Y-%m-%d %H:%M')
            # Ajustamos el final para que sea inclusivo
            end_datetime = end_datetime.replace(second=59) 
            
        except ValueError:
            return jsonify({'error': 'Formato de fecha u hora inválido. Use YYYY-MM-DD y HH:MM'}), 400

        if start_datetime > end_datetime:
            return jsonify({'error': 'La fecha/hora de inicio debe ser anterior a la fecha/hora de fin'}), 400

        conn = get_db()
        cursor = conn.cursor()
        query = """
            SELECT DISTINCT 
                lat, 
                lon, 
                timestamp, 
                TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS') AS ts_orden
            FROM coordinates
            WHERE TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS')
                  BETWEEN %s AND %s
            ORDER BY ts_orden
            LIMIT 50000;
        """
        
        cursor.execute(query, (start_datetime, end_datetime))
        results = cursor.fetchall()

        coordenadas = []
        for row in results:
            coordenadas.append({
                'lat': float(row[0]),
                'lon': float(row[1]),
                'timestamp': row[2]
            })

        print(f"Consulta optimizada: {start_datetime} a {end_datetime} - {len(coordenadas)} registros encontrados")
        return jsonify(coordenadas)

    except Exception as e:
        print(f"Error en consulta histórica por rango: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            conn.close()

@app.route('/historico/geocerca')
def get_historico_geocerca():
    """Endpoint para obtener datos históricos por geocerca (bounds)"""
    conn = None
    try:
        # Obtener parámetros de la URL
        min_lat = float(request.args.get('min_lat'))
        min_lon = float(request.args.get('min_lon'))
        max_lat = float(request.args.get('max_lat'))
        max_lon = float(request.args.get('max_lon'))

        conn = get_db()
        cursor = conn.cursor()

        query = """
            SELECT DISTINCT 
                lat, 
                lon, 
                timestamp,
                TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS') AS ts_orden
            FROM coordinates
            WHERE (lat BETWEEN %s AND %s)
              AND (lon BETWEEN %s AND %s)
            ORDER BY ts_orden
            LIMIT 50000;
        """
        
        # PostgreSQL usa (min_lat, max_lat) y (min_lon, max_lon)
        cursor.execute(query, (min_lat, max_lat, min_lon, max_lon))
        results = cursor.fetchall()

        coordenadas = []
        for row in results:
            coordenadas.append({
                'lat': float(row[0]),
                'lon': float(row[1]),
                'timestamp': row[2]
            })

        print(f"Consulta por Geocerca: {len(coordenadas)} registros encontrados")
        return jsonify(coordenadas)

    except Exception as e:
        print(f"Error en consulta por geocerca: {e}")
        return jsonify({'error': 'Error interno del servidor o parámetros inválidos'}), 500
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
                         is_test=True,  # Forzar modo test para esta ruta
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
                         is_test=True,  # Forzar modo test para esta ruta
                         test_warning=test_warning)

@app.route('/test/coordenadas')
def test_coordenadas():
    """API endpoint de test para obtener las últimas coordenadas"""
    return coordenadas()  # Reutilizar la misma lógica

@app.route('/test/historico/<fecha>')
def test_get_historico(fecha):
    """Endpoint de test para obtener datos históricos por fecha"""
    return get_historico(fecha)  # Reutilizar la misma lógica

@app.route('/test/historico/rango')
def test_get_historico_rango():
    """Endpoint de test para obtener datos históricos por rango de fechas"""
    return get_historico_rango()  # Reutilizar la misma lógica

@app.route('/test/historico/geocerca')
def test_get_historico_geocerca():
    """Endpoint de test para obtener datos históricos por geocerca"""
    return get_historico_geocerca() # Reutilizar la misma lógica

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
    return osrm_proxy(params)  # Reutilizar la misma lógica

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
        response = requests.get("http://localhost:5001/nearest/v1/driving/-74.8,11.0", timeout=1)
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
    print(f"Starting Flask app on port {args.port} - Mode: {mode}")
    
    if IS_TEST_MODE:
        print(f"Branch: {BRANCH_NAME}")
        print(f"Server Name: {NAME}")
    
    # Iniciar la aplicación Flask
    app.run(host='0.0.0.0', port=args.port, debug=IS_TEST_MODE)