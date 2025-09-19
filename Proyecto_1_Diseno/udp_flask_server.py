import socket
import threading
from flask import Flask, jsonify, render_template, send_from_directory
import psycopg2
import os
from dotenv import load_dotenv
import argparse
import subprocess

load_dotenv()

DB_HOST = os.getenv('DB_HOST')
DB_NAME = os.getenv('DB_NAME')
DB_USER = os.getenv('DB_USER')
DB_PASSWORD = os.getenv('DB_PASSWORD')
NAME = os.getenv('NAME', 'Default')

# Detectar si estamos en modo test
IS_TEST_MODE = os.getenv('FLASK_TEST_MODE', 'false').lower() == 'true'

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

            # Conecta a la base de datos e inserta los datos
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

# Función para obtener información de la rama actual
def get_git_info():
    try:
        # Obtener la rama actual
        branch = subprocess.check_output(['git', 'rev-parse', '--abbrev-ref', 'HEAD']).decode('utf-8').strip()
        # Obtener el último commit
        commit = subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD']).decode('utf-8').strip()
        # Obtener la fecha del último commit
        date = subprocess.check_output(['git', 'log', '-1', '--format=%cd', '--date=short']).decode('utf-8').strip()
        return {
            'branch': branch,
            'commit': commit,
            'date': date,
            'is_test': IS_TEST_MODE
        }
    except:
        return {
            'branch': 'unknown',
            'commit': 'unknown',
            'date': 'unknown',
            'is_test': IS_TEST_MODE
        }

@app.route('/')
def home():
    # La ruta principal siempre muestra el frontend de producción
    template = 'frontend.html'
    git_info = get_git_info() if IS_TEST_MODE else None
    return render_template(template, name=NAME, git_info=git_info, is_test=False)

@app.route('/test')
@app.route('/test/')
def test_home():
    # La ruta /test muestra el frontend de la rama actual
    git_info = get_git_info()
    
    template = 'frontend.html'
    
    return render_template(template, 
                         name=NAME, 
                         git_info=git_info,
                         is_test=True,
                         test_warning="⚠️ ENTORNO DE PRUEBA - Rama: " + git_info['branch'])

@app.route('/test/<path:path>')
def test_route(path):
    """Maneja todas las subrutas bajo /test"""
    # Redirige las peticiones a las rutas normales
    if path == 'coordenadas':
        return coordenadas()
    elif path == 'database':
        return database()
    elif path.startswith('static/'):
        # Servir archivos estáticos
        return send_from_directory('static', path.replace('static/', ''))
    else:
        return "Not Found", 404

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

@app.route('/database')
def database():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM coordinates ORDER BY id DESC LIMIT 20")
    data = cursor.fetchall()
    conn.close()
    return render_template('database.html', coordinates=data)

@app.route('/version')
def version():
    """Endpoint para verificar la versión actual del código"""
    return jsonify(get_git_info())

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'name': NAME,
        'mode': 'test' if IS_TEST_MODE else 'production',
        **get_git_info()
    })


if __name__ == "__main__":
    # Manejar el puerto desde argumentos de línea de comandos
    parser = argparse.ArgumentParser(description='Flask UDP Server')
    parser.add_argument('--port', type=int, default=5000, help='Port to run the web server on')
    args = parser.parse_args()

    udp_thread = threading.Thread(target=udp_listener, daemon=True)
    udp_thread.start()
    
    # Usar el puerto de los argumentos
    print(f"Starting Flask app on port {args.port} - Mode: {'TEST' if IS_TEST_MODE else 'PRODUCTION'}")
    app.run(host='0.0.0.0', port=args.port, debug=IS_TEST_MODE)