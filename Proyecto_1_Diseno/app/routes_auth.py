from flask import Blueprint, request, jsonify
from firebase_admin import auth
from flask_jwt_extended import create_access_token
from app.database import create_user, get_user_by_firebase_uid
import logging

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/auth/firebase-login', methods=['POST'])
def firebase_login():
    """
    Recibe un Firebase ID Token de la app.
    ...
    """
    token = request.json.get('token')
    if not token:
        return jsonify({"status": "error", "error": "No se proporcionó token"}), 400

    try:
        # 1. Verificar el token de Firebase
        decoded_token = auth.verify_id_token(token)
        uid = decoded_token['uid']
        
        # 2. Verificar que el usuario exista en nuestra BD local
        user = get_user_by_firebase_uid(uid)
        if not user:
            return jsonify({"status": "error", "error": "Usuario no registrado en el sistema local"}), 404

        # 3. Crear el JWT personalizado
        access_token = create_access_token(identity=uid)
        
        # 4. Devolver el token en la respuesta JSON
        return jsonify(status="success", token=access_token)

    except auth.InvalidIdTokenError:
        return jsonify({"status": "error", "error": "Token de Firebase inválido"}), 401
    except Exception as e:
        logging.exception(f"Error en /firebase-login: {e}") 
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