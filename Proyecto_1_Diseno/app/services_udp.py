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
            msg = data.decode('utf-8').strip()
            print(f"Received from {addr}: {msg}")

            # Parsear el mensaje línea por línea
            lines = msg.split('\n')
            payload = {}
            
            for line in lines:
                if ':' in line:
                    key, value = line.split(':', 1)
                    payload[key.strip()] = value.strip()
            
            # Extraer valores del payload
            device_id = payload.get('DeviceID')
            device_name = payload.get('DeviceName')
            lat_original = float(payload.get('Lat'))
            lon_original = float(payload.get('Lon'))
            timestamp = payload.get('Time')
            source = f"{addr[0]}:{addr[1]}"

            # Aplicar Snap-to-Road
            lat, lon = snap_to_road(lat_original, lon_original)

            # Guardar en la base de datos
            insert_coordinate(lat, lon, timestamp, source, device_id, device_name)

        except KeyError as e:
            print(f"❌ Campo faltante en el mensaje: {e}")
            print(f"   Mensaje recibido: {msg}")
        except ValueError as e:
            print(f"❌ Error al convertir coordenadas: {e}")
            print(f"   Mensaje recibido: {msg}")
        except Exception as e:
            print(f"❌ Error general procesando paquete: {e}")
            print(f"   Mensaje recibido: {msg}")