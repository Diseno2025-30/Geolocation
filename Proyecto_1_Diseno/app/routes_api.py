# app/routes_api.py
from flask import Blueprint, jsonify, request, current_app
from app.database import (
    get_last_coordinate, get_historical_by_date, 
    get_historical_by_range, get_historical_by_geofence, 
    get_db, get_active_devices, get_last_coordinate_by_user, get_congestion_segments
)
from app.utils import get_git_info
from app.services_osrm import check_osrm_available
from datetime import datetime
import requests

api_bp = Blueprint('api', __name__)

# ===== ALMACENAMIENTO EN MEMORIA PARA DESTINOS =====
# Diccionario para almacenar destinos pendientes por user_id
pending_destinations = {}

# ===== ENDPOINTS DE API (Producción y Test) =====

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
        
        user_id = request.args.get('user_id')  # Ya es string

        if not fecha_inicio_str or not fecha_fin_str:
            return jsonify({'error': 'Se requieren los parámetros inicio y fin'}), 400

        start_datetime = datetime.strptime(f"{fecha_inicio_str} {hora_inicio_str}", '%Y-%m-%d %H:%M')
        end_datetime = datetime.strptime(f"{fecha_fin_str} {hora_fin_str}", '%Y-%m-%d %H:%M').replace(second=59) 

        if start_datetime > end_datetime:
            return jsonify({'error': 'La fecha/hora de inicio debe ser anterior a la fecha/hora de fin'}), 400

        coordenadas = get_historical_by_range(start_datetime, end_datetime, user_id=user_id)
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
        
        user_id = request.args.get('user_id')  # Ya es string
        
        coordenadas = get_historical_by_geofence(min_lat, max_lat, min_lon, max_lon, user_id=user_id)
        return jsonify(coordenadas)
    except Exception as e:
        print(f"Error en consulta por geocerca: {e}")
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

def _get_user_location(user_id):
    """Obtiene la última ubicación de un usuario específico."""
    return jsonify(get_last_coordinate_by_user(user_id))

def get_congestion():
    """Obtiene segmentos con congestión (2+ vehículos)."""
    try:
        time_window = int(request.args.get('time_window', 5))
        congestion_data = get_congestion_segments(time_window)
        
        return jsonify({
            'success': True,
            'congestion': congestion_data,
            'total': len(congestion_data)
        })
    except Exception as e:
        log.error(f"Error en endpoint de congestión: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# --- Rutas de Producción ---
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

# --- Rutas de Test ---
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