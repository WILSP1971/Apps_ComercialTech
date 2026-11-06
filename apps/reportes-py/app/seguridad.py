# app/seguridad.py
import os
import jwt
from jwt import PyJWKClient
from fastapi import Header, HTTPException

_jwks = PyJWKClient(os.environ["SUPABASE_JWKS_URL"])

def usuario_actual(authorization: str = Header(...)) -> str:
    """Valida el JWT (OAuth 2.0) emitido por Supabase Auth y devuelve el id del usuario."""
    token = authorization.removeprefix("Bearer ").strip()
    try:
        clave = _jwks.get_signing_key_from_jwt(token).key
        datos = jwt.decode(
            token, clave, algorithms=["ES256", "RS256"],
            audience=os.environ["JWT_AUDIENCE"], issuer=os.environ["JWT_ISSUER"],
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido")
    return datos["sub"]
