import socket
import threading
from flask import Flask, jsonify, render_template
import psycopg2
import os
from dotenv import load_dotenv
import argparse  # <-- Importar argparse

load_dotenv()

DB_HOST = os.getenv('DB_HOST')
DB_NAME = os.getenv('DB_NAME')
DB_USER = os.getenv('DB_USER')
DB_PASSWORD = os.getenv('DB_PASSWORD')
NAME = os.getenv('NAME', 'Default')


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

@app.route('/')
def home():
    return render_template('frontend.html', name=NAME)

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


if __name__ == "__main__":
    # --- Añadir esta sección para manejar el puerto ---
    parser = argparse.ArgumentParser(description='Flask UDP Server')
    parser.add_argument('--port', type=int, default=5000, help='Port to run the web server on')
    args = parser.parse_args()
    # ---------------------------------------------------

    udp_thread = threading.Thread(target=udp_listener, daemon=True)
    udp_thread.start()
    
    # --- Usar el puerto de los argumentos ---
    app.run(host='0.0.0.0', port=args.port)