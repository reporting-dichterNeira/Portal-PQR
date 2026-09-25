"""Prueba aislada del flujo Radicar → Validar → Redigitar → Verificar."""
import os
import tempfile
import gc

from fastapi.testclient import TestClient

import database
from database import init_db
from main import app


def login(client, email, password):
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text


def test_secure_redigitacion_workflow():
    original_db = database.DB_PATH
    with tempfile.TemporaryDirectory() as temp_dir:
        database.DB_PATH = os.path.join(temp_dir, "workflow.db")
        try:
            init_db()
            with TestClient(app) as comercial, TestClient(app) as validador, TestClient(app) as redigitador, TestClient(app) as anonimo:
                assert anonimo.get("/api/admin/users").status_code == 401

                login(comercial, "carlos.mendoza@empresa.com", "Carlos123*")
                created = comercial.post("/api/pqr", data={
                "id_pdv": "PDV-FLUJO-001",
                "cliente": "Cliente Flujo",
                "pais": "Colombia",
                "error": "Error controlado para verificar el flujo completo",
                })
                assert created.status_code == 200, created.text
                pqr_id = created.json()["id"]
                assert created.json()["estado"] == "Radicado"
                assert comercial.get("/api/admin/users").status_code == 403

                login(validador, "validador@empresa.com", "Validador123*")
                assert validador.get("/api/gestion/sla-etapas").status_code == 200
                assert validador.get("/api/gestion/escalaciones").status_code == 200
                assigned = validador.post(f"/api/pqr/{pqr_id}/asignar/validador", json={"assignee_email": "validador@empresa.com"})
                assert assigned.status_code == 200, assigned.text
                assert assigned.json()["estado"] == "En Validación"

                resolved = validador.post(f"/api/pqr/{pqr_id}/resolver", json={
                "estado": "Resuelto",
                "aplica": "Aplica",
                "tipologia": "Error en Sistema / PDV",
                "adjudicable": "IT",
                "respuesta": "La corrección requiere una nueva digitación de auditoría.",
                "requiere_redigitacion": True,
                })
                assert resolved.status_code == 200, resolved.text
                assert resolved.json()["estado"] == "Pendiente de Redigitación"

                login(redigitador, "redigitador@empresa.com", "Redigitador123*")
                queue = redigitador.get("/api/redigitacion?estado_redigitacion=Pendiente")
                assert queue.status_code == 200
                assert any(item["id"] == pqr_id for item in queue.json())
                redigitado = redigitador.post(f"/api/pqr/{pqr_id}/redigitar", json={
                "nuevo_numero_auditoria": "AUD-FLUJO-001",
                "notas": "Registro corregido y verificado por redigitación.",
                })
                assert redigitado.status_code == 200, redigitado.text
                assert redigitado.json()["estado"] == "Pendiente de Verificación"

                verified = validador.post(f"/api/pqr/{pqr_id}/verificar-redigitacion", json={
                "aprobado": True,
                "comentario": "Número de auditoría y soporte validados correctamente.",
                })
                assert verified.status_code == 200, verified.text
                assert verified.json()["estado"] == "Cerrado"
                assert verified.json()["estado_redigitacion"] == "Verificado"
                timeline = validador.get(f"/api/pqr/{pqr_id}/timeline")
                assert timeline.status_code == 200
                assert len(timeline.json()) >= 5
            # sqlite3 no cierra la conexión al salir de su context manager; forzamos
            # recolección antes de que TemporaryDirectory elimine el archivo en Windows.
            gc.collect()
        finally:
            database.DB_PATH = original_db
