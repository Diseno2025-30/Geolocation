from flask import Blueprint, request, jsonify, current_app
from firebase_admin import auth
from flask_jwt_extended import create_access_token
from app.database import create_user, get_user_by_firebase_uid
import logging
import requests 

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
            "password": password
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

@auth_bp.route('/auth/register/step1-firebase', methods=['POST'])
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
    nombre = data.get('nombre_completo')

    if not all([email, password, nombre]):
        return jsonify({"status": "error", "error": "Email, password y nombre_completo son requeridos"}), 400
    
    if len(password) < 6:
        return jsonify({"status": "error", "error": "La contraseña debe tener al menos 6 caracteres"}), 400

    try:
        logging.info(f"Paso 1: Creando usuario en Firebase para: {email}")
        firebase_user = auth.create_user(
            email=email,
            password=password,
            display_name=nombre
        )
        uid = firebase_user.uid
        logging.info(f"Usuario creado en Firebase con UID: {uid}")

        return jsonify(status="success", uid=uid, email=email, nombre_completo=nombre), 201

    except auth.EmailAlreadyExistsError:
        logging.warning(f"Intento de registro (Paso 1) fallido: Email ya existe {email}")
        return jsonify({"status": "error", "error": "El correo electrónico ya está registrado"}), 409
    
    except Exception as e:
        logging.exception(f"Error desconocido en /register/step1-firebase: {e}")
        return jsonify({"status": "error", "error": str(e)}), 500


@auth_bp.route('/auth/register/step2-database', methods=['POST'])
def register_step2_database():
    """
    Paso 2: Creación en Base de Datos Local.
    Recibe el UID de Firebase y el resto de datos.
    Guarda en la BD local.
    Devuelve el JWT final.
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
        user_id = create_user(uid, nombre, cedula, email, telefono, empresa)
        
        if user_id:
            logging.info(f"✓ Usuario registrado en BD local: {email}")
            access_token = create_access_token(identity=uid)
            return jsonify(status="success", token=access_token, user_id=user_id), 201
        else:
            logging.error(f"Error al guardar en BD local (UID: {uid}). Revirtiendo creación de Firebase.")
            auth.delete_user(uid)
            return jsonify({"status": "error", "error": "Error al guardar el usuario en la base de datos"}), 500

    except Exception as e:
        logging.exception(f"Error desconocido en /register/step2-database: {e}")
        if uid:
            try:
                auth.delete_user(uid)
                logging.info(f"Revertido usuario de Firebase {uid} debido a excepción en Paso 2.")
            except Exception as del_e:
                logging.error(f"Error al revertir usuario de Firebase {uid}: {del_e}")
        
        return jsonify({"status": "error", "error": str(e)}), 500


@auth_bp.route('/test/auth/firebase-login', methods=['POST'])
def test_firebase_login():
    return firebase_login()

@auth_bp.route('/test/auth/register/step1', methods=['POST'])
def test_register_step1():
    return register_step1_firebase()

@auth_bp.route('/test/auth/register/step2', methods=['POST'])
def test_register_step2():
    return register_step2_database()