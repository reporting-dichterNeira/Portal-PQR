# Portal de Solicitudes PQR (Comercial, Validador y Administrador)

## Piloto desplegable en GitHub Pages

La carpeta [`docs/`](docs/) contiene la versión estática para pruebas, compatible con GitHub Pages. Conserva el flujo de PQR completo en el navegador y almacena los datos de prueba en `localStorage`; por ello no requiere Python, servidor, base de datos ni credenciales de producción.

Tras habilitar GitHub Pages con **GitHub Actions**, el sitio estará en:

`https://reporting-dichterneira.github.io/Portal-PQR/`

> Este enlace será el frontend permanente. En la siguiente fase se conectará Supabase desde ese mismo sitio; consulta [`supabase/README.md`](supabase/README.md). No ingreses datos reales ni sensibles durante el piloto.

---

Plataforma corporativa integral para la radicación, dictamen, control de calidad y análisis de SLA de PQRs desarrollada con **FastAPI**, **SQLite**, **Tailwind CSS** y **openpyxl**.

## Flujo operativo

`Radicado → En validación → Pendiente de redigitación → Pendiente de verificación → Cerrado`

- El comercial radica y consulta únicamente sus propios casos.
- El validador se asigna el caso, emite el dictamen y, cuando aplica, lo envía a redigitación.
- El redigitador registra un número de auditoría único; el caso vuelve al validador para verificación final.
- El validador aprueba el cierre o devuelve la redigitación con observaciones. Cada paso queda en la línea de tiempo y genera una alerta interna.

La plataforma controla el acceso por rol (administrador, validador, redigitador y comercial), valida adjuntos permitidos de hasta 10 MB, previene duplicados recientes y expone indicadores de SLA por etapa y una cola de escalaciones.

---

## 🚀 Acceso al Sistema

El portal se encuentra activo en tu entorno local:
👉 **[http://localhost:8000](http://localhost:8000)**

### 🔑 Credenciales Iniciales de Acceso

| Perfil | Correo | Contraseña | Rol / Permisos |
|---|---|---|---|
| **👑 Administrador** | `admin@empresa.com` | `Admin123*` | Gestión de usuarios, asignación de roles/claves y administración exclusiva del catálogo de tipologías. |
| **🛡️ Validador Principal** | `validador@empresa.com` | `Validador123*` | Revisión, dictamen (*Aplica / No Aplica*), selección de tipología establecida, respuesta y sellado de fecha. |
| **🛡️ Validador 2** | `maria.validadora@empresa.com` | `Maria123*` | Gestión y resolución de casos asignados. |
| **💼 Comercial 1** | `carlos.mendoza@empresa.com` | `Carlos123*` | Radicación con ID PDV, Cliente, País, Error y Adjuntos (Imágenes/Excel). Seguimiento a sus casos. |
| **💼 Comercial 2** | `laura.gomez@empresa.com` | `Laura123*` | Radicación y consulta de solicitudes comerciales. |

---

## 📊 Hoja de Estadísticas y Rendimiento de Validadores (SLA)

Dentro del panel del validador (`http://localhost:8000/validador`), ahora cuentas con dos pestañas de navegación:

1. **Bandeja de Gestión de Casos:**
   - Tabla de tickets con filtros por estado y dictamen.
   - Modal de dictamen oficial: ¿Aplica o No?, Tipología establecida, justificación y sellado automático de fecha.
2. **Estadísticas y Rendimiento de Validadores (SLA):**
   - **Métricas Globales de SLA:**
     * Tiempo Promedio Global de Resolución (horas).
     * Tasa de Cumplimiento de SLA (meta ≤ 24 horas).
     * Total de Tickets Dictaminados.
     * Tasa de Procedencia (% Aplica vs % No Aplica).
   - **Desglose Individual por Usuario Validador:**
     * Nombre y Correo del Validador.
     * Total de Tickets Resueltos.
     * Casos que Aplican (cantidad y porcentaje).
     * Casos que No Aplican (cantidad y porcentaje).
     * Casos que Aplican Parcialmente.
     * Tiempo Promedio de Resolución (SLA) individual.
     * Barra de progreso de cumplimiento de meta SLA (verde/amarilla/roja).
   - **Distribución por Tipología:** Volumen de casos y tasa de aprobación por cada categoría.
   - **Distribución Geográfica:** Casos radicados y tasa de aprobación por País.
   - **Exportación a Excel Multihas:** Al pulsar "Descargar Excel con Hoja SLA", se genera un archivo `.xlsx` con dos hojas formateadas:
     1. `Casos PQRs Detallados`
     2. `Estadísticas Validadores & SLA`

---

## 👑 Panel Administrativo (`/admin`)

- **Gestión Integral de Usuarios:** Creación, edición, activación/inactivación y reseteo de claves de comerciales y validadores.
- **Catálogo Exclusivo de Tipologías:** Control centralizado de las tipologías oficiales de la empresa.

---

## 💼 Módulo Comercial (`/comercial`)

- Formulario estructurado con: **ID de PDV**, **Cliente**, **País**, **Error** y **Carga de Archivos** (Imágenes `.png, .jpg, .jpeg, .webp` o archivos Excel `.xlsx, .xls`).
- Seguimiento en tiempo real con visor de estado, dictamen y respuesta del validador.
