import os
import io
import uuid
import shutil
from fastapi import FastAPI, Request, HTTPException, Query, Form, UploadFile, File, Response, Depends
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from typing import Optional, List
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

from database import (
    init_db, create_pqr, get_pqrs, get_pqr_by_id, 
    resolve_pqr, get_tipologias, get_tipologias_detail, add_tipologia, delete_tipologia,
    get_metrics, authenticate_user, create_user, get_all_users, get_user_by_id, get_user_by_email, get_active_users_by_role,
    update_user, delete_user, get_validator_stats, redigitar_pqr, get_pqrs_redigitacion,
    calculate_sla_business_hours, find_possible_duplicate, assign_pqr, verify_redigitacion,
    reopen_pqr, add_feedback, get_timeline, get_notifications, mark_notifications_read, get_stage_sla_metrics, get_escalations
)
from models import UserLogin, UserCreate, UserUpdate, PQRResolve, TipologiaCreate, PQRRedigitar, PQRAssignment, PQRVerification, PQRReopen, PQRFeedback

app = FastAPI(title="Portal de Gestión PQR", version="3.0.0")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

# Montar carpeta de uploads para servir archivos
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

@app.on_event("startup")
def on_startup():
    init_db()

def get_current_user(request: Request):
    email = request.cookies.get("session_user")
    user = get_user_by_email(email) if email else None
    if not user or not user.get("activo"):
        raise HTTPException(status_code=401, detail="Debes iniciar sesión para continuar")
    return user

def require_roles(*roles):
    def dependency(user=Depends(get_current_user)):
        if user["rol"] not in roles:
            raise HTTPException(status_code=403, detail="No tienes permiso para esta acción")
        return user
    return dependency

def require_page_user(request: Request, roles):
    try:
        user = get_current_user(request)
    except HTTPException:
        return None
    return user if user["rol"] in roles else None

# --- Rutas de Vistas Web ---

@app.get("/", response_class=HTMLResponse)
def view_home(request: Request):
    return templates.TemplateResponse(request=request, name="login.html")

@app.get("/comercial", response_class=HTMLResponse)
def view_comercial(request: Request):
    user = require_page_user(request, ("comercial",))
    if not user:
        return RedirectResponse(url="/")
    return templates.TemplateResponse(request=request, name="comercial.html", context={"email": user["email"]})

@app.get("/validador", response_class=HTMLResponse)
def view_validador(request: Request):
    if not require_page_user(request, ("validador", "admin")):
        return RedirectResponse(url="/")
    return templates.TemplateResponse(request=request, name="validador.html")

@app.get("/redigitacion", response_class=HTMLResponse)
def view_redigitacion(request: Request):
    if not require_page_user(request, ("redigitador", "admin")):
        return RedirectResponse(url="/")
    return templates.TemplateResponse(request=request, name="redigitacion.html")

@app.get("/admin", response_class=HTMLResponse)
def view_admin(request: Request):
    if not require_page_user(request, ("admin",)):
        return RedirectResponse(url="/")
    return templates.TemplateResponse(request=request, name="admin.html")

# --- Autenticación ---

@app.post("/api/auth/login")
def api_login(data: UserLogin, response: Response):
    user = authenticate_user(data.email, data.password)
    if not user:
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos")
    response.set_cookie(key="session_user", value=user["email"], httponly=True, samesite="lax", max_age=86400)
    return user

@app.post("/api/auth/logout")
def api_logout(response: Response):
    response.delete_cookie(key="session_user")
    return {"status": "logged_out"}

# --- Panel Administrativo (Gestión de Usuarios y Tipologías) ---

@app.get("/api/admin/users")
def api_get_users(user=Depends(require_roles("admin"))):
    return get_all_users()

@app.post("/api/admin/users")
def api_create_user(user_data: UserCreate, user=Depends(require_roles("admin"))):
    created = create_user(
        nombre=user_data.nombre,
        email=user_data.email,
        password=user_data.password,
        rol=user_data.rol
    )
    if not created:
        raise HTTPException(status_code=400, detail="El correo ya se encuentra registrado.")
    return created

@app.put("/api/admin/users/{user_id}")
def api_update_user(user_id: int, user_data: UserUpdate, user=Depends(require_roles("admin"))):
    updated = update_user(
        user_id=user_id,
        nombre=user_data.nombre,
        email=user_data.email,
        rol=user_data.rol,
        activo=user_data.activo,
        password=user_data.password
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return updated

@app.delete("/api/admin/users/{user_id}")
def api_delete_user(user_id: int, user=Depends(require_roles("admin"))):
    if user_id == 1:
        raise HTTPException(status_code=400, detail="No es posible eliminar el superadministrador principal.")
    ok = delete_user(user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"status": "deleted"}

@app.get("/api/admin/tipologias-detail")
def api_get_tipologias_detail(user=Depends(require_roles("admin"))):
    return get_tipologias_detail()

@app.delete("/api/admin/tipologias/{tipologia_id}")
def api_delete_tipologia(tipologia_id: int, user=Depends(require_roles("admin"))):
    ok = delete_tipologia(tipologia_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Tipología no encontrada")
    return {"status": "deleted"}

# --- Catálogo de Tipologías para Validador ---

@app.get("/api/tipologias")
def api_get_tipologias():
    return get_tipologias()

@app.post("/api/tipologias")
def api_add_tipologia(data: TipologiaCreate, user=Depends(require_roles("admin"))):
    ok = add_tipologia(data.nombre)
    if not ok:
        raise HTTPException(status_code=400, detail="La tipología ya existe o no se pudo agregar.")
    return {"status": "success", "nombre": data.nombre}

# --- Estadísticas y Métricas de Rendimiento de Validadores (SLA) ---

@app.get("/api/validador/stats")
def api_get_validador_stats(user=Depends(require_roles("validador", "admin"))):
    return get_validator_stats()

# --- PQRs (Radicación Comercial con Archivos) ---

@app.post("/api/pqr")
async def api_create_pqr(
    id_pdv: str = Form(...),
    cliente: str = Form(...),
    pais: str = Form(...),
    error: str = Form(...),
    archivo: Optional[UploadFile] = File(None),
    user=Depends(require_roles("comercial"))
):
    comercial_email = user["email"]
    duplicate = find_possible_duplicate(comercial_email, id_pdv, error)
    if duplicate:
        raise HTTPException(status_code=409, detail=f"Posible duplicado: ya existe el radicado {duplicate['consecutivo']} para este PDV.")
    adjunto_nombre = None
    adjunto_ruta = None

    if archivo and archivo.filename:
        allowed_extensions = {".png", ".jpg", ".jpeg", ".webp", ".xlsx", ".xls"}
        extension = os.path.splitext(archivo.filename)[1].lower()
        if extension not in allowed_extensions:
            raise HTTPException(status_code=400, detail="Adjunto no permitido. Usa PNG, JPG, WEBP, XLSX o XLS.")
        content = await archivo.read(10 * 1024 * 1024 + 1)
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="El adjunto supera el límite de 10 MB.")
        safe_name = f"{uuid.uuid4().hex[:8]}_{os.path.basename(archivo.filename)}"
        file_path = os.path.join(UPLOADS_DIR, safe_name)
        with open(file_path, "wb") as buffer:
            buffer.write(content)
        adjunto_nombre = archivo.filename
        adjunto_ruta = f"/uploads/{safe_name}"

    created = create_pqr({
        "comercial_email": comercial_email,
        "id_pdv": id_pdv,
        "cliente": cliente,
        "pais": pais,
        "error": error,
        "adjunto_nombre": adjunto_nombre,
        "adjunto_ruta": adjunto_ruta
    })
    return created

@app.get("/api/pqr")
def api_get_pqrs(
    comercial_email: Optional[str] = None,
    estado: Optional[str] = None,
    aplica: Optional[str] = None,
    search: Optional[str] = None,
    user=Depends(require_roles("validador", "admin"))
):
    return get_pqrs(comercial_email=comercial_email, estado=estado, aplica=aplica, search=search)

@app.get("/api/pqr/mis-solicitudes")
def api_mis_solicitudes(user=Depends(require_roles("comercial"))):
    return get_pqrs(comercial_email=user["email"])

@app.get("/api/pqr/{pqr_id}")
def api_get_pqr(pqr_id: int, user=Depends(get_current_user)):
    item = get_pqr_by_id(pqr_id)
    if not item:
        raise HTTPException(status_code=404, detail="PQR no encontrada")
    if user["rol"] == "comercial" and item["comercial_email"].lower() != user["email"].lower():
        raise HTTPException(status_code=403, detail="No puedes consultar una PQR de otro comercial")
    if user["rol"] == "redigitador" and item.get("asignado_redigitador_email") != user["email"]:
        raise HTTPException(status_code=403, detail="La PQR no está asignada a tu equipo")
    return item

@app.post("/api/pqr/{pqr_id}/resolver")
def api_resolve_pqr(pqr_id: int, resolve_data: PQRResolve, user=Depends(require_roles("validador", "admin"))):
    existing = get_pqr_by_id(pqr_id)
    if not existing:
        raise HTTPException(status_code=404, detail="PQR no encontrada")
    if user["rol"] == "validador" and existing.get("asignado_validador_email") != user["email"]:
        raise HTTPException(status_code=403, detail="La PQR debe estar asignada a tu usuario antes de dictaminarla")
    
    updated = resolve_pqr(
        pqr_id=pqr_id,
        estado=resolve_data.estado,
        aplica=resolve_data.aplica,
        tipologia=resolve_data.tipologia,
        adjudicable=resolve_data.adjudicable,
        respuesta=resolve_data.respuesta,
        validador_email=user["email"],
        requiere_redigitacion=resolve_data.requiere_redigitacion or False
    )
    return updated

# --- Asignación, trazabilidad y alertas ---

@app.get("/api/users/{rol}")
def api_get_users_by_role(rol: str, user=Depends(require_roles("admin", "validador"))):
    if rol not in ("validador", "redigitador"):
        raise HTTPException(status_code=400, detail="Rol no asignable")
    return get_active_users_by_role(rol)

@app.post("/api/pqr/{pqr_id}/asignar/{rol}")
def api_assign_pqr(pqr_id: int, rol: str, data: PQRAssignment, user=Depends(require_roles("admin", "validador"))):
    if rol not in ("validador", "redigitador"):
        raise HTTPException(status_code=400, detail="Tipo de asignación inválido")
    if rol == "redigitador" and user["rol"] not in ("admin", "validador"):
        raise HTTPException(status_code=403, detail="No autorizado")
    updated = assign_pqr(pqr_id, data.assignee_email, rol, user["email"])
    if not updated:
        raise HTTPException(status_code=400, detail="No se pudo asignar: revisa usuario, rol y estado activo")
    return updated

@app.get("/api/pqr/{pqr_id}/timeline")
def api_get_timeline(pqr_id: int, user=Depends(get_current_user)):
    item = get_pqr_by_id(pqr_id)
    if not item:
        raise HTTPException(status_code=404, detail="PQR no encontrada")
    if user["rol"] == "comercial" and item["comercial_email"].lower() != user["email"].lower():
        raise HTTPException(status_code=403, detail="No autorizado")
    return get_timeline(pqr_id)

@app.get("/api/notificaciones")
def api_notifications(user=Depends(get_current_user)):
    return get_notifications(user["email"])

@app.get("/api/gestion/sla-etapas")
def api_stage_sla(user=Depends(require_roles("validador", "admin"))):
    return get_stage_sla_metrics()

@app.get("/api/gestion/escalaciones")
def api_escalations(user=Depends(require_roles("validador", "admin"))):
    return get_escalations()

@app.post("/api/notificaciones/leer")
def api_read_notifications(user=Depends(get_current_user)):
    mark_notifications_read(user["email"])
    return {"status": "ok"}

# --- Endpoints de Redigitación ---

@app.get("/api/redigitacion")
def api_get_redigitacion(estado_redigitacion: Optional[str] = None, search: Optional[str] = None, user=Depends(require_roles("redigitador", "admin"))):
    items = get_pqrs_redigitacion(estado_redigitacion=estado_redigitacion, search=search)
    if user["rol"] == "redigitador":
        items = [item for item in items if item.get("asignado_redigitador_email") == user["email"]]
    return items

@app.post("/api/pqr/{pqr_id}/redigitar")
def api_redigitar_pqr(pqr_id: int, data: PQRRedigitar, user=Depends(require_roles("redigitador", "admin"))):
    existing = get_pqr_by_id(pqr_id)
    if not existing:
        raise HTTPException(status_code=404, detail="PQR no encontrada")
    if existing.get("requiere_redigitacion") != 1:
        raise HTTPException(status_code=400, detail="Esta PQR no está marcada para redigitación")
    if user["rol"] == "redigitador" and existing.get("asignado_redigitador_email") != user["email"]:
        raise HTTPException(status_code=403, detail="La PQR no está asignada a tu equipo")
    
    updated = redigitar_pqr(
        pqr_id=pqr_id,
        nuevo_numero_auditoria=data.nuevo_numero_auditoria,
        notas=data.notas,
        redigitador_email=user["email"]
    )
    if not updated:
        raise HTTPException(status_code=400, detail="El número de auditoría ya existe o no fue posible actualizar la PQR")
    return updated

@app.post("/api/pqr/{pqr_id}/verificar-redigitacion")
def api_verify_redigitacion(pqr_id: int, data: PQRVerification, user=Depends(require_roles("validador", "admin"))):
    existing = get_pqr_by_id(pqr_id)
    if user["rol"] == "validador" and existing and existing.get("asignado_validador_email") != user["email"]:
        raise HTTPException(status_code=403, detail="La PQR no está asignada a tu usuario")
    updated = verify_redigitacion(pqr_id, data.aprobado, data.comentario, user["email"])
    if not updated:
        raise HTTPException(status_code=400, detail="Solo puedes verificar una PQR ya redigitada")
    return updated

@app.post("/api/pqr/{pqr_id}/reabrir")
def api_reopen_pqr(pqr_id: int, data: PQRReopen, user=Depends(require_roles("validador", "admin"))):
    updated = reopen_pqr(pqr_id, data.motivo, user["email"])
    if not updated:
        raise HTTPException(status_code=404, detail="PQR no encontrada")
    return updated

@app.post("/api/pqr/{pqr_id}/retroalimentacion")
def api_feedback(pqr_id: int, data: PQRFeedback, user=Depends(require_roles("comercial"))):
    updated = add_feedback(pqr_id, data.satisfactorio, data.comentario, user["email"])
    if not updated:
        raise HTTPException(status_code=403, detail="No puedes calificar esta PQR")
    return updated

@app.get("/api/metrics")
def api_get_metrics(user=Depends(require_roles("validador", "admin"))):
    return get_metrics()

# --- Exportación a Excel con Hoja de Casos y Hoja de Estadísticas de Validadores ---

@app.get("/api/pqr/export/excel")
def export_excel():
    pqrs = get_pqrs()
    stats = get_validator_stats()
    
    wb = openpyxl.Workbook()
    
    # 1. Hoja de Casos Detallados
    ws_casos = wb.active
    ws_casos.title = "Casos PQRs Detallados"
    
    headers_casos = [
        "Radicado", "Fecha Radicado", "Correo Comercial", "ID PDV", "Cliente",
        "País", "Error Reportado", "Adjunto", "Estado", "¿Aplica?", 
        "Tipología", "Área Adjudicable", "Respuesta Validador", "Fecha Resolución", "Validador",
        "Tiempo SLA (Horas Hábiles)", "Cumple SLA (≤48h)",
        "¿Requiere Redigitación?", "Estado Redigitación", "Nuevo N° Auditoría", "Fecha Redigitación", "Redigitador"
    ]
    
    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1")
    )
    
    ws_casos.append(headers_casos)
    for col_num in range(1, len(headers_casos) + 1):
        cell = ws_casos.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    
    for row_idx, p in enumerate(pqrs, start=2):
        f_crea = p.get("fecha_creacion")
        f_reso = p.get("fecha_resolucion")
        dur_h_str = "-"
        cumple_sla_str = "-"
        if f_crea and f_reso:
            h = calculate_sla_business_hours(f_crea, f_reso)
            dur_h_str = f"{h} h"
            cumple_sla_str = "Sí (≤48h)" if h <= 48.0 else "No (>48h)"

        row_data = [
            p.get("consecutivo", ""),
            p.get("fecha_creacion", ""),
            p.get("comercial_email", ""),
            p.get("id_pdv", ""),
            p.get("cliente", ""),
            p.get("pais", ""),
            p.get("error", ""),
            p.get("adjunto_nombre", "") or "Sin adjunto",
            p.get("estado", ""),
            p.get("aplica", "") or "Sin Dictamen",
            p.get("tipologia", "") or "Sin Asignar",
            p.get("adjudicable", "") or "Sin Asignar",
            p.get("respuesta_validador", "") or "",
            p.get("fecha_resolucion", "") or "Pendiente",
            p.get("validador_email", "") or "",
            dur_h_str,
            cumple_sla_str,
            "Sí" if p.get("requiere_redigitacion") == 1 else "No",
            p.get("estado_redigitacion", "No Aplica"),
            p.get("nuevo_numero_auditoria", "") or ("Pendiente" if p.get("requiere_redigitacion") == 1 else "N/A"),
            p.get("fecha_redigitacion", "") or "-",
            p.get("redigitador_email", "") or "-"
        ]
        ws_casos.append(row_data)
        for col_num in range(1, len(row_data) + 1):
            cell = ws_casos.cell(row=row_idx, column=col_num)
            cell.border = thin_border
            cell.alignment = Alignment(vertical="top")

    for col in ws_casos.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = col[0].column_letter
        ws_casos.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 45)
        
    # 2. Hoja de Estadísticas Generales y Rendimiento de Validadores (SLA)
    ws_stats = wb.create_sheet(title="Estadísticas Validadores & SLA")
    
    title_font = Font(name="Calibri", size=14, bold=True, color="1E1B4B")
    subtitle_font = Font(name="Calibri", size=11, bold=True, color="334155")
    val_header_fill = PatternFill(start_color="312E81", end_color="312E81", fill_type="solid")
    
    ws_stats.append(["INFORME DE RENDIMIENTO POR VALIDADOR Y MÉTRICAS SLA (≤ 48H HÁBILES)"])
    ws_stats.cell(row=1, column=1).font = title_font
    ws_stats.append(["* SLA: 48 horas hábiles excluyendo fin de semana. Casos radicados viernes > 5:00 PM inician lunes 08:00 AM."])
    ws_stats.append([])
    
    # Tabla de Validadores
    ws_stats.append(["DESGLOSE POR USUARIO VALIDADOR"])
    ws_stats.cell(row=4, column=1).font = subtitle_font
    
    val_headers = [
        "Validador", "Correo", "Tickets Resueltos", "Aplica", "% Aplica", 
        "No Aplica", "% No Aplica", "Tiempo Promedio Hábil", "Cumplimiento SLA (Meta ≤ 48h)"
    ]
    ws_stats.append(val_headers)
    header_row_idx = 5
    for col_num in range(1, len(val_headers) + 1):
        cell = ws_stats.cell(row=header_row_idx, column=col_num)
        cell.fill = val_header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    curr_row = 6
    for v in stats.get("validadores", []):
        row_vals = [
            v["nombre"],
            v["email"],
            v["total_resueltos"],
            v["aplica_count"],
            f"{v['aplica_pct']}%",
            v["no_aplica_count"],
            f"{v['no_aplica_pct']}%",
            f"{v['avg_hours']} h",
            f"{v['sla_pct']}%"
        ]
        ws_stats.append(row_vals)
        for col_num in range(1, len(row_vals) + 1):
            cell = ws_stats.cell(row=curr_row, column=col_num)
            cell.border = thin_border
            cell.alignment = Alignment(horizontal="center" if col_num > 2 else "left")
        curr_row += 1
        
    curr_row += 2
    
    # Tabla por Área Adjudicable (IT, Comercial, Campo, Validación)
    ws_stats.cell(row=curr_row, column=1, value="DISTRIBUCIÓN POR ÁREA ADJUDICABLE (IT, COMERCIAL, CAMPO, VALIDACIÓN)").font = subtitle_font
    curr_row += 1
    adj_headers = ["Área Adjudicable", "Total Casos", "Aplica", "No Aplica", "% Aplica"]
    ws_stats.append(adj_headers)
    for col_num in range(1, len(adj_headers) + 1):
        cell = ws_stats.cell(row=curr_row, column=col_num)
        cell.fill = PatternFill(start_color="4338CA", end_color="4338CA", fill_type="solid")
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
    curr_row += 1
    
    for a in stats.get("adjudicable_stats", []):
        row_vals = [
            a["adjudicable"],
            a["total"],
            a["aplica_cnt"],
            a["no_aplica_cnt"],
            f"{a['aplica_pct']}%"
        ]
        ws_stats.append(row_vals)
        for col_num in range(1, len(row_vals) + 1):
            cell = ws_stats.cell(row=curr_row, column=col_num)
            cell.border = thin_border
        curr_row += 1
        
    curr_row += 2

    # Tabla por Tipologías
    ws_stats.cell(row=curr_row, column=1, value="DISTRIBUCIÓN POR TIPOLOGÍA DE PQR").font = subtitle_font
    curr_row += 1
    tip_headers = ["Tipología", "Total Tickets", "Aplica", "No Aplica", "% Aplica"]
    ws_stats.append(tip_headers)
    for col_num in range(1, len(tip_headers) + 1):
        cell = ws_stats.cell(row=curr_row, column=col_num)
        cell.fill = PatternFill(start_color="0F766E", end_color="0F766E", fill_type="solid")
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
    curr_row += 1
    
    for t in stats.get("tipologias_stats", []):
        row_vals = [
            t["tipologia"],
            t["total"],
            t["aplica_cnt"],
            t["no_aplica_cnt"],
            f"{t['aplica_pct']}%"
        ]
        ws_stats.append(row_vals)
        for col_num in range(1, len(row_vals) + 1):
            cell = ws_stats.cell(row=curr_row, column=col_num)
            cell.border = thin_border
        curr_row += 1

    for col in ws_stats.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = col[0].column_letter
        ws_stats.column_dimensions[col_letter].width = min(max(max_len + 3, 14), 50)
    
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = "reporte_pqrs_con_estadisticas_sla.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
