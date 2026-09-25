from database import init_db, create_pqr, resolve_pqr, redigitar_pqr, get_all_users

def seed():
    print("Inicializando base de datos y usuarios...")
    init_db()

    users = get_all_users()
    print(f"Usuarios en el sistema: {len(users)}")
    for u in users:
        print(f" - [{u['rol'].upper()}] {u['nombre']} ({u['email']})")

    # Ticket 1: Validador Principal (Aplica + Requiere Redigitación -> Ya Redigitado)
    p1 = create_pqr({
        "comercial_email": "carlos.mendoza@empresa.com",
        "id_pdv": "PDV-BOG-014",
        "cliente": "ko tradicional",
        "pais": "Colombia",
        "error": "Error en facturación electrónica al aplicar descuento del 15% acordado. La factura salió por el valor bruto sin la deducción.",
        "fecha_creacion": "2026-09-03 09:00:00"
    })
    resolve_pqr(
        pqr_id=p1["id"],
        estado="Resuelto",
        aplica="Aplica",
        tipologia="Facturación y Cartera (Cobro errado, nota crédito, valor incorrecto)",
        adjudicable="Comercial",
        respuesta="Verificado el acuerdo comercial. Procede nota crédito y redigitación de la factura con el nuevo lote de auditoría.",
        validador_email="validador@empresa.com",
        fecha_resolucion="2026-09-03 12:30:00",
        requiere_redigitacion=True
    )
    redigitar_pqr(
        pqr_id=p1["id"],
        nuevo_numero_auditoria="AUD-2026-8801",
        notas="Factura reingresada en el ERP con el descuento del 15%. Auditoría fiscal aprobada.",
        redigitador_email="redigitador@empresa.com"
    )

    # Ticket 2: Validador Principal (Aplica + Requiere Redigitación -> Pendiente por Redigitar)
    p2 = create_pqr({
        "comercial_email": "carlos.mendoza@empresa.com",
        "id_pdv": "PDV-PAN-102",
        "cliente": "Heineken",
        "pais": "Panamá",
        "error": "El pedido llegó incompleto con faltante de 20 bultos de referencia REF-4402 según remisión.",
        "fecha_creacion": "2026-09-03 10:00:00"
    })
    resolve_pqr(
        pqr_id=p2["id"],
        estado="Resuelto",
        aplica="Aplica",
        tipologia="Logística y Despacho (Demora en entrega, producto averiado, faltante)",
        adjudicable="Campo",
        respuesta="Verificado con bodega en Colón. Procede reingreso de orden para despacho complementario de 20 bultos.",
        validador_email="validador@empresa.com",
        fecha_resolucion="2026-09-03 15:00:00",
        requiere_redigitacion=True
    )
    # Dejar p2 pendiente de redigitación

    # Ticket 3: Validador Principal (No Aplica)
    p3 = create_pqr({
        "comercial_email": "laura.gomez@empresa.com",
        "id_pdv": "PDV-SJO-005",
        "cliente": "Fifco",
        "pais": "Costa Rica",
        "error": "Cliente solicita reconocimiento de garantía por mercancía expuesta a humedad exterior durante almacenamiento en su bodega privada.",
        "fecha_creacion": "2026-09-03 08:00:00"
    })
    resolve_pqr(
        pqr_id=p3["id"],
        estado="Resuelto",
        aplica="No Aplica",
        tipologia="Calidad de Producto / Servicio (Falla técnica, garantía)",
        adjudicable="Validación",
        respuesta="Los daños por condiciones inapropiadas de almacenamiento en bodegas del cliente no son atribuibles a defecto de origen de acuerdo a la póliza.",
        validador_email="validador@empresa.com",
        fecha_resolucion="2026-09-03 16:00:00",
        requiere_redigitacion=False
    )

    # Ticket 4: María López Validadora (Aplica, sin redigitación)
    p4 = create_pqr({
        "comercial_email": "carlos.mendoza@empresa.com",
        "id_pdv": "PDV-MED-009",
        "cliente": "P&G",
        "pais": "Colombia",
        "error": "Doble cobro de transacción en datafono integrado del punto de venta.",
        "fecha_creacion": "2026-09-02 14:00:00"
    })
    resolve_pqr(
        pqr_id=p4["id"],
        estado="Resuelto",
        aplica="Aplica",
        tipologia="Error en Sistema / PDV",
        adjudicable="IT",
        respuesta="Confirmada duplicidad en log de pasarela de pagos. Se tramitó la devolución del cargo duplicado a la cuenta del cliente.",
        validador_email="maria.validadora@empresa.com",
        fecha_resolucion="2026-09-03 04:00:00",
        requiere_redigitacion=False
    )

    # Ticket 5: María López Validadora (Caso Viernes > 5:00 PM -> Inicia Lunes 8:00 AM)
    p5 = create_pqr({
        "comercial_email": "laura.gomez@empresa.com",
        "id_pdv": "PDV-GUA-022",
        "cliente": "CBC",
        "pais": "Guatemala",
        "error": "Solicitud de descuento por volumen luego de emitida y radicada la factura de compra.",
        "fecha_creacion": "2026-09-04 17:35:00" # Viernes después de las 5pm
    })
    resolve_pqr(
        pqr_id=p5["id"],
        estado="Resuelto",
        aplica="Aplica",
        tipologia="Condiciones Comerciales (Descuento no aplicado, acuerdo de precios)",
        adjudicable="Comercial",
        respuesta="Revisado el acuerdo comercial. Cumple SLA de 48h hábiles al iniciar el cómputo el lunes a las 08:00 AM.",
        validador_email="maria.validadora@empresa.com",
        fecha_resolucion="2026-09-07 10:00:00", # Lunes 10:00 AM (2.0 horas hábiles)
        requiere_redigitacion=False
    )

    # Ticket 6: Pendiente de validación 1
    create_pqr({
        "comercial_email": "carlos.mendoza@empresa.com",
        "id_pdv": "PDV-MEX-003",
        "cliente": "ABI",
        "pais": "México",
        "error": "Discrepancia en precio unitario registrado en sistema vs lista de precios oficial de septiembre.",
        "fecha_creacion": "2026-09-04 10:15:00"
    })

    # Ticket 7: Pendiente de validación 2
    create_pqr({
        "comercial_email": "laura.gomez@empresa.com",
        "id_pdv": "PDV-BOG-088",
        "cliente": "Otros: Farmacias Unidas",
        "pais": "Colombia",
        "error": "Lote de medicamento con fecha de vencimiento menor a 6 meses recibido en punto de distribución.",
        "fecha_creacion": "2026-09-04 11:30:00"
    })

    print("¡Base de datos sembrada con adjudicable y métricas de SLA 48h hábiles!")

if __name__ == "__main__":
    seed()

