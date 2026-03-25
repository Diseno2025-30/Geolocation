# app/services_udp.py
import socket
import re
from datetime import datetime
from app.config import UDP_IP, UDP_PORT
from app.database import insert_coordinate, upsert_location_session, close_location_session
from app.services_osrm import snap_to_road, check_osrm_available
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# Variable global para guardar la instancia de la app
app_instance = None

# Estado en memoria: rastrea la ubicación actual de cada usuario
# { user_id: { 'location_key', 'arrived_at', 'last_seen_at', 'segment_id', 'street_name', 'lat', 'lon' } }
_user_location_state = {}


def _get_location_key(segment_id, lat, lon):
    """Clave estable de ubicación: usa segment_id si disponible, si no coordenada redondeada a ~11m."""
    if segment_id:
        return segment_id
    return f"{round(lat, 4)}_{round(lon, 4)}"


def _process_location_session(user_id, lat, lon, segment_id, street_name, timestamp):
    """
    Detecta si el usuario lleva 10+ segundos en la misma ubicación y gestiona la sesión.
    Se llama después de cada coordenada UDP recibida.
    """
    global _user_location_state

    try:
        ts = datetime.strptime(timestamp, '%d/%m/%Y %H:%M:%S')
    except Exception:
        ts = datetime.now()

    current_key = _get_location_key(segment_id, lat, lon)
    state = _user_location_state.get(user_id)

    if state and state['location_key'] == current_key:
        # Mismo lugar — actualizar last_seen y calcular duración
        state['last_seen_at'] = ts
        duration = int((ts - state['arrived_at']).total_seconds())

        if duration >= 10:
            upsert_location_session(
                user_id=user_id,
                segment_id=segment_id,
                street_name=street_name,
                lat=lat,
                lon=lon,
                arrived_at=state['arrived_at'],
                last_seen_at=ts,
                duration_seconds=duration
            )
            log.info(f"⏱️  User {user_id} lleva {duration}s en '{street_name or current_key}'")
    else:
        # Nuevo lugar — cerrar sesión anterior si existe y reiniciar estado
        if state:
            close_location_session(user_id, state['last_seen_at'])
            log.info(f"📍 User {user_id} cambió de ubicación — sesión anterior cerrada")

        _user_location_state[user_id] = {
            'location_key': current_key,
            'arrived_at': ts,
            'last_seen_at': ts,
            'segment_id': segment_id,
            'street_name': street_name,
            'lat': lat,
            'lon': lon
        }

def set_flask_app(app):
    """Recibe la instancia de la app Flask desde run.py"""
    global app_instance
    app_instance = app

def parse_udp_message(message):
    """
    Parsea el mensaje UDP en formato:
    'Lat: 11.0235867, Lon: -74.8075142, Time: 05/11/2025 15:40:31, UserID: 1044214787'
    
    Retorna un diccionario con los valores parseados o None si falla.
    """
    try:
        # Usar regex para extraer los valores
        lat_match = re.search(r'Lat:\s*([-\d.]+)', message)
        lon_match = re.search(r'Lon:\s*([-\d.]+)', message)
        time_match = re.search(r'Time:\s*([\d/: ]+)', message)  # ← CAMBIO AQUÍ
        userid_match = re.search(r'UserID:\s*(\d+)', message)
        
        if not all([lat_match, lon_match, time_match, userid_match]):
            log.error(f"❌ Formato de mensaje inválido: {message}")
            return None
        
        lat = float(lat_match.group(1))
        lon = float(lon_match.group(1))
        timestamp_str = time_match.group(1).strip()  # ← Ya viene en formato DD/MM/YYYY HH:MM:SS
        user_id = userid_match.group(1)
        
        # Validar que el formato sea correcto
        from datetime import datetime
        try:
            dt = datetime.strptime(timestamp_str, '%d/%m/%Y %H:%M:%S')
            timestamp_formatted = timestamp_str  # Ya está en el formato correcto
        except ValueError as e:
            log.error(f"❌ Error parseando timestamp '{timestamp_str}': {e}")
            return None
        
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
    
    # ✅ CRÍTICO: Envolver TODO el loop en el contexto de Flask
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
                    log.error(f"❌ No se pudo parsear el mensaje: {message}")
                    continue
                
                lat_original = parsed_data['lat']
                lon_original = parsed_data['lon']
                timestamp = parsed_data['timestamp']
                user_id = parsed_data['user_id']
                
                log.info(f"✓ Datos parseados: Lat={lat_original}, Lon={lon_original}, User={user_id}, Time={timestamp}")
                
                # 4. Aplicar snap-to-road si OSRM está disponible
                lat_final, lon_final, segment_info = snap_to_road(lat_original, lon_original)
                
                # 5. Guardar en BD con manejo de errores explícito
                try:
                    insert_coordinate(
                        lat=lat_final,
                        lon=lon_final,
                        timestamp=timestamp,
                        source=source_ip,
                        user_id=user_id,
                        segment_id=segment_info['segment_id'] if segment_info else None,
                        street_name=segment_info['street_name'] if segment_info else None,
                        segment_length=segment_info['segment_length'] if segment_info else None
                    )
                    log.info(f"✅ Coordenada guardada: ({lat_final:.6f}, {lon_final:.6f}) | Segmento: {segment_info['segment_id'] if segment_info else 'N/A'}")
                except Exception as db_error:
                    log.exception(f"❌ Error guardando en BD: {db_error}")
                    continue

                # 6. Procesar sesión de tiempo en lugar
                try:
                    _process_location_session(
                        user_id=user_id,
                        lat=lat_final,
                        lon=lon_final,
                        segment_id=segment_info['segment_id'] if segment_info else None,
                        street_name=segment_info['street_name'] if segment_info else None,
                        timestamp=timestamp
                    )
                except Exception as session_error:
                    log.warning(f"⚠️ Error procesando sesión de ubicación: {session_error}")

            except ValueError as e:
                log.error(f"❌ Error de conversión de datos: {e}")
            except Exception as e:
                log.exception(f"❌ Error general en listener UDP: {e}")