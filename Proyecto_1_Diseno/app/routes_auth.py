from flask import Blueprint, request, jsonify, current_app
from firebase_admin import auth
from flask_jwt_extended import create_access_token
from app.database import create_user, get_user_by_firebase_uid
import logging
import requests # <-- Se agregó esta importación

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
        # 1. Obtener la API Key (debe estar en la config de Flask)
        # Se usa current_app, que ahora está importada
        api_key = current_app.config.get('FIREBASE_WEB_API_KEY')
        if not api_key:
            logging.error("FIREBASE_WEB_API_KEY no está configurada en la app.")
            return jsonify({"status": "error", "error": "Error de configuración del servidor"}), 500

        # 2. Construir la solicitud a la API REST de Identity Toolkit
        rest_api_url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={api_key}"
        
        payload = {
            "email": email,
            "password": password,
            "returnSecureToken": True  # Pedimos un token para confirmar
        }

        # 3. Autenticar contra la REST API de Firebase (usando requests)
        response = requests.post(rest_api_url, json=payload)
        response_data = response.json()

        if not response.ok:
            # Error de Firebase (ej. INVALID_PASSWORD, EMAIL_NOT_FOUND)
            error_message = response_data.get("error", {}).get("message", "Error desconocido")
            logging.warning(f"Intento de login fallido para {email}: {error_message}")
            return jsonify({"status": "error", "error": "Credenciales inválidas"}), 401

        # 4. Autenticación exitosa. Obtener el UID.
        uid = response_data.get('localId')
        
        # 5. Verificar que el usuario exista en nuestra BD local
        user = get_user_by_firebase_uid(uid)
        if not user:
            logging.warning(f"Login exitoso en Firebase pero usuario no existe en BD local: {uid} ({email})")
            return jsonify({"status": "error", "error": "Usuario no registrado en el sistema local"}), 404

        # 6. Crear el JWT personalizado (igual que en /register)
        access_token = create_access_token(identity=uid)
        
        # 7. Devolver el token en la respuesta JSON
        logging.info(f"Login exitoso para {email}, UID: {uid}")
        return jsonify(status="success", token=access_token)

    except requests.exceptions.RequestException as e:
        # Error si no se puede conectar a la API de Firebase
        logging.exception(f"Error de red en /firebase-login: {e}")
        return jsonify({"status": "error", "error": "Error de conexión con el servicio de autenticación"}), 503
    except Exception as e:
        logging.exception(f"Error inesperado en /firebase-login: {e}")  
        return jsonify({"status": "error", "error": str(e)}), 500

@auth_bp.route('/auth/register', methods=['POST'])
def register():
    """
    NUEVA LÓGICA:
    Recibe datos del formulario (incluyendo email y password).
    Crea el usuario en Firebase.
    Guarda los datos en la BD local.
    Devuelve un JWT para que la app inicie sesión.
    """
    data = request.get_json()
    
    # 1. Obtener todos los datos del formulario, incluyendo la contraseña
    email = data.get('email')
    password = data.get('password') # <-- El código antiguo no tenía esto
    nombre = data.get('nombre_completo')
    cedula = data.get('cedula')
    telefono = data.get('telefono')
    empresa = data.get('empresa')

    # Validar que los campos requeridos estén presentes
    # Esta validación ahora busca 'password', no 'token'
    if not all([email, password, nombre, cedula, empresa]):
        return jsonify({"status": "error", "error": "Faltan datos requeridos (email, password, nombre, cedula, empresa)"}), 400
    
    # Firebase exige contraseñas de 6+ caracteres
    if len(password) < 6:
        return jsonify({"status": "error", "error": "La contraseña debe tener al menos 6 caracteres"}), 400

    firebase_user = None
    try:
        # 2. Crear el usuario en Firebase (usando el SDK de Admin)
        logging.info(f"Creando usuario en Firebase para: {email}")
        firebase_user = auth.create_user(
            email=email,
            password=password,
            display_name=nombre
        )
        uid = firebase_user.uid
        logging.info(f"Usuario creado en Firebase con UID: {uid}")

        # 3. Crear el usuario en nuestra BD local
        user_id = create_user(uid, nombre, cedula, email, telefono, empresa)
        
        if user_id:
            logging.info(f"✓ Usuario registrado en BD local: {email}")
            # 4. Iniciar sesión y devolver token JWT
            access_token = create_access_token(identity=uid)
            return jsonify(status="success", token=access_token, user_id=user_id), 201
        else:
            # Error en la BD local. Revertir creación en Firebase.
            logging.error("Error al guardar en BD local. Revirtiendo creación de Firebase.")
            auth.delete_user(uid)
            return jsonify({"status": "error", "error": "Error al guardar el usuario en la base de datos"}), 500

    except auth.EmailAlreadyExistsError:
        logging.warning(f"Intento de registro fallido: Email ya existe {email}")
        return jsonify({"status": "error", "error": "El correo electrónico ya está registrado"}), 409
    
    except Exception as e:
        logging.exception(f"Error desconocido en /register: {e}")
        # Si el usuario de Firebase se creó pero algo más falló, intentar borrarlo.
        if firebase_user:
            try:
                auth.delete_user(firebase_user.uid)
                logging.info(f"Revertido usuario de Firebase {firebase_user.uid} debido a excepción.")
            except Exception as del_e:
                logging.error(f"Error al revertir usuario de Firebase {firebase_user.uid}: {del_e}")
        return jsonify({"status": "error", "error": str(e)}), 500


@auth_bp.route('/test/auth/firebase-login', methods=['POST'])
def test_firebase_login():
    return firebase_login()

@auth_bp.route('/test/auth/register', methods=['POST'])
def test_register():
    return register()