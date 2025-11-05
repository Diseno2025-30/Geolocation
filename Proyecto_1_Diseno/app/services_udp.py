# app/services_udp.py
import socket
import re
from app.config import UDP_IP, UDP_PORT
from app.database import insert_coordinate
from app.services_osrm import snap_to_road, check_osrm_available
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# Variable global para guardar la instancia de la app
app_instance = None

def set_flask_app(app):
    """Recibe la instancia de la app Flask desde run.py"""
    global app_instance
    app_instance = app

def parse_udp_message(message):
    """
    Parsea el mensaje UDP en formato:
    'Lat: 11.0236142, Lon: -74.807474, Time: 2025-11-05T13:17:40Z, UserID: 1044214787'
    
    Retorna un diccionario con los valores parseados o None si falla.
    """
    try:
        # Usar regex para extraer los valores
        lat_match = re.search(r'Lat:\s*([-\d.]+)', message)
        lon_match = re.search(r'Lon:\s*([-\d.]+)', message)
        time_match = re.search(r'Time:\s*([\d\-T:Z]+)', message)
        userid_match = re.search(r'UserID:\s*(\d+)', message)
        
        if not all([lat_match, lon_match, time_match, userid_match]):
            log.error(f"❌ Formato de mensaje inválido: {message}")
            return None
        
        lat = float(lat_match.group(1))
        lon = float(lon_match.group(1))
        timestamp_iso = time_match.group(1)
        user_id = userid_match.group(1)
        
        # Convertir timestamp de ISO format a formato DD/MM/YYYY HH:MM:SS
        from datetime import datetime
        dt = datetime.fromisoformat(timestamp_iso.replace('Z', '+00:00'))
        timestamp_formatted = dt.strftime('%d/%m/%Y %H:%M:%S')
        
        return {
            'lat': lat,
            'lon': lon,
            'timestamp': timestamp_formatted,
            'user_id': user_id
        }
    except Exception as e:
        log.error(f"❌ Error parseando mensaje: {e}")
        return None

def udp_listener():
    while not app_instance:
        log.info("Esperando instancia de Flask en UDP listener...")
        import time
        time.sleep(1)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_IP, UDP_PORT))
    log.info(f"🎧 Listening for UDP on {UDP_IP}:{UDP_PORT}")
    
    with app_instance.app_context():
        osrm_available = check_osrm_available()
        log.info(f"🗺️  Snap-to-roads: {'ACTIVO' if osrm_available else 'INACTIVO (OSRM no disponible)'}")
    
    while True:
        try:
            # 1. Recibir paquete UDP
            data, addr = sock.recvfrom(4096)
            source_ip = f"{addr[0]}:{addr[1]}"
            
            try:
                # 2. Decodificar mensaje
                message = data.decode('utf-8').strip()
                log.info(f"📩 Mensaje recibido desde {source_ip}: {message}")
            except UnicodeDecodeError as e:
                log.error(f"❌ Error decodificando mensaje desde {source_ip}: {e}")
                continue
            
            # 3. Parsear mensaje
            parsed_data = parse_udp_message(message)
            if not parsed_data:
                continue
            
            lat_original = parsed_data['lat']
            lon_original = parsed_data['lon']
            timestamp = parsed_data['timestamp']
            user_id = parsed_data['user_id']
            
            log.info(f"✓ Datos parseados: Lat={lat_original}, Lon={lon_original}, User={user_id}, Time={timestamp}")
            
            # 4. Aplicar snap-to-road si OSRM está disponible
            lat_final, lon_final = snap_to_road(lat_original, lon_original)
            
            # 5. Guardar en BD
            insert_coordinate(
                lat=lat_final,
                lon=lon_final,
                timestamp=timestamp,
                source=source_ip,
                user_id=user_id
            )
            
            log.info(f"📍 Coordenada guardada: ({lat_final:.6f}, {lon_final:.6f}) | user_id={user_id} | {timestamp}")

        except ValueError as e:
            log.error(f"❌ Error de conversión de datos: {e}")
        except Exception as e:
            log.exception(f"❌ Error general en listener UDP: {e}")