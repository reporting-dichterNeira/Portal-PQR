import sys
import os

# Asegurar importación del directorio local
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from main import app
from database import init_db

def run_tests():
    print("=== INICIANDO PRUEBAS DEL FLUJO DE REDIGITACIÓN ===")
    init_db()
    client = TestClient(app)

    # 1. Probar login del redigitador
    print("\n1. Probando autenticación del usuario redigitador...")
    login_res = client.post("/api/auth/login", json={
        "email": "redigitador@empresa.com",
        "password": "Redigitador123*"
    })
    assert login_res.status_code == 200, f"Error en login: {login_res.text}"
    user_data = login_res.json()
    assert user_data["rol"] == "redigitador", f"Rol inesperado: {user_data['rol']}"
    print(f" -> Login exitoso: {user_data['nombre']} con rol '{user_data['rol']}'")

    # 2. Comercial radica un nuevo PQR
    print("\n2. Creando nuevo PQR desde comercial...")
    pqr_res = client.post("/api/pqr", data={
        "comercial_email": "carlos.mendoza@empresa.com",
        "id_pdv": "PDV-TEST-999",
        "cliente": "Supermercado Prueba Redigitación",
        "pais": "Colombia",
        "error": "Factura emitida con precio unitario desactualizado. Requiere anulación y nueva emisión con código de auditoría."
    })
    assert pqr_res.status_code == 200, f"Error creando PQR: {pqr_res.text}"
    pqr = pqr_res.json()
    pqr_id = pqr["id"]
    consecutivo = pqr["consecutivo"]
    print(f" -> PQR creado exitosamente: ID={pqr_id}, Radicado={consecutivo}")

    # 3. Validador dictamina "Aplica" y marca "Requiere Redigitación"
    print(f"\n3. Validador dictaminando caso {consecutivo} como Aplica + Requiere Redigitación...")
    resolve_res = client.post(f"/api/pqr/{pqr_id}/resolver", json={
        "estado": "Resuelto",
        "aplica": "Aplica",
        "tipologia": "Facturación y Cartera (Cobro errado, nota crédito, valor incorrecto)",
        "respuesta": "Procede el reclamo comercial. Se autoriza refacturación con nuevo número de auditoría.",
        "validador_email": "validador@empresa.com",
        "requiere_redigitacion": True
    })
    assert resolve_res.status_code == 200, f"Error resolviendo PQR: {resolve_res.text}"
    resolved = resolve_res.json()
    assert resolved["requiere_redigitacion"] == 1, "requiere_redigitacion no es 1"
    assert resolved["estado_redigitacion"] == "Pendiente", f"estado_redigitacion esperado 'Pendiente', obtenido '{resolved['estado_redigitacion']}'"
    print(f" -> Caso resuelto: requiere_redigitacion={resolved['requiere_redigitacion']}, estado_redigitacion={resolved['estado_redigitacion']}")

    # 4. Consultar cola de redigitación
    print("\n4. Consultando endpoint /api/redigitacion...")
    queue_res = client.get("/api/redigitacion?estado_redigitacion=Pendiente")
    assert queue_res.status_code == 200, f"Error en /api/redigitacion: {queue_res.text}"
    items = queue_res.json()
    found = any(item["id"] == pqr_id for item in items)
    assert found, f"El caso {consecutivo} no apareció en la cola de redigitación pendiente!"
    print(f" -> Caso {consecutivo} encontrado en la cola de redigitación (Total pendientes: {len(items)})")

    # 5. Equipo de Redigitación asigna Nuevo Número de Auditoría
    print("\n5. Equipo de redigitación asigna nuevo número de auditoría...")
    audit_num = "AUD-2026-TEST-7788"
    redig_res = client.post(f"/api/pqr/{pqr_id}/redigitar", json={
        "nuevo_numero_auditoria": audit_num,
        "notas": "Refacturación procesada satisfactoriamente en el ERP corporativo.",
        "redigitador_email": "redigitador@empresa.com"
    })
    assert redig_res.status_code == 200, f"Error en /redigitar: {redig_res.text}"
    redig_data = redig_res.json()
    assert redig_data["nuevo_numero_auditoria"] == audit_num, f"Auditoría no coincide: {redig_data['nuevo_numero_auditoria']}"
    assert redig_data["estado_redigitacion"] == "Redigitado", f"Estado esperado 'Redigitado', obtenido '{redig_data['estado_redigitacion']}'"
    assert redig_data["redigitador_email"] == "redigitador@empresa.com"
    assert redig_data["fecha_redigitacion"] is not None
    print(f" -> Redigitación completada: Auditoría={redig_data['nuevo_numero_auditoria']}, Estado={redig_data['estado_redigitacion']}, Fecha={redig_data['fecha_redigitacion']}")

    # 6. Verificar exportación a Excel con campos de redigitación
    print("\n6. Verificando exportación a Excel con columnas de redigitación...")
    excel_res = client.get("/api/pqr/export/excel")
    assert excel_res.status_code == 200, f"Error descargando Excel: {excel_res.status_code}"
    assert excel_res.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert len(excel_res.content) > 1000, "El archivo de Excel parece vacío"
    print(f" -> Archivo Excel generado con éxito ({len(excel_res.content)} bytes)")

    # 7. Verificar métricas actualizadas
    print("\n7. Verificando métricas globales...")
    metrics_res = client.get("/api/metrics")
    assert metrics_res.status_code == 200
    metrics = metrics_res.json()
    assert "redigitacion_pendientes" in metrics
    assert "redigitacion_completadas" in metrics
    print(f" -> Métricas: Pendientes={metrics['redigitacion_pendientes']}, Redigitadas={metrics['redigitacion_completadas']}")

    # 8. Verificar que la vista HTML /redigitacion responda 200
    print("\n8. Verificando vista web /redigitacion...")
    view_res = client.get("/redigitacion")
    assert view_res.status_code == 200, f"Error cargando /redigitacion: {view_res.status_code}"
    assert "Bandeja de Gestión y Redigitación" in view_res.text
    print(" -> Vista /redigitacion renderiza correctamente.")

    print("\n=======================================================")
    print("   TODAS LAS PRUEBAS DE REDIGITACIÓN PASARON CON ÉXITO ")
    print("=======================================================")

if __name__ == "__main__":
    run_tests()
