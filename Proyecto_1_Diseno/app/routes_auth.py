# app/routes_auth.py
from flask import Blueprint, request, jsonify
from firebase_admin import auth
from flask_jwt_extended import create_access_token
from app.database import create_user, get_user_by_firebase_uid

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/auth/firebase-login', methods=['POST'])
def firebase_login():
    """
    Recibe un Firebase ID Token de la app.
    Lo verifica.
    Crea un JWT personalizado y lo devuelve en el JSON.
    """
    token = request.json.get('token')
    if not token:
        return jsonify({"error": "No se proporcionó token"}), 400

    try:
        # 1. Verificar el token de Firebase
        decoded_token = auth.verify_id_token(token)
        uid = decoded_token['uid']
        
        # 2. Verificar que el usuario exista en nuestra BD local
        user = get_user_by_firebase_uid(uid)
        if not user:
            # Si el usuario existe en Firebase pero no en nuestra BD
            return jsonify({"error": "Usuario no registrado en el sistema local"}), 404

        # 3. Crear el JWT personalizado
        # El 'identity' será el firebase_uid.
        access_token = create_access_token(identity=uid)
        
        # 4. Devolver el token en la respuesta JSON
        return jsonify(status="success", token=access_token)

    except auth.InvalidIdTokenError:
        return jsonify({"error": "Token de Firebase inválido"}), 401
    except Exception as e:
        print(f"Error en /firebase-login: {e}")
        return jsonify({"error": str(e)}), 500

@auth_bp.route('/auth/register', methods=['POST'])
def register():
    """
    Recibe datos del usuario + un Firebase ID Token (creado en la app).
    Verifica el token, luego guarda los datos extra en la BD.
    Devuelve un JWT para iniciar sesión inmediatamente.
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
        return jsonify({"error": "Faltan datos requeridos"}), 400

    try:
        # 1. Verificar el token de Firebase para obtener el UID
        decoded_token = auth.verify_id_token(token)
        uid = decoded_token['uid']
        
        # Verificar que el email del token coincida
        if decoded_token.get('email') != email:
            return jsonify({"error": "El email no coincide con el token"}), 400
            
        # 2. Verificar si el usuario ya existe
        if get_user_by_firebase_uid(uid):
             return jsonify({"error": "El usuario (UID) ya está registrado"}), 409

        # 3. Crear el usuario en nuestra BD
        user_id = create_user(uid, nombre, cedula, email, telefono, empresa)
        
        if user_id:
            print(f"✓ Usuario registrado en BD: {email}")
            # Iniciar sesión y devolver token JWT inmediatamente
            access_token = create_access_token(identity=uid)
            return jsonify(status="success", token=access_token, user_id=user_id), 201
        else:
            return jsonify({"error": "Error al guardar el usuario en la base de datos"}), 500

    except auth.InvalidIdTokenError:
        return jsonify({"error": "Token de Firebase inválido"}), 401
    except Exception as e:
        print(f"Error en /register: {e}")
        return jsonify({"error": str(e)}), 500


@auth_bp.route('/test/auth/firebase-login', methods=['POST'])
def test_firebase_login():
    return firebase_login()

@auth_bp.route('/test/auth/register', methods=['POST'])
def test_register():
    return register()