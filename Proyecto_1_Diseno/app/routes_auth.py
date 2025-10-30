# app/routes_auth.py
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
    Recibe datos del usuario + un Firebase ID Token (creado en la app).
    """
    data = request.get_json()
    token = data.get('token')
    
    # Datos del formulario
    nombre = data.get('nombre_completo')
    cedula = data.get('cedula')
    email = data.get('email') # El email de Firebase
    telefono = data.get('telefono')
    empresa = data.get('empresa')

    if not all([token, nombre, cedula, email, empresa]):
        return jsonify({"status": "error", "error": "Faltan datos requeridos"}), 400

    try:
        # 1. Verificar el token de Firebase para obtener el UID
        decoded_token = auth.verify_id_token(token)
        uid = decoded_token['uid']
        
        # Verificar que el email del token coincida
        if decoded_token.get('email') != email:
            return jsonify({"status": "error", "error": "El email no coincide con el token"}), 400
            
        # 2. Verificar si el usuario ya existe
        if get_user_by_firebase_uid(uid):
             return jsonify({"status": "error", "error": "El usuario (UID) ya está registrado"}), 409

        # 3. Crear el usuario en nuestra BD
        user_id = create_user(uid, nombre, cedula, email, telefono, empresa)
        
        if user_id:
            logging.info(f"✓ Usuario registrado en BD: {email}")
            print(f"✓ Usuario registrado en BD: {email}", flush=True)
            access_token = create_access_token(identity=uid)
            return jsonify(status="success", token=access_token, user_id=user_id), 201
        else:
            return jsonify({"status": "error", "error": "Error al guardar el usuario en la base de datos"}), 500

    except auth.InvalidIdTokenError:
        return jsonify({"status": "error", "error": "Token de Firebase inválido"}), 401
    except Exception as e:
        logging.exception(f"Error en /register: {e}")
        print(f"Error en /register: {e}", flush=True)
        return jsonify({"status": "error", "error": str(e)}), 500


@auth_bp.route('/test/auth/firebase-login', methods=['POST'])
def test_firebase_login():
    return firebase_login()

@auth_bp.route('/test/auth/register', methods=['POST'])
def test_register():
    return register()