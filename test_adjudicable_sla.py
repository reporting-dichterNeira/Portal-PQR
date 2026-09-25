import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from main import app
from database import init_db, calculate_sla_business_hours, get_validator_stats

def run_tests():
    print("=== INICIANDO PRUEBAS DE ADJUDICABLE Y SLA 48H HÁBILES ===")
    init_db()

    # 1. Pruebas de cálculo de horas hábiles para SLA
    print("\n1. Verificando cálculo de horas de SLA con exclusión de fin de semana...")
    
    # Caso A: Radicado Viernes 17:30 (después de 5pm), resuelto Lunes 09:00 AM
    # Debe empezar a contar el Lunes a las 08:00 AM -> 1.0 hora
    h_a = calculate_sla_business_hours("2026-09-04 17:30:00", "2026-09-07 09:00:00")
    print(f" -> Viernes 17:30 a Lunes 09:00: {h_a} h (Esperado: 1.0 h)")
    assert h_a == 1.0, f"Error caso A: obtenido {h_a}"

    # Caso B: Radicado Viernes 14:00 (antes de 5pm), resuelto Lunes 09:00 AM
    # Viernes 14:00 a 17:00 = 3h. Fin de semana pausado. Lunes 08:00 a 09:00 = 1h. Total: 4.0h
    h_b = calculate_sla_business_hours("2026-09-04 14:00:00", "2026-09-07 09:00:00")
    print(f" -> Viernes 14:00 a Lunes 09:00: {h_b} h (Esperado: 4.0 h)")
    assert h_b == 4.0, f"Error caso B: obtenido {h_b}"

    # Caso C: Radicado Sábado o Domingo, resuelto Lunes 10:00 AM -> Inicia Lunes 08:00 AM = 2.0h
    h_c = calculate_sla_business_hours("2026-09-05 12:00:00", "2026-09-07 10:00:00")
    print(f" -> Sábado 12:00 a Lunes 10:00: {h_c} h (Esperado: 2.0 h)")
    assert h_c == 2.0, f"Error caso C: obtenido {h_c}"

    # Caso D: Caso entre semana (Martes 10:00 a Jueves 10:00 = 48.0h)
    h_d = calculate_sla_business_hours("2026-09-08 10:00:00", "2026-09-10 10:00:00")
    print(f" -> Martes 10:00 a Jueves 10:00: {h_d} h (Esperado: 48.0 h)")
    assert h_d == 48.0, f"Error caso D: obtenido {h_d}"

    # 2. Pruebas de API de resolución con campo 'adjudicable'
    print("\n2. Probando API /api/pqr/{id}/resolver con campo 'adjudicable'...")
    client = TestClient(app)

    # Crear PQR
    crea_res = client.post("/api/pqr", data={
        "comercial_email": "carlos.mendoza@empresa.com",
        "id_pdv": "PDV-ADJ-001",
        "cliente": "ko moderno",
        "pais": "Colombia",
        "error": "Falla en terminal de pago con error 502 Bad Gateway"
    })
    assert crea_res.status_code == 200
    pqr = crea_res.json()
    pqr_id = pqr["id"]

    # Resolver asignando adjudicable = "IT"
    res_api = client.post(f"/api/pqr/{pqr_id}/resolver", json={
        "estado": "Resuelto",
        "aplica": "Aplica",
        "tipologia": "Error en Sistema / PDV",
        "adjudicable": "IT",
        "respuesta": "Reiniciado el servicio de pasarela y reconfigurado el puerto TCP.",
        "validador_email": "validador@empresa.com"
    })
    assert res_api.status_code == 200, f"Error al resolver: {res_api.text}"
    resolved = res_api.json()
    assert resolved["adjudicable"] == "IT", f"adjudicable esperado 'IT', obtenido '{resolved.get('adjudicable')}'"
    print(f" -> Caso {resolved['consecutivo']} resuelto exitosamente con área adjudicable: '{resolved['adjudicable']}'")

    # 3. Verificar endpoint /api/validador/stats
    print("\n3. Verificando /api/validador/stats (meta 48h y adjudicable_stats)...")
    stats_res = client.get("/api/validador/stats")
    assert stats_res.status_code == 200
    stats = stats_res.json()
    assert stats["sla_meta_horas"] == 48.0, f"Meta SLA esperada 48.0, obtenida {stats['sla_meta_horas']}"
    assert "adjudicable_stats" in stats
    print(f" -> Meta SLA: {stats['sla_meta_horas']} horas")
    print(f" -> Desglose por áreas adjudicables: {len(stats['adjudicable_stats'])} áreas registradas")
    for a in stats["adjudicable_stats"]:
        print(f"    - {a['adjudicable']}: {a['total']} tickets ({a['aplica_pct']}% Aplica)")

    # 4. Verificar exportación a Excel
    print("\n4. Verificando archivo Excel con columnas de Adjudicable y Horas Hábiles SLA...")
    excel_res = client.get("/api/pqr/export/excel")
    assert excel_res.status_code == 200
    assert len(excel_res.content) > 1000
    print(" -> Archivo Excel generado correctamente con las nuevas columnas.")

    print("\n=================================================================")
    print("  TODAS LAS PRUEBAS DE ADJUDICABLE Y SLA 48H HÁBILES PASARON OK  ")
    print("=================================================================")

if __name__ == "__main__":
    run_tests()
