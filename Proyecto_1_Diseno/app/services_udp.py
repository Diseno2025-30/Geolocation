# app/services_udp.py
import socket
import json
from app.config import UDP_IP, UDP_PORT
from app.database import insert_coordinate, get_user_by_firebase_uid
from app.services_osrm import snap_to_road, check_osrm_available
from flask_jwt_extended import decode_token
from jwt.exceptions import PyJWTError
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# Variable global para guardar la instancia de la app
app_instance = None

def set_flask_app(app):
    """Recibe la instancia de la app Flask desde run.py"""
    global app_instance
    app_instance = app

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
            data, addr = sock.recvfrom(4096)  # Buffer más grande para JSON
            source_ip = f"{addr[0]}:{addr[1]}"
            
            try:
                # 2. Parsear JSON
                payload = json.loads(data.decode('utf-8'))
            except json.JSONDecodeError as e:
                log.error(f"❌ JSON inválido desde {source_ip}: {e}")
                continue
            
            # 3. Validar campos requeridos
            required_fields = ['token', 'lat', 'lon', 'timestamp']
            if not all(field in payload for field in required_fields):
                log.error(f"❌ Campos faltantes en payload desde {source_ip}. Recibido: {payload.keys()}")
                continue
            
            token_string = payload['token']
            lat_original = float(payload['lat'])
            lon_original = float(payload['lon'])
            timestamp = payload['timestamp']
            
            # 4. Decodificar token para obtener uid (Firebase UID)
            uid = None
            local_user_id = None
            
            with app_instance.app_context():
                try:
                    decoded_token = decode_token(token_string)
                    uid = decoded_token['sub']  # 'sub' contiene el Firebase UID
                    
                    # 5. Buscar user_id LOCAL en la BD de ESTA instancia
                    user = get_user_by_firebase_uid(uid)
                    
                    if user:
                        local_user_id = user['id']
                        log.info(f"✓ Usuario identificado: uid={uid} → user_id_local={local_user_id} ({user['email']})")
                    else:
                        log.warning(f"⚠️  Usuario con uid={uid} no existe en BD local. Descartando paquete desde {source_ip}")
                        continue
                        
                except PyJWTError as e:
                    log.error(f"❌ Token JWT inválido desde {source_ip}: {e}")
                    continue
                except Exception as e:
                    log.error(f"❌ Error al procesar token desde {source_ip}: {e}")
                    continue
            
            # 6. Si todo es válido, guardar coordenada
            if uid and local_user_id:
                # Aplicar snap-to-road si OSRM está disponible
                lat_final, lon_final = snap_to_road(lat_original, lon_original)
                
                # Guardar en BD con el user_id LOCAL de esta instancia
                insert_coordinate(
                    lat=lat_final,
                    lon=lon_final,
                    timestamp=timestamp,
                    source="udp",
                    user_id=local_user_id
                )
                
                log.info(f"📍 Coordenada guardada: ({lat_final:.6f}, {lon_final:.6f}) | user_id={local_user_id} | {timestamp}")

        except ValueError as e:
            log.error(f"❌ Error de conversión de datos: {e}")
        except Exception as e:
            log.exception(f"❌ Error general en listener UDP: {e}")