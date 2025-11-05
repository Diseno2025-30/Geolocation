# app/services_udp.py
import socket
from app.config import UDP_IP, UDP_PORT
from app.database import insert_coordinate
from app.services_osrm import snap_to_road, check_osrm_available

def udp_listener():
    """Escucha paquetes UDP, los ajusta a la carretera y los guarda en la BD."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_IP, UDP_PORT))
    print(f"Listening for UDP on {UDP_IP}:{UDP_PORT}")
    print(f"Snap-to-roads: {'ACTIVO' if check_osrm_available() else 'INACTIVO (OSRM no disponible)'}")
    
    while True:
        try:
            data, addr = sock.recvfrom(1024)
            msg = data.decode().strip()
            print(f"Received from {addr}: {msg}")

            campos = msg.split(",")
            lat_original = float(campos[0].split(":")[1].strip())
            lon_original = float(campos[1].split(":")[1].strip())
            timestamp = campos[2].split(":", 1)[1].strip()
            source = f"{addr[0]}:{addr[1]}"

            # Aplicar Snap-to-Road
            lat, lon = snap_to_road(lat_original, lon_original)

            # Guardar en la base de datos
            insert_coordinate(lat, lon, timestamp, source)

        except Exception as e:
            print(f"Invalid packet format or error: {msg}")
            print(f"Error: {e}")