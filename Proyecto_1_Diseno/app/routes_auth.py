from flask import Blueprint, request, jsonify, current_app
from firebase_admin import auth
from flask_jwt_extended import create_access_token, decode_token
from app.database import create_user, get_user_by_firebase_uid
import logging
import requests 
import psycopg2 # Importar para capturar errores específicos de la BD

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/auth/firebase-login', methods=['POST'])
def firebase_login():
    """
    Recibe email y password.
    Autentica contra la REST API de Firebase.
    Si es exitoso, verifica el usuario en la BD local.
    Devuelve un JWT local.
    """
    data = request.json
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({"status": "error", "error": "Email y password son requeridos"}), 400

    try:
        api_key = current_app.config.get('FIREBASE_WEB_API_KEY')
        if not api_key:
            logging.error("FIREBASE_WEB_API_KEY no está configurada en la app.")
            return jsonify({"status": "error", "error": "Error de configuración del servidor"}), 500

        rest_api_url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={api_key}"
        
        payload = {
            "email": email,
            "password": password,
            "returnSecureToken": True # Buena práctica
        }

        response = requests.post(rest_api_url, json=payload)
        response_data = response.json()

        if not response.ok:
            error_message = response_data.get("error", {}).get("message", "Error desconocido")
            logging.warning(f"Intento de login fallido para {email}: {error_message}")
            return jsonify({"status": "error", "error": "Credenciales inválidas"}), 401

        uid = response_data.get('localId')
        
        user = get_user_by_firebase_uid(uid)
        if not user:
            logging.warning(f"Login exitoso en Firebase pero usuario no existe en BD local: {uid} ({email})")
            return jsonify({"status": "error", "error": "Usuario no registrado en el sistema local"}), 404

        access_token = create_access_token(identity=uid)
        
        logging.info(f"Login exitoso para {email}, UID: {uid}")
        return jsonify(status="success", token=access_token)

    except requests.exceptions.RequestException as e:
        logging.exception(f"Error de red en /firebase-login: {e}")
        return jsonify({"status": "error", "error": "Error de conexión con el servicio de autenticación"}), 503
    except Exception as e:
        logging.exception(f"Error inesperado en /firebase-login: {e}")  
        return jsonify({"status": "error", "error": str(e)}), 500

@auth_bp.route('/auth/register/step1', methods=['POST'])
def register_step1_firebase():
    """
    Paso 1: Creación en Firebase.
    Recibe email, password y nombre_completo.
    Crea el usuario en Firebase Authentication.
    Devuelve el UID.
    """
    data = request.get_json()
    
    email = data.get('email')
    password = data.get('password')

    if not all([email, password]):
        return jsonify({"status": "error", "error": "Email y password son requeridos"}), 400

    if len(password) < 6:
        return jsonify({"status": "error", "error": "La contraseña debe tener al menos 6 caracteres"}), 400

    try:
        logging.info(f"Paso 1: Creando usuario en Firebase para: {email}")
        firebase_user = auth.create_user(
            email=email,
            password=password,
        )
        uid = firebase_user.uid
        logging.info(f"Usuario creado en Firebase con UID: {uid}")

        return jsonify(status="success", uid=uid), 201

    except auth.EmailAlreadyExistsError:
        logging.warning(f"Intento de registro (Paso 1) fallido: Email ya existe {email}")
        return jsonify({"status": "error", "error": "El correo electrónico ya está registrado"}), 409
    
    except Exception as e:
        logging.exception(f"Error desconocido en /register/step1-firebase: {e}")
        return jsonify({"status": "error", "error": str(e)}), 500


@auth_bp.route('/auth/register/step2', methods=['POST'])
def register_step2_database():
    """
    Paso 2: Creación en Base de Datos Local.
    Recibe el UID de Firebase y el resto de datos.
    Guarda en la BD local.
    Devuelve el JWT final.
    Maneja el rollback de Firebase si la BD local falla.
    """
    data = request.get_json()

    uid = data.get('uid')
    nombre = data.get('nombre_completo')
    cedula = data.get('cedula')
    email = data.get('email')
    telefono = data.get('telefono')
    empresa = data.get('empresa')

    if not all([uid, nombre, cedula, email, empresa]):
        return jsonify({"status": "error", "error": "Faltan datos requeridos (uid, nombre_completo, cedula, email, empresa)"}), 400
    
    try:
        logging.info(f"Paso 2: Registrando en BD local para UID: {uid}")
        
        # create_user ahora relanzará una excepción si falla
        user_id = create_user(uid, nombre, cedula, email, telefono, empresa)

        # Si user_id existe (éxito), creamos el token
        logging.info(f"✓ Usuario registrado en BD local: {email}")
        access_token = create_access_token(identity=uid)
        return jsonify(status="success", token=access_token, user_id=user_id), 201

    except (psycopg2.errors.UniqueViolation, psycopg2.errors.DuplicateDatabase) as e:
        # Esto ocurre si el email, cédula o uid YA existen en tu BD local
        logging.warning(f"Error de duplicado en BD local (UID: {uid}): {e}")
        
        # --- Lógica de Rollback ---
        _rollback_firebase_user(uid)
        
        error_message = "Error de registro: El email o la cédula ya existen en el sistema."
        if 'users_firebase_uid_key' in str(e):
            error_message = "Error interno: El UID de Firebase ya estaba registrado."
        
        return jsonify({"status": "error", "error": error_message}), 409

    except Exception as e:
        # Captura cualquier otra excepción de create_user (como el NameError)
        logging.exception(f"Error desconocido en /register/step2-database (UID: {uid}): {e}")
        
        # --- Lógica de Rollback ---
        _rollback_firebase_user(uid)
        
        return jsonify({"status": "error", "error": f"Error inesperado al guardar en BD: {e}"}), 500


def _rollback_firebase_user(uid):
    """Función helper para borrar el usuario de Firebase si el Paso 2 falla."""
    if not uid:
        return
    try:
        logging.warning(f"ROLLBACK: Intentando borrar usuario de Firebase {uid} debido a fallo en Paso 2.")
        auth.delete_user(uid)
        logging.info(f"ROLLBACK: ✓ Usuario {uid} borrado de Firebase.")
    except Exception as del_e:
        logging.error(f"ROLLBACK: ¡FALLO CRÍTICO! No se pudo borrar el usuario {uid} de Firebase: {del_e}")


@auth_bp.route('/test/auth/firebase-login', methods=['POST'])
def test_firebase_login():
    return firebase_login()

@auth_bp.route('/test/auth/register/step1', methods=['POST'])
def test_register_step1():
    return register_step1_firebase()

@auth_bp.route('/test/auth/register/step2', methods=['POST'])
def test_register_step2():
    return register_step2_database()

@auth_bp.route('/verify-token', methods=['POST'])
def verify_token_debug():
    data = request.get_json()
    
    if not data or 'token' not in data:
        return jsonify({"error": "Falta el campo 'token' en el body del JSON"}), 400
    
    token_string = data['token']
    
    try:
        # 1. Decodificar el token
        decoded_token = decode_token(token_string)
        
        # 2. Obtener el UID (identity 'sub')
        if 'sub' not in decoded_token:
            return jsonify({"error": "Token válido, pero falta el claim 'sub' (uid)"}), 400
            
        uid = decoded_token['sub'] # 'sub' es la 'identity'

        user = get_user_by_firebase_uid(uid) 
        
        local_user_id = None
        message = "Token decodificado correctamente."
        
        # 4. Obtener el ID local (exactamente tu lógica)
        if user:
            local_user_id = user['id']
        else:
            message = f"Warning: Token válido, pero no se encontró usuario en BD local para el uid {uid}."

        # Devolver la información
        return jsonify({
            "status": "success",
            "message": message,
            "uid_firebase": uid,
            "local_user_id": local_user_id,
            "full_decoded_token": decoded_token # Incluimos todo el token por si necesitas ver más claims
        }), 200

    except PyJWTError as e:
        # El token es inválido (expirado, firma incorrecta, etc.)
        return jsonify({
            "status": "error",
            "error": "Token JWT inválido",
            "details": str(e)
        }), 401
    except Exception as e:
        # Cualquier otro error
        return jsonify({
            "status": "error",
            "error": "Error inesperado",
            "details": str(e)
        }), 500