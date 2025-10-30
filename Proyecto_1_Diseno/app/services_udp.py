# app/services_udp.py
import socket
from app.config import UDP_IP, UDP_PORT
from app.database import insert_coordinate, get_user_by_firebase_uid
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
    print(f"🎧 Listening for UDP on {UDP_IP}:{UDP_PORT}")
    
    with app_instance.app_context():
        print(f"🛣️  Snap-to-roads: {'ACTIVO' if check_osrm_available() else 'INACTIVO (OSRM no disponible)'}")
    
    print("=" * 80)
    print("📡 UDP Listener activo - Esperando paquetes...")
    print("=" * 80)
    
    while True:
        try:
            data, addr = sock.recvfrom(2048) 
            msg = data.decode().strip()
            source_ip = f"{addr[0]}:{addr[1]}"
            
            print(f"\n{'='*80}")
            print(f"📦 Paquete recibido desde: {source_ip}")
            print(f"{'='*80}")
            
            # Verificar formato del paquete
            parts = msg.split(", Token: ")
            if len(parts) != 2:
                print(f"❌ FORMATO INVÁLIDO (no token separado correctamente)")
                print(f"   Mensaje completo: {msg[:200]}...")
                print(f"   Parts encontrados: {len(parts)}")
                continue
            
            token_string = parts[1]
            location_data = parts[0]
            
            print(f"📍 Datos de ubicación: {location_data}")
            print(f"🔑 Token (primeros 50 chars): {token_string[:50]}...")
            print(f"🔑 Token (últimos 50 chars): ...{token_string[-50:]}")
            
            # Parsear ubicación
            loc_parts = location_data.split(", ")
            if len(loc_parts) < 3:
                print(f"❌ FORMATO DE UBICACIÓN INVÁLIDO")
                print(f"   Location data: {location_data}")
                print(f"   Parts encontrados: {len(loc_parts)}")
                continue

            lat_original = float(loc_parts[0].split(":")[1].strip())
            lon_original = float(loc_parts[1].split(":")[1].strip())
            timestamp = loc_parts[2].split(":", 1)[1].strip()
            
            print(f"✓ Lat: {lat_original}")
            print(f"✓ Lon: {lon_original}")
            print(f"✓ Timestamp: {timestamp}")

            uid = None
            local_user_id = None
            
            # Validar token y obtener user_id
            with app_instance.app_context():
                try:
                    print(f"\n🔐 Decodificando token JWT...")
                    decoded_token = decode_token(token_string)
                    uid = decoded_token.get('sub')
                    
                    if not uid:
                        print(f"❌ Token JWT válido pero SIN 'sub' (Firebase UID)")
                        print(f"   Token decodificado: {decoded_token}")
                        continue
                    
                    print(f"✓ Token válido")
                    print(f"✓ Firebase UID extraído: {uid}")
                    
                    # Buscar usuario en BD local
                    print(f"\n👤 Buscando usuario en BD local...")
                    user = get_user_by_firebase_uid(uid)
                    
                    if user:
                        local_user_id = user['id']
                        print(f"✓ Usuario encontrado en BD")
                        print(f"✓ Local user_id: {local_user_id}")
                        print(f"✓ Email: {user.get('email', 'N/A')}")
                    else:
                        print(f"⚠️  USUARIO NO ENCONTRADO EN BD LOCAL")
                        print(f"   Firebase UID: {uid}")
                        print(f"   Este usuario debe registrarse en la BD local")
                        print(f"   La coordenada se guardará con user_id=NULL")
                        
                except PyJWTError as e:
                    print(f"❌ TOKEN JWT INVÁLIDO")
                    print(f"   Error: {type(e).__name__}: {e}")
                    print(f"   IP: {source_ip}")
                    print(f"   Token (inicio): {token_string[:100]}...")
                    continue
                except Exception as e:
                    print(f"❌ Error inesperado al procesar token")
                    print(f"   Error: {type(e).__name__}: {e}")
                    import traceback
                    traceback.print_exc()
                    continue

            # Guardar coordenada
            if uid:
                print(f"\n💾 Guardando coordenada en BD...")
                try:
                    lat, lon = snap_to_road(lat_original, lon_original)
                    
                    if lat != lat_original or lon != lon_original:
                        print(f"🛣️  Snap-to-road aplicado:")
                        print(f"   Original: ({lat_original}, {lon_original})")
                        print(f"   Ajustado: ({lat}, {lon})")
                    else:
                        print(f"📍 Sin snap-to-road (OSRM no disponible o sin cambios)")
                    
                    insert_coordinate(
                        lat, 
                        lon, 
                        timestamp, 
                        source="udp", 
                        user_id=local_user_id
                    )
                    
                    if local_user_id:
                        print(f"✅ COORDENADA GUARDADA CON ÉXITO")
                        print(f"   user_id: {local_user_id}")
                        print(f"   lat: {lat}")
                        print(f"   lon: {lon}")
                    else:
                        print(f"⚠️  COORDENADA GUARDADA PERO SIN user_id")
                        print(f"   user_id: NULL")
                        print(f"   lat: {lat}")
                        print(f"   lon: {lon}")
                        print(f"   Razón: Usuario con UID '{uid}' no existe en BD local")
                    
                except Exception as e:
                    print(f"❌ Error guardando coordenada")
                    print(f"   Error: {type(e).__name__}: {e}")
                    import traceback
                    traceback.print_exc()
            else:
                print(f"⚠️  Paquete procesado pero sin UID válido - NO se guardó")

        except ValueError as e:
            print(f"\n❌ ERROR DE FORMATO (ValueError)")
            print(f"   Mensaje: {msg[:200] if 'msg' in locals() else 'N/A'}...")
            print(f"   Error: {e}")
        except Exception as e:
            print(f"\n❌ ERROR GENERAL en listener UDP")
            print(f"   Error: {type(e).__name__}: {e}")
            print(f"   Mensaje: {msg[:200] if 'msg' in locals() else 'N/A'}...")
            import traceback
            traceback.print_exc()