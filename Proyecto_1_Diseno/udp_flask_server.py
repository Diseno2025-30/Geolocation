# udp_flask_server.py

import socket
import threading
from flask import Flask, jsonify, render_template

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
            # Esperamos: Lat: valor, Lon: valor, Time: valor
            campos = msg.split(",")
            lat = float(campos[0].split(":")[1].strip())
            lon = float(campos[1].split(":")[1].strip())
            timestamp = campos[2].split(":", 1)[1].strip()
            gps_data.append({
                "lat": lat,
                "lon": lon,
                "timestamp": timestamp,
                "source": f"{addr[0]}:{addr[1]}"
            })
        except Exception as e:
            print("Invalid packet format:", msg)
            print(f"Error: {e}")


app = Flask(__name__)


# Nueva ruta para la página de inicio
@app.route('/')
def home():
    return render_template('index.html')

# Nueva ruta para el frontend
@app.route('/frontend')
def show_frontend():
    return render_template('frontend.html')

@app.route('/coordenadas')
def coordenadas():
    # Show the 10 most recent data points
    return jsonify(gps_data[-10:])

if __name__ == "__main__":
    udp_thread = threading.Thread(target=udp_listener, daemon=True)
    udp_thread.start()
    app.run(host='0.0.0.0', port=5000)
