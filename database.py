import sqlite3
import os
import hashlib
import secrets
from datetime import datetime, time, timedelta
from typing import List, Dict, Any, Optional, Tuple

DB_PATH = os.path.join(os.path.dirname(__file__), "pqr.db")

SLA_TARGET_HOURS = 48.0

DEFAULT_TIPOLOGIAS = [
    "Facturación y Cartera (Cobro errado, nota crédito, valor incorrecto)",
    "Logística y Despacho (Demora en entrega, producto averiado, faltante)",
    "Calidad de Producto / Servicio (Falla técnica, garantía)",
    "Condiciones Comerciales (Descuento no aplicado, acuerdo de precios)",
    "Atención y Servicio al Cliente",
    "Garantías y Devoluciones",
    "Incumplimiento de Tiempos Acordados",
    "Error en Sistema / PDV",
    "Otra"
]

ADJUDICABLE_AREAS = [
    "IT",
    "Comercial",
    "Campo",
    "Validación"
]

def calculate_sla_business_hours(fecha_creacion_str: str, fecha_resolucion_str: str) -> float:
    """
    Calcula las horas transcurridas para el SLA de 48h:
    - Excluye fines de semana (Sábados y Domingos completos).
    - Si la solicitud llega un viernes después de las 5:00 PM (17:00),
      o en fin de semana, empieza a contar el siguiente día hábil (Lunes a las 08:00 AM).
    - Descuenta la ventana no hábil de fin de semana (Viernes 17:00 a Lunes 08:00).
    """
    try:
        t1 = datetime.strptime(fecha_creacion_str, "%Y-%m-%d %H:%M:%S")
        t2 = datetime.strptime(fecha_resolucion_str, "%Y-%m-%d %H:%M:%S")
    except Exception:
        return 0.1

    if t2 <= t1:
        return 0.1

    # Regla: Si llega un viernes después de las 5pm o fin de semana, el conteo inicia el siguiente día hábil
    if t1.weekday() == 4 and t1.time() >= time(17, 0): # Viernes >= 17:00
        days_to_monday = 3
        t1 = datetime.combine(t1.date() + timedelta(days=days_to_monday), time(8, 0))
    elif t1.weekday() == 5: # Sábado
        days_to_monday = 2
        t1 = datetime.combine(t1.date() + timedelta(days=days_to_monday), time(8, 0))
    elif t1.weekday() == 6: # Domingo
        days_to_monday = 1
        t1 = datetime.combine(t1.date() + timedelta(days=days_to_monday), time(8, 0))

    if t2 <= t1:
        return 0.1

    # Iterar por pasos para descontar ventanas de fin de semana (Viernes 17:00 a Lunes 08:00)
    current = t1
    total_seconds = 0.0
    step = timedelta(minutes=15)
    
    while current < t2:
        next_step = min(current + step, t2)
        secs = (next_step - current).total_seconds()
        
        w = current.weekday()
        hr = current.time()
        
        is_weekend = False
        if w == 4 and hr >= time(17, 0):
            is_weekend = True
        elif w in (5, 6): # Sábado y Domingo
            is_weekend = True
        elif w == 0 and hr < time(8, 0): # Lunes antes de las 8am
            is_weekend = True
            
        if not is_weekend:
            total_seconds += secs
            
        current = next_step

    hours = total_seconds / 3600.0
    return max(round(hours, 1), 0.1)

def hash_password(password: str, salt: Optional[str] = None) -> Tuple[str, str]:
    if not salt:
        salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000)
    return hashed.hex(), salt

def verify_password(password: str, salt: str, expected_hash: str) -> bool:
    hashed, _ = hash_password(password, salt)
    return secrets.compare_digest(hashed, expected_hash)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Tabla de usuarios
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                rol TEXT NOT NULL,
                activo INTEGER NOT NULL DEFAULT 1,
                fecha_creacion TEXT NOT NULL
            )
        """)
        
        # Tabla de solicitudes PQR
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS pqr_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                consecutivo TEXT UNIQUE NOT NULL,
                comercial_email TEXT NOT NULL,
                id_pdv TEXT NOT NULL,
                cliente TEXT NOT NULL,
                pais TEXT NOT NULL,
                error TEXT NOT NULL,
                adjunto_nombre TEXT DEFAULT NULL,
                adjunto_ruta TEXT DEFAULT NULL,
                estado TEXT NOT NULL DEFAULT 'Pendiente',
                aplica TEXT DEFAULT NULL,
                tipologia TEXT DEFAULT NULL,
                adjudicable TEXT DEFAULT NULL,
                respuesta_validador TEXT DEFAULT NULL,
                validador_email TEXT DEFAULT NULL,
                fecha_creacion TEXT NOT NULL,
                fecha_resolucion TEXT DEFAULT NULL,
                requiere_redigitacion INTEGER DEFAULT 0,
                estado_redigitacion TEXT DEFAULT 'No Aplica',
                nuevo_numero_auditoria TEXT DEFAULT NULL,
                fecha_redigitacion TEXT DEFAULT NULL,
                redigitador_email TEXT DEFAULT NULL,
                notas_redigitacion TEXT DEFAULT NULL
            )
        """)

        # Registro inmutable de cada transición y bandeja de alertas internas.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS pqr_timeline (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pqr_id INTEGER NOT NULL,
                actor_email TEXT,
                accion TEXT NOT NULL,
                detalle TEXT,
                fecha TEXT NOT NULL,
                FOREIGN KEY (pqr_id) REFERENCES pqr_requests(id)
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_email TEXT NOT NULL,
                titulo TEXT NOT NULL,
                mensaje TEXT NOT NULL,
                pqr_id INTEGER,
                leida INTEGER NOT NULL DEFAULT 0,
                fecha TEXT NOT NULL,
                FOREIGN KEY (pqr_id) REFERENCES pqr_requests(id)
            )
        """)

        # Migración defensiva si la tabla ya existía
        new_cols = [
            ("requiere_redigitacion", "INTEGER DEFAULT 0"),
            ("estado_redigitacion", "TEXT DEFAULT 'No Aplica'"),
            ("nuevo_numero_auditoria", "TEXT DEFAULT NULL"),
            ("fecha_redigitacion", "TEXT DEFAULT NULL"),
            ("redigitador_email", "TEXT DEFAULT NULL"),
            ("notas_redigitacion", "TEXT DEFAULT NULL"),
            ("adjudicable", "TEXT DEFAULT NULL"),
            ("asignado_validador_email", "TEXT DEFAULT NULL"),
            ("asignado_redigitador_email", "TEXT DEFAULT NULL"),
            ("fecha_asignacion_validador", "TEXT DEFAULT NULL"),
            ("fecha_asignacion_redigitador", "TEXT DEFAULT NULL"),
            ("fecha_verificacion", "TEXT DEFAULT NULL"),
            ("verificado_por_email", "TEXT DEFAULT NULL"),
            ("comentario_verificacion", "TEXT DEFAULT NULL"),
            ("fecha_cierre", "TEXT DEFAULT NULL"),
            ("satisfactorio", "INTEGER DEFAULT NULL"),
            ("comentario_satisfaccion", "TEXT DEFAULT NULL")
        ]
        for col_name, col_type in new_cols:
            try:
                cursor.execute(f"ALTER TABLE pqr_requests ADD COLUMN {col_name} {col_type}")
            except Exception:
                pass
        try:
            cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_pqr_auditoria_unique ON pqr_requests(nuevo_numero_auditoria) WHERE nuevo_numero_auditoria IS NOT NULL")
        except sqlite3.IntegrityError:
            # No interrumpe una base histórica que ya tenga duplicados; la API los validará al crear nuevos registros.
            pass
        
        # Tabla de catálogo de tipologías
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tipologias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT UNIQUE NOT NULL
            )
        """)
        
        # Tipologías por defecto
        cursor.execute("SELECT COUNT(*) FROM tipologias")
        if cursor.fetchone()[0] == 0:
            for t in DEFAULT_TIPOLOGIAS:
                cursor.execute("INSERT OR IGNORE INTO tipologias (nombre) VALUES (?)", (t,))
                
        # Usuarios iniciales por defecto si no existen
        cursor.execute("SELECT COUNT(*) FROM users")
        if cursor.fetchone()[0] == 0:
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            default_users = [
                ("Administrador General", "admin@empresa.com", "Admin123*", "admin"),
                ("Validador Principal", "validador@empresa.com", "Validador123*", "validador"),
                ("María López Validadora", "maria.validadora@empresa.com", "Maria123*", "validador"),
                ("Equipo de Redigitación", "redigitador@empresa.com", "Redigitador123*", "redigitador"),
                ("Carlos Mendoza", "carlos.mendoza@empresa.com", "Carlos123*", "comercial"),
                ("Laura Gómez", "laura.gomez@empresa.com", "Laura123*", "comercial")
            ]
            for nombre, email, password, rol in default_users:
                pwd_hash, salt = hash_password(password)
                cursor.execute("""
                    INSERT INTO users (nombre, email, password_hash, salt, rol, activo, fecha_creacion)
                    VALUES (?, ?, ?, ?, ?, 1, ?)
                """, (nombre, email.lower().strip(), pwd_hash, salt, rol, now_str))
        else:
            # Asegurar usuario redigitador si la tabla de usuarios ya existía
            cursor.execute("SELECT id FROM users WHERE LOWER(email) = 'redigitador@empresa.com'")
            if not cursor.fetchone():
                pwd_hash, salt = hash_password("Redigitador123*")
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cursor.execute("""
                    INSERT INTO users (nombre, email, password_hash, salt, rol, activo, fecha_creacion)
                    VALUES (?, ?, ?, ?, 'redigitador', 1, ?)
                """, ("Equipo de Redigitación", "redigitador@empresa.com", pwd_hash, salt, now_str))
                
        conn.commit()

# --- Funciones de Usuarios ---

def authenticate_user(email: str, password: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE LOWER(email) = ? AND activo = 1", (email.lower().strip(),))
        row = cursor.fetchone()
        if not row:
            return None
        user = dict(row)
        if verify_password(password, user["salt"], user["password_hash"]):
            del user["password_hash"]
            del user["salt"]
            return user
        return None

def create_user(nombre: str, email: str, password: str, rol: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        pwd_hash, salt = hash_password(password)
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        try:
            cursor.execute("""
                INSERT INTO users (nombre, email, password_hash, salt, rol, activo, fecha_creacion)
                VALUES (?, ?, ?, ?, ?, 1, ?)
            """, (nombre.strip(), email.lower().strip(), pwd_hash, salt, rol.lower().strip(), now_str))
            conn.commit()
            return get_user_by_id(cursor.lastrowid)
        except sqlite3.IntegrityError:
            return None

def get_all_users() -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, nombre, email, rol, activo, fecha_creacion FROM users ORDER BY id ASC")
        return [dict(row) for row in cursor.fetchall()]

def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, nombre, email, rol, activo, fecha_creacion FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, nombre, email, rol, activo, fecha_creacion FROM users WHERE LOWER(email) = LOWER(?)", (email.strip(),))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_active_users_by_role(rol: str) -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, nombre, email, rol FROM users WHERE rol = ? AND activo = 1 ORDER BY nombre", (rol,))
        return [dict(row) for row in cursor.fetchall()]

def _add_timeline(cursor, pqr_id: int, actor_email: Optional[str], accion: str, detalle: Optional[str] = None):
    cursor.execute(
        "INSERT INTO pqr_timeline (pqr_id, actor_email, accion, detalle, fecha) VALUES (?, ?, ?, ?, ?)",
        (pqr_id, actor_email, accion, detalle, datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    )

def _notify(cursor, user_email: Optional[str], titulo: str, mensaje: str, pqr_id: int):
    if not user_email:
        return
    cursor.execute(
        "INSERT INTO notifications (user_email, titulo, mensaje, pqr_id, fecha) VALUES (?, ?, ?, ?, ?)",
        (user_email.lower().strip(), titulo, mensaje, pqr_id, datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    )

def update_user(user_id: int, nombre: str, email: str, rol: str, activo: int, password: Optional[str] = None) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        if password and password.strip():
            pwd_hash, salt = hash_password(password)
            cursor.execute("""
                UPDATE users
                SET nombre = ?, email = ?, rol = ?, activo = ?, password_hash = ?, salt = ?
                WHERE id = ?
            """, (nombre.strip(), email.lower().strip(), rol.lower().strip(), activo, pwd_hash, salt, user_id))
        else:
            cursor.execute("""
                UPDATE users
                SET nombre = ?, email = ?, rol = ?, activo = ?
                WHERE id = ?
            """, (nombre.strip(), email.lower().strip(), rol.lower().strip(), activo, user_id))
        conn.commit()
        return get_user_by_id(user_id)

def delete_user(user_id: int) -> bool:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        return cursor.rowcount > 0

# --- Funciones de Tipologías ---

def get_tipologias() -> List[str]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT nombre FROM tipologias ORDER BY nombre ASC")
        return [row[0] for row in cursor.fetchall()]

def get_tipologias_detail() -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, nombre FROM tipologias ORDER BY nombre ASC")
        return [dict(row) for row in cursor.fetchall()]

def add_tipologia(nombre: str) -> bool:
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT OR IGNORE INTO tipologias (nombre) VALUES (?)", (nombre.strip(),))
            conn.commit()
            return cursor.rowcount > 0
    except Exception:
        return False

def delete_tipologia(tipologia_id: int) -> bool:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM tipologias WHERE id = ?", (tipologia_id,))
        conn.commit()
        return cursor.rowcount > 0

# --- Funciones de PQRs ---

def generate_consecutivo(cursor) -> str:
    year = datetime.now().year
    cursor.execute("SELECT COUNT(*) FROM pqr_requests")
    count = cursor.fetchone()[0] + 1
    return f"PQR-{year}-{count:04d}"

def create_pqr(data: Dict[str, Any]) -> Dict[str, Any]:
    with get_db() as conn:
        cursor = conn.cursor()
        consecutivo = generate_consecutivo(cursor)
        now_str = data.get("fecha_creacion") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        cursor.execute("""
            INSERT INTO pqr_requests (
                consecutivo, comercial_email, id_pdv, cliente, pais, error,
                adjunto_nombre, adjunto_ruta, estado, fecha_creacion
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Radicado', ?)
        """, (
            consecutivo,
            data['comercial_email'].strip().lower(),
            data['id_pdv'].strip(),
            data['cliente'].strip(),
            data['pais'].strip(),
            data['error'].strip(),
            data.get('adjunto_nombre'),
            data.get('adjunto_ruta'),
            now_str
        ))
        inserted_id = cursor.lastrowid
        _add_timeline(cursor, inserted_id, data['comercial_email'], "PQR radicado", "Solicitud creada por el equipo comercial")
        _notify(cursor, data['comercial_email'], "PQR radicado", f"El caso {consecutivo} quedó radicado y será asignado para validación.", inserted_id)
        conn.commit()
        return get_pqr_by_id(inserted_id)

def find_possible_duplicate(comercial_email: str, id_pdv: str, error: str) -> Optional[Dict[str, Any]]:
    """Busca una radicación abierta con el mismo PDV y descripción durante los últimos 30 días."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM pqr_requests
            WHERE LOWER(comercial_email) = LOWER(?) AND LOWER(id_pdv) = LOWER(?) AND LOWER(error) = LOWER(?)
              AND fecha_creacion >= datetime('now', '-30 days')
              AND estado NOT IN ('Cerrado', 'No Aplica')
            ORDER BY id DESC LIMIT 1
        """, (comercial_email.strip(), id_pdv.strip(), error.strip()))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_pqr_by_id(pqr_id: int) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pqr_requests WHERE id = ?", (pqr_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_pqrs(comercial_email: Optional[str] = None, estado: Optional[str] = None, aplica: Optional[str] = None, search: Optional[str] = None) -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        query = "SELECT * FROM pqr_requests WHERE 1=1"
        params = []
        
        if comercial_email:
            query += " AND LOWER(comercial_email) = LOWER(?)"
            params.append(comercial_email.strip())
            
        if estado and estado != "Todos":
            query += " AND estado = ?"
            params.append(estado)
            
        if aplica and aplica != "Todos":
            query += " AND aplica = ?"
            params.append(aplica)
            
        if search:
            query += " AND (consecutivo LIKE ? OR id_pdv LIKE ? OR cliente LIKE ? OR error LIKE ? OR pais LIKE ?)"
            term = f"%{search.strip()}%"
            params.extend([term, term, term, term, term])
            
        query += " ORDER BY id DESC"
        cursor.execute(query, params)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

def resolve_pqr(pqr_id: int, estado: str, aplica: str, tipologia: str, respuesta: str, 
                validador_email: Optional[str] = None, fecha_resolucion: Optional[str] = None,
                requiere_redigitacion: bool = False, adjudicable: Optional[str] = None) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        now_str = fecha_resolucion or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        req_redig_int = 1 if (requiere_redigitacion and aplica == "Aplica") else 0
        estado_redig = "Pendiente" if req_redig_int == 1 else "No Aplica"
        workflow_status = "Pendiente de Redigitación" if req_redig_int else ("No Aplica" if aplica == "No Aplica" else "Cerrado")
        
        cursor.execute("""
            UPDATE pqr_requests
            SET estado = ?,
                aplica = ?,
                tipologia = ?,
                adjudicable = ?,
                respuesta_validador = ?,
                validador_email = ?,
                fecha_resolucion = ?,
                requiere_redigitacion = ?,
                estado_redigitacion = CASE 
                    WHEN estado_redigitacion = 'Redigitado' THEN 'Redigitado'
                    ELSE ?
                END
            WHERE id = ?
        """, (
            workflow_status,
            aplica,
            tipologia,
            adjudicable.strip() if adjudicable else None,
            respuesta.strip(),
            (validador_email or "validador@empresa.com").strip().lower(),
            now_str,
            req_redig_int,
            estado_redig,
            pqr_id
        ))
        _add_timeline(cursor, pqr_id, validador_email, "Dictamen registrado", f"Dictamen: {aplica}. Estado: {workflow_status}.")
        if req_redig_int:
            cursor.execute("SELECT asignado_redigitador_email FROM pqr_requests WHERE id = ?", (pqr_id,))
            assigned = cursor.fetchone()[0]
            if not assigned:
                cursor.execute("SELECT email FROM users WHERE rol = 'redigitador' AND activo = 1 ORDER BY id LIMIT 1")
                fallback = cursor.fetchone()
                if fallback:
                    assigned = fallback[0]
                    cursor.execute("UPDATE pqr_requests SET asignado_redigitador_email = ?, fecha_asignacion_redigitador = ? WHERE id = ?", (assigned, now_str, pqr_id))
                    _add_timeline(cursor, pqr_id, validador_email, "Redigitación asignada", f"Asignación automática a {assigned}")
            _notify(cursor, assigned, "Redigitación requerida", f"La PQR requiere redigitación y está lista para gestión.", pqr_id)
        else:
            cursor.execute("SELECT comercial_email FROM pqr_requests WHERE id = ?", (pqr_id,))
            _notify(cursor, cursor.fetchone()[0], "PQR dictaminada", f"Tu PQR fue cerrada con dictamen: {aplica}.", pqr_id)
        conn.commit()
        return get_pqr_by_id(pqr_id)

def redigitar_pqr(pqr_id: int, nuevo_numero_auditoria: str, notas: Optional[str] = None, redigitador_email: Optional[str] = None) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        try:
            cursor.execute("""
                UPDATE pqr_requests
                SET nuevo_numero_auditoria = ?,
                    notas_redigitacion = ?,
                    fecha_redigitacion = ?,
                    redigitador_email = ?,
                    estado_redigitacion = 'Redigitado',
                    estado = 'Pendiente de Verificación'
                WHERE id = ?
            """, (
                nuevo_numero_auditoria.strip(),
                notas.strip() if notas else None,
                now_str,
                (redigitador_email or "redigitador@empresa.com").strip().lower(),
                pqr_id
            ))
        except sqlite3.IntegrityError:
            return None
        _add_timeline(cursor, pqr_id, redigitador_email, "Redigitación completada", f"Nuevo número de auditoría: {nuevo_numero_auditoria.strip()}")
        cursor.execute("SELECT asignado_validador_email, comercial_email FROM pqr_requests WHERE id = ?", (pqr_id,))
        row = cursor.fetchone()
        _notify(cursor, row[0], "Verificación pendiente", "La redigitación fue completada y requiere verificación final.", pqr_id)
        _notify(cursor, row[1], "PQR redigitada", "El equipo registró un nuevo número de auditoría; el caso está en verificación final.", pqr_id)
        conn.commit()
        return get_pqr_by_id(pqr_id)

def assign_pqr(pqr_id: int, assignee_email: str, assignment_type: str, actor_email: str) -> Optional[Dict[str, Any]]:
    """Asigna el caso a un validador o redigitador activo y deja evidencia en la línea de tiempo."""
    column = "asignado_validador_email" if assignment_type == "validador" else "asignado_redigitador_email"
    date_column = "fecha_asignacion_validador" if assignment_type == "validador" else "fecha_asignacion_redigitador"
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT rol, activo FROM users WHERE LOWER(email) = LOWER(?)", (assignee_email.strip(),))
        person = cursor.fetchone()
        if not person or person[0] != assignment_type or person[1] != 1:
            return None
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        status_update = ", estado = 'En Validación'" if assignment_type == "validador" else ""
        cursor.execute(f"UPDATE pqr_requests SET {column} = ?, {date_column} = ?{status_update} WHERE id = ?", (assignee_email.lower().strip(), now, pqr_id))
        if cursor.rowcount == 0:
            return None
        label = "validador" if assignment_type == "validador" else "redigitador"
        _add_timeline(cursor, pqr_id, actor_email, f"Asignación de {label}", f"Asignado a {assignee_email.lower().strip()}")
        _notify(cursor, assignee_email, "Nuevo caso asignado", f"Tienes una PQR asignada para {label}.", pqr_id)
        conn.commit()
        return get_pqr_by_id(pqr_id)

def verify_redigitacion(pqr_id: int, aprobado: bool, comentario: str, validator_email: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pqr_requests WHERE id = ?", (pqr_id,))
        pqr = cursor.fetchone()
        if not pqr or pqr["estado_redigitacion"] != "Redigitado":
            return None
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if aprobado:
            cursor.execute("""UPDATE pqr_requests SET estado = 'Cerrado', estado_redigitacion = 'Verificado',
                fecha_verificacion = ?, verificado_por_email = ?, comentario_verificacion = ?, fecha_cierre = ? WHERE id = ?""",
                (now, validator_email.lower().strip(), comentario.strip(), now, pqr_id))
            action, notification = "Redigitación verificada", "La redigitación fue verificada y el caso se cerró definitivamente."
        else:
            cursor.execute("""UPDATE pqr_requests SET estado = 'Pendiente de Redigitación', estado_redigitacion = 'Devuelto',
                fecha_verificacion = ?, verificado_por_email = ?, comentario_verificacion = ? WHERE id = ?""",
                (now, validator_email.lower().strip(), comentario.strip(), pqr_id))
            action, notification = "Redigitación devuelta", "La validación devolvió la redigitación con observaciones."
        _add_timeline(cursor, pqr_id, validator_email, action, comentario.strip())
        _notify(cursor, pqr["asignado_redigitador_email"], action, notification, pqr_id)
        _notify(cursor, pqr["comercial_email"], action, notification, pqr_id)
        conn.commit()
        return get_pqr_by_id(pqr_id)

def reopen_pqr(pqr_id: int, motivo: str, actor_email: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT comercial_email, asignado_validador_email FROM pqr_requests WHERE id = ?", (pqr_id,))
        pqr = cursor.fetchone()
        if not pqr:
            return None
        cursor.execute("UPDATE pqr_requests SET estado = 'Reabierto', fecha_cierre = NULL WHERE id = ?", (pqr_id,))
        _add_timeline(cursor, pqr_id, actor_email, "PQR reabierta", motivo.strip())
        _notify(cursor, pqr[1], "PQR reabierta", f"El caso fue reabierto: {motivo.strip()}", pqr_id)
        _notify(cursor, pqr[0], "PQR reabierta", f"Tu caso fue reabierto: {motivo.strip()}", pqr_id)
        conn.commit()
        return get_pqr_by_id(pqr_id)

def add_feedback(pqr_id: int, satisfactorio: bool, comentario: Optional[str], comercial_email: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT comercial_email FROM pqr_requests WHERE id = ?", (pqr_id,))
        pqr = cursor.fetchone()
        if not pqr or pqr[0].lower() != comercial_email.lower().strip():
            return None
        cursor.execute("UPDATE pqr_requests SET satisfactorio = ?, comentario_satisfaccion = ? WHERE id = ?", (1 if satisfactorio else 0, (comentario or '').strip() or None, pqr_id))
        _add_timeline(cursor, pqr_id, comercial_email, "Retroalimentación registrada", "Satisfactorio" if satisfactorio else (comentario or "No satisfactorio"))
        conn.commit()
        return get_pqr_by_id(pqr_id)

def get_timeline(pqr_id: int) -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pqr_timeline WHERE pqr_id = ? ORDER BY id DESC", (pqr_id,))
        return [dict(row) for row in cursor.fetchall()]

def get_notifications(user_email: str) -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM notifications WHERE LOWER(user_email) = LOWER(?) ORDER BY id DESC LIMIT 30", (user_email.strip(),))
        return [dict(row) for row in cursor.fetchall()]

def mark_notifications_read(user_email: str) -> None:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE notifications SET leida = 1 WHERE LOWER(user_email) = LOWER(?)", (user_email.strip(),))
        conn.commit()

def get_stage_sla_metrics() -> Dict[str, Any]:
    """Mide cada tramo del proceso para detectar el cuello de botella, no solo el SLA total."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    stages = {
        "validacion": {"nombre": "Radicación a dictamen", "meta_horas": 24.0, "hours": []},
        "redigitacion": {"nombre": "Redigitación", "meta_horas": 24.0, "hours": []},
        "verificacion": {"nombre": "Verificación final", "meta_horas": 12.0, "hours": []},
    }
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pqr_requests")
        for pqr in [dict(row) for row in cursor.fetchall()]:
            if pqr.get("fecha_creacion") and pqr.get("fecha_resolucion"):
                stages["validacion"]["hours"].append(calculate_sla_business_hours(pqr["fecha_creacion"], pqr["fecha_resolucion"]))
            if pqr.get("fecha_asignacion_redigitador") and pqr.get("fecha_redigitacion"):
                stages["redigitacion"]["hours"].append(calculate_sla_business_hours(pqr["fecha_asignacion_redigitador"], pqr["fecha_redigitacion"]))
            if pqr.get("fecha_redigitacion") and pqr.get("fecha_verificacion"):
                stages["verificacion"]["hours"].append(calculate_sla_business_hours(pqr["fecha_redigitacion"], pqr["fecha_verificacion"]))
    result = []
    for item in stages.values():
        values = item.pop("hours")
        avg = round(sum(values) / len(values), 1) if values else 0.0
        result.append({**item, "casos_medidos": len(values), "promedio_horas": avg, "cumple_meta": avg <= item["meta_horas"] if values else True})
    return {"etapas": result}

def get_escalations() -> List[Dict[str, Any]]:
    """Lista casos abiertos fuera de la meta de su etapa actual para gestionarlos de inmediato."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    alerts = []
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pqr_requests WHERE estado NOT IN ('Cerrado', 'No Aplica', 'Resuelto', 'Rechazado')")
        for pqr in [dict(row) for row in cursor.fetchall()]:
            if pqr["estado"] in ("Pendiente de Redigitación", "Reabierto"):
                start, target, stage = pqr.get("fecha_asignacion_redigitador") or pqr.get("fecha_resolucion"), 24.0, "Redigitación"
            elif pqr["estado"] == "Pendiente de Verificación":
                start, target, stage = pqr.get("fecha_redigitacion"), 12.0, "Verificación final"
            else:
                start, target, stage = pqr.get("fecha_asignacion_validador") or pqr.get("fecha_creacion"), 24.0, "Validación"
            if not start:
                continue
            elapsed = calculate_sla_business_hours(start, now)
            if elapsed > target:
                alerts.append({"id": pqr["id"], "consecutivo": pqr["consecutivo"], "etapa": stage, "horas": elapsed, "meta_horas": target, "responsable": pqr.get("asignado_redigitador_email") if stage == "Redigitación" else pqr.get("asignado_validador_email")})
    return sorted(alerts, key=lambda item: item["horas"], reverse=True)

def get_pqrs_redigitacion(estado_redigitacion: Optional[str] = None, search: Optional[str] = None) -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        query = "SELECT * FROM pqr_requests WHERE requiere_redigitacion = 1"
        params = []
        
        if estado_redigitacion and estado_redigitacion != "Todos":
            query += " AND estado_redigitacion = ?"
            params.append(estado_redigitacion)
            
        if search:
            query += " AND (consecutivo LIKE ? OR id_pdv LIKE ? OR cliente LIKE ? OR nuevo_numero_auditoria LIKE ? OR error LIKE ?)"
            term = f"%{search.strip()}%"
            params.extend([term, term, term, term, term])
            
        query += " ORDER BY id DESC"
        cursor.execute(query, params)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

def get_metrics() -> Dict[str, Any]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM pqr_requests")
        total = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM pqr_requests WHERE estado IN ('Radicado', 'Pendiente', 'Reabierto')")
        pendientes = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM pqr_requests WHERE estado IN ('En Revisión', 'En Validación')")
        en_revision = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM pqr_requests WHERE estado IN ('Resuelto', 'Cerrado', 'No Aplica')")
        resueltos = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM pqr_requests WHERE estado = 'Rechazado'")
        rechazados = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM pqr_requests WHERE aplica = 'Aplica'")
        aplica_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM pqr_requests WHERE aplica = 'No Aplica'")
        no_aplica_count = cursor.fetchone()[0]
        
        today_prefix = datetime.now().strftime("%Y-%m-%d")
        cursor.execute("SELECT COUNT(*) FROM pqr_requests WHERE fecha_resolucion LIKE ?", (f"{today_prefix}%",))
        resueltos_hoy = cursor.fetchone()[0]
        
        total_evaluados = aplica_count + no_aplica_count
        tasa_aplica = round((aplica_count / total_evaluados * 100), 1) if total_evaluados > 0 else 0
        
        cursor.execute("SELECT COUNT(*) FROM users")
        total_users = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM pqr_requests WHERE requiere_redigitacion = 1 AND estado_redigitacion = 'Pendiente'")
        redigitacion_pendientes = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM pqr_requests WHERE estado_redigitacion = 'Redigitado'")
        redigitacion_completadas = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM pqr_requests WHERE estado = 'Pendiente de Verificación'")
        verificaciones_pendientes = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM pqr_requests WHERE estado = 'Reabierto'")
        reabiertos = cursor.fetchone()[0]
        
        return {
            "total": total,
            "pendientes": pendientes,
            "en_revision": en_revision,
            "resueltos": resueltos,
            "rechazados": rechazados,
            "aplica_count": aplica_count,
            "no_aplica_count": no_aplica_count,
            "resueltos_hoy": resueltos_hoy,
            "tasa_aplica": tasa_aplica,
            "total_users": total_users,
            "redigitacion_pendientes": redigitacion_pendientes,
            "redigitacion_completadas": redigitacion_completadas,
            "verificaciones_pendientes": verificaciones_pendientes,
            "reabiertos": reabiertos
        }

# --- Estadísticas de Validadores y SLA ---

def get_validator_stats() -> Dict[str, Any]:
    with get_db() as conn:
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM pqr_requests WHERE fecha_resolucion IS NOT NULL")
        resolved_rows = [dict(r) for r in cursor.fetchall()]
        
        cursor.execute("SELECT nombre, email FROM users WHERE rol = 'validador'")
        registered_validators = [dict(r) for r in cursor.fetchall()]
        
        SLA_TARGET_HOURS = 48.0
        
        validators_map = {}
        for v in registered_validators:
            vemail = v["email"].lower().strip()
            validators_map[vemail] = {
                "nombre": v["nombre"],
                "email": vemail,
                "total_resueltos": 0,
                "aplica_count": 0,
                "no_aplica_count": 0,
                "parcial_count": 0,
                "durations_hours": [],
                "dentro_sla_count": 0
            }
            
        for r in resolved_rows:
            vemail = (r.get("validador_email") or "validador@empresa.com").lower().strip()
            if vemail not in validators_map:
                name_clean = vemail.split("@")[0].replace(".", " ").title()
                validators_map[vemail] = {
                    "nombre": name_clean,
                    "email": vemail,
                    "total_resueltos": 0,
                    "aplica_count": 0,
                    "no_aplica_count": 0,
                    "parcial_count": 0,
                    "durations_hours": [],
                    "dentro_sla_count": 0
                }
            
            entry = validators_map[vemail]
            entry["total_resueltos"] += 1
            
            apl = r.get("aplica")
            if apl == "Aplica":
                entry["aplica_count"] += 1
            elif apl == "No Aplica":
                entry["no_aplica_count"] += 1
            elif apl == "Aplica Parcialmente":
                entry["parcial_count"] += 1
                
            f_crea = r.get("fecha_creacion")
            f_reso = r.get("fecha_resolucion")
            if f_crea and f_reso:
                diff_hours = calculate_sla_business_hours(f_crea, f_reso)
                entry["durations_hours"].append(diff_hours)
                if diff_hours <= SLA_TARGET_HOURS:
                    entry["dentro_sla_count"] += 1

        val_list = []
        all_durations = []
        all_dentro_sla = 0
        all_resueltos = 0
        
        for k, v in validators_map.items():
            tot = v["total_resueltos"]
            durations = v["durations_hours"]
            avg_h = round(sum(durations) / len(durations), 1) if durations else 0.0
            sla_pct = round((v["dentro_sla_count"] / tot * 100), 1) if tot > 0 else 100.0
            aplica_pct = round((v["aplica_count"] / tot * 100), 1) if tot > 0 else 0.0
            no_aplica_pct = round((v["no_aplica_count"] / tot * 100), 1) if tot > 0 else 0.0
            
            all_durations.extend(durations)
            all_dentro_sla += v["dentro_sla_count"]
            all_resueltos += tot
            
            val_list.append({
                "nombre": v["nombre"],
                "email": v["email"],
                "total_resueltos": tot,
                "aplica_count": v["aplica_count"],
                "aplica_pct": aplica_pct,
                "no_aplica_count": v["no_aplica_count"],
                "no_aplica_pct": no_aplica_pct,
                "parcial_count": v["parcial_count"],
                "avg_hours": avg_h,
                "sla_pct": sla_pct,
                "dentro_sla_count": v["dentro_sla_count"]
            })
            
        val_list.sort(key=lambda x: x["total_resueltos"], reverse=True)
        
        global_avg_hours = round(sum(all_durations) / len(all_durations), 1) if all_durations else 0.0
        global_sla_pct = round((all_dentro_sla / all_resueltos * 100), 1) if all_resueltos > 0 else 100.0
        
        # Desglose por tipología
        cursor.execute("""
            SELECT tipologia, 
                   COUNT(*) as total,
                   SUM(CASE WHEN aplica = 'Aplica' THEN 1 ELSE 0 END) as aplica_cnt,
                   SUM(CASE WHEN aplica = 'No Aplica' THEN 1 ELSE 0 END) as no_aplica_cnt
            FROM pqr_requests 
            WHERE tipologia IS NOT NULL AND tipologia != ''
            GROUP BY tipologia
            ORDER BY total DESC
        """)
        tipologias_stats = []
        for r in cursor.fetchall():
            tot = r[1]
            ap_cnt = r[2] or 0
            no_ap_cnt = r[3] or 0
            tipologias_stats.append({
                "tipologia": r[0],
                "total": tot,
                "aplica_cnt": ap_cnt,
                "no_aplica_cnt": no_ap_cnt,
                "aplica_pct": round(ap_cnt / tot * 100, 1) if tot > 0 else 0.0
            })

        # Desglose por área adjudicable (IT, Comercial, Campo, Validación)
        cursor.execute("""
            SELECT adjudicable, 
                   COUNT(*) as total,
                   SUM(CASE WHEN aplica = 'Aplica' THEN 1 ELSE 0 END) as aplica_cnt,
                   SUM(CASE WHEN aplica = 'No Aplica' THEN 1 ELSE 0 END) as no_aplica_cnt
            FROM pqr_requests 
            WHERE adjudicable IS NOT NULL AND adjudicable != ''
            GROUP BY adjudicable
            ORDER BY total DESC
        """)
        adjudicable_stats = []
        for r in cursor.fetchall():
            tot = r[1]
            ap_cnt = r[2] or 0
            no_ap_cnt = r[3] or 0
            adjudicable_stats.append({
                "adjudicable": r[0],
                "total": tot,
                "aplica_cnt": ap_cnt,
                "no_aplica_cnt": no_ap_cnt,
                "aplica_pct": round(ap_cnt / tot * 100, 1) if tot > 0 else 0.0
            })

        # Desglose por país
        cursor.execute("""
            SELECT pais, 
                   COUNT(*) as total,
                   SUM(CASE WHEN aplica = 'Aplica' THEN 1 ELSE 0 END) as aplica_cnt,
                   SUM(CASE WHEN aplica = 'No Aplica' THEN 1 ELSE 0 END) as no_aplica_cnt,
                   SUM(CASE WHEN estado = 'Pendiente' THEN 1 ELSE 0 END) as pendientes_cnt
            FROM pqr_requests
            GROUP BY pais
            ORDER BY total DESC
        """)
        pais_stats = []
        for r in cursor.fetchall():
            tot = r[1]
            ap_cnt = r[2] or 0
            no_ap_cnt = r[3] or 0
            pend_cnt = r[4] or 0
            pais_stats.append({
                "pais": r[0],
                "total": tot,
                "aplica_cnt": ap_cnt,
                "no_aplica_cnt": no_ap_cnt,
                "pendientes_cnt": pend_cnt,
                "aplica_pct": round(ap_cnt / tot * 100, 1) if tot > 0 else 0.0
            })
            
        return {
            "validadores": val_list,
            "global_avg_hours": global_avg_hours,
            "global_sla_pct": global_sla_pct,
            "sla_meta_horas": SLA_TARGET_HOURS,
            "total_resueltos": all_resueltos,
            "tipologias_stats": tipologias_stats,
            "adjudicable_stats": adjudicable_stats,
            "pais_stats": pais_stats
        }
