import socket
import threading
from flask import Flask, jsonify, render_template
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

DB_HOST = os.getenv('DB_HOST')
DB_NAME = os.getenv('DB_NAME')
DB_USER = os.getenv('DB_USER')
DB_PASSWORD = os.getenv('DB_PASSWORD')
NAME = os.getenv('NAME', 'Default')
IS_TEST = os.getenv('IS_TEST_DEPLOYMENT', 'false').lower() == 'true'

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

# Llama a esta función al inicio para asegurar que la tabla existe
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

# Configuración de prefijo de URL si estamos en modo test
if IS_TEST:
    from werkzeug.middleware.dispatcher import DispatcherMiddleware
    from werkzeug.wrappers import Response
    
    # Crear una aplicación dummy para la raíz
    def dummy_app(environ, start_response):
        response = Response('Not Found', status=404)
        return response(environ, start_response)
    
    # Configurar el dispatcher para servir la app en /test
    application = DispatcherMiddleware(dummy_app, {
        '/test': app
    })
    
    # Ajustar las rutas para el contexto /test
    @app.context_processor
    def inject_test_mode():
        return dict(is_test=True, url_prefix='/test')
else:
    application = app
    
    @app.context_processor
    def inject_test_mode():
        return dict(is_test=False, url_prefix='')

@app.route('/')
def home():
    # Agregar indicador visual si estamos en modo test
    template_name = NAME
    if IS_TEST:
        template_name = f"{NAME} (TEST ENVIRONMENT)"
    return render_template('frontend.html', name=template_name)

@app.route('/index')
def show_frontend():
    return render_template('index.html')

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

@app.route('/test-info')
def test_info():
    """Endpoint para verificar el estado del entorno de test"""
    return jsonify({
        'is_test': IS_TEST,
        'name': NAME,
        'branch': os.getenv('BRANCH_NAME', 'unknown'),
        'message': 'This is a TEST environment' if IS_TEST else 'This is PRODUCTION'
    })

if __name__ == "__main__":
    # Solo iniciar el listener UDP si no estamos en test
    # (para evitar conflictos de puerto entre main y test)
    if not IS_TEST:
        udp_thread = threading.Thread(target=udp_listener, daemon=True)
        udp_thread.start()
    
    port = int(os.getenv('FLASK_PORT', 5000))
    
    if IS_TEST:
        print(f"🧪 Starting TEST server for {NAME} on port {port}")
        # En modo test, usar el application con dispatcher
        from werkzeug.serving import run_simple
        run_simple('0.0.0.0', port, application, use_reloader=False, use_debugger=False)
    else:
        print(f"🚀 Starting PRODUCTION server for {NAME} on port {port}")
        app.run(host='0.0.0.0', port=port)