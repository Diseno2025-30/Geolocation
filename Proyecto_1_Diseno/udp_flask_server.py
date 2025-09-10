# udp_flask_server.py

import socket
import threading
from flask import Flask, jsonify, render_template
import psycopg2
import os

DB_HOST = 'databasegps.cgh0u6gck0qg.us-east-1.rds.amazonaws.com'
DB_NAME = 'databasegps'
DB_USER = 'postgres'
DB_PASSWORD = 'Diseno2025'

def get_db():
    # Conectarse a la base de datos de RDS usando el nuevo conector
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

# Global list to store GPS data
gps_data = []

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


# Nueva ruta para la página de inicio
@app.route('/')
def home():
    return render_template('frontend.html')

# Nueva ruta para el frontend
@app.route('/index')
def show_frontend():
    return render_template('index.html')

@app.route('/coordenadas')
def coordenadas():
    conn = get_db()
    cursor = conn.cursor()
    # Selecciona solo el dato más reciente (el último)
    cursor.execute("SELECT * FROM coordinates ORDER BY id DESC LIMIT 1")
    data = cursor.fetchone()  # Usa fetchone() para obtener un solo registro
    conn.close()

    # Si hay datos, convierte el registro en un diccionario; de lo contrario, envía un objeto vacío
    if data:
        result = dict(data)
    else:
        result = {}

    return jsonify(result)

# Nueva ruta para mostrar los últimos 20 datos
@app.route('/database')
def database():
    conn = get_db()
    cursor = conn.cursor()
    # Selecciona los 20 datos más recientes de la tabla
    cursor.execute("SELECT * FROM coordinates ORDER BY id DESC LIMIT 20")
    data = cursor.fetchall()
    conn.close()

    # Renderiza una nueva página HTML y le pasa los datos
    return render_template('database.html', coordinates=data)
if __name__ == "__main__":
    udp_thread = threading.Thread(target=udp_listener, daemon=True)
    udp_thread.start()
    app.run(host='0.0.0.0', port=5000)
