# app/services_udp.py
import socket
from app.config import UDP_IP, UDP_PORT
from app.database import insert_coordinate
from app.services_osrm import snap_to_road, check_osrm_available
from flask_jwt_extended import decode_token
from jwt.exceptions import PyJWTError

# Variable global para guardar la instancia de la app
app_instance = None

def set_flask_app(app):
    """Recibe la instancia de la app Flask desde run.py"""
    global app_instance
    app_instance = app

def udp_listener():
    """Escucha paquetes UDP, los ajusta a la carretera y los guarda en la BD."""    
    while not app_instance:
        print("Esperando instancia de Flask en UDP listener...")
        import time
        time.sleep(1)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_IP, UDP_PORT))
    print(f"Listening for UDP on {UDP_IP}:{UDP_PORT}")
    
    # Verificar OSRM una vez que la app está cargada
    with app_instance.app_context():
        print(f"Snap-to-roads: {'ACTIVO' if check_osrm_available() else 'INACTIVO (OSRM no disponible)'}")
    
    while True:
        try:
            data, addr = sock.recvfrom(2048) # Aumentado tamaño por si el token es largo
            msg = data.decode().strip()
            source_ip = f"{addr[0]}:{addr[1]}"
            
            parts = msg.split(", Token: ")
            if len(parts) != 2:
                print(f"Invalid packet format (no token): {msg} from {source_ip}")
                continue
            
            token_string = parts[1]
            location_data = parts[0]
            
            loc_parts = location_data.split(", ")
            if len(loc_parts) < 3:
                print(f"Invalid location format: {location_data} from {source_ip}")
                continue

            lat_original = float(loc_parts[0].split(":")[1].strip())
            lon_original = float(loc_parts[1].split(":")[1].strip())
            timestamp = loc_parts[2].split(":", 1)[1].strip()

            # 2. Validar el JWT
            uid = None
            with app_instance.app_context():
                try:
                    # decode_token necesita el app_context para leer la SECRET_KEY
                    decoded_token = decode_token(token_string)
                    uid = decoded_token['sub'] # 'sub' es la clave para la 'identity'
                except PyJWTError as e:
                    print(f"Invalid JWT from {source_ip}: {e}")
                    continue # Descartar paquete si el token es inválido

            # 3. Si es válido, procesar y guardar
            if uid:
                # print(f"✓ Valid UDP from user {uid} ({source_ip})")
                
                # Aplicar Snap-to-Road
                lat, lon = snap_to_road(lat_original, lon_original)

                # Guardar en la base de datos, usando el UID como fuente
                insert_coordinate(lat, lon, timestamp, f"user_uid:{uid}")

        except ValueError as e:
            print(f"Invalid packet format (ValueError): {msg} - {e}")
        except Exception as e:
            print(f"Error general en listener UDP: {e}")