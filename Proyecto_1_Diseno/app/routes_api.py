# app/routes_api.py
from flask import Blueprint, jsonify, request, current_app
from app.database import (
    get_last_coordinate, get_historical_by_date, 
    get_historical_by_range, get_historical_by_geofence, 
    get_db, get_active_devices, get_last_coordinate_by_user, get_congestion_segments, 
    get_empresas_from_usuarios, get_rutas_by_empresa, get_all_rutas, 
    insert_ruta, update_ruta, delete_ruta
)
from app.utils import get_git_info
from app.services_osrm import check_osrm_available
from datetime import datetime
import requests
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


api_bp = Blueprint('api', __name__)

# ===== ALMACENAMIENTO EN MEMORIA PARA DESTINOS =====
# Diccionario para almacenar destinos pendientes por user_id
pending_destinations = {}


def get_segment_by_id(segment_id):
    """Obtener detalles de un segmento por su ID"""
    try:
        # Buscar en el grafo de red
        segment = None
        
        for u, v, data in G.edges(data=True):
            if data.get('segment_id') == segment_id:
                segment = {
                    'segment_id': segment_id,
                    'street_name': data.get('name', 'Sin nombre'),
                    'segment_length': data.get('length', 0),
                    'bearing': data.get('bearing', 0),
                    'nodes': [
                        {'lat': G.nodes[u]['y'], 'lon': G.nodes[u]['x']},
                        {'lat': G.nodes[v]['y'], 'lon': G.nodes[v]['x']}
                    ]
                }
                break
        
        if segment:
            return jsonify({
                'success': True,
                'segment': segment
            })
        else:
            return jsonify({
                'success': False,
                'error': f'Segmento {segment_id} no encontrado'
            }), 404
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ===== ENDPOINTS DE API (Producción y Test) =====
def get_segment_from_coords():
    """Obtiene segment_id para coordenadas específicas."""
    try:
        lat = float(request.args.get('lat'))
        lon = float(request.args.get('lon'))
        
        if not lat or not lon:
            return jsonify({'success': False, 'error': 'Se requieren lat y lon'}), 400
        
        # Usar tu función existente (mejorada)
        from app.services_osrm import snap_to_road
        snapped_lat, snapped_lon, segment_info = snap_to_road(lat, lon)
        
        if segment_info:
            return jsonify({
                'success': True,
                'original_coords': {'lat': lat, 'lon': lon},
                'snapped_coords': {'lat': snapped_lat, 'lon': snapped_lon},
                'segment': segment_info
            })
        else:
            return jsonify({
                'success': False,
                'error': 'No se pudo encontrar segmento para estas coordenadas'
            }), 404
            
    except ValueError:
        return jsonify({'success': False, 'error': 'Coordenadas inválidas'}), 400
    except Exception as e:
        log.error(f"Error obteniendo segmento: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _register_user():
    """Endpoint para registrar usuarios vía HTTPS (seguro)"""
    try:
        data = request.json
        user_id = data.get('user_id')
        cedula = data.get('cedula')
        nombre_completo = data.get('nombre_completo')
        email = data.get('email')
        telefono = data.get('telefono')
        empresa = data.get('empresa')
        
        if not all([user_id, cedula, nombre_completo, email]):
            return jsonify({
                'success': False,
                'error': 'Faltan campos obligatorios: user_id, cedula, nombre_completo, email'
            }), 400
        
        # Guardar en BD usando la función que ya existe
        from app.database import insert_user_registration
        insert_user_registration(user_id, cedula, nombre_completo, email, telefono, empresa)
        
        return jsonify({
            'success': True,
            'message': 'Usuario registrado exitosamente',
            'user_id': user_id
        })
        
    except Exception as e:
        print(f"Error registrando usuario: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def get_registered_users():
    """Obtiene la lista de user_id únicos registrados en la base de datos."""
    try:
        conn = get_db()
        cursor = conn.cursor()

        # Obtener todos los user_id únicos de la tabla coordinates
        cursor.execute('SELECT DISTINCT user_id FROM coordinates WHERE user_id IS NOT NULL ORDER BY user_id')
        users = cursor.fetchall()

        conn.close()

        # Convertir a lista simple de user_ids
        user_list = [user[0] for user in users]

        return jsonify({'users': user_list, 'count': len(user_list)})
    except Exception as e:
        print(f"Error obteniendo usuarios registrados: {e}")
        return jsonify({'users': [], 'count': 0}), 500

def _get_coordenadas():
    return jsonify(get_last_coordinate())

def _get_historico(fecha):
    try:
        user_id = request.args.get('user_id')
        
        year, month, day = fecha.split('-')
        fecha_formateada = f"{day}/{month}/{year}"
        
        coordenadas = get_historical_by_date(fecha_formateada, user_id=user_id)
        return jsonify(coordenadas)
    except Exception as e:
        print(f"Error en consulta histórica: {e}")
        return jsonify([]), 500

def _get_historico_rango():
    try:
        fecha_inicio_str = request.args.get('inicio')
        hora_inicio_str = request.args.get('hora_inicio', '00:00')
        fecha_fin_str = request.args.get('fin')
        hora_fin_str = request.args.get('hora_fin', '23:59')

        user_id = request.args.get('user_id')  # Single user (legacy)
        user_ids_str = request.args.get('user_ids')  # Multiple users (new)

        if not fecha_inicio_str or not fecha_fin_str:
            return jsonify({'error': 'Se requieren los parámetros inicio y fin'}), 400

        start_datetime = datetime.strptime(f"{fecha_inicio_str} {hora_inicio_str}", '%Y-%m-%d %H:%M')
        end_datetime = datetime.strptime(f"{fecha_fin_str} {hora_fin_str}", '%Y-%m-%d %H:%M').replace(second=59)

        if start_datetime > end_datetime:
            return jsonify({'error': 'La fecha/hora de inicio debe ser anterior a la fecha/hora de fin'}), 400

        # Procesar múltiples user_ids si están presentes
        user_ids = None
        if user_ids_str:
            user_ids = [uid.strip() for uid in user_ids_str.split(',') if uid.strip()]

        coordenadas = get_historical_by_range(start_datetime, end_datetime, user_id=user_id, user_ids=user_ids)
        return jsonify(coordenadas)

    except ValueError:
        return jsonify({'error': 'Formato de fecha u hora inválido. Use YYYY-MM-DD y HH:MM'}), 400
    except Exception as e:
        print(f"Error en consulta histórica por rango: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500

def _get_historico_geocerca():
    try:
        min_lat = float(request.args.get('min_lat'))
        min_lon = float(request.args.get('min_lon'))
        max_lat = float(request.args.get('max_lat'))
        max_lon = float(request.args.get('max_lon'))

        user_id = request.args.get('user_id')  # Single user (legacy)
        user_ids_str = request.args.get('user_ids')  # Multiple users (new)

        # Parámetros opcionales de tiempo
        fecha_inicio_str = request.args.get('inicio')
        hora_inicio_str = request.args.get('hora_inicio', '00:00')
        fecha_fin_str = request.args.get('fin')
        hora_fin_str = request.args.get('hora_fin', '23:59')

        # Procesar múltiples user_ids si están presentes
        user_ids = None
        if user_ids_str:
            user_ids = [uid.strip() for uid in user_ids_str.split(',') if uid.strip()]

        # Procesar fechas si están presentes
        start_datetime = None
        end_datetime = None
        if fecha_inicio_str and fecha_fin_str:
            start_datetime = datetime.strptime(f"{fecha_inicio_str} {hora_inicio_str}", '%Y-%m-%d %H:%M')
            end_datetime = datetime.strptime(f"{fecha_fin_str} {hora_fin_str}", '%Y-%m-%d %H:%M').replace(second=59)

        coordenadas = get_historical_by_geofence(
            min_lat, max_lat, min_lon, max_lon,
            user_id=user_id,
            user_ids=user_ids,
            start_datetime=start_datetime,
            end_datetime=end_datetime
        )
        return jsonify(coordenadas)
    except Exception as e:
        print(f"Error en consulta por geocerca: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Error interno del servidor o parámetros inválidos'}), 500

def _osrm_proxy(params):
    try:
        url = f"http://localhost:5001/route/v1/driving/{params}"
        response = requests.get(url, params=request.args, timeout=5)
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({'error': str(e), 'code': 'Error'}), 500

def _get_active_devices():
    """Retorna dispositivos activos (últimos 2 minutos)."""
    try:
        devices = get_active_devices()
        return jsonify(devices)
    except Exception as e:
        print(f"Error obteniendo dispositivos activos: {e}")
        import traceback
        traceback.print_exc()
        return jsonify([]), 500


def _send_destination():
    """Guarda un destino para enviar a la app en base de datos"""
    try:
        data = request.json
        user_id = data.get('user_id')
        latitude = data.get('latitude')
        longitude = data.get('longitude')
        
        if not user_id or latitude is None or longitude is None:
            return jsonify({'success': False, 'error': 'Parámetros incompletos'}), 400
        
        # Guardar en base de datos
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO destinations (user_id, latitude, longitude, status)
            VALUES (%s, %s, %s, 'pending')
            RETURNING id, created_at
        ''', (user_id, latitude, longitude))
        
        result = cursor.fetchone()
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': 'Destino guardado en base de datos',
            'destination_id': result[0],
            'created_at': result[1].strftime('%d/%m/%Y %H:%M:%S')
        })
        
    except Exception as e:
        print(f"Error enviando destino: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def get_user_destinations(user_id):
    """Obtiene los destinos de un usuario en los últimos 30 minutos"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, latitude, longitude, status, created_at
            FROM destinations 
            WHERE user_id = %s 
              AND created_at >= NOW() - INTERVAL '30 minutes'
            ORDER BY created_at DESC
        ''', (user_id,))
        
        results = cursor.fetchall()
        conn.close()
        
        destinations = []
        for row in results:
            destinations.append({
                'id': row[0],
                'latitude': float(row[1]),
                'longitude': float(row[2]),
                'status': row[3],
                'created_at': row[4].strftime('%d/%m/%Y %H:%M:%S')
            })
        
        return jsonify({
            'success': True,
            'user_id': user_id,
            'destinations': destinations,
            'count': len(destinations)
        })
        
    except Exception as e:
        print(f"Error obteniendo destinos: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _get_destination(user_id):
    """La app consulta si tiene un destino pendiente (desde base de datos)"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Buscar el destino más reciente pendiente
        cursor.execute('''
            SELECT id, latitude, longitude, created_at
            FROM destinations 
            WHERE user_id = %s 
              AND status = 'pending'
            ORDER BY created_at DESC 
            LIMIT 1
        ''', (user_id,))
        
        result = cursor.fetchone()
        
        if result:
            # Marcar como enviado
            cursor.execute('''
                UPDATE destinations 
                SET status = 'sent' 
                WHERE id = %s
            ''', (result[0],))
            conn.commit()
            
            destination = {
                'lat': float(result[1]),
                'lon': float(result[2]),
                'timestamp': result[3].strftime('%d/%m/%Y %H:%M:%S')
            }
            
            conn.close()
            return jsonify({
                'has_destination': True,
                'destination': destination
            })
        
        conn.close()
        return jsonify({'has_destination': False})
        
    except Exception as e:
        return jsonify({'has_destination': False, 'error': str(e)}), 500


def _complete_destination():
    """Marca un destino como completado cuando el usuario llega"""
    try:
        data = request.json
        user_id = data.get('user_id')
        
        if not user_id:
            return jsonify({'success': False, 'error': 'user_id requerido'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Completar el destino más reciente (pending o sent)
        cursor.execute('''
            UPDATE destinations 
            SET status = 'completed', completed_at = NOW()
            WHERE user_id = %s 
              AND status IN ('pending', 'sent')
              AND id = (
                  SELECT id FROM destinations 
                  WHERE user_id = %s AND status IN ('pending', 'sent')
                  ORDER BY created_at DESC 
                  LIMIT 1
              )
            RETURNING id
        ''', (user_id, user_id))
        
        result = cursor.fetchone()
        conn.commit()
        conn.close()
        
        if result:
            return jsonify({
                'success': True,
                'message': 'Destino marcado como completado',
                'destination_id': result[0]
            })
        else:
            return jsonify({
                'success': False,
                'error': 'No se encontró destino pendiente para este usuario'
            }), 404
            
    except Exception as e:
        print(f"Error completando destino: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _get_user_location(user_id):
    """Obtiene la última ubicación de un usuario específico."""
    return jsonify(get_last_coordinate_by_user(user_id))

def get_congestion():
    """Obtiene segmentos con congestión (2+ vehículos)."""
    try:
        time_window = int(request.args.get('time_window'))
        congestion_data = get_congestion_segments(time_window)
        
        return jsonify({
            'success': True,
            'congestion': congestion_data,
            'total': len(congestion_data)
        })
    except Exception as e:
        log.error(f"Error en endpoint de congestión: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def _get_empresas():
    """Obtiene lista de empresas registradas."""
    try:
        empresas = get_empresas_from_usuarios()
        return jsonify({
            'success': True,
            'empresas': empresas,
            'count': len(empresas)
        })
    except Exception as e:
        print(f"Error obteniendo empresas: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def _get_rutas():
    """Obtiene rutas filtradas por empresa (opcional)."""
    try:
        empresa = request.args.get('empresa')
        
        if empresa:
            rutas = get_rutas_by_empresa(empresa)
        else:
            rutas = get_all_rutas()
        
        return jsonify({
            'success': True,
            'rutas': rutas,
            'count': len(rutas)
        })
    except Exception as e:
        print(f"Error obteniendo rutas: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def _create_ruta():
    """Crea una nueva ruta preestablecida."""
    try:
        data = request.json
        nombre_ruta = data.get('nombre_ruta')
        empresa = data.get('empresa')
        segment_ids = data.get('segment_ids')  # String separado por comas
        descripcion = data.get('descripcion')
        
        if not nombre_ruta or not empresa or not segment_ids:
            return jsonify({
                'success': False,
                'error': 'Faltan campos requeridos: nombre_ruta, empresa, segment_ids'
            }), 400
        
        ruta_id = insert_ruta(nombre_ruta, empresa, segment_ids, descripcion)
        
        return jsonify({
            'success': True,
            'message': 'Ruta creada exitosamente',
            'ruta_id': ruta_id
        })
    except Exception as e:
        print(f"Error creando ruta: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def _update_ruta(ruta_id):
    """Actualiza una ruta existente."""
    try:
        data = request.json
        nombre_ruta = data.get('nombre_ruta')
        segment_ids = data.get('segment_ids')
        descripcion = data.get('descripcion')
        
        success = update_ruta(ruta_id, nombre_ruta, segment_ids, descripcion)
        
        if success:
            return jsonify({
                'success': True,
                'message': 'Ruta actualizada exitosamente'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Error actualizando ruta'
            }), 500
    except Exception as e:
        print(f"Error actualizando ruta: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def _delete_ruta(ruta_id):
    """Desactiva una ruta."""
    try:
        success = delete_ruta(ruta_id)
        
        if success:
            return jsonify({
                'success': True,
                'message': 'Ruta desactivada exitosamente'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Error desactivando ruta'
            }), 500
    except Exception as e:
        print(f"Error desactivando ruta: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def _debug_usuarios():
    """DEBUG: Ver todos los usuarios y empresas registradas"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Ver todos los usuarios
        cursor.execute("""
            SELECT user_id, cedula, nombre_completo, email, telefono, empresa, created_at, updated_at
            FROM usuarios_web 
            ORDER BY created_at DESC
        """)
        users = cursor.fetchall()
        
        usuarios_list = []
        empresas_set = set()
        
        for user in users:
            empresa = user[5] if user[5] else "[SIN EMPRESA]"
            if user[5]:
                empresas_set.add(user[5])
            
            usuarios_list.append({
                'user_id': user[0],
                'cedula': user[1],
                'nombre_completo': user[2],
                'email': user[3],
                'telefono': user[4],
                'empresa': empresa,
                'created_at': user[6].strftime('%d/%m/%Y %H:%M:%S') if user[6] else None,
                'updated_at': user[7].strftime('%d/%m/%Y %H:%M:%S') if user[7] else None
            })
        
        # Estadísticas
        cursor.execute("SELECT COUNT(*) FROM usuarios_web")
        total_usuarios = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM usuarios_web WHERE empresa IS NOT NULL AND empresa != ''")
        usuarios_con_empresa = cursor.fetchone()[0]
        
        conn.close()
        
        return jsonify({
            'success': True,
            'total_usuarios': total_usuarios,
            'usuarios_con_empresa': usuarios_con_empresa,
            'usuarios_sin_empresa': total_usuarios - usuarios_con_empresa,
            'empresas_unicas': sorted(list(empresas_set)),
            'count_empresas': len(empresas_set),
            'usuarios': usuarios_list
        })
        
    except Exception as e:
        print(f"Error en debug usuarios: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
def _debug_usuarios():
    """DEBUG: Ver todos los usuarios y empresas registradas"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Ver todos los usuarios
        cursor.execute("""
            SELECT user_id, cedula, nombre_completo, email, telefono, empresa, created_at, updated_at
            FROM usuarios_web 
            ORDER BY created_at DESC
        """)
        users = cursor.fetchall()
        
        usuarios_list = []
        empresas_set = set()
        
        for user in users:
            empresa = user[5] if user[5] else "[SIN EMPRESA]"
            if user[5]:
                empresas_set.add(user[5])
            
            usuarios_list.append({
                'user_id': user[0],
                'cedula': user[1],
                'nombre_completo': user[2],
                'email': user[3],
                'telefono': user[4],
                'empresa': empresa,
                'created_at': user[6].strftime('%d/%m/%Y %H:%M:%S') if user[6] else None,
                'updated_at': user[7].strftime('%d/%m/%Y %H:%M:%S') if user[7] else None
            })
        
        # Estadísticas
        cursor.execute("SELECT COUNT(*) FROM usuarios_web")
        total_usuarios = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM usuarios_web WHERE empresa IS NOT NULL AND empresa != ''")
        usuarios_con_empresa = cursor.fetchone()[0]
        
        conn.close()
        
        return jsonify({
            'success': True,
            'total_usuarios': total_usuarios,
            'usuarios_con_empresa': usuarios_con_empresa,
            'usuarios_sin_empresa': total_usuarios - usuarios_con_empresa,
            'empresas_unicas': sorted(list(empresas_set)),
            'count_empresas': len(empresas_set),
            'usuarios': usuarios_list
        })
        
    except Exception as e:
        print(f"Error en debug usuarios: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

        
# --- Rutas de Producción ---

@app.route('/api/segment/<segment_id>')
def segment_details(segment_id):
    return get_segment_by_id(segment_id)

@api_bp.route('/api/users/registered')
def registered_users():
    return get_registered_users()

@api_bp.route('/api/congestion', methods=['GET'])
def congestion_consult():
    return get_congestion()

@api_bp.route('/coordenadas')
def coordenadas():
    return _get_coordenadas()

@api_bp.route('/historico/<fecha>')
def get_historico(fecha):
    return _get_historico(fecha)

@api_bp.route('/historico/rango')
def get_historico_rango():
    return _get_historico_rango()

@api_bp.route('/historico/geocerca')
def get_historico_geocerca():
    return _get_historico_geocerca()

@api_bp.route('/osrm/route/<path:params>')
def osrm_proxy(params):
    return _osrm_proxy(params)

@api_bp.route('/api/devices/active')
def active_devices():
    return _get_active_devices()

@api_bp.route('/api/destination/send', methods=['POST'])
def send_destination():
    return _send_destination()

@api_bp.route('/consult/destination/get/<user_id>')
def get_destination(user_id):
    return _get_destination(user_id)

@api_bp.route('/database/destination/<user_id>')
def save_destinations(user_id):
    return get_user_destinations(user_id)

@api_bp.route('/api/location/<user_id>')
def get_user_location(user_id):
    return _get_user_location(user_id)

@api_bp.route('/api/empresas', methods=['GET'])
def get_empresas():
    return _get_empresas()

@api_bp.route('/api/rutas', methods=['GET'])
def get_rutas():
    return _get_rutas()

@api_bp.route('/api/rutas', methods=['POST'])
def create_ruta():
    return _create_ruta()

@api_bp.route('/api/rutas/<int:ruta_id>', methods=['PUT'])
def update_ruta_endpoint(ruta_id):
    return _update_ruta(ruta_id)

@api_bp.route('/api/rutas/<int:ruta_id>', methods=['DELETE'])
def delete_ruta_endpoint(ruta_id):
    return _delete_ruta(ruta_id)

@api_bp.route('/api/debug/usuarios', methods=['GET'])
def debug_usuarios():
    return _debug_usuarios()

@api_bp.route('/api/segment/from-coords', methods=['GET'])
def segment_from_coords_id():
    return get_segment_from_coords()

# --- Rutas de Test ---
@api_bp.route('/test/api/users/registered')
def test_registered_users():
    return get_registered_users()

@api_bp.route('/test/coordenadas')
def test_coordenadas():
    return _get_coordenadas()

@api_bp.route('/test/historico/<fecha>')
def test_get_historico(fecha):
    return _get_historico(fecha)

@api_bp.route('/test/historico/rango')
def test_get_historico_rango():
    return _get_historico_rango()

@api_bp.route('/test/historico/geocerca')
def test_get_historico_geocerca():
    return _get_historico_geocerca()

@api_bp.route('/test/osrm/route/<path:params>')
def test_osrm_proxy(params):
    return _osrm_proxy(params)

@api_bp.route('/test/api/devices/active')
def test_active_devices():
    return _get_active_devices()

@api_bp.route('/test/api/destination/send', methods=['POST'])
def test_send_destination():
    return _send_destination()

@api_bp.route('/test/database/destination/<user_id>')
def test_save_destinations(user_id):
    return get_user_destinations(user_id)

@api_bp.route('/test/api/location/<user_id>')
def test_get_user_location(user_id):
    return _get_user_location(user_id)

@api_bp.route('/test/api/congestion', methods=['GET'])
def test_congestion_consult():
    return get_congestion()

@api_bp.route('/test/api/empresas', methods=['GET'])
def test_get_empresas():
    return _get_empresas()

@api_bp.route('/test/api/rutas', methods=['GET'])
def test_get_rutas():
    return _get_rutas()

@api_bp.route('/test/api/rutas', methods=['POST'])
def test_create_ruta():
    return _create_ruta()

@api_bp.route('/test/api/rutas/<int:ruta_id>', methods=['PUT'])
def test_update_ruta_endpoint(ruta_id):
    return _update_ruta(ruta_id)

@api_bp.route('/test/api/rutas/<int:ruta_id>', methods=['DELETE'])
def test_delete_ruta_endpoint(ruta_id):
    return _delete_ruta(ruta_id)

@api_bp.route('/test/api/segment/from-coords', methods=['GET'])
def test_segment_from_coords_id():
    return get_segment_from_coords()

@app.route('/test/api/segment/<segment_id>')
def segment_details_test(segment_id):
    return get_segment_by_id(segment_id)



    
# --- Rutas de Utilidad ---
@api_bp.route('/version')
def version():
    return jsonify(get_git_info())

@api_bp.route('/health')
def health():
    db_status = 'unhealthy'
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        conn.close()
        db_status = 'healthy'
    except:
        pass
    
    osrm_status = 'healthy' if check_osrm_available() else 'unavailable'
    
    return jsonify({
        'status': 'healthy' if db_status == 'healthy' else 'degraded',
        'database': db_status,
        'osrm': osrm_status,
        'snap_to_roads': osrm_status == 'healthy',
        'name': current_app.config['NAME'],
        'mode': 'test' if current_app.config['IS_TEST_MODE'] else 'production',
        **get_git_info()
    })

def _get_coordenadas_all():
    """Retorna las últimas coordenadas de todos los usuarios activos (últimos 30 segundos)"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Configurar zona horaria
        cursor.execute("SET TIME ZONE 'America/Bogota'")
        
        # Obtener la última coordenada de cada usuario activo
        # Usa PostgreSQL syntax correctamente
        cursor.execute('''
            SELECT DISTINCT ON (user_id)
                id, lat, lon, timestamp, source, user_id
            FROM coordinates
            WHERE user_id IS NOT NULL
              AND TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS') 
                  >= NOW() - INTERVAL '30 seconds'
            ORDER BY user_id, TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS') DESC
        ''')

        rows = cursor.fetchall()
        conn.close()
        
        devices = []
        for row in rows:
            devices.append({
                'id': row[0],
                'lat': float(row[1]),
                'lon': float(row[2]),
                'timestamp': row[3],
                'source': row[4] or f'user_{row[5]}',
                'user_id': row[5],
                'device_id': f'user_{row[5]}'
            })
        
        log.info(f"📡 Coordenadas activas: {len(devices)} dispositivos")
        return jsonify(devices)
    except Exception as e:
        log.error(f"Error obteniendo coordenadas de todos los dispositivos: {e}")
        import traceback
        log.error(traceback.format_exc())
        return jsonify([]), 500

# --- Rutas de Producción ---
@api_bp.route('/coordenadas/all')
def coordenadas_all():
    return _get_coordenadas_all()

@api_bp.route('/api/users/register', methods=['POST'])
def register_user():
    return _register_user()

# --- Rutas de Test ---
@api_bp.route('/test/coordenadas/all')
def test_coordenadas_all():
    return _get_coordenadas_all()

@api_bp.route('/api/destination/complete', methods=['POST'])
def complete_destination():
    return _complete_destination()

# Test
@api_bp.route('/test/api/destination/complete', methods=['POST'])
def test_complete_destination():
    return _complete_destination()

@api_bp.route('/test/api/users/register', methods=['POST'])
def test_register_user():
    return _register_user()

@api_bp.route('/test/api/debug/usuarios', methods=['GET'])
def test_debug_usuarios():
    return _debug_usuarios()