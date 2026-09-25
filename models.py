from pydantic import BaseModel, Field, field_validator
from typing import Optional
import re

EMAIL_REGEX = r"^[\w\.-]+@[\w\.-]+\.\w+$"

class UserLogin(BaseModel):
    email: str = Field(..., min_length=3)
    password: str = Field(..., min_length=3)

    @field_validator("email")
    @classmethod
    def clean_email(cls, v: str) -> str:
        clean = v.strip().lower()
        if not re.match(EMAIL_REGEX, clean):
            raise ValueError("Formato de correo electrónico inválido")
        return clean

class UserCreate(BaseModel):
    nombre: str = Field(..., min_length=2)
    email: str = Field(..., min_length=3)
    password: str = Field(..., min_length=4)
    rol: str = Field(..., description="admin, validador, comercial")

    @field_validator("email")
    @classmethod
    def clean_email(cls, v: str) -> str:
        clean = v.strip().lower()
        if not re.match(EMAIL_REGEX, clean):
            raise ValueError("Formato de correo electrónico inválido")
        return clean

    @field_validator("rol")
    @classmethod
    def clean_rol(cls, v: str) -> str:
        clean = v.strip().lower()
        if clean not in ["admin", "validador", "comercial", "redigitador"]:
            raise ValueError("El rol debe ser 'admin', 'validador', 'comercial' o 'redigitador'")
        return clean

class UserUpdate(BaseModel):
    nombre: str = Field(..., min_length=2)
    email: str = Field(..., min_length=3)
    rol: str = Field(..., description="admin, validador, comercial, redigitador")
    activo: int = Field(1, description="1 activo, 0 inactivo")
    password: Optional[str] = None

    @field_validator("email")
    @classmethod
    def clean_email(cls, v: str) -> str:
        clean = v.strip().lower()
        if not re.match(EMAIL_REGEX, clean):
            raise ValueError("Formato de correo electrónico inválido")
        return clean

    @field_validator("rol")
    @classmethod
    def clean_rol(cls, v: str) -> str:
        clean = v.strip().lower()
        if clean not in ["admin", "validador", "comercial", "redigitador"]:
            raise ValueError("El rol debe ser 'admin', 'validador', 'comercial' o 'redigitador'")
        return clean

class PQRResolve(BaseModel):
    estado: str = Field(..., description="Resuelto, En Revisión, Rechazado")
    aplica: str = Field(..., description="Aplica, No Aplica, Aplica Parcialmente")
    tipologia: str
    adjudicable: Optional[str] = Field(None, description="IT, Comercial, Campo, Validación")
    respuesta: str = Field(..., min_length=3)
    requiere_redigitacion: Optional[bool] = False

class PQRRedigitar(BaseModel):
    nuevo_numero_auditoria: str = Field(..., min_length=2)
    notas: Optional[str] = None

    @field_validator("nuevo_numero_auditoria")
    @classmethod
    def clean_audit_number(cls, v: str) -> str:
        clean = v.strip().upper()
        if not re.match(r"^[A-Z0-9][A-Z0-9._/-]{1,49}$", clean):
            raise ValueError("El número de auditoría solo puede usar letras, números, punto, guion, guion bajo o barra")
        return clean

class PQRAssignment(BaseModel):
    assignee_email: str = Field(..., min_length=3)

    @field_validator("assignee_email")
    @classmethod
    def clean_email(cls, v: str) -> str:
        clean = v.strip().lower()
        if not re.match(EMAIL_REGEX, clean):
            raise ValueError("Formato de correo electrónico inválido")
        return clean

class PQRVerification(BaseModel):
    aprobado: bool
    comentario: str = Field(..., min_length=3, max_length=2000)

class PQRReopen(BaseModel):
    motivo: str = Field(..., min_length=3, max_length=2000)

class PQRFeedback(BaseModel):
    satisfactorio: bool
    comentario: Optional[str] = Field(None, max_length=2000)

class TipologiaCreate(BaseModel):
    nombre: str = Field(..., min_length=3)
