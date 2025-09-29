import socket
import threading
from flask import Flask, jsonify, render_template, send_from_directory, redirect, url_for, request
import psycopg2
import os
from dotenv import load_dotenv
import argparse
import subprocess
from datetime import datetime, timedelta

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

UDP_IP = "0.0.0.0"
UDP_PORT = 5049

def udp_listener():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_IP, UDP_PORT))
    print(f"Listening for UDP on {UDP_IP}:{UDP_PORT}")
    while True:
        data, addr = sock.recvfrom(1024)
        msg = data.decode().strip()
        print(f"Received from {addr}: {msg}")
        try:
            campos = msg.split(",")
            lat = float(campos[0].split(":")[1].strip())
            lon = float(campos[1].split(":")[1].strip())
            timestamp = campos[2].split(":", 1)[1].strip()
            source = f"{addr[0]}:{addr[1]}"

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO coordinates (lat, lon, timestamp, source) VALUES (%s, %s, %s, %s)",
                (lat, lon, timestamp, source)
            )
            conn.commit()
            conn.close()

            print(f"Datos guardados en la base de datos: {lat}, {lon}")

        except Exception as e:
            print("Invalid packet format:", msg)
            print(f"Error: {e}")

app = Flask(__name__)

# Configurar carpeta static explícitamente
app.static_folder = 'static'

# Ajustar rutas static según el modo
if IS_TEST_MODE:
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_prefix=1)
    app.static_url_path = '/test/static'
else:
    app.static_url_path = '/static'

def get_git_info():
    try:
        if IS_TEST_MODE and BRANCH_NAME != 'main':
            branch = BRANCH_NAME
            environment = 'TEST'
        else:
            try:
                branch = subprocess.check_output(['git', 'rev-parse', '--abbrev-ref', 'HEAD']).decode('utf-8').strip()
            except:
                branch = 'main'
            environment = 'PRODUCTION'
        
        try:
            commit = subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD']).decode('utf-8').strip()
        except:
            commit = 'unknown'
        
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
    try:
        date_obj = datetime.strptime(date_str, '%Y-%m-%d')
        return date_obj.strftime('%d/%m/%Y')
    except ValueError:
        return None

def generate_date_range_patterns(start_date, end_date):
    patterns = []
    current_date = datetime.strptime(start_date, '%Y-%m-%d')
    end_date_obj = datetime.strptime(end_date, '%Y-%m-%d')
    
    while current_date <= end_date_obj:
        pattern = current_date.strftime('%d/%m/%Y')
        patterns.append(pattern)
        current_date += timedelta(days=1)
    
    return patterns

@app.route('/')
def home():
    git_info = get_git_info()
    test_warning = None
    if IS_TEST_MODE:
        test_warning = f"AMBIENTE DE PRUEBA - Rama: {git_info['branch']}"
    
    return render_template('frontend.html', 
                         name=NAME, 
                         git_info=git_info, 
                         is_test=IS_TEST_MODE,
                         test_warning=test_warning)

@app.route('/historics/')
def historics():
    git_info = get_git_info()
    test_warning = None
    if IS_TEST_MODE:
        test_warning = f"AMBIENTE DE PRUEBA - Rama: {git_info['branch']}"
    
    return render_template('frontend_historical.html', 
                         name=NAME, 
                         git_info=git_info, 
                         is_test=IS_TEST_MODE,
                         test_warning=test_warning)

@app.route('/coordenadas')
def coordenadas():
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
    conn = None
    try:
        year, month, day = fecha.split('-')
        fecha_formateada = f"{day}/{month}/{year}"
        
        conn = get_db()
        cursor = conn.cursor()
        
        query = "SELECT lat, lon, timestamp FROM coordinates WHERE timestamp LIKE %s ORDER BY timestamp"
        cursor.execute(query, (f"{fecha_formateada}%",))
        results = cursor.fetchall()
        
        coordenadas = []
        for row in results:
            coordenadas.append({
                'lat': float(row[0]),
                'lon': float(row[1]),
                'timestamp': row[2]
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
    conn = None
    try:
        fecha_inicio = request.args.get('inicio')
        fecha_fin = request.args.get('fin')
        
        if not fecha_inicio or not fecha_fin:
            return jsonify({'error': 'Se requieren los parámetros inicio y fin'}), 400
        
        try:
            datetime.strptime(fecha_inicio, '%Y-%m-%d')
            datetime.strptime(fecha_fin, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'Formato de fecha inválido. Use YYYY-MM-DD'}), 400
        
        if fecha_inicio > fecha_fin:
            return jsonify({'error': 'La fecha de inicio debe ser anterior o igual a la fecha de fin'}), 400
        
        date_patterns = generate_date_range_patterns(fecha_inicio, fecha_fin)
        
        conn = get_db()
        cursor = conn.cursor()
        
        coordenadas = []
        
        for pattern in date_patterns:
            query = "SELECT lat, lon, timestamp FROM coordinates WHERE timestamp LIKE %s"
            cursor.execute(query, (f"{pattern}%",))
            results = cursor.fetchall()
            
            for row in results:
                coordenadas.append({
                    'lat': float(row[0]),
                    'lon': float(row[1]),
                    'timestamp': row[2]
                })
        
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

@app.route('/test/')
def test_home():
    git_info = get_git_info()
    test_warning = f"AMBIENTE DE PRUEBA - Rama: {git_info['branch']}"
    
    return render_template('frontend.html', 
                         name=NAME, 
                         git_info=git_info, 
                         is_test=True,
                         test_warning=test_warning)

@app.route('/test/historics/')
def test_historics():
    git_info = get_git_info()
    test_warning = f"AMBIENTE DE PRUEBA - Rama: {git_info['branch']}"
    
    return render_template('frontend_historical.html', 
                         name=NAME, 
                         git_info=git_info, 
                         is_test=True,
                         test_warning=test_warning)

@app.route('/test/coordenadas')
def test_coordenadas():
    return coordenadas()

@app.route('/test/historico/<fecha>')
def test_get_historico(fecha):
    return get_historico(fecha)

@app.route('/test/historico/rango')
def test_get_historico_rango():
    return get_historico_rango()

@app.route('/database')
def database():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM coordinates ORDER BY id DESC LIMIT 20")
    data = cursor.fetchall()
    conn.close()
    
    git_info = get_git_info()
    test_warning = None
    if IS_TEST_MODE:
        test_warning = f"AMBIENTE DE PRUEBA - Rama: {git_info['branch']}"
    
    return render_template('database.html',
                         coordinates=data,
                         name=NAME,
                         git_info=git_info,
                         is_test=IS_TEST_MODE,
                         test_warning=test_warning)

@app.route('/version')
def version():
    return jsonify(get_git_info())

@app.route('/health')
def health():
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        conn.close()
        db_status = 'healthy'
    except:
        db_status = 'unhealthy'
    
    return jsonify({
        'status': 'healthy' if db_status == 'healthy' else 'degraded',
        'database': db_status,
        'name': NAME,
        'mode': 'test' if IS_TEST_MODE else 'production',
        **get_git_info()
    })

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Flask UDP Server')
    parser.add_argument('--port', type=int, default=5000, help='Port to run the web server on')
    args = parser.parse_args()

    udp_thread = threading.Thread(target=udp_listener, daemon=True)
    udp_thread.start()
    
    mode = 'TEST' if IS_TEST_MODE else 'PRODUCTION'
    print(f"Starting Flask app on port {args.port} - Mode: {mode}")
    
    if IS_TEST_MODE:
        print(f"Branch: {BRANCH_NAME}")
        print(f"Server Name: {NAME}")
    
    app.run(host='0.0.0.0', port=args.port, debug=IS_TEST_MODE)